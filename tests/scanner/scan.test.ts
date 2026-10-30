import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scanSource, type ScanOptions } from "../../packages/cli/src/scanner/scan.js";
import { Diagnostics } from "../../packages/cli/src/util/diagnostics.js";
import { loadDocuments, assignRoutes } from "../../packages/cli/src/markdown/document.js";
import { DocuForgeError } from "../../packages/cli/src/util/errors.js";
import { isRoot, makeTree } from "../helpers/tmp.js";

function opts(sourceDir: string, extra: Partial<ScanOptions> = {}): ScanOptions {
  return { sourceDir, includeHidden: false, exclude: [], maxDocuments: 1000, maxFileSizeBytes: 1_000_000, ...extra };
}

async function scan(dir: string, extra: Partial<ScanOptions> = {}) {
  const diags = new Diagnostics();
  const result = await scanSource(opts(dir, extra), diags);
  return { ...result, diags, paths: result.files.map((f) => f.relPath) };
}

describe("scanner", () => {
  it("discovers nested Markdown files, sorted deterministically", async () => {
    const dir = await makeTree({ "b.md": "#b", "a/deep/er/c.md": "#c", "a/a.md": "#a", "index.md": "#i" });
    const { paths } = await scan(dir);
    expect(paths).toEqual(["a/a.md", "a/deep/er/c.md", "b.md", "index.md"]);
  });

  it("matches .md and .markdown case-insensitively and ignores other files", async () => {
    const dir = await makeTree({
      "a.MD": "x", "b.Markdown": "x", "c.markdown": "x", "d.txt": "x", "e.mdx": "x", "f.md.bak": "x", "README": "x",
    });
    const { paths, stats } = await scan(dir);
    expect(paths).toEqual(["a.MD", "b.Markdown", "c.markdown"]);
    expect(stats.ignoredFiles).toBe(4);
  });

  it("skips hidden files and folders by default", async () => {
    const dir = await makeTree({ ".secret.md": "x", ".hidden/page.md": "x", "ok.md": "x" });
    expect((await scan(dir)).paths).toEqual(["ok.md"]);
  });

  it("includes hidden entries with includeHidden, but never .git", async () => {
    const dir = await makeTree({ ".secret.md": "x", ".hidden/page.md": "x", ".git/notes.md": "x", "ok.md": "x" });
    expect((await scan(dir, { includeHidden: true })).paths).toEqual([".hidden/page.md", ".secret.md", "ok.md"]);
  });

  it("ignores .git, node_modules, .next and .vite", async () => {
    const dir = await makeTree({
      "node_modules/pkg/README.md": "x", ".git/a.md": "x", ".next/a.md": "x", ".vite/a.md": "x",
      "sub/node_modules/x.md": "x", "keep.md": "x",
    });
    expect((await scan(dir, { includeHidden: true })).paths).toEqual(["keep.md"]);
  });

  it("never scans the output directory", async () => {
    const dir = await makeTree({ "a.md": "x", "dist/generated.md": "x", "dist/deep/more.md": "x" });
    expect((await scan(dir, { outDir: path.join(dir, "dist") })).paths).toEqual(["a.md"]);
  });

  it("does not follow symlinked files or directories, and warns", async () => {
    const outside = await makeTree({ "outside.md": "x", "dir/inner.md": "x" });
    const dir = await makeTree({ "real.md": "x" });
    await fs.symlink(path.join(outside, "outside.md"), path.join(dir, "link.md"));
    await fs.symlink(path.join(outside, "dir"), path.join(dir, "linked-dir"));
    const { paths, diags, stats } = await scan(dir);
    expect(paths).toEqual(["real.md"]);
    expect(stats.skippedSymlinks).toBe(2);
    expect(diags.warnings.map((w) => w.code)).toEqual(["scan.symlink-skipped", "scan.symlink-skipped"]);
    expect(diags.warnings.map((w) => w.file).sort()).toEqual(["link.md", "linked-dir"]);
  });

  it("skips dangling symlinks quietly when they are not Markdown", async () => {
    const dir = await makeTree({ "real.md": "x" });
    await fs.symlink(path.join(dir, "nowhere"), path.join(dir, "dangling"));
    const { diags } = await scan(dir);
    expect(diags.all).toHaveLength(0);
  });

  it("applies exclude patterns to files and directories", async () => {
    const dir = await makeTree({ "drafts/a.md": "x", "drafts/deep/b.md": "x", "guides/keep.md": "x", "guides/skip.draft.md": "x" });
    const { paths } = await scan(dir, { exclude: ["drafts/**", "**/*.draft.md"] });
    expect(paths).toEqual(["guides/keep.md"]);
  });

  it("skips files over the size limit with a warning", async () => {
    const dir = await makeTree({ "small.md": "hi", "big.md": "x".repeat(500) });
    const { paths, diags, stats } = await scan(dir, { maxFileSizeBytes: 100 });
    expect(paths).toEqual(["small.md"]);
    expect(stats.skippedTooLarge).toBe(1);
    expect(diags.warnings[0]).toMatchObject({ code: "scan.file-too-large", file: "big.md" });
  });

  it("fails when the document count limit is exceeded", async () => {
    const dir = await makeTree({ "a.md": "x", "b.md": "x", "c.md": "x" });
    await expect(scan(dir, { maxDocuments: 2 })).rejects.toBeInstanceOf(DocuForgeError);
  });

  it.skipIf(isRoot())("warns about unreadable files", async () => {
    const dir = await makeTree({ "ok.md": "x", "locked.md": "x" });
    await fs.chmod(path.join(dir, "locked.md"), 0o000);
    const { paths, diags } = await scan(dir);
    expect(paths).toEqual(["ok.md"]);
    expect(diags.warnings[0]).toMatchObject({ code: "scan.unreadable-file", file: "locked.md" });
  });

  it("warns (and keeps going) when a file disappears between scan and load", async () => {
    const dir = await makeTree({ "ok.md": "# ok", "gone.md": "# gone" });
    const { files } = await scan(dir);
    await fs.rm(path.join(dir, "gone.md"));
    const diags = new Diagnostics();
    const { documents } = await loadDocuments(
      files,
      { strictFrontMatter: false, includeDrafts: false, concurrency: 2, maxFileSizeBytes: 1_000_000 },
      diags,
    );
    expect(documents.map((d) => d.relPath)).toEqual(["ok.md"]);
    expect(diags.warnings[0]).toMatchObject({ code: "document.unreadable", file: "gone.md" });
  });

  it("refuses to read a file that was swapped for a symlink after scanning", async () => {
    const outside = await makeTree({ "secret.md": "# secret" });
    const dir = await makeTree({ "a.md": "# a" });
    const { files } = await scan(dir);
    await fs.rm(path.join(dir, "a.md"));
    await fs.symlink(path.join(outside, "secret.md"), path.join(dir, "a.md"));
    const diags = new Diagnostics();
    const { documents } = await loadDocuments(
      files,
      { strictFrontMatter: false, includeDrafts: false, concurrency: 1, maxFileSizeBytes: 1_000_000 },
      diags,
    );
    expect(documents).toHaveLength(0);
    expect(diags.warnings[0]?.code).toBe("document.unreadable");
  });
});

describe("duplicate route detection", () => {
  const f = (relPath: string) => ({ absPath: `/x/${relPath}`, relPath, size: 1 });

  it("reports a.md vs a/index.md", () => {
    const { collisions, entries } = assignRoutes([f("a.md"), f("a/index.md")]);
    expect(collisions).toEqual([{ route: "/a/", kept: "a.md", dropped: "a/index.md" }]);
    expect(entries).toHaveLength(1);
  });

  it("reports case-insensitive name collisions (Guide.md vs guide.md)", () => {
    const { collisions } = assignRoutes([f("Guide.md"), f("guide.md")]);
    expect(collisions).toHaveLength(1);
  });

  it("reports x.md vs x.markdown and spaces vs hyphens", () => {
    expect(assignRoutes([f("x.md"), f("x.markdown")]).collisions).toHaveLength(1);
    expect(assignRoutes([f("my page.md"), f("my-page.md")]).collisions).toHaveLength(1);
  });

  it("surfaces collisions as build errors through loadDocuments", async () => {
    const dir = await makeTree({ "a.md": "# A", "a/index.md": "# A index" });
    const { files } = await scan(dir);
    const diags = new Diagnostics();
    await loadDocuments(files, { strictFrontMatter: false, includeDrafts: false, concurrency: 2, maxFileSizeBytes: 1e6 }, diags);
    expect(diags.errors).toHaveLength(1);
    expect(diags.errors[0]).toMatchObject({ code: "route.duplicate", file: "a/index.md" });
  });
});
