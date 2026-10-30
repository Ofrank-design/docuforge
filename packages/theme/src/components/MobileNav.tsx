import { Menu, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

const DESKTOP = "(min-width: 1024px)";
const INERT_TARGETS = ["#df-main", ".site-footer", ".toc"];

/**
 * Menu button + off-canvas drawer controller for narrow screens. The navigation
 * itself is static HTML (`#df-nav`); this only toggles `data-nav-open` on <html>,
 * makes the page behind it inert, moves focus in/out, and handles Esc/backdrop/link clicks.
 */
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const nav = document.getElementById("df-nav");
    const inertEls = INERT_TARGETS.flatMap((s) => [...document.querySelectorAll<HTMLElement>(s)]);
    if (!open) {
      root.removeAttribute("data-nav-open");
      inertEls.forEach((el) => el.removeAttribute("inert"));
      return;
    }
    root.setAttribute("data-nav-open", "");
    inertEls.forEach((el) => el.setAttribute("inert", ""));
    (nav?.querySelector<HTMLElement>('a[aria-current="page"]') ?? nav?.querySelector<HTMLElement>("a"))?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(true);
    };
    const onNavClick = (e: Event) => {
      if ((e.target as Element).closest("a")) close(false);
    };
    const backdrop = document.getElementById("df-backdrop");
    const onBackdrop = () => close(true);
    document.addEventListener("keydown", onKey);
    nav?.addEventListener("click", onNavClick);
    backdrop?.addEventListener("click", onBackdrop);
    const mql = matchMedia(DESKTOP);
    const onMql = () => mql.matches && close(false);
    mql.addEventListener("change", onMql);
    return () => {
      document.removeEventListener("keydown", onKey);
      nav?.removeEventListener("click", onNavClick);
      backdrop?.removeEventListener("click", onBackdrop);
      mql.removeEventListener("change", onMql);
    };
  }, [open, close]);

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={() => setOpen((o) => !o)}
      aria-expanded={open}
      aria-controls="df-nav"
      aria-label={open ? "Close navigation" : "Open navigation"}
      data-testid="menu-button"
      className="df-icon-btn lg:hidden"
    >
      {open ? <X aria-hidden="true" size={20} /> : <Menu aria-hidden="true" size={20} />}
    </button>
  );
}
