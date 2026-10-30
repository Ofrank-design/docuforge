import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_FILE_NAMES } from "../config/load.js";
import { pathExists } from "../util/fs.js";
import type { Logger } from "../util/logger.js";
import { ExitCode, type ExitCodeValue } from "../util/errors.js";

const CONFIG_TEMPLATE = `// DocuForge configuration. Every option is optional.
export default {
  title: "Project Documentation",
  description: "Technical documentation for the project",
  source: "./docs",
  output: "./dist",
  basePath: "/",
  includeDrafts: false,
  navigation: { sort: "order-then-title" },
};
`;

const INDEX_TEMPLATE = `---
title: Welcome
description: Where to start with this documentation.
---

# Welcome

This site was built by DocuForge from the Markdown files in \`docs/\`. Add more \`.md\` files and folders, and the navigation follows your folder structure.

To get started, read [Installation](./getting-started/installation.md).
`;

const INSTALL_TEMPLATE = `---
title: Installation
order: 1
---

# Installation

Build the site from the \`docs\` folder:

\`\`\`bash
npx docuforge build --source ./docs --out ./dist
\`\`\`

Then check it locally with \`npx docuforge preview\`.
`;

/** Starter icon set shipped inside the package (works from src/ and from dist/). */
const STARTER_PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../starter/public");

/** Copy the starter tab icons into docs/public without overwriting anything. Returns the names copied. */
async function copyStarterIcons(docsPublic: string): Promise<string[]> {
  let names: string[];
  try {
    names = await fs.readdir(STARTER_PUBLIC);
  } catch {
    return []; // package without starter files: nothing to copy
  }
  const copied: string[] = [];
  await fs.mkdir(docsPublic, { recursive: true });
  for (const name of names.sort()) {
    try {
      await fs.copyFile(path.join(STARTER_PUBLIC, name), path.join(docsPublic, name), fs.constants.COPYFILE_EXCL);
      copied.push(name);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
  return copied;
}

/** Write a file only if it does not exist (`wx` makes overwriting impossible). */
async function writeNew(file: string, content: string): Promise<boolean> {
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content, { flag: "wx" });
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw err;
  }
}

/** Create an example config and starter docs, never touching existing files. */
export async function initCommand(cwd: string, log: Logger): Promise<ExitCodeValue> {
  let existingConfig = false;
  for (const name of CONFIG_FILE_NAMES) {
    if (await pathExists(path.join(cwd, name))) existingConfig = true;
  }
  if (existingConfig) {
    log.info("A DocuForge config file already exists, so it was left as it is.");
  } else if (await writeNew(path.join(cwd, "docuforge.config.mjs"), CONFIG_TEMPLATE)) {
    log.success("Created docuforge.config.mjs");
  }

  const docsDir = path.join(cwd, "docs");
  let docsHasContent = false;
  try {
    docsHasContent = (await fs.readdir(docsDir)).length > 0;
  } catch {
    docsHasContent = false;
  }
  if (docsHasContent) {
    log.info("The docs folder already has content, so no starter pages were added.");
  } else {
    await writeNew(path.join(docsDir, "index.md"), INDEX_TEMPLATE);
    await writeNew(path.join(docsDir, "getting-started", "installation.md"), INSTALL_TEMPLATE);
    log.success("Created starter documents in docs/");
    const icons = await copyStarterIcons(path.join(docsDir, "public"));
    if (icons.length > 0) {
      log.success(`Added tab icons to docs/public/ (${icons.join(", ")}). Replace them with your own; they are used automatically.`);
    }
  }
  log.info("Next, run: npx docuforge build");
  return ExitCode.Ok;
}
