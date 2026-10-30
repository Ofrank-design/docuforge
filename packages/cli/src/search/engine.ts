import { InvalidIndexError, SEARCH_INDEX_VERSION, type SearchDoc, type SearchHeading, type SearchIndexFile } from "./types.js";
import { lunr, queryTerms } from "./analyzer.js";
import { findMatches, makeExcerpt, type Segment } from "./excerpt.js";

export interface SearchHit {
  doc: SearchDoc;
  score: number;
  /** Highlighted title segments. */
  title: Segment[];
  /** Best-matching heading, so the result can deep-link to a section. */
  heading?: SearchHeading & { segments: Segment[] };
  excerpt: Segment[];
}

export interface SearchEngine {
  readonly size: number;
  search(query: string, limit?: number): SearchHit[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";

/**
 * Validate a downloaded index file. Anything unexpected throws `InvalidIndexError`
 * instead of surfacing as a confusing runtime error later.
 */
export function parseSearchIndex(raw: unknown): SearchIndexFile {
  if (!isObj(raw)) throw new InvalidIndexError("search index is not an object");
  if (raw["version"] !== SEARCH_INDEX_VERSION) throw new InvalidIndexError(`unsupported search index version: ${String(raw["version"])}`);
  if (!isObj(raw["index"])) throw new InvalidIndexError("search index is missing its Lunr index");
  const docsRaw = raw["docs"];
  if (!Array.isArray(docsRaw)) throw new InvalidIndexError("search index is missing its documents");
  const docs: SearchDoc[] = docsRaw.map((d, i) => {
    if (!isObj(d) || !isStr(d["id"]) || !isStr(d["title"]) || !isStr(d["text"])) {
      throw new InvalidIndexError(`search document #${i} is malformed`);
    }
    const headings = Array.isArray(d["headings"]) ? d["headings"] : [];
    const tags = Array.isArray(d["tags"]) ? d["tags"] : [];
    return {
      id: d["id"],
      title: d["title"],
      ...(isStr(d["description"]) ? { description: d["description"] } : {}),
      tags: tags.filter(isStr),
      headings: headings.flatMap((h): SearchHeading[] =>
        isObj(h) && isStr(h["id"]) && isStr(h["text"]) && typeof h["depth"] === "number"
          ? [{ id: h["id"], text: h["text"], depth: h["depth"] }]
          : [],
      ),
      text: d["text"],
    };
  });
  return { version: SEARCH_INDEX_VERSION, index: raw["index"], docs };
}

/** Load an index into a ready-to-query engine. Throws `InvalidIndexError` for corrupt data. */
export function createSearchEngine(raw: unknown): SearchEngine {
  const file = parseSearchIndex(raw);
  // Lunr only logs a warning on a version mismatch; a stale index must fail loudly instead.
  if (file.index["version"] !== lunr.version) {
    throw new InvalidIndexError(
      `search index was built with Lunr ${String(file.index["version"])} but this site uses ${lunr.version}; rebuild the site`,
    );
  }
  let idx: lunr.Index;
  try {
    idx = lunr.Index.load(file.index as never);
  } catch (err) {
    throw new InvalidIndexError(`search index could not be loaded: ${(err as Error).message}`);
  }
  const byId = new Map(file.docs.map((d) => [d.id, d]));

  function bestHeading(doc: SearchDoc, terms: string[]): SearchHit["heading"] {
    let best: SearchHeading | undefined;
    let bestScore = 0;
    for (const h of doc.headings) {
      const matched = terms.filter((t) => findMatches(h.text, [t]).length > 0).length;
      if (matched > bestScore) {
        best = h;
        bestScore = matched;
      }
    }
    if (!best) return undefined;
    const matchedTerms = terms;
    return { ...best, segments: makeExcerpt(best.text, matchedTerms, 120) };
  }

  return {
    size: file.docs.length,
    search(query: string, limit = 10): SearchHit[] {
      const terms = queryTerms(query);
      if (terms.length === 0) return [];
      let results: lunr.Index.Result[];
      try {
        results = idx.query((q) => {
          for (const term of terms) {
            // Every term must match (as a prefix); exact matches add extra weight.
            q.term(term, { wildcard: lunr.Query.wildcard.TRAILING, presence: lunr.Query.presence.REQUIRED, usePipeline: false });
            q.term(term, { boost: 4, usePipeline: false });
          }
        });
      } catch {
        return [];
      }
      const hits: SearchHit[] = [];
      for (const r of results) {
        const doc = byId.get(r.ref);
        if (!doc) continue;
        const heading = bestHeading(doc, terms);
        const bodyMatches = findMatches(doc.text, terms).length > 0;
        const excerptSource = bodyMatches ? doc.text : (doc.description ?? doc.text);
        hits.push({
          doc,
          score: r.score,
          title: makeExcerpt(doc.title, terms, doc.title.length + 1),
          ...(heading ? { heading } : {}),
          excerpt: makeExcerpt(excerptSource, terms),
        });
        if (hits.length >= limit) break;
      }
      return hits;
    },
  };
}
