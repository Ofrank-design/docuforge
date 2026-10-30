import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { describe } from "vitest";
import { run } from "../../packages/cli/src/cli.js";
import fsp from "node:fs/promises";
import os from "node:os";
import { Capture } from "../helpers/tmp.js";

/** Real-browser tests run only when a Chrome/Chromium binary is provided: CHROME_PATH=/path/to/chrome npm run test:e2e */
export const CHROME_PATH = process.env["CHROME_PATH"];
export const e2e = CHROME_PATH ? describe : describe.skip;

export async function launch(): Promise<Browser> {
  return puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: "shell",
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", ...(process.env["CHROME_ARGS"]?.split(" ") ?? [])],
  });
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".png": "image/png", ".svg": "image/svg+xml", ".txt": "text/plain",
};

/** Static file server like a real host: directory index, 404s, optional URL prefix (for base-path tests). */
export function serve(dir: string, prefix = ""): Promise<{ url: string; close: () => Promise<void>; requests: string[] }> {
  const requests: string[] = [];
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    requests.push(pathname);
    if (prefix && !pathname.startsWith(prefix)) {
      res.writeHead(404);
      return void res.end("not found");
    }
    let file = path.join(dir, pathname.slice(prefix.length));
    if (!file.startsWith(dir)) {
      res.writeHead(403);
      return void res.end();
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!fs.existsSync(file)) {
      res.writeHead(404);
      return void res.end("not found");
    }
    res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({
        url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
        requests,
        close: () => new Promise<void>((r) => server.close(() => r())),
      }),
    ),
  );
}

export interface Opened {
  page: Page;
  /** console errors, uncaught exceptions and failed requests (favicon excluded). */
  errors: string[];
}

export async function openPage(
  browser: Browser,
  opts: { width?: number; height?: number; scheme?: "light" | "dark"; js?: boolean; reducedMotion?: boolean; mobile?: boolean } = {},
): Promise<Opened> {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: opts.width ?? 1400, height: opts.height ?? 900, isMobile: opts.mobile ?? false, hasTouch: opts.mobile ?? false });
  const features = [{ name: "prefers-color-scheme", value: opts.scheme ?? "light" }, ...(opts.reducedMotion ? [{ name: "prefers-reduced-motion", value: "reduce" }] : [])];
  await page.emulateMediaFeatures(features);
  if (opts.js === false) await page.setJavaScriptEnabled(false);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${String((e as Error).message ?? e)}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon|Failed to load resource.*404/.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  page.on("requestfailed", (r) => errors.push(`requestfailed: ${r.url()}`));
  page.on("response", (r) => {
    if (r.status() >= 400 && !r.url().endsWith("/favicon.ico")) errors.push(`http ${r.status()}: ${r.url()}`);
  });
  return { page, errors };
}

export const FILLER = Array.from({ length: 14 }, (_, i) => `## Section ${i + 1}\n\n${"This is filler text to make the page scroll. ".repeat(30)}\n\n### Detail ${i + 1}\n\n${"More filler text. ".repeat(40)}\n`).join("\n");

export const SITE_FILES: Record<string, string> = {
  "docs/index.md": `---\ntitle: Acme Docs\ndescription: Home page.\n---\n# Acme Docs\n\nWelcome. See [install](./getting-started/installation.md) and the [long page](./guides/long.md).\n\n## Status\n\n| a | b | c | d | e | f | g | h | i | j | k | l |\n|---|---|---|---|---|---|---|---|---|---|---|---|\n| ${Array.from({ length: 12 }, (_, i) => `wide-cell-content-${i}`).join(" | ")} |\n`,
  "docs/getting-started/index.md": "---\ntitle: Getting Started\n---\n# Getting Started\n\nBegin here.\n",
  "docs/getting-started/installation.md": "---\ntitle: Installation\ndescription: Install the CLI.\ntags: [setup]\n---\n# Installation\n\nInstall it:\n\n```bash\nnpm install -g acme-cli\nacme --version\n```\n\n```js\nconst aVeryLongLine = \"" + "x".repeat(260) + "\";\n```\n\n## Requirements\n\nNode 20 or newer.\n\n## Troubleshooting\n\nIf the proxy blocks you, set `HTTPS_PROXY`.\n",
  "docs/getting-started/configuration.md": "# Configuration\n\nSet `ACME_REGION` in the environment.\n\n## Environment variables\n\n| Name | Meaning |\n|---|---|\n| ACME_REGION | Region |\n\n## Environment variables\n\nDuplicate heading.\n",
  "docs/guides/authentication.md": "---\ntitle: Authentication\ntags: [security]\n---\n# Authentication\n\nSend the `Authorization` header. Café naïve résumé.\n\n## API tokens\n\nTokens expire hourly.\n",
  "docs/guides/long.md": `# A long page\n\nIntro paragraph.\n\n${FILLER}`,
  "docs/reference/api.md": "# API Reference\n\nLiteral markup stays text: `<img src=x onerror=window.__pwned=1>` and `<script>window.__pwned=2</script>`.\n\n## Create a job\n\nPOST /jobs\n",
};

/**
 * Build a site into a directory that lives until `cleanup()` is called. (The shared makeTree helper
 * deletes its directories after every test, which would remove a site built once in beforeAll.)
 */
export async function buildSite(
  extraArgs: string[] = [],
  files = SITE_FILES,
): Promise<{ cwd: string; dist: string; cleanup: () => Promise<void> }> {
  const cwd = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "docuforge-e2e-")));
  for (const [rel, content] of Object.entries(files)) {
    await fsp.mkdir(path.dirname(path.join(cwd, rel)), { recursive: true });
    await fsp.writeFile(path.join(cwd, rel), content);
  }
  const stderr = new Capture();
  const code = await run(["build", "--source", "docs", "--out", "dist", ...extraArgs], { cwd, stdout: new Capture(), stderr });
  if (code !== 0) throw new Error(`site build failed:\n${stderr.text}`);
  return { cwd, dist: path.join(cwd, "dist"), cleanup: () => fsp.rm(cwd, { recursive: true, force: true }) };
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Wait until smooth scrolling has finished (scroll position unchanged for ~300ms). */
export async function scrollIdle(page: Page): Promise<void> {
  let last = -1;
  let stable = 0;
  for (let i = 0; i < 60 && stable < 3; i++) {
    const y = await page.evaluate(() => window.scrollY);
    stable = y === last ? stable + 1 : 0;
    last = y;
    await sleep(100);
  }
}
