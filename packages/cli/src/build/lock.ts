import fs from "node:fs/promises";
import path from "node:path";
import { DocuForgeError, ExitCode } from "../util/errors.js";

/** The lock lives beside the output directory (like the staging directory), never inside the published files. */
export function lockDirFor(outDir: string): string {
  return path.join(path.dirname(outDir), `.${path.basename(outDir)}.docuforge-lock`);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM"; // exists, but owned by someone else
  }
}

async function readPid(lockDir: string): Promise<number | undefined> {
  try {
    const n = Number.parseInt(await fs.readFile(path.join(lockDir, "pid"), "utf8"), 10);
    return Number.isInteger(n) && n > 0 ? n : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Take an exclusive lock for writing `outDir`, so two builds can never share one staging directory
 * or interleave their final moves. `mkdir` is atomic, which makes it a reliable cross-process mutex.
 * A lock left behind by a crashed process (its pid no longer exists) is taken over.
 * Returns a function that releases the lock.
 */
export async function acquireBuildLock(outDir: string): Promise<() => Promise<void>> {
  const lockDir = lockDirFor(outDir);
  await fs.mkdir(path.dirname(lockDir), { recursive: true });

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await fs.mkdir(lockDir);
      await fs.writeFile(path.join(lockDir, "pid"), String(process.pid));
      return async () => {
        await fs.rm(lockDir, { recursive: true, force: true });
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      const pid = await readPid(lockDir);
      if (pid !== undefined && isAlive(pid)) {
        throw new DocuForgeError(
          `Another DocuForge build (process ${pid}) is already writing to this output directory. Wait for it to finish, or stop it first.`,
          ExitCode.BuildFailed,
        );
      }
      // stale (crashed) or half-created lock: remove and retry
      await fs.rm(lockDir, { recursive: true, force: true });
    }
  }
  throw new DocuForgeError("Could not acquire the build lock for the output directory.", ExitCode.BuildFailed);
}
