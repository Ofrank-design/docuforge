// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SearchDialog } from "../../packages/theme/src/components/SearchDialog";
import { buildSearchIndex } from "../../packages/cli/src/search/build.js";
import { createSearchEngine, type SearchEngine } from "../../packages/cli/src/search/engine.js";
import type { SearchDoc } from "../../packages/cli/src/search/types.js";
import { useCleanDom } from "./helpers";

useCleanDom();
document.addEventListener("click", (e) => (e.target as Element | null)?.closest?.("a") && e.preventDefault());

const doc = (id: string, title: string, over: Partial<SearchDoc> = {}): SearchDoc => ({ id, title, tags: [], headings: [], text: "", ...over });
const DOCS: SearchDoc[] = [
  doc("/start/install/", "Installation", { headings: [{ depth: 2, id: "step-one", text: "Step one" }], text: "Install with npm. Requires Node 20." }),
  doc("/guides/auth/", "Authentication", { headings: [{ depth: 2, id: "tokens", text: "API tokens" }], text: "Send the token in a header. Installation of a store is optional." }),
  doc("/reference/api/", "API Reference", { text: "Endpoints and tokens." }),
];
const makeEngine = (docs = DOCS): SearchEngine => createSearchEngine(JSON.parse(JSON.stringify(buildSearchIndex(docs))));
const okLoad = () => Promise.resolve(makeEngine());

async function openWith(props: { base?: string; load?: () => Promise<SearchEngine> } = {}) {
  const view = render(<SearchDialog base={props.base ?? "/"} load={props.load ?? okLoad} />);
  fireEvent.click(screen.getByTestId("search-trigger"));
  await waitFor(() => expect(screen.queryByText("Loading search index…")).toBeNull());
  return view;
}
const input = () => screen.getByRole("combobox") as HTMLInputElement;
const type = (value: string) => fireEvent.change(input(), { target: { value } });
const options = () => screen.queryAllByRole("option");

describe("opening and closing", () => {
  it("is closed until triggered, then opens a modal dialog with the input focused", async () => {
    render(<SearchDialog base="/" load={okLoad} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    const trigger = screen.getByTestId("search-trigger");
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    expect(trigger.getAttribute("aria-keyshortcuts")).toContain("Control+K");
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe("Search documentation");
    expect(document.activeElement).toBe(input());
  });

  it('opens with "/" and prevents the character from being typed', () => {
    render(<SearchDialog base="/" load={okLoad} />);
    const ev = new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true });
    act(() => void document.dispatchEvent(ev));
    expect(ev.defaultPrevented).toBe(true);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it('does not hijack "/" while the user types in another field', () => {
    render(<SearchDialog base="/" load={okLoad} />);
    const field = document.createElement("input");
    document.body.appendChild(field);
    field.focus();
    const ev = new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true });
    act(() => void field.dispatchEvent(ev));
    expect(ev.defaultPrevented).toBe(false);
    expect(screen.queryByRole("dialog")).toBeNull();
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);
    ta.focus();
    act(() => void ta.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true })));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens with Ctrl+K and Cmd+K, even from a text field, but not with Alt/Shift-less other keys", () => {
    render(<SearchDialog base="/" load={okLoad} />);
    const field = document.createElement("input");
    document.body.appendChild(field);
    field.focus();
    fireEvent.keyDown(field, { key: "k", ctrlKey: true });
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("ignores modified slashes and other keys", () => {
    render(<SearchDialog base="/" load={okLoad} />);
    fireEvent.keyDown(document, { key: "/", ctrlKey: true });
    fireEvent.keyDown(document, { key: "k" });
    fireEvent.keyDown(document, { key: "a" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Escape closes it and focus returns to what had focus before", async () => {
    render(<SearchDialog base="/" load={okLoad} />);
    const before = document.createElement("button");
    before.textContent = "before";
    document.body.appendChild(before);
    before.focus();
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(document.activeElement).toBe(input());
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(before);
  });

  it("falls back to the trigger when the previously focused element is gone", () => {
    render(<SearchDialog base="/" load={okLoad} />);
    const temp = document.createElement("button");
    document.body.appendChild(temp);
    temp.focus();
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    temp.remove();
    fireEvent.click(screen.getByLabelText("Close search"));
    expect(document.activeElement).toBe(screen.getByTestId("search-trigger"));
  });

  it("closes via the close button and a backdrop click, but not a click inside the dialog", () => {
    render(<SearchDialog base="/" load={okLoad} />);
    fireEvent.click(screen.getByTestId("search-trigger"));
    fireEvent.mouseDown(screen.getByRole("dialog"));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.mouseDown(screen.getByTestId("search-backdrop"));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByTestId("search-trigger"));
    fireEvent.click(screen.getByLabelText("Close search"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("locks page scroll while open and restores it afterwards; clears the query on close", async () => {
    await openWith();
    expect(document.documentElement.style.overflow).toBe("hidden");
    type("install");
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(document.documentElement.style.overflow).toBe("");
    fireEvent.click(screen.getByTestId("search-trigger"));
    await waitFor(() => expect(input().value).toBe(""));
  });
});

describe("loading, errors and empty states", () => {
  it("shows a loading state, then an invitation to type", async () => {
    let resolve!: (e: SearchEngine) => void;
    render(<SearchDialog base="/" load={() => new Promise((r) => (resolve = r))} />);
    fireEvent.click(screen.getByTestId("search-trigger"));
    expect(screen.getByText("Loading search index…")).toBeTruthy();
    expect(screen.getByTestId("search-status").textContent).toBe("Loading search index");
    await act(async () => resolve(makeEngine()));
    expect(screen.getByText("Type to search 3 pages.")).toBeTruthy();
  });

  it("shows an actionable error and recovers on retry", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("Could not download the search index (HTTP 404).")).mockResolvedValue(makeEngine());
    render(<SearchDialog base="/" load={load} />);
    fireEvent.click(screen.getByTestId("search-trigger"));
    await screen.findByRole("alert");
    expect(screen.getByText("Search is unavailable.")).toBeTruthy();
    expect(screen.getByText(/HTTP 404/)).toBeTruthy();
    expect(screen.getByTestId("search-status").textContent).toBe("Search is unavailable");
    fireEvent.click(screen.getByText("Try again"));
    await screen.findByText("Type to search 3 pages.");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("loads the index only once across several opens", async () => {
    const load = vi.fn(okLoad);
    render(<SearchDialog base="/" load={load} />);
    fireEvent.click(screen.getByTestId("search-trigger"));
    await screen.findByText("Type to search 3 pages.");
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByTestId("search-trigger"));
    await screen.findByText("Type to search 3 pages.");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("explains an empty result set and announces it", async () => {
    await openWith();
    type("zzzzqqq");
    expect(screen.getByTestId("search-empty").textContent).toContain("No results for “zzzzqqq”");
    expect(screen.getByTestId("search-status").textContent).toBe("No results");
    expect(options()).toHaveLength(0);
  });

  it("treats blank and punctuation-only input as no query", async () => {
    await openWith();
    for (const q of ["   ", "!!!", "~ *"]) {
      type(q);
      expect(options()).toHaveLength(0);
    }
  });

  it("handles an empty site", async () => {
    await openWith({ load: () => Promise.resolve(makeEngine([])) });
    expect(screen.getByText("Type to search 0 pages.")).toBeTruthy();
    type("anything");
    expect(screen.getByTestId("search-empty")).toBeTruthy();
  });
});

describe("results and keyboard navigation", () => {
  it("renders an accessible combobox + listbox with the best match selected", async () => {
    await openWith();
    type("install");
    const opts = options();
    expect(opts).toHaveLength(2);
    expect(opts[0]!.textContent).toContain("Installation");
    expect(opts[0]!.getAttribute("aria-selected")).toBe("true");
    expect(opts[1]!.getAttribute("aria-selected")).toBe("false");
    expect(input().getAttribute("aria-expanded")).toBe("true");
    expect(input().getAttribute("aria-autocomplete")).toBe("list");
    expect(input().getAttribute("aria-activedescendant")).toBe(opts[0]!.id);
    expect(input().getAttribute("aria-controls")).toBe(screen.getByRole("listbox").id);
    expect(screen.getByTestId("search-status").textContent).toBe("2 results");
    expect(screen.getByRole("listbox").getAttribute("aria-label")).toBe("Search results");
  });

  it("announces a single result in the singular", async () => {
    await openWith();
    type("optional");
    expect(screen.getByTestId("search-status").textContent).toBe("1 result");
  });

  it("moves the selection with the arrow keys and wraps around", async () => {
    await openWith();
    type("install");
    const [a, b] = options();
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(input().getAttribute("aria-activedescendant")).toBe(b!.id);
    expect(b!.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(input().getAttribute("aria-activedescendant")).toBe(a!.id); // wrapped
    fireEvent.keyDown(input(), { key: "ArrowUp" });
    expect(input().getAttribute("aria-activedescendant")).toBe(b!.id); // wrapped back
  });

  it("supports Ctrl+End / Ctrl+Home to jump to the last / first result", async () => {
    await openWith();
    type("install");
    const [a, b] = options();
    fireEvent.keyDown(input(), { key: "End", ctrlKey: true });
    expect(input().getAttribute("aria-activedescendant")).toBe(b!.id);
    fireEvent.keyDown(input(), { key: "Home", ctrlKey: true });
    expect(input().getAttribute("aria-activedescendant")).toBe(a!.id);
  });

  it("resets the selection to the first result when the query changes", async () => {
    await openWith();
    type("install");
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    type("installa");
    expect(options()[0]!.getAttribute("aria-selected")).toBe("true");
  });

  it("Enter activates the selected result's link and closes the dialog", async () => {
    await openWith({ base: "/docs/" });
    type("install");
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    const link = options()[1]!.querySelector("a")!;
    const seen: { ctrl: boolean; href: string | null }[] = [];
    link.addEventListener("click", (e) => seen.push({ ctrl: e.ctrlKey, href: link.getAttribute("href") }));
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(seen).toEqual([{ ctrl: false, href: "/docs/guides/auth/" }]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Ctrl/Cmd+Enter passes the modifier through (open in a new tab) and keeps the dialog open", async () => {
    await openWith();
    type("install");
    const link = options()[0]!.querySelector("a")!;
    const seen: boolean[] = [];
    link.addEventListener("click", (e) => seen.push(e.ctrlKey || e.metaKey));
    fireEvent.keyDown(input(), { key: "Enter", ctrlKey: true });
    fireEvent.keyDown(input(), { key: "Enter", metaKey: true });
    expect(seen).toEqual([true, true]);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("Enter with no results does nothing", async () => {
    await openWith();
    type("zzzzqqq");
    expect(() => fireEvent.keyDown(input(), { key: "Enter" })).not.toThrow();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("builds result URLs from the base path, route and best-matching heading", async () => {
    await openWith({ base: "/docs/" });
    type("tokens");
    const hrefs = options().map((o) => o.querySelector("a")!.getAttribute("href"));
    expect(hrefs).toContain("/docs/guides/auth/#tokens");
    expect(hrefs).toContain("/docs/reference/api/");
    type("optional");
    expect(options()[0]!.querySelector("a")!.getAttribute("href")).toBe("/docs/guides/auth/");
  });

  it("closes after a plain click on a result, but stays open for Ctrl-click", async () => {
    await openWith();
    type("install");
    fireEvent.click(options()[0]!.querySelector("a")!, { ctrlKey: true });
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(options()[0]!.querySelector("a")!);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("hovering a result selects it", async () => {
    await openWith();
    type("install");
    fireEvent.mouseMove(options()[1]!.querySelector("a")!);
    expect(options()[1]!.getAttribute("aria-selected")).toBe("true");
  });

  it("highlights matches with <mark> and shows the matching section", async () => {
    await openWith();
    type("tokens");
    const marks = [...screen.getByRole("listbox").querySelectorAll("mark")].map((m) => m.textContent?.toLowerCase());
    expect(marks.length).toBeGreaterThan(0);
    expect(marks.every((m) => m === "tokens")).toBe(true);
    expect(options().some((o) => o.textContent?.includes("API tokens"))).toBe(true);
  });

  it("limits the list to ten results", async () => {
    const many = Array.from({ length: 25 }, (_, i) => doc(`/p${i}/`, `Page ${i}`, { text: "common word" }));
    await openWith({ load: () => Promise.resolve(makeEngine(many)) });
    type("common");
    expect(options()).toHaveLength(10);
  });
});

describe("keyboard works even when focus is not in the input", () => {
  it("Escape closes after focus fell back to <body> (click on empty dialog space)", async () => {
    await openWith();
    (document.activeElement as HTMLElement).blur();
    expect(document.activeElement).toBe(document.body);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("arrow keys still move the selection from the close button", async () => {
    await openWith();
    type("install");
    screen.getByLabelText("Close search").focus();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(options()[1]!.getAttribute("aria-selected")).toBe("true");
  });

  it("Tab brings focus back into the dialog if it escaped", async () => {
    await openWith();
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(document.body, { key: "Tab" });
    expect(document.activeElement).toBe(input());
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(document.body, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByLabelText("Close search"));
  });

  it("clicking non-interactive dialog content keeps focus inside the dialog", async () => {
    await openWith();
    screen.getByRole("dialog").focus();
    expect(screen.getByRole("dialog").getAttribute("tabindex")).toBe("-1");
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("focus trap", () => {
  it("Tab wraps from the last control to the first, and Shift+Tab the other way", async () => {
    await openWith();
    const close = screen.getByLabelText("Close search");
    close.focus();
    fireEvent.keyDown(close, { key: "Tab" });
    expect(document.activeElement).toBe(input());
    fireEvent.keyDown(input(), { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(close);
  });

  it("result links stay out of the Tab order (selection uses aria-activedescendant)", async () => {
    await openWith();
    type("install");
    for (const a of screen.getByRole("listbox").querySelectorAll("a")) expect(a.getAttribute("tabindex")).toBe("-1");
  });
});

describe("hostile index content is rendered as text", () => {
  it("never creates elements from titles, headings, descriptions or excerpts", async () => {
    const evil = [
      doc("/x/", '<img src=x onerror="window.__pwned=1"> Title', {
        description: '<script>window.__pwned=2</script>',
        headings: [{ depth: 2, id: "h", text: '<b onmouseover="window.__pwned=3">Heading</b> payload' }],
        text: 'payload <iframe src="javascript:window.__pwned=4"></iframe> <svg onload="window.__pwned=5"> more',
      }),
    ];
    await openWith({ load: () => Promise.resolve(makeEngine(evil)) });
    type("payload");
    const list = screen.getByRole("listbox");
    expect(list.querySelector("img, script, iframe, svg, b")).toBeNull();
    expect(list.textContent).toContain("<img");
    expect(list.textContent).toContain("<iframe");
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it("encodes unusual ids and heading ids in URLs", async () => {
    const odd = [doc("/a b/ü/", "Odd page", { headings: [{ depth: 2, id: 'x"><y', text: "weird heading" }], text: "findme" })];
    await openWith({ load: () => Promise.resolve(makeEngine(odd)) });
    type("weird");
    expect(options()[0]!.querySelector("a")!.getAttribute("href")).toBe('/a%20b/%C3%BC/#x%22%3E%3Cy');
  });
});
