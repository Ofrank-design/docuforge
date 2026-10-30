import type { HeadingInfo } from "../markdown/processor.js";
import type { NavNode, NavTree, ReadingItem } from "../navigation/tree.js";
import { pageUrl } from "../links/resolve.js";
import { esc } from "./html.js";

export interface SiteContext {
  siteTitle: string;
  siteDescription?: string;
  /** Normalized base path, `/` or `/segment/`. */
  basePath: string;
  siteUrl?: string;
  tree: NavTree;
  reading: ReadingItem[];
  toc: { minLevel: number; maxLevel: number };
  /** Render the search UI hooks (and the index is written). */
  searchEnabled: boolean;
  /** Footer text, or `false` for none. */
  footer: string | false;
  /** Output paths (relative to the site root) of the content-hashed shared assets. */
  assets: { css: string; js: string; init: string; fonts: string[] };
  /** Header logo, as a site-root-relative path. */
  logo?: string;
  /** Tab icons (site-root-relative paths). When empty a generated letter icon is used. */
  icons: { path: string; type?: string }[];
  /** `data:` URI used when `icons` is empty. */
  fallbackIcon: string;
  appleTouchIcon?: string;
  /** Extra stylesheet, site-root-relative. */
  customCss?: string;
  /** Social card image, site-root-relative (an absolute URL is only emitted when `siteUrl` is set). */
  socialImage?: string;
}

export interface PageInput {
  route: string;
  title: string;
  description?: string;
  /** Rendered, sanitized article HTML (or generated landing HTML). */
  contentHtml: string;
  /** When true, a visible `<h1>` is added because the content has none. */
  injectH1: boolean;
  headings: HeadingInfo[];
  /** Value for `<meta name="robots">` (the 404 page uses `noindex`). */
  robots?: string;
}

function containsRoute(node: NavNode, route: string): boolean {
  if (node.route === route) return true;
  return node.type === "group" && node.children.some((c) => containsRoute(c, route));
}

function renderNavNodes(nodes: NavNode[], active: string, base: string): string {
  const items = nodes.map((n) => {
    if (n.type === "page") {
      const current = n.route === active ? ' aria-current="page"' : "";
      return `<li><a href="${esc(pageUrl(base, n.route))}"${current}>${esc(n.label)}</a></li>`;
    }
    const open = containsRoute(n, active) ? " open" : "";
    const current = n.route === active ? ' aria-current="page"' : "";
    return `<li><details${open}><summary><a href="${esc(pageUrl(base, n.route))}"${current}>${esc(n.label)}</a></summary>${renderNavNodes(
      n.children,
      active,
      base,
    )}</details></li>`;
  });
  return `<ul>${items.join("")}</ul>`;
}

function renderSidebar(ctx: SiteContext, active: string): string {
  const home = ctx.tree.home;
  const homeCurrent = active === home.route ? ' aria-current="page"' : "";
  return (
    `<nav id="df-nav" class="sidebar border-b border-line bg-surface p-4 lg:sticky lg:top-16 lg:max-h-[calc(100vh-4rem)] lg:overflow-y-auto lg:border-b-0 lg:border-r" aria-label="Documentation">` +
    `<ul class="nav-root"><li><a href="${esc(pageUrl(ctx.basePath, home.route))}"${homeCurrent}>${esc(home.label)}</a></li></ul>` +
    renderNavNodes(ctx.tree.items, active, ctx.basePath) +
    `</nav>`
  );
}

function tocEntries(ctx: SiteContext, headings: HeadingInfo[]): HeadingInfo[] {
  return headings.filter((h) => h.depth >= ctx.toc.minLevel && h.depth <= ctx.toc.maxLevel);
}

function tocList(entries: HeadingInfo[]): string {
  return `<ul>${entries.map((h) => `<li class="toc-l${h.depth}"><a href="#${esc(h.id)}">${esc(h.text)}</a></li>`).join("")}</ul>`;
}

function renderPager(ctx: SiteContext, route: string): string {
  const i = ctx.reading.findIndex((r) => r.route === route);
  if (i === -1) return "";
  const prev = ctx.reading[i - 1];
  const next = ctx.reading[i + 1];
  if (!prev && !next) return "";
  const link = (r: ReadingItem, dir: "prev" | "next"): string =>
    `<a class="pager-${dir} df-card df-card--interactive" href="${esc(pageUrl(ctx.basePath, r.route))}" rel="${dir}"><span class="pager-dir">${
      dir === "prev" ? "Previous" : "Next"
    }</span><span class="pager-label">${esc(r.label)}</span></a>`;
  return `<nav class="pager mt-12 flex justify-between gap-4" aria-label="Pagination">${prev ? link(prev, "prev") : "<span></span>"}${next ? link(next, "next") : "<span></span>"}</nav>`;
}

function encodePath(p: string): string {
  return p.split("/").map((seg) => encodeURIComponent(seg)).join("/");
}

function safeAbsolute(origin: string, path: string): string | undefined {
  try {
    return new URL(path, origin).href;
  } catch {
    return undefined;
  }
}

const ICON_SIZES: Record<string, string> = { "image/x-icon": "any" };

function iconLinks(ctx: SiteContext): string[] {
  const base = ctx.basePath;
  const links =
    ctx.icons.length > 0
      ? ctx.icons.map((i) => `<link rel="icon" href="${esc(base)}${esc(encodePath(i.path))}"${i.type ? ` type="${esc(i.type)}"` : ""}${i.type && ICON_SIZES[i.type] ? ` sizes="${ICON_SIZES[i.type]}"` : ""}>`)
      : [`<link rel="icon" href="${esc(ctx.fallbackIcon)}" type="image/svg+xml">`];
  if (ctx.appleTouchIcon) links.push(`<link rel="apple-touch-icon" href="${esc(base)}${esc(encodePath(ctx.appleTouchIcon))}">`);
  return links;
}

function canonicalUrl(ctx: SiteContext, route: string): string | undefined {
  if (!ctx.siteUrl) return undefined;
  try {
    return new URL(pageUrl(ctx.basePath, route), ctx.siteUrl).href;
  } catch {
    return undefined;
  }
}

/** Render one complete HTML document. Every interpolated value is escaped. */
export function renderPage(ctx: SiteContext, page: PageInput): string {
  const isHome = page.route === "/";
  const fullTitle = isHome || page.title === ctx.siteTitle ? page.title : `${page.title} | ${ctx.siteTitle}`;
  const description = page.description ?? ctx.siteDescription;
  const canonical = page.robots ? undefined : canonicalUrl(ctx, page.route);
  const socialUrl = ctx.siteUrl && ctx.socialImage ? safeAbsolute(ctx.siteUrl, ctx.basePath + encodePath(ctx.socialImage)) : undefined;
  const base = ctx.basePath;
  const a = ctx.assets;
  const toc = tocEntries(ctx, page.headings);

  const head = [
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>${esc(fullTitle)}</title>`,
    description ? `<meta name="description" content="${esc(description)}">` : "",
    canonical ? `<link rel="canonical" href="${esc(canonical)}">` : "",
    `<meta property="og:title" content="${esc(page.title)}">`,
    description ? `<meta property="og:description" content="${esc(description)}">` : "",
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${esc(ctx.siteTitle)}">`,
    canonical ? `<meta property="og:url" content="${esc(canonical)}">` : "",
    page.robots ? `<meta name="robots" content="${esc(page.robots)}">` : "",
    socialUrl ? `<meta property="og:image" content="${esc(socialUrl)}">` : "",
    `<meta name="twitter:card" content="${socialUrl ? "summary_large_image" : "summary"}">`,
    socialUrl ? `<meta name="twitter:image" content="${esc(socialUrl)}">` : "",
    ...iconLinks(ctx),
    `<meta name="generator" content="DocuForge">`,
    `<meta name="color-scheme" content="light dark">`,
    `<script src="${esc(base)}${esc(a.init)}"></script>`,
    ...a.fonts.map((f) => `<link rel="preload" href="${esc(base)}${esc(f)}" as="font" type="font/woff2" crossorigin>`),
    `<link rel="stylesheet" href="${esc(base)}${esc(a.css)}">`,
    ctx.customCss ? `<link rel="stylesheet" href="${esc(base)}${esc(encodePath(ctx.customCss))}">` : "",
    `<script type="module" src="${esc(base)}${esc(a.js)}"></script>`,
  ]
    .filter(Boolean)
    .join("\n");

  const h1 = page.injectH1 ? `<h1>${esc(page.title)}</h1>\n` : "";
  const mobileToc =
    toc.length > 0
      ? `<nav class="toc-mobile mb-6 rounded-lg border border-line px-4 py-2 xl:hidden" aria-label="On this page"><details><summary>On this page</summary>${tocList(toc)}</details></nav>\n`
      : "";
  const desktopToc =
    toc.length > 0
      ? `<nav class="toc hidden xl:block sticky top-16 max-h-[calc(100vh-4rem)] self-start overflow-y-auto py-8 pr-4" aria-label="On this page"><p class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted" id="df-toc">On this page</p>${tocList(toc)}</nav>`
      : `<div class="hidden xl:block"></div>`;
  const footer = ctx.footer === false ? "" : `<footer class="site-footer border-t border-line px-4 py-4 text-center text-sm text-muted"><p>${esc(ctx.footer)}</p></footer>\n`;

  return `<!doctype html>
<html lang="en" data-df-base="${esc(base)}" data-df-search="${ctx.searchEnabled ? "on" : "off"}">
<head>
${head}
</head>
<body class="min-h-screen bg-bg text-fg antialiased">
<a class="skip-link" href="#df-main">Skip to content</a>
<header class="site-header sticky top-0 z-50 flex h-16 items-center gap-2 border-b border-line bg-bg px-3 sm:gap-3 sm:px-4">
<div id="df-menu-root" class="df-js-only lg:hidden"><span class="inline-block h-10 w-10"></span></div>
<a class="site-title flex min-w-0 flex-1 items-center gap-2 text-lg font-bold text-fg no-underline" href="${esc(pageUrl(base, "/"))}">${
  ctx.logo ? `<img class="h-8 w-auto max-w-[10rem] shrink-0 object-contain" src="${esc(base)}${esc(encodePath(ctx.logo))}" alt="" height="32">` : ""
}<span class="truncate">${esc(ctx.siteTitle)}</span></a>
<div class="flex shrink-0 items-center gap-2">
${ctx.searchEnabled ? `<div id="df-search-root" class="df-js-only"><span class="inline-block h-10 w-10 sm:w-56"></span></div>\n` : ""}<div id="df-theme-root" class="df-js-only"><span class="inline-block h-10 w-10"></span></div>
</div>
</header>
<div id="df-backdrop" aria-hidden="true"></div>
<div class="mx-auto grid max-w-[90rem] grid-cols-1 lg:grid-cols-[18rem_minmax(0,1fr)] xl:grid-cols-[18rem_minmax(0,1fr)_15rem]">
${renderSidebar(ctx, page.route)}
<main id="df-main" tabindex="-1" class="min-w-0 px-4 py-8 sm:px-8 lg:px-10">
${mobileToc}<article class="content">
${h1}${page.contentHtml}
</article>
${renderPager(ctx, page.route)}
</main>
${desktopToc}
</div>
${footer}<div id="df-copy-status" class="sr-only" role="status" aria-live="polite"></div>
</body>
</html>
`;
}

/** Body for a directory/home page that has no index document. */
export function renderLandingContent(title: string, children: NavNode[], basePath: string): string {
  const items = children
    .map((c) => {
      const desc = c.type === "page" && c.description ? `<p>${esc(c.description)}</p>` : "";
      return `<li class="df-card df-card--interactive"><a class="df-card__link" href="${esc(pageUrl(basePath, c.route))}">${esc(c.label)}</a>${desc}</li>`;
    })
    .join("");
  return `<h1>${esc(title)}</h1>\n<ul class="landing-list">${items}</ul>`;
}
