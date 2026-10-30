// Copies the built theme (packages/theme/dist) into packages/cli/theme-assets so the
// published CLI package is self-contained.
import { cpSync, existsSync, readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const from = path.join(root, "packages/theme/dist");
const to = path.join(root, "packages/cli/theme-assets");
const built = existsSync(from) && readdirSync(from).some((f) => /^site-.+\.js$/.test(f)) && readdirSync(from).some((f) => /^site-.+\.css$/.test(f));
if (!built) {
  console.error("Theme is not built: run `npm run build:theme` first.");
  process.exit(1);
}
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });
console.log("Copied theme assets to packages/cli/theme-assets");
