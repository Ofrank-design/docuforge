import { resolveConfig } from "../config/load.js";
import { DEFAULT_HOST, DEFAULT_PORT, isLoopback, startPreviewServer } from "../preview/server.js";
import { DocuForgeError, ExitCode, type ExitCodeValue } from "../util/errors.js";
import type { Logger } from "../util/logger.js";
import { waitForShutdown } from "./shutdown.js";

export interface PreviewFlags {
  out?: string;
  config?: string;
  host?: string;
  port?: string;
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_PORT;
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || n > 65535) throw new DocuForgeError(`Invalid --port "${raw}": use a number from 0 to 65535.`, ExitCode.Usage);
  return n;
}

/** `docuforge preview`: serve the built output locally. Needs only the output directory, not the Markdown source. */
export async function previewCommand(flags: PreviewFlags, cwd: string, log: Logger, signal?: AbortSignal): Promise<ExitCodeValue> {
  const config = await resolveConfig(cwd, {
    ...(flags.config !== undefined ? { configPath: flags.config } : {}),
    overrides: { ...(flags.out !== undefined ? { out: flags.out } : {}) },
  });
  const host = flags.host ?? DEFAULT_HOST;
  if (!/^[A-Za-z0-9.:\-[\]]+$/.test(host)) throw new DocuForgeError(`Invalid --host "${host}".`, ExitCode.Usage);
  const port = parsePort(flags.port);

  const server = await startPreviewServer({ outDir: config.outDir, host, port });
  if (!isLoopback(host)) {
    log.warn(`Listening on ${host}: this preview server is reachable from other machines on your network. It is meant for local inspection only.`);
  }
  log.success(`Previewing the built site at ${server.url}`);
  log.info("Press Ctrl+C to stop.");
  await waitForShutdown(signal);
  await server.close();
  log.info("Preview stopped.");
  return ExitCode.Ok;
}
