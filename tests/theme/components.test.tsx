// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MobileNav } from "../../packages/theme/src/components/MobileNav";
import { ThemeToggle } from "../../packages/theme/src/components/ThemeToggle";
import { installMatchMedia, useCleanDom } from "./helpers";

useCleanDom();

describe("ThemeToggle", () => {
  it("cycles system → light → dark → system, applying and remembering the choice", () => {
    const mm = installMatchMedia();
    render(<ThemeToggle />);
    const btn = screen.getByTestId("theme-toggle");
    const root = document.documentElement;
    expect(btn.getAttribute("aria-label")).toBe("Theme: system. Switch to light.");
    expect(root.dataset["theme"]).toBe("light");

    fireEvent.click(btn);
    expect(btn.getAttribute("aria-label")).toBe("Theme: light. Switch to dark.");
    expect(root.dataset["theme"]).toBe("light");
    expect(localStorage.getItem("df-theme")).toBe("light");

    fireEvent.click(btn);
    expect(root.dataset["theme"]).toBe("dark");
    expect(root.style.colorScheme).toBe("dark");
    expect(localStorage.getItem("df-theme")).toBe("dark");

    mm.state.dark = true;
    fireEvent.click(btn); // back to system, which now resolves to dark
    expect(localStorage.getItem("df-theme")).toBeNull();
    expect(root.dataset["themePref"]).toBe("system");
    expect(root.dataset["theme"]).toBe("dark");
  });

  it("restores a saved preference on load", () => {
    installMatchMedia();
    localStorage.setItem("df-theme", "dark");
    render(<ThemeToggle />);
    expect(document.documentElement.dataset["theme"]).toBe("dark");
    expect(screen.getByTestId("theme-toggle").getAttribute("aria-label")).toContain("Theme: dark");
  });

  it("follows the operating system live while set to system", () => {
    const mm = installMatchMedia();
    render(<ThemeToggle />);
    expect(document.documentElement.dataset["theme"]).toBe("light");
    act(() => {
      mm.state.dark = true;
      mm.fire("dark");
    });
    expect(document.documentElement.dataset["theme"]).toBe("dark");
  });

  it("still works when storage is blocked", () => {
    installMatchMedia();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<ThemeToggle />);
    expect(() => fireEvent.click(screen.getByTestId("theme-toggle"))).not.toThrow();
    expect(document.documentElement.dataset["theme"]).toBe("light");
  });

  it("ignores an invalid saved value", () => {
    installMatchMedia();
    localStorage.setItem("df-theme", "<script>");
    render(<ThemeToggle />);
    expect(screen.getByTestId("theme-toggle").getAttribute("aria-label")).toContain("Theme: system");
  });
});

// jsdom cannot navigate; stop link clicks from logging "Not implemented: navigation".
document.addEventListener("click", (e) => (e.target as Element | null)?.closest?.("a") && e.preventDefault());

function pageShell() {
  document.body.innerHTML = `
    <div id="df-backdrop"></div>
    <nav id="df-nav"><a href="/a/">A</a><a href="/b/" aria-current="page">B</a></nav>
    <main id="df-main"><a id="in-main" href="#x">x</a></main>
    <footer class="site-footer"></footer>
    <div id="host"></div>`;
  return document.getElementById("host")!;
}

describe("MobileNav", () => {
  it("opens the drawer: state attribute, aria, inert page, focus inside the nav", () => {
    installMatchMedia();
    render(<MobileNav />, { container: pageShell() });
    const btn = screen.getByTestId("menu-button");
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(btn.getAttribute("aria-label")).toBe("Open navigation");
    expect(btn.getAttribute("aria-controls")).toBe("df-nav");

    fireEvent.click(btn);
    expect(document.documentElement.hasAttribute("data-nav-open")).toBe(true);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(btn.getAttribute("aria-label")).toBe("Close navigation");
    expect(document.getElementById("df-main")!.hasAttribute("inert")).toBe(true);
    expect(document.querySelector(".site-footer")!.hasAttribute("inert")).toBe(true);
    expect(document.activeElement?.getAttribute("href")).toBe("/b/"); // the current page's link
  });

  it("Escape closes it, lifts inert and returns focus to the button", () => {
    installMatchMedia();
    render(<MobileNav />, { container: pageShell() });
    const btn = screen.getByTestId("menu-button");
    fireEvent.click(btn);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.documentElement.hasAttribute("data-nav-open")).toBe(false);
    expect(document.getElementById("df-main")!.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes when a navigation link or the backdrop is clicked", () => {
    installMatchMedia();
    render(<MobileNav />, { container: pageShell() });
    const btn = screen.getByTestId("menu-button");
    fireEvent.click(btn);
    fireEvent.click(document.querySelector("#df-nav a")!);
    expect(document.documentElement.hasAttribute("data-nav-open")).toBe(false);
    fireEvent.click(btn);
    expect(document.documentElement.hasAttribute("data-nav-open")).toBe(true);
    fireEvent.click(document.getElementById("df-backdrop")!);
    expect(document.documentElement.hasAttribute("data-nav-open")).toBe(false);
    expect(document.activeElement).toBe(btn);
  });

  it("closes itself when the viewport becomes desktop-sized", () => {
    const mm = installMatchMedia();
    render(<MobileNav />, { container: pageShell() });
    fireEvent.click(screen.getByTestId("menu-button"));
    act(() => {
      mm.state.desktop = true;
      mm.fire("desktop");
    });
    expect(document.documentElement.hasAttribute("data-nav-open")).toBe(false);
  });

  it("removes its listeners when closed (Escape does nothing afterwards)", () => {
    installMatchMedia();
    render(<MobileNav />, { container: pageShell() });
    const btn = screen.getByTestId("menu-button");
    fireEvent.click(btn);
    fireEvent.click(btn);
    (document.getElementById("in-main") as HTMLElement).focus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.activeElement?.id).toBe("in-main"); // focus was not stolen
  });
});
