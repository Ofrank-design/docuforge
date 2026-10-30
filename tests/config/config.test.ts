import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeBasePath, resolveConfig, validatePaths } from "../../packages/cli/src/config/load.js";
import { DocuForgeError } from "../../packages/cli/src/util/errors.js";
import { makeTree } from "../helpers/tmp.js";

describe("configuration", () => {
  it("works with no config file (defaults)", async () => {
    const cwd = await makeTree();
    const c = await resolveConfig(cwd);
    expect(c).toMatchObject({ title: "Documentation", basePath: "/", search: true, includeDrafts: false, concurrency: 8 });
    expect(c.sourceDir).toBe(path.join(cwd, "docs"));
    expect(c.outDir).toBe(path.join(cwd, "dist"));
    expect(c.configFile).toBeUndefined();
  });

  it("auto-discovers docuforge.config.mjs and resolves paths relative to it", async () => {
    const cwd = await makeTree({
      "docuforge.config.mjs": 'export default { title: "Mine", source: "./content", output: "./site", navigation: { sort: "title" } };',
    });
    const c = await resolveConfig(cwd);
    expect(c).toMatchObject({ title: "Mine", navigation: { sort: "title" } });
    expect(c.sourceDir).toBe(path.join(cwd, "content"));
    expect(c.outDir).toBe(path.join(cwd, "site"));
  });

  it("loads JSON config via --config", async () => {
    const cwd = await makeTree({ "custom.json": '{ "title": "J", "exclude": ["drafts/**"] }' });
    const c = await resolveConfig(cwd, { configPath: "custom.json" });
    expect(c).toMatchObject({ title: "J", exclude: ["drafts/**"] });
  });

  it("lets CLI flags override the config file", async () => {
    const cwd = await makeTree({ "docuforge.config.json": '{ "source": "a", "output": "b", "basePath": "/x/", "includeDrafts": false }' });
    const c = await resolveConfig(cwd, { overrides: { source: "cli-src", out: "cli-out", base: "/y", includeDrafts: true } });
    expect(c.sourceDir).toBe(path.join(cwd, "cli-src"));
    expect(c.outDir).toBe(path.join(cwd, "cli-out"));
    expect(c.basePath).toBe("/y/");
    expect(c.includeDrafts).toBe(true);
  });

  it("reports unknown options with a suggestion", async () => {
    const cwd = await makeTree({ "docuforge.config.json": '{ "titel": "x", "navigation": { "sorting": "title" } }' });
    const err = await resolveConfig(cwd).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DocuForgeError);
    expect((err as Error).message).toContain('Unknown option "titel"');
    expect((err as Error).message).toContain('Did you mean "title"?');
    expect((err as Error).message).toContain('Unknown option "navigation.sorting"');
  });

  it("reports invalid values clearly", async () => {
    const cwd = await makeTree({ "docuforge.config.json": '{ "search": "yes", "concurrency": 0, "navigation": { "sort": "random" } }' });
    const err = (await resolveConfig(cwd).catch((e: unknown) => e)) as Error;
    expect(err.message).toContain('Invalid option "search"');
    expect(err.message).toContain('Invalid option "concurrency"');
    expect(err.message).toContain('Invalid option "navigation.sort"');
  });

  it("reports malformed JSON, missing files and bad exports", async () => {
    const cwd = await makeTree({ "bad.json": "{ nope", "arr.mjs": "export default [1,2];" });
    await expect(resolveConfig(cwd, { configPath: "bad.json" })).rejects.toThrow(/not valid JSON/);
    await expect(resolveConfig(cwd, { configPath: "missing.json" })).rejects.toThrow(/not found/);
    await expect(resolveConfig(cwd, { configPath: "arr.mjs" })).rejects.toThrow(/must export a configuration object/);
  });

  it("rejects exclude patterns that try to leave the source", async () => {
    const cwd = await makeTree({ "docuforge.config.json": '{ "exclude": ["../secrets/**"] }' });
    await expect(resolveConfig(cwd)).rejects.toThrow(/Invalid exclude pattern/);
  });
});

describe("normalizeBasePath", () => {
  it.each([
    ["", "/"], ["/", "/"], [".", "/"], ["docs", "/docs/"], ["/docs", "/docs/"], ["/docs/", "/docs/"],
    ["/a//b/", "/a/b/"], ["  /my-project/v1.2/ ", "/my-project/v1.2/"],
  ])("normalizes %j to %j", (input, expected) => {
    expect(normalizeBasePath(input)).toBe(expected);
  });

  it.each(["https://example.com/docs", "//evil.com", "javascript:alert(1)", "/a/../b", "/a b/", '/"><script>', "/a?x=1", "/a#frag"])(
    "rejects %j",
    (input) => {
      expect(() => normalizeBasePath(input)).toThrow(DocuForgeError);
    },
  );
});

describe("validatePaths", () => {
  it("rejects a missing source directory", async () => {
    const cwd = await makeTree();
    await expect(validatePaths(await resolveConfig(cwd))).rejects.toThrow(/Source directory not found/);
  });

  it("rejects an output directory that is, or contains, the source", async () => {
    const cwd = await makeTree({ "docs/a.md": "# A" });
    await expect(validatePaths(await resolveConfig(cwd, { overrides: { out: "docs" } }))).rejects.toThrow(/must not be the source/);
    await expect(validatePaths(await resolveConfig(cwd, { overrides: { out: "." } }))).rejects.toThrow(/must not be the source/);
  });

  it("allows an output directory inside the source (it is excluded from scanning)", async () => {
    const cwd = await makeTree({ "docs/a.md": "# A" });
    const c = await validatePaths(await resolveConfig(cwd, { overrides: { out: "docs/dist" } }));
    expect(c.outDir).toBe(path.join(cwd, "docs", "dist"));
  });
});

describe("Phase 2 options", () => {
  it("applies defaults", async () => {
    const c = await resolveConfig(await makeTree());
    expect(c).toMatchObject({
      rawHtml: "sanitize", svg: "sanitize", publicDir: "public", strictLinks: false,
      toc: { minLevel: 2, maxLevel: 3 }, limits: { maxAssetSizeBytes: 25 * 1024 * 1024 },
    });
    expect(c.siteUrl).toBeUndefined();
  });

  it("accepts valid values, including publicDir: false", async () => {
    const cwd = await makeTree({
      "docuforge.config.json": '{"siteUrl":"https://docs.example.com","rawHtml":"off","svg":"skip","publicDir":false,"toc":{"minLevel":1,"maxLevel":4},"strictLinks":true}',
    });
    expect(await resolveConfig(cwd)).toMatchObject({ siteUrl: "https://docs.example.com", rawHtml: "off", svg: "skip", publicDir: false, strictLinks: true });
  });

  it("lets --strict-links override the config file", async () => {
    const cwd = await makeTree({ "docuforge.config.json": '{"strictLinks":false}' });
    expect((await resolveConfig(cwd, { overrides: { strictLinks: true } })).strictLinks).toBe(true);
  });

  it.each([
    ['{"siteUrl":"not a url"}', "siteUrl"],
    ['{"siteUrl":"ftp://x.example.com"}', "siteUrl"],
    ['{"siteUrl":"javascript:alert(1)"}', "siteUrl"],
    ['{"rawHtml":"allow-all"}', "rawHtml"],
    ['{"svg":"copy"}', "svg"],
    ['{"toc":{"minLevel":4,"maxLevel":2}}', "toc"],
    ['{"toc":{"minLevel":0}}', "toc.minLevel"],
    ['{"toc":{"maxLevel":7}}', "toc.maxLevel"],
    ['{"publicDir":""}', "publicDir"],
    ['{"limits":{"maxAssetSizeBytes":-1}}', "limits.maxAssetSizeBytes"],
  ])("rejects %s", async (json, field) => {
    const cwd = await makeTree({ "docuforge.config.json": json });
    const err = (await resolveConfig(cwd).catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(DocuForgeError);
    expect(err.message).toContain(field);
  });
});

describe("Phase 3 options", () => {
  it("applies search and footer defaults and accepts overrides", async () => {
    expect(await resolveConfig(await makeTree())).toMatchObject({ search: true, footer: "Built with DocuForge" });
    const cwd = await makeTree({ "docuforge.config.json": '{"search":false,"footer":false}' });
    expect(await resolveConfig(cwd)).toMatchObject({ search: false, footer: false });
    const cwd2 = await makeTree({ "docuforge.config.json": '{"footer":"© Acme"}' });
    expect((await resolveConfig(cwd2)).footer).toBe("© Acme");
  });

  it.each([['{"footer":""}', "footer"], ['{"footer":true}', "footer"], ['{"search":"yes"}', "search"]])("rejects %s", async (json, field) => {
    const cwd = await makeTree({ "docuforge.config.json": json });
    await expect(resolveConfig(cwd)).rejects.toThrow(field);
  });

  it("no longer accepts the removed no-op options theme and darkMode", async () => {
    for (const key of ["theme", "darkMode"]) {
      const cwd = await makeTree({ "docuforge.config.json": `{"${key}": true}` });
      await expect(resolveConfig(cwd)).rejects.toThrow(`Unknown option "${key}"`);
    }
  });
});
