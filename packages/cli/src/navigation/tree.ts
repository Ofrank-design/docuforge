import type { SortMode } from "../config/schema.js";
import type { DocumentMeta } from "../markdown/document.js";
import { collator, compareStrings, humanize } from "../util/text.js";

export type LandingKind = "document" | "generated";

export interface NavPage {
  type: "page";
  /** Equal to `route`. */
  id: string;
  route: string;
  label: string;
  title: string;
  description?: string;
  order?: number;
}

export interface NavGroup {
  type: "group";
  id: string;
  /** Route of the group's landing page (its index document, or a generated overview). */
  route: string;
  label: string;
  title: string;
  landing: LandingKind;
  order?: number;
  children: NavNode[];
}

export type NavNode = NavPage | NavGroup;

export interface NavHome {
  route: "/";
  label: string;
  title: string;
  landing: LandingKind;
}

export interface NavTree {
  home: NavHome;
  items: NavNode[];
}

interface GroupBuilder {
  slug: string;
  /** Original directory name (used for label + filename sorting). */
  name: string;
  route: string;
  index?: DocumentMeta;
  pages: DocumentMeta[];
  groups: Map<string, GroupBuilder>;
}

function newGroup(slug: string, name: string, route: string): GroupBuilder {
  return { slug, name, route, pages: [], groups: new Map() };
}

function lastSegment(route: string): string {
  const parts = route.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

function compareOrder(a: number | undefined, b: number | undefined): number {
  if (a === b) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return a - b;
}

interface Sortable {
  node: NavNode;
  /** Name used by the `filename` sort mode. */
  fileKey: string;
}

function sortNodes(items: Sortable[], mode: SortMode): NavNode[] {
  const cmp = (a: Sortable, b: Sortable): number => {
    let r = 0;
    if (mode === "order-then-title") {
      r = compareOrder(a.node.order, b.node.order) || collator.compare(a.node.label, b.node.label);
    } else if (mode === "title") {
      r = collator.compare(a.node.label, b.node.label);
    } else {
      r = collator.compare(a.fileKey, b.fileKey);
    }
    // Final tie-break on the unique route keeps ordering fully deterministic.
    return r || compareStrings(a.node.route, b.node.route);
  };
  return [...items].sort(cmp).map((s) => s.node);
}

function buildGroupNode(g: GroupBuilder, mode: SortMode): NavGroup {
  const idx = g.index;
  const label = idx?.sidebarLabel ?? (idx?.titleSource === "frontmatter" ? idx.title : undefined) ?? humanize(g.name);
  return {
    type: "group",
    id: g.route,
    route: g.route,
    label,
    title: idx?.title ?? label,
    landing: idx ? "document" : "generated",
    ...(idx?.order !== undefined ? { order: idx.order } : {}),
    children: childNodes(g, mode),
  };
}

function childNodes(g: GroupBuilder, mode: SortMode): NavNode[] {
  const items: Sortable[] = [];
  for (const doc of g.pages) {
    items.push({
      fileKey: doc.stem,
      node: {
        type: "page",
        id: doc.route,
        route: doc.route,
        label: doc.sidebarLabel ?? doc.title,
        title: doc.title,
        ...(doc.description !== undefined ? { description: doc.description } : {}),
        ...(doc.order !== undefined ? { order: doc.order } : {}),
      },
    });
  }
  for (const child of g.groups.values()) {
    items.push({ fileKey: child.name, node: buildGroupNode(child, mode) });
  }
  return sortNodes(items, mode);
}

/**
 * Build the navigation tree from the actual documents.
 *
 * - directories become groups; `index.md` is the group's landing page
 * - a directory without an index gets a generated landing route
 * - a page like `guides.md` next to a `guides/` folder becomes that folder's landing page
 * - every route in the tree comes from a document or a directory, never from metadata
 */
export function buildNavTree(docs: readonly DocumentMeta[], mode: SortMode, siteTitle: string): NavTree {
  const root = newGroup("", "", "/");

  for (const doc of [...docs].sort((a, b) => compareStrings(a.relPath, b.relPath))) {
    let group = root;
    const slugs: string[] = [];
    doc.dirSlugs.forEach((slug, i) => {
      slugs.push(slug);
      let child = group.groups.get(slug);
      if (!child) {
        child = newGroup(slug, doc.dirNames[i] ?? slug, `/${slugs.join("/")}/`);
        group.groups.set(slug, child);
      }
      group = child;
    });
    if (doc.isIndex) group.index = doc;
    else group.pages.push(doc);
  }

  // Fold `name.md` into a sibling `name/` directory that has no index of its own.
  const fold = (g: GroupBuilder): void => {
    g.pages = g.pages.filter((p) => {
      const child = g.groups.get(lastSegment(p.route));
      if (child && !child.index) {
        child.index = p;
        return false;
      }
      return true;
    });
    for (const child of g.groups.values()) fold(child);
  };
  fold(root);

  const idx = root.index;
  const home: NavHome = {
    route: "/",
    label: idx?.sidebarLabel ?? "Home",
    title: idx?.title ?? siteTitle,
    landing: idx ? "document" : "generated",
  };

  return { home, items: childNodes(root, mode) };
}

export interface ReadingItem {
  route: string;
  label: string;
  kind: "home" | "page" | "group";
}

/** Linear reading order (home first, then depth-first); basis for previous/next links. */
export function flattenNav(tree: NavTree): ReadingItem[] {
  const out: ReadingItem[] = [{ route: tree.home.route, label: tree.home.label, kind: "home" }];
  const walk = (nodes: NavNode[]): void => {
    for (const n of nodes) {
      if (n.type === "page") out.push({ route: n.route, label: n.label, kind: "page" });
      else {
        out.push({ route: n.route, label: n.label, kind: "group" });
        walk(n.children);
      }
    }
  };
  walk(tree.items);
  return out;
}

/** Every route that appears in the tree. */
export function collectRoutes(tree: NavTree): Set<string> {
  return new Set(flattenNav(tree).map((i) => i.route));
}

/** Serializable form written to `navigation.json`. Contains no filesystem paths. */
export function navigationToJson(
  tree: NavTree,
  site: { title: string; basePath: string },
): { version: 1; title: string; basePath: string; home: NavHome; items: NavNode[] } {
  return { version: 1, title: site.title, basePath: site.basePath, home: tree.home, items: tree.items };
}

/** Text rendering of the tree for `--verbose` output. */
export function renderTreeText(tree: NavTree): string {
  const lines: string[] = [`${tree.home.label}  ${tree.home.route}${tree.home.landing === "generated" ? "  (generated)" : ""}`];
  const walk = (nodes: NavNode[], depth: number): void => {
    for (const n of nodes) {
      const pad = "  ".repeat(depth);
      if (n.type === "page") lines.push(`${pad}- ${n.label}  ${n.route}`);
      else {
        lines.push(`${pad}+ ${n.label}  ${n.route}${n.landing === "generated" ? "  (generated)" : ""}`);
        walk(n.children, depth + 1);
      }
    }
  };
  walk(tree.items, 0);
  return lines.join("\n");
}
