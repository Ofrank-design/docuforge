import { resolveConfig, validatePaths, type CliOverrides } from "../config/load.js";
import { discover } from "../build/pipeline.js";
import { prepareOutputDir } from "../build/output.js";
import { commitStaging, createStagingDir, removeStagingDir } from "../build/commit.js";
import { StagingWriter } from "../build/staging.js";
import { acquireBuildLock } from "../build/lock.js";
import { renderSite } from "../renderer/render.js";
import { Diagnostics } from "../util/diagnostics.js";
import { ExitCode, type ExitCodeValue } from "../util/errors.js";
import type { Logger } from "../util/logger.js";
import { renderTreeText } from "../navigation/tree.js";
import { formatDuration, joinList, plural } from "../util/text.js";

export interface BuildFlags extends CliOverrides {
  config?: string;
  clean?: boolean;
  verbose?: boolean;
}

function printDiagnostics(diags: Diagnostics, log: Logger): void {
  for (const d of diags.sorted()) {
    const where = d.file ? `${d.file}: ` : "";
    const line = `${where}${d.message} [${d.code}]`;
    if (d.level === "error") log.error(line);
    else log.warn(line);
  }
}

export async function buildCommand(flags: BuildFlags, cwd: string, log: Logger): Promise<ExitCodeValue> {
  const started = performance.now();

  const resolved = await resolveConfig(cwd, {
    ...(flags.config !== undefined ? { configPath: flags.config } : {}),
    overrides: flags,
  });
  const config = await validatePaths(resolved);
  if (config.configFile) log.verbose(`config: ${config.configFile}`);
  log.verbose(`source: ${config.sourceDir}`);
  log.verbose(`output: ${config.outDir}`);

  const diags = new Diagnostics();
  const discovery = await discover(config, diags);

  if (discovery.documents.length === 0 && !diags.hasErrors) {
    diags.error(
      "source.empty",
      discovery.excludedDrafts.length > 0
        ? `Every document in the source folder is a draft, so there is nothing to publish. Use --include-drafts to build them anyway.`
        : 'No Markdown files (.md or .markdown) were found in the source folder. Check the --source path, or run "docuforge init" to create starter pages.',
    );
  }
  if (diags.hasErrors) {
    printDiagnostics(diags, log);
    log.error(`Build failed with ${plural(diags.errors.length, "error")}, so nothing was written. Fix the problems above and run the build again.`);
    return ExitCode.BuildFailed;
  }

  if (flags.verbose) {
    log.verbose("navigation:");
    log.verbose(renderTreeText(discovery.tree));
  }

  // One writer at a time per output directory; then render into a staging directory first,
  // so the real output is only touched once the build is known to be good.
  const release = await acquireBuildLock(config.outDir);
  let stagingDir: string | undefined;
  try {
    stagingDir = await createStagingDir(config.outDir);
    const writer = new StagingWriter(stagingDir, diags);
    const stats = await renderSite(config, discovery, writer, diags);

    printDiagnostics(diags, log);
    if (diags.hasErrors) {
      log.error(`Build failed with ${plural(diags.errors.length, "error")}, and the output directory was not modified. Your previous site is still in place.`);
      return ExitCode.BuildFailed;
    }

    const prep = await prepareOutputDir(config.outDir, flags.clean === true);
    if (prep.foreignContent) {
      log.warn("Output directory is not empty and was not created by DocuForge; existing files may be overwritten.");
    }
    const commit = await commitStaging(stagingDir, config.outDir, writer.files);

    const elapsed = Math.round(performance.now() - started);
    const copied = stats.assets + stats.publicFiles;
    const sections = stats.generatedPages > 0 ? ` and ${plural(stats.generatedPages, "section page")}` : "";
    log.success(`Built ${plural(stats.pages, "page")}${sections} in ${formatDuration(elapsed)}.`);
    const details = [
      [copied > 0 ? `Copied ${plural(copied, "asset")}.` : "", stats.searchDocs > 0 ? `Search covers ${plural(stats.searchDocs, "page")}.` : ""],
      [stats.siteFiles.length > 0 ? `Also wrote ${joinList(stats.siteFiles)}.` : ""],
      [discovery.excludedDrafts.length > 0 ? `Left out ${plural(discovery.excludedDrafts.length, "draft")}. Use --include-drafts to publish drafts.` : ""],
      [commit.removedStale > 0 ? `Removed ${plural(commit.removedStale, "stale file")} from the previous build.` : ""],
      [diags.warnings.length > 0 ? `${plural(diags.warnings.length, "warning")} listed above.` : ""],
    ];
    for (const parts of details) {
      const line = parts.filter(Boolean).join(" ");
      if (line) log.info(`  ${line}`);
    }
    return ExitCode.Ok;
  } finally {
    if (stagingDir !== undefined) await removeStagingDir(stagingDir);
    await release();
  }
}
