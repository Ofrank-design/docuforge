import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { run } from "../../packages/cli/src/cli.js";
import { Capture, makeTree } from "../helpers/tmp.js";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, "../..");
const SAMPLE = path.join(ROOT, "fixtures", "sample-docs");

async function cli(args: string[], cwd: string) {
  const stdout = new Capture();
  const stderr = new Capture();
  const code = await run(args, { cwd, stdout, stderr });
  return { code, out: stdout.text, err: stderr.text };
}

describe("docuforge build", () => {
  it("builds the sample docs with no config file and writes navigation.json", async () => {
    const cwd = await makeTree();
    const r = await cli(["build", "--source", SAMPLE, "--out", "site"], cwd);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Built 8 page(s), 2 generated landing page(s)");
    expect(r.out).toContain("1 draft(s) excluded");
    const nav = JSON.parse(await fs.readFile(path.join(cwd, "site", "navigation.json"), "utf8"));
    expect(nav.items.map((n: { label: string }) => n.label)).toEqual(["Getting Started", "Guides", "Reference"]);
    expect(JSON.stringify(nav)).not.toContain(ROOT); // no local paths in output
    expect(JSON.stringify(nav)).not.toContain("upcoming-feature"); // draft excluded
  });

  it("is reproducible: two builds give byte-identical output", async () => {
    const cwd = await makeTree();
    await cli(["build", "--source", SAMPLE, "--out", "a"], cwd);
    await cli(["build", "--source", SAMPLE, "--out", "b"], cwd);
    const [a, b] = await Promise.all(["a", "b"].map((d) => fs.readFile(path.join(cwd, d, "navigation.json"), "utf8")));
    expect(a).toBe(b);
  });

  it("records the base path", async () => {
    const cwd = await makeTree();
    await cli(["build", "--source", SAMPLE, "--out", "site", "--base", "my-project"], cwd);
    expect(JSON.parse(await fs.readFile(path.join(cwd, "site", "navigation.json"), "utf8")).basePath).toBe("/my-project/");
  });

  it("includes drafts with --include-drafts", async () => {
    const cwd = await makeTree();
    const r = await cli(["build", "--source", SAMPLE, "--out", "site", "--include-drafts"], cwd);
    expect(r.out).toContain("Built 9 page(s)");
  });

  it("works when the output directory lives inside the source (never rescanned)", async () => {
    const cwd = await makeTree({ "docs/index.md": "# Hi", "docs/a.md": "# A" });
    const first = await cli(["build", "--source", "docs", "--out", "docs/dist"], cwd);
    await fs.writeFile(path.join(cwd, "docs", "dist", "stray.md"), "# stray");
    const second = await cli(["build", "--source", "docs", "--out", "docs/dist"], cwd);
    expect(first.out).toContain("Built 2 page(s)");
    expect(second.out).toContain("Built 2 page(s)");
  });

  it("exits 2 with a helpful message for a missing source", async () => {
    const cwd = await makeTree();
    const r = await cli(["build"], cwd);
    expect(r.code).toBe(2);
    expect(r.err).toContain("Source directory not found");
    expect(r.err).toContain("docuforge init");
  });

  it("exits 1 and writes nothing when there are error diagnostics", async () => {
    const cwd = await makeTree({ "docs/a.md": "# A", "docs/a/index.md": "# A2" });
    const r = await cli(["build", "--source", "docs", "--out", "dist"], cwd);
    expect(r.code).toBe(1);
    expect(r.err).toContain("route.duplicate");
    expect(r.err).toContain("a/index.md");
    await expect(fs.stat(path.join(cwd, "dist"))).rejects.toThrow();
  });

  it("fails on invalid front matter with --strict-frontmatter, but only warns otherwise", async () => {
    const cwd = await makeTree({ "docs/a.md": "---\norder: nope\n---\n# A" });
    const lenient = await cli(["build", "--source", "docs", "--out", "dist"], cwd);
    expect(lenient.code).toBe(0);
    expect(lenient.err).toContain("a.md: Invalid \"order\"");
    const strict = await cli(["build", "--source", "docs", "--out", "dist2", "--strict-frontmatter"], cwd);
    expect(strict.code).toBe(1);
  });

  it("fails clearly when there is nothing to build", async () => {
    const cwd = await makeTree({ "docs/readme.txt": "x" });
    const r = await cli(["build", "--source", "docs"], cwd);
    expect(r.code).toBe(1);
    expect(r.err).toContain("No Markdown");
  });

  it("exits 2 for unknown flags and invalid config", async () => {
    const cwd = await makeTree({ "docs/a.md": "# A", "docuforge.config.json": '{"bogus": 1}' });
    expect((await cli(["build", "--nope"], cwd)).code).toBe(2);
    const r = await cli(["build"], cwd);
    expect(r.code).toBe(2);
    expect(r.err).toContain('Unknown option "bogus"');
  });

  it("rejects an unsafe --base", async () => {
    const cwd = await makeTree({ "docs/a.md": "# A" });
    expect((await cli(["build", "--base", "https://x.com/"], cwd)).code).toBe(2);
  });

  it("strips terminal escape sequences from untrusted file names in diagnostics", async () => {
    const cwd = await makeTree({ "docs/ok.md": "# ok", "docs/bad\u001b[31m.md": "---\norder: nope\n---\n" });
    const r = await cli(["build", "--source", "docs"], cwd);
    expect(r.err).not.toContain("\u001b");
  });
});

describe("--clean safety", () => {
  it("refuses to clean a non-empty directory DocuForge did not create", async () => {
    const cwd = await makeTree({ "docs/a.md": "# A", "precious/keep.txt": "do not delete" });
    const r = await cli(["build", "--source", "docs", "--out", "precious", "--clean"], cwd);
    expect(r.code).toBe(2);
    expect(await fs.readFile(path.join(cwd, "precious", "keep.txt"), "utf8")).toBe("do not delete");
  });

  it("cleans a directory it created earlier (stale files removed)", async () => {
    const cwd = await makeTree({ "docs/a.md": "# A" });
    await cli(["build", "--source", "docs", "--out", "dist"], cwd);
    await fs.writeFile(path.join(cwd, "dist", "stale.html"), "old");
    const r = await cli(["build", "--source", "docs", "--out", "dist", "--clean"], cwd);
    expect(r.code).toBe(0);
    await expect(fs.stat(path.join(cwd, "dist", "stale.html"))).rejects.toThrow();
    await expect(fs.stat(path.join(cwd, "dist", "navigation.json"))).resolves.toBeTruthy();
  });

  it("warns when writing into a non-empty foreign directory without --clean", async () => {
    const cwd = await makeTree({ "docs/a.md": "# A", "out/existing.txt": "x" });
    const r = await cli(["build", "--source", "docs", "--out", "out"], cwd);
    expect(r.code).toBe(0);
    expect(r.err).toContain("not created by DocuForge");
  });

  it("refuses an output directory that contains the source", async () => {
    const cwd = await makeTree({ "docs/a.md": "# A" });
    const r = await cli(["build", "--source", "docs", "--out", ".", "--clean"], cwd);
    expect(r.code).toBe(2);
    await expect(fs.stat(path.join(cwd, "docs", "a.md"))).resolves.toBeTruthy();
  });
});

describe("docuforge init", () => {
  it("creates a config and starter docs, and the starter builds", async () => {
    const cwd = await makeTree();
    expect((await cli(["init"], cwd)).code).toBe(0);
    await expect(fs.stat(path.join(cwd, "docuforge.config.mjs"))).resolves.toBeTruthy();
    const build = await cli(["build"], cwd);
    expect(build.code).toBe(0);
    expect(build.out).toContain("Built 2 page(s)");
  });

  it("never overwrites existing files", async () => {
    const cwd = await makeTree({ "docuforge.config.json": '{"title":"Mine"}', "docs/index.md": "# Mine" });
    const r = await cli(["init"], cwd);
    expect(r.code).toBe(0);
    expect(await fs.readFile(path.join(cwd, "docs", "index.md"), "utf8")).toBe("# Mine");
    expect(await fs.readFile(path.join(cwd, "docuforge.config.json"), "utf8")).toBe('{"title":"Mine"}');
    await expect(fs.stat(path.join(cwd, "docuforge.config.mjs"))).rejects.toThrow();
  });
});

describe("help and version", () => {
  it("prints help with examples and exits 0", async () => {
    const r = await cli(["--help"], process.cwd());
    expect(r.code).toBe(0);
    expect(r.out).toContain("build");
    const b = await cli(["build", "--help"], process.cwd());
    expect(b.out).toContain("Examples:");
    expect(b.out).toContain("--strict-frontmatter");
  });

  it("prints the version", async () => {
    const r = await cli(["--version"], process.cwd());
    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe("0.1.0");
  });
});

describe("real process", () => {
  it("runs through the actual binary entry point with real exit codes", async () => {
    const cwd = await makeTree();
    const tsx = path.join(ROOT, "node_modules", ".bin", "tsx");
    const entry = path.join(ROOT, "packages", "cli", "src", "index.ts");
    const ok = await execFileAsync(tsx, [entry, "build", "--source", SAMPLE, "--out", "site"], { cwd });
    expect(ok.stdout).toContain("Built 8 page(s)");
    await expect(execFileAsync(tsx, [entry, "build", "--source", "nope"], { cwd })).rejects.toMatchObject({ code: 2 });
  });
});

describe("docuforge init: tab icons", () => {
  it("adds the starter icon set to docs/public, and the starter site uses them without any config", async () => {
    const cwd = await makeTree();
    const r = await cli(["init"], cwd);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Added tab icons to docs/public/");
    for (const f of ["favicon.ico", "favicon.png", "apple-touch-icon.png", "logo-mark.png"]) {
      await expect(fs.stat(path.join(cwd, "docs/public", f))).resolves.toBeTruthy();
    }
    expect((await cli(["build"], cwd)).code).toBe(0);
    const html = await fs.readFile(path.join(cwd, "dist/index.html"), "utf8");
    expect(html).toContain('<link rel="icon" href="/favicon.png" type="image/png">');
    expect(html).toContain('<link rel="icon" href="/favicon.ico" type="image/x-icon" sizes="any">');
    expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png">');
    for (const f of ["favicon.ico", "favicon.png", "apple-touch-icon.png"]) await expect(fs.stat(path.join(cwd, "dist", f))).resolves.toBeTruthy();
  });

  it("never overwrites icons the user already has, and adds none to an existing docs folder", async () => {
    const cwd = await makeTree({ "docs/index.md": "# Mine", "docs/public/favicon.png": "my own icon" });
    await cli(["init"], cwd);
    expect(await fs.readFile(path.join(cwd, "docs/public/favicon.png"), "utf8")).toBe("my own icon");
    await expect(fs.stat(path.join(cwd, "docs/public/favicon.ico"))).rejects.toThrow();
  });
});
