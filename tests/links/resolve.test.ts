import { describe, expect, it } from "vitest";
import { fileUrl, joinWithinRoot, pageUrl, resolveLink, splitHref, type LinkIndex } from "../../packages/cli/src/links/resolve.js";

const index: LinkIndex = {
  docsByPath: new Map([
    ["index.md", "/"],
    ["guides/auth.md", "/guides/auth/"],
    ["guides/index.md", "/guides/"],
    ["getting-started/install.md", "/getting-started/install/"],
    ["My Page.md", "/my-page/"],
  ]),
  routes: new Set(["/", "/guides/", "/guides/auth/", "/getting-started/", "/getting-started/install/", "/my-page/", "/reference/"]),
  draftPaths: new Set(["drafts/wip.md"]),
};
const r = (href: string, from = "guides/auth.md") => resolveLink(href, from, index);

describe("resolveLink", () => {
  it("resolves sibling, parent and root-absolute Markdown links", () => {
    expect(r("./index.md")).toMatchObject({ kind: "page", route: "/guides/" });
    expect(r("../getting-started/install.md")).toMatchObject({ kind: "page", route: "/getting-started/install/" });
    expect(r("/guides/auth.md")).toMatchObject({ kind: "page", route: "/guides/auth/" });
    expect(r("../index.md")).toMatchObject({ kind: "page", route: "/" });
  });

  it("preserves query strings and fragments", () => {
    expect(r("../getting-started/install.md?x=1#step-2")).toEqual({
      kind: "page", route: "/getting-started/install/", query: "?x=1", hash: "#step-2",
    });
  });

  it("supports extension-less and directory-style links", () => {
    expect(r("../getting-started/install")).toMatchObject({ route: "/getting-started/install/" });
    expect(r("../guides/")).toMatchObject({ route: "/guides/" });
    expect(r("../reference/")).toMatchObject({ kind: "page", route: "/reference/" }); // generated landing
    expect(r("/")).toMatchObject({ route: "/" });
  });

  it("decodes percent-encoded paths (spaces)", () => {
    expect(r("../My%20Page.md")).toMatchObject({ route: "/my-page/" });
  });

  it("classifies anchors and externals", () => {
    expect(r("#env")).toEqual({ kind: "anchor", hash: "#env" });
    expect(r("https://example.com/x")).toMatchObject({ kind: "external" });
    expect(r("mailto:a@b.c")).toMatchObject({ kind: "external" });
    expect(r("tel:+123")).toMatchObject({ kind: "external" });
    expect(r("//cdn.example.com/x")).toMatchObject({ kind: "external" });
  });

  it("rejects unsupported schemes", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "vbscript:x", "file:///etc/passwd", "ftp://x"]) {
      expect(r(bad)).toMatchObject({ kind: "error", code: "unsupported-scheme" });
    }
  });

  it("blocks links that escape the source root", () => {
    expect(r("../../etc/passwd.md")).toMatchObject({ kind: "error", code: "outside-root" });
    expect(r("../../../x.png")).toMatchObject({ kind: "error", code: "outside-root" });
    expect(r("/../../x.md", "a.md")).toMatchObject({ kind: "error", code: "outside-root" });
  });

  it("reports missing pages, draft targets and malformed encodings", () => {
    expect(r("./nope.md")).toMatchObject({ kind: "error", code: "missing-page" });
    expect(r("../drafts/wip.md")).toMatchObject({ kind: "error", code: "draft-target" });
    expect(r("%E0%A4%A.md")).toMatchObject({ kind: "error", code: "malformed" });
    expect(r("a\\b.md")).toMatchObject({ kind: "error", code: "malformed" });
    expect(r("   ")).toMatchObject({ kind: "error", code: "malformed" });
  });

  it("treats other files as asset references, relative to the linking document", () => {
    expect(r("./img/a.png")).toMatchObject({ kind: "file", relPath: "guides/img/a.png" });
    expect(r("../images/b.svg?v=2")).toMatchObject({ kind: "file", relPath: "images/b.svg", query: "?v=2" });
    expect(r("/shared/c.pdf")).toMatchObject({ kind: "file", relPath: "shared/c.pdf" });
  });

  it("handles a query/hash-only change to the same document", () => {
    expect(r("?tab=2#x")).toMatchObject({ kind: "page", route: "/guides/auth/", query: "?tab=2", hash: "#x" });
  });
});

describe("url builders", () => {
  it("prefixes the base path and percent-encodes segments", () => {
    expect(pageUrl("/", "/a/b/")).toBe("/a/b/");
    expect(pageUrl("/docs/", "/a/b/", "?q=1", "#h")).toBe("/docs/a/b/?q=1#h");
    expect(pageUrl("/", "/")).toBe("/");
    expect(pageUrl("/", "/ünï cödé/")).toBe("/%C3%BCn%C3%AF%20c%C3%B6d%C3%A9/");
    expect(fileUrl("/p/", "img/My Pic.png")).toBe("/p/img/My%20Pic.png");
  });
  it("splits href parts", () => {
    expect(splitHref("a/b.md?x=1#y")).toEqual({ pathPart: "a/b.md", query: "?x=1", hash: "#y" });
    expect(splitHref("#only")).toEqual({ pathPart: "", query: "", hash: "#only" });
  });
  it("joinWithinRoot never escapes", () => {
    expect(joinWithinRoot("a/b.md", "../c.md")).toBe("c.md");
    expect(joinWithinRoot("a/b.md", "../../c.md")).toBeUndefined();
    expect(joinWithinRoot("b.md", "/x/../../y")).toBeUndefined();
  });
});
