import type { ResolvedConfig } from "../config/load.js";
import type { Diagnostics } from "../util/diagnostics.js";
import { scanSource, type ScanStats } from "../scanner/scan.js";
import { loadDocuments, type DocumentMeta } from "../markdown/document.js";
import { buildNavTree, type NavTree } from "../navigation/tree.js";

export interface DiscoveryResult {
  documents: DocumentMeta[];
  excludedDrafts: string[];
  tree: NavTree;
  scan: ScanStats;
  scannedFiles: number;
}

/** Phase 1 pipeline: scan -> front matter -> routes -> navigation tree. No filesystem writes. */
export async function discover(config: ResolvedConfig, diags: Diagnostics): Promise<DiscoveryResult> {
  const scan = await scanSource(
    {
      sourceDir: config.sourceDir,
      outDir: config.outDir,
      includeHidden: config.includeHidden,
      exclude: config.exclude,
      maxDocuments: config.limits.maxDocuments,
      maxFileSizeBytes: config.limits.maxFileSizeBytes,
    },
    diags,
  );

  const { documents, excludedDrafts } = await loadDocuments(
    scan.files,
    {
      strictFrontMatter: config.strictFrontMatter,
      includeDrafts: config.includeDrafts,
      concurrency: config.concurrency,
      maxFileSizeBytes: config.limits.maxFileSizeBytes,
    },
    diags,
  );

  const tree = buildNavTree(documents, config.navigation.sort, config.title);
  return { documents, excludedDrafts, tree, scan: scan.stats, scannedFiles: scan.files.length };
}
