// MondayBoard — the reusable Monday.com-style table at the heart of the PMO
// redesign. Renders grouped, expandable, drag-and-drop rows with a configurable
// column set. Generalises the bespoke wbs-tree.tsx so every surface (Project
// Work tab, global Work Breakdown, Portfolio, Projects list) shares one board.
//
// Hierarchy, dnd reparenting and inline-add are all driven by caller-supplied
// callbacks (the board owns chrome, not data): see types.ts for the prop API.
import { useCallback, useMemo, useState } from "react";
import {
  DndContext, DragEndEvent, PointerSensor, useSensor, useSensors,
  useDroppable, useDraggable,
} from "@dnd-kit/core";
import { ChevronRight, GripVertical, Plus } from "lucide-react";
import type { BoardColumn, BoardGroup, MondayBoardProps, BoardRowContext } from "./types";
import { ProgressCell } from "./cells";

// ── Expand/collapse state, persisted per board ───────────────────────────────
function useExpansion(storageKey?: string, defaultGroupsExpanded = true) {
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    if (!storageKey) return new Set();
    try {
      const raw = localStorage.getItem(`mb:${storageKey}`);
      if (raw) return new Set(JSON.parse(raw) as string[]);
    } catch { /* ignore */ }
    return new Set();
  });
  const persist = useCallback((next: Set<string>) => {
    if (!storageKey) return;
    try { localStorage.setItem(`mb:${storageKey}`, JSON.stringify([...next])); } catch { /* ignore */ }
  }, [storageKey]);
  const toggle = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      persist(next);
      return next;
    });
  }, [persist]);
  // Groups: tracked with a "g:" prefix; default-open unless explicitly collapsed.
  const groupExpanded = useCallback((key: string) => {
    const collapsedMarker = `g!:${key}`;
    return defaultGroupsExpanded ? !expanded.has(collapsedMarker) : expanded.has(`g:${key}`);
  }, [expanded, defaultGroupsExpanded]);
  const toggleGroup = useCallback((key: string) => {
    if (defaultGroupsExpanded) toggle(`g!:${key}`);
    else toggle(`g:${key}`);
  }, [toggle, defaultGroupsExpanded]);
  return { expanded, toggle, groupExpanded, toggleGroup };
}

// ── DnD primitives ───────────────────────────────────────────────────────────
function DragHandle({ id }: { id: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id });
  return (
    <span
      ref={setNodeRef} {...listeners} {...attributes}
      onClick={(e) => e.stopPropagation()}
      className={`cursor-grab text-muted-foreground/30 hover:text-muted-foreground flex-shrink-0 ${isDragging ? "opacity-50" : ""}`}
      title="Drag to move"
    >
      <GripVertical size={13} />
    </span>
  );
}
function DropZone({ id, children, className }: { id: string; children: React.ReactNode; className?: string }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return <div ref={setNodeRef} className={`${className ?? ""} ${isOver ? "ring-2 ring-primary/40 rounded-md" : ""}`}>{children}</div>;
}

// ── Inline add row ───────────────────────────────────────────────────────────
function AddRow({ placeholder, onSubmit, onCancel }: { placeholder: string; onSubmit: (name: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState("");
  return (
    <div className="flex items-center gap-2 py-1 pl-2" onClick={(e) => e.stopPropagation()}>
      <input
        autoFocus value={value} onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && value.trim()) onSubmit(value.trim()); if (e.key === "Escape") onCancel(); }}
        onBlur={() => { value.trim() ? onSubmit(value.trim()) : onCancel(); }}
        placeholder={placeholder}
        className="flex-1 text-xs border border-input bg-background rounded-md px-2.5 py-1.5 outline-none focus:ring-2 focus:ring-ring/40"
      />
    </div>
  );
}

const NAME_COL_PX = 320;

export function MondayBoard<R>(props: MondayBoardProps<R>) {
  const {
    groups, columns, getRowId, getName, getChildren, getProgress,
    storageKey, defaultGroupsExpanded = true,
    onOpenRow, onReparent, rowIsDropTarget, draggable = false,
    onAddRow, addPlaceholder, allowAddInGroup = false, allowAddInRow,
    emptyState, className,
  } = props;

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const { expanded, toggle, groupExpanded, toggleGroup } = useExpansion(storageKey, defaultGroupsExpanded);
  const [adding, setAdding] = useState<string | null>(null); // "group:<key>" | "row:<id>"

  const visibleCols = useMemo(() => columns.filter((c) => c.visible !== false), [columns]);

  // Rolled-up progress for a row = average of its leaves' progress (recursive).
  const rollup = useCallback((row: R): number => {
    const kids = getChildren?.(row) ?? [];
    if (kids.length === 0) return getProgress?.(row) ?? 0;
    return Math.round(kids.reduce((s, k) => s + rollup(k), 0) / kids.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getChildren, getProgress]);

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || !onReparent) return;
    if (String(active.id) === String(over.id)) return;
    onReparent(String(active.id), String(over.id));
  }

  const totalRows = groups.reduce((s, g) => s + g.rows.length, 0);
  if (totalRows === 0 && groups.length === 0) {
    return <div className={className}>{emptyState ?? <EmptyHint />}</div>;
  }

  function renderRow(row: R, depth: number): React.ReactNode {
    const id = getRowId(row);
    const kids = getChildren?.(row) ?? [];
    const hasChildren = kids.length > 0;
    const isExpanded = expanded.has(id);
    const ctx: BoardRowContext = { depth, rollupPct: rollup(row), hasChildren, expanded: isExpanded };
    const canAddHere = allowAddInRow?.(row) ?? false;

    const rowInner = (
      <div className="group/row">
        <div
          className="flex items-center border-b border-border/40 hover:bg-accent/40 transition-colors"
          onClick={() => onOpenRow?.(row)}
          role="row"
        >
          {/* Name column (sticky-ish left) */}
          <div className="flex items-center gap-1.5 py-1.5 pr-2 min-w-0" style={{ width: NAME_COL_PX, paddingLeft: 8 + depth * 18 }}>
            {draggable && <DragHandle id={id} />}
            {hasChildren ? (
              <button
                onClick={(e) => { e.stopPropagation(); toggle(id); }}
                className="flex-shrink-0 p-0.5 -ml-0.5 rounded hover:bg-accent"
                aria-label={isExpanded ? "Collapse" : "Expand"}
              >
                <ChevronRight size={13} className={`text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`} />
              </button>
            ) : (
              <span className="w-[18px] flex-shrink-0" />
            )}
            <span className="truncate text-[13px] text-foreground min-w-0 cursor-pointer hover:text-primary">{getName(row)}</span>
            {canAddHere && onAddRow && (
              <button
                onClick={(e) => { e.stopPropagation(); setAdding(`row:${id}`); if (!isExpanded) toggle(id); }}
                className="opacity-0 group-hover/row:opacity-100 p-0.5 rounded text-muted-foreground hover:text-primary hover:bg-accent flex-shrink-0"
                title="Add sub-item"
              >
                <Plus size={12} />
              </button>
            )}
          </div>
          {/* Configurable columns */}
          {visibleCols.map((col) => (
            <div
              key={col.key}
              className={`px-2 py-1.5 flex items-center flex-shrink-0 ${alignClass(col.align)}`}
              style={{ width: col.width ?? 120 }}
            >
              {col.render(row, ctx)}
            </div>
          ))}
        </div>

        {/* inline add child */}
        {adding === `row:${id}` && onAddRow && (
          <div style={{ paddingLeft: 8 + (depth + 1) * 18 }}>
            <AddRow
              placeholder={addPlaceholder?.({ parentId: id }) ?? "New item…"}
              onSubmit={(name) => { onAddRow({ parentId: id }, name); setAdding(null); }}
              onCancel={() => setAdding(null)}
            />
          </div>
        )}

        {/* children */}
        {isExpanded && hasChildren && kids.map((k) => renderRow(k, depth + 1))}
      </div>
    );

    // Wrap as a drop target if the caller allows dropping onto this row.
    if (onReparent && rowIsDropTarget?.(row)) {
      return <DropZone key={id} id={`drop-${id}`}>{rowInner}</DropZone>;
    }
    return <div key={id}>{rowInner}</div>;
  }

  const board = (
    <div className={`rounded-xl border border-card-border bg-card glass-surface overflow-hidden ${className ?? ""}`}>
      {/* Column header strip */}
      <div className="flex items-center border-b border-border bg-muted/40 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <div className="py-2 pr-2" style={{ width: NAME_COL_PX, paddingLeft: 8 }}>Item</div>
        {visibleCols.map((col) => (
          <div key={col.key} className={`px-2 py-2 flex-shrink-0 ${alignClass(col.align)}`} style={{ width: col.width ?? 120 }}>{col.header}</div>
        ))}
      </div>

      {groups.map((g) => {
        const gExpanded = groupExpanded(g.key);
        const groupRollup = g.rows.length ? Math.round(g.rows.reduce((s, r) => s + rollup(r), 0) / g.rows.length) : 0;
        const color = g.color ?? "#94A3B8";
        const groupBody = (
          <div key={g.key}>
            {/* Group bar */}
            <div
              className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-accent/30"
              style={{ borderLeft: `3px solid ${color}` }}
              onClick={() => toggleGroup(g.key)}
            >
              <ChevronRight size={14} className={`text-muted-foreground transition-transform ${gExpanded ? "rotate-90" : ""}`} />
              <span className="text-sm font-semibold" style={{ color }}>{g.label}</span>
              <span className="text-[11px] text-muted-foreground">{g.rows.length}</span>
              <div className="ml-auto flex items-center gap-3">
                {g.meta ?? <div className="w-28"><ProgressCell pct={groupRollup} /></div>}
                {allowAddInGroup && onAddRow && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setAdding(`group:${g.key}`); }}
                    className="p-1 rounded text-muted-foreground hover:text-primary hover:bg-accent"
                    title="Add item"
                  ><Plus size={13} /></button>
                )}
              </div>
            </div>

            {gExpanded && (
              <div>
                {adding === `group:${g.key}` && onAddRow && (
                  <AddRow
                    placeholder={addPlaceholder?.({ groupKey: g.key }) ?? "New item…"}
                    onSubmit={(name) => { onAddRow({ groupKey: g.key }, name); setAdding(null); }}
                    onCancel={() => setAdding(null)}
                  />
                )}
                {g.rows.map((r) => renderRow(r, 0))}
                {g.rows.length === 0 && adding !== `group:${g.key}` && (
                  <p className="text-[11px] text-muted-foreground/50 italic py-2 pl-6">No items</p>
                )}
              </div>
            )}
          </div>
        );
        // A group can be a drop target (e.g. "move milestone into this stage").
        if (onReparent && g.dropId) {
          return <DropZone key={g.key} id={g.dropId}>{groupBody}</DropZone>;
        }
        return groupBody;
      })}
    </div>
  );

  if (!draggable && !onReparent) return board;
  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      {board}
    </DndContext>
  );
}

function alignClass(a?: BoardColumn<unknown>["align"]): string {
  return a === "center" ? "justify-center text-center" : a === "right" ? "justify-end text-right" : "justify-start text-left";
}

function EmptyHint() {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/50 p-10 text-center">
      <p className="text-sm text-muted-foreground">Nothing here yet.</p>
    </div>
  );
}

export type { BoardColumn, BoardGroup, BoardRowContext, MondayBoardProps } from "./types";
