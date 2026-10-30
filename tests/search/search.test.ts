import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildSearchIndex, MAX_STORED_TEXT } from "../../packages/cli/src/search/build.js";
import { createSearchEngine, parseSearchIndex } from "../../packages/cli/src/search/engine.js";
import { highlight, makeExcerpt, findMatches } from "../../packages/cli/src/search/excerpt.js";
import { foldDiacritics, normalizeTerm, queryTerms } from "../../packages/cli/src/search/analyzer.js";
import { InvalidIndexError, type SearchDoc } from "../../packages/cli/src/search/types.js";
import { createRenderer } from "../../packages/cli/src/markdown/processor.js";
import { Diagnostics } from "../../packages/cli/src/util/diagnostics.js";

const doc = (over: Partial<SearchDoc> & { id: string; title: string }): SearchDoc => ({
  tags: [], headings: [], text: "", ...over,
});

const DOCS: SearchDoc[] = [
  doc({ id: "/start/install/", title: "Installation", description: "Install the Acme CLI.", tags: ["setup"], headings: [{ depth: 2, id: "requirements", text: "System requirements" }, { depth: 2, id: "troubleshooting", text: "Troubleshooting" }], text: "Install with npm. Requires Node 20. If it fails see the proxy settings." }),
  doc({ id: "/guides/auth/", title: "Authentication", description: "Authenticate API requests.", tags: ["security"], headings: [{ depth: 2, id: "tokens", text: "API tokens" }], text: "Send your token in the Authorization header. Tokens expire after one hour. Installation of a token store is optional." }),
  doc({ id: "/guides/deploy/", title: "Deployment", headings: [{ depth: 2, id: "rolling-back", text: "Rolling back" }], text: "Deploy with the pipeline. Café au lait, naïve approach, and 日本語 text. Set ACME_REGION and edit acme.config.json." }),
  doc({ id: "/reference/api/", title: "API Reference", headings: [{ depth: 2, id: "create-a-job", text: "Create a job" }], text: "POST /jobs creates a job. GET /jobs lists jobs. Authentication is required." }),
];
const engine = () => createSearchEngine(JSON.parse(JSON.stringify(buildSearchIndex(DOCS))));

describe("analysis", () => {
  it("folds diacritics and normalizes terms", () => {
    expect(foldDiacritics("Café naïve Ünï")).toBe("Cafe naive Uni");
    expect(normalizeTerm("  Ünï!! ")).toBe("uni");
    expect(normalizeTerm("日本語")).toBe("日本語");
  });
  it("splits queries into unique normalized terms and never throws on junk", () => {
    expect(queryTerms("  Install   NPM install ")).toEqual(["install", "npm"]);
    expect(queryTerms("ACME_REGION")).toEqual(["acme", "region"]);
    for (const junk of ["", "   ", "!!!", "~", "*", ":", "title:", "foo:bar^10", '"unclosed', "(((", "\\", "a~2 b*"]) {
      expect(() => queryTerms(junk)).not.toThrow();
    }
    expect(queryTerms("!!! ~ *")).toEqual([]);
  });
});

describe("search relevance and matching", () => {
  it("finds documents by title", () => {
    expect(engine().search("deployment")[0]?.doc.id).toBe("/guides/deploy/");
  });
  it("finds documents by heading text and deep-links to the section", () => {
    const hit = engine().search("rolling")[0]!;
    expect(hit.doc.id).toBe("/guides/deploy/");
    expect(hit.heading).toMatchObject({ id: "rolling-back", text: "Rolling back" });
  });
  it("finds documents by body text", () => {
    expect(engine().search("proxy").map((h) => h.doc.id)).toEqual(["/start/install/"]);
  });
  it("finds documents by tag and by description", () => {
    expect(engine().search("security")[0]?.doc.id).toBe("/guides/auth/");
    expect(engine().search("authenticate")[0]?.doc.id).toBe("/guides/auth/");
  });
  it("ranks title matches above heading matches above body matches", () => {
    // "install": title of /start/install/, body of /guides/auth/ ("Installation of a token store")
    expect(engine().search("install").map((h) => h.doc.id)).toEqual(["/start/install/", "/guides/auth/"]);
    // "authentication": title of auth, body of reference/api
    expect(engine().search("authentication").map((h) => h.doc.id)).toEqual(["/guides/auth/", "/reference/api/"]);
    // "tokens": heading of auth (5x) beats body-only match
    const t = engine().search("tokens");
    expect(t[0]?.doc.id).toBe("/guides/auth/");
  });
  it("matches prefixes while typing and requires every term", () => {
    expect(engine().search("instal")[0]?.doc.id).toBe("/start/install/");
    expect(engine().search("api tok").map((h) => h.doc.id)).toEqual(["/guides/auth/"]);
    expect(engine().search("api zzzz")).toEqual([]);
  });
  it("splits identifiers so their parts are searchable", () => {
    expect(engine().search("acme_region")[0]?.doc.id).toBe("/guides/deploy/");
    expect(engine().search("config")[0]?.doc.id).toBe("/guides/deploy/");
    expect(engine().search("json")[0]?.doc.id).toBe("/guides/deploy/");
  });
  it("is case-insensitive", () => {
    expect(engine().search("NODE")[0]?.doc.id).toBe("/start/install/");
  });
  it("handles Unicode: diacritics fold both ways, non-Latin tokens are found", () => {
    expect(engine().search("cafe")[0]?.doc.id).toBe("/guides/deploy/");
    expect(engine().search("Café")[0]?.doc.id).toBe("/guides/deploy/");
    expect(engine().search("naive")[0]?.doc.id).toBe("/guides/deploy/");
    expect(engine().search("naïve")[0]?.doc.id).toBe("/guides/deploy/");
    expect(engine().search("日本語")[0]?.doc.id).toBe("/guides/deploy/");
  });
  it("returns nothing for empty, blank or punctuation-only queries", () => {
    for (const q of ["", "   ", "???", "---"]) expect(engine().search(q)).toEqual([]);
  });
  it("never throws on hostile query syntax", () => {
    for (const q of ["title:install", "install~2", "+install -auth", "inst*", "^10", "title:", '"', "a:b:c", "(", "\u0000", "💥"]) {
      expect(() => engine().search(q)).not.toThrow();
    }
    // field syntax is not interpreted: "title" and "install" are two ordinary terms (both must match)
    expect(engine().search("title:install")).toEqual([]);
    expect(engine().search("install: ")[0]?.doc.id).toBe("/start/install/");
  });
  it("returns correct, route-based result URLs and honours the limit", () => {
    const hits = engine().search("a", 2);
    expect(hits.length).toBeLessThanOrEqual(2);
    for (const h of engine().search("api")) expect(h.doc.id).toMatch(/^\/[a-z/-]*\/$/);
  });
});

describe("excerpts and highlighting", () => {
  it("highlights matches as segments, never as HTML", () => {
    const segs = highlight("Install <b>the</b> thing", ["install", "the"]);
    expect(segs.filter((s) => s.match).map((s) => s.text)).toEqual(["Install", "the"]);
    expect(segs.map((s) => s.text).join("")).toBe("Install <b>the</b> thing"); // text preserved verbatim
  });
  it("highlights diacritic variants at the right offsets", () => {
    const segs = highlight("A Café au lait", ["cafe"]);
    expect(segs.find((s) => s.match)?.text).toBe("Café");
    expect(highlight("naive", ["naïve"].map(normalizeTerm)).find((s) => s.match)?.text).toBe("naive");
  });
  it("only matches at the start of a word", () => {
    expect(findMatches("cousins and ins", ["ins"])).toEqual([[12, 15]]);
  });
  it("handles astral characters and merges overlaps", () => {
    const text = "😀 emoji test 😀 testing";
    const segs = highlight(text, ["test", "testing"]);
    expect(segs.map((s) => s.text).join("")).toBe(text);
    expect(segs.filter((s) => s.match).map((s) => s.text)).toEqual(["test", "testing"]);
  });
  it("creates a windowed excerpt with ellipses around the densest matches", () => {
    const text = `${"lorem ipsum ".repeat(40)}needle haystack${" dolor sit".repeat(40)}`;
    const segs = makeExcerpt(text, ["needle", "haystack"], 100);
    const joined = segs.map((s) => s.text).join("");
    expect(joined.startsWith("… ")).toBe(true);
    expect(joined.endsWith(" …")).toBe(true);
    expect(segs.filter((s) => s.match).map((s) => s.text)).toEqual(["needle", "haystack"]);
    expect(joined.length).toBeLessThan(140);
  });
  it("falls back to the start of the text when nothing matches, and handles empty text", () => {
    expect(makeExcerpt("short text", ["zzz"]).map((s) => s.text).join("")).toBe("short text");
    expect(makeExcerpt("", ["a"])).toEqual([]);
  });
  it("search hits carry highlighted title and excerpt segments", () => {
    const hit = engine().search("proxy")[0]!;
    expect(hit.excerpt.some((s) => s.match && s.text.toLowerCase() === "proxy")).toBe(true);
    expect(engine().search("deployment")[0]!.title.some((s) => s.match)).toBe(true);
  });
});

describe("index file", () => {
  it("is deterministic regardless of document order", () => {
    expect(JSON.stringify(buildSearchIndex([...DOCS].reverse()))).toBe(JSON.stringify(buildSearchIndex(DOCS)));
  });
  it("contains no HTML and no local paths", () => {
    const json = JSON.stringify(buildSearchIndex(DOCS));
    expect(json).not.toMatch(/<[a-z!/]/i);
    expect(json).not.toMatch(/\/home\/|\/tmp\/|\/Users\/|C:\\\\/);
  });
  it("caps stored text but still indexes it", () => {
    const long = `${"filler ".repeat(MAX_STORED_TEXT / 5)}uniquetailword`;
    const file = buildSearchIndex([doc({ id: "/long/", title: "Long", text: long })]);
    expect(file.docs[0]!.text.length).toBeLessThanOrEqual(MAX_STORED_TEXT);
    expect(createSearchEngine(JSON.parse(JSON.stringify(file))).search("uniquetailword")[0]?.doc.id).toBe("/long/");
  });
  it("round-trips through JSON", () => {
    const e = createSearchEngine(JSON.parse(JSON.stringify(buildSearchIndex(DOCS))));
    expect(e.size).toBe(4);
  });
  it("handles an empty site", () => {
    const e = createSearchEngine(JSON.parse(JSON.stringify(buildSearchIndex([]))));
    expect(e.size).toBe(0);
    expect(e.search("anything")).toEqual([]);
  });
});

describe("invalid index handling", () => {
  const good = JSON.parse(JSON.stringify(buildSearchIndex(DOCS)));
  it.each([
    ["null", null],
    ["a string", "nope"],
    ["an array", []],
    ["wrong version", { ...good, version: 99 }],
    ["missing version", { index: good.index, docs: good.docs }],
    ["missing index", { version: 1, docs: good.docs }],
    ["index not an object", { ...good, index: "x" }],
    ["missing docs", { version: 1, index: good.index }],
    ["docs not an array", { ...good, docs: {} }],
    ["malformed doc", { ...good, docs: [{ id: 5 }] }],
    ["doc without text", { ...good, docs: [{ id: "/a/", title: "A" }] }],
  ])("rejects %s with InvalidIndexError", (_name, value) => {
    expect(() => createSearchEngine(value)).toThrow(InvalidIndexError);
  });
  it("rejects an index whose Lunr part is corrupt", () => {
    // built by a different Lunr version
    expect(() => createSearchEngine({ ...good, index: { ...good.index, version: "9.9.9" } })).toThrow(/rebuild the site/);
    // references a pipeline function this site does not register
    expect(() => createSearchEngine({ ...good, index: { ...good.index, pipeline: ["unregistered-fn"] } })).toThrow(InvalidIndexError);
    // structurally broken
    expect(() => createSearchEngine({ ...good, index: { version: good.index.version } })).toThrow(InvalidIndexError);
  });
  it("tolerates missing optional doc fields", () => {
    const f = parseSearchIndex({ ...good, docs: [{ id: "/a/", title: "A", text: "t" }] });
    expect(f.docs[0]).toMatchObject({ tags: [], headings: [] });
  });
});

describe("page/search consistency", () => {
  it("extracts the same visible text that the page shows (no markup, chrome or anchors)", async () => {
    const render = createRenderer({ rawHtml: "sanitize", syntaxHighlighting: true, basePath: "/", strictLinks: false });
    const out = await render(
      "# Title\n\nFirst **bold** paragraph with `code` and [a link](https://example.com).\n\n- one\n- two\n\n## Section\n\n```bash\nnpm install acme\n```\n\n<script>alert(1)</script>\n\n| a | b |\n|---|---|\n| x | y |\n",
      { relPath: "a.md", index: { docsByPath: new Map(), routes: new Set(), draftPaths: new Set() }, assets: { reference: async (p: string) => p } as never, diags: new Diagnostics(), anchorRefs: [] },
    );
    expect(out.text).toContain("First bold paragraph with code and a link.");
    expect(out.text).toContain("one two");
    expect(out.text).toContain("npm install acme");
    expect(out.text).toContain("a b x y");
    expect(out.text).not.toMatch(/alert|Copy|<|>/);
    expect(out.text).not.toContain("#"); // heading anchor glyph is not content
    expect(out.text.startsWith("Title First bold")).toBe(true);
    expect(out.text).toContain("Section npm install acme");
  });
});

describe("shared module hygiene", () => {
  it("analyzer, engine, excerpt and types are browser-safe (no Node imports)", () => {
    for (const f of ["analyzer", "engine", "excerpt", "types"]) {
      const src = readFileSync(path.resolve(import.meta.dirname, `../../packages/cli/src/search/${f}.ts`), "utf8");
      expect(src, f).not.toMatch(/from "node:|require\(|from "fs"|from "path"/);
    }
  });
});
