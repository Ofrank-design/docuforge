import fs from "node:fs/promises";
import path from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { run } from "../../packages/cli/src/cli.js";
import { Capture, makeSite, TINY_PNG } from "../helpers/tmp.js";

const FILES = {
  "docs/index.md": "---\ntitle: Home\n---\n# Home\n\n- [Install](./start/install.md#step-two)\n- [Auth](./guides/deep/auth.md)\n- [Guides](./guides/)\n- ![logo](./img/logo.png)\n\n## Status\n",
  "docs/start/index.md": "---\ntitle: Start\n---\n# Start\n\nGo [home](../index.md#status) or [on](./install.md).\n",
  "docs/start/install.md": "# Install\n\n## Step one\n\n## Step two\n\n```ts\nconst a = 1;\n```\n\nBack to [start](./index.md) and [up](../index.md).\n",
  "docs/guides/deep/auth.md": "# Auth\n\nSee [install](../../start/install.md) and ![d](../../img/diagram.svg).\n\nFootnote[^n].\n\n[^n]: Note.\n",
  "docs/guides/deep/zeta.md": "Page without heading or title.\n",
  "docs/img/diagram.svg": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"><rect width="1" height="1"/></svg>',
};

async function htmlFiles(dir: string, rel = ""): Promise<string[]> {
  const out: string[] = [];
  for (const e of await fs.readdir(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await htmlFiles(dir, r)));
    else if (e.name.endsWith(".html")) out.push(r);
  }
  return out.sort();
}

async function buildSite(base: string) {
  const cwd = await makeSite(FILES, { "docs/img/logo.png": TINY_PNG });
  const stdout = new Capture();
  const stderr = new Capture();
  const code = await run(["build", "--source", "docs", "--out", "dist", "--base", base, "--strict-links"], { cwd, stdout, stderr });
  return { cwd, dist: path.join(cwd, "dist"), code, err: stderr.text };
}

describe.each(["/", "/my-project/"])("output integrity (base %s)", (base) => {
  it("every internal link, asset, anchor and id in the built site resolves", async () => {
    const { dist, code, err } = await buildSite(base);
    expect(err).toBe("");
    expect(code).toBe(0);

    const pages = await htmlFiles(dist);
    expect(pages).toEqual([
      "404.html", "guides/deep/auth/index.html", "guides/deep/index.html", "guides/deep/zeta/index.html", "guides/index.html",
      "index.html", "start/index.html", "start/install/index.html",
    ]);

    const idsByPage = new Map<string, Set<string>>();
    const docs = new Map<string, JSDOM>();
    for (const page of pages) {
      const dom = new JSDOM(await fs.readFile(path.join(dist, page), "utf8"));
      docs.set(page, dom);
      const ids = [...dom.window.document.querySelectorAll("[id]")].map((e) => e.id);
      expect(new Set(ids).size, `duplicate ids in ${page}`).toBe(ids.length);
      idsByPage.set(page, new Set(ids));
    }

    let checked = 0;
    for (const [page, dom] of docs) {
      const d = dom.window.document;
      expect(d.documentElement.lang).toBe("en");
      expect(d.querySelectorAll("main")).toHaveLength(1);
      expect(d.querySelectorAll("h1"), `h1 count in ${page}`).toHaveLength(1);
      expect(d.title.length).toBeGreaterThan(0);

      for (const el of d.querySelectorAll("[href], [src]")) {
        const url = el.getAttribute("href") ?? el.getAttribute("src") ?? "";
        if (/^(https?:|mailto:|tel:|data:|\/\/)/.test(url)) continue;
        const [pathPart = "", hash = ""] = url.split("#");
        let targetPage = page;
        if (pathPart !== "") {
          expect(pathPart.startsWith(base), `${url} on ${page} must start with base ${base}`).toBe(true);
          const rel = decodeURIComponent(pathPart.slice(base.length));
          const isDir = rel === "" || rel.endsWith("/");
          const file = isDir ? `${rel}index.html` : rel;
          await expect(fs.stat(path.join(dist, file)), `${url} on ${page} -> ${file}`).resolves.toBeTruthy();
          targetPage = file;
        }
        if (hash !== "" && targetPage.endsWith(".html")) {
          expect(idsByPage.get(targetPage)?.has(decodeURIComponent(hash)), `anchor #${hash} in ${targetPage} (from ${page})`).toBe(true);
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(40);
  });
});
