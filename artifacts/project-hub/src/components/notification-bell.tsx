import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useListNotifications, useMarkNotificationRead, useMarkAllNotificationsRead,
} from "@workspace/api-client-react";
import { useUserStore } from "../lib/store";
import { Bell, CheckCheck, Sparkles, X, ArrowUpRight } from "lucide-react";

type Notif = {
  id: number; userId: number; type: string; title: string; body?: string | null;
  link?: string | null; isRead: boolean; createdAt: string;
  relatedEntityType?: string | null; relatedEntityId?: number | null;
};

type Nudge = {
  id: number; userId: number; kind: string; urgency: "low" | "normal" | "high" | "critical";
  headline: string; body: string | null; link: string | null;
  sourceEntityType: string | null; sourceEntityId: number | null;
  status: "active" | "dismissed" | "acted_on" | "expired";
  createdAt: string;
};

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  if (!res.ok) throw new Error((await res.text()) || `${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export function NotificationBell() {
  const { userId } = useUserStore();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();

  // ── Notifications (existing, unchanged) ────────────────────────────────
  const { data: notifications = [], refetch } = useListNotifications(
    { userId },
    { query: { refetchInterval: 30000 } },
  );
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  // ── Nudges (Stage 4 — Nyra) ────────────────────────────────────────────
  // Separate query so the bell can render the rich nudge segment with its
  // own dismiss / acted-on CTAs without polluting the notification table
  // shape. Same 30s refetch cadence keeps both in step.
  const nudgesKey = ["nudges", userId, "active"] as const;
  const { data: nudges = [] } = useQuery({
    queryKey: nudgesKey,
    queryFn: () => fetchJson<Nudge[]>(`/api/nudges?userId=${userId}&status=active`),
    refetchInterval: 30_000,
  });

  const dismissNudge = useMutation({
    mutationFn: (id: number) => fetchJson<Nudge>(`/api/nudges/${id}/dismiss`, { method: "POST", body: "{}" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: nudgesKey });
      refetch();
    },
  });
  const actOnNudge = useMutation({
    mutationFn: (id: number) => fetchJson<Nudge>(`/api/nudges/${id}/acted-on`, { method: "POST", body: "{}" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: nudgesKey });
      refetch();
    },
  });

  // Hide nudges that have already been mirrored into the notifications list
  // so the user doesn't see the same headline twice when they open the
  // dropdown. We treat the rich nudges segment as the canonical surface.
  const all: Notif[] = Array.isArray(notifications) ? (notifications as Notif[]) : [];
  const nudgeNotificationKeys = new Set(
    nudges.map((n) => `${n.kind}|${n.sourceEntityType ?? ""}|${n.sourceEntityId ?? ""}`),
  );
  const nonNudgeNotifications = all.filter((n) => {
    if (!n.type.startsWith("nudge_")) return true;
    const kind = n.type.replace(/^nudge_/, "");
    return !nudgeNotificationKeys.has(`${kind}|${n.relatedEntityType ?? ""}|${n.relatedEntityId ?? ""}`);
  });
  const unreadCount = nonNudgeNotifications.filter((n) => !n.isRead).length + nudges.length;

  useEffect(() => {
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);

  function handleNotifClick(n: Notif) {
    if (!n.isRead) markRead.mutate({ id: n.id }, { onSuccess: () => refetch() });
    if (n.link) {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const target = n.link.startsWith(base) ? n.link.slice(base.length) : n.link;
      navigate(target || "/");
    }
    setOpen(false);
  }

  function handleNudgeAct(n: Nudge) {
    actOnNudge.mutate(n.id);
    if (n.link) navigate(n.link);
    setOpen(false);
  }

  function handleMarkAll() {
    markAll.mutate({ data: { userId } }, {
      onSuccess: () => {
        refetch();
        qc.invalidateQueries({ queryKey: ["/api/notifications"] });
      },
    });
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="relative w-9 h-9 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        title="Notifications"
        aria-label="Notifications"
      >
        <Bell size={16} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center text-[10px] font-bold font-mono bg-destructive text-destructive-foreground border border-background">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-[26rem] max-h-[560px] rounded-xl overflow-hidden z-50 flex flex-col bg-popover text-popover-foreground border border-popover-border shadow-xl">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <div>
              <h4 className="text-sm font-semibold text-popover-foreground">
                {nudges.length > 0 ? "Nudges & Notifications" : "Notifications"}
              </h4>
              <p className="text-[11px] text-muted-foreground font-mono">
                {nudges.length > 0 && <span>{nudges.length} nudge{nudges.length === 1 ? "" : "s"} · </span>}
                {nonNudgeNotifications.filter((n) => !n.isRead).length} unread · {nonNudgeNotifications.length} total
              </p>
            </div>
            {nonNudgeNotifications.filter((n) => !n.isRead).length > 0 && (
              <button onClick={handleMarkAll} className="flex items-center gap-1 text-xs font-semibold text-primary hover:opacity-80">
                <CheckCheck size={12} /> Mark all read
              </button>
            )}
          </div>

          <div className="overflow-y-auto flex-1 scrollbar-thin">
            {/* ── Nudges segment (Stage 4) ─────────────────────────────── */}
            {nudges.length > 0 && (
              <div className="px-3 py-3 border-b border-border bg-gradient-to-b from-primary/[0.04] to-transparent">
                <div className="flex items-center gap-1.5 mb-2 px-1">
                  <Sparkles size={12} className="text-primary" />
                  <p className="text-[10px] font-mono uppercase tracking-wider text-primary font-semibold">
                    Nyra suggests
                  </p>
                </div>
                <div className="space-y-2">
                  {nudges.slice(0, 5).map((n) => (
                    <NudgeRow
                      key={n.id}
                      nudge={n}
                      onAct={() => handleNudgeAct(n)}
                      onDismiss={() => dismissNudge.mutate(n.id)}
                    />
                  ))}
                  {nudges.length > 5 && (
                    <button
                      type="button"
                      onClick={() => {
                        navigate("/nudges");
                        setOpen(false);
                      }}
                      className="w-full text-left text-xs text-primary hover:underline px-1 pt-1"
                    >
                      View all {nudges.length} nudges →
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* ── Notifications list (unchanged) ───────────────────────── */}
            {nonNudgeNotifications.length === 0 && nudges.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">No notifications yet.</div>
            ) : (
              nonNudgeNotifications.slice(0, 50).map(n => (
                <button
                  key={n.id}
                  onClick={() => handleNotifClick(n)}
                  className={`w-full text-left px-4 py-3 border-b border-border/60 hover:bg-accent transition-colors block ${
                    n.isRead ? "bg-transparent" : "bg-primary/5"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {!n.isRead && <span className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 flex-shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm ${n.isRead ? "text-muted-foreground" : "font-semibold text-popover-foreground"}`}>{n.title}</p>
                      {n.body && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>}
                      <p className="text-[10px] text-muted-foreground/70 mt-1 font-mono">{timeAgo(n.createdAt)} · {n.type.replace(/_/g, " ")}</p>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Nudge row — pinned segment item ────────────────────────────────────────

function NudgeRow({ nudge, onAct, onDismiss }: { nudge: Nudge; onAct: () => void; onDismiss: () => void }) {
  const urgencyTone =
    nudge.urgency === "critical" ? "border-destructive/40 bg-destructive/5" :
    nudge.urgency === "high" ? "border-warn/40 bg-warn/5" :
    "border-primary/30 bg-card";
  return (
    <div className={`rounded-lg border ${urgencyTone} p-2.5`}>
      <p className="text-[13px] font-semibold text-foreground leading-snug">{nudge.headline}</p>
      {nudge.body && <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{nudge.body}</p>}
      <div className="flex items-center justify-between gap-2 mt-2">
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{nudge.kind.replace(/_/g, " ")}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDismiss(); }}
            className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-accent"
            title="Dismiss"
          >
            <X size={11} />
            Dismiss
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onAct(); }}
            className="text-[11px] font-semibold text-primary-foreground bg-primary hover:bg-primary/90 inline-flex items-center gap-1 px-2 py-1 rounded transition-colors"
          >
            Go
            <ArrowUpRight size={11} />
          </button>
        </div>
      </div>
    </div>
  );
}
