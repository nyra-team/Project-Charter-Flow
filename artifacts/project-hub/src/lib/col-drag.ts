import type React from "react";

// Monday.com-style pointer-based column reordering. Unlike native HTML5 drag
// (janky ghost image, only reorders on drop), this updates the order LIVE: as
// the grabbed header passes another column's midpoint, the columns shift in
// real time, so the move is smooth and obvious.
//
// Usage on a <th>:
//   data-colkey={c.key}
//   onMouseDown={(e) => startColumnDrag(e, c.key, setColOrder, setDragKey)}
// The resize handle inside the <th> must call e.stopPropagation() on mousedown
// (it already does), so grabbing the edge resizes instead of reordering.
export function startColumnDrag(
  e: React.MouseEvent,
  key: string,
  setColOrder: (fn: (prev: string[]) => string[]) => void,
  setDragKey?: (k: string | null) => void,
) {
  const table = (e.currentTarget as HTMLElement).closest("table");
  if (!table || e.button !== 0) return;
  e.preventDefault();

  const startX = e.clientX;
  let dragging = false;

  const reorderTo = (clientX: number) => {
    const ths = Array.from(table.querySelectorAll<HTMLElement>("thead th[data-colkey]"));
    for (const el of ths) {
      const r = el.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right) {
        const targetKey = el.dataset.colkey;
        if (!targetKey || targetKey === key) return;
        const insertAfter = clientX > r.left + r.width / 2;
        setColOrder((prev) => {
          const arr = prev.filter((k) => k !== key);
          let idx = arr.indexOf(targetKey);
          if (idx < 0) return prev;
          if (insertAfter) idx += 1;
          arr.splice(idx, 0, key);
          if (arr.length === prev.length && arr.every((k, i) => k === prev[i])) return prev;
          return arr;
        });
        return;
      }
    }
  };

  const move = (ev: MouseEvent) => {
    if (!dragging) {
      if (Math.abs(ev.clientX - startX) < 4) return; // small threshold before it counts as a drag
      dragging = true;
      setDragKey?.(key);
      document.body.style.userSelect = "none";
      document.body.style.cursor = "grabbing";
    }
    reorderTo(ev.clientX);
  };
  const up = () => {
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", up);
    if (dragging) {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      setDragKey?.(null);
    }
  };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
}
