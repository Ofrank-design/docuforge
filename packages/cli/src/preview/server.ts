import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { DocuForgeError, ExitCode } from "../util/errors.js";
import { isInside } from "../util/paths.js";

export const DEFAULT_PORT = 4173;
export const DEFAULT_HOST = "127.0.0.1";

/**
 * The policy the generated pages are designed to satisfy: only same-origin scripts and styles (no inline
 * ones), images from the site, data: URIs and https, no plugins, no framing. Serving the preview with it
 * means a page that would break under a strict production CSP breaks here first.
 */
export const PREVIEW_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; font-src 'self'; " +
  "connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
/** SVG opened directly is a document of its own: lock it down completely. */
const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

const TEXT = "; charset=utf-8";
const MIME: Record<string, string> = {
  ".html": `text/html${TEXT}`, ".css": `text/css${TEXT}`, ".js": `text/javascript${TEXT}`, ".mjs": `text/javascript${TEXT}`,
  ".json": `application/json${TEXT}`, ".xml": `application/xml${TEXT}`, ".txt": `text/plain${TEXT}`, ".csv": `text/csv${TEXT}`,
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".avif": "image/avif", ".ico": "image/x-icon", ".pdf": "application/pdf", ".zip": "application/zip",
  ".mp4": "video/mp4", ".webm": "video/webm", ".woff2": "font/woff2", ".woff": "font/woff",
};

export interface PreviewOptions {
  /** Directory produced by `docuforge build`. */
  outDir: string;
  host: string;
  /** 0 picks a free port. */
  port: number;
}

export interface PreviewServer {
  /** Address to open in a browser, including the site's base path. */
  url: string;
  host: string;
  port: number;
  basePath: string;
  close(): Promise<void>;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
export const isLoopback = (host: string): boolean => LOOPBACK.has(host);

/** The base path the site was built for, read from the build's own `navigation.json`. */
export async function readBuiltBasePath(outDir: string): Promise<string> {
  let raw: string;
  try {
    raw = await fsp.readFile(path.join(outDir, "navigation.json"), "utf8");
  } catch {
    throw new DocuForgeError(
      `No built site found in ${outDir} (navigation.json is missing). Run "docuforge build" first.`,
      ExitCode.Usage,
    );
  }
  try {
    const base = (JSON.parse(raw) as { basePath?: unknown }).basePath;
    return typeof base === "string" && /^\/(?!\/)[A-Za-z0-9._~\-/]*\/$|^\/$/.test(base) ? base : "/";
  } catch {
    return "/";
  }
}

function baseHeaders(contentType: string, csp: string): http.OutgoingHttpHeaders {
  return {
    "content-type": contentType,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "content-security-policy": csp,
  };
}

/**
 * Serve an already-built site for local inspection. It behaves like an ordinary static host:
 * directory indexes, 301 to the trailing slash, 404.html with a 404 status, the site under its base path.
 * It never lists directories, never serves dotfiles (except .well-known), and never follows a symlink
 * out of the output directory.
 */
export async function startPreviewServer(opts: PreviewOptions): Promise<PreviewServer> {
  const root = await fsp.realpath(opts.outDir).catch(() => {
    throw new DocuForgeError(`Output directory not found: ${opts.outDir}. Run "docuforge build" first.`, ExitCode.Usage);
  });
  const basePath = await readBuiltBasePath(root);

  const send = (res: http.ServerResponse, status: number, headers: http.OutgoingHttpHeaders, body?: string): void => {
    res.writeHead(status, headers);
    res.end(body);
  };
  const plain = (res: http.ServerResponse, status: number, text: string, extra: http.OutgoingHttpHeaders = {}): void =>
    send(res, status, { ...baseHeaders(`text/plain${TEXT}`, PREVIEW_CSP), ...extra }, text);

  async function serveFile(req: http.IncomingMessage, res: http.ServerResponse, file: string, status = 200): Promise<void> {
    const ext = path.extname(file).toLowerCase();
    const type = MIME[ext] ?? "application/octet-stream";
    const st = await fsp.stat(file);
    const headers = { ...baseHeaders(type, ext === ".svg" ? SVG_CSP : PREVIEW_CSP), "content-length": st.size };
    res.writeHead(status, headers);
    if (req.method === "HEAD") return void res.end();
    const stream = fs.createReadStream(file);
    stream.on("error", () => res.destroy());
    stream.pipe(res);
  }

  async function notFound(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const page = path.join(root, "404.html");
    try {
      if ((await fsp.lstat(page)).isFile()) return await serveFile(req, res, page, 404);
    } catch {
      /* no custom 404 page */
    }
    plain(res, 404, "Not found\n");
  }

  const handler = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    if (req.method !== "GET" && req.method !== "HEAD") return plain(res, 405, "Method not allowed\n", { allow: "GET, HEAD" });

    // Parse the request target by hand: `new URL()` treats "//" as a host and throws on odd input.
    const target0 = req.url ?? "/";
    if (!target0.startsWith("/")) return plain(res, 400, "Bad request\n"); // absolute-form / asterisk-form targets
    const qAt = target0.indexOf("?");
    const rawPathname = qAt === -1 ? target0 : target0.slice(0, qAt);
    const url = { search: qAt === -1 ? "" : target0.slice(qAt).replace(/[\r\n]/g, "") };
    let pathname: string;
    try {
      pathname = decodeURIComponent(rawPathname);
    } catch {
      return plain(res, 400, "Bad request\n");
    }
    if (pathname.includes("\0") || pathname.includes("\\")) return plain(res, 400, "Bad request\n");

    // The site lives under its base path, exactly as it will on the real host.
    if (basePath !== "/") {
      if (pathname === basePath.slice(0, -1) || pathname === "/") return send(res, pathname === "/" ? 302 : 301, { location: basePath + url.search, ...baseHeaders("text/plain", PREVIEW_CSP) });
      if (!pathname.startsWith(basePath)) return void (await notFound(req, res));
    }
    const rel = pathname.slice(basePath.length);
    const segments = rel.split("/");
    for (const seg of segments) {
      if (seg === "." || seg === "..") return void (await notFound(req, res));
      if (seg.startsWith(".") && seg !== ".well-known") return void (await notFound(req, res)); // .docuforge-* metadata etc.
    }

    let target = path.join(root, ...segments);
    try {
      const real = await fsp.realpath(target);
      if (!isInside(root, real)) return void (await notFound(req, res)); // symlink pointing outside the site
      const st = await fsp.stat(real);
      if (st.isDirectory()) {
        if (rel !== "" && !rel.endsWith("/")) {
          return send(res, 301, { location: `${basePath}${rel}/${url.search}`, ...baseHeaders("text/plain", PREVIEW_CSP) });
        }
        target = path.join(real, "index.html");
        const index = await fsp.realpath(target);
        if (!isInside(root, index)) return void (await notFound(req, res));
        return await serveFile(req, res, index);
      }
      return await serveFile(req, res, real);
    } catch {
      return void (await notFound(req, res));
    }
  };

  const server = http.createServer((req, res) => {
    handler(req, res).catch(() => {
      if (!res.headersSent) plain(res, 500, "Internal error\n");
      else res.destroy();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", (err: NodeJS.ErrnoException) => {
      reject(
        err.code === "EADDRINUSE"
          ? new DocuForgeError(`Port ${opts.port} is already in use. Pick another with --port, or use --port 0 for any free port.`, ExitCode.Usage)
          : err.code === "EADDRNOTAVAIL" || err.code === "ENOTFOUND"
            ? new DocuForgeError(`Cannot listen on "${opts.host}": that address is not available on this machine.`, ExitCode.Usage)
            : err,
      );
    });
    server.listen(opts.port, opts.host, resolve);
  });

  const addr = server.address() as { port: number };
  const shownHost = opts.host.includes(":") && !opts.host.startsWith("[") ? `[${opts.host}]` : opts.host;
  return {
    url: `http://${shownHost}:${addr.port}${basePath}`,
    host: opts.host,
    port: addr.port,
    basePath,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
