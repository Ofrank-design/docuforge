import { configurePipeline, lunr } from "./analyzer.js";
import { SEARCH_INDEX_VERSION, type SearchDoc, type SearchIndexFile } from "./types.js";

/** Text kept in the file for excerpts. The full text (up to MAX_INDEXED_TEXT) is still searchable. */
export const MAX_STORED_TEXT = 20_000;
export const MAX_INDEXED_TEXT = 200_000;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return sp > max * 0.8 ? cut.slice(0, sp) : cut;
}

/**
 * Build the Lunr index for the site. Fields and boosts (relevance):
 * title (10) > headings (5) > tags (4) > description (3) > body (1).
 * Output is deterministic: documents are sorted by route first.
 */
export function buildSearchIndex(docs: readonly SearchDoc[]): SearchIndexFile {
  const sorted = [...docs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const index = lunr(function () {
    configurePipeline(this);
    this.ref("id");
    this.field("title", { boost: 10 });
    this.field("headings", { boost: 5 });
    this.field("tags", { boost: 4 });
    this.field("description", { boost: 3 });
    this.field("body");
    for (const d of sorted) {
      this.add({
        id: d.id,
        title: d.title,
        headings: d.headings.map((h) => h.text).join(" "),
        tags: d.tags.join(" "),
        description: d.description ?? "",
        body: truncate(d.text, MAX_INDEXED_TEXT),
      });
    }
  });
  return {
    version: SEARCH_INDEX_VERSION,
    index: index.toJSON() as unknown as Record<string, unknown>,
    docs: sorted.map((d) => ({ ...d, text: truncate(d.text, MAX_STORED_TEXT) })),
  };
}
