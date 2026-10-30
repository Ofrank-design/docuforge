import { CornerDownLeft, Search, X } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { SearchEngine, SearchHit } from "../../../cli/src/search/engine";
import type { Segment } from "../../../cli/src/search/excerpt";
import { isEditable, urlFor } from "../enhance/dom";
import { loadEngine } from "../search/loader";

type Status = "idle" | "loading" | "ready" | "error";

export interface SearchDialogProps {
  base: string;
  /** Injectable for tests; defaults to downloading `search-index.json`. */
  load?: () => Promise<SearchEngine>;
}

/** Highlighted text rendered as text nodes and <mark> — never as HTML. */
function Segments({ segments }: { segments: Segment[] }) {
  return (
    <>
      {segments.map((s, i) => (s.match ? <mark key={i}>{s.text}</mark> : <span key={i}>{s.text}</span>))}
    </>
  );
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

export function SearchDialog({ base, load }: SearchDialogProps) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [engine, setEngine] = useState<SearchEngine | undefined>();
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const optionId = (i: number) => `${listId}-opt-${i}`;

  const openDialog = useCallback(() => {
    const active = document.activeElement as HTMLElement | null;
    // Nothing focused (e.g. opened with a shortcut): come back to the search button, not <body>.
    returnFocusRef.current = active && active !== document.body ? active : triggerRef.current;
    setOpen(true);
  }, []);

  const closeDialog = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActive(0);
    const target = returnFocusRef.current && document.contains(returnFocusRef.current) ? returnFocusRef.current : triggerRef.current;
    target?.focus();
  }, []);

  const startLoading = useCallback(() => {
    setStatus("loading");
    setError("");
    (load ?? (() => loadEngine(base)))().then(
      (e) => {
        setEngine(e);
        setStatus("ready");
      },
      (err: unknown) => {
        setError(err instanceof Error ? err.message : "Unknown error");
        setStatus("error");
      },
    );
  }, [base, load]);

  // Global shortcuts: "/" (not while typing) and Ctrl/Cmd+K.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const isK = (e.key === "k" || e.key === "K") && (e.ctrlKey || e.metaKey) && !e.altKey;
      const isSlash = e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey && !isEditable(document.activeElement);
      if (isK || isSlash) {
        e.preventDefault();
        if (!open) openDialog();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, openDialog]);

  useEffect(() => {
    if (!open) return;
    if (status === "idle") startLoading();
    inputRef.current?.focus();
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      html.style.overflow = prev;
    };
  }, [open, status, startLoading]);

  const hits: SearchHit[] = useMemo(() => (engine && query.trim() ? engine.search(query, 10) : []), [engine, query]);
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    if (open && hits.length > 0) document.getElementById(optionId(active))?.scrollIntoView?.({ block: "nearest" });
  }, [active, hits, open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keys are handled on `document` while the dialog is open (not on the dialog element): clicking
  // empty space inside the dialog moves focus to <body>, and Escape / arrows must keep working then.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      const onInput = e.target === inputRef.current;
      if (e.key === "Escape") {
        e.preventDefault();
        closeDialog();
      } else if (e.key === "ArrowDown" && hits.length > 0) {
        e.preventDefault();
        setActive((a) => (a + 1) % hits.length);
      } else if (e.key === "ArrowUp" && hits.length > 0) {
        e.preventDefault();
        setActive((a) => (a - 1 + hits.length) % hits.length);
      } else if (e.key === "Home" && e.ctrlKey && onInput && hits.length > 0) {
        e.preventDefault();
        setActive(0);
      } else if (e.key === "End" && e.ctrlKey && onInput && hits.length > 0) {
        e.preventDefault();
        setActive(hits.length - 1);
      } else if (e.key === "Enter" && onInput && hits.length > 0) {
        e.preventDefault();
        const link = document.getElementById(optionId(active))?.querySelector("a");
        link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey }));
      } else if (e.key === "Tab") {
        const items = [...(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
        if (items.length === 0) return;
        const first = items[0] as HTMLElement;
        const last = items[items.length - 1] as HTMLElement;
        const current = document.activeElement;
        const inside = !!current && !!dialogRef.current?.contains(current);
        if (!inside) {
          e.preventDefault(); // focus escaped (e.g. to <body>): bring it back in
          (e.shiftKey ? last : first).focus();
        } else if (e.shiftKey && current === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && current === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, hits, active, closeDialog]); // eslint-disable-line react-hooks/exhaustive-deps

  const trimmed = query.trim();
  const statusText =
    status === "loading" ? "Loading search index" : status === "error" ? "Search is unavailable" : !trimmed ? "" : hits.length === 0 ? "No results" : `${hits.length} result${hits.length === 1 ? "" : "s"}`;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openDialog}
        onPointerEnter={() => status === "idle" && startLoading()}
        aria-label="Search documentation"
        aria-haspopup="dialog"
        aria-keyshortcuts="/ Control+K Meta+K"
        data-testid="search-trigger"
        className="df-icon-btn bg-surface text-muted sm:w-56 sm:justify-start sm:px-3"
      >
        <Search aria-hidden="true" size={16} />
        <span className="hidden flex-1 text-left sm:inline">Search…</span>
        <kbd className="hidden rounded border border-line px-1.5 py-0.5 font-mono text-xs sm:inline">/</kbd>
      </button>

      {open && (
        <div
          className="df-dialog-backdrop fixed inset-0 z-[60] flex items-start justify-center bg-black/50 p-3 pt-[8vh] sm:pt-[12vh]"
          onMouseDown={(e) => e.target === e.currentTarget && closeDialog()}
          data-testid="search-backdrop"
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Search documentation"
            tabIndex={-1}
            className="df-dialog flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-[var(--df-radius-lg)] border border-line bg-bg text-fg shadow-[var(--df-shadow-3)] outline-none"
          >
            <div className="flex items-center gap-2 border-b border-line px-3">
              <Search aria-hidden="true" size={18} className="text-muted" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                role="combobox"
                aria-expanded={hits.length > 0}
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={hits.length > 0 ? optionId(active) : undefined}
                aria-label="Search documentation"
                placeholder="Search the documentation…"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="go"
                className="h-12 flex-1 rounded bg-transparent text-base text-fg placeholder:text-muted"
              />
              <button
                type="button"
                onClick={closeDialog}
                aria-label="Close search"
                className="df-icon-btn border-transparent text-muted"
              >
                <X aria-hidden="true" size={18} />
              </button>
            </div>

            <div role="status" aria-live="polite" className="sr-only" data-testid="search-status">
              {statusText}
            </div>

            <div className="overflow-y-auto">
              {status === "loading" && <p className="p-6 text-center text-sm text-muted">Loading search index…</p>}

              {status === "error" && (
                <div className="p-6 text-center text-sm" role="alert">
                  <p className="font-medium">Search is unavailable.</p>
                  <p className="mt-1 text-muted">{error}</p>
                  <button type="button" onClick={startLoading} className="df-icon-btn mt-3 px-3">
                    Try again
                  </button>
                </div>
              )}

              {status === "ready" && !trimmed && (
                <p className="p-6 text-center text-sm text-muted">
                  Type to search {engine?.size ?? 0} page{engine?.size === 1 ? "" : "s"}.
                </p>
              )}

              {status === "ready" && trimmed && hits.length === 0 && (
                <div className="p-6 text-center text-sm" data-testid="search-empty">
                  <p className="font-medium">No results for “{trimmed}”</p>
                  <p className="mt-1 text-muted">Check the spelling, or try fewer or different words.</p>
                </div>
              )}

              <ul id={listId} role="listbox" aria-label="Search results" className="m-0 list-none p-2" hidden={hits.length === 0}>
                {hits.map((hit, i) => {
                  const href = urlFor(base, hit.doc.id, hit.heading?.id);
                  const selected = i === active;
                  return (
                    <li key={hit.doc.id} id={optionId(i)} role="option" aria-selected={selected}>
                      <a
                        href={href}
                        tabIndex={-1}
                        onMouseMove={() => setActive(i)}
                        onClick={(e) => {
                          if (!e.ctrlKey && !e.metaKey && !e.shiftKey) closeDialog();
                        }}
                        className={`block rounded-lg px-3 py-2.5 no-underline ${selected ? "bg-accent-soft outline outline-1 outline-accent" : ""}`}
                      >
                        <span className="block font-semibold text-fg">
                          <Segments segments={hit.title} />
                        </span>
                        {hit.heading && (
                          <span className="block text-xs text-accent">
                            # <Segments segments={hit.heading.segments} />
                          </span>
                        )}
                        <span className="mt-0.5 block text-sm text-muted">
                          <Segments segments={hit.excerpt} />
                        </span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="hidden items-center gap-4 border-t border-line px-3 py-2 text-xs text-muted sm:flex" aria-hidden="true">
              <span><kbd className="font-mono">↑</kbd> <kbd className="font-mono">↓</kbd> navigate</span>
              <span className="inline-flex items-center gap-1"><CornerDownLeft size={12} /> open</span>
              <span><kbd className="font-mono">esc</kbd> close</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
