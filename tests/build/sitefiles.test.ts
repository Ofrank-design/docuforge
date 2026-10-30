import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../../packages/cli/src/cli.js";
import { Capture, makeSite, TINY_PNG } from "../helpers/tmp.js";

async function build(cwd: string, args: string[] = []) {
  const stdout = new Capture();
  const stderr = new Capture();
  const code = await run(["build", "--source", "docs", "--out", "dist", ...args], { cwd, stdout, stderr });
  return { code, out: stdout.text, err: stderr.text };
}
const read = (cwd: string, rel: string) => fs.readFile(path.join(cwd, "dist", rel), "utf8");
const exists = (cwd: string, rel: string) => fs.stat(path.join(cwd, "dist", rel)).then(() => true, () => false);
const ICO = Buffer.from("AAABAAEAAQEAAAEAIAAwAAAAFgAAACgAAAABAAAAAgAAAAEAIAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA////AA==", "base64");

describe("404 page", () => {
  it("is generated with the shared shell, noindex, no canonical, and base-path aware links", async () => {
    const cwd = await makeSite({ "docs/index.md": "# Home\n", "docuforge.config.json": '{"siteUrl":"https://docs.example.com"}' });
    await build(cwd, ["--base", "/proj"]);
    const html = await read(cwd, "404.html");
    expect(html).toContain("<title>Page not found | Documentation</title>");
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).not.toContain('rel="canonical"');
    expect(html).toContain('<a href="/proj/">Go to the home page</a>');
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('href="/proj/assets/site-'); // styled with the same assets
  });
  it("is not listed in the sitemap, search index or navigation", async () => {
    const cwd = await makeSite({ "docs/index.md": "# Home\n", "docuforge.config.json": '{"siteUrl":"https://docs.example.com"}' });
    await build(cwd);
    expect(await read(cwd, "sitemap.xml")).not.toContain("404");
    expect(await read(cwd, "search-index.json")).not.toContain("Page not found");
    expect(await read(cwd, "navigation.json")).not.toContain("404");
  });
  it("a 404.html supplied in the public directory wins", async () => {
    const cwd = await makeSite({ "docs/index.md": "# Home\n", "docs/public/404.html": "<h1>custom</h1>" });
    expect((await build(cwd)).code).toBe(0);
    expect(await read(cwd, "404.html")).toBe("<h1>custom</h1>");
  });
});

describe("sitemap.xml and robots.txt", () => {
  const files = { "docs/index.md": "# H\n", "docs/a/b.md": "# B\n", "docs/Ünï cödé.md": "# U\n", "docs/c/index.md": "# C\n", "docs/draft.md": "---\ndraft: true\n---\n# D" };

  it("lists every published page (and generated landing pages) with absolute URLs, no drafts, deterministic", async () => {
    const cwd = await makeSite({ ...files, "docuforge.config.json": '{"siteUrl":"https://docs.example.com"}' });
    await build(cwd, ["--base", "/my-docs/"]);
    const xml = await read(cwd, "sitemap.xml");
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual([
      "https://docs.example.com/my-docs/",
      "https://docs.example.com/my-docs/a/", // generated landing page
      "https://docs.example.com/my-docs/a/b/",
      "https://docs.example.com/my-docs/c/",
      "https://docs.example.com/my-docs/%C3%BCn%C3%AF-c%C3%B6d%C3%A9/",
    ]);
    expect(xml).not.toContain("draft");
    const first = xml;
    await build(cwd, ["--base", "/my-docs/", "--clean"]);
    expect(await read(cwd, "sitemap.xml")).toBe(first);
  });

  it("escapes XML special characters", async () => {
    const cwd = await makeSite({ "docs/index.md": "# H\n", "docs/a&b.md": "# AB\n", "docuforge.config.json": '{"siteUrl":"https://docs.example.com"}' });
    await build(cwd);
    const xml = await read(cwd, "sitemap.xml");
    expect(xml).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;)/);
  });

  it("is skipped without siteUrl (sitemaps need absolute URLs); robots.txt is still written", async () => {
    const cwd = await makeSite({ "docs/index.md": "# H\n" });
    const r = await build(cwd);
    expect(r.code).toBe(0);
    expect(await exists(cwd, "sitemap.xml")).toBe(false);
    expect(await read(cwd, "robots.txt")).toBe("User-agent: *\nAllow: /\n");
  });

  it("robots.txt points at the sitemap when there is one", async () => {
    const cwd = await makeSite({ "docs/index.md": "# H\n", "docuforge.config.json": '{"siteUrl":"https://docs.example.com"}' });
    await build(cwd, ["--base", "/p"]);
    expect(await read(cwd, "robots.txt")).toBe("User-agent: *\nAllow: /\n\nSitemap: https://docs.example.com/p/sitemap.xml\n");
  });

  it("user-supplied robots.txt and sitemap.xml in the public directory win, without a collision error", async () => {
    const cwd = await makeSite({
      "docs/index.md": "# H\n", "docs/public/robots.txt": "User-agent: *\nDisallow: /private/\n", "docs/public/sitemap.xml": "<custom/>",
      "docuforge.config.json": '{"siteUrl":"https://docs.example.com"}',
    });
    expect((await build(cwd)).code).toBe(0);
    expect(await read(cwd, "robots.txt")).toContain("Disallow: /private/");
    expect(await read(cwd, "sitemap.xml")).toBe("<custom/>");
  });
});

describe("tab icons", () => {
  it("uses a generated letter icon (no /favicon.ico request) when none is provided", async () => {
    const cwd = await makeSite({ "docs/index.md": "# H\n", "docuforge.config.json": '{"title":"Zeta Docs"}' });
    await build(cwd);
    const html = await read(cwd, "index.html");
    const href = /<link rel="icon" href="(data:image\/svg\+xml,[^"]+)" type="image\/svg\+xml">/.exec(html)?.[1];
    expect(href).toBeDefined();
    const svg = decodeURIComponent(href!.replace("data:image/svg+xml,", ""));
    expect(svg).toContain(">Z</text>");
    expect(svg).not.toMatch(/<script|onload/);
  });

  it("picks up favicon.ico / favicon.png / favicon.svg and apple-touch-icon.png from the public directory automatically", async () => {
    const cwd = await makeSite(
      { "docs/index.md": "# H\n", "docs/public/favicon.svg": '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>' },
      { "docs/public/favicon.png": TINY_PNG, "docs/public/favicon.ico": ICO, "docs/public/apple-touch-icon.png": TINY_PNG },
    );
    await build(cwd, ["--base", "/docs/"]);
    const html = await read(cwd, "index.html");
    expect(html).toContain('<link rel="icon" href="/docs/favicon.svg" type="image/svg+xml">');
    expect(html).toContain('<link rel="icon" href="/docs/favicon.png" type="image/png">');
    expect(html).toContain('<link rel="icon" href="/docs/favicon.ico" type="image/x-icon" sizes="any">');
    expect(html).toContain('<link rel="apple-touch-icon" href="/docs/apple-touch-icon.png">');
    expect(html).not.toContain("data:image/svg+xml"); // no fallback needed
    for (const f of ["favicon.svg", "favicon.png", "favicon.ico", "apple-touch-icon.png"]) expect(await exists(cwd, f)).toBe(true);
    // also on the 404 page, which hosts serve from any URL
    expect(await read(cwd, "404.html")).toContain('href="/docs/favicon.png"');
  });

  it("an explicit favicon option wins over the public-directory convention", async () => {
    const cwd = await makeSite(
      { "docs/index.md": "# H\n", "docuforge.config.json": '{"favicon":"brand/tab.png"}' },
      { "docs/brand/tab.png": TINY_PNG, "docs/public/favicon.ico": ICO },
    );
    await build(cwd);
    const html = await read(cwd, "index.html");
    expect(html).toContain('<link rel="icon" href="/brand/tab.png" type="image/png">');
    expect(html).not.toContain("favicon.ico");
    expect(await exists(cwd, "brand/tab.png")).toBe(true);
  });

  it("an SVG favicon outside the public directory is sanitized on the way out", async () => {
    const cwd = await makeSite({
      "docs/index.md": "# H\n", "docuforge.config.json": '{"favicon":"brand/tab.svg"}',
      "docs/brand/tab.svg": '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>1</script><rect width="1" height="1"/></svg>',
    });
    await build(cwd);
    expect(await read(cwd, "brand/tab.svg")).not.toMatch(/script|onload/);
  });
});

describe("logo, social image and custom CSS", () => {
  it("shows the logo next to the site title, as decorative (the title text names the link)", async () => {
    const cwd = await makeSite({ "docs/index.md": "# H\n", "docuforge.config.json": '{"title":"Acme","logo":"public/logo-mark.png"}' }, { "docs/public/logo-mark.png": TINY_PNG });
    await build(cwd, ["--base", "/d"]);
    const html = await read(cwd, "index.html");
    expect(html).toMatch(/<a class="site-title[^>]*><img [^>]*src="\/d\/logo-mark\.png" alt="" height="32"><span class="truncate">Acme<\/span><\/a>/);
    expect(await exists(cwd, "logo-mark.png")).toBe(true);
    expect(await exists(cwd, "public/logo-mark.png")).toBe(false); // not published twice
  });

  it("emits Open Graph / Twitter images only with an absolute URL (siteUrl set); auto-detects og-image in public", async () => {
    const files = { "docs/index.md": "# H\n" };
    const withUrl = await makeSite({ ...files, "docuforge.config.json": '{"siteUrl":"https://docs.example.com"}' }, { "docs/public/og-image.jpg": TINY_PNG });
    await build(withUrl, ["--base", "/p/"]);
    const html = await read(withUrl, "index.html");
    expect(html).toContain('<meta property="og:image" content="https://docs.example.com/p/og-image.jpg">');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(html).toContain('<meta name="twitter:image" content="https://docs.example.com/p/og-image.jpg">');

    const without = await makeSite(files, { "docs/public/og-image.jpg": TINY_PNG });
    await build(without);
    const plain = await read(without, "index.html");
    expect(plain).not.toContain("og:image");
    expect(plain).toContain('<meta name="twitter:card" content="summary">');
  });

  it("serves sanitized custom CSS from a content-hashed file linked after the theme stylesheet", async () => {
    const css = ":root{--df-accent:#c2410c}\n.content h1{letter-spacing:.02em}";
    const cwd = await makeSite({ "docs/index.md": "# H\n", "docs/theme.css": css, "docuforge.config.json": '{"customCss":"theme.css"}' });
    const r = await build(cwd);
    expect(r.code).toBe(0);
    const html = await read(cwd, "index.html");
    const href = /href="\/(assets\/custom-[0-9a-f]{10}\.css)"/.exec(html)?.[1];
    expect(href).toBeDefined();
    expect(await read(cwd, href!)).toBe(css);
    expect(html.indexOf("assets/site-")).toBeLessThan(html.indexOf("assets/custom-")); // later = overrides
  });

  it("strips @import, external url() and legacy script hooks, keeps inline images, and says what it removed", async () => {
    const css = `@import url("https://evil.example/x.css");
.a{background:url(https://evil.example/t.png)}
.b{background:url("data:image/png;base64,AAAA")}
.c{width:expression(alert(1));behavior:url(x.htc);-moz-binding:url(x.xml)}
.d{fill:url(#grad)}`;
    const cwd = await makeSite({ "docs/index.md": "# H\n", "docs/t.css": css, "docuforge.config.json": '{"customCss":"t.css"}' });
    const r = await build(cwd);
    expect(r.code).toBe(0);
    expect(r.err).toContain("css.sanitized");
    expect(r.err).toMatch(/@import.*url\(\)|url\(\).*@import/);
    const file = (await fs.readdir(path.join(cwd, "dist/assets"))).find((f) => f.startsWith("custom-"))!;
    const out = await read(cwd, `assets/${file}`);
    expect(out.match(/evil\.example|@import|expression|behavior|-moz-binding/)?.[0]).toBeUndefined();
    expect(out).toContain('url("data:image/png;base64,AAAA")');
    expect(out).toContain("url(#grad)");
  });

  it.each([
    ["escaped url", ".a{background:\\75rl(https://evil.example/x.png)}"],
    ["escaped @import", "\\40import 'https://evil.example/x.css';"],
    ["escaped expression", ".a{width:\\65xpression(alert(1))}"],
  ])("fails the build rather than guess when it cannot safely clean %s", async (_name, css) => {
    const cwd = await makeSite({ "docs/index.md": "# H\n", "docs/t.css": css, "docuforge.config.json": '{"customCss":"t.css"}' });
    const r = await build(cwd);
    expect(r.code).toBe(1);
    expect(r.err).toContain("css.rejected");
    expect(await exists(cwd, "index.html")).toBe(false);
  });
});

describe("site file option validation (before any write)", () => {
  const cases: [string, string, Record<string, Buffer>, RegExp][] = [
    ["a missing logo", '{"logo":"nope.png"}', {}, /"logo" file not found: nope\.png/],
    ["a logo that is not an image", '{"logo":"a.txt"}', {}, /"logo" \(a\.txt\) must be an image/],
    ["a path that escapes the source", '{"favicon":"../secret.png"}', {}, /must be a path inside the source directory/],
    ["an absolute path", '{"favicon":"/etc/hosts.png"}', {}, /must be a path inside the source directory/],
    ["a URL", '{"logo":"https://x.example/l.png"}', {}, /must be a path inside the source directory/],
    ["a hidden file", '{"logo":".hidden/l.png"}', { "docs/.hidden/l.png": TINY_PNG }, /hidden file/],
    ["customCss that is not .css", '{"customCss":"t.js"}', {}, /must be a \.css file/],
    ["an oversized stylesheet", '{"customCss":"big.css"}', { "docs/big.css": Buffer.alloc(300_000, 97) }, /over the 262144-byte limit/],
  ];
  it.each(cases)("rejects %s with exit code 2 and writes nothing", async (_n, config, binary, message) => {
    const cwd = await makeSite({ "docs/index.md": "# H\n", "docs/a.txt": "x", "docs/t.js": "x", "docuforge.config.json": config }, binary);
    const r = await build(cwd);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(message);
    expect(await exists(cwd, "index.html")).toBe(false);
  });
  it("rejects a symlinked logo", async () => {
    const outside = await makeSite({}, { "x.png": TINY_PNG });
    const cwd = await makeSite({ "docs/index.md": "# H\n", "docuforge.config.json": '{"logo":"l.png"}' });
    await fs.symlink(path.join(outside, "x.png"), path.join(cwd, "docs/l.png"));
    expect((await build(cwd)).code).toBe(2);
  });
  it("reports several problems at once", async () => {
    const cwd = await makeSite({ "docs/index.md": "# H\n", "docuforge.config.json": '{"logo":"a.png","favicon":"b.png","customCss":"c.css"}' });
    const r = await build(cwd);
    expect(r.err.match(/file not found/g)).toHaveLength(3);
  });
});
