export type ThemePref = "system" | "light" | "dark";
export const THEME_KEY = "df-theme";

export function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system"; // storage blocked (private mode, sandboxed iframe)
  }
}

export function writePref(pref: ThemePref): void {
  try {
    if (pref === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, pref);
  } catch {
    /* preference simply isn't remembered */
  }
}

export function systemPrefersDark(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveTheme(pref: ThemePref): "light" | "dark" {
  return pref === "system" ? (systemPrefersDark() ? "dark" : "light") : pref;
}

/** Mirrors assets/theme-init.js (which runs before first paint). */
export function applyTheme(pref: ThemePref): void {
  const root = document.documentElement;
  const resolved = resolveTheme(pref);
  root.dataset["theme"] = resolved;
  root.dataset["themePref"] = pref;
  root.style.colorScheme = resolved;
}
