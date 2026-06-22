// TitleTooltip — one global, styled replacement for the browser's native
// `title=""` tooltip, applied across the entire PMO app.
//
// Native `title` tooltips are unstylable and inconsistent (OS-themed, slow,
// truncated). Rather than rewrite the ~95 files that use `title=`, this single
// component (mounted once in App.tsx) intercepts hover on ANY element carrying a
// `title` attribute — including SVGs, whose `title` attribute browsers ignore —
// suppresses the OS tooltip, and renders a styled bubble in the popover design
// language. HoverHint / Radix tooltips are untouched (they don't use `title`).
//
// ponytail: delegated listener on document, not a wrapper per call-site — one
// file styles every hover. If a call-site ever needs rich rows/footer, use
// <HoverHint> there instead.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type Tip = { text: string; x: number; y: number; below: boolean };

export function TitleTooltip() {
  const [tip, setTip] = useState<Tip | null>(null);

  useEffect(() => {
    let active: Element | null = null; // element whose `title` we have lifted

    const place = (el: Element, text: string) => {
      const r = el.getBoundingClientRect();
      const below = r.top < 56; // not enough room above → flip under the element
      setTip({ text, x: r.left + r.width / 2, y: below ? r.bottom + 8 : r.top - 8, below });
    };

    const show = (e: Event) => {
      const el = (e.target as Element | null)?.closest?.("[title]") ?? null;
      if (!el || el === active) return;
      const text = el.getAttribute("title");
      if (!text || !text.trim()) return;
      // Lift the attribute so the OS tooltip never appears; restored on leave.
      el.setAttribute("data-title", text);
      el.removeAttribute("title");
      active = el;
      place(el, text);
    };

    const restore = () => {
      if (!active) return;
      const saved = active.getAttribute("data-title");
      if (saved != null) { active.setAttribute("title", saved); active.removeAttribute("data-title"); }
      active = null;
      setTip(null);
    };

    const onOut = (e: MouseEvent) => {
      if (!active) return;
      const to = e.relatedTarget as Node | null;
      if (to && active.contains(to)) return; // still hovering within the element
      restore();
    };

    document.addEventListener("mouseover", show, true);
    document.addEventListener("mouseout", onOut, true);
    document.addEventListener("scroll", restore, true);
    window.addEventListener("blur", restore);
    return () => {
      restore();
      document.removeEventListener("mouseover", show, true);
      document.removeEventListener("mouseout", onOut, true);
      document.removeEventListener("scroll", restore, true);
      window.removeEventListener("blur", restore);
    };
  }, []);

  if (!tip) return null;
  return createPortal(
    <div
      role="tooltip"
      className="pointer-events-none fixed z-[9999] max-w-[280px] rounded-md border border-popover-border bg-popover px-2.5 py-1.5 text-[11px] font-medium leading-snug text-popover-foreground shadow-lg"
      style={{ left: tip.x, top: tip.y, transform: `translate(-50%, ${tip.below ? "0" : "-100%"})` }}
    >
      {tip.text}
    </div>,
    document.body,
  );
}
