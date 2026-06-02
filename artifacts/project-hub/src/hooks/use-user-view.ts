import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";

// ─── Types ──────────────────────────────────────────────────────────────────

export type ViewScope =
  | "task_grid"
  | "project_list"
  | "portfolio_dashboard"
  | "exec_dashboard"
  | "sidebar";

export type SavedView = {
  id: number;
  userId: string;
  scope: ViewScope;
  key: string;
  config: Record<string, unknown>;
  isDefault: boolean;
  sharedWithRole: string | null;
  createdAt: string;
  updatedAt: string;
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  if (res.status === 204) return null;
  if (!res.ok) throw new Error((await res.text()) || `${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

// ─── Hook ───────────────────────────────────────────────────────────────────

/**
 * Saved-views hook for a single surface (one `scope`).
 *
 * The surface owns its own `config` shape — the hook is config-agnostic. A
 * caller typically:
 *   const { activeConfig, saveAs, setActive, deleteView, views } = useUserView({
 *     scope: "task_grid",
 *     fallback: { search: "", status: "", priority: "" },
 *   });
 *
 * Behaviour:
 * - On mount, loads (a) all of this user's views for the scope and (b) the
 *   default one (if any). `activeConfig` resolves to:
 *     1. the currently-active view's `config`, if one is selected;
 *     2. else the default view's config;
 *     3. else `fallback`.
 * - `saveAs(name, config, { setDefault? })` creates or overwrites a view.
 * - `setActive(id | null)` flips which view's config drives `activeConfig`
 *   without writing to the server (cheap session-level switching).
 * - `setDefault(id)` flips the persisted default for the next session.
 * - `deleteView(id)` removes the row; if it was the active one, falls back.
 * - `resetToFallback()` clears the active view selection, returning to the
 *   default-or-fallback.
 */
export function useUserView<TConfig extends Record<string, unknown>>(opts: {
  scope: ViewScope;
  fallback: TConfig;
}): {
  views: SavedView[];
  activeId: number | null;
  activeView: SavedView | null;
  activeConfig: TConfig;
  isLoading: boolean;
  saveAs: (key: string, config: TConfig, options?: { setDefault?: boolean }) => Promise<SavedView>;
  setActive: (id: number | null) => void;
  setDefault: (id: number) => Promise<void>;
  deleteView: (id: number) => Promise<void>;
  resetToFallback: () => void;
} {
  const { scope, fallback } = opts;
  const qc = useQueryClient();

  const listKey = useMemo(() => ["user-preferences", scope] as const, [scope]);

  const { data: views, isLoading } = useQuery({
    queryKey: listKey,
    queryFn: () =>
      fetchJson<SavedView[]>(`/api/user-preferences?scope=${encodeURIComponent(scope)}`).then((v) => v ?? []),
  });

  // Session-level "which view is active right now" — not persisted; user can
  // flip between saved views without writing to the server.
  const [activeId, setActiveId] = useState<number | null>(null);

  // First-load defaulting: when views arrive, if the user hasn't picked one
  // yet, snap to whichever row is is_default. Effects keep it idempotent.
  useEffect(() => {
    if (activeId != null) return;
    const def = views?.find((v) => v.isDefault);
    if (def) setActiveId(def.id);
  }, [views, activeId]);

  const activeView = useMemo(() => views?.find((v) => v.id === activeId) ?? null, [views, activeId]);

  const activeConfig: TConfig = useMemo(() => {
    if (activeView) return { ...fallback, ...(activeView.config as Partial<TConfig>) } as TConfig;
    const def = views?.find((v) => v.isDefault);
    if (def) return { ...fallback, ...(def.config as Partial<TConfig>) } as TConfig;
    return fallback;
    // fallback intentionally not in deps — it's a stable identity from the
    // caller for the lifetime of the hook usage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, views]);

  const upsertMutation = useMutation({
    mutationFn: (body: { key: string; config: TConfig; isDefault?: boolean }) =>
      fetchJson<SavedView>("/api/user-preferences", {
        method: "POST",
        body: JSON.stringify({ scope, key: body.key, config: body.config, isDefault: body.isDefault }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: listKey }),
  });

  const patchMutation = useMutation({
    mutationFn: (body: { id: number; isDefault?: boolean }) =>
      fetchJson<SavedView>(`/api/user-preferences/${body.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isDefault: body.isDefault }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: listKey }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      fetchJson<{ success: boolean }>(`/api/user-preferences/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: listKey }),
  });

  const saveAs = useCallback(
    async (key: string, config: TConfig, options?: { setDefault?: boolean }): Promise<SavedView> => {
      const row = await upsertMutation.mutateAsync({ key, config, isDefault: options?.setDefault });
      if (!row) throw new Error("Save returned no row");
      setActiveId(row.id);
      return row;
    },
    [upsertMutation],
  );

  const setActive = useCallback((id: number | null) => setActiveId(id), []);

  const setDefaultView = useCallback(
    async (id: number) => {
      await patchMutation.mutateAsync({ id, isDefault: true });
    },
    [patchMutation],
  );

  const deleteView = useCallback(
    async (id: number) => {
      await deleteMutation.mutateAsync(id);
      if (activeId === id) setActiveId(null);
    },
    [deleteMutation, activeId],
  );

  const resetToFallback = useCallback(() => setActiveId(null), []);

  return {
    views: views ?? [],
    activeId,
    activeView,
    activeConfig,
    isLoading,
    saveAs,
    setActive,
    setDefault: setDefaultView,
    deleteView,
    resetToFallback,
  };
}
