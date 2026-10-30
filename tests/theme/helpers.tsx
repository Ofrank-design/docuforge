import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

/** Controllable matchMedia: tests flip `dark`/`desktop` and fire change events. */
export function installMatchMedia() {
  const state = { dark: false, desktop: false };
  const listeners = new Map<string, Set<() => void>>();
  const query = (q: string) => (q.includes("prefers-color-scheme") ? state.dark : q.includes("min-width: 1024px") ? state.desktop : false);
  window.matchMedia = ((q: string) => ({
    get matches() {
      return query(q);
    },
    media: q,
    addEventListener: (_: string, fn: () => void) => (listeners.get(q) ?? listeners.set(q, new Set()).get(q)!).add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.get(q)?.delete(fn),
  })) as unknown as typeof window.matchMedia;
  return {
    state,
    fire(match: "dark" | "desktop") {
      for (const [q, set] of listeners) if (q.includes(match === "dark" ? "prefers-color-scheme" : "min-width")) set.forEach((fn) => fn());
    },
  };
}

export function resetDom(): void {
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-theme-pref");
  document.documentElement.removeAttribute("data-nav-open");
  document.documentElement.style.cssText = "";
  document.body.innerHTML = "";
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
}

/** Register the standard cleanup for every theme test file. */
export function useCleanDom(): void {
  beforeEach(resetDom);
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
}
