import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ZodError, type ZodIssue } from "zod";
import { DocuForgeError, ExitCode } from "../util/errors.js";
import { ConfigSchema, type DocuForgeConfig } from "./schema.js";
import { isInside } from "../util/paths.js";
import { assetDenyReason } from "../assets/policy.js";
import { joinWithinRoot } from "../links/resolve.js";

export const CONFIG_FILE_NAMES = [
  "docuforge.config.mjs",
  "docuforge.config.js",
  "docuforge.config.cjs",
  "docuforge.config.json",
] as const;

/** Options coming from CLI flags. They override config-file values. */
export interface CliOverrides {
  source?: string;
  out?: string;
  base?: string;
  includeHidden?: boolean;
  includeDrafts?: boolean;
  strictFrontMatter?: boolean;
  strictLinks?: boolean;
}

export interface ResolvedConfig extends DocuForgeConfig {
  /** Absolute, symlink-resolved source directory. */
  sourceDir: string;
  /** Absolute output directory (may not exist yet). */
  outDir: string;
  /** Absolute path of the config file that was loaded, if any. */
  configFile?: string;
  /** `logo` / `favicon` / `customCss` after validation: normalized source-relative paths. */
  siteAssets: SiteAssets;
}

/**
 * Validated site-level files (source-relative paths). `logo`, `favicon`, `socialImage` and `customCss`
 * come from the config; `publicIcons`, `appleTouchIcon` and an unset `socialImage` are found by
 * convention in the public directory (favicon.svg/png/ico, apple-touch-icon.png, og-image.png/jpg/webp).
 */
export interface SiteAssets {
  logo?: string;
  favicon?: string;
  socialImage?: string;
  customCss?: string;
  publicIcons: string[];
  appleTouchIcon?: string;
}

export const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg", ".ico"]);
export const MAX_CUSTOM_CSS_BYTES = 256 * 1024;

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) (dp[0] as number[])[j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const row = dp[i] as number[];
      row[j] = Math.min(
        (dp[i - 1] as number[])[j]! + 1,
        row[j - 1]! + 1,
        (dp[i - 1] as number[])[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return (dp[a.length] as number[])[b.length]!;
}

const KNOWN_TOP_LEVEL = Object.keys(ConfigSchema.shape);

function suggest(key: string, candidates: string[]): string {
  let best: string | undefined;
  let bestDist = 3;
  for (const c of candidates) {
    const d = levenshtein(key.toLowerCase(), c.toLowerCase());
    if (d < bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return best ? ` Did you mean "${best}"?` : "";
}

export function formatConfigIssues(issues: ZodIssue[], where: string): string[] {
  const lines: string[] = [];
  for (const issue of issues) {
    const prefix = issue.path.join(".");
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) {
        const full = prefix ? `${prefix}.${key}` : key;
        const hint = prefix ? "" : suggest(key, KNOWN_TOP_LEVEL);
        lines.push(`Unknown option "${full}" in ${where}.${hint}`);
      }
    } else {
      lines.push(`Invalid option "${prefix || "(root)"}" in ${where}: ${issue.message}`);
    }
  }
  return lines;
}

async function importConfigFile(filePath: string): Promise<unknown> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".json") {
    const raw = await fs.readFile(filePath, "utf8");
    try {
      return JSON.parse(raw);
    } catch (err) {
      throw new DocuForgeError(
        `Config file ${path.basename(filePath)} is not valid JSON: ${(err as Error).message}`,
        ExitCode.Usage,
      );
    }
  }
  // Config files are trusted code written by the site owner (unlike Markdown,
  // which is never executed). They are loaded with a normal dynamic import.
  // The query string defeats Node's module cache so `--watch` picks up edits to the config file.
  const mod = (await import(`${pathToFileURL(filePath).href}?t=${Date.now()}`)) as { default?: unknown };
  return mod.default ?? mod;
}

/** Locate a config file: an explicit `--config` path, or auto-discovery in `cwd`. */
export async function findConfigFile(cwd: string, explicit?: string): Promise<string | undefined> {
  if (explicit) {
    const abs = path.resolve(cwd, explicit);
    try {
      const st = await fs.stat(abs);
      if (!st.isFile()) throw new Error("not a file");
    } catch {
      throw new DocuForgeError(`Config file not found: ${explicit}`, ExitCode.Usage);
    }
    return abs;
  }
  for (const name of CONFIG_FILE_NAMES) {
    const candidate = path.join(cwd, name);
    try {
      if ((await fs.stat(candidate)).isFile()) return candidate;
    } catch {
      /* try next */
    }
  }
  return undefined;
}

/**
 * Normalize a deployment base path to `/` or `/segment/…/`.
 * Only a conservative character set is accepted so the value can be embedded
 * safely in URLs and HTML attributes.
 */
export function normalizeBasePath(input: string): string {
  const raw = input.trim();
  if (raw === "" || raw === "/" || raw === ".") return "/";
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("//")) {
    throw new DocuForgeError(
      `Invalid base path "${input}": use a path such as "/docs/", not a full URL.`,
      ExitCode.Usage,
    );
  }
  if (!/^[A-Za-z0-9._~\-/]+$/.test(raw)) {
    throw new DocuForgeError(
      `Invalid base path "${input}": only letters, digits and "._~-/" are allowed.`,
      ExitCode.Usage,
    );
  }
  const segments = raw.split("/").filter((s) => s !== "");
  if (segments.some((s) => s === "." || s === "..")) {
    throw new DocuForgeError(`Invalid base path "${input}": "." and ".." segments are not allowed.`, ExitCode.Usage);
  }
  return `/${segments.join("/")}/`;
}

/**
 * Load, validate and resolve configuration.
 * Precedence: CLI flags > config file > defaults.
 * Paths from a config file resolve relative to that file; CLI paths relative to `cwd`.
 */
export async function resolveConfig(
  cwd: string,
  opts: { configPath?: string; overrides?: CliOverrides } = {},
): Promise<ResolvedConfig> {
  const configFile = await findConfigFile(cwd, opts.configPath);
  const where = configFile ? path.basename(configFile) : "configuration";

  let rawFromFile: unknown = {};
  if (configFile) {
    try {
      rawFromFile = await importConfigFile(configFile);
    } catch (err) {
      if (err instanceof DocuForgeError) throw err;
      throw new DocuForgeError(`Failed to load ${where}: ${(err as Error).message}`, ExitCode.Usage);
    }
    if (typeof rawFromFile !== "object" || rawFromFile === null || Array.isArray(rawFromFile)) {
      throw new DocuForgeError(`${where} must export a configuration object.`, ExitCode.Usage);
    }
  }

  let parsed: DocuForgeConfig;
  try {
    parsed = ConfigSchema.parse(rawFromFile);
  } catch (err) {
    if (err instanceof ZodError) {
      const lines = formatConfigIssues(err.issues, where);
      throw new DocuForgeError(`Invalid configuration:\n  - ${lines.join("\n  - ")}`, ExitCode.Usage);
    }
    throw err;
  }

  const o = opts.overrides ?? {};
  const baseDir = configFile ? path.dirname(configFile) : cwd;

  const sourceDir = o.source !== undefined ? path.resolve(cwd, o.source) : path.resolve(baseDir, parsed.source);
  const outDir = o.out !== undefined ? path.resolve(cwd, o.out) : path.resolve(baseDir, parsed.output);

  const resolved: ResolvedConfig = {
    ...parsed,
    basePath: normalizeBasePath(o.base ?? parsed.basePath),
    includeHidden: o.includeHidden ?? parsed.includeHidden,
    includeDrafts: o.includeDrafts ?? parsed.includeDrafts,
    strictFrontMatter: o.strictFrontMatter ?? parsed.strictFrontMatter,
    strictLinks: o.strictLinks ?? parsed.strictLinks,
    sourceDir,
    outDir,
    siteAssets: { publicIcons: [] },
    ...(configFile ? { configFile } : {}),
  };

  for (const pattern of resolved.exclude) {
    if (path.isAbsolute(pattern) || pattern.split("/").includes("..")) {
      throw new DocuForgeError(
        `Invalid exclude pattern "${pattern}": patterns are relative to the source directory and cannot contain "..".`,
        ExitCode.Usage,
      );
    }
  }

  return resolved;
}

/**
 * Validate resolved paths BEFORE anything is written:
 * - the source must be an existing directory
 * - the output must not be the source or contain it (a `--clean` would delete the docs)
 * Returns the config with `sourceDir` replaced by its real path.
 */
export async function validatePaths(config: ResolvedConfig): Promise<ResolvedConfig> {
  let realSource: string;
  try {
    realSource = await fs.realpath(config.sourceDir);
    if (!(await fs.stat(realSource)).isDirectory()) throw new Error("not a directory");
  } catch {
    throw new DocuForgeError(
      `Source directory not found: ${config.sourceDir}\n  Pass --source <dir> or create a ./docs folder (try "docuforge init").`,
      ExitCode.Usage,
    );
  }

  // Resolve the output through its nearest existing ancestor so symlinks can't hide an overlap.
  let probe = config.outDir;
  const tail: string[] = [];
  while (true) {
    try {
      probe = await fs.realpath(probe);
      break;
    } catch {
      const parent = path.dirname(probe);
      if (parent === probe) break;
      tail.unshift(path.basename(probe));
      probe = parent;
    }
  }
  const realOut = path.join(probe, ...tail);

  if (isInside(realOut, realSource)) {
    throw new DocuForgeError(
      `The output directory (${config.outDir}) must not be the source directory or one of its parents.`,
      ExitCode.Usage,
    );
  }
  const siteAssets = await validateSiteAssets(config, realSource);
  return { ...config, sourceDir: realSource, outDir: realOut, siteAssets };
}

/**
 * `logo`, `favicon` and `customCss` name files inside the source directory. They are validated here,
 * before anything is written: inside the source, not hidden/private, right type, an existing regular file.
 */
async function validateSiteAssets(config: ResolvedConfig, realSource: string): Promise<SiteAssets> {
  const problems: string[] = [];
  const out: SiteAssets = { publicIcons: [] };
  const check = async (option: "logo" | "favicon" | "socialImage" | "customCss", value: string | undefined): Promise<void> => {
    if (value === undefined) return;
    const rel = value.includes("\\") ? undefined : joinWithinRoot("index.md", value);
    if (rel === undefined || rel === "" || value.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(value)) {
      problems.push(`"${option}" must be a path inside the source directory (got "${value}").`);
      return;
    }
    const denied = assetDenyReason(rel, { includeHidden: config.includeHidden });
    if (denied) return void problems.push(`"${option}" (${rel}) cannot be used: ${denied}.`);
    const ext = path.posix.extname(rel).toLowerCase();
    if (option === "customCss" ? ext !== ".css" : !IMAGE_EXTENSIONS.has(ext)) {
      problems.push(`"${option}" (${rel}) must be ${option === "customCss" ? "a .css file" : "an image (png, jpg, gif, webp, avif, svg or ico)"}.`);
      return;
    }
    const abs = path.join(realSource, ...rel.split("/"));
    try {
      const st = await fs.lstat(abs);
      if (st.isSymbolicLink() || !st.isFile() || (await fs.realpath(abs)) !== abs) {
        return void problems.push(`"${option}" (${rel}) must be a regular file (symlinks are not followed).`);
      }
      const limit = option === "customCss" ? MAX_CUSTOM_CSS_BYTES : config.limits.maxAssetSizeBytes;
      if (st.size > limit) problems.push(`"${option}" (${rel}) is ${st.size} bytes, over the ${limit}-byte limit.`);
      else out[option] = rel;
    } catch {
      problems.push(`"${option}" file not found: ${rel} (paths are relative to the source directory).`);
    }
  };
  await check("logo", config.logo);
  await check("favicon", config.favicon);
  await check("socialImage", config.socialImage);
  await check("customCss", config.customCss);

  // Conventions: icons placed in the public directory just work.
  if (config.publicDir !== false) {
    const regularFile = async (rel: string): Promise<boolean> => {
      try {
        const abs = path.join(realSource, ...rel.split("/"));
        const st = await fs.lstat(abs);
        return st.isFile() && !st.isSymbolicLink();
      } catch {
        return false;
      }
    };
    const pub = (name: string): string => `${config.publicDir as string}/${name}`;
    if (config.favicon === undefined) {
      for (const name of ["favicon.svg", "favicon.png", "favicon.ico"]) if (await regularFile(pub(name))) out.publicIcons.push(pub(name));
    }
    if (await regularFile(pub("apple-touch-icon.png"))) out.appleTouchIcon = pub("apple-touch-icon.png");
    if (config.socialImage === undefined) {
      for (const name of ["og-image.png", "og-image.jpg", "og-image.jpeg", "og-image.webp"]) {
        if (await regularFile(pub(name))) {
          out.socialImage = pub(name);
          break;
        }
      }
    }
  }
  if (problems.length > 0) {
    throw new DocuForgeError(`Invalid configuration:\n  - ${problems.join("\n  - ")}`, ExitCode.Usage);
  }
  return out;
}
