import { execFileSync } from "node:child_process";
import { readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const themeDir = path.join(root, "packages/theme");
const bundle = path.join(themeDir, "dist/site.js");

function newest(dir: string): number {
  let t = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    t = Math.max(t, e.isDirectory() ? newest(p) : statSync(p).mtimeMs);
  }
  return t;
}

/**
 * Tests need the built theme. Rebuild it when it is missing or older than anything it is built from
 * (theme sources, the page template whose class names Tailwind scans, or the shared search code).
 */
export default function setup(): void {
  const sources = Math.max(
    newest(path.join(themeDir, "src")),
    newest(path.join(root, "packages/cli/src/search")),
    newest(path.join(root, "packages/cli/src/renderer")),
    statSync(path.join(themeDir, "vite.config.ts")).mtimeMs,
  );
  if (existsSync(bundle) && statSync(bundle).mtimeMs >= sources) return;
  execFileSync(process.execPath, [path.join(root, "node_modules/vite/bin/vite.js"), "build"], { cwd: themeDir, stdio: "inherit" });
}
