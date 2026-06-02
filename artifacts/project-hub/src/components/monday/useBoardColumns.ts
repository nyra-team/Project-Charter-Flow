// Per-board column show/hide, persisted through the existing saved-views
// infrastructure (use-user-view, scope "task_grid"). Keeps a stable column
// order; only visibility is user-controlled. No new persistence layer.
import { useCallback, useMemo } from "react";
import { useUserView, type ViewScope } from "@/hooks/use-user-view";
import type { BoardColumn } from "./types";

export function useBoardColumns<R>(opts: {
  /** Stable identity for this board surface (saved-view key). */
  boardKey: string;
  scope?: ViewScope;
  /** Full ordered column set; visibility is overlaid from saved prefs. */
  columns: BoardColumn<R>[];
}): {
  columns: BoardColumn<R>[];
  hidden: Set<string>;
  toggleColumn: (key: string) => void;
} {
  const { boardKey, scope = "task_grid", columns } = opts;
  const { activeConfig, saveAs } = useUserView<{ hiddenColumns?: string[] }>({
    scope,
    fallback: { hiddenColumns: [] },
  });

  const hidden = useMemo(() => new Set(activeConfig.hiddenColumns ?? []), [activeConfig.hiddenColumns]);

  const resolved = useMemo(
    () => columns.map((c) => ({ ...c, visible: c.visible !== false && !hidden.has(c.key) })),
    [columns, hidden],
  );

  const toggleColumn = useCallback(
    (key: string) => {
      const next = new Set(hidden);
      next.has(key) ? next.delete(key) : next.add(key);
      void saveAs(`board:${boardKey}`, { hiddenColumns: [...next] });
    },
    [hidden, saveAs, boardKey],
  );

  return { columns: resolved, hidden, toggleColumn };
}
