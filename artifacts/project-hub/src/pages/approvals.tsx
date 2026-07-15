import {
  useGetPendingApprovals, useDecideApproval, useListProjects,
  useUpdateProjectTeamMember,
} from "@workspace/api-client-react";
import { useUserStore } from "../lib/store";
import { LIFECYCLE_STAGES } from "../lib/lifecycle-config";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { Fragment, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckSquare, CheckCircle2, XCircle, ChevronRight, Users,
  Clock, FileText, MessageSquare, Stamp, AlertOctagon,
} from "lucide-react";
import { PageHeader } from "@/components/ui-kit";
import { api } from "@/lib/extra-api";
import { useReasonPrompt } from "@/components/CompletionApproval";

type CompletionApprovalItem = {
  id: number; name: string; projectId: number; projectName: string; parentTaskId: number | null;
  completionRequestedBy: number | null; completionApproverId: number | null;
  completionReason: string | null; completionRequestedByName: string | null;
};

type CompletionDecisionItem = {
  id: number; taskId: number; taskName: string | null; projectId: number; projectName: string;
  decision: "accepted" | "rejected"; reason: string | null; requesterName: string | null; decidedAt: string | null;
};

function fmtWhen(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// SLA badge — token-driven (success / warn / destructive), consistent with the
// rest of the redesigned surfaces.
function SlaBadge({ approval }: { approval: { slaHours?: number; dueAt?: string | null; breachedAt?: string | null; createdAt?: string } }) {
  const due = approval.dueAt ? new Date(approval.dueAt) : null;
  const now = new Date();
  const breached = approval.breachedAt || (due && due < now);
  const pill = "text-xs font-medium flex items-center gap-1 px-2 py-0.5 rounded-full border";
  if (!due) {
    return <span className="text-xs text-muted-foreground/80 flex items-center gap-1"><Clock size={11} />Awaiting your review</span>;
  }
  const hoursLeft = (due.getTime() - now.getTime()) / 3_600_000;
  if (breached) {
    return <span className={`${pill} font-bold bg-destructive/10 text-destructive border-destructive/20`}><AlertOctagon size={11} /> SLA breached · {Math.abs(Math.round(hoursLeft))}h overdue</span>;
  }
  if (hoursLeft < 4) {
    return <span className={`${pill} font-bold bg-warn/10 text-warn border-warn/20`}><Clock size={11} /> Due in {Math.round(hoursLeft)}h</span>;
  }
  return <span className={`${pill} bg-success/10 text-success border-success/20`}><Clock size={11} /> SLA {approval.slaHours ?? 48}h · due {due.toLocaleString()}</span>;
}

// Days an approval has been pending (since createdAt).
function daysPending(createdAt?: string): number {
  if (!createdAt) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000));
}
function isEscalated(a: { dueAt?: string | null; breachedAt?: string | null }): boolean {
  return !!a.breachedAt || (!!a.dueAt && new Date(a.dueAt) < new Date());
}

const STAGE_LABELS: Record<string, string> = {
  parallel_review: "HOD / ED / CFO Review",
  scm_review: "SCM Negotiation",
  chairman_review: "Chairman Approval",
  finance_review: "Finance Review",
  pmo_review: "PMO Team Selection",
};


function DecisionPanel({
  approvalId, onDone,
}: { approvalId: number; onDone: () => void }) {
  const [comments, setComments] = useState("");
  const [action, setAction] = useState<"approve" | "reject" | null>(null);
  const decideMutation = useDecideApproval();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const handleDecide = (decision: "approved" | "rejected") => {
    if (decision === "rejected" && !comments.trim()) return;
    decideMutation.mutate(
      { id: approvalId, data: { decision, comments } },
      {
        onSuccess: () => {
          toast({
            title: decision === "approved" ? "Approved successfully" : "Rejected",
            description: comments || undefined,
          });
          queryClient.invalidateQueries({ queryKey: ["/api/approvals/pending"] });
          queryClient.invalidateQueries({ queryKey: ["/api/dashboard/summary"] });
          queryClient.invalidateQueries({ queryKey: ["/api/dashboard/gamification"] });
          setComments(""); setAction(null); onDone();
        },
        onError: () => toast({ title: "Failed to record decision", variant: "destructive" }),
      }
    );
  };

  if (!action) {
    return (
      <div className="flex gap-2 mt-3">
        <button
          onClick={() => setAction("reject")}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors bg-destructive/10 text-destructive border border-destructive/30 hover:bg-destructive/15"
        >
          <XCircle size={13} />
          Reject
        </button>
        <button
          onClick={() => setAction("approve")}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors bg-success/10 text-success border border-success/30 hover:bg-success/15"
        >
          <CheckCircle2 size={13} />
          Approve
        </button>
      </div>
    );
  }

  const isApprove = action === "approve";
  const toneClasses = isApprove
    ? "bg-success/10 border-success/30 text-success"
    : "bg-destructive/10 border-destructive/30 text-destructive";

  return (
    <div className={`mt-3 p-3 rounded-xl border ${toneClasses}`}>
      <p className="text-xs font-semibold mb-2">
        {isApprove ? "Add a comment (optional):" : "Reason for rejection (required):"}
      </p>
      <textarea
        value={comments}
        onChange={e => setComments(e.target.value)}
        placeholder={isApprove ? "e.g. Looks good, approved." : "Explain why this is being rejected..."}
        rows={2}
        className={`w-full text-sm p-2 rounded-lg outline-none resize-none bg-background border text-foreground placeholder:text-muted-foreground/70 focus:ring-2 ${
          isApprove ? "border-success/40 focus:ring-success/30" : "border-destructive/40 focus:ring-destructive/30"
        }`}
      />
      <div className="flex gap-2 mt-2">
        <button
          onClick={() => setAction(null)}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-background border border-border text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={() => handleDecide(isApprove ? "approved" : "rejected")}
          disabled={decideMutation.isPending || (!isApprove && !comments.trim())}
          className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold text-white transition-all disabled:opacity-50 ${
            isApprove ? "bg-success hover:bg-success/90" : "bg-destructive hover:bg-destructive/90"
          }`}
        >
          {decideMutation.isPending ? "Saving..." : isApprove ? "Confirm Approval" : "Confirm Rejection"}
        </button>
      </div>
    </div>
  );
}

const APPROVER_ROLE_LABELS: Record<string, string> = {
  hod: "Head of Department (HOD)",
  executive_director: "Executive Director",
  cfo: "Chief Financial Officer (CFO)",
  scm: "Supply Chain (SCM)",
  chairman: "Chairman",
  finance: "Finance",
  pmo: "PMO",
};

type ApprovalLike = {
  id: number;
  charterId: number;
  approverRole?: string | null;
  stage?: string | null;
  slaHours?: number;
  dueAt?: string | null;
  breachedAt?: string | null;
  createdAt?: string;
};

function QuickDecideRow({ approval }: { approval: ApprovalLike & Record<string, unknown> }) {
  const decideMutation = useDecideApproval();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const roleLabel = approval.approverRole
    ? (APPROVER_ROLE_LABELS[approval.approverRole] ?? approval.approverRole.replace(/_/g, " "))
    : "Approver";

  const decide = (decision: "approved" | "rejected") => {
    const comments = decision === "rejected"
      ? `[Test] Rejected as ${roleLabel}`
      : `[Test] Approved as ${roleLabel}`;
    decideMutation.mutate(
      { id: approval.id, data: { decision, comments } },
      {
        onSuccess: () => {
          toast({
            title: decision === "approved" ? `Approved as ${roleLabel}` : `Rejected as ${roleLabel}`,
          });
          queryClient.invalidateQueries({ queryKey: ["/api/approvals/pending"] });
          queryClient.invalidateQueries({ queryKey: ["/api/dashboard/summary"] });
          queryClient.invalidateQueries({ queryKey: ["/api/dashboard/gamification"] });
        },
        onError: () => toast({ title: "Failed to record decision", variant: "destructive" }),
      },
    );
  };

  const charterTitle = (approval.charterTitle as string | undefined) || `Charter #${approval.charterId}`;

  return (
    <tr className="hover:bg-muted/30">
      <td className="px-3 py-2">
        <Link href={`/charters/${approval.charterId}`} className="block min-w-0 truncate text-sm font-medium text-foreground hover:text-primary hover:underline" title={charterTitle}>
          {charterTitle}
        </Link>
      </td>
      <td className="px-2 py-2 text-[12px] text-muted-foreground capitalize truncate">{roleLabel}</td>
      <td className="px-2 py-2 text-[12px] text-muted-foreground truncate">{STAGE_LABELS[approval.stage ?? ""] ?? (approval.stage ?? "Review")}</td>
      <td className="px-2 py-2"><SlaBadge approval={approval} /></td>
      <td className="px-3 py-2">
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => decide("rejected")}
            disabled={decideMutation.isPending}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors bg-destructive/10 text-destructive border border-destructive/30 hover:bg-destructive/15 disabled:opacity-50"
          >
            <XCircle size={13} /> Reject
          </button>
          <button
            onClick={() => decide("approved")}
            disabled={decideMutation.isPending}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold text-white bg-success hover:bg-success/90 transition-colors disabled:opacity-50"
          >
            <CheckCircle2 size={13} /> Approve as {roleLabel.split(" ")[0]}
          </button>
        </div>
      </td>
    </tr>
  );
}

// Per-stage testing panel: lists every active project's CURRENT stage and shows
// one "Approve & Advance as <role>" button per allowed approver. Hits the
// test-advance endpoint which bypasses all gates and pushes the project to the
// next stage — the only way (for now) to walk a project through every stage of
// the lifecycle in initiator/demo mode.
const STAGE_META: Record<string, { label: string; advanceRoles: string[]; advanceLabel?: string }> = (() => {
  const out: Record<string, { label: string; advanceRoles: string[]; advanceLabel?: string }> = {};
  for (const s of LIFECYCLE_STAGES) {
    out[s.key] = { label: s.label, advanceRoles: s.advanceRoles ?? [], advanceLabel: (s as { advanceLabel?: string }).advanceLabel };
  }
  return out;
})();

function StageAdvanceRow({
  projectId, projectTitle, stageKey,
}: { projectId: number; projectTitle: string; stageKey: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [pendingRole, setPendingRole] = useState<string | null>(null);
  const meta = STAGE_META[stageKey];
  if (!meta) return null;

  const advance = async (approverRole: string) => {
    setPendingRole(approverRole);
    try {
      const res = await fetch(`/api/projects/${projectId}/stages/${stageKey}/test-advance`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ simulatedApprover: approverRole }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast({ title: body.error ?? "Failed to advance stage", variant: "destructive" });
        return;
      }
      toast({ title: `Approved as ${approverRole.toUpperCase()} — moved to next stage` });
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/stages`] });
    } finally {
      setPendingRole(null);
    }
  };

  return (
    <tr className="hover:bg-muted/30">
      <td className="px-3 py-2">
        <Link href={`/projects/${projectId}`} className="block min-w-0 truncate text-sm font-medium text-foreground hover:text-primary hover:underline" title={projectTitle}>
          {projectTitle}
        </Link>
      </td>
      <td className="px-2 py-2 text-[12px] text-muted-foreground truncate">
        {meta.label}{meta.advanceLabel ? <span className="text-muted-foreground/70"> — {meta.advanceLabel}</span> : null}
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center justify-end gap-2 flex-wrap">
          {meta.advanceRoles.length === 0 ? (
            <span className="text-[11px] text-muted-foreground italic">No approver roles configured</span>
          ) : meta.advanceRoles.map(roleKey => {
            const roleLabel = APPROVER_ROLE_LABELS[roleKey] ?? roleKey.replace(/_/g, " ");
            const short = roleLabel.split(" ")[0];
            const isPending = pendingRole === roleKey;
            return (
              <button
                key={roleKey}
                onClick={() => advance(roleKey)}
                disabled={pendingRole !== null}
                title={`Approve and advance as ${roleLabel}`}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold text-white bg-success hover:bg-success/90 transition-colors disabled:opacity-50"
              >
                <CheckCircle2 size={13} />
                {isPending ? "Advancing..." : `Approve as ${short}`}
              </button>
            );
          })}
        </div>
      </td>
    </tr>
  );
}

function InitiatorStageAdvancePanel() {
  const { data: projects = [] } = useListProjects();
  const active = (projects as Array<{ id: number; title: string; stage?: string | null; status?: string | null }>)
    .filter(p => p.status !== "closed" && p.stage);
  return (
    <div>
      <h3 className="text-sm font-bold text-foreground mb-2 flex items-center gap-2">
        <FileText size={15} className="text-primary" /> Stage Approvals
        <span className="text-xs font-normal text-muted-foreground">({active.length})</span>
      </h3>
      {active.length === 0 ? (
        <p className="text-xs text-muted-foreground italic px-1 py-2">No active projects.</p>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-muted-foreground text-[11px] uppercase tracking-wide border-b border-border">
                <th className="text-left font-semibold px-3 py-2">Project</th>
                <th className="text-left font-semibold px-2 py-2 w-56">Current stage</th>
                <th className="text-right font-semibold px-3 py-2">Approve &amp; advance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {active.map(p => (
                <StageAdvanceRow key={p.id} projectId={p.id} projectTitle={p.title} stageKey={p.stage!} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function InitiatorApproverGroups({ approvals }: { approvals: ApprovalLike[] }) {
  // One flat table, ordered by the approver chain (HOD → … → PMO). Each row
  // carries its own approver column, so no per-role boxes are needed.
  const orderedRoles = ["hod", "executive_director", "cfo", "scm", "chairman", "finance", "pmo"];
  const rank = (r: string) => { const i = orderedRoles.indexOf(r); return i === -1 ? orderedRoles.length : i; };
  const sorted = [...approvals].sort((x, y) => rank(x.approverRole ?? "unassigned") - rank(y.approverRole ?? "unassigned"));

  return (
    <div className="rounded-xl border border-border overflow-hidden bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/50 text-muted-foreground text-[11px] uppercase tracking-wide border-b border-border">
            <th className="text-left font-semibold px-3 py-2">Item</th>
            <th className="text-left font-semibold px-2 py-2 w-36">Approver</th>
            <th className="text-left font-semibold px-2 py-2 w-40">Stage</th>
            <th className="text-left font-semibold px-2 py-2 w-48">SLA</th>
            <th className="text-right font-semibold px-3 py-2 w-64">Decision</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {sorted.map(a => (
            <QuickDecideRow key={a.id} approval={a as ApprovalLike & Record<string, unknown>} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Team Member Approvals ────────────────────────────────────────────────────
// Surfaces every project team member still pending sign-off (the inline Approval
// column in the project Team tab) and lets an approver Approve / Reject here.
// Pre-RBAC: any authenticated Project Hub user can decide (PATCH allows the
// "initiator" relationship); proper approver routing comes with full RBAC.
function TeamApprovals() {
  const { toast } = useToast();
  const { role, userId } = useUserStore();
  const { data: projects = [] } = useListProjects();
  const update = useUpdateProjectTeamMember();
  const { data: members = [], refetch } = useQuery({
    queryKey: ["/api/team-members", "all"],
    queryFn: async () => {
      const r = await fetch("/api/team-members", { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load team members");
      return r.json() as Promise<Array<Record<string, unknown>>>;
    },
  });

  const projectName = (id: unknown) => (projects as Array<{ id: number; name?: string }>).find(p => p.id === id)?.name ?? `Project #${id}`;

  // Internal-member assignment requests. The initiator/testing role sees every
  // pending request (same convention as the charter queue); a real member sees
  // only their own. External members have no app login, so they're not routed
  // here — that comes with full RBAC.
  const isInitiator = role === "initiator";
  const pending = (members ?? []).filter(m =>
    ((m.approval as string) ?? "pending") === "pending" &&
    m.memberType === "internal" &&
    (isInitiator || m.userId === userId),
  );
  if (pending.length === 0) return null;

  const decide = (m: Record<string, unknown>, approval: "approved" | "rejected") =>
    update.mutate({ id: m.id as number, data: { approval } as never }, {
      onSuccess: () => { void refetch(); toast({ title: approval === "approved" ? "Member approved" : "Member rejected" }); },
      onError: () => toast({ title: "Action failed", variant: "destructive" }),
    });

  return (
    <div>
      <h3 className="text-sm font-bold text-foreground mb-1 mt-2 flex items-center gap-2">
        <Users size={15} className="text-primary" /> Team Assignment Requests
        <span className="text-xs font-normal text-muted-foreground">({pending.length})</span>
      </h3>
      <p className="text-xs text-muted-foreground mb-3">{isInitiator
        ? "Internal members added to project teams, awaiting confirmation — accept or decline on their behalf (testing)."
        : "You've been added to the following project teams — accept to confirm your role, or decline."}</p>
      <div className="space-y-2">
        {pending.map(m => (
          <div key={m.id as number} className="glass-surface lift-card rounded-2xl p-3 flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">
                {projectName(m.projectId)}
                {m.role ? <span className="text-[11px] font-normal text-muted-foreground"> · as {m.role as string}</span> : null}
              </p>
              <p className="text-[11px] text-muted-foreground truncate">
                {m.responsibilities ? (m.responsibilities as string) : "Internal team member"}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={() => decide(m, "approved")} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-success/10 text-success border border-success/20 hover:bg-success/20 transition-colors">
                <CheckCircle2 size={13} /> Accept
              </button>
              <button onClick={() => decide(m, "rejected")} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-destructive/10 text-destructive border border-destructive/20 hover:bg-destructive/20 transition-colors">
                <XCircle size={13} /> Decline
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Task/subtask completion sign-offs, as one connected table (matching the other
// approval queues) instead of a card-with-banner per item.
function CompletionApprovalsTable({ completions, currentUserId, onDone }: {
  completions: CompletionApprovalItem[]; currentUserId: number | null; onDone: () => void;
}) {
  const { ask, node } = useReasonPrompt();
  const [busyId, setBusyId] = useState<number | null>(null);

  const decide = async (task: CompletionApprovalItem, decision: "accept" | "reject") => {
    let reason: string | undefined;
    if (decision === "reject") {
      const r = await ask({ title: "Reason for rejecting completion", label: "Why is this not complete?", confirmText: "Reject", tone: "danger" });
      if (r == null) return;
      reason = r;
    }
    setBusyId(task.id);
    try {
      await api.post(`/api/tasks/${task.id}/complete-decision`, { decision, reason });
      onDone();
    } finally { setBusyId(null); }
  };

  return (
    <div className="rounded-xl border border-border overflow-hidden bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/50 text-muted-foreground text-[11px] uppercase tracking-wide border-b border-border">
            <th className="text-left font-semibold px-3 py-2">Task</th>
            <th className="text-left font-semibold px-2 py-2 w-40">Project</th>
            <th className="text-left font-semibold px-2 py-2">Marked complete by</th>
            <th className="text-right font-semibold px-3 py-2 w-44">Decision</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {completions.map((t) => {
            const isApprover = currentUserId != null && currentUserId === t.completionApproverId;
            const who = t.completionRequestedByName ?? "Someone";
            const busy = busyId === t.id;
            return (
              <tr key={t.id} className="hover:bg-muted/30">
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[9px] font-bold uppercase tracking-wide px-1 py-0.5 rounded shrink-0 bg-slate-100 text-slate-600">{t.parentTaskId != null ? "subtask" : "task"}</span>
                    <span className="min-w-0 truncate font-medium text-foreground" title={t.name}>{t.name}</span>
                  </div>
                </td>
                <td className="px-2 py-2">
                  <Link href={`/projects/${t.projectId}?task=${t.id}`} className="text-[12px] text-primary hover:underline truncate block">{t.projectName}</Link>
                </td>
                <td className="px-2 py-2 text-[12px] text-muted-foreground truncate" title={t.completionReason ?? undefined}>
                  <span className="font-medium text-foreground">{who}</span>{t.completionReason ? ` — “${t.completionReason}”` : ""}
                </td>
                <td className="px-3 py-2">
                  {isApprover ? (
                    <div className="flex items-center justify-end gap-2">
                      <button type="button" disabled={busy} onClick={() => decide(t, "accept")}
                        className="inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1 rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">
                        <CheckCircle2 size={13} /> Accept
                      </button>
                      <button type="button" disabled={busy} onClick={() => decide(t, "reject")}
                        className="inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1 rounded-md border border-rose-300 text-rose-700 hover:bg-rose-50 disabled:opacity-50">
                        <XCircle size={13} /> Reject
                      </button>
                    </div>
                  ) : (
                    <span className="block text-right text-[11px] text-muted-foreground italic">Awaiting approver</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {node}
    </div>
  );
}

export default function ApprovalsList() {
  const { role, userId } = useUserStore();
  const qc = useQueryClient();
  // Task/subtask completions awaiting my sign-off (see CompletionApproval).
  const { data: myCompletions = [] } = useQuery({
    queryKey: ["/api/me/completion-approvals"],
    queryFn: () => api.get<CompletionApprovalItem[]>("/api/me/completion-approvals"),
  });
  const { data: completionLog = [] } = useQuery({
    queryKey: ["/api/me/completion-decisions"],
    queryFn: () => api.get<CompletionDecisionItem[]>("/api/me/completion-decisions"),
  });
  const refreshCompletions = () => {
    qc.invalidateQueries({ queryKey: ["/api/me/completion-approvals"] });
    qc.invalidateQueries({ queryKey: ["/api/me/completion-decisions"] });
  };
  // Initiator is a testing/demo role — fetch *all* pending approvals (no
  // approverId filter) so they can drive the workflow forward by deciding
  // as any approver. Other roles only see what's assigned to them.
  const isInitiator = role === "initiator";
  const { data: approvals, isLoading } = useGetPendingApprovals(
    isInitiator ? {} : { approverId: userId },
  );
  const [expanded, setExpanded] = useState<number | null>(null);

  const filteredApprovals = isInitiator
    ? (approvals ?? [])
    : (approvals?.filter(a => a.approverRole === role) ?? []);

  // For the initiator (testing) role, also count active projects since each
  // active project is a stage-approval row in the panel above. Without this
  // the header reads "0 pending" even though the page is full of test rows.
  const { data: projectsForCount = [] } = useListProjects(undefined, {
    query: { enabled: isInitiator } as never,
  });
  const stageRowCount = isInitiator
    ? (projectsForCount as Array<{ status?: string | null; stage?: string | null }>)
        .filter(p => p.status !== "closed" && p.stage).length
    : 0;
  const totalPending = filteredApprovals.length + stageRowCount + myCompletions.length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Approvals"
        subtitle={isInitiator
          ? "Testing mode — every approver's queue, so you can drive the workflow forward"
          : `Items awaiting your review as ${role.replace(/_/g, " ")}`}
        icon={Stamp}
        actions={
          <div data-tour="appr-pending" className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-primary/10 border border-primary/20">
            <Clock size={13} className="text-primary" />
            <span className="text-xs font-semibold text-primary">{totalPending} pending</span>
          </div>
        }
      />

      {/* Task/subtask completions awaiting my sign-off */}
      {myCompletions.length > 0 && (
        <div>
          <h3 className="text-sm font-bold text-foreground mb-2 mt-2 flex items-center gap-2">
            <CheckSquare size={15} className="text-primary" /> Task Completions ({myCompletions.length})
          </h3>
          <CompletionApprovalsTable completions={myCompletions} currentUserId={userId} onDone={refreshCompletions} />
        </div>
      )}

      {/* Completion decision log — my past accept/reject sign-offs */}
      {completionLog.length > 0 && (
        <div>
          <h3 className="text-sm font-bold text-foreground mb-2 mt-2 flex items-center gap-2">
            <Clock size={15} className="text-muted-foreground" /> Completion decision log
          </h3>
          <div className="rounded-xl border border-card-border bg-card divide-y divide-border/60">
            {completionLog.map((d) => (
              <div key={d.id} className="flex items-start gap-2 px-3 py-2">
                {d.decision === "accepted"
                  ? <CheckCircle2 size={15} className="text-success shrink-0 mt-0.5" />
                  : <XCircle size={15} className="text-destructive shrink-0 mt-0.5" />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] text-foreground truncate">
                      <span className={`font-semibold ${d.decision === "accepted" ? "text-success" : "text-destructive"}`}>
                        {d.decision === "accepted" ? "Accepted" : "Rejected"}
                      </span>
                      {" "}completion of <span className="font-medium">{d.taskName ?? `task #${d.taskId}`}</span>
                    </span>
                    <span className="text-[11px] text-muted-foreground shrink-0">{fmtWhen(d.decidedAt)}</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {d.projectName}{d.requesterName ? ` · requested by ${d.requesterName}` : ""}{d.reason ? ` · “${d.reason}”` : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Initiator-only: per-stage advance panel (covers every lifecycle stage) */}
      {isInitiator && <InitiatorStageAdvancePanel />}

      {/* Team member sign-offs (from the project Team tab Approval column) */}
      <TeamApprovals />

      {/* Approval items */}
      {isLoading ? (
        <div className="space-y-6">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-28 rounded-2xl" />)}
        </div>
      ) : filteredApprovals.length > 0 ? (
        isInitiator ? (
          <div>
            <h3 className="text-sm font-bold text-foreground mb-3 mt-2">Charter Approvals</h3>
            <InitiatorApproverGroups approvals={filteredApprovals} />
          </div>
        ) : (() => {
          // One compact table, SLA-breached (escalated) rows first, then pending.
          // Clicking a row's Review expands the DecisionPanel inline beneath it.
          const escalatedFirst = [...filteredApprovals].sort((x, y) => {
            const ex = isEscalated(x as { dueAt?: string | null; breachedAt?: string | null }) ? 0 : 1;
            const ey = isEscalated(y as { dueAt?: string | null; breachedAt?: string | null }) ? 0 : 1;
            return ex - ey;
          });
          const escalatedCount = filteredApprovals.filter(a => isEscalated(a as { dueAt?: string | null; breachedAt?: string | null })).length;
          return (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Clock size={15} className="text-warn" />
                <h3 className="text-sm font-bold text-foreground">Pending review</h3>
                <span className="text-xs font-semibold text-muted-foreground">{filteredApprovals.length}</span>
                {escalatedCount > 0 && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-destructive">
                    <AlertOctagon size={12} /> {escalatedCount} escalated
                  </span>
                )}
              </div>
              <div className="rounded-xl border border-border overflow-hidden bg-card">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50 text-muted-foreground text-[11px] uppercase tracking-wide border-b border-border">
                      <th className="text-left font-semibold px-3 py-2">Item</th>
                      <th className="text-left font-semibold px-2 py-2 w-32">Approver</th>
                      <th className="text-left font-semibold px-2 py-2 w-40">Stage</th>
                      <th className="text-center font-semibold px-2 py-2 w-20">Pending</th>
                      <th className="text-left font-semibold px-2 py-2 w-48">SLA</th>
                      <th className="text-right font-semibold px-3 py-2 w-24">Review</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {escalatedFirst.map(approval => {
                      const isOpen = expanded === approval.id;
                      const a = approval as unknown as Record<string, unknown>;
                      const roleKey = approval.approverRole ?? "";
                      const roleLbl = APPROVER_ROLE_LABELS[roleKey] ?? roleKey.replace(/_/g, " ");
                      const dp = daysPending((approval as { createdAt?: string }).createdAt);
                      const escalated = isEscalated(approval as { dueAt?: string | null; breachedAt?: string | null });
                      return (
                        <Fragment key={approval.id}>
                          <tr className={`hover:bg-muted/30 cursor-pointer ${escalated ? "bg-destructive/5" : ""}`} onClick={() => setExpanded(isOpen ? null : approval.id)}>
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-2 min-w-0">
                                {escalated ? <AlertOctagon size={14} className="text-destructive shrink-0" /> : <FileText size={14} className="text-muted-foreground shrink-0" />}
                                <Link href={`/charters/${approval.charterId}`} onClick={(e) => e.stopPropagation()} className="min-w-0 truncate font-medium text-foreground hover:text-primary hover:underline" title={(a.charterTitle as string) || `Charter #${approval.charterId}`}>
                                  {(a.charterTitle as string) || `Charter #${approval.charterId}`}
                                </Link>
                              </div>
                            </td>
                            <td className="px-2 py-2 text-[12px] text-muted-foreground capitalize truncate">{roleLbl || "—"}</td>
                            <td className="px-2 py-2 text-[12px] text-muted-foreground truncate">{STAGE_LABELS[approval.stage ?? ""] ?? (approval.stage ?? "Review")}</td>
                            <td className="px-2 py-2 text-center text-[12px] tabular-nums text-muted-foreground">{dp}d</td>
                            <td className="px-2 py-2"><SlaBadge approval={approval as unknown as { slaHours?: number; dueAt?: string | null; breachedAt?: string | null; createdAt?: string }} /></td>
                            <td className="px-3 py-2 text-right">
                              <button
                                onClick={(e) => { e.stopPropagation(); setExpanded(isOpen ? null : approval.id); }}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                              >
                                <MessageSquare size={12} /> Review
                                <ChevronRight size={12} className={`transition-transform ${isOpen ? "rotate-90" : ""}`} />
                              </button>
                            </td>
                          </tr>
                          {isOpen && (
                            <tr className="bg-muted/20">
                              <td colSpan={6} className="px-3 pb-3 pt-0">
                                <DecisionPanel approvalId={approval.id} onDone={() => setExpanded(null)} />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()
      ) : (
        <div className="glass-surface rounded-2xl p-12 text-center ph-rise ph-rise-3">
          <CheckCircle2 size={36} className="text-success/70 mx-auto mb-3" />
          <p className="font-semibold text-foreground mb-1">All caught up!</p>
          <p className="text-sm text-muted-foreground">
            No pending approvals for your current role ({role.replace(/_/g, " ")}).
          </p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            Switch roles using the sidebar dropdown to view other approval queues.
          </p>
        </div>
      )}
    </div>
  );
}
