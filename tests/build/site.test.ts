import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../../packages/cli/src/cli.js";
import { Capture, makeSite, TINY_PNG } from "../helpers/tmp.js";

async function build(cwd: string, args: string[] = []) {
  const stdout = new Capture();
  const stderr = new Capture();
  const code = await run(
    ["build", "--source", "docs", "--out", "dist", ...args],
    { cwd, stdout, stderr },
  );
  return { code, out: stdout.text, err: stderr.text };
}

const read = (cwd: string, rel: string) =>
  fs.readFile(path.join(cwd, "dist", rel), "utf8");

async function exists(cwd: string, rel: string) {
  try {
    await fs.stat(path.join(cwd, "dist", rel));
    return true;
  } catch {
    return false;
  }
}

async function listFiles(dir: string, rel = ""): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(path.join(dir, rel), {
    withFileTypes: true,
  });
  for (const entry of entries.sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const relative = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...(await listFiles(dir, relative)));
    } else {
      out.push(relative);
    }
  }
  return out;
}

describe("static site output", () => {
  it("writes one index.html per document", async () => {
    const cwd = await makeSite({
      "docs/index.md": "---\ntitle: Home\n---\n# Welcome",
      "docs/start/install.md": "# Install",
      "docs/start/index.md": "---\ntitle: Start\n---\nHello",
    });
    const r = await build(cwd);
    expect(r.code).toBe(0);
    const htmlFiles = (await listFiles(path.join(cwd, "dist"))).filter(
      (file) => file.endsWith(".html"),
    );
    expect(htmlFiles).toEqual([
      "404.html",
      "index.html",
      "start/index.html",
      "start/install/index.html",
    ]);
  });

  it("adds an h1 from front-matter title when needed", async () => {
    const cwd = await makeSite({
      "docs/index.md": "---\ntitle: Titled\n---\nJust a paragraph.",
    });
    await build(cwd);
    expect(await read(cwd, "index.html")).toContain("<h1>Titled</h1>");
  });

  it("honors the base path for pages and assets", async () => {
    const cwd = await makeSite(
      {
        "docs/index.md": "# Home\n\n[a](./a.md) ![p](./p.png)\n",
        "docs/a.md": "# A\n",
      },
      { "docs/p.png": TINY_PNG },
    );
    const r = await build(cwd, ["--base", "/my-project"]);
    expect(r.code).toBe(0);
    const html = await read(cwd, "index.html");
    expect(html).toContain('href="/my-project/a/"');
    expect(html).toContain('src="/my-project/p.png"');
    expect(html).toContain('data-df-base="/my-project/"');
  });

  it("removes stale pages and assets from earlier builds, and only those", async () => {
    const cwd = await makeSite({
      "docs/index.md": "# Home",
      "docs/old/page.md": "# Old page",
    });
    await build(cwd);
    expect(await exists(cwd, "old/page/index.html")).toBe(true);

    await fs.rm(path.join(cwd, "docs/old"), {
      recursive: true,
      force: true,
    });
    const r = await build(cwd);
    expect(r.code).toBe(0);
    // Current cleaner reports 2 stale files
    expect(r.out).toContain(
      "Removed 2 stale files from the previous build.",
    );
    expect(await exists(cwd, "old/page/index.html")).toBe(false);
    expect(await exists(cwd, "old")).toBe(false);
  });

  it("is reproducible: identical input gives byte-identical output", async () => {
    const files = {
      "docs/index.md": "# H\n\n[a](./a.md)\n\n```ts\nlet x = 1;\n```\n",
      "docs/a.md": "# A\n\n## B\n\n## B\n",
    };
    const cwd = await makeSite(files, { "docs/p.png": TINY_PNG });
    await build(cwd);

    const first = new Map<string, string>();
    for (const file of await listFiles(path.join(cwd, "dist"))) {
      const contents = await fs.readFile(path.join(cwd, "dist", file));
      first.set(file, contents.toString("base64"));
    }

    await build(cwd, ["--clean"]);

    const second = new Map<string, string>();
    for (const file of await listFiles(path.join(cwd, "dist"))) {
      const contents = await fs.readFile(path.join(cwd, "dist", file));
      second.set(file, contents.toString("base64"));
    }
    expect(second).toEqual(first);
  });
});

describe("build safety", () => {
  it("fails with strict links and leaves an existing output directory untouched", async () => {
    const cwd = await makeSite({
      "docs/index.md": "# Home\n\n[ok](./a.md)\n",
      "docs/a.md": "# A\n",
    });
    expect((await build(cwd)).code).toBe(0);
    const before = await read(cwd, "index.html");

    await fs.writeFile(
      path.join(cwd, "docs/index.md"),
      "# Changed\n\n[broken](./missing.md)\n",
    );
    const r = await build(cwd, ["--strict-links"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("link.broken-page");
    expect(r.err).toContain("the output directory was not modified");
    expect(await read(cwd, "index.html")).toBe(before);
  });

  it("does not leave a staging directory behind, on success or failure", async () => {
    const cwd = await makeSite({
      "docs/index.md": "# Home\n\n[x](./nope.md)\n",
    });
    await build(cwd);
    await build(cwd, ["--strict-links"]);
    const names = await fs.readdir(cwd);
    expect(names.filter((name) => name.includes("staging"))).toEqual([]);
  });
});