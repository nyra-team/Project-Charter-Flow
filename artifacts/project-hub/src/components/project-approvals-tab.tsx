// Per-project approval workflow — visual Pending → Approved → Escalated rail.
// Derived from the project's lifecycle critical path (GET /critical-path-stages),
// so it shows every governance gate, who owns the decision, the SLA, days pending,
// and escalation status — no separate endpoint needed.

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock, AlertOctagon, Bell, ShieldAlert, Hourglass } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { PersonAvatar } from "@/components/person-avatar";
import { SectionHeader } from "@/components/ui-kit";
import { prettify } from "@/lib/status-tokens";

type Person = { id: number | null; name: string } | null;
type CPStage = {
  key: string; label: string; phaseKey: string;
  status: "complete" | "active" | "blocked" | "upcoming" | "skipped";
  slaDays: number | null; daysOverdue: number; daysPending: number;
  owner: Person; pendingApprover: (Person & { role?: string }) | null;
  waitingOn: { role: string; person: Person } | null;
  nextEscalation: { role: string; action: string; inDays: number } | null;
  completedAt: string | null;
};
type CriticalPath = { currentStageRecognized: boolean; stages: CPStage[] };

type Lane = "pending" | "approved" | "escalated";

function laneOf(s: CPStage): Lane | null {
  if (s.status === "complete") return "approved";
  if (s.status === "blocked" || s.daysOverdue > 0) return "escalated";
  if (s.status === "active") return "pending";
  return null; // upcoming / skipped → not part of the live workflow
}

const LANE_META: Record<Lane, { label: string; icon: typeof Clock; cls: string; head: string }> = {
  pending: { label: "Pending", icon: Clock, cls: "border-warn/30", head: "text-warn" },
  approved: { label: "Approved", icon: CheckCircle2, cls: "border-success/30", head: "text-success" },
  escalated: { label: "Escalated", icon: AlertOctagon, cls: "border-destructive/30", head: "text-destructive" },
};

export function ProjectApprovalsTab({ projectId }: { projectId: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: [`/api/projects/${projectId}/critical-path-stages`],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/critical-path-stages`);
      if (!r.ok) throw new Error("Failed");
      return r.json() as Promise<CriticalPath>;
    },
  });

  const action = useMutation({
    mutationFn: async ({ stageKey, act }: { stageKey: string; act: "escalate" | "remind" }) => {
      const r = await fetch(`/api/projects/${projectId}/critical-path/escalate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stageKey, action: act }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body?.error ?? "Action failed");
      return body as { notified: number; emailed: number };
    },
    onSuccess: (res, vars) => {
      toast({ title: vars.act === "escalate" ? "Escalated" : "Reminder sent", description: `Notified ${res.notified}${res.emailed ? `, emailed ${res.emailed}` : ""}.` });
      qc.invalidateQueries({ queryKey: [`/api/projects/${projectId}/critical-path-stages`] });
    },
    onError: (err: unknown) => toast({ title: "Couldn't complete action", description: err instanceof Error ? err.message : "Try again", variant: "destructive" }),
  });

  if (isLoading) return <Skeleton className="h-64 w-full rounded-2xl" />;
  if (!data || !data.currentStageRecognized) {
    return (
      <div className="rounded-2xl bg-card border border-card-border glass-surface p-6 text-center">
        <p className="text-sm text-muted-foreground">Approval workflow appears once this project is on the current 9-stage lifecycle.</p>
      </div>
    );
  }

  const lanes: Record<Lane, CPStage[]> = { pending: [], approved: [], escalated: [] };
  for (const s of data.stages) {
    const l = laneOf(s);
    if (l) lanes[l].push(s);
  }

  return (
    <div className="rounded-2xl bg-card border border-card-border glass-surface p-5">
      <SectionHeader title="Approval Workflow" subtitle="Every lifecycle gate — who decides, the SLA, and escalation status" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {(["pending", "approved", "escalated"] as Lane[]).map((lane) => {
          const meta = LANE_META[lane];
          const Icon = meta.icon;
          return (
            <div key={lane} className={`rounded-xl border ${meta.cls} bg-muted/20 overflow-hidden`}>
              <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-border/60">
                <Icon size={15} className={meta.head} />
                <h4 className={`text-sm font-semibold ${meta.head}`}>{meta.label}</h4>
                <span className="ml-auto text-xs font-semibold text-muted-foreground">{lanes[lane].length}</span>
              </div>
              <div className="p-2.5 space-y-2 min-h-[80px]">
                {lanes[lane].length === 0 ? (
                  <p className="text-[11px] text-muted-foreground/60 italic text-center py-4">None</p>
                ) : (
                  lanes[lane].map((s) => <ApprovalCard key={s.key} stage={s} lane={lane} onAct={(act) => action.mutate({ stageKey: s.key, act })} pending={action.isPending} />)
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ApprovalCard({ stage, lane, onAct, pending }: { stage: CPStage; lane: Lane; onAct: (act: "remind" | "escalate") => void; pending: boolean }) {
  // The decision-maker: pending approver if known, else the waiting-on person, else owner.
  const person = stage.pendingApprover ?? stage.waitingOn?.person ? (stage.pendingApprover ?? { ...stage.waitingOn!.person!, role: stage.waitingOn!.role }) : stage.owner;
  const role = stage.pendingApprover?.role ?? stage.waitingOn?.role ?? null;
  return (
    <div className="rounded-lg bg-card border border-border/60 p-3">
      <p className="text-[13px] font-semibold text-foreground truncate">{stage.label}</p>
      <div className="flex items-center gap-1.5 mt-1.5">
        {person && person.name ? (
          <>
            <PersonAvatar id={person.id} name={person.name} size={18} />
            <span className="text-xs text-foreground truncate">{person.name}</span>
          </>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><ShieldAlert size={12} /> {role ? prettify(role) : "Unassigned"}</span>
        )}
        {role && person?.name && <span className="text-[10px] text-muted-foreground truncate">· {prettify(role)}</span>}
      </div>
      <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground flex-wrap">
        {stage.slaDays != null && <span>SLA {stage.slaDays}d</span>}
        {lane !== "approved" && <span className="inline-flex items-center gap-0.5"><Hourglass size={10} /> {stage.daysPending}d pending</span>}
        {stage.daysOverdue > 0 && <span className="font-bold text-destructive">{stage.daysOverdue}d overdue</span>}
        {lane === "approved" && stage.completedAt && <span className="text-success">approved {new Date(stage.completedAt).toLocaleDateString()}</span>}
      </div>
      {stage.nextEscalation && lane !== "approved" && (
        <p className="text-[10px] text-muted-foreground mt-1.5">
          Next: <span className="capitalize text-foreground font-medium">{stage.nextEscalation.action}</span> → {prettify(stage.nextEscalation.role)}{stage.nextEscalation.inDays > 0 ? ` in ${stage.nextEscalation.inDays}d` : " now"}
        </p>
      )}
      {lane !== "approved" && (
        <div className="flex items-center gap-1.5 mt-2.5">
          <button onClick={() => onAct("remind")} disabled={pending} className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md border border-border bg-card hover:bg-accent disabled:opacity-50">
            <Bell size={11} /> Remind
          </button>
          <button onClick={() => onAct("escalate")} disabled={pending} className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50">
            <AlertOctagon size={11} /> Escalate
          </button>
        </div>
      )}
    </div>
  );
}
