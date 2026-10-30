import fs from "node:fs/promises";
import path from "node:path";
import { DocuForgeError, ExitCode } from "../util/errors.js";
import { resolveInside } from "../util/paths.js";
import { writeFileAtomic } from "../util/fs.js";

export const MANIFEST_FILE = ".docuforge-manifest.json";

/** Staging lives beside the output directory so the final move is a same-filesystem rename. */
export function stagingDirFor(outDir: string): string {
  return path.join(path.dirname(outDir), `.${path.basename(outDir)}.docuforge-staging`);
}

export async function createStagingDir(outDir: string): Promise<string> {
  const dir = stagingDirFor(outDir);
  await fs.rm(dir, { recursive: true, force: true }); // leftover from a crashed build
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function removeStagingDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

async function readOldManifest(outDir: string): Promise<string[]> {
  try {
    const data = JSON.parse(await fs.readFile(path.join(outDir, MANIFEST_FILE), "utf8")) as { files?: unknown };
    if (!Array.isArray(data.files)) return [];
    const safe: string[] = [];
    for (const f of data.files) {
      if (typeof f !== "string") continue;
      try {
        resolveInside(outDir, f); // ignore any entry that would point outside the output directory
        safe.push(f);
      } catch {
        /* skip */
      }
    }
    return safe;
  } catch {
    return [];
  }
}

async function pruneEmptyDirs(outDir: string, fromDir: string): Promise<void> {
  let dir = fromDir;
  while (dir !== outDir && dir.startsWith(outDir + path.sep)) {
    try {
      await fs.rmdir(dir); // fails if not empty
    } catch {
      return;
    }
    dir = path.dirname(dir);
  }
}

export interface CommitResult {
  written: number;
  removedStale: number;
}

/**
 * Move staged files into the real output directory, then delete files that a
 * previous DocuForge build produced but this one did not (stale pages).
 * Only paths listed in the previous manifest are ever deleted.
 */
export async function commitStaging(stagingDir: string, outDir: string, files: string[]): Promise<CommitResult> {
  const previous = await readOldManifest(outDir);

  for (const rel of files) {
    const from = resolveInside(stagingDir, rel);
    const to = resolveInside(outDir, rel);
    await fs.mkdir(path.dirname(to), { recursive: true });
    try {
      await fs.rm(to, { force: true });
    } catch {
      throw new DocuForgeError(`Cannot replace directory with a file at ${rel} in the output directory.`, ExitCode.BuildFailed);
    }
    await fs.rename(from, to);
  }

  const current = new Set(files);
  let removedStale = 0;
  for (const rel of previous) {
    if (current.has(rel)) continue;
    const abs = resolveInside(outDir, rel);
    try {
      await fs.rm(abs, { force: true });
      removedStale++;
      await pruneEmptyDirs(outDir, path.dirname(abs));
    } catch {
      /* best effort */
    }
  }

  await writeFileAtomic(path.join(outDir, MANIFEST_FILE), `${JSON.stringify({ version: 1, files: [...files].sort() }, null, 2)}\n`);
  return { written: files.length, removedStale };
}
