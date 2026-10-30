/** `getting-started` / `api_reference` -> `Getting Started` / `Api Reference`. */
export function humanize(name: string): string {
  const words = name
    .normalize("NFC")
    .replace(/[-_]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return name;
  return words
    .map((w) => (/\p{Lu}/u.test(w) ? w : w.charAt(0).toLocaleUpperCase("en") + w.slice(1)))
    .join(" ");
}

/** Deterministic, locale-independent-enough collator used for all sorting. */
export const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/** Plain codepoint comparison for stable ordering of paths. */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** `plural(1, "page")` is "1 page", `plural(3, "page")` is "3 pages", `plural(2, "entry", "entries")` is "2 entries". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** `["a"]` is "a", `["a", "b"]` is "a and b", `["a", "b", "c"]` is "a, b and c". */
export function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1] as string}`;
}

/** 42 -> "42 ms", 1250 -> "1.3 s". */
export function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}
