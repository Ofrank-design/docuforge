import fs from "node:fs";
import path from "node:path";
import { resolveConfig, validatePaths } from "../config/load.js";
import { lockDirFor } from "../build/lock.js";
import { stagingDirFor } from "../build/commit.js";
import { ALWAYS_IGNORED_DIRS } from "../scanner/scan.js";
import { DocuForgeError, ExitCode, type ExitCodeValue } from "../util/errors.js";
import { isInside, toPosix } from "../util/paths.js";
import type { Logger } from "../util/logger.js";
import { buildCommand, type BuildFlags } from "./build.js";

export interface WatchHooks {
  /** Called after every build attempt (the first one included) with its exit code. */
  onBuild?: (code: ExitCodeValue) => void;
}

export interface WatchController {
  /** Stop watching and wait for a build in progress to finish. */
  close(): Promise<void>;
}

export const DEBOUNCE_MS = 150;

/**
 * Build once, then rebuild whenever the source, public files or config change.
 *
 * - Events are debounced, so saving many files (or an editor's write-rename dance) is one rebuild.
 * - Builds never overlap: a change during a build queues exactly one more build afterwards.
 * - Nothing the build itself writes can trigger a build: the output, staging and lock directories are ignored.
 * - A failed build (broken link in strict mode, bad config…) is reported and watching continues; because the
 *   output is only replaced by a successful build, the last good site stays in place.
 */
export async function startWatch(flags: BuildFlags, cwd: string, log: Logger, hooks: WatchHooks = {}, debounceMs = DEBOUNCE_MS): Promise<WatchController> {
  // Fail fast (exit code 2) on an unusable configuration instead of watching nothing.
  const initial = await validatePaths(
    await resolveConfig(cwd, { ...(flags.config !== undefined ? { configPath: flags.config } : {}), overrides: flags }),
  );
  const { sourceDir, outDir, configFile, includeHidden } = initial;
  const ignoredRoots = [outDir, stagingDirFor(outDir), lockDirFor(outDir)];

  let closed = false;
  let pending = false;
  let timer: NodeJS.Timeout | undefined;
  /** The build loop that is running right now, if any. close() waits for exactly this. */
  let inflight: Promise<void> | undefined;
  let first = true;
  const changed = new Set<string>();

  const relevant = (abs: string): boolean => {
    if (ignoredRoots.some((r) => isInside(r, abs))) return false;
    if (!isInside(sourceDir, abs)) return true; // the config file
    const rel = toPosix(path.relative(sourceDir, abs));
    return !rel.split("/").some((seg) => ALWAYS_IGNORED_DIRS.has(seg) || (!includeHidden && seg.startsWith(".") && seg !== ".well-known" && seg !== ".nojekyll"));
  };

  const rebuild = (): Promise<void> => {
    if (inflight) {
      pending = true; // one more build runs after the current one
      return inflight;
    }
    inflight = (async () => {
      try {
        await buildLoop();
      } finally {
        inflight = undefined;
      }
    })();
    return inflight;
  };

  const buildLoop = async (): Promise<void> => {
    {
      do {
        pending = false;
        if (!first && changed.size > 0) {
          const names = [...changed].slice(0, 3).join(", ");
          log.info(`Change detected: ${names}${changed.size > 3 ? ` (+${changed.size - 3} more)` : ""}. Rebuilding…`);
        }
        changed.clear();
        let code: ExitCodeValue;
        try {
          code = await buildCommand(first ? flags : { ...flags, clean: false }, cwd, log);
        } catch (err) {
          if (err instanceof DocuForgeError) {
            log.error(err.message);
            code = err.exitCode;
          } else {
            log.error(`Unexpected error: ${(err as Error).message}`);
            code = ExitCode.Internal;
          }
        }
        first = false;
        hooks.onBuild?.(code);
      } while (pending && !closed);
    }
  };

  const schedule = (abs: string | null): void => {
    if (closed) return;
    if (abs !== null) {
      if (!relevant(abs)) return;
      changed.add(isInside(sourceDir, abs) ? toPosix(path.relative(sourceDir, abs)) : path.basename(abs));
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void rebuild();
    }, debounceMs);
  };

  const watchers: fs.FSWatcher[] = [];
  const onError = (err: Error): void => log.error(`File watcher error: ${err.message}`);
  const sourceWatcher = fs.watch(sourceDir, { recursive: true }, (_event, filename) => schedule(filename ? path.join(sourceDir, String(filename)) : null));
  sourceWatcher.on("error", onError);
  watchers.push(sourceWatcher);
  if (configFile && !isInside(sourceDir, configFile)) {
    const dir = path.dirname(configFile);
    const w = fs.watch(dir, (_event, filename) => {
      if (filename && path.join(dir, String(filename)) === configFile) schedule(configFile);
    });
    w.on("error", onError);
    watchers.push(w);
  }

  await rebuild();
  log.info(`Watching ${path.relative(cwd, sourceDir) || "."} for changes (Ctrl+C to stop).`);

  return {
    async close() {
      closed = true;
      if (timer) clearTimeout(timer);
      for (const w of watchers) w.close();
      await inflight; // let a running build finish, so no staging or lock folder is left behind
    },
  };
}
