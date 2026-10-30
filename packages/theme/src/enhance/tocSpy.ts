/**
 * Highlights the table-of-contents entry for the section being read
 * (`aria-current="location"`), and closes the mobile TOC after choosing an entry.
 */
export function initTocSpy(doc: Document = document): () => void {
  const links = [...doc.querySelectorAll<HTMLAnchorElement>('.toc a[href^="#"], .toc-mobile a[href^="#"]')];
  if (links.length === 0) return () => {};

  const byId = new Map<string, HTMLAnchorElement[]>();
  for (const a of links) {
    const id = decodeURIComponent(a.getAttribute("href")!.slice(1));
    byId.set(id, [...(byId.get(id) ?? []), a]);
  }
  const headings = [...byId.keys()].map((id) => doc.getElementById(id)).filter((h): h is HTMLElement => h !== null);
  if (headings.length === 0) return () => {};

  const setCurrent = (id: string | undefined): void => {
    for (const a of links) a.removeAttribute("aria-current");
    if (id) for (const a of byId.get(id) ?? []) a.setAttribute("aria-current", "location");
  };

  // The current section is the last heading whose top has passed the sticky header (nothing before the first one).
  const pick = (): void => {
    let current: HTMLElement | undefined;
    for (const h of headings) {
      if (h.getBoundingClientRect().top <= 96) current = h;
    }
    setCurrent(current?.id);
  };

  let observer: IntersectionObserver | undefined;
  const win = doc.defaultView;
  if (win && "IntersectionObserver" in win) {
    observer = new win.IntersectionObserver(
      () => pick(), // re-evaluate whenever a heading crosses the reading line
      { rootMargin: "-80px 0px -60% 0px" },
    );
    for (const h of headings) observer.observe(h);
  }
  win?.addEventListener("scroll", pick, { passive: true });
  pick();

  const onClick = (e: Event): void => {
    const a = (e.target as Element | null)?.closest?.<HTMLAnchorElement>(".toc-mobile a");
    if (a) a.closest("details")?.removeAttribute("open");
  };
  doc.addEventListener("click", onClick);

  return () => {
    observer?.disconnect();
    win?.removeEventListener("scroll", pick);
    doc.removeEventListener("click", onClick);
  };
}
