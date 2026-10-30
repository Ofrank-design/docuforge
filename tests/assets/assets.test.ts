import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assetDenyReason, hasAllowedAssetExtension } from "../../packages/cli/src/assets/policy.js";
import { sanitizeSvg, SvgRejected } from "../../packages/cli/src/assets/svg.js";
import { AssetCollector, copyPublicDir, type AssetOptions } from "../../packages/cli/src/assets/copy.js";
import { StagingWriter } from "../../packages/cli/src/build/staging.js";
import { Diagnostics } from "../../packages/cli/src/util/diagnostics.js";
import { makeSite, makeTree, TINY_PNG } from "../helpers/tmp.js";

const HOSTILE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" onload="alert(1)" viewBox="0 0 10 10">
<script>alert(2)</script>
<style>@import url(https://evil.example/x.css); .a{fill:red;background:url(https://evil.example/t.png)}</style>
<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">hi<script>alert(3)</script></div></foreignObject>
<use href="https://evil.example/x.svg#a"/><image href="http://evil.example/p.png" width="1" height="1"/>
<a xlink:href="javascript:alert(4)"><text onclick="x()" x="1" y="2">click</text></a>
<rect class="a" width="5" height="5" fill="blue"/><circle cx="5" cy="5" r="2" onmouseover="alert(5)"/>
<animate attributeName="href" values="javascript:alert(6)"/>
</svg>`;

describe("asset policy", () => {
  it("allows ordinary asset paths and extensions", () => {
    expect(assetDenyReason("images/a.png", { includeHidden: false })).toBeUndefined();
    for (const f of ["a.PNG", "a.jpeg", "a.gif", "a.webp", "a.svg", "a.pdf"]) expect(hasAllowedAssetExtension(f)).toBe(true);
  });
  it.each(["a.exe", "a.sh", "a.html", "a.js", "a.php", "noext", "a.png.exe"])("rejects extension of %s", (f) => {
    expect(hasAllowedAssetExtension(f)).toBe(false);
  });
  it.each([
    ".env", "a/.env.production", ".git/config.png", "x/.private/pic.png", "key.pem", "server.key",
    "id_rsa", "a/.hidden.png", "node_modules/x/y.png", "credentials.json", "../x.png", "a//b.png",
  ])("denies %s", (p) => {
    expect(assetDenyReason(p, { includeHidden: false })).toBeDefined();
  });
  it("allows hidden assets only with includeHidden, but never secrets or .git", () => {
    expect(assetDenyReason(".hidden/a.png", { includeHidden: true })).toBeUndefined();
    expect(assetDenyReason(".env", { includeHidden: true })).toBeDefined();
    expect(assetDenyReason(".git/a.png", { includeHidden: true })).toBeDefined();
  });
});

describe("SVG sanitizing", () => {
  it("strips scripts, handlers, foreignObject, external references and animation", async () => {
    const out = await sanitizeSvg(HOSTILE_SVG);
    expect(out).not.toMatch(/script|onload|onclick|onmouseover|foreignObject|evil\.example|javascript:|<animate/i);
    expect(out).toContain("<rect");
    expect(out).toContain("<circle");
    expect(out).toContain("viewBox");
  });
  it("keeps legitimate content and internal references", async () => {
    const out = await sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient></defs><rect fill="url(#g)" width="5" height="5"/></svg>',
    );
    expect(out).toContain('fill="url(#g)"');
    expect(out).toContain("linearGradient");
  });
  it("rejects input that is not an SVG", async () => {
    await expect(sanitizeSvg("<html><body>nope</body></html>")).rejects.toBeInstanceOf(SvgRejected);
    await expect(sanitizeSvg("not xml at all")).rejects.toThrow();
  });
});

async function setup(files: Record<string, string>, binary: Record<string, Buffer> = {}, over: Partial<AssetOptions> = {}) {
  const sourceDir = await makeSite(files, binary);
  const staging = await makeTree();
  const diags = new Diagnostics();
  const writer = new StagingWriter(staging, diags);
  const opts: AssetOptions = {
    sourceDir, includeHidden: false, maxAssetSizeBytes: 1_000_000, svg: "sanitize", strictLinks: false, publicDir: "public", ...over,
  };
  return { sourceDir, staging, diags, writer, collector: new AssetCollector(opts, writer, diags), opts };
}

describe("AssetCollector", () => {
  it("copies an image to its mirrored path, once, even if referenced repeatedly", async () => {
    const { collector, staging, diags } = await setup({}, { "images/a.png": TINY_PNG });
    expect(await collector.reference("images/a.png", "x.md")).toBe("images/a.png");
    expect(await collector.reference("images/a.png", "y.md")).toBe("images/a.png");
    expect(await fs.readFile(path.join(staging, "images/a.png"))).toEqual(TINY_PNG);
    expect(collector.copiedCount).toBe(1);
    expect(diags.all).toHaveLength(0);
  });

  it("reports missing assets (error in strict mode)", async () => {
    const lenient = await setup({});
    expect(await lenient.collector.reference("nope.png", "d.md")).toBeUndefined();
    expect(lenient.diags.warnings[0]).toMatchObject({ code: "asset.missing", file: "d.md" });
    const strict = await setup({}, {}, { strictLinks: true });
    await strict.collector.reference("nope.png", "d.md");
    expect(strict.diags.errors).toHaveLength(1);
  });

  it("refuses private, hidden and disallowed files", async () => {
    const { collector, staging, diags } = await setup({ ".env": "SECRET=1", "run.sh": "rm -rf /", "page.html": "<script>1</script>" }, {
      ".hidden/p.png": TINY_PNG, "server.pem": Buffer.from("KEY"),
    });
    for (const f of [".env", "run.sh", "page.html", ".hidden/p.png", "server.pem"]) {
      expect(await collector.reference(f, "d.md")).toBeUndefined();
    }
    expect(await fs.readdir(staging)).toEqual([]);
    expect(diags.warnings.map((w) => w.code).sort()).toEqual(["asset.denied", "asset.denied", "asset.denied", "asset.type-not-allowed", "asset.type-not-allowed"]);
  });

  it("does not follow symlinked files or symlinked directories", async () => {
    const outside = await makeSite({}, { "secret.png": TINY_PNG, "dir/inner.png": TINY_PNG });
    const { collector, sourceDir, staging, diags } = await setup({});
    await fs.symlink(path.join(outside, "secret.png"), path.join(sourceDir, "link.png"));
    await fs.symlink(path.join(outside, "dir"), path.join(sourceDir, "linked"));
    expect(await collector.reference("link.png", "d.md")).toBeUndefined();
    expect(await collector.reference("linked/inner.png", "d.md")).toBeUndefined();
    expect(await fs.readdir(staging)).toEqual([]);
    expect(diags.warnings.map((w) => w.code)).toEqual(["asset.symlink", "asset.symlink"]);
  });

  it("enforces the asset size limit", async () => {
    const { collector, diags } = await setup({}, { "big.png": Buffer.alloc(2000) }, { maxAssetSizeBytes: 1000 });
    expect(await collector.reference("big.png", "d.md")).toBeUndefined();
    expect(diags.warnings[0]?.code).toBe("asset.too-large");
  });

  it("sanitizes SVGs on copy, rejects invalid ones, and can skip SVGs entirely", async () => {
    const files = { "evil.svg": HOSTILE_SVG, "fake.svg": "<html>not svg</html>" };
    const a = await setup(files);
    expect(await a.collector.reference("evil.svg", "d.md")).toBe("evil.svg");
    const written = await fs.readFile(path.join(a.staging, "evil.svg"), "utf8");
    expect(written).not.toMatch(/script|onload|evil\.example/i);
    expect(await a.collector.reference("fake.svg", "d.md")).toBeUndefined();
    expect(a.diags.warnings[0]?.code).toBe("asset.svg-invalid");

    const b = await setup(files, {}, { svg: "skip" });
    expect(await b.collector.reference("evil.svg", "d.md")).toBeUndefined();
    expect(b.diags.warnings[0]?.code).toBe("asset.svg-skipped");
  });

  it("errors instead of overwriting when an output path is already produced", async () => {
    const { collector, writer, diags } = await setup({ "data.json": "{}" });
    await writer.write("data.json", "generated");
    expect(await collector.reference("data.json", "d.md")).toBeUndefined();
    expect(diags.errors[0]?.code).toBe("output.collision");
  });
});

describe("copyPublicDir", () => {
  it("copies non-Markdown files to the root and skips secrets, hidden files, Markdown and symlinks", async () => {
    const outside = await makeSite({ "x.txt": "x" });
    const { opts, writer, diags, staging, sourceDir } = await setup(
      { "public/robots.txt": "User-agent: *", "public/.env": "S=1", "public/notes.md": "# doc", "public/.nojekyll": "", "public/.well-known/security.txt": "c", "public/.secret/a.txt": "x", "public/CNAME": "docs.example.com" },
      { "public/logo.png": TINY_PNG, "public/img/deep/p.png": TINY_PNG, "public/server.pem": Buffer.from("k") },
    );
    await fs.symlink(path.join(outside, "x.txt"), path.join(sourceDir, "public", "link.txt"));
    const count = await copyPublicDir(opts, writer, diags);
    expect(writer.files).toEqual([".nojekyll", ".well-known/security.txt", "CNAME", "img/deep/p.png", "logo.png", "robots.txt"]);
    expect(count).toBe(6);
    expect(diags.warnings.map((w) => w.code).sort()).toEqual(["public.denied", "public.denied", "public.symlink-skipped"]);
    await expect(fs.stat(path.join(staging, ".env"))).rejects.toThrow();
  });

  it("does nothing when disabled or absent", async () => {
    const { opts, writer, diags } = await setup({ "public/a.txt": "x" }, {}, { publicDir: false });
    expect(await copyPublicDir(opts, writer, diags)).toBe(0);
    const none = await setup({ "a.md": "x" });
    expect(await copyPublicDir(none.opts, none.writer, none.diags)).toBe(0);
  });
});
