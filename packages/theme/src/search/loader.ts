import type { SearchEngine } from "../../../cli/src/search/engine";

let cached: Promise<SearchEngine> | undefined;

/**
 * Download and load the search index once. The index and the search code
 * (Lunr + engine) are fetched in parallel and only when search is first used,
 * so reading pages never pays for them. A failure is not cached, so "Retry" works.
 */
export function loadEngine(base: string): Promise<SearchEngine> {
  cached ??= (async () => {
    const [res, mod] = await Promise.all([fetch(`${base}search-index.json`), import("../../../cli/src/search/engine")]);
    if (!res.ok) throw new Error(`Could not download the search index (HTTP ${res.status}).`);
    return mod.createSearchEngine(await res.json());
  })();
  cached.catch(() => {
    cached = undefined;
  });
  return cached;
}

export function resetEngineCache(): void {
  cached = undefined;
}
