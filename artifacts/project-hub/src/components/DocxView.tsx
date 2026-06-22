// DocxView — inline document preview. Fetches a generated .docx from `docxUrl`
// and renders it in-browser via docx-preview (the same render used by the
// post-submit preview). Embeddable in a details section; the pane is
// user-resizable (drag the bottom-right handle) and the .docx is downloadable.
import { useEffect, useRef, useState } from "react";
import { FileText, Loader2, Download } from "lucide-react";

const clampZoom = (v: number) => Math.min(3, Math.max(0.5, v));

export function DocxView({ docxUrl, fileName = "document.docx", className, height = "70vh" }: {
  docxUrl: string;
  fileName?: string;
  className?: string;
  height?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [err, setErr] = useState("");
  // Zoom the rendered document on Ctrl/⌘+scroll or two-finger pinch. CSS `zoom`
  // (not transform) so the page reflows and the scrollbars track the new size.
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  zoomRef.current = zoom;

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      setZoom((z) => clampZoom(z * (e.deltaY < 0 ? 1.1 : 0.9)));
    };
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    let startDist = 0, startZoom = 1;
    const onTouchStart = (e: TouchEvent) => { if (e.touches.length === 2) { startDist = dist(e.touches); startZoom = zoomRef.current; } };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && startDist) { e.preventDefault(); setZoom(clampZoom(startZoom * dist(e.touches) / startDist)); }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(docxUrl);
        if (!res.ok) throw new Error(`Failed to generate (HTTP ${res.status})`);
        const blob = await res.blob();
        if (cancelled) return;
        const container = ref.current;
        if (!container) throw new Error("Preview container unavailable");
        container.innerHTML = "";
        const { renderAsync } = await import("docx-preview");
        if (cancelled) return;
        await renderAsync(blob, container, undefined, {
          className: "docx-preview", inWrapper: true, ignoreWidth: false, ignoreHeight: false, breakPages: true, useBase64URL: true,
        });
        if (!cancelled) setStatus("ready");
      } catch (e) {
        if (!cancelled) { setStatus("error"); setErr(e instanceof Error ? e.message : "Failed to render preview"); }
      }
    }
    const t = setTimeout(load, 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [docxUrl]);

  async function download() {
    try {
      const res = await fetch(docxUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch { /* ignore — preview still visible */ }
  }

  return (
    // resize-y + overflow-hidden gives a draggable bottom-right resize handle.
    <div className={`flex flex-col rounded-lg border border-border bg-muted/40 overflow-hidden resize-y min-h-[260px] ${className ?? ""}`} style={{ height }}>
      <div className="flex-shrink-0 flex items-center gap-2 px-2 py-1.5 border-b border-border bg-card/60">
        <span className="text-[10px] text-muted-foreground hidden sm:inline">Ctrl+scroll / pinch to zoom</span>
        <button onClick={() => setZoom(1)} title="Reset zoom" className="ml-auto text-[11px] font-medium tabular-nums text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-accent">
          {Math.round(zoom * 100)}%
        </button>
        <button onClick={download} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm">
          <Download size={13} /> Download .docx
        </button>
      </div>
      <div ref={bodyRef} className="flex-1 min-h-0 overflow-auto scrollbar-thin">
        {status === "loading" && (
          <div className="h-full flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 size={18} className="animate-spin" /> <span className="text-sm">Generating preview…</span>
          </div>
        )}
        {status === "error" && (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-6">
            <FileText size={32} className="text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground max-w-md">{err}</p>
          </div>
        )}
        <div ref={ref} className={status === "ready" ? "flex justify-center py-4" : "hidden"} style={{ zoom } as React.CSSProperties} />
      </div>
    </div>
  );
}
