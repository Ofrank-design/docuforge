import fs from "node:fs/promises";
import { constants as fsConstants, type Dirent } from "node:fs";
import path from "node:path";
import picomatch from "picomatch";
import { DocuForgeError, ExitCode } from "../util/errors.js";
import type { Diagnostics } from "../util/diagnostics.js";
import { isMarkdownFile } from "../navigation/routes.js";
import { compareStrings } from "../util/text.js";

/** Directories that are never scanned, even with `includeHidden`. */
export const ALWAYS_IGNORED_DIRS = new Set([".git", ".svn", ".hg", "node_modules", ".next", ".vite"]);

export interface ScanOptions {
  /** Absolute, symlink-resolved source directory. */
  sourceDir: string;
  /** Absolute output directory; never scanned. */
  outDir?: string;
  includeHidden: boolean;
  /** Glob patterns relative to the source directory. */
  exclude: string[];
  maxDocuments: number;
  maxFileSizeBytes: number;
}

export interface ScannedFile {
  absPath: string;
  /** Forward-slash path relative to the source directory. */
  relPath: string;
  size: number;
}

export interface ScanStats {
  directories: number;
  ignoredFiles: number;
  skippedSymlinks: number;
  skippedTooLarge: number;
  skippedUnreadable: number;
}

export interface ScanResult {
  files: ScannedFile[];
  stats: ScanStats;
}

function errCode(err: unknown): string {
  return (err as NodeJS.ErrnoException).code ?? "UNKNOWN";
}

/**
 * Recursively discover Markdown files.
 *
 * - iterative (no recursion limits), directories pruned before descent
 * - never follows symlinks; reports Markdown files/directories that are symlinks
 * - skips hidden entries unless `includeHidden`
 * - never descends into the output directory
 * - bounded by `maxDocuments` and `maxFileSizeBytes`
 * - output is sorted, so the result is deterministic
 */
export async function scanSource(opts: ScanOptions, diags: Diagnostics): Promise<ScanResult> {
  const root = opts.sourceDir;
  const excluded = opts.exclude.length > 0 ? picomatch(opts.exclude, { dot: true }) : () => false;
  const files: ScannedFile[] = [];
  const stats: ScanStats = {
    directories: 0,
    ignoredFiles: 0,
    skippedSymlinks: 0,
    skippedTooLarge: 0,
    skippedUnreadable: 0,
  };

  const stack: string[] = [""];
  while (stack.length > 0) {
    const relDir = stack.pop() as string;
    const absDir = relDir === "" ? root : path.join(root, relDir);

    let entries: Dirent[];
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch (err) {
      if (relDir === "") {
        throw new DocuForgeError(`Cannot read source directory (${errCode(err)}).`, ExitCode.Usage);
      }
      stats.skippedUnreadable++;
      diags.warn("scan.unreadable-directory", `Cannot read directory (${errCode(err)}); skipping it.`, relDir);
      continue;
    }
    stats.directories++;
    entries.sort((a, b) => compareStrings(a.name, b.name));

    for (const entry of entries) {
      const name = entry.name;
      const relPath = relDir === "" ? name : `${relDir}/${name}`;
      const absPath = path.join(absDir, name);

      if (name.startsWith(".") && !opts.includeHidden) {
        if (entry.isFile()) stats.ignoredFiles++;
        continue;
      }

      if (entry.isSymbolicLink()) {
        stats.skippedSymlinks++;
        // Only mention symlinks that would have mattered.
        let mattered = isMarkdownFile(name);
        if (!mattered) {
          try {
            mattered = (await fs.stat(absPath)).isDirectory();
          } catch {
            mattered = false;
          }
        }
        if (mattered) {
          diags.warn("scan.symlink-skipped", "Skipping symlink (symlinks are not followed).", relPath);
        }
        continue;
      }

      if (entry.isDirectory()) {
        if (ALWAYS_IGNORED_DIRS.has(name)) continue;
        if (opts.outDir !== undefined && absPath === opts.outDir) continue;
        if (excluded(relPath) || excluded(`${relPath}/`)) continue;
        stack.push(relPath);
        continue;
      }

      if (!entry.isFile()) continue;

      if (!isMarkdownFile(name)) {
        stats.ignoredFiles++;
        continue;
      }
      if (excluded(relPath)) continue;

      let size: number;
      try {
        size = (await fs.lstat(absPath)).size;
        await fs.access(absPath, fsConstants.R_OK);
      } catch (err) {
        stats.skippedUnreadable++;
        diags.warn("scan.unreadable-file", `Cannot read file (${errCode(err)}); skipping it.`, relPath);
        continue;
      }

      if (size > opts.maxFileSizeBytes) {
        stats.skippedTooLarge++;
        diags.warn(
          "scan.file-too-large",
          `File is ${size} bytes, over the ${opts.maxFileSizeBytes}-byte limit (limits.maxFileSizeBytes); skipping it.`,
          relPath,
        );
        continue;
      }

      files.push({ absPath, relPath, size });
      if (files.length > opts.maxDocuments) {
        throw new DocuForgeError(
          `Found more than ${opts.maxDocuments} Markdown files. Raise "limits.maxDocuments" in your config if this is intended.`,
          ExitCode.Usage,
        );
      }
    }
  }

  files.sort((a, b) => compareStrings(a.relPath, b.relPath));
  return { files, stats };
}
