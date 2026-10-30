import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildNavTree, collectRoutes, flattenNav, renderTreeText, type NavNode } from "../../packages/cli/src/navigation/tree.js";
import { routeForPath, slugifySegment } from "../../packages/cli/src/navigation/routes.js";
import { discoverDir } from "../helpers/pipeline.js";
import { makeTree } from "../helpers/tmp.js";

const labels = (nodes: NavNode[]): string[] => nodes.map((n) => n.label);

describe("routes", () => {
  it("maps files to directory-style routes", () => {
    expect(routeForPath("index.md")).toMatchObject({ route: "/", outputPath: "index.html", isIndex: true });
    expect(routeForPath("a/index.md")).toMatchObject({ route: "/a/", outputPath: "a/index.html", isIndex: true });
    expect(routeForPath("a/b/c.markdown")).toMatchObject({ route: "/a/b/c/", outputPath: "a/b/c/index.html" });
    expect(routeForPath("Guides/INDEX.MD").route).toBe("/guides/");
  });

  it("slugifies safely and keeps unicode", () => {
    expect(slugifySegment("My Page (v2)!")).toBe("my-page-v2");
    expect(slugifySegment("Ünïcode 日本語")).toBe("ünïcode-日本語");
    expect(slugifySegment("..")).toBe("untitled");
    // ".." can only ever appear inside a longer segment, never as a segment of its own
    expect(slugifySegment("a/../b")).toBe("a-..-b");
  });

  it("never produces a route containing .. segments or backslashes", () => {
    for (const name of ["..md", "a\\..\\b.md", "%2e%2e.md", "x/..y.md"]) {
      const { route, outputPath } = routeForPath(name);
      expect(route.split("/")).not.toContain("..");
      expect(outputPath.split("/")).not.toContain("..");
      expect(route).not.toContain("\\");
    }
  });
});

describe("navigation tree", () => {
  it("mirrors the directory structure from the spec example", async () => {
    const dir = await makeTree({
      "index.md": "# Home",
      "getting-started/index.md": "---\ntitle: Getting Started\n---\n",
      "getting-started/installation.md": "---\norder: 1\n---\n# Installation",
      "getting-started/configuration.md": "---\norder: 2\n---\n# Configuration",
      "guides/authentication.md": "# Authentication",
      "guides/deployment.md": "# Deployment",
      "reference/api.md": "# API",
      "reference/cli.md": "# CLI",
    });
    const { tree } = await discoverDir(dir);
    expect(tree.home).toMatchObject({ route: "/", label: "Home", landing: "document" });
    expect(labels(tree.items)).toEqual(["Getting Started", "Guides", "Reference"]);
    const [gs, guides, ref] = tree.items as [any, any, any];
    expect(gs).toMatchObject({ type: "group", route: "/getting-started/", landing: "document" });
    expect(labels(gs.children)).toEqual(["Installation", "Configuration"]);
    expect(guides).toMatchObject({ landing: "generated", route: "/guides/" });
    expect(labels(guides.children)).toEqual(["Authentication", "Deployment"]);
    expect(labels(ref.children)).toEqual(["API", "CLI"]);
  });

  it("derives navigation from real files, not hardcoded pages", async () => {
    const dir = await makeTree({ "zebra/stripes.md": "# Stripes" });
    const { tree } = await discoverDir(dir);
    expect(renderTreeText(tree)).toContain("Zebra");
    expect(renderTreeText(tree)).not.toContain("Getting Started");
  });

  it("labels groups by index sidebar_label, then front matter title, then folder name", async () => {
    const dir = await makeTree({
      "a/index.md": "---\nsidebar_label: Alpha Label\ntitle: Alpha Title\n---\n",
      "b/index.md": "---\ntitle: Beta Title\n---\n",
      "c/index.md": "# Heading only\n",
      "d_e-f/page.md": "# P",
    });
    const { tree } = await discoverDir(dir);
    expect(labels(tree.items)).toEqual(["Alpha Label", "Beta Title", "C", "D E F"]);
  });

  it("uses sidebar_label for pages and Home", async () => {
    const dir = await makeTree({ "index.md": "---\nsidebar_label: Start\n---\n", "p.md": "---\ntitle: Long Title\nsidebar_label: Short\n---\n" });
    const { tree } = await discoverDir(dir);
    expect(tree.home.label).toBe("Start");
    expect(labels(tree.items)).toEqual(["Short"]);
  });

  it("sorts by order first, then alphabetically; unordered items come last", async () => {
    const dir = await makeTree({
      "zeta.md": "---\norder: 1\n---\n",
      "alpha.md": "# Alpha",
      "beta.md": "# Beta",
      "mid.md": "---\norder: 2\n---\n# Mid",
      "also-first.md": "---\norder: 1\n---\n# Also First",
    });
    const { tree } = await discoverDir(dir);
    expect(labels(tree.items)).toEqual(["Also First", "Zeta", "Mid", "Alpha", "Beta"]);
  });

  it("supports numeric-aware title sorting and filename sorting modes", async () => {
    const dir = await makeTree({
      "p10.md": "---\ntitle: Zed\norder: 1\n---\n",
      "p2.md": "---\ntitle: Alpha\norder: 2\n---\n",
    });
    expect(labels((await discoverDir(dir, { navigation: { sort: "title" } })).tree.items)).toEqual(["Alpha", "Zed"]);
    expect(labels((await discoverDir(dir, { navigation: { sort: "filename" } })).tree.items)).toEqual(["Alpha", "Zed"]); // p2 < p10
    expect(labels((await discoverDir(dir)).tree.items)).toEqual(["Zed", "Alpha"]);
  });

  it("treats `name.md` beside a `name/` folder as that folder's landing page", async () => {
    const dir = await makeTree({ "guides.md": "---\ntitle: Guides Overview\n---\n", "guides/one.md": "# One", "plain.md": "# Plain" });
    const { tree } = await discoverDir(dir);
    const guides = tree.items.find((n) => n.route === "/guides/");
    expect(guides).toMatchObject({ type: "group", landing: "document", title: "Guides Overview" });
    expect(tree.items.filter((n) => n.route === "/guides/")).toHaveLength(1);
  });

  it("builds deeply nested groups with generated intermediate landings", async () => {
    const dir = await makeTree({ "a/b/c/d.md": "# D" });
    const { tree } = await discoverDir(dir);
    const a = tree.items[0] as any;
    expect(a).toMatchObject({ route: "/a/", landing: "generated" });
    expect(a.children[0]).toMatchObject({ route: "/a/b/", landing: "generated" });
    expect(a.children[0].children[0].children[0]).toMatchObject({ type: "page", route: "/a/b/c/d/" });
  });

  it("generates a home page when there is no root index", async () => {
    const dir = await makeTree({ "a.md": "# A" });
    expect((await discoverDir(dir, { title: "My Docs" })).tree.home).toMatchObject({ landing: "generated", title: "My Docs" });
  });

  it("only contains routes that belong to real documents or directories", async () => {
    const dir = await makeTree({
      "index.md": "---\nlink: https://evil.example\nroute: /../../etc\n---\n",
      "a/b.md": "---\nextra: /somewhere-else/\n---\n# B",
      "x/index.md": "# X",
    });
    const { tree, documents } = await discoverDir(dir);
    const allowed = new Set(["/", "/a/", ...documents.map((d) => d.route)]);
    for (const route of collectRoutes(tree)) expect(allowed.has(route)).toBe(true);
  });

  it("flattens to a stable reading order", async () => {
    const dir = await makeTree({ "index.md": "#h", "a/index.md": "# A", "a/one.md": "# One", "b.md": "# B" });
    const { tree } = await discoverDir(dir, { navigation: { sort: "title" } });
    expect(flattenNav(tree).map((i) => i.route)).toEqual(["/", "/a/", "/a/one/", "/b/"]);
  });

  it("is independent of the input order of documents", async () => {
    const dir = await makeTree({ "b/x.md": "# X", "a/y.md": "# Y", "c.md": "# C" });
    const { documents } = await discoverDir(dir);
    const forward = buildNavTree(documents, "order-then-title", "T");
    const reversed = buildNavTree([...documents].reverse(), "order-then-title", "T");
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward));
  });

  it("does not leak filesystem paths into the tree", async () => {
    const dir = await makeTree({ "a/b.md": "# B" });
    const { tree } = await discoverDir(dir);
    expect(JSON.stringify(tree)).not.toContain(path.dirname(dir));
  });
});
