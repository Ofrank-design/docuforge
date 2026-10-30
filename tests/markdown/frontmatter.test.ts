import { describe, expect, it } from "vitest";
import { parseFrontMatter } from "../../packages/cli/src/markdown/frontmatter.js";
import { extractFirstHeading } from "../../packages/cli/src/markdown/title.js";
import { discoverDir } from "../helpers/pipeline.js";
import { makeTree } from "../helpers/tmp.js";

describe("parseFrontMatter", () => {
  it("parses all supported fields", () => {
    const r = parseFrontMatter(
      "---\ntitle: Getting Started\ndescription: Install it.\norder: 1\nsidebar_label: Quick Start\ntags:\n  - setup\n  - introduction\ndraft: false\n---\n# Body\n",
    );
    expect(r.issues).toEqual([]);
    expect(r.meta).toMatchObject({
      title: "Getting Started",
      description: "Install it.",
      order: 1,
      sidebarLabel: "Quick Start",
      tags: ["setup", "introduction"],
      draft: false,
    });
    expect(r.body).toBe("# Body\n");
    expect(r.hadFrontMatter).toBe(true);
  });

  it("returns the full body when there is no front matter", () => {
    const r = parseFrontMatter("# Just markdown\n\n---\n\nstill body\n");
    expect(r.hadFrontMatter).toBe(false);
    expect(r.body).toContain("still body");
    expect(r.meta.title).toBeUndefined();
  });

  it("handles a byte-order mark and CRLF line endings", () => {
    const r = parseFrontMatter("\uFEFF---\r\ntitle: Win\r\n---\r\nbody\r\n");
    expect(r.meta.title).toBe("Win");
    expect(r.body.trim()).toBe("body");
  });

  it("keeps the document when YAML is invalid and reports it", () => {
    const r = parseFrontMatter("---\ntitle: [unclosed\n: bad: : yaml\n---\n# Still here\n");
    expect(r.issues[0]?.code).toBe("frontmatter.invalid-yaml");
    expect(r.body).toBe("# Still here\n");
    expect(r.meta.title).toBeUndefined();
  });

  it("reports invalid field types but keeps valid fields", () => {
    const r = parseFrontMatter("---\ntitle: Ok\norder: first\ndraft: maybe\ntags: nope\nsidebar_label: 5\n---\nbody");
    const fields = r.issues.map((i) => i.message.match(/"(\w+)"/)?.[1]);
    expect(fields.sort()).toEqual(["draft", "order", "sidebar_label", "tags"]);
    expect(r.meta.title).toBe("Ok");
    expect(r.meta.order).toBeUndefined();
    expect(r.meta.draft).toBe(false);
    expect(r.issues.find((i) => i.message.includes('"draft"'))?.message).toContain("will be published");
  });

  it("rejects non-finite order values", () => {
    expect(parseFrontMatter("---\norder: .inf\n---\n").issues).toHaveLength(1);
  });

  it("coerces numeric tags and removes duplicates", () => {
    expect(parseFrontMatter("---\ntags: [2024, a, a, ' b ']\n---\n").meta.tags).toEqual(["2024", "a", "b"]);
  });

  it("reports front matter that is not a mapping", () => {
    const r = parseFrontMatter("---\n- a\n- b\n---\nbody");
    expect(r.issues[0]?.code).toBe("frontmatter.not-an-object");
    expect(r.body).toBe("body");
  });

  it("preserves unknown fields as plain JSON data", () => {
    const r = parseFrontMatter("---\nauthor: Ada\nversion: 2\nnested:\n  a: [1, 2]\nwhen: 2024-01-02\n---\n");
    expect(r.meta.extra).toEqual({ author: "Ada", version: 2, nested: { a: [1, 2] }, when: "2024-01-02T00:00:00.000Z" });
  });

  it("drops prototype-polluting keys from extra metadata", () => {
    const r = parseFrontMatter('---\n"__proto__": {polluted: true}\nconstructor: x\nsafe: 1\n---\n');
    expect(Object.keys(r.meta.extra)).toEqual(["safe"]);
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  it("never executes JavaScript front matter", () => {
    (globalThis as Record<string, unknown>)["__docuforge_pwned"] = false;
    const r = parseFrontMatter("---js\nglobalThis.__docuforge_pwned = true; ({ title: 'pwned' })\n---\n# Body\n");
    expect((globalThis as Record<string, unknown>)["__docuforge_pwned"]).toBe(false);
    expect(r.meta.title).toBeUndefined();
    expect(r.issues[0]?.code).toBe("frontmatter.invalid-yaml");
    expect(r.body).toBe("# Body\n");
    delete (globalThis as Record<string, unknown>)["__docuforge_pwned"];
  });

  it("does not parse YAML with excessive aliases (expansion attack)", () => {
    const aliases = Array.from({ length: 12 }, () => "*a").join(", ");
    const r = parseFrontMatter(`---\nx: &a [1]\ny: [${aliases}]\n---\nbody`);
    expect(r.issues[0]?.code).toBe("frontmatter.too-many-aliases");
    expect(r.body).toBe("body");
  });

  it("does not parse oversized front matter", () => {
    const r = parseFrontMatter(`---\nnote: ${"x".repeat(70_000)}\n---\nbody`);
    expect(r.issues[0]?.code).toBe("frontmatter.too-large");
    expect(r.body).toBe("body");
  });
});

describe("extractFirstHeading", () => {
  it("finds ATX headings and strips inline Markdown", () => {
    expect(extractFirstHeading("intro\n\n## The `API` [guide](x.md) **now** ##\n")).toBe("The API guide now");
  });
  it("ignores headings inside fenced code blocks", () => {
    expect(extractFirstHeading("```bash\n# comment\n```\n\n# Real\n")).toBe("Real");
    expect(extractFirstHeading("~~~\n# no\n~~~\n")).toBeUndefined();
  });
  it("supports setext headings", () => {
    expect(extractFirstHeading("My Title\n========\n")).toBe("My Title");
  });
  it("returns undefined for empty documents", () => {
    expect(extractFirstHeading("")).toBeUndefined();
  });
});

describe("document loading", () => {
  it("derives titles: front matter > first heading > filename", async () => {
    const dir = await makeTree({
      "fm.md": "---\ntitle: From FM\n---\n# Heading\n",
      "heading.md": "text\n\n# From Heading\n",
      "my-file_name.md": "no heading here",
      "guides/index.md": "",
      "empty.md": "",
      "ünï cödé.md": "# Ünïcödé 日本語\n",
    });
    const { documents } = await discoverDir(dir);
    const by = Object.fromEntries(documents.map((d) => [d.relPath, d]));
    expect(by["fm.md"]).toMatchObject({ title: "From FM", titleSource: "frontmatter" });
    expect(by["heading.md"]).toMatchObject({ title: "From Heading", titleSource: "heading" });
    expect(by["my-file_name.md"]).toMatchObject({ title: "My File Name", titleSource: "filename" });
    expect(by["guides/index.md"]).toMatchObject({ title: "Guides", titleSource: "filename" });
    expect(by["empty.md"]).toMatchObject({ title: "Empty", titleSource: "filename" });
    expect(by["ünï cödé.md"]?.title).toBe("Ünïcödé 日本語");
    expect(by["ünï cödé.md"]?.route).toBe("/ünï-cödé/");
  });

  it("excludes drafts by default and includes them on request", async () => {
    const dir = await makeTree({ "a.md": "# A", "wip.md": "---\ndraft: true\n---\n# WIP" });
    const off = await discoverDir(dir);
    expect(off.documents.map((d) => d.relPath)).toEqual(["a.md"]);
    expect(off.excludedDrafts).toEqual(["wip.md"]);
    const on = await discoverDir(dir, { includeDrafts: true });
    expect(on.documents.map((d) => d.relPath)).toEqual(["a.md", "wip.md"]);
    expect(on.excludedDrafts).toEqual([]);
  });

  it("never silently drops a document with malformed metadata (warning mode)", async () => {
    const dir = await makeTree({ "bad.md": "---\ntitle: [oops\n---\n# Recovered\n" });
    const { documents, diags } = await discoverDir(dir);
    expect(documents).toHaveLength(1);
    expect(documents[0]?.title).toBe("Recovered");
    expect(diags.warnings[0]).toMatchObject({ code: "frontmatter.invalid-yaml", file: "bad.md" });
    expect(diags.hasErrors).toBe(false);
  });

  it("turns malformed metadata into errors in strict mode", async () => {
    const dir = await makeTree({ "bad.md": "---\norder: nope\n---\n# T\n" });
    const { diags } = await discoverDir(dir, { strictFrontMatter: true });
    expect(diags.errors).toHaveLength(1);
    expect(diags.errors[0]).toMatchObject({ code: "frontmatter.invalid-field", file: "bad.md" });
  });

  it("produces identical results regardless of concurrency", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 40; i++) files[`d${i % 5}/p${i}.md`] = `---\norder: ${i % 7}\n---\n# Page ${i}\n`;
    const dir = await makeTree(files);
    const a = await discoverDir(dir, { concurrency: 1 });
    const b = await discoverDir(dir, { concurrency: 16 });
    expect(JSON.stringify(b.tree)).toBe(JSON.stringify(a.tree));
    expect(b.documents.map((d) => d.relPath)).toEqual(a.documents.map((d) => d.relPath));
  });
});

describe("front matter splitting (own parser)", () => {
  it.each([
    ["a horizontal rule of four dashes", "----\ntitle: x\n----\nbody"],
    ["a delimiter line with other text", "--- not front matter\ntitle: x\n---\nbody"],
    ["a block that is never closed", "---\ntitle: x\n\nbody with no closing line\n"],
    ["dashes that are not at the very start", "\n---\ntitle: x\n---\nbody"],
    ["only the opening delimiter", "---"],
  ])("does not treat %s as front matter", (_n, doc) => {
    const r = parseFrontMatter(doc);
    expect(r.hadFrontMatter).toBe(false);
    expect(r.meta.title).toBeUndefined();
    expect(r.body).toBe(doc);
    expect(r.issues).toEqual([]);
  });

  it("handles an empty block and trailing spaces on the delimiters", () => {
    expect(parseFrontMatter("---\n---\nbody")).toMatchObject({ hadFrontMatter: true, body: "body", issues: [] });
    const r = parseFrontMatter("---   \ntitle: T\n---  \nbody");
    expect(r.meta.title).toBe("T");
    expect(r.body).toBe("body");
  });

  it("only the first block is front matter; later --- lines stay in the body", () => {
    const r = parseFrontMatter("---\ntitle: T\n---\n\nintro\n\n---\n\nmore\n");
    expect(r.meta.title).toBe("T");
    expect(r.body).toBe("\nintro\n\n---\n\nmore\n");
  });

  it("accepts JSON front matter, and reports broken JSON without losing the document", () => {
    expect(parseFrontMatter('---json\n{"title":"J","order":3}\n---\nbody').meta).toMatchObject({ title: "J", order: 3 });
    const bad = parseFrontMatter("---json\n{nope}\n---\nbody");
    expect(bad.issues[0]?.code).toBe("frontmatter.invalid-yaml");
    expect(bad.body).toBe("body");
  });

  it.each(["js", "javascript", "coffee", "toml", "cson", "ts"])("refuses ---%s front matter without evaluating it, keeps the body", (lang) => {
    const r = parseFrontMatter(`---${lang}\nglobalThis.__fm = 1\n---\n# Body\n`);
    expect(r.issues[0]).toMatchObject({ code: "frontmatter.invalid-yaml" });
    expect(r.issues[0]?.message).toContain("executable front matter is disabled");
    expect(r.body).toBe("# Body\n");
    expect((globalThis as Record<string, unknown>)["__fm"]).toBeUndefined();
  });

  it("accepts yaml/yml language tags in any case", () => {
    for (const tag of ["yaml", "yml", "YAML"]) expect(parseFrontMatter(`---${tag}\ntitle: T\n---\n`).meta.title).toBe("T");
  });

  it("rejects YAML-specific danger: custom tags, duplicate keys", () => {
    expect(parseFrontMatter("---\nx: !!js/function 'function(){return 1}'\n---\nb").issues[0]?.code).toBe("frontmatter.invalid-yaml");
    expect(parseFrontMatter("---\ntitle: a\ntitle: b\n---\nb").issues[0]?.code).toBe("frontmatter.invalid-yaml");
  });

  it("is fast on pathological input (no catastrophic regex backtracking)", () => {
    const t0 = performance.now();
    parseFrontMatter(`---${" ".repeat(50_000)}x`);
    parseFrontMatter(`---\n${"-".repeat(50_000)}`);
    parseFrontMatter(`---\n${"a: b\n".repeat(20_000)}`);
    parseFrontMatter(`${"---\n".repeat(20_000)}`);
    expect(performance.now() - t0).toBeLessThan(2000);
  });

  it("a document that is only a front matter block has an empty body", () => {
    expect(parseFrontMatter("---\ntitle: T\n---")).toMatchObject({ body: "", meta: { title: "T" } });
  });
});
