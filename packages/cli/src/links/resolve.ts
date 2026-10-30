import path from "node:path";
import { slugifySegment } from "../navigation/routes.js";

/** What the resolver needs to know about the site. */
export interface LinkIndex {
  /** Source-relative path of every published document -> its route. */
  docsByPath: ReadonlyMap<string, string>;
  /** Every valid page route (documents plus generated landing pages). */
  routes: ReadonlySet<string>;
  /** Source-relative paths of documents excluded as drafts. */
  draftPaths: ReadonlySet<string>;
}

export type LinkResolution =
  | { kind: "anchor"; hash: string }
  | { kind: "external"; href: string }
  | { kind: "page"; route: string; query: string; hash: string }
  | { kind: "file"; relPath: string; query: string; hash: string }
  | { kind: "error"; code: "malformed" | "outside-root" | "missing-page" | "draft-target" | "unsupported-scheme"; message: string };

const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const SAFE_EXTERNAL = new Set(["http:", "https:", "mailto:", "tel:"]);
const MARKDOWN_EXT = /\.(md|markdown)$/i;

export function splitHref(href: string): { pathPart: string; query: string; hash: string } {
  const hashAt = href.indexOf("#");
  const beforeHash = hashAt === -1 ? href : href.slice(0, hashAt);
  const hash = hashAt === -1 ? "" : href.slice(hashAt);
  const queryAt = beforeHash.indexOf("?");
  return {
    pathPart: queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt),
    query: queryAt === -1 ? "" : beforeHash.slice(queryAt),
    hash,
  };
}

/**
 * Join a link path onto the linking document's directory, entirely in
 * POSIX source-relative space. Returns `undefined` if it escapes the source root.
 */
export function joinWithinRoot(fromRelPath: string, linkPath: string): string | undefined {
  const base = linkPath.startsWith("/") ? "" : path.posix.dirname(fromRelPath);
  const joined = path.posix.normalize(path.posix.join(base === "." ? "" : base, linkPath.replace(/^\/+/, "")));
  if (joined === ".." || joined.startsWith("../") || path.posix.isAbsolute(joined)) return undefined;
  return joined === "." ? "" : joined;
}

/** Route for a directory-style path (`guides/`, `guides`, ``). */
function dirRoute(p: string): string {
  const segs = p.split("/").filter(Boolean).map(slugifySegment);
  return segs.length === 0 ? "/" : `/${segs.join("/")}/`;
}

/**
 * Classify and resolve one `href`/`src` value found in a document.
 * Pure: no filesystem access (asset existence is checked by the caller).
 */
export function resolveLink(rawHref: string, fromRelPath: string, index: LinkIndex): LinkResolution {
  const href = rawHref.trim();
  if (href === "") return { kind: "error", code: "malformed", message: "empty link target" };
  if (href.startsWith("#")) return { kind: "anchor", hash: href };

  if (SCHEME_RE.test(href)) {
    const scheme = href.slice(0, href.indexOf(":") + 1).toLowerCase();
    if (SAFE_EXTERNAL.has(scheme)) return { kind: "external", href };
    return { kind: "error", code: "unsupported-scheme", message: `unsupported link scheme "${scheme}"` };
  }
  if (href.startsWith("//")) return { kind: "external", href };

  const { pathPart, query, hash } = splitHref(href);
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathPart);
  } catch {
    return { kind: "error", code: "malformed", message: `malformed URL encoding in "${href}"` };
  }
  if (decoded.includes("\0") || decoded.includes("\\")) {
    return { kind: "error", code: "malformed", message: `invalid characters in "${href}"` };
  }

  // Link with only a query/hash change to the same document, e.g. "?x=1#y".
  if (decoded === "") {
    const own = index.docsByPath.get(fromRelPath);
    return own ? { kind: "page", route: own, query, hash } : { kind: "error", code: "malformed", message: `empty path in "${href}"` };
  }

  const target = joinWithinRoot(fromRelPath, decoded);
  if (target === undefined) {
    return { kind: "error", code: "outside-root", message: `"${href}" points outside the documentation source directory` };
  }

  const wantsDir = decoded.endsWith("/") || target === "";

  if (!wantsDir) {
    // 1. exact document
    const exact = index.docsByPath.get(target);
    if (exact) return { kind: "page", route: exact, query, hash };
    if (index.draftPaths.has(target)) {
      return { kind: "error", code: "draft-target", message: `"${href}" links to a draft document that is excluded from this build` };
    }
    // 2. extension-less shorthand: ./installation, ./guides
    if (!MARKDOWN_EXT.test(target) && !path.posix.extname(target)) {
      for (const candidate of [`${target}.md`, `${target}.markdown`, `${target}/index.md`, `${target}/index.markdown`]) {
        const route = index.docsByPath.get(candidate);
        if (route) return { kind: "page", route, query, hash };
      }
      const dr = dirRoute(target);
      if (index.routes.has(dr)) return { kind: "page", route: dr, query, hash };
    }
    // 3. Markdown that isn't a known document -> missing page
    if (MARKDOWN_EXT.test(target)) {
      return { kind: "error", code: "missing-page", message: `"${href}" does not match any document` };
    }
    // 4. anything else is treated as a file/asset reference
    return { kind: "file", relPath: target, query, hash };
  }

  const route = dirRoute(target);
  if (index.routes.has(route)) return { kind: "page", route, query, hash };
  return { kind: "error", code: "missing-page", message: `"${href}" does not match any page` };
}

/** Build the final URL for a page route under a base path. */
export function pageUrl(basePath: string, route: string, query = "", hash = ""): string {
  const encoded = route
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  return `${basePath}${encoded.replace(/^\//, "")}${query}${hash}`;
}

/** Build the final URL for a copied file under a base path. */
export function fileUrl(basePath: string, outRelPath: string, query = "", hash = ""): string {
  const encoded = outRelPath
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  return `${basePath}${encoded}${query}${hash}`;
}
