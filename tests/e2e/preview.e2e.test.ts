import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser, Page } from "puppeteer-core";
import { run } from "../../packages/cli/src/cli.js";
import { startPreviewServer, type PreviewServer } from "../../packages/cli/src/preview/server.js";
import { Capture } from "../helpers/tmp.js";
import { buildSite, e2e, launch, openPage, sleep, SITE_FILES } from "./helpers";

const SAMPLE_CONFIG = path.resolve(import.meta.dirname, "../../fixtures/sample-docs.config.json");

let browser: Browser;
const servers: PreviewServer[] = [];
const cleanups: (() => Promise<void>)[] = [];
let sample: PreviewServer; // the real example site, built from the repo's sample docs
let based: PreviewServer; // the same sources under a base path

async function buildExample(extra: string[]): Promise<string> {
  const { cwd, cleanup } = await buildSite([], { "docs/index.md": "# x\n" }); // just a scratch directory
  cleanups.push(cleanup);
  const out = path.join(cwd, "example");
  const code = await run(["build", "--config", SAMPLE_CONFIG, "--out", out, ...extra], { cwd, stdout: new Capture(), stderr: new Capture() });
  if (code !== 0) throw new Error("example build failed");
  return out;
}
async function serve(dir: string): Promise<PreviewServer> {
  const s = await startPreviewServer({ outDir: dir, host: "127.0.0.1", port: 0 });
  servers.push(s);
  return s;
}

beforeAll(async () => {
  sample = await serve(await buildExample([]));
  based = await serve(await buildExample(["--base", "/docs/"]));
  browser = await launch();
}, 120_000);
afterAll(async () => {
  await browser?.close();
  for (const s of servers) await s.close();
  for (const c of cleanups) await c();
});

const origin = (s: PreviewServer) => new URL(s.url).origin;

/** Collect every response status and every CSP violation the page triggers. */
async function instrument(page: Page) {
  const responses: { url: string; status: number }[] = [];
  page.on("response", (r) => responses.push({ url: r.url(), status: r.status() }));
  await page.evaluateOnNewDocument(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  return { responses, csp: () => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp) };
}

e2e("tab icon, logo and brand files (real sample site)", () => {
  it("declares every icon in <head>, and each one loads (200, real image)", async () => {
    const { page } = await openPage(browser);
    const inst = await instrument(page);
    await page.goto(sample.url, { waitUntil: "networkidle0" });
    const links = await page.$$eval('head link[rel~="icon"], head link[rel="apple-touch-icon"]', (ls) => ls.map((l) => ({ rel: l.getAttribute("rel"), href: (l as HTMLLinkElement).href, type: l.getAttribute("type"), sizes: l.getAttribute("sizes") })));
    const hrefs = links.map((l) => new URL(l.href).pathname);
    expect(hrefs).toEqual(expect.arrayContaining(["/favicon.png", "/favicon.ico", "/apple-touch-icon.png"]));
    expect(links.find((l) => l.href.endsWith("favicon.ico"))).toMatchObject({ type: "image/x-icon", sizes: "any" });
    for (const l of links) {
      const r = await fetch(l.href);
      expect(r.status, l.href).toBe(200);
      expect(r.headers.get("content-type"), l.href).toMatch(/^image\//);
      expect((await r.arrayBuffer()).byteLength, l.href).toBeGreaterThan(500);
    }
    // the browser itself decodes the PNG icon
    expect(await page.evaluate((href) => new Promise<number>((res) => { const i = new Image(); i.onload = () => res(i.naturalWidth); i.onerror = () => res(0); i.src = href; }), links.find((l) => l.href.endsWith("favicon.png"))!.href)).toBe(192);
    expect(inst.responses.filter((r) => r.status >= 400)).toEqual([]);
    await page.close();
  });

  it("the icons are also found when the site is deployed under a base path", async () => {
    const { page } = await openPage(browser);
    const inst = await instrument(page);
    await page.goto(based.url, { waitUntil: "networkidle0" });
    const hrefs = await page.$$eval('head link[rel~="icon"], head link[rel="apple-touch-icon"]', (ls) => ls.map((l) => new URL((l as HTMLLinkElement).href).pathname));
    expect(hrefs).toEqual(expect.arrayContaining(["/docs/favicon.png", "/docs/favicon.ico", "/docs/apple-touch-icon.png"]));
    for (const h of hrefs) expect((await fetch(origin(based) + h)).status, h).toBe(200);
    expect(inst.responses.filter((r) => r.status >= 400)).toEqual([]);
    await page.close();
  });

  it("the logo shows in the header next to the title, at a sensible size, and decodes", async () => {
    const { page } = await openPage(browser);
    await page.goto(sample.url, { waitUntil: "networkidle0" });
    const logo = await page.$eval(".site-title img", (i) => { const r = i.getBoundingClientRect(); return { w: (i as HTMLImageElement).naturalWidth, h: r.height, alt: i.getAttribute("alt"), title: document.querySelector(".site-title span")!.textContent }; });
    expect(logo.w).toBeGreaterThan(0);
    expect(logo.h).toBeLessThanOrEqual(32);
    expect(logo.h).toBeGreaterThan(16);
    expect(logo.alt).toBe("");
    expect(logo.title).toBe("DocuForge");
    await page.close();
  });

  it("every image in the sample docs loads (PNG, JPEG, WebP, GIF, SVG)", async () => {
    const { page } = await openPage(browser);
    const pages = ["", "getting-started/installation/", "getting-started/configuration/", "guides/authentication/", "guides/deployment/", "reference/cli/"];
    const seen = new Set<string>();
    for (const p of pages) {
      await page.goto(sample.url + p, { waitUntil: "networkidle0" });
      for (const img of await page.$$eval(".content img", (is) => is.map((i) => ({ src: (i as HTMLImageElement).src, ok: (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0 })))) {
        if (img.src.includes("missing.png") || img.src.endsWith("/reference/x")) continue; // deliberately broken fixtures
        expect(img.ok, img.src).toBe(true);
        seen.add(img.src.split(".").pop()!);
      }
    }
    expect([...seen].sort()).toEqual(["gif", "jpg", "png", "svg", "webp"]);
    await page.close();
  });

  it("shows the real favicon on the 404 page too (hosts serve it from any URL)", async () => {
    const { page } = await openPage(browser);
    const resp = await page.goto(sample.url + "guides/does/not/exist/", { waitUntil: "networkidle0" });
    expect(resp!.status()).toBe(404);
    expect(await page.$eval("h1", (h) => h.textContent)).toBe("Page not found");
    expect(await page.$$eval('head link[rel~="icon"]', (l) => l.length)).toBeGreaterThanOrEqual(2);
    expect(await page.$eval("head meta[name=robots]", (m) => m.getAttribute("content"))).toBe("noindex");
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(255, 255, 255)"); // styled, even 4 levels deep
    expect(await page.$(".site-title img")).not.toBeNull();
    await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click("article a")]);
    expect(new URL(page.url()).pathname).toBe("/");
    await page.close();
  });

  it("serves the SEO files the sample config asks for", async () => {
    const sitemap = await (await fetch(sample.url + "sitemap.xml")).text();
    expect(sitemap).toContain("<loc>https://docs.example.com/getting-started/installation/</loc>");
    expect(sitemap).not.toContain("404");
    expect(await (await fetch(sample.url + "robots.txt")).text()).toContain("Sitemap: https://docs.example.com/sitemap.xml");
    const html = await (await fetch(sample.url)).text();
    expect(html).toContain('<meta property="og:image" content="https://docs.example.com/og-image.jpg">');
    expect((await fetch(sample.url + "og-image.jpg")).headers.get("content-type")).toBe("image/jpeg");
  });
});

e2e("strict Content-Security-Policy (as served by `docuforge preview`)", () => {
  it("every feature works with no CSP violations: load, search, theme, copy, keyboard", async () => {
    const { page, errors } = await openPage(browser);
    await page.browserContext().overridePermissions(sample.url, ["clipboard-sanitized-write", "clipboard-read"]);
    const inst = await instrument(page);
    await page.goto(sample.url + "getting-started/configuration/", { waitUntil: "networkidle0" });
    await page.bringToFront();
    // search
    await page.keyboard.press("/");
    await page.keyboard.type("environment", { delay: 10 });
    await page.waitForSelector("[role=option]");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Escape");
    // theme toggle (sets attributes and style via script)
    for (let i = 0; i < 3; i++) await page.click('[data-testid="theme-toggle"]');
    // copy button
    await page.click(".copy-btn");
    await sleep(200);
    expect(await page.$eval(".copy-btn", (b) => b.textContent)).toBe("Copied");
    // table of contents + anchors
    await page.click('nav.toc a');
    await sleep(300);
    expect(await inst.csp()).toEqual([]);
    expect(errors).toEqual([]);
    await page.close();
  });

  it("the mobile drawer works under the same policy", async () => {
    const { page, errors } = await openPage(browser, { width: 390, height: 800, mobile: true });
    const inst = await instrument(page);
    await page.goto(sample.url, { waitUntil: "networkidle0" });
    await page.tap('[data-testid="menu-button"]');
    await sleep(350);
    expect(await page.evaluate(() => getComputedStyle(document.getElementById("df-nav")!).visibility)).toBe("visible");
    await page.keyboard.press("Escape");
    expect(await inst.csp()).toEqual([]);
    expect(errors).toEqual([]);
    await page.close();
  });

  it("the policy really is enforced: an injected inline script is blocked", async () => {
    const { page } = await openPage(browser);
    const inst = await instrument(page);
    await page.goto(sample.url, { waitUntil: "networkidle0" });
    await page.evaluate(() => { const s = document.createElement("script"); s.textContent = "window.__inline = 1"; document.body.appendChild(s); });
    await sleep(100);
    expect(await page.evaluate(() => (window as unknown as { __inline?: number }).__inline)).toBeUndefined();
    expect((await inst.csp()).some((v) => v.startsWith("script-src"))).toBe(true);
    await page.close();
  });
});

e2e("custom CSS option", () => {
  it("is applied after the theme stylesheet and can override the design tokens", async () => {
    const built = await buildSite([], {
      ...SITE_FILES,
      "docs/theme.css": ":root{--df-accent:#c2410c}\n.content h1{letter-spacing:.1em}",
      "docuforge.config.json": '{"customCss":"theme.css"}',
    });
    cleanups.push(built.cleanup);
    const s = await serve(built.dist);
    const { page, errors } = await openPage(browser);
    const inst = await instrument(page);
    await page.goto(s.url, { waitUntil: "networkidle0" });
    expect(await page.evaluate(() => getComputedStyle(document.querySelector(".content p a")!).color)).toBe("rgb(194, 65, 12)");
    expect(await page.evaluate(() => getComputedStyle(document.querySelector(".content h1")!).letterSpacing)).not.toBe("normal");
    expect(await inst.csp()).toEqual([]);
    expect(errors).toEqual([]);
    await page.close();
  });
});
