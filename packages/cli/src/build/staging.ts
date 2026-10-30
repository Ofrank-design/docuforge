import fs from "node:fs/promises";
import path from "node:path";
import type { Diagnostics } from "../util/diagnostics.js";
import { resolveInside } from "../util/paths.js";

/**
 * Collects generated files in a staging directory. Refuses to write the same
 * output path twice (case-insensitively, so collisions are caught even when
 * the target filesystem folds case) and never writes outside staging.
 */
export class StagingWriter {
  private readonly seen = new Map<string, string>();

  constructor(
    readonly dir: string,
    private readonly diags: Diagnostics,
  ) {}

  get files(): string[] {
    return [...this.seen.values()].sort();
  }

  has(rel: string): boolean {
    return this.seen.has(rel.toLowerCase());
  }

  /** Returns false (and records an error) if `rel` was already produced. */
  async write(rel: string, data: string | Uint8Array, origin?: string): Promise<boolean> {
    const key = rel.toLowerCase();
    const existing = this.seen.get(key);
    if (existing !== undefined) {
      this.diags.error(
        "output.collision",
        `Output file "${rel}" would overwrite "${existing}", which was already generated; skipped.`,
        origin,
      );
      return false;
    }
    const abs = resolveInside(this.dir, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, data);
    this.seen.set(key, rel);
    return true;
  }
}
