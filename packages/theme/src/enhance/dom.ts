export interface SiteConfig {
  /** Base path with leading and trailing slash. */
  base: string;
  searchEnabled: boolean;
}

/** Read the page-level configuration the build embeds on <html>. */
export function readSiteConfig(doc: Document = document): SiteConfig {
  const root = doc.documentElement;
  const rawBase = root.dataset["dfBase"] ?? "/";
  // a leading "//" would make every generated link protocol-relative (an off-site URL)
  const base = /^\/(?!\/)[A-Za-z0-9._~\-/]*$/.test(rawBase) || rawBase === "/" ? (rawBase.endsWith("/") ? rawBase : `${rawBase}/`) : "/";
  return { base, searchEnabled: root.dataset["dfSearch"] === "on" };
}

/** URL for a route + optional heading id, under the base path. */
export function urlFor(base: string, route: string, headingId?: string): string {
  const path = route
    .replace(/^\//, "")
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/");
  return `${base}${path}${headingId ? `#${encodeURIComponent(headingId)}` : ""}`;
}

/** True when the focused element accepts typed text (so single-key shortcuts must not fire). */
export function isEditable(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return (el as HTMLElement).isContentEditable === true;
}
