import path from "node:path";

/** Convert an OS-specific relative path to a forward-slash path. */
export function toPosix(p: string): string {
  return path.sep === "/" ? p : p.split(path.sep).join("/");
}

/** True when `child` is `parent` or lives inside it (both must be absolute). */
export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Resolve `relative` under `root` and throw if the result escapes `root`.
 * Used before every filesystem write so output paths can never leave the
 * destination directory.
 */
export function resolveInside(root: string, relative: string): string {
  const resolved = path.resolve(root, relative);
  if (!isInside(root, resolved)) {
    throw new Error(`Path escapes its root directory: ${relative}`);
  }
  return resolved;
}
