import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// Confines a modal overlay to the main content area (#ph-content) — the viewing
// section to the right of the sidebar — instead of centering over the whole
// viewport. Tracks the content area's on-screen rect (ResizeObserver + window
// resize) so the modal stays centered there when the sidebar collapses or the
// window resizes. Falls back to full-viewport until the container is measured.
export function ContentOverlay({ children, className = "", z = 120 }: {
  children: ReactNode;
  className?: string;
  z?: number;
}) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    const el = document.getElementById("ph-content");
    if (!el) return;
    const update = () => setRect(el.getBoundingClientRect());
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => { ro.disconnect(); window.removeEventListener("resize", update); };
  }, []);
  const style = rect
    ? { position: "fixed" as const, left: rect.left, top: rect.top, width: rect.width, height: rect.height, zIndex: z }
    : { position: "fixed" as const, inset: 0, zIndex: z };
  return createPortal(
    <div className={`flex items-center justify-center ${className}`} style={style}>{children}</div>,
    document.body,
  );
}
