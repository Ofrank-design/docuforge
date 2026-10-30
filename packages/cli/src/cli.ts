import fs from "node:fs";
import { Command, CommanderError, Option } from "commander";
import { buildCommand } from "./commands/build.js";
import { initCommand } from "./commands/init.js";
import { previewCommand } from "./commands/preview.js";
import { startWatch } from "./commands/watch.js";
import { waitForShutdown } from "./commands/shutdown.js";
import { DocuForgeError, ExitCode, type ExitCodeValue } from "./util/errors.js";
import { createLogger } from "./util/logger.js";

export interface RunEnv {
  cwd: string;
  /** Lets a caller stop long-running commands (watch, preview); the real CLI stops on Ctrl+C. */
  signal?: AbortSignal;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}

function readVersion(): string {
  const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
  return pkg.version;
}

/** Run the CLI and return a process exit code (never calls process.exit itself). */
export async function run(argv: string[], env: RunEnv): Promise<ExitCodeValue> {
  const stdout = env.stdout ?? process.stdout;
  const stderr = env.stderr ?? process.stderr;
  let verbose = argv.includes("--verbose");
  let code: ExitCodeValue = ExitCode.Ok;

  const program = new Command();
  program
    .name("docuforge")
    .description("DocuForge turns a folder of Markdown files into a static documentation site.\nIt builds navigation, search, a table of contents and a 404 page, with no configuration needed.")
    .version(readVersion(), "-V, --version", "print the version")
    .exitOverride()
    .configureOutput({
      writeOut: (s) => void stdout.write(s),
      writeErr: (s) => void stderr.write(s),
    });

  program
    .command("build")
    .description("build the documentation site")
    .option("--source <dir>", "source directory containing Markdown (default: ./docs)")
    .option("--out <dir>", "output directory (default: ./dist)")
    .option("--config <file>", "configuration file (default: docuforge.config.{mjs,js,cjs,json} in the current directory)")
    .option("--base <path>", "deployment base path, e.g. /docs/ (default: /)")
    .option("--clean", "empty the output directory first (only if DocuForge created it)")
    .option("--include-drafts", "include documents marked draft: true")
    .option("--include-hidden", "include hidden files and folders")
    .option("--strict-frontmatter", "fail the build on invalid front matter")
    .option("--strict-links", "fail the build on broken internal links, anchors and missing assets")
    .option("--watch", "rebuild whenever the source, public files or config change (Ctrl+C to stop)")
    .option("--verbose", "show detailed diagnostics")
    .addHelpText(
      "after",
      `
Examples:
  $ docuforge build
  $ docuforge build --source ./docs --out ./dist
  $ docuforge build --base /my-project/ --clean
  $ docuforge build --watch

Exit codes: 0 success, 1 build errors, 2 usage or configuration error.`,
    )
    .action(async (opts: Record<string, unknown>) => {
      verbose = opts["verbose"] === true;
      const log = createLogger({ verbose, stdout, stderr });
      const flags = {
          ...(typeof opts["source"] === "string" ? { source: opts["source"] } : {}),
          ...(typeof opts["out"] === "string" ? { out: opts["out"] } : {}),
          ...(typeof opts["config"] === "string" ? { config: opts["config"] } : {}),
          ...(typeof opts["base"] === "string" ? { base: opts["base"] } : {}),
          ...(opts["clean"] === true ? { clean: true } : {}),
          ...(opts["includeDrafts"] === true ? { includeDrafts: true } : {}),
          ...(opts["includeHidden"] === true ? { includeHidden: true } : {}),
          ...(opts["strictFrontmatter"] === true ? { strictFrontMatter: true } : {}),
          ...(opts["strictLinks"] === true ? { strictLinks: true } : {}),
          verbose,
      };
      if (opts["watch"] === true) {
        const watcher = await startWatch(flags, env.cwd, log);
        await waitForShutdown(env.signal);
        await watcher.close();
        log.info("Stopped watching.");
        code = ExitCode.Ok;
      } else {
        code = await buildCommand(flags, env.cwd, log);
      }
    });

  program
    .command("preview")
    .description("serve the already-built site locally (localhost only by default)")
    .option("--out <dir>", "built output directory (default: ./dist, or the config's output)")
    .option("--config <file>", "configuration file")
    .option("--host <host>", "address to listen on (default: 127.0.0.1)")
    .option("--port <port>", "port to listen on; 0 picks a free one (default: 4173)")
    .addHelpText(
      "after",
      `
Examples:
  $ docuforge preview
  $ docuforge preview --out ./dist --port 8080

Serves exactly what a static host would, under the site's base path. Run "docuforge build" first.`,
    )
    .action(async (opts: Record<string, unknown>) => {
      code = await previewCommand(
        {
          ...(typeof opts["out"] === "string" ? { out: opts["out"] } : {}),
          ...(typeof opts["config"] === "string" ? { config: opts["config"] } : {}),
          ...(typeof opts["host"] === "string" ? { host: opts["host"] } : {}),
          ...(typeof opts["port"] === "string" ? { port: opts["port"] } : {}),
        },
        env.cwd,
        createLogger({ verbose, stdout, stderr }),
        env.signal,
      );
    });

  program
    .command("init")
    .description("create an example config file and starter docs (never overwrites existing files)")
    .action(async () => {
      code = await initCommand(env.cwd, createLogger({ verbose, stdout, stderr }));
    });

  try {
    await program.parseAsync(argv, { from: "user" });
    return code;
  } catch (err) {
    const log = createLogger({ verbose, stdout, stderr });
    if (err instanceof CommanderError) {
      // Help and version are successful exits; everything else is a usage error.
      return err.exitCode === 0 ? ExitCode.Ok : ExitCode.Usage;
    }
    if (err instanceof DocuForgeError) {
      log.error(err.message);
      return err.exitCode;
    }
    log.error(verbose && err instanceof Error && err.stack ? err.stack : `Unexpected error: ${(err as Error).message}`);
    if (!verbose) log.info("Re-run with --verbose for details.");
    return ExitCode.Internal;
  }
}
