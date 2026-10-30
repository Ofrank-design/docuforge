import { StrictMode, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import "./styles/site.css";
import { MobileNav } from "./components/MobileNav";
import { SearchDialog } from "./components/SearchDialog";
import { ThemeToggle } from "./components/ThemeToggle";
import { readSiteConfig } from "./enhance/dom";
import { initCopyCode } from "./enhance/copyCode";
import { initTocSpy } from "./enhance/tocSpy";

/**
 * Entry point. The pages are complete static HTML; this adds the interactive
 * parts ("islands") on top: menu, search, theme toggle, copy buttons, TOC highlight.
 */
function mount(id: string, element: ReactElement): void {
  const host = document.getElementById(id);
  if (host) createRoot(host).render(<StrictMode>{element}</StrictMode>);
}

// Never initialise twice (e.g. if the entry module were ever evaluated under two URLs):
// a second createRoot() on the same element would silently replace the first React tree.
const w = window as unknown as { __docuforgeReady?: boolean };
if (!w.__docuforgeReady) {
  w.__docuforgeReady = true;
  const config = readSiteConfig();
  mount("df-menu-root", <MobileNav />);
  mount("df-theme-root", <ThemeToggle />);
  if (config.searchEnabled) mount("df-search-root", <SearchDialog base={config.base} />);
  initCopyCode();
  initTocSpy();
}
