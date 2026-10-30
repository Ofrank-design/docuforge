import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { applyTheme, readPref, writePref, type ThemePref } from "../enhance/theme";

const ORDER: ThemePref[] = ["system", "light", "dark"];
const ICON = { system: Monitor, light: Sun, dark: Moon } as const;

/** Cycles system → light → dark. The choice is remembered; "system" follows the OS setting live. */
export function ThemeToggle() {
  const [pref, setPref] = useState<ThemePref>(() => readPref());

  useEffect(() => {
    applyTheme(pref);
    if (pref !== "system" || typeof matchMedia !== "function") return;
    const mql = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [pref]);

  const next = ORDER[(ORDER.indexOf(pref) + 1) % ORDER.length] as ThemePref;
  const Icon = ICON[pref];
  const label = `Theme: ${pref}. Switch to ${next}.`;

  return (
    <button
      type="button"
      onClick={() => {
        writePref(next);
        setPref(next);
      }}
      aria-label={label}
      title={label}
      data-testid="theme-toggle"
      className="df-icon-btn"
    >
      <Icon aria-hidden="true" size={18} />
    </button>
  );
}
