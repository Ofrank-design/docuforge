import fs from "node:fs/promises";
import path from "node:path";
import type { Diagnostics } from "../util/diagnostics.js";
import type { StagingWriter } from "../build/staging.js";
import { compareStrings } from "../util/text.js";
import { assetDenyReason, hasAllowedAssetExtension, isSecretName } from "./policy.js";
import { sanitizeSvg, SvgRejected } from "./svg.js";

export interface AssetOptions {
  /** Real (symlink-resolved) absolute source directory. */
  sourceDir: string;
  includeHidden: boolean;
  maxAssetSizeBytes: number;
  svg: "sanitize" | "skip";
  strictLinks: boolean;
  /** Public directory relative to the source, if enabled. */
  publicDir: string | false;
}

type Outcome = { ok: true; outPath: string } | { ok: false };

/**
 * Copies assets referenced from Markdown into the staging directory,
 * mirroring their source-relative paths. Every file is checked against the
 * deny policy, the extension allowlist, the size limit and symlink rules.
 */
export class AssetCollector {
  private readonly cache = new Map<string, Promise<Outcome>>();
  private copied = 0;

  constructor(
    private readonly opts: AssetOptions,
    private readonly writer: StagingWriter,
    private readonly diags: Diagnostics,
  ) {}

  /** Number of distinct assets successfully copied. */
  get copiedCount(): number {
    return this.copied;
  }

  /** Resolve (and copy) a referenced asset. Returns its output path relative to the site root. */
  async reference(relPath: string, fromDoc: string): Promise<string | undefined> {
    let pending = this.cache.get(relPath);
    if (!pending) {
      pending = this.copy(relPath, fromDoc);
      this.cache.set(relPath, pending);
    }
    const outcome = await pending;
    return outcome.ok ? outcome.outPath : undefined;
  }

  private fail(code: string, message: string, fromDoc: string): Outcome {
    this.diags.report(this.opts.strictLinks, code, message, fromDoc);
    return { ok: false };
  }

  private async copy(relPath: string, fromDoc: string): Promise<Outcome> {
    const { sourceDir } = this.opts;

    const denied = assetDenyReason(relPath, { includeHidden: this.opts.includeHidden });
    if (denied) return this.fail("asset.denied", `Not copying "${relPath}": ${denied}.`, fromDoc);
    if (!hasAllowedAssetExtension(relPath)) {
      return this.fail("asset.type-not-allowed", `Not copying "${relPath}": file type is not an allowed asset type.`, fromDoc);
    }
    if (relPath.toLowerCase().endsWith(".svg") && this.opts.svg === "skip") {
      return this.fail("asset.svg-skipped", `Not copying "${relPath}": SVG assets are disabled (svg: "skip").`, fromDoc);
    }

    const abs = path.join(sourceDir, ...relPath.split("/"));
    let stat;
    try {
      stat = await fs.lstat(abs);
    } catch {
      return this.fail("asset.missing", `Missing asset "${relPath}".`, fromDoc);
    }
    if (stat.isSymbolicLink()) {
      return this.fail("asset.symlink", `Not copying "${relPath}": symlinks are not followed.`, fromDoc);
    }
    if (!stat.isFile()) return this.fail("asset.missing", `Asset "${relPath}" is not a file.`, fromDoc);

    // A symlinked *directory* in the middle of the path would escape lstat above.
    try {
      const real = await fs.realpath(abs);
      if (real !== path.join(sourceDir, ...relPath.split("/"))) {
        return this.fail("asset.symlink", `Not copying "${relPath}": its path goes through a symlink.`, fromDoc);
      }
    } catch {
      return this.fail("asset.missing", `Missing asset "${relPath}".`, fromDoc);
    }

    if (stat.size > this.opts.maxAssetSizeBytes) {
      return this.fail(
        "asset.too-large",
        `Not copying "${relPath}": ${stat.size} bytes is over the ${this.opts.maxAssetSizeBytes}-byte limit (limits.maxAssetSizeBytes).`,
        fromDoc,
      );
    }

    let data: Uint8Array | string;
    try {
      data = new Uint8Array(await fs.readFile(abs));
    } catch {
      return this.fail("asset.unreadable", `Cannot read asset "${relPath}".`, fromDoc);
    }

    if (relPath.toLowerCase().endsWith(".svg")) {
      try {
        data = await sanitizeSvg(Buffer.from(data).toString("utf8"));
      } catch (err) {
        const reason = err instanceof SvgRejected ? err.message : "could not be parsed";
        return this.fail("asset.svg-invalid", `Not copying "${relPath}": SVG ${reason}.`, fromDoc);
      }
    }

    const written = await this.writer.write(relPath, data, fromDoc);
    if (!written) return { ok: false };
    this.copied++;
    return { ok: true, outPath: relPath };
  }
}

/**
 * Copy the public directory (non-Markdown files) to the site root.
 * Returns the number of files copied.
 */
export async function copyPublicDir(
  opts: AssetOptions,
  writer: StagingWriter,
  diags: Diagnostics,
): Promise<number> {
  if (opts.publicDir === false) return 0;
  const root = path.join(opts.sourceDir, opts.publicDir);
  let rootStat;
  try {
    rootStat = await fs.lstat(root);
  } catch {
    return 0; // optional directory
  }
  if (!rootStat.isDirectory()) return 0;
  const realRoot = await fs.realpath(root);
  if (realRoot !== root && !realRoot.startsWith(opts.sourceDir + path.sep)) {
    diags.warn("public.outside-source", `Public directory "${opts.publicDir}" resolves outside the source directory; ignoring it.`);
    return 0;
  }

  let copied = 0;
  const stack: string[] = [""];
  while (stack.length > 0) {
    const rel = stack.pop() as string;
    const entries = await fs.readdir(path.join(root, rel), { withFileTypes: true });
    entries.sort((a, b) => compareStrings(a.name, b.name));
    for (const entry of entries) {
      const entryRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      const display = `${opts.publicDir}/${entryRel}`;
      if (entry.isSymbolicLink()) {
        diags.warn("public.symlink-skipped", "Skipping symlink in public directory.", display);
        continue;
      }
      if (entry.isDirectory()) {
        if (assetDenyReason(entryRel, { includeHidden: opts.includeHidden })) continue;
        stack.push(entryRel);
        continue;
      }
      if (!entry.isFile()) continue;
      if (/\.(md|markdown)$/i.test(entry.name)) continue; // Markdown is documentation, scanned separately
      const denied = assetDenyReason(entryRel, { includeHidden: opts.includeHidden });
      if (denied) {
        if (isSecretName(entry.name)) diags.warn("public.denied", `Not copying: ${denied}.`, display);
        continue;
      }
      const abs = path.join(root, entryRel);
      const st = await fs.lstat(abs);
      if (st.size > opts.maxAssetSizeBytes) {
        diags.warn("asset.too-large", `Not copying: ${st.size} bytes is over the ${opts.maxAssetSizeBytes}-byte limit.`, display);
        continue;
      }
      let data: Uint8Array | string = new Uint8Array(await fs.readFile(abs));
      if (entry.name.toLowerCase().endsWith(".svg")) {
        if (opts.svg === "skip") continue;
        try {
          data = await sanitizeSvg(Buffer.from(data).toString("utf8"));
        } catch {
          diags.warn("asset.svg-invalid", "Not copying: SVG could not be sanitized.", display);
          continue;
        }
      }
      if (await writer.write(entryRel, data, display)) copied++;
    }
  }
  return copied;
}
