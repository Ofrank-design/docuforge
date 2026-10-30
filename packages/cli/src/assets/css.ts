/**
 * Sanitizing for the optional `customCss` stylesheet. CSS cannot run script, but it can load remote
 * resources (tracking, `@import` chains) and old engines supported `expression()` / `behavior`.
 * Policy: remove `@import`, remove every `url()` except inline images and `#fragment` references,
 * remove legacy script hooks — then re-check the result with CSS escapes decoded, and REJECT the file if
 * anything forbidden remains (e.g. `\75rl(...)` written to dodge the filters). Failing closed beats guessing.
 */

export class CssRejected extends Error {}

const SAFE_URL = /^\s*(['"]?)\s*(#|data:image\/(?:png|jpe?g|gif|webp|svg\+xml)[;,])/i;

/** Decode CSS escapes (`\75`, `\75 `, `\(`) the way a browser would before matching identifiers. */
export function unescapeCss(css: string): string {
  return css
    .replace(/\\([0-9a-fA-F]{1,6})[ \t\r\n\f]?/g, (_m, hex: string) => {
      const cp = parseInt(hex, 16);
      return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : "\uFFFD";
    })
    .replace(/\\([\s\S])/g, "$1");
}

/** What must never survive in the output. Applied to the escape-decoded text. */
function forbiddenLeft(css: string): string | undefined {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, ""); // comments are inert
  if (/@import/i.test(text)) return "@import";
  if (/expression\s*\(/i.test(text)) return "expression()";
  if (/-moz-binding/i.test(text)) return "-moz-binding";
  if (/behavior\s*:/i.test(text)) return "behavior";
  if (/javascript\s*:/i.test(text)) return "javascript:";
  for (const m of text.matchAll(/url\s*\(\s*([^)]*)\)?/gi)) {
    if (!SAFE_URL.test(m[1] ?? "")) return "url()";
  }
  return undefined;
}

export interface SanitizedCss {
  css: string;
  /** Human-readable list of what was removed. */
  removed: string[];
}

export function sanitizeCss(source: string): SanitizedCss {
  const removed: string[] = [];
  let css = source.replace(/^\uFEFF/, "");

  css = css.replace(/@import[^;{}]*;?/gi, () => {
    removed.push("@import");
    return "";
  });
  css = css.replace(/url\(\s*((?:"[^"]*"|'[^']*'|[^)])*)\)/gi, (m, arg: string) => {
    if (SAFE_URL.test(arg)) return m;
    removed.push("url()");
    return "none";
  });
  css = css.replace(/expression\s*\([^;}]*/gi, () => {
    removed.push("expression()");
    return "";
  });
  css = css.replace(/(-moz-binding|behavior)\s*:[^;}]*;?/gi, (_m, prop: string) => {
    removed.push(prop.toLowerCase());
    return "";
  });

  const left = forbiddenLeft(unescapeCss(css));
  if (left !== undefined) throw new CssRejected(`contains ${left} in a form that cannot be safely removed`);
  return { css, removed };
}
