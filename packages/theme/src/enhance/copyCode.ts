/** Copy-to-clipboard for code blocks via one delegated listener; results are announced to screen readers. */
export function initCopyCode(doc: Document = document): () => void {
  const status = doc.getElementById("df-copy-status");

  const announce = (msg: string): void => {
    if (!status) return;
    status.textContent = "";
    setTimeout(() => {
      status.textContent = msg;
    }, 30);
  };

  async function writeText(text: string): Promise<boolean> {
    const nav = doc.defaultView?.navigator;
    if (nav?.clipboard?.writeText) {
      try {
        await nav.clipboard.writeText(text);
        return true;
      } catch {
        return false;
      }
    }
    try {
      const ta = doc.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;opacity:0";
      doc.body.appendChild(ta);
      ta.select();
      const ok = doc.execCommand("copy");
      doc.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }

  const onClick = (e: Event): void => {
    const target = e.target as Element | null;
    const btn = target?.closest?.<HTMLButtonElement>(".copy-btn");
    if (!btn) return;
    const code = btn.closest(".code-block")?.querySelector("pre code");
    if (!code) return;
    void writeText(code.textContent ?? "").then((ok) => {
      btn.textContent = ok ? "Copied" : "Copy failed";
      btn.dataset["state"] = ok ? "copied" : "failed";
      announce(ok ? "Code copied to clipboard" : "Could not copy code");
      setTimeout(() => {
        btn.textContent = "Copy";
        delete btn.dataset["state"];
      }, 2000);
    });
  };

  doc.addEventListener("click", onClick);
  return () => doc.removeEventListener("click", onClick);
}
