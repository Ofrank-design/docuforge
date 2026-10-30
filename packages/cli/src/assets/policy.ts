import path from "node:path";

/** File types that may be copied when referenced from Markdown. */
export const ASSET_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg", ".ico",
  ".pdf", ".zip", ".txt", ".csv", ".json", ".mp4", ".webm",
]);

const SECRET_NAME_PATTERNS: RegExp[] = [
  /^\.env(\..*)?$/i,
  /^\.npmrc$/i,
  /^\.htpasswd$/i,
  /^\.netrc$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /\.(pem|key|p12|pfx|keystore|jks|kdbx)$/i,
  /^(credentials|secrets?)(\..*)?$/i,
];

/** Hidden entries that are legitimately published from the public directory. */
const HIDDEN_ALLOWED = new Set([".nojekyll", ".well-known"]);

export function isSecretName(name: string): boolean {
  return SECRET_NAME_PATTERNS.some((re) => re.test(name));
}

/**
 * Why a source-relative path must not be copied, or `undefined` if it is allowed.
 * Applies to every path segment, so `a/.git/x.png` and `.private/pic.png` are refused.
 */
export function assetDenyReason(relPath: string, opts: { includeHidden: boolean }): string | undefined {
  for (const seg of relPath.split("/")) {
    if (seg === "" || seg === "." || seg === "..") return "invalid path";
    if (seg === ".git" || seg === "node_modules") return `inside "${seg}"`;
    if (isSecretName(seg)) return "looks like a private/credential file";
    if (seg.startsWith(".") && !opts.includeHidden && !HIDDEN_ALLOWED.has(seg)) return "hidden file or folder";
  }
  return undefined;
}

export function hasAllowedAssetExtension(relPath: string): boolean {
  return ASSET_EXTENSIONS.has(path.posix.extname(relPath).toLowerCase());
}
