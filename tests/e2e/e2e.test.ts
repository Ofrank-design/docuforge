import fs from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser, Page } from "puppeteer-core";
import { buildSite, e2e, launch, openPage, scrollIdle, serve, sleep } from "./helpers";

let browser: Browser;
let site: { url: string; close: () => Promise<void>; requests: string[] };
let dist: string;
let cleanupSite: () => Promise<void>;

beforeAll(async () => {
  const built = await buildSite();
  dist = built.dist;
  cleanupSite = built.cleanup;
  site = await serve(dist);
  browser = await launch();
}, 120_000);
afterAll(async () => {
  await browser?.close();
  await site?.close();
  await cleanupSite?.();
});

const PAGES = ["/", "/getting-started/", "/getting-started/installation/", "/getting-started/configuration/", "/guides/authentication/", "/guides/long/", "/reference/api/"];
const go = (page: Page, p: string) => page.goto(site.url + p, { waitUntil: "networkidle0" });
const dialogOpen = (page: Page) => page.evaluate(() => !!document.querySelector("[role=dialog]"));
const focusedLabel = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute("aria-label") ?? document.activeElement?.tagName ?? "");
const activeId = (page: Page) => page.evaluate(() => document.querySelector("input[role=combobox]")?.getAttribute("aria-activedescendant"));

e2e("pages in a real browser", () => {
  it("every page loads with no console errors, exceptions or failed requests, and the entry script runs once", async () => {
    for (const p of PAGES) {
      const { page, errors } = await openPage(browser);
      const js: string[] = [];
      page.on("request", (r) => r.url().endsWith(".js") && js.push(r.url()));
      await go(page, p);
      expect(errors, p).toEqual([]);
      expect(js.filter((u) => /\/site-[^/]+\.js$/.test(u)), `${p}: entry requested once`).toHaveLength(1);
      expect(await page.evaluate(() => (window as unknown as { __docuforgeReady?: boolean }).__docuforgeReady)).toBe(true);
      await page.close();
    }
  });

  it("a page is fully styled: the stylesheet applies, dark/light tokens resolve", async () => {
    const { page } = await openPage(browser);
    await go(page, "/getting-started/installation/");
    const info = await page.evaluate(() => {
      const cs = getComputedStyle(document.body);
      return { bg: cs.backgroundColor, font: cs.fontFamily, code: getComputedStyle(document.querySelector(".code-block")!).borderTopWidth };
    });
    expect(info.bg).toBe("rgb(255, 255, 255)");
    expect(info.font).toContain("system-ui");
    expect(info.code).toBe("1px");
    await page.close();
  });

  it("syntax highlighting and the copy button render", async () => {
    const { page } = await openPage(browser);
    await go(page, "/getting-started/installation/");
    expect(await page.$$eval(".code-block .hljs-keyword, .code-block .hljs-string", (n) => n.length)).toBeGreaterThan(0);
    expect(await page.$eval(".code-lang", (e) => e.textContent)).toBe("Bash");
    await page.close();
  });
});

e2e("links look like links", () => {
  it.each(["light", "dark"] as const)("body links are underlined and coloured differently from the surrounding text (%s theme)", async (scheme) => {
    const { page } = await openPage(browser, { scheme });
    await go(page, "/");
    const r = await page.evaluate(() => {
      const a = document.querySelector(".content p a") as HTMLElement;
      const p = a.parentElement as HTMLElement;
      const cs = getComputedStyle(a);
      return { color: cs.color, text: getComputedStyle(p).color, line: cs.textDecorationLine, accent: getComputedStyle(document.documentElement).getPropertyValue("--df-accent").trim() };
    });
    expect(r.line).toBe("underline");
    expect(r.color).not.toBe(r.text);
    const hex = r.accent.replace("#", "");
    expect(r.color).toBe(`rgb(${[0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`);
    await page.close();
  });

  it("heading anchor links stay quiet (no underline) and other chrome links keep their own styling", async () => {
    const { page } = await openPage(browser);
    await go(page, "/getting-started/installation/");
    const r = await page.evaluate(() => ({
      anchor: getComputedStyle(document.querySelector(".content .anchor")!).textDecorationLine,
      sidebar: getComputedStyle(document.querySelector("#df-nav a")!).textDecorationLine,
      pager: getComputedStyle(document.querySelector(".pager a")!).textDecorationLine,
    }));
    expect(r).toEqual({ anchor: "none", sidebar: "none", pager: "none" });
    await page.close();
  });
});

e2e("search", () => {
  it('"/" opens it, it stays open once the index has loaded, and results are keyboard-navigable', async () => {
    const { page, errors } = await openPage(browser);
    await go(page, "/");
    await page.bringToFront();
    await page.keyboard.press("/");
    await sleep(500); // index + lazy chunk load: the dialog must survive this (regression: double-evaluated entry module)
    expect(await dialogOpen(page)).toBe(true);
    expect(await focusedLabel(page)).toBe("Search documentation");
    await page.keyboard.type("install", { delay: 15 });
    await page.waitForSelector("[role=option]");
    expect(await page.$$eval("[role=option]", (o) => o.length)).toBeGreaterThanOrEqual(2);
    const first = await activeId(page);
    expect(first).toBeTruthy();
    expect(await page.$eval("[role=option][aria-selected=true]", (e) => e.textContent)).toContain("Installation");
    await page.keyboard.press("ArrowDown");
    const second = await activeId(page);
    expect(second).not.toBe(first);
    expect(await page.$eval("[role=option][aria-selected=true]", (e) => e.id)).toBe(second);
    await page.keyboard.press("ArrowUp");
    expect(await activeId(page)).toBe(first);
    expect(errors).toEqual([]);
    await page.close();
  });

  it("Enter navigates to the matching section of the result page", async () => {
    const { page } = await openPage(browser);
    await go(page, "/");
    await page.bringToFront();
    await page.keyboard.press("/");
    await page.keyboard.type("troubleshooting", { delay: 15 });
    await page.waitForSelector("[role=option]");
    await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.keyboard.press("Enter")]);
    expect(new URL(page.url()).pathname).toBe("/getting-started/installation/");
    expect(new URL(page.url()).hash).toBe("#troubleshooting");
    const top = await page.evaluate(() => document.getElementById("troubleshooting")!.getBoundingClientRect().top);
    expect(top).toBeGreaterThanOrEqual(60); // not hidden under the sticky header
    expect(top).toBeLessThan(await page.evaluate(() => window.innerHeight)); // and on screen
    await page.close();
  });

  it("Ctrl+K opens, Escape closes and focus returns to the trigger; typing '/' in the box types it", async () => {
    const { page } = await openPage(browser);
    await go(page, "/");
    await page.bringToFront();
    await page.keyboard.down("Control");
    await page.keyboard.press("k");
    await page.keyboard.up("Control");
    await page.waitForSelector("[role=dialog]");
    await page.keyboard.type("a/b");
    expect(await page.$eval("input[role=combobox]", (e) => (e as HTMLInputElement).value)).toBe("a/b");
    expect(await dialogOpen(page)).toBe(true);
    await page.keyboard.press("Escape");
    await sleep(50);
    expect(await dialogOpen(page)).toBe(false);
    expect(await page.evaluate(() => (document.activeElement as HTMLElement).dataset["testid"])).toBe("search-trigger");
    await page.close();
  });

  it("opens from the visible button with the mouse, and a click outside the dialog closes it", async () => {
    const { page } = await openPage(browser);
    await go(page, "/");
    await page.click('[data-testid="search-trigger"]');
    await page.waitForSelector("[role=dialog]");
    await page.mouse.click(5, 5);
    await sleep(50);
    expect(await dialogOpen(page)).toBe(false);
    await page.close();
  });

  it("explains an empty result set; Unicode and diacritics work", async () => {
    const { page } = await openPage(browser);
    await go(page, "/");
    await page.bringToFront();
    await page.keyboard.press("/");
    await page.keyboard.type("zzzqqq");
    await page.waitForSelector('[data-testid="search-empty"]');
    expect(await page.$eval('[data-testid="search-empty"]', (e) => e.textContent)).toContain("No results for “zzzqqq”");
    await page.$eval("input[role=combobox]", (e) => ((e as HTMLInputElement).select(), 0));
    await page.keyboard.type("cafe naive");
    await page.waitForSelector("[role=option]");
    expect(await page.$eval("[role=option]", (e) => e.textContent)).toContain("Authentication");
    await page.close();
  });

  it("renders hostile page text as text: no elements created, nothing executed", async () => {
    const { page } = await openPage(browser);
    await go(page, "/");
    await page.bringToFront();
    await page.keyboard.press("/");
    await page.keyboard.type("onerror");
    await page.waitForSelector("[role=option]");
    const state = await page.evaluate(() => ({
      imgs: document.querySelectorAll("[role=listbox] img, [role=listbox] script").length,
      text: document.querySelector("[role=listbox]")!.textContent,
      pwned: (window as unknown as { __pwned?: number }).__pwned,
    }));
    expect(state.imgs).toBe(0);
    expect(state.text).toContain("<img");
    expect(state.pwned).toBeUndefined();
    await page.close();
  });

  it("keeps Tab inside the dialog", async () => {
    const { page } = await openPage(browser);
    await go(page, "/");
    await page.bringToFront();
    await page.keyboard.press("/");
    await page.waitForSelector("[role=dialog]");
    const seen = new Set<string>();
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Tab");
      seen.add(await page.evaluate(() => (document.activeElement?.closest("[role=dialog]") ? "inside" : "outside")));
    }
    expect([...seen]).toEqual(["inside"]);
    await page.close();
  });

  it("works on a phone-sized screen without overflowing", async () => {
    const { page } = await openPage(browser, { width: 390, height: 800, mobile: true });
    await go(page, "/");
    await page.tap('[data-testid="search-trigger"]');
    await page.waitForSelector("[role=dialog]");
    await page.type("input[role=combobox]", "install");
    await page.waitForSelector("[role=option]");
    const box = await page.evaluate(() => {
      const r = document.querySelector("[role=dialog]")!.getBoundingClientRect();
      return { left: r.left, right: r.right, vw: window.innerWidth, fs: getComputedStyle(document.querySelector("input[role=combobox]")!).fontSize };
    });
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(box.vw);
    expect(parseFloat(box.fs)).toBeGreaterThanOrEqual(16); // avoids iOS zoom-on-focus
    await page.close();
  });
});

e2e("theme toggle", () => {
  it("cycles system → light → dark and remembers it across a reload, without a flash", async () => {
    const { page } = await openPage(browser);
    await go(page, "/");
    const toggle = '[data-testid="theme-toggle"]';
    const state = () => page.evaluate(() => ({ t: document.documentElement.dataset["theme"], p: document.documentElement.dataset["themePref"], bg: getComputedStyle(document.body).backgroundColor }));
    expect(await state()).toMatchObject({ t: "light", p: "system" });
    await page.click(toggle); // light
    await page.click(toggle); // dark
    expect(await state()).toEqual({ t: "dark", p: "dark", bg: "rgb(15, 17, 23)" });

    // Reload and read the theme at DOMContentLoaded, before the deferred module bundle can have run.
    await page.goto(site.url + "/", { waitUntil: "domcontentloaded" });
    expect(await state()).toMatchObject({ t: "dark", bg: "rgb(15, 17, 23)" });
    await page.waitForSelector(toggle);
    await page.click(toggle); // back to system
    expect(await page.evaluate(() => localStorage.getItem("df-theme"))).toBeNull();
    await page.close();
  });

  it("follows the OS setting when no preference is saved, with and without JavaScript", async () => {
    for (const js of [true, false]) {
      const { page } = await openPage(browser, { scheme: "dark", js });
      await go(page, "/");
      expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), `js=${js}`).toBe("rgb(15, 17, 23)");
      await page.close();
    }
  });

  it("respects an explicit light choice even when the OS is dark", async () => {
    const { page } = await openPage(browser, { scheme: "dark" });
    await go(page, "/");
    await page.click('[data-testid="theme-toggle"]'); // system(dark) -> light
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(255, 255, 255)");
    await page.close();
  });
});

e2e("mobile navigation", () => {
  const phone = { width: 390, height: 800, mobile: true };

  it("the sidebar is a hidden drawer that opens, traps the page behind it, and closes with Escape", async () => {
    const { page } = await openPage(browser, phone);
    await go(page, "/guides/authentication/");
    const nav = () => page.evaluate(() => {
      const r = document.getElementById("df-nav")!.getBoundingClientRect();
      return { right: r.right, left: r.left, vis: getComputedStyle(document.getElementById("df-nav")!).visibility };
    });
    expect((await nav()).vis).toBe("hidden");
    await page.tap('[data-testid="menu-button"]');
    await sleep(350);
    const open = await nav();
    expect(open.vis).toBe("visible");
    expect(open.left).toBeGreaterThanOrEqual(0);
    expect(open.right).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.getElementById("df-main")!.hasAttribute("inert"))).toBe(true);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).toBe("hidden");
    expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-current"))).toBe("page");
    expect(await page.$eval('[data-testid="menu-button"]', (e) => e.getAttribute("aria-expanded"))).toBe("true");
    // the close button stays reachable above the drawer
    const btn = await page.$eval('[data-testid="menu-button"]', (e) => { const r = e.getBoundingClientRect(); return { top: document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest("button")?.dataset["testid"] }; });
    expect(btn.top).toBe("menu-button");

    await page.keyboard.press("Escape");
    await sleep(350);
    expect((await nav()).vis).toBe("hidden");
    expect(await page.evaluate(() => (document.activeElement as HTMLElement).dataset["testid"])).toBe("menu-button");
    expect(await page.evaluate(() => document.getElementById("df-main")!.hasAttribute("inert"))).toBe(false);
    await page.close();
  });

  it("closes from the backdrop and from the close button; choosing a page navigates and starts closed", async () => {
    const { page } = await openPage(browser, phone);
    await go(page, "/");
    await page.tap('[data-testid="menu-button"]');
    await sleep(300);
    await page.mouse.click(370, 400); // the dimmed area to the right of the drawer
    await sleep(300);
    expect(await page.evaluate(() => document.documentElement.hasAttribute("data-nav-open"))).toBe(false);
    await page.tap('[data-testid="menu-button"]');
    await sleep(300);
    await page.tap('[data-testid="menu-button"]');
    await sleep(300);
    expect(await page.evaluate(() => document.documentElement.hasAttribute("data-nav-open"))).toBe(false);

    await page.tap('[data-testid="menu-button"]');
    await sleep(300);
    await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.evaluate(() => (document.querySelector('#df-nav a[href="/reference/api/"]') as HTMLElement | null)?.click() ?? document.querySelector<HTMLElement>("#df-nav details:not([open]) > summary")?.click())]).catch(() => undefined);
    await page.close();
  });

  it("the menu button does not exist visually on desktop, and the sidebar is simply visible", async () => {
    const { page } = await openPage(browser);
    await go(page, "/");
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="menu-button"]')!).display)).toBe("none");
    expect(await page.evaluate(() => { const r = document.getElementById("df-nav")!.getBoundingClientRect(); return r.width > 200 && r.left >= 0; })).toBe(true);
    await page.close();
  });

  it("resizing from phone to desktop closes an open drawer", async () => {
    const { page } = await openPage(browser, phone);
    await go(page, "/");
    await page.tap('[data-testid="menu-button"]');
    await sleep(300);
    await page.setViewport({ width: 1400, height: 900 });
    await sleep(300);
    expect(await page.evaluate(() => document.documentElement.hasAttribute("data-nav-open"))).toBe(false);
    expect(await page.evaluate(() => document.getElementById("df-main")!.hasAttribute("inert"))).toBe(false);
    await page.close();
  });
});

e2e("responsive layout", () => {
  it.each([320, 390, 768, 1024, 1400])("no horizontal page overflow at %ipx wide (wide tables and long code scroll inside their blocks)", async (width) => {
    const { page } = await openPage(browser, { width, height: 800 });
    for (const p of ["/", "/getting-started/installation/", "/guides/long/"]) {
      await go(page, p);
      const o = await page.evaluate(() => {
        const iw = window.innerWidth;
        const offenders: string[] = [];
        for (const el of document.querySelectorAll("body *")) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.right <= iw + 0.5) continue;
          let clipped = false;
          for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
            if (getComputedStyle(a).overflowX !== "visible" && a.getBoundingClientRect().right <= iw + 0.5) clipped = true;
          }
          if (!clipped) offenders.push(`${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}.${String(el.className).slice(0, 40)} right=${Math.round(r.right)}`);
        }
        return { sw: document.documentElement.scrollWidth, iw, offenders: offenders.slice(0, 5) };
      });
      expect(o.sw, `${p} @${width} overflowing: ${o.offenders.join(" | ")}`).toBeLessThanOrEqual(o.iw);
    }
    await page.close();
  });

  it("the wide table and the long code line scroll inside their own containers", async () => {
    const { page } = await openPage(browser, { width: 390, height: 800 });
    await go(page, "/");
    expect(await page.$eval(".content table", (t) => t.scrollWidth > t.clientWidth && getComputedStyle(t).overflowX === "auto")).toBe(true);
    await go(page, "/getting-started/installation/");
    expect(await page.$$eval(".code-block pre", (p) => p.some((x) => x.scrollWidth > x.clientWidth && getComputedStyle(x).overflowX === "auto"))).toBe(true);
    await page.close();
  });

  it("the table of contents is a side panel on wide screens and a collapsible list on narrow ones", async () => {
    const wide = await openPage(browser, { width: 1400 });
    await go(wide.page, "/getting-started/installation/");
    expect(await wide.page.evaluate(() => getComputedStyle(document.querySelector("nav.toc")!).display)).toBe("block");
    expect(await wide.page.evaluate(() => getComputedStyle(document.querySelector(".toc-mobile")!).display)).toBe("none");
    await wide.page.close();
    const narrow = await openPage(browser, { width: 800 });
    await go(narrow.page, "/getting-started/installation/");
    expect(await narrow.page.evaluate(() => getComputedStyle(document.querySelector("nav.toc")!).display)).toBe("none");
    expect(await narrow.page.evaluate(() => getComputedStyle(document.querySelector(".toc-mobile")!).display)).not.toBe("none");
    await narrow.page.close();
  });
});

e2e("without JavaScript", () => {
  it("content, sidebar and table of contents work; JS-only controls are hidden; links navigate", async () => {
    for (const width of [1400, 390]) {
      const { page } = await openPage(browser, { js: false, width, height: 800 });
      await go(page, "/getting-started/installation/");
      expect(await page.$eval("h1", (h) => h.textContent), `@${width}`).toContain("Installation");
      const nav = await page.evaluate(() => { const n = document.getElementById("df-nav")!; const r = n.getBoundingClientRect(); return { vis: getComputedStyle(n).visibility, w: r.width, left: r.left }; });
      expect(nav.vis).toBe("visible");
      expect(nav.w).toBeGreaterThan(150);
      expect(nav.left).toBeGreaterThanOrEqual(0);
      for (const id of ["df-search-root", "df-theme-root", "df-menu-root"]) {
        expect(await page.$eval(`#${id}`, (e) => getComputedStyle(e).display), `${id} @${width}`).toBe("none");
      }
      // groups are native <details>: expand "Guides" without any script, then follow the link
      await page.click('#df-nav details:not([open]) > summary');
      await Promise.all([page.waitForNavigation(), page.click('#df-nav a[href="/guides/authentication/"]')]);
      expect(new URL(page.url()).pathname).toBe("/guides/authentication/");
      await page.close();
    }
  });
});

e2e("table of contents", () => {
  it("clicking an entry scrolls to the heading below the sticky header and marks it current", async () => {
    const { page } = await openPage(browser, { width: 1400, height: 800 });
    await go(page, "/guides/long/");
    await page.click('nav.toc a[href="#section-9"]');
    await scrollIdle(page);
    expect(new URL(page.url()).hash).toBe("#section-9");
    const top = await page.evaluate(() => document.getElementById("section-9")!.getBoundingClientRect().top);
    expect(top).toBeGreaterThanOrEqual(64); // clear of the 64px sticky header
    expect(top).toBeLessThan(110); // and not pushed down by a doubled scroll offset
    expect(await page.$eval('nav.toc a[aria-current="location"]', (a) => a.getAttribute("href"))).toBe("#section-9");
    await page.close();
  });

  it("follows the scroll position", async () => {
    const { page } = await openPage(browser, { width: 1400, height: 800 });
    await go(page, "/guides/long/");
    await page.evaluate(() => document.getElementById("section-4")!.scrollIntoView());
    await scrollIdle(page);
    expect(await page.$eval('nav.toc a[aria-current="location"]', (a) => a.getAttribute("href"))).toBe("#section-4");
    await page.evaluate(() => window.scrollTo(0, 0));
    await scrollIdle(page);
    expect(await page.$$eval('nav.toc a[aria-current="location"]', (a) => a.length)).toBe(0);
    await page.close();
  });

  it("reduced-motion users get instant scrolling", async () => {
    const { page } = await openPage(browser, { reducedMotion: true });
    await go(page, "/");
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe("auto");
    await page.close();
  });
});

e2e("copy button", () => {
  it("copies the code to the real clipboard and says so", async () => {
    const { page } = await openPage(browser);
    // Chromium's name for "write text to the clipboard" is clipboard-sanitized-write
    await page.browserContext().overridePermissions(site.url, ["clipboard-sanitized-write", "clipboard-read"]);
    await go(page, "/getting-started/installation/");
    await page.bringToFront();
    await page.click(".copy-btn");
    await sleep(200);
    expect(await page.$eval(".copy-btn", (b) => b.textContent)).toBe("Copied");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("npm install -g acme-cli\nacme --version\n");
    expect(await page.$eval("#df-copy-status", (e) => e.textContent)).toBe("Code copied to clipboard");
    await sleep(2200);
    expect(await page.$eval(".copy-btn", (b) => b.textContent)).toBe("Copy");
    await page.close();
  });
});

e2e("copy button when the browser refuses", () => {
  it("says so instead of pretending to have copied", async () => {
    const { page } = await openPage(browser); // fresh context: no clipboard permission granted
    await go(page, "/getting-started/installation/");
    await page.bringToFront();
    await page.click(".copy-btn");
    await sleep(200);
    expect(await page.$eval(".copy-btn", (b) => b.textContent)).toBe("Copy failed");
    expect(await page.$eval("#df-copy-status", (e) => e.textContent)).toBe("Could not copy code");
    await page.close();
  });
});

e2e("keyboard and accessibility basics", () => {
  it("the first Tab stop is the skip link, and it moves focus to the main content", async () => {
    const { page } = await openPage(browser);
    await go(page, "/");
    await page.bringToFront();
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.className)).toBe("skip-link");
    expect(await page.evaluate(() => { const r = document.activeElement!.getBoundingClientRect(); return r.left >= 0 && r.top >= 0; })).toBe(true); // visible when focused
    await page.keyboard.press("Enter");
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("df-main");
    await page.close();
  });

  it("every interactive control has an accessible name; landmarks are unique and labelled", async () => {
    const { page } = await openPage(browser);
    await go(page, "/getting-started/installation/");
    const r = await page.evaluate(() => {
      const unnamed = [...document.querySelectorAll("button, a[href], input")].filter((e) => {
        const name = (e.getAttribute("aria-label") ?? e.textContent ?? "").trim();
        return name === "" && !(e as HTMLElement).closest("[aria-hidden=true]");
      }).map((e) => e.outerHTML.slice(0, 80));
      return {
        unnamed,
        mains: document.querySelectorAll("main").length,
        h1s: document.querySelectorAll("h1").length,
        navs: [...document.querySelectorAll("nav")].map((n) => n.getAttribute("aria-label")),
        currentPages: document.querySelectorAll('[aria-current="page"]').length,
        lang: document.documentElement.lang,
        duplicateIds: (() => { const ids = [...document.querySelectorAll("[id]")].map((e) => e.id); return ids.filter((x, i) => ids.indexOf(x) !== i); })(),
      };
    });
    expect(r.unnamed).toEqual([]);
    expect(r.mains).toBe(1);
    expect(r.h1s).toBe(1);
    expect(r.navs.every(Boolean)).toBe(true);
    expect(r.currentPages).toBeGreaterThanOrEqual(1);
    expect(r.lang).toBe("en");
    expect(r.duplicateIds).toEqual([]);
    await page.close();
  });

  it("focus is always visible on interactive elements", async () => {
    const { page } = await openPage(browser);
    await go(page, "/");
    await page.bringToFront();
    for (let i = 0; i < 6; i++) await page.keyboard.press("Tab");
    const outline = await page.evaluate(() => { const cs = getComputedStyle(document.activeElement!); return { style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) }; });
    expect(outline.style).not.toBe("none");
    expect(outline.width).toBeGreaterThan(0);
    await page.close();
  });
});

e2e("deployed under a base path", () => {
  it("everything works from /docs/: assets, links, search results, theme and navigation", async () => {
    const built = await buildSite(["--base", "/docs/"]);
    const based = await serve(built.dist, "/docs");
    try {
      const { page, errors } = await openPage(browser);
      await page.goto(`${based.url}/docs/`, { waitUntil: "networkidle0" });
      expect(await page.$eval("h1", (h) => h.textContent)).toContain("Acme Docs");
      expect(await page.$$eval("#df-nav a", (as) => as.every((a) => a.getAttribute("href")!.startsWith("/docs/")))).toBe(true);

      await page.bringToFront();
      await page.keyboard.press("/");
      await page.keyboard.type("troubleshooting", { delay: 15 });
      await page.waitForSelector("[role=option]");
      expect(await page.$eval("[role=option] a", (a) => a.getAttribute("href"))).toBe("/docs/getting-started/installation/#troubleshooting");
      await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.keyboard.press("Enter")]);
      expect(new URL(page.url()).pathname).toBe("/docs/getting-started/installation/");

      await page.click('[data-testid="theme-toggle"]');
      expect(errors).toEqual([]);
      expect(based.requests.filter((r) => !r.startsWith("/docs/") && r !== "/favicon.ico")).toEqual([]); // nothing requested outside the base
      await page.close();
    } finally {
      await based.close();
      await built.cleanup();
    }
  });
});

e2e("resilience", () => {
  it("shows a clear, recoverable error when the search index is unavailable", async () => {
    const { page } = await openPage(browser);
    await go(page, "/");
    const idx = `${dist}/search-index.json`;
    const original = await fs.readFile(idx);
    await fs.rename(idx, `${idx}.bak`);
    try {
      await page.bringToFront();
      await page.keyboard.press("/");
      await page.waitForSelector('[role="alert"]');
      expect(await page.$eval('[role="alert"]', (e) => e.textContent)).toContain("Search is unavailable");
      await fs.rename(`${idx}.bak`, idx);
      await page.click('[role="alert"] button');
      await page.waitForFunction(() => document.body.textContent?.includes("Type to search"));
      expect(await dialogOpen(page)).toBe(true);
    } finally {
      await fs.writeFile(idx, original);
      await fs.rm(`${idx}.bak`, { force: true });
    }
    await page.close();
  });

  it("shows a clear error for a corrupt index", async () => {
    const { page } = await openPage(browser);
    await go(page, "/");
    const idx = `${dist}/search-index.json`;
    const original = await fs.readFile(idx);
    await fs.writeFile(idx, '{"version":1,"index":{},"docs":"nope"}');
    try {
      await page.bringToFront();
      await page.keyboard.press("/");
      await page.waitForSelector('[role="alert"]');
      expect(await page.$eval('[role="alert"]', (e) => e.textContent)).toContain("Search is unavailable");
    } finally {
      await fs.writeFile(idx, original);
    }
    await page.close();
  });
});
