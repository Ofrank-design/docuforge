import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../../packages/cli/src/cli.js";
import { acquireBuildLock, lockDirFor } from "../../packages/cli/src/build/lock.js";
import { DocuForgeError } from "../../packages/cli/src/util/errors.js";
import { Capture, makeSite, makeTree } from "../helpers/tmp.js";

const exists = (p: string) => fs.stat(p).then(() => true, () => false);

describe("build lock", () => {
  it("lives beside the output directory, never inside it", async () => {
    const dir = await makeTree();
    const out = path.join(dir, "dist");
    expect(lockDirFor(out)).toBe(path.join(dir, ".dist.docuforge-lock"));
    const release = await acquireBuildLock(out);
    expect(await exists(lockDirFor(out))).toBe(true);
    expect(await exists(out)).toBe(false);
    await release();
    expect(await exists(lockDirFor(out))).toBe(false);
  });

  it("refuses a second build while one is running, then allows it after release", async () => {
    const out = path.join(await makeTree(), "dist");
    const release = await acquireBuildLock(out);
    const err = await acquireBuildLock(out).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DocuForgeError);
    expect((err as Error).message).toContain(`process ${process.pid}`);
    await release();
    await (await acquireBuildLock(out))();
  });

  it("takes over a lock left behind by a process that no longer exists", async () => {
    const out = path.join(await makeTree(), "dist");
    const dead = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"]).stdout.toString();
    await fs.mkdir(lockDirFor(out));
    await fs.writeFile(path.join(lockDirFor(out), "pid"), dead);
    await (await acquireBuildLock(out))();
  });

  it.each([["garbage"], [""], ["-5"], ["0"]])("takes over a lock with an unusable pid file (%j)", async (content) => {
    const out = path.join(await makeTree(), "dist");
    await fs.mkdir(lockDirFor(out));
    await fs.writeFile(path.join(lockDirFor(out), "pid"), content);
    await (await acquireBuildLock(out))();
  });

  it("takes over a half-created lock (no pid file)", async () => {
    const out = path.join(await makeTree(), "dist");
    await fs.mkdir(lockDirFor(out));
    await (await acquireBuildLock(out))();
  });
});

describe("build lock in the build command", () => {
  async function build(cwd: string) {
    const stderr = new Capture();
    const code = await run(["build", "--source", "docs", "--out", "dist"], { cwd, stdout: new Capture(), stderr });
    return { code, err: stderr.text };
  }

  it("a build that finds the output locked fails with exit 1, touches nothing, and leaves the other build's lock alone", async () => {
    const cwd = await makeSite({ "docs/index.md": "# Home\n" });
    expect((await build(cwd)).code).toBe(0);
    const before = await fs.readFile(path.join(cwd, "dist/index.html"), "utf8");
    await fs.writeFile(path.join(cwd, "docs/index.md"), "# Changed\n");

    const release = await acquireBuildLock(path.join(cwd, "dist"));
    const r = await build(cwd);
    expect(r.code).toBe(1);
    expect(r.err).toContain("Another DocuForge build");
    expect(await fs.readFile(path.join(cwd, "dist/index.html"), "utf8")).toBe(before);
    expect(await exists(lockDirFor(path.join(cwd, "dist")))).toBe(true); // still held by its owner
    await release();
    expect((await build(cwd)).code).toBe(0);
  });

  it("releases the lock after a successful build and after a failed one", async () => {
    const cwd = await makeSite({ "docs/index.md": "# Home\n\n[x](./nope.md)\n" });
    const stderr = new Capture();
    await run(["build", "--source", "docs", "--out", "dist"], { cwd, stdout: new Capture(), stderr });
    expect(await exists(lockDirFor(path.join(cwd, "dist")))).toBe(false);
    expect(await run(["build", "--source", "docs", "--out", "dist", "--strict-links"], { cwd, stdout: new Capture(), stderr })).toBe(1);
    expect(await exists(lockDirFor(path.join(cwd, "dist")))).toBe(false);
  });

  it("two truly simultaneous builds never corrupt the output: the result is always one complete site", async () => {
    const cwd = await makeSite({ "docs/index.md": "# Home\n\n" + "paragraph\n\n".repeat(200), "docs/a.md": "# A\n" });
    const results = await Promise.all([build(cwd), build(cwd), build(cwd)]);
    expect(results.filter((r) => r.code === 0).length).toBeGreaterThanOrEqual(1);
    for (const r of results) expect([0, 1]).toContain(r.code);
    const idx = JSON.parse(await fs.readFile(path.join(cwd, "dist/search-index.json"), "utf8"));
    expect(idx.docs).toHaveLength(2);
    for (const f of ["index.html", "a/index.html", "404.html", "navigation.json"]) expect(await exists(path.join(cwd, "dist", f))).toBe(true);
    expect((await fs.readdir(cwd)).filter((n) => /staging|lock/.test(n))).toEqual([]);
  });
});
