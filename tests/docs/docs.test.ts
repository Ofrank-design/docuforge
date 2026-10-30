import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import { run } from "../../packages/cli/src/cli.js";
import { ConfigSchema } from "../../packages/cli/src/config/schema.js";
import { Capture } from "../helpers/tmp.js";

const ROOT = path.resolve(import.meta.dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const readme = read("README.md");

async function help(...args: string[]): Promise<string> {
  const stdout = new Capture();
  await run([...args, "--help"], { cwd: ROOT, stdout, stderr: new Capture() });
  return stdout.text;
}

describe("README stays in sync with the code", () => {
  it("documents every top-level config option", () => {
    for (const key of Object.keys(ConfigSchema.shape)) expect(readme, `config option "${key}"`).toContain(`\`${key}\``);
  });
  it.each([["build"], ["preview"], ["init"]])("documents every flag of `docuforge %s`", async (cmd) => {
    const flags = [...(await help(cmd)).matchAll(/^\s+(--[a-z-]+)/gm)].map((m) => m[1]!);
    for (const f of new Set(flags)) expect(readme, `${cmd} ${f}`).toContain(f);
  });
  it("documents every command, exit code, and config file name", () => {
    for (const c of ["docuforge build", "docuforge preview", "docuforge init"]) expect(readme).toContain(c);
    for (const n of ["docuforge.config.mjs", "docuforge.config.json"]) expect(readme).toContain(n);
    expect(readme).toMatch(/\|\s*`70`/);
  });
  it("documents every front matter field", () => {
    for (const f of ["title", "description", "order", "sidebar_label", "tags", "draft"]) expect(readme).toContain(`\`${f}\``);
  });
  it("only references files that exist", () => {
    const prose = readme.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, ""); // links inside code are examples, not links
    for (const m of prose.matchAll(/\]\((?!https?:|#)([^)]+)\)/g)) {
      const target = m[1]!.split("#")[0]!;
      expect(existsSync(path.join(ROOT, target)), `README links to ${target}`).toBe(true);
    }
  });
  it("lists every design token a custom stylesheet can override", () => {
    const css = read("packages/theme/src/styles/site.css");
    const tokens = new Set([...css.slice(0, css.indexOf('[data-theme="dark"]')).matchAll(/--df-([a-z-]+):/g)].map((m) => m[1]));
    for (const t of tokens) expect(readme, `token --df-${t}`).toContain(`--df-${t}`);
  });
});

describe("deployment examples are valid", () => {
  it("GitHub Pages workflow is valid YAML, builds with a base path, and deploys the dist directory", () => {
    const wf = yaml.load(read("examples/deploy/github-pages.yml")) as { jobs: Record<string, { steps?: { run?: string; uses?: string; with?: { path?: string } }[] }> };
    const steps = wf.jobs["build"]!.steps!;
    expect(steps.some((s) => s.run?.includes("docuforge build") && s.run.includes("--base"))).toBe(true);
    expect(steps.find((s) => s.uses?.startsWith("actions/upload-pages-artifact"))?.with?.path).toBe("dist");
    expect(wf.jobs["deploy"]).toBeDefined();
  });
  it("CI workflow is valid YAML and runs typecheck, build and tests", () => {
    const ci = yaml.load(read(".github/workflows/ci.yml")) as { jobs: Record<string, { steps: { run?: string }[] }> };
    const runs = ci.jobs["test"]!.steps.map((s) => s.run ?? "").join("\n");
    for (const c of ["npm run typecheck", "npm run build", "npm test"]) expect(runs).toContain(c);
  });
  it("vercel.json is valid JSON with trailing slashes and the dist output", () => {
    const v = JSON.parse(read("examples/deploy/vercel.json")) as { outputDirectory: string; trailingSlash: boolean; buildCommand: string };
    expect(v).toMatchObject({ outputDirectory: "dist", trailingSlash: true });
    expect(v.buildCommand).toContain("docuforge build");
  });
  it("netlify.toml and nginx.conf point at the dist output and the 404 page", () => {
    expect(read("examples/deploy/netlify.toml")).toMatch(/publish = "dist"/);
    expect(read("examples/deploy/nginx.conf")).toMatch(/error_page 404 \/404\.html/);
  });
  it("every example ships the same CSP as `docuforge preview` enforces", async () => {
    const { PREVIEW_CSP } = await import("../../packages/cli/src/preview/server.js");
    for (const f of ["netlify.toml", "vercel.json", "nginx.conf"]) expect(read(`examples/deploy/${f}`), f).toContain(PREVIEW_CSP);
  });
});

describe("release files", () => {
  it("has a license, changelog and security policy; the package is MIT and ships its theme and starter icons", () => {
    for (const f of ["LICENSE", "CHANGELOG.md", "SECURITY.md"]) expect(existsSync(path.join(ROOT, f)), f).toBe(true);
    const pkg = JSON.parse(read("packages/cli/package.json")) as { license: string; files: string[]; bin: Record<string, string>; version: string };
    expect(pkg).toMatchObject({ license: "MIT", bin: { docuforge: "./dist/index.js" } });
    expect(pkg.files).toEqual(expect.arrayContaining(["dist", "theme-assets", "starter"]));
    expect(read("CHANGELOG.md")).toContain(`## ${pkg.version}`);
  });
  it("the starter icon set and brand sources exist", () => {
    for (const f of ["favicon.ico", "favicon.png", "apple-touch-icon.png", "logo-mark.png"]) expect(existsSync(path.join(ROOT, "packages/cli/starter/public", f)), f).toBe(true);
  });
});
