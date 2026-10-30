import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { afterEach } from "vitest";

const created: string[] = [];

afterEach(async () => {
  while (created.length) {
    const dir = created.pop() as string;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

/** Create a temp directory populated from `{ "a/b.md": "content" }`. Returns its real path. */
export async function makeTree(files: Record<string, string> = {}): Promise<string> {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "docuforge-")));
  created.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content);
  }
  return dir;
}

export function isRoot(): boolean {
  return typeof process.getuid === "function" && process.getuid() === 0;
}

/** Writable stream that records everything written to it. */
export class Capture extends Writable {
  text = "";
  override _write(chunk: Buffer | string, _enc: BufferEncoding, cb: () => void): void {
    this.text += chunk.toString();
    cb();
  }
}

/** A valid 1x1 transparent PNG. */
export const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/** Create a temp site: Markdown/text files from `files`, binary files from `binary`. */
export async function makeSite(
  files: Record<string, string>,
  binary: Record<string, Buffer> = {},
): Promise<string> {
  const dir = await makeTree(files);
  for (const [rel, data] of Object.entries(binary)) {
    const abs = path.join(dir, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, data);
  }
  return dir;
}
