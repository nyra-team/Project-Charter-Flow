// KanbanView (PRU-53 §6.2) — the board's Kanban surface: one column per group,
// horizontal scroll. Each column wears its group's status colour as a 3px top
// rail + dot, and lights up in that colour while a card hovers over it. Cards
// are glass-surface tiles showing the item name plus a compact stack of the
// same cells as the table (via the board's column config).
//
// Drag-and-drop feel (mirrors the projects board): a PointerSensor with an 8px
// activation threshold so a click still opens the card; the dragged card lifts
// into a floating DragOverlay (soft shadow + slight tilt) while the original
// dims to a dashed ghost slot holding the gap; columns move the card
// optimistically as you drag across them; on drop the move is persisted via
// onMoveToGroup. + Add at each column bottom; + Add group as a trailing column.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors, useDroppable,
  pointerWithin, rectIntersection, defaultDropAnimationSideEffects, MeasuringStrategy,
  type CollisionDetection, type DropAnimation,
  type DragStartEvent, type DragOverEvent, type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus } from "lucide-react";
import type { BoardColumn, BoardGroup, BoardRowContext } from "./types";

const CARD_CTX: BoardRowContext = { depth: 0, rollupPct: 0, hasChildren: false, expanded: false };
const COL_W = 270;
// Fixed card height so every card on the board is the same size regardless of
// title length or how many cell chips it carries (overflow is clipped).
const CARD_H = "h-[132px]";

// Shared sortable transition — a touch longer than dnd-kit's default with a soft
// ease-out, so cards glide as the board reshuffles around a drag.
const SORT_TRANSITION = { duration: 260, easing: "cubic-bezier(0.25, 1, 0.5, 1)" };

// Pointer-first collision so a card dropped on a column lands where the cursor
// actually is (closestCorners tends to stick to the origin column).
const collision: CollisionDetection = (args) => {
  const p = pointerWithin(args);
  return p.length > 0 ? p : rectIntersection(args);
};

// Snap the floating overlay back to a settled state if a drop doesn't persist —
// a soft, timed settle (instead of an instant cut) keeps the gesture fluid.
const dropAnimation: DropAnimation = {
  duration: 280,
  easing: "cubic-bezier(0.25, 1, 0.5, 1)",
  sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: "0.4" } } }),
};

// Presentational card — shared by the live draggable card and the drag overlay
// so the floating copy is a pixel-perfect snapshot of the original.
function CardInner<R>({ row, columns, getName, getRowId, overlay }: {
  row: R; columns: BoardColumn<R>[]; getName: (r: R) => React.ReactNode; getRowId: (r: R) => string; overlay?: boolean;
}) {
  const ctx: BoardRowContext = CARD_CTX;
  // Jira-style issue key derived from the row id ("project:42" → "PROJECT-42").
  const issueKey = getRowId(row).replace(":", "-").toUpperCase();
  return (
    <div
      className={`flex flex-col rounded-[3px] bg-card border border-transparent p-3 transition-shadow ${CARD_H} ${
        overlay
          ? "shadow-[0_14px_30px_rgba(0,0,0,0.20)] rotate-[2deg] cursor-grabbing"
          : "shadow-[0_1px_2px_rgba(9,30,66,0.25)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.5)] hover:bg-accent/40"
      }`}
    >
      <div className="text-sm text-foreground leading-snug line-clamp-2">{getName(row)}</div>
      <div className="mt-2 flex-1 min-h-0 overflow-hidden flex flex-wrap content-start items-center gap-x-3 gap-y-1.5">
        {columns.filter((c) => c.visible !== false).map((col) => (
          <div key={col.key} className="min-w-0 max-w-full">{col.render(row, ctx)}</div>
        ))}
      </div>
      <div className="flex items-center justify-between pt-1 shrink-0">
        <span className="text-[11px] font-medium text-muted-foreground tracking-wide">{issueKey}</span>
      </div>
    </div>
  );
}

// Live, sortable card. Using useSortable (rather than a bare draggable) means
// the surrounding cards smoothly slide (FLIP) to make room as this card moves
// within / across columns. While dragging, the original becomes a dashed ghost
// slot (the floating copy lives in the DragOverlay); a click that never crosses
// the activation threshold opens the card instead of starting a drag.
function DraggableCard<R>({ row, columns, getRowId, getName, onOpen }: {
  row: R; columns: BoardColumn<R>[]; getRowId: (r: R) => string; getName: (r: R) => React.ReactNode; onOpen?: (r: R) => void;
}) {
  const id = getRowId(row);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    transition: SORT_TRANSITION,
  });
  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    willChange: "transform",
  };
  return (
    <div
      ref={setNodeRef} style={style} {...listeners} {...attributes}
      onClick={() => onOpen?.(row)}
      className="relative cursor-grab active:cursor-grabbing touch-none"
    >
      <div className={isDragging ? "opacity-0" : ""}>
        <CardInner row={row} columns={columns} getName={getName} getRowId={getRowId} />
      </div>
      {isDragging && (
        <div className="absolute inset-0 rounded-[3px] border-2 border-dashed border-muted-foreground/30 bg-muted/40" />
      )}
    </div>
  );
}

function Column<R>({
  group, columns, getRowId, getName, onOpen, onAddRow,
}: {
  group: BoardGroup<R>;
  columns: BoardColumn<R>[];
  getRowId: (r: R) => string;
  getName: (r: R) => React.ReactNode;
  onOpen?: (r: R) => void;
  onAddRow?: (groupKey: string, name: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `kcol:${group.key}` });
  const [adding, setAdding] = useState(false);
  const [val, setVal] = useState("");
  const color = group.color ?? "#94A3B8";
  return (
    <div className="flex flex-col flex-shrink-0 rounded-lg overflow-hidden" style={{ width: COL_W, background: `${color}26` }}>
      {/* Status-coloured top rail */}
      <div className="h-[3px] w-full" style={{ background: color }} />
      {/* Column header — coloured dot + uppercase label + count */}
      <div className="px-3 pt-2.5 pb-1 flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground truncate">{group.label}</span>
        <span className="text-[11px] text-muted-foreground">{group.rows.length}</span>
      </div>
      <div
        ref={setNodeRef}
        className="flex-1 space-y-1.5 px-1.5 pb-1.5 min-h-[80px] rounded-b-lg transition-[box-shadow,background-color] duration-200"
        style={isOver ? { boxShadow: `inset 0 0 0 2px ${color}66`, background: `${color}33` } : undefined}
      >
        <SortableContext items={group.rows.map((r) => getRowId(r))} strategy={verticalListSortingStrategy}>
          {group.rows.map((r) => (
            <DraggableCard key={getRowId(r)} row={r} columns={columns} getRowId={getRowId} getName={getName} onOpen={onOpen} />
          ))}
        </SortableContext>
        {group.rows.length === 0 && (
          <div
            className="rounded-md border-2 border-dashed text-[11px] text-center py-6 transition-colors duration-200"
            style={isOver
              ? { borderColor: `${color}99`, background: `${color}14`, color, fontWeight: 600 }
              : { borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}
          >
            {isOver ? "Release to move here" : "No items"}
          </div>
        )}
        {onAddRow && (
          adding ? (
            <input
              autoFocus value={val} onChange={(e) => setVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && val.trim()) { onAddRow(group.key, val.trim()); setVal(""); setAdding(false); }
                if (e.key === "Escape") { setVal(""); setAdding(false); }
              }}
              onBlur={() => { if (val.trim()) onAddRow(group.key, val.trim()); setVal(""); setAdding(false); }}
              placeholder="New item…"
              className="w-full text-xs border border-input bg-background rounded-md px-2.5 py-1.5 outline-none focus:ring-2 focus:ring-ring/40"
            />
          ) : (
            <button onClick={() => setAdding(true)} className="flex items-center gap-1.5 w-full py-1.5 px-1 text-xs text-muted-foreground/60 hover:text-primary transition-colors">
              <Plus size={12} /> Add item
            </button>
          )
        )}
      </div>
    </div>
  );
}

export function KanbanView<R>({
  groups, columns, getRowId, getName, onOpenRow, onMoveToGroup, onAddRow, onAddGroup,
}: {
  groups: BoardGroup<R>[];
  /** Cells shown on each card (same column config as the table). */
  columns: BoardColumn<R>[];
  getRowId: (r: R) => string;
  getName: (r: R) => React.ReactNode;
  onOpenRow?: (r: R) => void;
  /** Card dropped on a different column → (rowId, targetGroupKey). */
  onMoveToGroup?: (rowId: string, groupKey: string) => void;
  onAddRow?: (groupKey: string, name: string) => void;
  onAddGroup?: (name: string) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const [addingGroup, setAddingGroup] = useState(false);
  const [groupName, setGroupName] = useState("");

  // Column order + per-column metadata (label/colour), stable across drags.
  const order = useMemo(() => groups.map((g) => g.key), [groups]);
  const meta = useMemo(
    () => new Map(groups.map((g) => [g.key, { label: g.label, color: g.color }])),
    [groups],
  );

  // Local board state — mirrors `groups` but is mutated live during a drag for
  // optimistic cross-column movement; re-synced from props whenever they change
  // and no drag is in flight.
  const build = () => {
    const o: Record<string, R[]> = {};
    for (const g of groups) o[g.key] = g.rows;
    return o;
  };
  const [cols, setCols] = useState<Record<string, R[]>>(build);
  const [activeId, setActiveId] = useState<string | null>(null);
  const originRef = useRef<string | null>(null);

  useEffect(() => {
    if (activeId) return; // don't clobber an in-progress drag
    setCols(build());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups]);

  const colOf = (rowId: string): string | null => {
    for (const k of order) if ((cols[k] ?? []).some((r) => getRowId(r) === rowId)) return k;
    return null;
  };
  const activeCol = activeId ? colOf(activeId) : null;
  const activeRow = activeCol ? (cols[activeCol] ?? []).find((r) => getRowId(r) === activeId) ?? null : null;

  function onDragStart(e: DragStartEvent) {
    const id = String(e.active.id);
    setActiveId(id);
    originRef.current = colOf(id);
  }

  function onDragOver(e: DragOverEvent) {
    const { active, over } = e;
    if (!over) return;
    const activeStr = String(active.id);
    const overStr = String(over.id);
    const from = colOf(activeStr);
    const to = overStr.startsWith("kcol:") ? overStr.slice("kcol:".length) : colOf(overStr);
    if (!from || !to || from === to) return;
    setCols((prev) => {
      const f = [...(prev[from] ?? [])];
      const t = [...(prev[to] ?? [])];
      const idx = f.findIndex((r) => getRowId(r) === activeStr);
      if (idx < 0) return prev;
      const [moved] = f.splice(idx, 1);
      let at = t.length;
      if (!overStr.startsWith("kcol:")) {
        const oi = t.findIndex((r) => getRowId(r) === overStr);
        if (oi >= 0) at = oi;
      }
      t.splice(at, 0, moved);
      return { ...prev, [from]: f, [to]: t };
    });
  }

  function onDragEnd() {
    const id = activeId;
    const origin = originRef.current;
    const finalCol = id ? colOf(id) : null;
    originRef.current = null;
    setActiveId(null);
    if (id && finalCol && origin && finalCol !== origin) onMoveToGroup?.(id, finalCol);
  }

  function onDragCancel() {
    originRef.current = null;
    setActiveId(null);
    setCols(build());
  }

  const body = (
    <div className="flex items-start gap-3 overflow-x-auto rounded-xl p-3 bg-[hsl(215_32%_96%)] dark:bg-background/40">
      {order.map((k) => {
        const m = meta.get(k);
        return (
          <Column
            key={k}
            group={{ key: k, label: m?.label ?? k, color: m?.color, rows: cols[k] ?? [] }}
            columns={columns}
            getRowId={getRowId}
            getName={getName}
            onOpen={onOpenRow}
            onAddRow={onAddRow}
          />
        );
      })}
      {onAddGroup && (
        <div className="flex-shrink-0" style={{ width: COL_W + 10 }}>
          {addingGroup ? (
            <input
              autoFocus value={groupName} onChange={(e) => setGroupName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && groupName.trim()) { onAddGroup(groupName.trim()); setGroupName(""); setAddingGroup(false); }
                if (e.key === "Escape") { setGroupName(""); setAddingGroup(false); }
              }}
              onBlur={() => { if (groupName.trim()) onAddGroup(groupName.trim()); setGroupName(""); setAddingGroup(false); }}
              placeholder="New group…"
              className="w-full text-xs border border-input bg-background rounded-md px-2.5 py-2 outline-none focus:ring-2 focus:ring-ring/40"
            />
          ) : (
            <button onClick={() => setAddingGroup(true)} className="flex items-center gap-1.5 w-full px-3 py-2 rounded-lg border border-dashed border-border text-xs text-muted-foreground hover:text-primary hover:border-primary/50 transition-colors">
              <Plus size={13} /> Add group
            </button>
          )}
        </div>
      )}
    </div>
  );

  if (!onMoveToGroup) return body;
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      {body}
      <DragOverlay dropAnimation={dropAnimation}>
        {activeRow ? (
          <div style={{ width: COL_W - 12 }}>
            <CardInner row={activeRow} columns={columns} getName={getName} getRowId={getRowId} overlay />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
