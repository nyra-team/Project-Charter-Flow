import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles, X, ArrowUpRight, Inbox, ListChecks } from "lucide-react";
import { useUserStore } from "../lib/store";
import { useToast } from "@/hooks/use-toast";

type NudgeStatus = "active" | "dismissed" | "acted_on" | "expired";
type Nudge = {
  id: number; userId: number; kind: string;
  urgency: "low" | "normal" | "high" | "critical";
  headline: string; body: string | null; link: string | null;
  sourceEntityType: string | null; sourceEntityId: number | null;
  status: NudgeStatus;
  createdAt: string;
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  if (!res.ok) throw new Error((await res.text()) || `${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

const STATUS_TABS: { key: NudgeStatus; label: string; icon: typeof Inbox }[] = [
  { key: "active", label: "Active", icon: Sparkles },
  { key: "acted_on", label: "Acted on", icon: ListChecks },
  { key: "dismissed", label: "Dismissed", icon: X },
  { key: "expired", label: "Expired", icon: Inbox },
];

const URGENCY_CHIPS = ["all", "critical", "high", "normal", "low"] as const;
type UrgencyChip = (typeof URGENCY_CHIPS)[number];

export default function NudgesPage() {
  const { userId } = useUserStore();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [status, setStatus] = useState<NudgeStatus>("active");
  const [urgency, setUrgency] = useState<UrgencyChip>("all");
  const [kindFilter, setKindFilter] = useState<string>("all");

  const queryKey = useMemo(() => ["nudges", userId, status] as const, [userId, status]);
  const { data: nudges = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => fetchJson<Nudge[]>(`/api/nudges?userId=${userId}&status=${status}`),
  });

  const dismiss = useMutation({
    mutationFn: (id: number) => fetchJson<Nudge>(`/api/nudges/${id}/dismiss`, { method: "POST", body: "{}" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nudges", userId] }),
  });
  const actOn = useMutation({
    mutationFn: (id: number) => fetchJson<Nudge>(`/api/nudges/${id}/acted-on`, { method: "POST", body: "{}" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nudges", userId] }),
  });
  const bulkDismiss = useMutation({
    mutationFn: (ids: number[]) => fetchJson<{ success: boolean; dismissed: number }>("/api/nudges/bulk-dismiss", {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),
    onSuccess: (r) => {
      toast({ title: "Dismissed", description: `${r.dismissed} nudges marked dismissed.` });
      qc.invalidateQueries({ queryKey: ["nudges", userId] });
    },
  });

  const allKinds = useMemo(() => Array.from(new Set(nudges.map((n) => n.kind))).sort(), [nudges]);
  const filtered = useMemo(
    () =>
      nudges.filter((n) => {
        if (urgency !== "all" && n.urgency !== urgency) return false;
        if (kindFilter !== "all" && n.kind !== kindFilter) return false;
        return true;
      }),
    [nudges, urgency, kindFilter],
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="relative rounded-2xl overflow-hidden ph-rise glass-surface">
        <div className="absolute inset-0 ambient-mesh opacity-70 pointer-events-none" />
        <div className="relative flex items-start justify-between flex-wrap gap-4 p-6 lg:p-8">
          <div className="min-w-0">
            <p className="text-[10px] font-mono tracking-[0.22em] uppercase text-muted-foreground mb-2 inline-flex items-center gap-1.5">
              <Sparkles size={11} /> Nyra
            </p>
            <h2 className="text-3xl lg:text-4xl font-bold tracking-tight text-card-foreground">Your Nudges</h2>
            <p className="text-sm text-muted-foreground mt-2 max-w-xl">
              Proactive prompts composed from live PMO signals (overdue tasks, approvals past SLA, RAG-red projects, stuck
              charters, budget breaches). Refreshes every 15 minutes.
            </p>
          </div>
          {status === "active" && filtered.length > 0 && (
            <button
              onClick={() => bulkDismiss.mutate(filtered.map((n) => n.id))}
              disabled={bulkDismiss.isPending}
              className="inline-flex items-center gap-1.5 px-3 h-9 rounded-md text-sm border border-border bg-card hover:bg-accent transition-colors disabled:opacity-50"
            >
              <X size={14} />
              {bulkDismiss.isPending ? "Dismissing…" : `Dismiss ${filtered.length}`}
            </button>
          )}
        </div>
      </div>

      {/* Status tabs */}
      <div className="flex items-center gap-1 flex-wrap">
        {STATUS_TABS.map((t) => {
          const Icon = t.icon;
          const isActive = status === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setStatus(t.key)}
              className={`inline-flex items-center gap-1.5 px-3 h-8 rounded-full text-xs font-medium transition-colors ${
                isActive ? "bg-primary text-primary-foreground" : "bg-muted/60 text-muted-foreground hover:bg-muted"
              }`}
            >
              <Icon size={12} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Filter chips */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mr-1">Urgency:</span>
          {URGENCY_CHIPS.map((u) => (
            <button
              key={u}
              onClick={() => setUrgency(u)}
              className={`px-2.5 h-6 rounded-full text-xs transition-colors ${
                urgency === u ? "bg-foreground text-background" : "bg-muted/40 text-muted-foreground hover:bg-muted"
              }`}
            >
              {u}
            </button>
          ))}
        </div>
        {allKinds.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mr-1">Kind:</span>
            <button
              onClick={() => setKindFilter("all")}
              className={`px-2.5 h-6 rounded-full text-xs transition-colors ${
                kindFilter === "all" ? "bg-foreground text-background" : "bg-muted/40 text-muted-foreground hover:bg-muted"
              }`}
            >
              all
            </button>
            {allKinds.map((k) => (
              <button
                key={k}
                onClick={() => setKindFilter(k)}
                className={`px-2.5 h-6 rounded-full text-xs transition-colors ${
                  kindFilter === k ? "bg-foreground text-background" : "bg-muted/40 text-muted-foreground hover:bg-muted"
                }`}
              >
                {k.replace(/_/g, " ")}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* List */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass-surface rounded-2xl p-12 text-center">
          <Inbox size={28} className="mx-auto text-muted-foreground mb-3" />
          <p className="text-base font-semibold text-card-foreground">
            {status === "active" ? "All clear — nothing to nudge about right now." : `No ${status.replace("_", " ")} nudges.`}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            Nyra runs every 15 minutes; new signals will appear here automatically.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map((n) => (
            <NudgeCard
              key={n.id}
              nudge={n}
              onAct={() => {
                actOn.mutate(n.id);
                if (n.link) navigate(n.link);
              }}
              onDismiss={() => dismiss.mutate(n.id)}
              showActions={n.status === "active"}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function NudgeCard({
  nudge, onAct, onDismiss, showActions,
}: {
  nudge: Nudge;
  onAct: () => void;
  onDismiss: () => void;
  showActions: boolean;
}) {
  const urgencyTone =
    nudge.urgency === "critical" ? "border-destructive/40 bg-destructive/[0.04]" :
    nudge.urgency === "high" ? "border-warn/40 bg-warn/[0.04]" :
    "border-border bg-card";
  const urgencyBadge =
    nudge.urgency === "critical" ? "bg-destructive/10 text-destructive" :
    nudge.urgency === "high" ? "bg-warn/10 text-warn" :
    nudge.urgency === "low" ? "bg-muted/40 text-muted-foreground" :
    "bg-primary/10 text-primary";
  return (
    <div className={`rounded-xl border ${urgencyTone} p-4 flex flex-col`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider ${urgencyBadge}`}>
          {nudge.urgency}
        </span>
        <span className="text-[10px] font-mono text-muted-foreground">
          {nudge.kind.replace(/_/g, " ")}
        </span>
      </div>
      <p className="text-sm font-semibold text-foreground leading-snug">{nudge.headline}</p>
      {nudge.body && <p className="text-xs text-muted-foreground mt-1 leading-snug">{nudge.body}</p>}
      <div className="mt-auto pt-3 flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground font-mono">
          {new Date(nudge.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
        </span>
        {showActions && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onDismiss}
              className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-accent"
            >
              <X size={11} />
              Dismiss
            </button>
            <button
              type="button"
              onClick={onAct}
              className="text-[11px] font-semibold text-primary-foreground bg-primary hover:bg-primary/90 inline-flex items-center gap-1 px-2 py-1 rounded"
            >
              Go
              <ArrowUpRight size={11} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
