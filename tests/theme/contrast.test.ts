import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.resolve(import.meta.dirname, "../../packages/theme/src/styles/site.css"), "utf8");

function block(startMarker: string): Record<string, string> {
  const start = css.indexOf(startMarker);
  const open = css.indexOf("{", start);
  let depth = 0;
  let end = open;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) {
      end = i;
      break;
    }
  }
  const vars: Record<string, string> = {};
  for (const m of css.slice(open, end).matchAll(/--df-([a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) vars[m[1]!] = m[2]!;
  return vars;
}

const light = block(":root {");
const dark = block(':root[data-theme="dark"]');
const darkMedia = block(':root:not([data-theme="light"])');

function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
const ratio = (a: string, b: string): number => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};

/** [foreground, background, where it is used] — every pair that carries text. */
const PAIRS: [string, string, string][] = [
  ["fg", "bg", "body text"],
  ["fg", "surface", "sidebar links"],
  ["fg", "code-bg", "code, inline code, table headers"],
  ["fg", "accent-soft", "search result titles / hovered sidebar item"],
  ["muted", "bg", "secondary text, TOC links"],
  ["muted", "surface", "search placeholder, key hints"],
  ["muted", "code-bg", "code block header, blockquotes"],
  ["muted", "accent-soft", "search excerpts on the selected result"],
  ["accent", "bg", "links"],
  ["accent", "surface", "links in the sidebar area"],
  ["accent", "code-bg", "links in blockquotes"],
  ["accent", "accent-soft", "section label in the selected search result"],
  ["accent-fg", "accent", "current page in the sidebar"],
  ["mark-fg", "mark-bg", "search highlight"],
  ["hl-keyword", "code-bg", "code: keywords"],
  ["hl-string", "code-bg", "code: strings"],
  ["hl-comment", "code-bg", "code: comments"],
  ["hl-number", "code-bg", "code: numbers"],
  ["hl-title", "code-bg", "code: names"],
  ["hl-attr", "code-bg", "code: attributes"],
  ["hl-built", "code-bg", "code: built-ins"],
  ["hl-deletion", "code-bg", "code: deletions"],
];

describe("design tokens meet WCAG AA (4.5:1 for text)", () => {
  it("parsed all three token sets", () => {
    for (const set of [light, dark, darkMedia]) expect(Object.keys(set).length).toBeGreaterThanOrEqual(20);
    for (const [fg, bg] of PAIRS) for (const set of [light, dark]) expect(set[fg] && set[bg], `${fg}/${bg} token missing`).toBeTruthy();
  });

  it("the no-JS (media query) dark palette is identical to the data-theme=dark palette", () => {
    expect(darkMedia).toEqual(dark);
  });

  describe.each([["light", light], ["dark", dark]] as const)("%s theme", (_name, tokens) => {
    it.each(PAIRS)("%s on %s (%s)", (fg, bg, use) => {
      const r = ratio(tokens[fg]!, tokens[bg]!);
      expect(r, `${fg} on ${bg} for ${use}: ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    });

    it("borders and focus rings are distinguishable enough from the page (3:1 for the accent focus ring)", () => {
      expect(ratio(tokens["accent"]!, tokens["bg"]!)).toBeGreaterThanOrEqual(3);
      expect(ratio(tokens["accent"]!, tokens["surface"]!)).toBeGreaterThanOrEqual(3);
    });
  });
});
