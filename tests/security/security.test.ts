import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../../packages/cli/src/cli.js";
import { Capture, isRoot, makeSite, makeTree, TINY_PNG } from "../helpers/tmp.js";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SAMPLE_CONFIG = path.join(ROOT, "fixtures/sample-docs.config.json");

async function walk(dir: string, rel = ""): Promise<string[]> {
  const out: string[] = [];
  for (const e of await fs.readdir(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await walk(dir, r)));
    else out.push(r);
  }
  return out.sort();
}

const HOSTILE = `# Attack page

<script>window.__x=1</script>
<img src="x" onerror="window.__x=2">
<a href="javascript:window.__x=3">js</a>

[md-js](javascript:window.__x=4) [mixed](JaVaScRiPt:window.__x=7) [data](data:text/html;base64,PHNjcmlwdD4xPC9zY3JpcHQ+) [vb](vbscript:x)

<iframe src="https://evil.example"></iframe><object data="x"></object><embed src="x"><form action="https://evil.example"><input name=a></form>
<div style="position:fixed;inset:0" onclick="window.__x=5" class="x" id="y">styled</div>
<svg onload="window.__x=6"><script>1</script></svg>
<style>body{display:none}</style><meta http-equiv="refresh" content="0;url=https://evil.example"><link rel=stylesheet href=//evil.example/x.css><base href=//evil.example/>

![traversal](../../../etc/passwd.png) [tr](../../../etc/passwd.md) ![abs](/etc/shadow.png)
`;

describe("everything a build publishes", () => {
  async function buildHostile() {
    const cwd = await makeSite(
      {
        "docs/index.md": "# Home\n\n[attack](./attack.md) ![evil](./evil.svg) ![img](./ok.png)\n",
        "docs/attack.md": HOSTILE,
        "docs/evil.svg": '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject><rect width="1" height="1"/></svg>',
        "docs/.env": "SECRET=hunter2", "docs/id_rsa": "PRIVATE KEY", "docs/server.pem": "CERT", "docs/credentials.json": '{"k":"v"}',
        "docs/public/.env": "SECRET=hunter2", "docs/public/key.pem": "KEY", "docs/public/ok.txt": "ok",
        "docuforge.config.json": '{"siteUrl":"https://docs.example.com"}',
      },
      { "docs/ok.png": TINY_PNG },
    );
    const code = await run(["build", "--source", "docs", "--out", "dist"], { cwd, stdout: new Capture(), stderr: new Capture() });
    expect(code).toBe(0);
    return { cwd, dist: path.join(cwd, "dist"), files: await walk(path.join(cwd, "dist")) };
  }

  it("contains no local filesystem path of the machine that built it, in any file", async () => {
    const { cwd, dist, files } = await buildHostile();
    const needles = [cwd, path.dirname(cwd), os.tmpdir(), os.homedir(), ROOT, process.cwd(), "/home/", "/Users/", "C:\\\\Users"].filter((n) => n.length > 4 && n !== "/");
    for (const f of files) {
      const text = (await fs.readFile(path.join(dist, f))).toString("latin1");
      for (const n of needles) expect(text.includes(n), `${f} contains "${n}"`).toBe(false);
    }
  });

  it("emits no source maps and only relative paths in its own metadata", async () => {
    const { dist, files } = await buildHostile();
    expect(files.filter((f) => f.endsWith(".map"))).toEqual([]);
    const manifest = JSON.parse(await fs.readFile(path.join(dist, ".docuforge-manifest.json"), "utf8")) as { files: string[] };
    for (const f of manifest.files) {
      expect(f.startsWith("/") || f.includes("..") || /^[A-Za-z]:/.test(f), f).toBe(false);
      expect(files).toContain(f);
    }
  });

  it("never copies secrets, keys, credentials or hidden source files", async () => {
    const { files } = await buildHostile();
    for (const bad of [".env", "id_rsa", "server.pem", "key.pem", "credentials.json"]) expect(files.filter((f) => f.endsWith(bad)), bad).toEqual([]);
    expect(files).toContain("ok.txt"); // legitimate public files still published
    for (const f of files) expect(f.split("/").some((s) => s.startsWith(".") && ![".docuforge-build", ".docuforge-manifest.json", ".well-known", ".nojekyll"].includes(s)), f).toBe(false);
  });

  it("HTML pages are inert: no inline scripts, handlers, inline styles, javascript: URLs, or foreign embeds", async () => {
    const { dist, files } = await buildHostile();
    for (const f of files.filter((x) => x.endsWith(".html"))) {
      const html = await fs.readFile(path.join(dist, f), "utf8");
      for (const tag of html.match(/<script\b[^>]*>/gi) ?? []) expect(tag, `${f}: ${tag}`).toMatch(/\ssrc="/);
      expect(html.match(/<script\b[^>]*>[^<]+<\/script>/i)?.[0], `${f}: inline script body`).toBeUndefined();
      expect(html.match(/\son[a-z]+\s*=/i)?.[0], `${f}: event handler attribute`).toBeUndefined();
      expect(html.match(/\sstyle\s*=/i)?.[0], `${f}: inline style attribute (breaks a strict CSP)`).toBeUndefined();
      expect(html.match(/javascript:/i)?.[0], f).toBeUndefined();
      expect(html.match(/<(iframe|object|embed|form|base|style|meta http-equiv)\b/i)?.[0], f).toBeUndefined();
      expect(html.match(/window\.__x/)?.[0], f).toBeUndefined();
    }
  });

  it("published SVGs are sanitized", async () => {
    const { dist } = await buildHostile();
    const svg = await fs.readFile(path.join(dist, "evil.svg"), "utf8");
    expect(svg.match(/<script|onload|foreignObject|alert/i)?.[0]).toBeUndefined();
    expect(svg).toContain("<rect");
  });

  it("reports hostile references instead of following them", async () => {
    const cwd = await makeSite({ "docs/index.md": HOSTILE });
    const stderr = new Capture();
    await run(["build", "--source", "docs", "--out", "dist"], { cwd, stdout: new Capture(), stderr });
    expect(stderr.text).toContain("link.outside-root");
    const dist = await walk(path.join(cwd, "dist"));
    expect(dist.join("\n")).not.toMatch(/passwd|shadow/);
  });

  it("the search index and navigation hold only page data (no markup, no paths, no hostile payloads)", async () => {
    const { dist } = await buildHostile();
    for (const f of ["search-index.json", "navigation.json"]) {
      const text = await fs.readFile(path.join(dist, f), "utf8");
      expect(text.match(/window\.__x|<script|onerror|javascript:/)?.[0], f).toBeUndefined();
    }
  });
});

describe("failures never leave a half-written site", () => {
  async function build(cwd: string, args: string[]) {
    const stderr = new Capture();
    const code = await run(["build", "--source", "docs", "--out", "dist", ...args], { cwd, stdout: new Capture(), stderr });
    return { code, err: stderr.text };
  }
  const state = async (cwd: string) => (await fs.readdir(cwd)).filter((n) => /staging|lock/.test(n));

  it("invalid configuration writes nothing at all", async () => {
    const cwd = await makeSite({ "docs/index.md": "# H\n", "docuforge.config.json": '{"logo":"missing.png"}' });
    expect((await build(cwd, [])).code).toBe(2);
    expect(await fs.readdir(cwd)).toEqual(["docs", "docuforge.config.json"]);
  });

  it("a failed build keeps the previous site byte-for-byte and leaves no staging or lock directory", async () => {
    const cwd = await makeSite({ "docs/index.md": "# Home\n\nfirst\n" });
    expect((await build(cwd, [])).code).toBe(0);
    const before = await Promise.all((await walk(path.join(cwd, "dist"))).map(async (f) => [f, (await fs.readFile(path.join(cwd, "dist", f))).toString("base64")]));
    await fs.writeFile(path.join(cwd, "docs/index.md"), "# Home\n\n[broken](./nope.md)\n");
    expect((await build(cwd, ["--strict-links"])).code).toBe(1);
    const after = await Promise.all((await walk(path.join(cwd, "dist"))).map(async (f) => [f, (await fs.readFile(path.join(cwd, "dist", f))).toString("base64")]));
    expect(after).toEqual(before);
    expect(await state(cwd)).toEqual([]);
  });

  it("an output path that is a file is refused", async () => {
    const cwd = await makeSite({ "docs/index.md": "# H\n", "dist": "i am a file" });
    const r = await build(cwd, []);
    expect(r.code).toBe(2);
    expect(r.err).toContain("not a directory");
    expect(await fs.readFile(path.join(cwd, "dist"), "utf8")).toBe("i am a file");
    expect(await state(cwd)).toEqual([]);
  });

  it.skipIf(isRoot())("an unwritable output location fails cleanly", async () => {
    const cwd = await makeSite({ "docs/index.md": "# H\n" });
    const ro = path.join(cwd, "ro");
    await fs.mkdir(ro);
    await fs.chmod(ro, 0o500);
    const r = await build(cwd, ["--out", "ro/dist"]);
    await fs.chmod(ro, 0o700);
    expect(r.code).not.toBe(0);
    expect(r.err).not.toMatch(/at .*\.(ts|js):\d+/); // no stack trace dumped on the user
  });

  it("a stray source file in a symlinked folder cannot be published", async () => {
    const outside = await makeTree({ "secret.md": "# Secret\n\nTOPSECRET" });
    const cwd = await makeSite({ "docs/index.md": "# H\n" });
    await fs.symlink(outside, path.join(cwd, "docs/linked"));
    await fs.symlink(path.join(outside, "secret.md"), path.join(cwd, "docs/also.md"));
    expect((await build(cwd, [])).code).toBe(0);
    const all = (await Promise.all((await walk(path.join(cwd, "dist"))).map((f) => fs.readFile(path.join(cwd, "dist", f), "latin1")))).join("\n");
    expect(all).not.toContain("TOPSECRET");
  });
});

describe("the CLI never prints a stack trace for expected failures", () => {
  it.each([
    [["build", "--source", "nope"], 2], [["build", "--base", "//evil"], 2], [["preview", "--port", "x"], 2], [["nonsense"], 2],
  ])("%j exits %i with a one-line message", async (args, code) => {
    const stderr = new Capture();
    expect(await run(args as string[], { cwd: await makeTree(), stdout: new Capture(), stderr })).toBe(code);
    expect(stderr.text).not.toMatch(/\n\s+at /);
  });
  it("the real example site builds clean", async () => {
    const stderr = new Capture();
    const out = path.join(await makeTree(), "ex");
    expect(await run(["build", "--config", SAMPLE_CONFIG, "--out", out], { cwd: ROOT, stdout: new Capture(), stderr })).toBe(0);
    // only the three deliberately broken fixtures may warn
    const codes = [...stderr.text.matchAll(/\[([a-z.-]+)\]/g)].map((m) => m[1]).sort();
    expect(codes).toEqual(["asset.missing", "asset.type-not-allowed", "link.broken-page"]);
  });
});
