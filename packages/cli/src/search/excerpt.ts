import { foldDiacritics } from "./analyzer.js";

export interface Segment {
  text: string;
  match: boolean;
}

interface Folded {
  text: string;
  /** For each UTF-16 unit of `text`, the offset of the original character it came from. */
  map: number[];
  /** Length (in UTF-16 units) of the original character at each original offset. */
}

/** Lowercase + diacritic-fold while remembering where each unit came from in the original. */
function foldWithMap(original: string): Folded {
  let text = "";
  const map: number[] = [];
  let i = 0;
  for (const ch of original) {
    const f = foldDiacritics(ch).toLowerCase();
    for (let k = 0; k < f.length; k++) map.push(i);
    text += f;
    i += ch.length;
  }
  return { text, map };
}

const WORD_CHAR = /[\p{L}\p{N}]/u;

/** Character ranges `[start, end)` in `original` where a term starts a word. */
export function findMatches(original: string, terms: readonly string[]): [number, number][] {
  if (terms.length === 0 || original === "") return [];
  const { text, map } = foldWithMap(original);
  const ranges: [number, number][] = [];
  for (const term of terms) {
    let from = 0;
    while (true) {
      const at = text.indexOf(term, from);
      if (at === -1) break;
      from = at + 1;
      const prev = at === 0 ? "" : (text[at - 1] as string);
      if (prev !== "" && WORD_CHAR.test(prev)) continue; // only match at the start of a word
      const start = map[at] as number;
      const lastUnit = map[at + term.length - 1] as number;
      const lastCp = original.codePointAt(lastUnit) ?? 0;
      ranges.push([start, lastUnit + (lastCp > 0xffff ? 2 : 1)]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

/** Split `text` into plain/match segments. Rendered as text nodes + <mark>, never as HTML. */
export function highlight(text: string, terms: readonly string[]): Segment[] {
  const ranges = findMatches(text, terms);
  if (ranges.length === 0) return [{ text, match: false }];
  const out: Segment[] = [];
  let pos = 0;
  for (const [s, e] of ranges) {
    if (s > pos) out.push({ text: text.slice(pos, s), match: false });
    out.push({ text: text.slice(s, e), match: true });
    pos = e;
  }
  if (pos < text.length) out.push({ text: text.slice(pos), match: false });
  return out;
}

/**
 * A short snippet of `text` around the densest cluster of matches, highlighted.
 * Falls back to the start of the text when nothing matches.
 */
export function makeExcerpt(text: string, terms: readonly string[], width = 160): Segment[] {
  if (text === "") return [];
  const ranges = findMatches(text, terms);
  let start = 0;
  if (ranges.length > 0) {
    // choose the window (anchored at a match) containing the most matches
    let best = ranges[0] as [number, number];
    let bestCount = 0;
    for (const r of ranges) {
      const count = ranges.filter((o) => o[0] >= r[0] && o[1] <= r[0] + width).length;
      if (count > bestCount) {
        bestCount = count;
        best = r;
      }
    }
    start = Math.max(0, best[0] - Math.floor(width / 4));
  }
  let end = Math.min(text.length, start + width);
  if (start > 0) {
    const sp = text.indexOf(" ", start);
    if (sp !== -1 && sp < start + 20) start = sp + 1;
  }
  if (end < text.length) {
    const sp = text.lastIndexOf(" ", end);
    if (sp > start + width / 2) end = sp;
  }
  const slice = text.slice(start, end).trim();
  const segs = highlight(slice, terms);
  if (start > 0) segs.unshift({ text: "… ", match: false });
  if (end < text.length) segs.push({ text: " …", match: false });
  return segs;
}
