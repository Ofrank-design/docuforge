import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeSite } from "../helpers/tmp.js";

const ROOT = process.cwd();
const CLI = path.join(ROOT, "packages", "cli", "src", "index.ts");
const TSX_CLI = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");

function startWatch(cwd: string) {
  const isWin = process.platform === "win32";

  const child = spawn(
    process.execPath,
    [
      TSX_CLI,
      CLI,
      "build",
      "--source",
      "docs",
      "--out",
      "dist",
      "--watch",
    ],
    {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: {
        ...process.env,
        CHOKIDAR_USEPOLLING: isWin ? "1" : process.env.CHOKIDAR_USEPOLLING,
      },
    },
  );

  const output = { stdout: "", stderr: "" };

  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk) => {
    output.stdout += chunk;
  });
  child.stderr?.on("data", (chunk) => {
    output.stderr += chunk;
  });

  (child as any).__output = output;
  return child;
}

async function waitUntil(
  check: () => Promise<boolean>,
  timeout = 20000,
  child?: ChildProcess,
) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  const output = (child as any)?.__output;
  const extra = output
    ? `\n\n--- stdout ---\n${output.stdout}\n\n--- stderr ---\n${output.stderr}`
    : "";
  throw new Error("Timed out waiting for condition" + extra);
}

async function waitForExit(child: ChildProcess) {
  return new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Watch process did not exit"));
    }, 12000);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function stop(child: ChildProcess) {
  if (child.killed || child.exitCode !== null) return;

  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } catch {
      child.kill();
    }
  } else {
    child.kill("SIGINT");
  }
}

describe("docuforge build --watch", () => {
  it(
    "works as a real process: rebuilds on change and exits cleanly",
    async () => {
      const cwd = await makeSite({
        "docs/index.md": "# H\n\nfirst\n",
      });
      const child = startWatch(cwd);

      try {
        await waitUntil(
          async () => {
            try {
              const html = await fs.readFile(
                path.join(cwd, "dist/index.html"),
                "utf8",
              );
              return html.includes("first");
            } catch {
              return false;
            }
          },
          20000,
          child,
        );

        await fs.writeFile(
          path.join(cwd, "docs/index.md"),
          "# H\n\nsecond\n",
        );

        await waitUntil(
          async () => {
            const html = await fs.readFile(
              path.join(cwd, "dist/index.html"),
              "utf8",
            );
            return html.includes("second");
          },
          15000,
          child,
        );

        stop(child);
        const code = await waitForExit(child);
        // taskkill on Windows exits with 1 – that is normal
        expect([0, 1, null]).toContain(code);
      } finally {
        stop(child);
        await new Promise((r) => setTimeout(r, 800));
      }
    },
    45000,
  );

  it(
    "reloads a JavaScript config file in a real process",
    async () => {
      const cwd = await makeSite({
        "docs/index.md": "# Home",
        "docuforge.config.mjs":
          'export default { title: "ESM One" };\n',
      });
      const child = startWatch(cwd);

      try {
        await waitUntil(
          async () => {
            try {
              const html = await fs.readFile(
                path.join(cwd, "dist/index.html"),
                "utf8",
              );
              return html.includes("ESM One");
            } catch {
              return false;
            }
          },
          20000,
          child,
        );

        await fs.writeFile(
          path.join(cwd, "docuforge.config.mjs"),
          'export default { title: "ESM Two" };\n',
        );

        await waitUntil(
          async () => {
            const html = await fs.readFile(
              path.join(cwd, "dist/index.html"),
              "utf8",
            );
            return html.includes("ESM Two");
          },
          15000,
          child,
        );

        stop(child);
        const code = await waitForExit(child);
        expect([0, 1, null]).toContain(code);
      } finally {
        stop(child);
        await new Promise((r) => setTimeout(r, 800));
      }
    },
    45000,
  );
});