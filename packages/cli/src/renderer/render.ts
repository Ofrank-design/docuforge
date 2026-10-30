import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { ResolvedConfig } from "../config/load.js";
import type { DiscoveryResult } from "../build/pipeline.js";
import type { StagingWriter } from "../build/staging.js";
import { AssetCollector, copyPublicDir, type AssetOptions } from "../assets/copy.js";
import { readSourceFile } from "../markdown/document.js";
import { parseFrontMatter } from "../markdown/frontmatter.js";
import { createRenderer, type AnchorRef } from "../markdown/processor.js";
import { collectRoutes, flattenNav, navigationToJson, type NavGroup, type NavNode } from "../navigation/tree.js";
import { mapLimit } from "../util/concurrency.js";
import type { Diagnostics } from "../util/diagnostics.js";
import { renderLandingContent, renderPage, type SiteContext } from "./page.js";
import { pageUrl } from "../links/resolve.js";
import { loadThemeBundle } from "../templates/themeAssets.js";
import { buildSearchIndex } from "../search/build.js";
import type { SearchDoc } from "../search/types.js";
import { CssRejected, sanitizeCss } from "../assets/css.js";
import { buildRobots, buildSitemap, defaultFavicon, faviconType } from "./seo.js";

export interface RenderStats {
  pages: number;
  generatedPages: number;
  assets: number;
  publicFiles: number;
  searchDocs: number;
  /** Generated site files: 404.html, sitemap.xml, robots.txt (those not supplied by the user). */
  siteFiles: string[];
}

/**
 * Render the whole site into `writer` (a staging directory):
 * one HTML page per document, generated landing pages, copied assets,
 * navigation.json and the shared CSS/JS. Nothing here touches the real output directory.
 */
export async function renderSite(
  config: ResolvedConfig,
  discovery: DiscoveryResult,
  writer: StagingWriter,
  diags: Diagnostics,
): Promise<RenderStats> {
  const { documents, tree, excludedDrafts } = discovery;

  const index = {
    docsByPath: new Map(documents.map((d) => [d.relPath, d.route])),
    routes: collectRoutes(tree),
    draftPaths: new Set(excludedDrafts),
  };

  const theme = await loadThemeBundle();
  const assetOptions: AssetOptions = {
    sourceDir: config.sourceDir,
    includeHidden: config.includeHidden,
    maxAssetSizeBytes: config.limits.maxAssetSizeBytes,
    svg: config.svg,
    strictLinks: config.strictLinks,
    publicDir: config.publicDir,
  };
  const assets = new AssetCollector(assetOptions, writer, diags);
  const render = createRenderer({
    rawHtml: config.rawHtml,
    syntaxHighlighting: config.syntaxHighlighting,
    basePath: config.basePath,
    strictLinks: config.strictLinks,
  });

  // --- site-level files: logo, tab icons, social image, custom CSS ---------------------------------
  // A file inside the public directory is published at the site root by the public-dir copy, so
  // it is only referenced; any other file goes through the asset pipeline (checks, SVG sanitizing).
  const publicPrefix = config.publicDir === false ? undefined : `${config.publicDir}/`;
  const urlFor = async (rel: string | undefined): Promise<string | undefined> => {
    if (rel === undefined) return undefined;
    if (publicPrefix && rel.startsWith(publicPrefix)) return rel.slice(publicPrefix.length);
    return assets.reference(rel, "docuforge config");
  };
  const sa = config.siteAssets;
  const icons: { path: string; type?: string }[] = [];
  for (const rel of sa.favicon !== undefined ? [sa.favicon] : sa.publicIcons) {
    const out = await urlFor(rel);
    const type = faviconType(rel);
    if (out !== undefined) icons.push({ path: out, ...(type ? { type } : {}) });
  }
  const logo = await urlFor(sa.logo);
  const appleTouchIcon = await urlFor(sa.appleTouchIcon);
  const socialImage = await urlFor(sa.socialImage);

  let customCss: string | undefined;
  if (sa.customCss !== undefined) {
    try {
      const raw = await fs.readFile(path.join(config.sourceDir, ...sa.customCss.split("/")), "utf8");
      const clean = sanitizeCss(raw);
      if (clean.removed.length > 0) {
        diags.warn("css.sanitized", `Removed unsafe CSS from "${sa.customCss}": ${[...new Set(clean.removed)].join(", ")}.`, "docuforge config");
      }
      const name = `assets/custom-${createHash("sha256").update(clean.css).digest("hex").slice(0, 10)}.css`;
      if (await writer.write(name, clean.css)) customCss = name;
    } catch (err) {
      diags.error(
        "css.rejected",
        `Cannot use customCss "${sa.customCss}": ${err instanceof CssRejected ? err.message : "the file could not be read"}.`,
        "docuforge config",
      );
    }
  }

  const site: SiteContext = {
    siteTitle: config.title,
    ...(config.description !== undefined ? { siteDescription: config.description } : {}),
    basePath: config.basePath,
    ...(config.siteUrl !== undefined ? { siteUrl: config.siteUrl } : {}),
    tree,
    reading: flattenNav(tree),
    toc: config.toc,
    searchEnabled: config.search,
    footer: config.footer,
    assets: theme.entry,
    icons,
    fallbackIcon: defaultFavicon(config.title),
    ...(logo !== undefined ? { logo } : {}),
    ...(appleTouchIcon !== undefined ? { appleTouchIcon } : {}),
    ...(customCss !== undefined ? { customCss } : {}),
    ...(socialImage !== undefined ? { socialImage } : {}),
  };

  const anchorRefs: AnchorRef[] = [];
  const anchorsByRoute = new Map<string, Set<string>>();
  const searchDocs: SearchDoc[] = [];
  let pages = 0;

  await mapLimit(documents, config.concurrency, async (doc) => {
    let raw: string;
    try {
      raw = await readSourceFile(path.join(config.sourceDir, ...doc.relPath.split("/")), config.limits.maxFileSizeBytes);
    } catch (err) {
      diags.warn("document.unreadable", `Cannot read document (${(err as Error).message}); no page was generated.`, doc.relPath);
      return;
    }
    const { body } = parseFrontMatter(raw);
    const localRefs: AnchorRef[] = [];
    const rendered = await render(body, { relPath: doc.relPath, index, assets, diags, anchorRefs: localRefs });
    anchorRefs.push(...localRefs);
    anchorsByRoute.set(doc.route, new Set(rendered.headings.map((h) => h.id)));
    searchDocs.push({
      id: doc.route,
      title: doc.title,
      ...(doc.description !== undefined ? { description: doc.description } : {}),
      tags: doc.tags,
      headings: rendered.headings,
      text: rendered.text,
    });

    const description = doc.description ?? rendered.summary ?? config.description;
    const html = renderPage(site, {
      route: doc.route,
      title: doc.title,
      ...(description !== undefined ? { description } : {}),
      contentHtml: rendered.html,
      injectH1: rendered.h1Count === 0,
      headings: rendered.headings,
    });
    if (await writer.write(doc.outputPath, html, doc.relPath)) pages++;
  });

  // Pages for directories (and the home page) that have no index document.
  let generatedPages = 0;
  const landing = async (route: string, outputPath: string, title: string, children: NavNode[]): Promise<void> => {
    const html = renderPage(site, {
      route,
      title,
      contentHtml: renderLandingContent(title, children, config.basePath),
      injectH1: false,
      headings: [],
    });
    if (await writer.write(outputPath, html)) generatedPages++;
  };
  if (tree.home.landing === "generated") await landing("/", "index.html", tree.home.title, tree.items);
  const generatedGroups: NavGroup[] = [];
  const collect = (nodes: NavNode[]): void => {
    for (const n of nodes) {
      if (n.type !== "group") continue;
      if (n.landing === "generated") generatedGroups.push(n);
      collect(n.children);
    }
  };
  collect(tree.items);
  for (const g of generatedGroups) {
    await landing(g.route, `${g.route.slice(1)}index.html`, g.title, g.children);
  }

  // Validate links to headings in other documents now that every heading id is known.
  for (const ref of anchorRefs) {
    const ids = anchorsByRoute.get(ref.route);
    if (ids === undefined || ids.has(ref.anchor)) {
      if (ids === undefined && ref.anchor !== "" && ref.anchor !== "top") {
        diags.report(config.strictLinks, "link.broken-anchor", `Anchor "#${ref.anchor}" points into a generated page, which has no headings to link to.`, ref.from);
      }
      continue;
    }
    diags.report(config.strictLinks, "link.broken-anchor", `Anchor "#${ref.anchor}" does not exist on ${ref.route}.`, ref.from);
  }

  const publicFiles = await copyPublicDir(assetOptions, writer, diags);

  // Site files the host expects. Anything the user put in the public directory wins (no overwrite, no collision).
  const siteFiles: string[] = [];
  if (!writer.has("404.html")) {
    const html = renderPage(site, {
      route: "/404.html",
      title: "Page not found",
      contentHtml: `<h1>Page not found</h1>\n<p>This page does not exist, or it may have moved. Check the address, or head back to the home page.</p>\n<p><a href="${pageUrl(config.basePath, "/")}">Go to the home page</a>${
        config.search ? " or press <kbd>/</kbd> to search." : "."
      }</p>`,
      injectH1: false,
      headings: [],
      robots: "noindex",
    });
    if (await writer.write("404.html", html)) siteFiles.push("404.html");
  }
  let sitemapHref: string | undefined;
  if (config.siteUrl && !writer.has("sitemap.xml")) {
    const routes = [...collectRoutes(tree)];
    if (await writer.write("sitemap.xml", buildSitemap(routes, config.siteUrl, config.basePath))) {
      siteFiles.push("sitemap.xml");
      sitemapHref = new URL(`${config.basePath}sitemap.xml`, config.siteUrl).href;
    }
  }
  if (!writer.has("robots.txt") && (await writer.write("robots.txt", buildRobots(sitemapHref)))) siteFiles.push("robots.txt");

  for (const file of theme.files) await writer.write(file.path, file.data);
  if (config.search) await writer.write("search-index.json", JSON.stringify(buildSearchIndex(searchDocs)));
  await writer.write(
    "navigation.json",
    `${JSON.stringify(navigationToJson(tree, { title: config.title, basePath: config.basePath }), null, 2)}\n`,
  );

  return { pages, generatedPages, assets: assets.copiedCount, publicFiles, searchDocs: config.search ? searchDocs.length : 0, siteFiles };
}
