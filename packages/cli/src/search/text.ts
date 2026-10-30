import type { Element, Nodes } from "hast";

const BLOCK = new Set([
  "p", "div", "section", "article", "aside", "header", "footer", "nav", "main", "li", "ul", "ol", "dl", "dt", "dd",
  "h1", "h2", "h3", "h4", "h5", "h6", "pre", "blockquote", "table", "thead", "tbody", "tr", "th", "td", "hr", "br",
  "figure", "figcaption", "details", "summary",
]);
const SKIP = new Set(["script", "style", "template"]);

/**
 * Plain visible text of a (sanitized) HTML tree: no markup, block elements
 * separated by whitespace, whitespace collapsed. Runs on the same tree that
 * becomes the page, so search content matches page content.
 */
export function extractPlainText(tree: Nodes): string {
  const parts: string[] = [];
  const walk = (node: Nodes): void => {
    if (node.type === "text") {
      parts.push(node.value);
      return;
    }
    if (node.type === "element") {
      const el = node as Element;
      if (SKIP.has(el.tagName)) return;
      const block = BLOCK.has(el.tagName);
      if (block) parts.push(" ");
      for (const child of el.children) walk(child);
      if (block) parts.push(" ");
      return;
    }
    if ("children" in node) for (const child of node.children) walk(child as Nodes);
  };
  walk(tree);
  return parts.join("").replace(/\s+/g, " ").trim();
}
