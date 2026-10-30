import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

/** Write a file atomically: write to a sibling temp file, then rename. */
export async function writeFileAtomic(filePath: string, data: string | Uint8Array): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, filePath);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.lstat(p);
    return true;
  } catch {
    return false;
  }
}
