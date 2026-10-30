import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DocuForgeError, ExitCode } from "../util/errors.js";

/**
 * Runs in <head> before first paint (a tiny classic script, so no inline JS is
 * needed and a strict `script-src 'self'` policy works). It marks the page as
 * JS-capable and applies the saved/system theme to avoid a flash of the wrong one.
 * Must stay in sync with `applyTheme` in the theme package (a test checks this).
 */
export const THEME_INIT_JS = `(function(){var d=document.documentElement;d.classList.add("df-js");try{var p=localStorage.getItem("df-theme");if(p!=="light"&&p!=="dark")p="system";var k=p==="dark"||(p==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);d.dataset.theme=k?"dark":"light";d.dataset.themePref=p;d.style.colorScheme=k?"dark":"light"}catch(e){}})();
`;

export interface ThemeFile {
  /** Output path relative to the site root, e.g. `assets/site.js`. */
  path: string;
  data: Uint8Array;
}

export interface ThemeBundle {
  files: ThemeFile[];
  /** Output paths (relative to the site root) of the files every page references. */
  entry: { css: string; js: string; init: string; fonts: string[] };
}

const hash = (data: Uint8Array | string): string => createHash("sha256").update(data).digest("hex").slice(0, 10);
const isEntry = (p: string, ext: string): boolean => new RegExp(`^assets/site-[^/]+\\.${ext}$`).test(p);

/**
 * Where the built theme lives. In a monorepo checkout the freshly built `packages/theme/dist` wins (so
 * a stale copy in `theme-assets` can never mask theme changes); it is only trusted if the sibling package
 * really is `@docuforge/theme`. An installed package uses its own `theme-assets` folder.
 */
async function candidateDirs(): Promise<string[]> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dirs: string[] = [];
  const sibling = path.resolve(here, "../../../theme");
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(sibling, "package.json"), "utf8")) as { name?: string };
    if (pkg.name === "@docuforge/theme") dirs.push(path.join(sibling, "dist"));
  } catch {
    /* not a monorepo checkout */
  }
  dirs.push(path.resolve(here, "../../theme-assets"));
  return dirs;
}

async function readDir(dir: string, rel = ""): Promise<ThemeFile[]> {
  const out: ThemeFile[] = [];
  for (const entry of (await fs.readdir(path.join(dir, rel), { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const r = rel === "" ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) out.push(...(await readDir(dir, r)));
    else if (entry.isFile() && !entry.name.endsWith(".map")) {
      out.push({ path: `assets/${r}`, data: new Uint8Array(await fs.readFile(path.join(dir, r))) });
    }
  }
  return out;
}

let cache: Promise<ThemeBundle> | undefined;

/** Load the built theme (CSS, JS entry and lazy chunks) plus the generated init script. */
export function loadThemeBundle(): Promise<ThemeBundle> {
  cache ??= (async () => {
    for (const dir of await candidateDirs()) {
      try {
        const files = await readDir(dir);
        const css = files.find((f) => isEntry(f.path, "css"));
        const js = files.find((f) => isEntry(f.path, "js"));
        if (!css || !js) continue;
        const init = `assets/theme-init-${hash(THEME_INIT_JS)}.js`;
        files.push({ path: init, data: new TextEncoder().encode(THEME_INIT_JS) });
        const font = files.find((f) => /^assets\/fonts\/geist-latin-wght-normal-[^/]+\.woff2$/.test(f.path));
        return { files, entry: { css: css.path, js: js.path, init, fonts: font ? [font.path] : [] } };
      } catch {
        /* try the next location */
      }
    }
    throw new DocuForgeError(
      "The DocuForge theme has not been built (packages/theme/dist or theme-assets is missing). Run `npm run build` first.",
      ExitCode.Internal,
    );
  })();
  cache.catch(() => {
    cache = undefined;
  });
  return cache;
}
