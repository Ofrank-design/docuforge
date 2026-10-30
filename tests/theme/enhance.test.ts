// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { initCopyCode } from "../../packages/theme/src/enhance/copyCode";
import { initTocSpy } from "../../packages/theme/src/enhance/tocSpy";
import { isEditable, readSiteConfig, urlFor } from "../../packages/theme/src/enhance/dom";
import { applyTheme, readPref, type ThemePref } from "../../packages/theme/src/enhance/theme";
import { THEME_INIT_JS } from "../../packages/cli/src/templates/themeAssets.js";
import { installMatchMedia, useCleanDom } from "./helpers";

useCleanDom();

describe("copy code button", () => {
  const html = `<div class="code-block"><div class="code-header"><button type="button" class="copy-btn">Copy</button></div><pre><code>npm install acme\nacme --version\n</code></pre></div>
                <div class="code-block"><button class="copy-btn" id="second">Copy</button><pre><code>second</code></pre></div>
                <div id="df-copy-status"></div>`;

  const disposers: (() => void)[] = [];
  afterEach(() => disposers.splice(0).forEach((d) => d())); // listeners live on `document`: never leak them between tests

  function setup(clipboard?: { writeText: (t: string) => Promise<void> }) {
    document.body.innerHTML = html;
    Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
    const stop = initCopyCode(document);
    disposers.push(stop);
    return stop;
  }

  it("copies exactly the code text, then reports success visibly and to screen readers", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    const stop = setup({ writeText });
    const btn = document.querySelector<HTMLButtonElement>(".copy-btn")!;
    btn.click();
    await vi.advanceTimersByTimeAsync(40);
    expect(writeText).toHaveBeenCalledWith("npm install acme\nacme --version\n");
    expect(btn.textContent).toBe("Copied");
    expect(document.getElementById("df-copy-status")!.textContent).toBe("Code copied to clipboard");
    await vi.advanceTimersByTimeAsync(2100);
    expect(btn.textContent).toBe("Copy");
    stop();
  });

  it("copies the block that was clicked, not another one", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setup({ writeText });
    document.getElementById("second")!.click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("second"));
  });

  it("reports failure honestly when the clipboard is denied", async () => {
    const stop = setup({ writeText: vi.fn().mockRejectedValue(new Error("denied")) });
    const btn = document.querySelector<HTMLButtonElement>(".copy-btn")!;
    btn.click();
    await vi.waitFor(() => expect(btn.textContent).toBe("Copy failed"));
    await vi.waitFor(() => expect(document.getElementById("df-copy-status")!.textContent).toBe("Could not copy code"));
    stop();
  });

  it("falls back to execCommand without the async clipboard API", async () => {
    const exec = vi.fn().mockReturnValue(true);
    (document as unknown as { execCommand: typeof exec }).execCommand = exec;
    setup(undefined);
    const btn = document.querySelector<HTMLButtonElement>(".copy-btn")!;
    btn.click();
    await vi.waitFor(() => expect(btn.textContent).toBe("Copied"));
    expect(exec).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull(); // temporary element cleaned up
  });

  it("reports failure when no copy mechanism works", async () => {
    (document as unknown as { execCommand: () => boolean }).execCommand = () => false;
    setup(undefined);
    const btn = document.querySelector<HTMLButtonElement>(".copy-btn")!;
    btn.click();
    await vi.waitFor(() => expect(btn.textContent).toBe("Copy failed"));
  });

  it("ignores clicks elsewhere and stops listening when disposed", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const stop = setup({ writeText });
    document.querySelector<HTMLElement>("pre")!.click();
    stop();
    document.querySelector<HTMLButtonElement>(".copy-btn")!.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(writeText).not.toHaveBeenCalled();
  });
});

describe("table of contents scroll-spy", () => {
  class FakeIO {
    static last: FakeIO;
    constructor(public cb: IntersectionObserverCallback) {
      FakeIO.last = this;
    }
    observe = vi.fn();
    disconnect = vi.fn();
  }

  function setup(tops: Record<string, number>) {
    document.body.innerHTML = `
      <nav class="toc-mobile"><details open><summary>On this page</summary><ul><li><a href="#one">One</a></li><li><a href="#two">Two</a></li></ul></details></nav>
      <article><h2 id="one">One</h2><h2 id="two">Two</h2><h3 id="three">Three</h3></article>
      <nav class="toc"><ul><li><a href="#one">One</a></li><li><a href="#two">Two</a></li><li><a href="#three">Three</a></li></ul></nav>`;
    for (const [id, top] of Object.entries(tops)) {
      document.getElementById(id)!.getBoundingClientRect = () => ({ top }) as DOMRect;
    }
    (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = FakeIO;
    return initTocSpy(document);
  }
  const current = () => [...document.querySelectorAll('[aria-current="location"]')].map((a) => `${a.closest("nav")!.className}:${a.getAttribute("href")}`);

  it("marks the section being read in both the desktop and mobile lists", () => {
    const stop = setup({ one: -400, two: 50, three: 600 });
    expect(current().sort()).toEqual(["toc-mobile:#two", "toc:#two"]);
    stop();
  });

  it("updates on scroll", () => {
    const stop = setup({ one: 50, two: 700, three: 1200 });
    expect(current().every((c) => c.endsWith("#one"))).toBe(true);
    document.getElementById("one")!.getBoundingClientRect = () => ({ top: -900 }) as DOMRect;
    document.getElementById("two")!.getBoundingClientRect = () => ({ top: -100 }) as DOMRect;
    document.getElementById("three")!.getBoundingClientRect = () => ({ top: 400 }) as DOMRect;
    window.dispatchEvent(new Event("scroll"));
    expect(current().every((c) => c.endsWith("#two"))).toBe(true);
    stop();
  });

  it("marks nothing before the first heading is reached", () => {
    const stop = setup({ one: 500, two: 900, three: 1300 });
    expect(current()).toEqual([]);
    stop();
  });

  it("closes the mobile list after choosing an entry", () => {
    const stop = setup({ one: 0, two: 100, three: 200 });
    document.querySelector<HTMLAnchorElement>(".toc-mobile a[href='#two']")!.addEventListener("click", (e) => e.preventDefault());
    document.querySelector<HTMLAnchorElement>(".toc-mobile a[href='#two']")!.click();
    expect(document.querySelector(".toc-mobile details")!.hasAttribute("open")).toBe(false);
    stop();
  });

  it("is a no-op without a table of contents or with dangling links", () => {
    document.body.innerHTML = "<p>no toc</p>";
    expect(() => initTocSpy(document)()).not.toThrow();
    document.body.innerHTML = '<nav class="toc"><a href="#missing">x</a></nav>';
    expect(() => initTocSpy(document)()).not.toThrow();
  });

  it("stops observing when disposed", () => {
    const stop = setup({ one: 0, two: 100, three: 200 });
    stop();
    expect(FakeIO.last.disconnect).toHaveBeenCalled();
  });
});

describe("page helpers", () => {
  it("builds URLs under the base path, encoding every segment and the heading id", () => {
    expect(urlFor("/", "/a/b/")).toBe("/a/b/");
    expect(urlFor("/docs/", "/a/", "step-1")).toBe("/docs/a/#step-1");
    expect(urlFor("/", "/a b/ü/", 'x"y')).toBe("/a%20b/%C3%BC/#x%22y");
    expect(urlFor("/", "/")).toBe("/");
  });

  it("reads the base path and search flag, falling back safely for anything odd", () => {
    const root = document.documentElement;
    const read = (base: string | undefined, search = "on") => {
      if (base === undefined) root.removeAttribute("data-df-base");
      else root.dataset["dfBase"] = base;
      root.dataset["dfSearch"] = search;
      return readSiteConfig(document);
    };
    expect(read("/docs/")).toEqual({ base: "/docs/", searchEnabled: true });
    expect(read("/docs")).toMatchObject({ base: "/docs/" });
    expect(read("/", "off")).toEqual({ base: "/", searchEnabled: false });
    expect(read(undefined)).toMatchObject({ base: "/" });
    for (const bad of ["//evil.com/", "https://evil.com/", "javascript:alert(1)", "/a b/", '/"><x>', "docs/", ""]) {
      expect(read(bad).base, bad).toBe("/");
    }
  });

  it("recognises editable elements", () => {
    const input = document.createElement("input");
    const ta = document.createElement("textarea");
    const sel = document.createElement("select");
    const div = document.createElement("div");
    Object.defineProperty(div, "isContentEditable", { value: true });
    const btn = document.createElement("button");
    expect([input, ta, sel, div].every(isEditable)).toBe(true);
    expect(isEditable(btn)).toBe(false);
    expect(isEditable(null)).toBe(false);
  });
});

describe("theme-init script matches the theme code", () => {
  const scenarios: { stored: string | null; dark: boolean; blocked?: boolean }[] = [
    { stored: null, dark: false },
    { stored: null, dark: true },
    { stored: "light", dark: true },
    { stored: "dark", dark: false },
    { stored: "bogus", dark: true },
    { stored: "system", dark: false },
  ];

  it.each(scenarios)("stored=%j systemDark=%j gives the same result as applyTheme", ({ stored, dark }) => {
    const mm = installMatchMedia();
    mm.state.dark = dark;
    if (stored !== null) localStorage.setItem("df-theme", stored);

    new Function(THEME_INIT_JS)(); // the real script, run in the jsdom window
    const root = document.documentElement;
    const fromScript = { theme: root.dataset["theme"], pref: root.dataset["themePref"], scheme: root.style.colorScheme, js: root.classList.contains("df-js") };

    root.removeAttribute("data-theme");
    root.removeAttribute("data-theme-pref");
    root.style.cssText = "";
    applyTheme(readPref() as ThemePref);
    expect(fromScript).toEqual({ theme: root.dataset["theme"], pref: root.dataset["themePref"], scheme: root.style.colorScheme, js: true });
  });

  it("marks the page as JS-capable even when storage is blocked, and does not throw", () => {
    installMatchMedia();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => new Function(THEME_INIT_JS)()).not.toThrow();
    expect(document.documentElement.classList.contains("df-js")).toBe(true);
    expect(document.documentElement.dataset["theme"]).toBeUndefined(); // CSS media-query fallback takes over
  });

  it("is a small classic script with no external dependencies", () => {
    expect(THEME_INIT_JS.length).toBeLessThan(700);
    expect(THEME_INIT_JS).not.toMatch(/\bimport\b|\bfetch\b|XMLHttpRequest/);
  });
});
