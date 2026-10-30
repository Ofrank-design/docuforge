/**
 * Lightweight heading extraction used only to derive a fallback title.
 * (Phase 2 replaces body handling with a full remark AST; this stays correct
 * for titles because it tracks fenced code blocks.)
 */

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;

/** Reduce inline Markdown in a heading to plain text. */
export function plainInline(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/`+([^`]*)`+/g, "$1")
    .replace(/(\*\*|__|\*|_|~~)/g, "")
    .replace(/\\([\\`*_{}[\]()#+\-.!])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractFirstHeading(body: string): string | undefined {
  const lines = body.split(/\r?\n/);
  let fence: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const fm = FENCE_RE.exec(line);
    if (fm) {
      const marker = (fm[1] as string)[0] as string;
      if (fence === undefined) fence = marker;
      else if (fence === marker) fence = undefined;
      continue;
    }
    if (fence !== undefined) continue;

    const atx = /^ {0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/.exec(line);
    if (atx) {
      const text = plainInline(atx[1] as string);
      if (text !== "") return text;
      continue;
    }
    // Setext heading: a text line followed by === or ---
    const next = lines[i + 1];
    if (next !== undefined && line.trim() !== "" && /^ {0,3}(=+|-+)[ \t]*$/.test(next) && !/^\s*[-*+>]/.test(line)) {
      const text = plainInline(line);
      if (text !== "") return text;
    }
  }
  return undefined;
}
