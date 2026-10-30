import lunr from "lunr";

/**
 * Text analysis shared by index building (Node) and querying (browser).
 * Index and query MUST use the same pipeline, so this module is the single source of truth.
 *
 * Choices (documented in the README):
 * - Unicode-aware: Lunr's default trimmer strips non-ASCII letters, which would make
 *   "日本語" or "ünï" unsearchable, so it is replaced.
 * - Diacritics are folded: "naïve" matches "naive" and vice versa.
 * - No stemming and no stop-word removal: prefix matching ("install" -> "installation")
 *   works predictably for as-you-type search, and code docs use short words meaningfully.
 * - Identifiers split on `_ . / :` etc., so "ACME_REGION" and "acme.config.json" are findable by their parts.
 */

export function foldDiacritics(value: string): string {
  return value.normalize("NFD").replace(/\p{M}+/gu, "").normalize("NFC");
}

/** Lowercase + fold + strip edge punctuation: the canonical form of one token. */
export function normalizeTerm(value: string): string {
  return foldDiacritics(value.toLowerCase()).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

const trimmerFn = (token: lunr.Token): lunr.Token => token.update((s) => s.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""));
const foldFn = (token: lunr.Token): lunr.Token => token.update((s) => foldDiacritics(s));

// Serialized indexes reference pipeline functions by name; both sides register the same ones.
lunr.Pipeline.registerFunction(trimmerFn, "df-trimmer");
lunr.Pipeline.registerFunction(foldFn, "df-fold");

/** Everything that is not a letter or number separates tokens (a superset of Lunr's default). */
const SEPARATOR = /[^\p{L}\p{N}]+/u;
lunr.tokenizer.separator = SEPARATOR;

export function configurePipeline(builder: lunr.Builder): void {
  builder.pipeline.reset();
  builder.pipeline.add(trimmerFn, foldFn);
  builder.searchPipeline.reset();
  builder.searchPipeline.add(trimmerFn, foldFn);
}

/** Split user input into normalized, de-duplicated search terms. Never throws; empty for blank input. */
export function queryTerms(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(SEPARATOR)) {
    const t = normalizeTerm(raw);
    if (t !== "" && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

export { lunr };
