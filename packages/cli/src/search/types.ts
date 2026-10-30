/**
 * Search index file format (`search-index.json`).
 * Shared by the CLI (writer) and the browser bundle (reader): keep it free of Node APIs.
 */

export const SEARCH_INDEX_VERSION = 1;

export interface SearchHeading {
  depth: number;
  id: string;
  text: string;
}

export interface SearchDoc {
  /** Normalized route, e.g. `/guides/auth/`. Also the Lunr reference. */
  id: string;
  title: string;
  description?: string;
  tags: string[];
  headings: SearchHeading[];
  /** Plain visible text (no HTML), capped so the index stays compact. */
  text: string;
}

export interface SearchIndexFile {
  version: typeof SEARCH_INDEX_VERSION;
  /** Serialized Lunr index (opaque to everything except Lunr). */
  index: Record<string, unknown>;
  docs: SearchDoc[];
}

export class InvalidIndexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidIndexError";
  }
}
