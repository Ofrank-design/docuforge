/**
 * SVG sanitizing via DOMPurify (+ jsdom). SVG files can carry <script>,
 * event handlers, <foreignObject> and external references; a hostile SVG
 * opened directly in the browser would run in the site's origin.
 * jsdom/DOMPurify are imported lazily so builds without SVGs start fast.
 */

type Purifier = { sanitize(dirty: string, cfg: Record<string, unknown>): string };
let purifier: Promise<Purifier> | undefined;

const SAFE_DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/i;

async function getPurifier(): Promise<Purifier> {
  purifier ??= (async () => {
    const [{ JSDOM }, domPurifyModule] = await Promise.all([import("jsdom"), import("dompurify")]);
    const createDOMPurify = (domPurifyModule.default ?? domPurifyModule) as unknown as (w: unknown) => {
      sanitize: Purifier["sanitize"];
      addHook(name: string, fn: (node: Element) => void): void;
    };
    const window = new JSDOM("").window;
    const dp = createDOMPurify(window);

    const cleanCss = (css: string): string =>
      css
        .replace(/@import[^;]*;?/gi, "")
        .replace(/url\(\s*(['"]?)(?!#|data:image\/(?:png|jpe?g|gif|webp);base64,)[^)]*\1\s*\)/gi, "none")
        .replace(/expression\s*\(/gi, "(");

    dp.addHook("afterSanitizeAttributes", (node: Element) => {
      const tag = node.nodeName.toLowerCase();
      for (const attr of ["href", "xlink:href"]) {
        const value = node.getAttribute?.(attr);
        if (value === null || value === undefined) continue;
        const v = value.trim();
        if (tag === "a") {
          if (!/^(https?:|mailto:|#)/i.test(v)) node.removeAttribute(attr);
        } else if (!(v.startsWith("#") || SAFE_DATA_IMAGE.test(v))) {
          node.removeAttribute(attr); // <use>, <image>, <feImage>, ... : fragment or inline image only
        }
      }
      const style = node.getAttribute?.("style");
      if (style) node.setAttribute("style", cleanCss(style));
      if (tag === "style" && node.textContent) node.textContent = cleanCss(node.textContent);
    });
    return dp as unknown as Purifier;
  })();
  return purifier;
}

export class SvgRejected extends Error {}

/** Returns sanitized SVG markup, or throws `SvgRejected` if the input is not a usable SVG. */
export async function sanitizeSvg(source: string): Promise<string> {
  const dp = await getPurifier();
  const out = dp.sanitize(source, {
    PARSER_MEDIA_TYPE: "image/svg+xml",
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ["script", "foreignObject", "iframe", "object", "embed", "animate", "set", "animateTransform", "animateMotion"],
    FORBID_ATTR: ["onload", "onerror", "onclick"],
    KEEP_CONTENT: false,
  });
  if (!/<svg[\s>]/i.test(out)) throw new SvgRejected("not a valid SVG document");
  return out;
}
