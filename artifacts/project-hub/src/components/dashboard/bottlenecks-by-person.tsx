import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, AlertOctagon, Hourglass, Clock, Gauge } from "lucide-react";
import { DashboardCard } from "./primitives";
import { PersonAvatar } from "../person-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

// ---- response shapes (match routes/dashboard.ts) ---------------------------
type Person = { id: number | null; name: string } | null;
type PendingRow = { person: Person; role: string; count: number; projects: Array<{ id: number; name: string; stage: string; daysPending: number; daysOverdue: number }> };
type OverdueRow = { person: Person; role: string; count: number; totalOverdueDays: number; projects: Array<{ id: number; name: string; stage: string; daysOverdue: number }> };
type EscRow = { projectId: number; projectName: string; stage: string; stageLabel: string; tier: number; action: "remind" | "escalate"; targetRole: string; person: Person; daysPending: number; daysOverdue: number };
type SlaRow = { person: Person; role: string; totalWaiting: number; overdueWaiting: number; remindersReceived: number; escalationsReceived: number; onTimePct: number };

function roleLabel(role: string): string {
  return role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function useDash<T>(path: string) {
  return useQuery({
    queryKey: [path],
    queryFn: async () => { const r = await fetch(path); if (!r.ok) throw new Error("Failed"); return r.json() as Promise<T>; },
  });
}

function PersonLabel({ person, role }: { person: Person; role: string }) {
  if (person?.id != null) {
    return <span className="inline-flex items-center gap-1.5"><PersonAvatar id={person.id} name={person.name} size={20} /><span className="text-xs font-medium text-foreground truncate">{person.name}</span></span>;
  }
  return <span className="inline-flex items-center gap-1.5"><PersonAvatar id={null} name={person?.name ?? "?"} size={20} /><span className="text-xs text-muted-foreground italic truncate">{person?.name ?? `Unassigned · ${roleLabel(role)}`}</span></span>;
}

export function BottlenecksByPerson() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const pending = useDash<PendingRow[]>("/api/dashboard/pending-approvals-by-person");
  const overdue = useDash<OverdueRow[]>("/api/dashboard/overdue-actions-by-person");
  const escalations = useDash<EscRow[]>("/api/dashboard/escalations-required");
  const sla = useDash<SlaRow[]>("/api/dashboard/approval-sla-performance");

  const act = useMutation({
    mutationFn: async ({ projectId, stageKey, action }: { projectId: number; stageKey: string; action: "remind" | "escalate" }) => {
      const r = await fetch(`/api/projects/${projectId}/critical-path/escalate`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stageKey, action }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body?.error ?? "Action failed");
      return body as { notified: number; emailed: number };
    },
    onSuccess: (res, vars) => {
      toast({ title: vars.action === "escalate" ? "Escalated" : "Reminder sent", description: `Notified ${res.notified}${res.emailed ? `, emailed ${res.emailed}` : ""}.` });
      qc.invalidateQueries({ queryKey: ["/api/dashboard/escalations-required"] });
    },
    onError: (err: unknown) => toast({ title: "Couldn't complete action", description: err instanceof Error ? err.message : "Try again", variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-bold text-foreground">Bottlenecks by Person</h2>
        <span className="text-[11px] text-muted-foreground">Who is blocking delivery — not just which stage</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Pending Approvals by Person */}
        <DashboardCard title="Pending Approvals by Person" subtitle="Everyone a live stage is currently waiting on">
          {pending.isLoading ? <Skeleton className="h-40 rounded-xl" /> : !pending.data?.length ? (
            <p className="text-xs text-muted-foreground">No stages are currently waiting on anyone.</p>
          ) : (() => {
            const max = Math.max(1, ...pending.data!.map((r) => r.count));
            return (
              <div className="space-y-2.5">
                {pending.data!.map((row, i) => (
                  <div key={i} className="p-2 rounded-lg bg-muted/40">
                    <div className="flex items-center gap-2">
                      <PersonLabel person={row.person} role={row.role} />
                      <span className="ml-auto inline-flex items-center gap-1 text-xs font-bold text-foreground"><Hourglass size={12} className="text-warn" />{row.count}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-warn" style={{ width: `${Math.max(8, (row.count / max) * 100)}%` }} />
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1 truncate">{row.projects.map((p) => p.name).slice(0, 2).join(", ")}{row.projects.length > 2 ? ` +${row.projects.length - 2}` : ""}</p>
                  </div>
                ))}
              </div>
            );
          })()}
        </DashboardCard>

        {/* Overdue Actions by Person */}
        <DashboardCard title="Overdue Actions by Person" subtitle="Past-SLA stages, ranked by total overdue days">
          {overdue.isLoading ? <Skeleton className="h-40 rounded-xl" /> : !overdue.data?.length ? (
            <p className="text-xs text-success flex items-center gap-1.5"><Clock size={13} /> Nothing overdue. 🎉</p>
          ) : (() => {
            const max = Math.max(1, ...overdue.data!.map((r) => r.totalOverdueDays));
            return (
              <div className="space-y-2.5">
                {overdue.data!.map((row, i) => (
                  <div key={i} className="p-2 rounded-lg bg-destructive/5 border border-destructive/15">
                    <div className="flex items-center gap-2">
                      <PersonLabel person={row.person} role={row.role} />
                      <span className="ml-auto text-xs font-bold text-destructive">{row.totalOverdueDays}d</span>
                      <span className="text-[10px] text-muted-foreground">{row.count} stage{row.count === 1 ? "" : "s"}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-destructive" style={{ width: `${Math.max(8, (row.totalOverdueDays / max) * 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </DashboardCard>

        {/* Escalations Required */}
        <DashboardCard title="Escalations Required" subtitle="Ladder tiers due now but not yet actioned today">
          {escalations.isLoading ? <Skeleton className="h-40 rounded-xl" /> : !escalations.data?.length ? (
            <p className="text-xs text-success flex items-center gap-1.5"><Bell size={13} /> No escalations pending.</p>
          ) : (
            <div className="space-y-2">
              {escalations.data.map((row, i) => (
                <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-warn/5 border border-warn/20 flex-wrap">
                  <span className={`text-[10px] font-bold font-mono uppercase px-1.5 py-0.5 rounded-sm ${row.action === "escalate" ? "bg-destructive/15 text-destructive" : "bg-warn/15 text-warn"}`}>{row.action}</span>
                  <PersonLabel person={row.person} role={row.targetRole} />
                  <span className="text-[11px] text-muted-foreground truncate max-w-[140px]">{row.projectName} · {row.stageLabel}</span>
                  {row.daysOverdue > 0 && <span className="text-[11px] font-bold text-destructive">{row.daysOverdue}d</span>}
                  <button
                    onClick={() => act.mutate({ projectId: row.projectId, stageKey: row.stage, action: row.action })}
                    disabled={act.isPending}
                    className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {row.action === "escalate" ? <AlertOctagon size={12} /> : <Bell size={12} />} {row.action === "escalate" ? "Escalate" : "Remind"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </DashboardCard>

        {/* Approval SLA Performance */}
        <DashboardCard title="Approval SLA Performance" subtitle="On-time rate of people currently owing approvals">
          {sla.isLoading ? <Skeleton className="h-40 rounded-xl" /> : !sla.data?.length ? (
            <p className="text-xs text-muted-foreground">No approvers currently in flight.</p>
          ) : (
            <div className="space-y-2">
              {sla.data.map((row, i) => {
                const tone = row.onTimePct >= 80 ? "text-success" : row.onTimePct >= 50 ? "text-warn" : "text-destructive";
                return (
                  <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-muted/40">
                    <PersonLabel person={row.person} role={row.role} />
                    <div className="ml-auto flex items-center gap-3">
                      <span className="inline-flex items-center gap-1 text-xs font-bold"><Gauge size={12} className={tone} /><span className={tone}>{row.onTimePct}%</span></span>
                      <span className="text-[10px] text-muted-foreground">{row.overdueWaiting}/{row.totalWaiting} late · {row.escalationsReceived} esc</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </DashboardCard>
      </div>
    </div>
  );
}
