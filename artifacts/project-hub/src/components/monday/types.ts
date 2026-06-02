// Shared types for the reusable Monday.com-style board primitive.
//
// MondayBoard renders any hierarchy (Portfolio → Project → Milestone → Task →
// Subtask, or any subset) as a grouped, expandable, drag-and-drop table with a
// configurable set of columns. Surfaces (Project Work tab, global Work
// Breakdown, Portfolio, Projects list) supply their own row type `R`, a column
// config, and the mutation callbacks; the board owns the table chrome,
// expand/collapse, group bars, drag handles and inline "+ add" rows.
import type { ReactNode } from "react";

export interface BoardColumn<R> {
  /** Stable key — also used for show/hide persistence. */
  key: string;
  /** Column header label. */
  header: string;
  /** Fixed pixel width. Omit for an auto/flex column. */
  width?: number;
  align?: "left" | "center" | "right";
  /** Cell renderer for a row. Receives the row and its computed rollup %. */
  render: (row: R, ctx: BoardRowContext) => ReactNode;
  /** When false, the column is hidden (driven by useBoardColumns). */
  visible?: boolean;
}

export interface BoardRowContext {
  /** 0 = top-level row, 1 = child, 2 = grandchild … (drives indent). */
  depth: number;
  /** Rolled-up progress for this row (subtree average), 0–100. */
  rollupPct: number;
  /** Whether this row has children. */
  hasChildren: boolean;
  expanded: boolean;
}

export interface BoardGroup<R> {
  /** Stable group key (also the dnd drop target suffix). */
  key: string;
  label: string;
  /** Accent colour for the group bar / left rail. */
  color?: string;
  rows: R[];
  /** Optional right-aligned summary node (e.g. group rollup bar). */
  meta?: ReactNode;
  /** Optional dnd drop id for "move into this group" (e.g. a lifecycle stage). */
  dropId?: string;
}

export interface MondayBoardProps<R> {
  groups: BoardGroup<R>[];
  /** Columns shown to the right of the always-present Name column. */
  columns: BoardColumn<R>[];
  /** Stable drag id for a row (caller owns the id scheme, e.g. "task:42"). */
  getRowId: (row: R) => string;
  /** Primary label cell content (text or rich node). */
  getName: (row: R) => ReactNode;
  /** Children of a row, for the hierarchy. Omit for flat boards. */
  getChildren?: (row: R) => R[];
  /** Per-row progress % (leaf value or precomputed rollup). */
  getProgress?: (row: R) => number;

  /** localStorage namespace for expand/collapse state. */
  storageKey?: string;
  /** Groups start expanded (default true). */
  defaultGroupsExpanded?: boolean;

  /** Row click (opens detail). */
  onOpenRow?: (row: R) => void;
  /** Drag-and-drop reparent: caller maps (activeId, overId) to a mutation. */
  onReparent?: (activeId: string, overId: string) => void;
  /** A row can accept drops (becomes a droppable with id "drop-<rowId>"). */
  rowIsDropTarget?: (row: R) => boolean;
  /** Enable drag handles on rows. */
  draggable?: boolean;

  /** Inline add. ctx identifies where the new row goes. Return resolves on done. */
  onAddRow?: (ctx: { groupKey?: string; parentId?: string }, name: string) => void;
  /** Placeholder text for the inline add input at a given context. */
  addPlaceholder?: (ctx: { groupKey?: string; parentId?: string }) => string;
  /** Show the "+ add" affordance on groups / rows. */
  allowAddInGroup?: boolean;
  allowAddInRow?: (row: R) => boolean;

  /** Empty-state node when there are no groups/rows. */
  emptyState?: ReactNode;
  className?: string;
}
