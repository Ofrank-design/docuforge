import { humanize } from "../util/text.js";

export interface RouteInfo {
  /** Site-relative route with leading and trailing slash, e.g. `/guides/auth/`. */
  route: string;
  /** Output file relative to the output root, e.g. `guides/auth/index.html`. */
  outputPath: string;
  /** True for `index.md` files, which represent their directory. */
  isIndex: boolean;
  /** Slugged directory segments that contain the document. */
  dirSlugs: string[];
  /** Original (unslugged) directory names, used for group labels. */
  dirNames: string[];
  /** Original file stem (no extension). */
  stem: string;
}

const MARKDOWN_EXT = /\.(md|markdown)$/i;

export function isMarkdownFile(name: string): boolean {
  return MARKDOWN_EXT.test(name);
}

/**
 * Turn one path segment into a URL-safe segment: NFC-normalized, lowercase,
 * whitespace to hyphens, anything that is not a letter/number/mark/`._-`
 * collapsed to a hyphen. Unicode letters are preserved.
 */
export function slugifySegment(name: string): string {
  const slug = name
    .normalize("NFC")
    .toLowerCase()
    .replace(/\s+/gu, "-")
    .replace(/[^\p{L}\p{N}\p{M}._-]+/gu, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return slug === "" ? "untitled" : slug;
}

/** Map a posix source-relative path (`guides/Auth Flow.md`) to its route. */
export function routeForPath(relPath: string): RouteInfo {
  const parts = relPath.split("/").filter((p) => p !== "");
  const file = parts.pop() ?? "";
  const stem = file.replace(MARKDOWN_EXT, "");
  const dirNames = parts;
  const dirSlugs = parts.map(slugifySegment);
  const isIndex = slugifySegment(stem) === "index";

  const segments = isIndex ? dirSlugs : [...dirSlugs, slugifySegment(stem)];
  const route = segments.length === 0 ? "/" : `/${segments.join("/")}/`;
  const outputPath = segments.length === 0 ? "index.html" : `${segments.join("/")}/index.html`;

  return { route, outputPath, isIndex, dirSlugs, dirNames, stem };
}

/** Title fallback derived from the file location. */
export function titleFromPath(info: RouteInfo): string {
  if (info.isIndex) {
    const dir = info.dirNames[info.dirNames.length - 1];
    return dir === undefined ? "Home" : humanize(dir);
  }
  return humanize(info.stem);
}
