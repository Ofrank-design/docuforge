import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { run } from "../../packages/cli/src/cli.js";
import { isLoopback, PREVIEW_CSP, startPreviewServer, type PreviewServer } from "../../packages/cli/src/preview/server.js";
import { DocuForgeError } from "../../packages/cli/src/util/errors.js";
import { Capture, makeSite, makeTree, TINY_PNG } from "../helpers/tmp.js";

const SAMPLE_CONFIG = path.resolve(import.meta.dirname, "../../fixtures/sample-docs.config.json");
const open: PreviewServer[] = [];
afterEach(async () => {
  while (open.length) await open.pop()!.close();
});

async function buildSiteDir(args: string[] = [], files: Record<string, string> = {}, binary: Record<string, Buffer> = {}) {
  const cwd = await makeSite({ "docs/index.md": "# Home\n\n[next](./a/b.md)\n", "docs/a/b.md": "# B\n", "docs/public/.well-known/security.txt": "Contact: x", "docs/public/data.txt": "hi", ...files }, binary);
  const code = await run(["build", "--source", "docs", "--out", "dist", ...args], { cwd, stdout: new Capture(), stderr: new Capture() });
  expect(code).toBe(0);
  return { cwd, dist: path.join(cwd, "dist") };
}
async function serveDist(dist: string): Promise<PreviewServer> {
  const s = await startPreviewServer({ outDir: dist, host: "127.0.0.1", port: 0 });
  open.push(s);
  return s;
}
/** Raw request so `..` and encoded dots reach the server untouched (fetch/URL would normalise them). */
function raw(server: PreviewServer, rawPath: string, method = "GET"): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: server.host, port: server.port, path: rawPath, method }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("serving a built site", () => {
  it("serves pages and assets with correct types and safe headers", async () => {
    const { dist } = await buildSiteDir(["--base", "/"], { "docs/p.svg": "x" }, { "docs/pic.png": TINY_PNG });
    const s = await serveDist(dist);
    const home = await fetch(s.url);
    expect(home.status).toBe(200);
    expect(home.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(home.headers.get("x-content-type-options")).toBe("nosniff");
    expect(home.headers.get("cache-control")).toBe("no-store");
    expect(home.headers.get("content-security-policy")).toBe(PREVIEW_CSP);
    expect(await home.text()).toContain("<h1");
    const types: [string, string][] = [["a/b/", "text/html"], ["navigation.json", "application/json"], ["search-index.json", "application/json"], ["robots.txt", "text/plain"], ["data.txt", "text/plain"]];
    for (const [p, t] of types) expect((await fetch(s.url + p)).headers.get("content-type")).toContain(t);
    const html = await (await fetch(s.url)).text();
    const css = /href="\/(assets\/site-[^"]+\.css)"/.exec(html)![1]!;
    const js = /src="\/(assets\/site-[^"]+\.js)"/.exec(html)![1]!;
    expect((await fetch(s.url + css)).headers.get("content-type")).toContain("text/css");
    expect((await fetch(s.url + js)).headers.get("content-type")).toContain("text/javascript");
  });

  it("serves an SVG with a locked-down policy of its own", async () => {
    const { dist } = await buildSiteDir([], { "docs/index.md": "# H\n\n![d](./d.svg)\n", "docs/d.svg": '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>' });
    const r = await fetch((await serveDist(dist)).url + "d.svg");
    expect(r.headers.get("content-type")).toBe("image/svg+xml");
    expect(r.headers.get("content-security-policy")).toContain("sandbox");
  });

  it("redirects a directory without trailing slash (keeping the query) and serves index files", async () => {
    const s = await serveDist((await buildSiteDir()).dist);
    const r = await fetch(s.url + "a/b?x=1", { redirect: "manual" });
    expect(r.status).toBe(301);
    expect(r.headers.get("location")).toBe("/a/b/?x=1");
    expect((await fetch(s.url + "a/b/")).status).toBe(200);
  });

  it("answers unknown paths with the site's own 404 page and a 404 status", async () => {
    const s = await serveDist((await buildSiteDir()).dist);
    const r = await fetch(s.url + "nope/");
    expect(r.status).toBe(404);
    expect(r.headers.get("content-type")).toContain("text/html");
    expect(await r.text()).toContain("Page not found");
  });

  it("falls back to plain text when there is no 404.html", async () => {
    const { dist } = await buildSiteDir();
    await fs.rm(path.join(dist, "404.html"));
    const r = await fetch((await serveDist(dist)).url + "nope");
    expect(r.status).toBe(404);
    expect(await r.text()).toBe("Not found\n");
  });

  it("supports HEAD (headers, no body) and rejects other methods", async () => {
    const s = await serveDist((await buildSiteDir()).dist);
    const head = await raw(s, "/", "HEAD");
    expect(head.status).toBe(200);
    expect(head.body).toBe("");
    expect(Number(head.headers["content-length"])).toBeGreaterThan(100);
    for (const m of ["POST", "PUT", "DELETE", "PATCH"]) {
      const r = await raw(s, "/", m);
      expect(r.status, m).toBe(405);
      expect(r.headers["allow"]).toBe("GET, HEAD");
    }
  });

  it("never lists directories", async () => {
    const s = await serveDist((await buildSiteDir()).dist);
    const r = await raw(s, "/assets/chunks/");
    expect(r.status).toBe(404);
    expect(r.body).not.toMatch(/engine-.*\.js/);
  });
});

describe("base paths", () => {
  it("serves the site under its base path, like a project page on a static host", async () => {
    const s = await serveDist((await buildSiteDir(["--base", "/proj/"])).dist);
    expect(s.basePath).toBe("/proj/");
    expect(s.url.endsWith("/proj/")).toBe(true);
    const root = await fetch(s.url.replace("/proj/", "/"), { redirect: "manual" });
    expect([301, 302]).toContain(root.status);
    expect(root.headers.get("location")).toBe("/proj/");
    const noSlash = await fetch(s.url.replace("/proj/", "/proj"), { redirect: "manual" });
    expect(noSlash.status).toBe(301);
    expect(noSlash.headers.get("location")).toBe("/proj/");
    expect((await fetch(s.url + "a/b/")).status).toBe(200);
    expect((await fetch(s.url.replace("/proj/", "/other/"))).status).toBe(404);
    expect((await fetch(s.url.replace("/proj/", "/a/b/"))).status).toBe(404); // not at the root
    const html = await (await fetch(s.url)).text();
    const origin = new URL(s.url).origin;
    const refs = [...html.matchAll(/(?:href|src)="(\/proj\/[^"#]+)"/g)].map((m) => m[1]!);
    expect(refs.length).toBeGreaterThan(3);
    for (const ref of refs) expect((await fetch(origin + ref)).status, ref).toBe(200);
  });

  it("reads the base path from the build, ignoring a tampered navigation.json", async () => {
    const { dist } = await buildSiteDir();
    await fs.writeFile(path.join(dist, "navigation.json"), JSON.stringify({ basePath: "//evil.com/" }));
    expect((await serveDist(dist)).basePath).toBe("/");
  });
});

describe("hostile requests", () => {
  const attacks = [
    "/../../../../etc/passwd", "/%2e%2e/%2e%2e/%2e%2e/etc/passwd", "/..%2f..%2f..%2fetc%2fpasswd", "/%2e%2e%2f%2e%2e%2fetc%2fpasswd",
    "/a/../../../../etc/passwd", "/..\\..\\..\\etc\\passwd", "/%5c..%5c..%5cetc%5cpasswd", "/%00", "/index.html%00.png", "/%c0%ae%c0%ae/%c0%ae%c0%ae/etc/passwd",
  ];
  it.each(attacks)("does not leak files for %s", async (p) => {
    const s = await serveDist((await buildSiteDir()).dist);
    const r = await raw(s, p);
    expect([400, 404], p).toContain(r.status);
    expect(r.body).not.toMatch(/root:.*:0:0/);
  });

  it("hides DocuForge metadata and every other dotfile, but serves .well-known", async () => {
    const s = await serveDist((await buildSiteDir()).dist);
    for (const p of ["/.docuforge-manifest.json", "/.docuforge-build", "/%2edocuforge-manifest.json", "/.env", "/a/.hidden"]) {
      expect((await raw(s, p)).status, p).toBe(404);
    }
    const ok = await raw(s, "/.well-known/security.txt");
    expect(ok.status).toBe(200);
    expect(ok.body).toContain("Contact");
  });

  it("does not follow symlinks that point outside the output directory", async () => {
    const { dist } = await buildSiteDir();
    const outside = await makeTree({ "secret.txt": "TOPSECRET", "dir/x.html": "TOPSECRET" });
    await fs.symlink(path.join(outside, "secret.txt"), path.join(dist, "leak.txt"));
    await fs.symlink(path.join(outside, "dir"), path.join(dist, "leakdir"));
    await fs.symlink("/etc/hostname", path.join(dist, "host.txt"));
    const s = await serveDist(dist);
    for (const p of ["/leak.txt", "/leakdir/x.html", "/leakdir/", "/host.txt"]) {
      const r = await raw(s, p);
      expect(r.status, p).toBe(404);
      expect(r.body).not.toContain("TOPSECRET");
    }
  });

  it("copes with absurd input without crashing", async () => {
    const s = await serveDist((await buildSiteDir()).dist);
    for (const p of ["/" + "a".repeat(8000), "/%", "/%zz", "/?" + "q=1&".repeat(500), "//", "///a//b", "http://evil.example/", "*", "/%0d%0aSet-Cookie:x=1"]) {
      const r = await raw(s, p).catch(() => ({ status: 0 }));
      expect(r.status, p.slice(0, 20)).not.toBe(500);
    }
    // a client-supplied query string can never inject response headers
    const r = await raw(s, "/a/b?x=%0d%0aInjected:1");
    expect(r.headers["injected"]).toBeUndefined();
    expect((await fetch(s.url)).status).toBe(200); // still alive
  });
});

describe("network exposure", () => {
  it("binds to 127.0.0.1 by default and refuses connections on other interfaces", async () => {
    const s = await serveDist((await buildSiteDir()).dist);
    expect(s.host).toBe("127.0.0.1");
    const external = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === "IPv4" && !i.internal);
    if (!external) return; // sandbox with no external interface: nothing to probe
    const refused = await new Promise<boolean>((resolve) => {
      const sock = net.connect({ host: external.address, port: s.port });
      sock.once("connect", () => (sock.destroy(), resolve(false)));
      sock.once("error", () => resolve(true));
    });
    expect(refused).toBe(true);
  });
  it("classifies loopback hosts", () => {
    for (const h of ["127.0.0.1", "localhost", "::1"]) expect(isLoopback(h)).toBe(true);
    for (const h of ["0.0.0.0", "192.168.1.5", "example.com", "::"]) expect(isLoopback(h)).toBe(false);
  });
});

describe("errors", () => {
  it("explains a missing output directory or an unbuilt directory", async () => {
    await expect(startPreviewServer({ outDir: "/nonexistent/dist", host: "127.0.0.1", port: 0 })).rejects.toThrow(/Run "docuforge build" first/);
    const empty = await makeTree({ "x.txt": "x" });
    await expect(startPreviewServer({ outDir: empty, host: "127.0.0.1", port: 0 })).rejects.toThrow(/navigation\.json is missing/);
  });
  it("explains a port that is already in use", async () => {
    const dist = (await buildSiteDir()).dist;
    const first = await serveDist(dist);
    const err = await startPreviewServer({ outDir: dist, host: "127.0.0.1", port: first.port }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DocuForgeError);
    expect((err as Error).message).toContain("already in use");
  });
});

describe("a built site is self-contained", () => {
  it("previews from a copy that has no Markdown source and no config, including search", async () => {
    const original = await buildSiteDir(["--base", "/"], { "docs/index.md": "# Home\n\nfindme\n" });
    const copy = await makeTree();
    await fs.cp(original.dist, path.join(copy, "site"), { recursive: true });
    await fs.rm(original.cwd, { recursive: true, force: true }); // the source is gone
    const s = await serveDist(path.join(copy, "site"));
    expect((await fetch(s.url)).status).toBe(200);
    const idx = await (await fetch(s.url + "search-index.json")).json();
    expect(idx.version).toBe(1);
    const html = await (await fetch(s.url)).text();
    const js = /src="\/(assets\/site-[^"]+\.js)"/.exec(html)![1]!;
    const entry = await (await fetch(s.url + js)).text();
    const chunk = /\.\/chunks\/(engine-[^"'`]+\.js)/.exec(entry)![1]!;
    expect((await fetch(s.url + "assets/chunks/" + chunk)).status).toBe(200); // lazy search code resolves
  });
});

describe("docuforge preview (CLI)", () => {
  async function start(args: string[], cwd: string) {
    const ac = new AbortController();
    const stdout = new Capture();
    const stderr = new Capture();
    const done = run(["preview", ...args], { cwd, stdout, stderr, signal: ac.signal });
    return { ac, stdout, stderr, done };
  }
  const until = async (fn: () => boolean) => {
    for (let i = 0; i < 100 && !fn(); i++) await new Promise((r) => setTimeout(r, 30));
  };

  it("serves the built site, prints the URL, and exits 0 on shutdown", async () => {
    const { cwd } = await buildSiteDir();
    const p = await start(["--out", "dist", "--port", "0"], cwd);
    await until(() => /Previewing the built site at (http\S+)/.test(p.stdout.text));
    const url = /Previewing the built site at (http\S+)/.exec(p.stdout.text)![1]!;
    expect((await fetch(url)).status).toBe(200);
    p.ac.abort();
    expect(await p.done).toBe(0);
    expect(p.stdout.text).toContain("Preview stopped");
    await expect(fetch(url)).rejects.toThrow(); // really closed
  });

  it("warns when asked to listen beyond localhost", async () => {
    const { cwd } = await buildSiteDir();
    const p = await start(["--out", "dist", "--port", "0", "--host", "0.0.0.0"], cwd);
    await until(() => p.stdout.text.includes("Previewing"));
    p.ac.abort();
    await p.done;
    expect(p.stderr.text).toContain("reachable from other machines");
  });

  it.each([["--port", "abc"], ["--port", "70000"], ["--port", "-1"], ["--host", "bad host!"]])("rejects %s %s with exit 2", async (flag, value) => {
    const { cwd } = await buildSiteDir();
    const p = await start(["--out", "dist", flag, value], cwd);
    expect(await p.done).toBe(2);
  });

  it("exits 2 with guidance when nothing has been built", async () => {
    const cwd = await makeTree();
    const p = await start([], cwd);
    expect(await p.done).toBe(2);
    expect(p.stderr.text).toContain('Run "docuforge build" first');
  });

  it("finds the output directory from the config file", async () => {
    const { cwd } = await buildSiteDir();
    await fs.writeFile(path.join(cwd, "docuforge.config.json"), '{"output":"dist"}');
    const p = await start(["--port", "0"], cwd);
    await until(() => p.stdout.text.includes("Previewing"));
    p.ac.abort();
    expect(await p.done).toBe(0);
  });

  it("previews the real example site", async () => {
    const cwd = await makeTree();
    const out = path.join(cwd, "example");
    expect(await run(["build", "--config", SAMPLE_CONFIG, "--out", out], { cwd, stdout: new Capture(), stderr: new Capture() })).toBe(0);
    const s = await serveDist(out);
    for (const p of ["", "getting-started/installation/", "favicon.ico", "favicon.png", "apple-touch-icon.png", "logo-mark.png", "og-image.jpg", "images/overview.png", "guides/images/auth-flow.svg", "sitemap.xml", "robots.txt", "404.html"]) {
      const r = await fetch(s.url + p);
      expect(r.status === 200 || p === "404.html", p).toBe(true);
    }
  });
});
