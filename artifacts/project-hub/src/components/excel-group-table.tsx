import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import { startColumnDrag } from "@/lib/col-drag";

export type ExcelCol = { key: string; header: string; width: number; align?: "left" | "center"; info?: string };

// One Excel-style group table that OWNS its own column order + widths (persisted
// under `storageKey`), so every group (New / Active / each milestone, …) is an
// independent table — reordering or resizing one never affects the others.
//
// The <tbody> is supplied via the `children` render-prop so callers can render
// nested rows (e.g. tasks + indented subtasks). It receives the live ordered
// columns and a `cellsFor(key)` order so each row stays in sync.
export function ExcelGroupTable({
  cols,
  storageKey,
  accent,
  renderHeaderLabel,
  children,
}: {
  cols: ExcelCol[];
  storageKey: string;
  accent?: string;
  renderHeaderLabel?: (col: ExcelCol) => ReactNode;
  children: (orderedCols: ExcelCol[]) => ReactNode;
}) {
  const colKeys = cols.map((c) => c.key);

  // Per-table column order.
  const [order, setOrder] = useState<string[]>(() => {
    if (typeof window !== "undefined") {
      try {
        // `:order2` — bumped from `:order` so stale saved orders (which appended
        // newer default columns like Owner at the END) are discarded once, and
        // the canonical column order takes effect.
        const saved = JSON.parse(window.localStorage.getItem(`${storageKey}:order2`) || "null");
        if (Array.isArray(saved) && saved.every((k) => typeof k === "string")) {
          // Keep the user's saved order for known columns, then splice any NEW
          // columns in at their CANONICAL position (right after their defined
          // predecessor), not at the end.
          const merged = saved.filter((k: string) => colKeys.includes(k));
          colKeys.forEach((k, idx) => {
            if (merged.includes(k)) return;
            let insertAt = merged.length;
            for (let j = idx - 1; j >= 0; j--) {
              const pos = merged.indexOf(colKeys[j]!);
              if (pos !== -1) { insertAt = pos + 1; break; }
            }
            merged.splice(insertAt, 0, k);
          });
          return merged;
        }
      } catch { /* ignore */ }
    }
    return colKeys;
  });
  useEffect(() => {
    try { window.localStorage.setItem(`${storageKey}:order2`, JSON.stringify(order)); } catch { /* ignore */ }
  }, [order, storageKey]);

  // Per-table column widths.
  const [width, setWidth] = useState<Record<string, number>>(() => {
    const defaults: Record<string, number> = {};
    for (const c of cols) defaults[c.key] = c.width;
    if (typeof window !== "undefined") {
      try {
        const saved = JSON.parse(window.localStorage.getItem(`${storageKey}:w`) || "null");
        if (saved && typeof saved === "object") return { ...defaults, ...saved };
      } catch { /* ignore */ }
    }
    return defaults;
  });
  useEffect(() => {
    try { window.localStorage.setItem(`${storageKey}:w`, JSON.stringify(width)); } catch { /* ignore */ }
  }, [width, storageKey]);

  const [dragKey, setDragKey] = useState<string | null>(null);

  const orderedCols = useMemo(() => {
    const byKey = new Map(cols.map((c) => [c.key, c]));
    const ord = order.map((k) => byKey.get(k)).filter(Boolean) as ExcelCol[];
    // Insert any column missing from the saved order at its CANONICAL position
    // (right after its defined predecessor), not appended at the end — so a
    // newly-added default column (e.g. Owner beside Project Code) lands where
    // it's defined even for users whose saved order predates it.
    cols.forEach((c, idx) => {
      if (ord.includes(c)) return;
      let insertAt = ord.length;
      for (let j = idx - 1; j >= 0; j--) {
        const pos = ord.indexOf(cols[j]!);
        if (pos !== -1) { insertAt = pos + 1; break; }
      }
      ord.splice(insertAt, 0, c);
    });
    return ord;
  }, [cols, order]);

  const totalW = useMemo(() => orderedCols.reduce((s, c) => s + (width[c.key] ?? c.width), 0) || 1, [orderedCols, width]);

  // Excel-style resize — widen A, shrink its right neighbour B by the same
  // amount so the total never changes and the table always fits the viewport.
  const startResize = (keyA: string, keyB: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const tablePx = ((e.currentTarget as HTMLElement).closest("table") as HTMLElement | null)?.offsetWidth ?? 1;
    const startX = e.clientX;
    const a = width[keyA] ?? 0, b = width[keyB] ?? 0;
    const MIN = 40;
    const onMove = (ev: MouseEvent) => {
      const dw = ((ev.clientX - startX) / tablePx) * totalW;
      const d = Math.max(-(a - MIN), Math.min(b - MIN, dw));
      setWidth((w) => ({ ...w, [keyA]: a + d, [keyB]: b - d }));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white" style={accent ? { borderLeftWidth: 4, borderLeftColor: accent } : undefined}>
      <table className="w-full min-w-[900px] border-collapse text-xs table-fixed [&_td]:overflow-hidden">
        <colgroup>
          {orderedCols.map((c) => <col key={c.key} style={{ width: `${((width[c.key] ?? c.width) / totalW) * 100}%` }} />)}
        </colgroup>
        <thead>
          <tr className="bg-gray-50 text-[9px] uppercase tracking-wider text-gray-500">
            {orderedCols.map((c, i) => (
              <th
                key={c.key}
                data-colkey={c.key}
                onMouseDown={(e) => startColumnDrag(e, c.key, setOrder, setDragKey)}
                title="Drag to reorder · drag the right edge to resize"
                className={`relative border border-gray-200 px-2 py-0.5 font-semibold select-none cursor-grab active:cursor-grabbing transition-colors ${c.align === "center" ? "text-center" : "text-left"} ${dragKey === c.key ? "bg-primary/15 text-primary shadow-inner" : ""}`}
              >
                <span className={`flex items-center gap-1 min-w-0 ${c.align === "center" ? "justify-center" : ""}`}>
                  <span className="truncate pointer-events-none">{renderHeaderLabel ? renderHeaderLabel(c) : c.header}</span>
                  {c.info && (
                    <span
                      title={c.info}
                      aria-label={c.info}
                      onMouseDown={(e) => e.stopPropagation()}
                      className="shrink-0 inline-flex pointer-events-auto cursor-help text-gray-400 hover:text-primary transition-colors"
                    >
                      <Info size={11} />
                    </span>
                  )}
                </span>
                {i < orderedCols.length - 1 && (
                  <span
                    onMouseDown={startResize(c.key, orderedCols[i + 1]!.key)}
                    title="Drag to resize"
                    aria-hidden
                    className="absolute top-0 right-0 z-10 h-full w-2 translate-x-1/2 cursor-col-resize hover:bg-primary/40 active:bg-primary/60 transition-colors"
                  />
                )}
              </th>
            ))}
          </tr>
        </thead>
        {children(orderedCols)}
      </table>
    </div>
  );
}
