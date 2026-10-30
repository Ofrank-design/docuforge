import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import type { Diagnostics } from "../util/diagnostics.js";
import { mapLimit } from "../util/concurrency.js";
import { compareStrings } from "../util/text.js";
import type { ScannedFile } from "../scanner/scan.js";
import { routeForPath, titleFromPath, type RouteInfo } from "../navigation/routes.js";
import { parseFrontMatter, type JsonValue } from "./frontmatter.js";
import { extractFirstHeading } from "./title.js";

export type TitleSource = "frontmatter" | "heading" | "filename";

/** Everything known about a document except its body (kept out of memory on purpose). */
export interface DocumentMeta extends RouteInfo {
  /** Stable ID; equal to the normalized route. */
  id: string;
  /** Forward-slash path relative to the source root. */
  relPath: string;
  title: string;
  titleSource: TitleSource;
  description?: string;
  order?: number;
  sidebarLabel?: string;
  tags: string[];
  draft: boolean;
  extra: Record<string, JsonValue>;
  size: number;
}

export interface LoadOptions {
  strictFrontMatter: boolean;
  includeDrafts: boolean;
  concurrency: number;
  maxFileSizeBytes: number;
}

export class SourceReadError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Read a source file safely: refuses symlinks (O_NOFOLLOW where the platform
 * supports it) and re-checks the size limit on the opened handle.
 */
export async function readSourceFile(absPath: string, maxBytes: number): Promise<string> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(absPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const st = await handle.stat();
    if (!st.isFile()) throw new SourceReadError("ENOTFILE", "not a regular file");
    if (st.size > maxBytes) throw new SourceReadError("ETOOBIG", `file is ${st.size} bytes, over the ${maxBytes}-byte limit`);
    return await handle.readFile("utf8");
  } catch (err) {
    if (err instanceof SourceReadError) throw err;
    const code = (err as NodeJS.ErrnoException).code ?? "UNKNOWN";
    throw new SourceReadError(code, code === "ELOOP" ? "file is a symlink" : `cannot read file (${code})`);
  } finally {
    await handle?.close();
  }
}

export interface RouteCollision {
  route: string;
  kept: string;
  dropped: string;
}

/**
 * Assign routes and detect duplicates. When two files map to the same route
 * (`a.md` + `a/index.md`, `Guide.md` + `guide.md`, `x.md` + `x.markdown`) the
 * first by path order is kept and the rest are reported.
 */
export function assignRoutes(files: readonly ScannedFile[]): {
  entries: { file: ScannedFile; info: RouteInfo }[];
  collisions: RouteCollision[];
} {
  const byRoute = new Map<string, ScannedFile>();
  const entries: { file: ScannedFile; info: RouteInfo }[] = [];
  const collisions: RouteCollision[] = [];
  for (const file of [...files].sort((a, b) => compareStrings(a.relPath, b.relPath))) {
    const info = routeForPath(file.relPath);
    const existing = byRoute.get(info.route);
    if (existing) {
      collisions.push({ route: info.route, kept: existing.relPath, dropped: file.relPath });
      continue;
    }
    byRoute.set(info.route, file);
    entries.push({ file, info });
  }
  return { entries, collisions };
}

export interface LoadResult {
  /** Published documents, sorted by source path. */
  documents: DocumentMeta[];
  /** Source paths excluded because `draft: true`. */
  excludedDrafts: string[];
}

/** Load metadata for every scanned file with bounded concurrency. */
export async function loadDocuments(
  files: readonly ScannedFile[],
  opts: LoadOptions,
  diags: Diagnostics,
): Promise<LoadResult> {
  const { entries, collisions } = assignRoutes(files);
  for (const c of collisions) {
    diags.error(
      "route.duplicate",
      `Route ${c.route} is already produced by "${c.kept}"; this file would overwrite it and was skipped.`,
      c.dropped,
    );
  }

  const loaded = await mapLimit(entries, opts.concurrency, async ({ file, info }) => {
    let raw: string;
    try {
      raw = await readSourceFile(file.absPath, opts.maxFileSizeBytes);
    } catch (err) {
      const e = err as SourceReadError;
      diags.warn("document.unreadable", `Cannot read document (${e.message}); skipping it.`, file.relPath);
      return undefined;
    }

    const parsed = parseFrontMatter(raw);
    for (const issue of parsed.issues) {
      diags.report(opts.strictFrontMatter, issue.code, issue.message, file.relPath);
    }

    let title = parsed.meta.title;
    let titleSource: TitleSource = "frontmatter";
    if (title === undefined) {
      const heading = extractFirstHeading(parsed.body);
      if (heading !== undefined) {
        title = heading;
        titleSource = "heading";
      } else {
        title = titleFromPath(info);
        titleSource = "filename";
      }
    }

    const doc: DocumentMeta = {
      ...info,
      id: info.route,
      relPath: file.relPath,
      title,
      titleSource,
      tags: parsed.meta.tags,
      draft: parsed.meta.draft,
      extra: parsed.meta.extra,
      size: file.size,
      ...(parsed.meta.description !== undefined ? { description: parsed.meta.description } : {}),
      ...(parsed.meta.order !== undefined ? { order: parsed.meta.order } : {}),
      ...(parsed.meta.sidebarLabel !== undefined ? { sidebarLabel: parsed.meta.sidebarLabel } : {}),
    };
    return doc;
  });

  const documents: DocumentMeta[] = [];
  const excludedDrafts: string[] = [];
  for (const doc of loaded) {
    if (!doc) continue;
    if (doc.draft && !opts.includeDrafts) excludedDrafts.push(doc.relPath);
    else documents.push(doc);
  }
  return { documents, excludedDrafts };
}
