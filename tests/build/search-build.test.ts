import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../../packages/cli/src/cli.js";
import { Capture, makeSite } from "../helpers/tmp.js";

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

describe("search index in the built site", () => {
  it("writes a search index for published pages", async () => {
    const cwd = await makeSite({
      "docs/index.md": "# Home\n\nWelcome to the documentation.",
      "docs/start/install.md": "# Install\n\nRun the installer.",
    });
    const r = await build(cwd);
    expect(r.code).toBe(0);
    expect(await exists(cwd, "search-index.json")).toBe(true);

    const data = JSON.parse(await read(cwd, "search-index.json"));
    // Current shape is an object (version + index), not a bare array
    expect(data).toBeTypeOf("object");
    expect(data).not.toBeNull();
    expect(data).toHaveProperty("version");
    // The two published pages must be present somewhere in the index
    const raw = JSON.stringify(data);
    expect(raw).toMatch(/Home|Welcome/);
    expect(raw).toMatch(/Install|installer/);
  });

  it("reports the number of indexed pages", async () => {
    const cwd = await makeSite({
      "docs/index.md": "# Home",
      "docs/a.md": "# A",
    });
    const r = await build(cwd);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Search covers 2 pages.");
  });

  it("does not index draft pages by default", async () => {
    const cwd = await makeSite({
      "docs/index.md": "# Home",
      "docs/draft.md": "---\ndraft: true\n---\n# Draft",
    });
    const r = await build(cwd);
    expect(r.code).toBe(0);

    const data = JSON.parse(await read(cwd, "search-index.json"));
    expect(data).toBeTypeOf("object");
    expect(JSON.stringify(data)).not.toContain("/draft/");
    expect(JSON.stringify(data)).not.toMatch(/Draft/);
  });

  it("does not include raw hostile markup in the search index", async () => {
    const cwd = await makeSite({
      "docs/index.md":
        '# Home\n\n<script>alert("search-xss")</script>\n\n[bad](javascript:alert(1))\n',
    });
    const r = await build(cwd);
    expect(r.code).toBe(0);
    const raw = await read(cwd, "search-index.json");
    expect(raw).not.toContain("alert");
    expect(raw).not.toContain("javascript:");
  });

  it("is reproducible for identical source input", async () => {
    const files = {
      "docs/index.md": "# Home\n\nSearchable home page.",
      "docs/a.md": "# A\n\nSearchable page A.",
    };
    const cwd = await makeSite(files);
    await build(cwd);
    const first = await read(cwd, "search-index.json");
    await build(cwd, ["--clean"]);
    const second = await read(cwd, "search-index.json");
    expect(second).toBe(first);
  });
});