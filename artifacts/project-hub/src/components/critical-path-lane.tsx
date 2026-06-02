import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { CheckCircle2, Circle, AlertOctagon, Clock, Bell, FileWarning, ListChecks, ShieldAlert, ArrowUpRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { getChecklistLabel } from "@/lib/lifecycle-config";
import { HealthChip, OwnerStrip } from "@/components/ui-kit";

// Matches GET /api/projects/:id/critical-path-stages
type Person = { id: number | null; name: string } | null;
type BlockingReason = { type: "checklist" | "doc" | "approval" | "uat_defect" | "urs_approval"; label: string; detail?: string; items?: string[] };
type CPSubGate = {
  key: string; label: string;
  status: "complete" | "blocked" | "active" | "upcoming";
  satisfied: boolean; slaDays: number | null; daysOverdue: number;
  approvedAt: string | null; approverLabel: string | null;
  blockingReasons: BlockingReason[];
};
type WaitingOn = { role: string; person: { id: number | null; name: string } | null } | null;
type NextEscalation = { role: string; action: string; inDays: number } | null;
type CPStage = {
  key: string; label: string; shortLabel: string; phaseKey: string; color: string;
  status: "complete" | "active" | "blocked" | "upcoming" | "skipped";
  enteredAt: string | null; completedAt: string | null;
  slaDays: number | null; dueDate: string | null; daysOverdue: number; daysPending: number;
  owner: Person; responsible: Person; pendingApprover: (Person & { role?: string }) | null;
  waitingOn: WaitingOn; nextEscalation: NextEscalation;
  blockingReasons: BlockingReason[];
  subGates?: CPSubGate[];
};
type CriticalPath = {
  projectId: number; projectName: string; projectType: string;
  currentStageKey: string; blockedStageKey: string | null;
  health: "on_track" | "at_risk" | "blocked"; currentStageRecognized: boolean; stages: CPStage[];
};

function roleLabel(role: string): string {
  return role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function useCriticalPath(projectId: number) {
  return useQuery({
    queryKey: [`/api/projects/${projectId}/critical-path-stages`],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/critical-path-stages`);
      if (!r.ok) throw new Error("Failed to load critical path");
      return r.json() as Promise<CriticalPath>;
    },
  });
}

function reasonText(r: BlockingReason): string {
  if (r.type === "checklist" && r.items?.length) {
    const labels = r.items.slice(0, 3).map(getChecklistLabel);
    const more = r.items.length > 3 ? ` +${r.items.length - 3} more` : "";
    return `${labels.join(", ")}${more}`;
  }
  return r.detail ? `${r.label} — ${r.detail}` : r.label;
}

function ReasonIcon({ type, size = 12 }: { type: BlockingReason["type"]; size?: number }) {
  if (type === "doc") return <FileWarning size={size} />;
  if (type === "approval" || type === "urs_approval") return <ShieldAlert size={size} />;
  if (type === "checklist") return <ListChecks size={size} />;
  return <AlertOctagon size={size} />;
}

const SUBGATE_SHORT: Record<string, string> = { brd: "BRD" };

// Collapse the two internal Initiation sub-gates (Business Case + Requirements
// — formerly URS) into ONE umbrella sub-gate labelled "BRD - Business
// Requirement Document". The user-facing critical-path queue shows the
// initiative as a single line item; the underlying server endpoints + DB
// keys (business_case / urs) stay split and continue to drive the dual
// approval workflow internally.
//
// Status math:
//   complete   — both halves satisfied
//   blocked    — either half blocked
//   active     — otherwise (in-progress)
//   approvedAt — most recent of the two if both satisfied
//   daysOverdue — worst of the two
//   blockingReasons — concatenated
//   approverLabel — the first unsatisfied half's approver (so Remind /
//                   Escalate copy stays accurate to whoever's actually holding
//                   things up)
function mergeInitiationSubGates(stage: CPStage | undefined): CPSubGate[] | undefined {
  if (!stage?.subGates || stage.subGates.length === 0) return stage?.subGates;
  if (stage.key !== "initiation") return stage.subGates;
  const all = stage.subGates;
  const allSatisfied = all.every((g) => g.satisfied);
  const anyBlocked = all.some((g) => g.status === "blocked");
  const firstUnsatisfied = all.find((g) => !g.satisfied);
  const approvedDates = all.map((g) => g.approvedAt).filter((x): x is string => !!x).sort();
  const merged: CPSubGate = {
    key: "brd",
    label: "BRD - Business Requirement Document",
    status: allSatisfied ? "complete" : anyBlocked ? "blocked" : "active",
    satisfied: allSatisfied,
    slaDays: all.reduce<number | null>((acc, g) => (g.slaDays != null ? Math.max(acc ?? 0, g.slaDays) : acc), null),
    daysOverdue: Math.max(...all.map((g) => g.daysOverdue)),
    approvedAt: allSatisfied && approvedDates.length ? approvedDates[approvedDates.length - 1] : null,
    approverLabel: firstUnsatisfied?.approverLabel ?? all[0].approverLabel,
    blockingReasons: all.flatMap((g) => g.blockingReasons),
  };
  return [merged];
}

function subTone(status: CPSubGate["status"]) {
  return status === "blocked" ? "bg-destructive/15 text-destructive border-destructive/40"
    : status === "complete" ? "bg-success/15 text-success border-success/30"
    : status === "active" ? "bg-primary/15 text-primary border-primary/30"
    : "bg-muted text-muted-foreground border-border";
}

// ─── A single stop on the horizontal journey rail ────────────────────────────

function JourneyStop({
  stage, isFirst, isLast, selected, onSelect,
}: {
  stage: CPStage;
  isFirst: boolean;
  isLast: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const { status } = stage;
  const node =
    status === "complete" ? { ring: "border-success bg-success text-success-foreground", icon: <CheckCircle2 size={16} /> }
    : status === "blocked" ? { ring: "border-destructive bg-destructive text-destructive-foreground pulse-ring", icon: <AlertOctagon size={16} /> }
    : status === "active" ? { ring: "border-primary bg-primary text-primary-foreground", icon: <Circle size={15} className="fill-current/30" /> }
    : { ring: "border-border bg-card text-muted-foreground", icon: <Circle size={14} className="opacity-50" /> };
  // Connector color reflects whether the prior leg is done.
  const lineDone = status === "complete";
  return (
    <div className="flex flex-col items-center flex-shrink-0 w-[112px]">
      {/* Node + connecting lines */}
      <div className="relative flex items-center justify-center w-full h-10">
        {!isFirst && <span className={`absolute left-0 right-1/2 top-1/2 h-0.5 -translate-y-1/2 ${lineDone ? "bg-success" : "bg-border"}`} />}
        {!isLast && <span className={`absolute left-1/2 right-0 top-1/2 h-0.5 -translate-y-1/2 ${status === "complete" ? "bg-success" : "bg-border"}`} />}
        <button
          onClick={onSelect}
          className={`relative z-10 w-9 h-9 rounded-full border-2 flex items-center justify-center transition-transform duration-200 hover:scale-110 ${node.ring} ${selected ? "ring-2 ring-offset-2 ring-offset-card ring-foreground/30" : ""}`}
          title={stage.label}
        >
          {node.icon}
        </button>
      </div>
      {/* Label */}
      <button onClick={onSelect} className="mt-1.5 text-center w-full px-1">
        <p className={`text-[11px] font-semibold leading-tight truncate ${selected ? "text-foreground" : "text-muted-foreground"}`}>{stage.label}</p>
        {stage.daysOverdue > 0 && (status === "blocked" || status === "active") && (
          <p className="text-[10px] font-bold text-destructive mt-0.5">{stage.daysOverdue}d overdue</p>
        )}
      </button>
      {/* Sub-gate pill (Initiation → single BRD pill, internally backed by
          two server-side sub-gates that still drive dual approval). */}
      {(() => {
        const displayed = mergeInitiationSubGates(stage);
        if (!displayed) return null;
        return (
          <div className="flex gap-1 mt-1 flex-wrap justify-center">
            {displayed.map((sg) => (
              <span
                key={sg.key}
                className={`inline-flex items-center gap-0.5 text-[9px] font-bold font-mono uppercase rounded px-1 py-0.5 border ${subTone(sg.status)}`}
                title={`${sg.label}: ${sg.status}${sg.daysOverdue > 0 ? ` · ${sg.daysOverdue}d overdue` : ""}`}
              >
                {sg.status === "complete" ? <CheckCircle2 size={8} /> : sg.status === "blocked" ? <AlertOctagon size={8} /> : <Circle size={8} className={sg.status === "upcoming" ? "opacity-50" : ""} />}
                {SUBGATE_SHORT[sg.key] ?? sg.label.slice(0, 3).toUpperCase()}
              </span>
            ))}
          </div>
        );
      })()}
    </div>
  );
}

export function CriticalPathLane({ projectId }: { projectId: number }) {
  const { data, isLoading, isError } = useCriticalPath(projectId);
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const action = useMutation({
    mutationFn: async ({ stageKey, act, subGateKey }: { stageKey: string; act: "escalate" | "remind"; subGateKey?: string }) => {
      const r = await fetch(`/api/projects/${projectId}/critical-path/escalate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stageKey, action: act, subGateKey }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body?.error ?? "Action failed");
      return body as { notified: number; emailed: number };
    },
    onSuccess: (res, vars) => {
      toast({
        title: vars.act === "escalate" ? "Escalated" : "Reminder sent",
        description: `Notified ${res.notified} recipient(s)${res.emailed ? `, emailed ${res.emailed}` : ""}.`,
      });
      qc.invalidateQueries({ queryKey: [`/api/projects/${projectId}/critical-path-stages`] });
    },
    onError: (err: unknown) => {
      toast({ title: "Couldn't complete action", description: err instanceof Error ? err.message : "Try again", variant: "destructive" });
    },
  });

  if (isLoading) return <Skeleton className="h-40 w-full rounded-2xl" />;
  if (isError || !data) return null;

  if (!data.currentStageRecognized) {
    return (
      <div className="rounded-2xl bg-card text-card-foreground border border-card-border glass-surface p-5">
        <div className="flex items-center gap-2 mb-1">
          <Clock size={15} className="text-muted-foreground" />
          <h3 className="text-[14px] font-semibold tracking-tight">Critical Path</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          This project's stage (<span className="font-mono text-foreground">{data.currentStageKey}</span>) predates the current 9-stage lifecycle model,
          so the stage-by-stage critical path can't be shown yet.
        </p>
      </div>
    );
  }

  const lane = data.stages.filter((s) => s.status !== "skipped");
  const pinch = lane.find((s) => s.status === "blocked")
    ?? lane.find((s) => s.status === "active" && (s.daysOverdue > 0 || s.blockingReasons.length > 0))
    ?? lane.find((s) => s.status === "active");
  const selected = lane.find((s) => s.key === selectedKey) ?? pinch ?? null;
  const blockingSub = selected?.subGates?.find((g) => !g.satisfied) ?? null;

  return (
    <div className="rounded-2xl bg-card text-card-foreground border border-card-border glass-surface lift-card p-5 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-[15px] font-semibold text-card-foreground tracking-tight">Critical Path</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            The blocking stage, who owns it, and what happens next
            {data.projectType === "internal" && <span className="ml-1.5 px-1.5 py-0.5 rounded-sm bg-secondary text-secondary-foreground text-[10px] font-mono uppercase">Internal path</span>}
          </p>
        </div>
        <HealthChip health={data.health} size="md" />
      </div>

      {/* Horizontal journey rail */}
      <div className="overflow-x-auto pb-2 scrollbar-thin">
        <div className="flex items-start min-w-max px-1">
          {lane.map((s, i) => (
            <JourneyStop
              key={s.key}
              stage={s}
              isFirst={i === 0}
              isLast={i === lane.length - 1}
              selected={selected?.key === s.key}
              onSelect={() => setSelectedKey(s.key)}
            />
          ))}
        </div>
      </div>

      {/* Selected-stop detail card */}
      {selected ? (
        <div className={`rounded-xl border p-4 ${selected.status === "blocked" ? "bg-destructive/5 border-destructive/30" : selected.status === "active" && (selected.daysOverdue > 0 || selected.blockingReasons.length) ? "bg-warn/5 border-warn/30" : "bg-muted/30 border-border"}`}>
          <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
            <div className="flex items-center gap-2 min-w-0">
              {selected.status === "blocked" && <span className="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-destructive text-destructive-foreground">Blocked</span>}
              {selected.status === "active" && <span className="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-primary text-primary-foreground">Active</span>}
              {selected.status === "complete" && <span className="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-success text-success-foreground">Complete</span>}
              <span className="font-semibold text-foreground text-sm truncate">{selected.label}</span>
              {selected.daysOverdue > 0 && <span className="text-xs font-bold text-destructive">· {selected.daysOverdue}d overdue</span>}
            </div>
            {/* Escalation actions — only when actionable */}
            {(selected.status === "blocked" || (selected.status === "active" && (selected.daysOverdue > 0 || selected.blockingReasons.length > 0))) && (
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => action.mutate({ stageKey: selected.key, act: "remind", subGateKey: blockingSub?.key })}
                  disabled={action.isPending}
                  className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md border border-border bg-card text-card-foreground hover:bg-accent transition-colors disabled:opacity-60"
                >
                  <Bell size={13} /> Remind
                </button>
                <button
                  onClick={() => action.mutate({ stageKey: selected.key, act: "escalate", subGateKey: blockingSub?.key })}
                  disabled={action.isPending}
                  className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors disabled:opacity-60"
                >
                  <AlertOctagon size={13} /> Escalate
                </button>
              </div>
            )}
          </div>

          {/* Ownership — Owner / Approver / Waiting On, never hidden */}
          <div className="rounded-lg bg-card/60 border border-border/60 p-3 mb-3">
            <OwnerStrip
              owner={selected.owner}
              approver={selected.pendingApprover}
              waitingOn={selected.waitingOn}
            />
          </div>

          {/* Sub-gate breakdown — Initiation collapses BC + URS into a single
              BRD card. The underlying server-side sub-gates still drive dual
              approval; the blocking-reasons list is merged so the user sees
              everything pending in one place. */}
          {(() => {
            const displayedSubGates = mergeInitiationSubGates(selected);
            if (!displayedSubGates) return null;
            return (
            <div className="space-y-2 mb-1">
              {displayedSubGates.map((sg) => (
                <div key={sg.key} className={`rounded-lg border p-2.5 ${sg.status === "blocked" ? "border-destructive/30 bg-destructive/5" : sg.satisfied ? "border-success/30 bg-success/5" : "border-border bg-muted/30"}`}>
                  <div className="flex items-center gap-2 text-xs flex-wrap">
                    {sg.satisfied ? <CheckCircle2 size={13} className="text-success" /> : sg.status === "blocked" ? <AlertOctagon size={13} className="text-destructive" /> : <Circle size={13} className="text-muted-foreground" />}
                    <span className="font-semibold text-foreground">{sg.label}</span>
                    {sg.satisfied
                      ? <span className="text-success">approved{sg.approvedAt ? ` ${new Date(sg.approvedAt).toLocaleDateString()}` : ""}</span>
                      : sg.daysOverdue > 0 ? <span className="text-destructive font-bold">{sg.daysOverdue}d overdue</span>
                      : <span className="text-muted-foreground">in progress</span>}
                    {sg.approverLabel && !sg.satisfied && <span className="text-muted-foreground ml-auto">awaiting: {sg.approverLabel}</span>}
                  </div>
                  {!sg.satisfied && sg.blockingReasons.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2 pl-5">
                      {sg.blockingReasons.map((r, idx) => (
                        <span key={idx} className="inline-flex items-center gap-1 text-[10px] rounded-full border border-destructive/30 bg-destructive/10 text-destructive px-2 py-0.5">
                          <ReasonIcon type={r.type} size={10} /> {reasonText(r)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
            );
          })()}
          {!mergeInitiationSubGates(selected) && (
            selected.blockingReasons.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {selected.blockingReasons.map((r, idx) => (
                  <span key={idx} className="inline-flex items-center gap-1 text-[11px] rounded-full border border-destructive/30 bg-destructive/10 text-destructive px-2 py-1">
                    <ReasonIcon type={r.type} size={11} /> {reasonText(r)}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-success flex items-center gap-1.5"><CheckCircle2 size={13} /> Within SLA — no open gate items.</p>
            )
          )}

          {/* Next escalation rung */}
          {selected.nextEscalation && (
            <p className="mt-3 text-[11px] text-muted-foreground inline-flex items-center gap-1">
              <ArrowUpRight size={12} className="text-warn" />
              Next escalation: <span className="font-medium text-foreground capitalize">{selected.nextEscalation.action}</span> →{" "}
              <span className="font-medium text-foreground">{roleLabel(selected.nextEscalation.role)}</span>
              {selected.nextEscalation.inDays > 0 ? ` in ${selected.nextEscalation.inDays} day${selected.nextEscalation.inDays === 1 ? "" : "s"}` : " now"}
            </p>
          )}
        </div>
      ) : (
        <p className="text-xs text-success flex items-center gap-1.5"><CheckCircle2 size={13} /> On track — current stage is within SLA with no open gate items.</p>
      )}
    </div>
  );
}
