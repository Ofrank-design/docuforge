import { pageUrl } from "../links/resolve.js";

/** Escape text for an XML text node. */
function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** Absolute URL of a route under the base path, or `undefined` if `siteUrl` is unusable. */
export function absoluteUrl(siteUrl: string, basePath: string, route: string): string | undefined {
  try {
    return new URL(pageUrl(basePath, route), siteUrl).href;
  } catch {
    return undefined;
  }
}

/**
 * sitemap.xml for the given routes. The sitemap protocol requires absolute URLs, so this needs `siteUrl`.
 * No `<lastmod>`: file times would make builds non-reproducible.
 */
export function buildSitemap(routes: readonly string[], siteUrl: string, basePath: string): string {
  const urls = [...new Set(routes)]
    .sort()
    .map((r) => absoluteUrl(siteUrl, basePath, r))
    .filter((u): u is string => u !== undefined);
  const body = urls.map((u) => `  <url><loc>${xmlEscape(u)}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

/** robots.txt: allow everything, and point crawlers at the sitemap when there is one. */
export function buildRobots(sitemapUrl: string | undefined): string {
  return `User-agent: *\nAllow: /\n${sitemapUrl ? `\nSitemap: ${sitemapUrl}\n` : ""}`;
}

/** A small letter icon as a data: URI, used when no favicon is configured (so browsers don't request /favicon.ico). */
export function defaultFavicon(siteTitle: string): string {
  const first = [...siteTitle.trim()].find((c) => /[\p{L}\p{N}]/u.test(c)) ?? "D";
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#4338ca"/>` +
    `<text x="16" y="23" font-family="system-ui,sans-serif" font-size="20" font-weight="700" text-anchor="middle" fill="#fff">${xmlEscape(first.toUpperCase())}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const FAVICON_TYPES: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".avif": "image/avif", ".svg": "image/svg+xml", ".ico": "image/x-icon",
};
export function faviconType(path: string): string | undefined {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? undefined : FAVICON_TYPES[path.slice(dot).toLowerCase()];
}
