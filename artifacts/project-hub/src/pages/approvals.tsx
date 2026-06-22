import {
  useGetPendingApprovals, useDecideApproval, useListProjects,
  useUpdateProjectTeamMember,
} from "@workspace/api-client-react";
import { useUserStore } from "../lib/store";
import { LIFECYCLE_STAGES } from "../lib/lifecycle-config";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckSquare, CheckCircle2, XCircle, ChevronRight, Users,
  Clock, FileText, MessageSquare, AlertCircle, Stamp, AlertOctagon,
} from "lucide-react";
import { PageHeader } from "@/components/ui-kit";

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

const ROLE_DESCRIPTIONS: Record<string, string> = {
  hod: "Review and approve/reject charter from a department perspective.",
  executive_director: "Executive review of strategic alignment.",
  cfo: "Financial review and budget approval.",
  scm: "Evaluate vendors and finalize negotiated price.",
  chairman: "Final executive approval.",
  finance: "Create SAP internal order number.",
  pmo: "Select project team and launch execution.",
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
    <div className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card">
      <div className="flex-1 min-w-0">
        <Link href={`/charters/${approval.charterId}`}>
          <p className="text-sm font-medium text-foreground hover:text-primary transition-colors truncate">
            {charterTitle}
          </p>
        </Link>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className="text-[11px] text-muted-foreground">
            {STAGE_LABELS[approval.stage ?? ""] ?? (approval.stage ?? "Review")}
          </span>
          <SlaBadge approval={approval} />
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={() => decide("rejected")}
          disabled={decideMutation.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors bg-destructive/10 text-destructive border border-destructive/30 hover:bg-destructive/15 disabled:opacity-50"
        >
          <XCircle size={13} />
          Reject
        </button>
        <button
          onClick={() => decide("approved")}
          disabled={decideMutation.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-success hover:bg-success/90 transition-colors disabled:opacity-50"
        >
          <CheckCircle2 size={13} />
          Approve as {roleLabel.split(" ")[0]}
        </button>
      </div>
    </div>
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
    <div className="p-3 rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <Link href={`/projects/${projectId}`}>
            <p className="text-sm font-medium text-foreground hover:text-primary transition-colors truncate">
              {projectTitle}
            </p>
          </Link>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Current stage: <span className="font-semibold text-foreground">{meta.label}</span>
            {meta.advanceLabel ? <> — {meta.advanceLabel}</> : null}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap mt-2">
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
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-success hover:bg-success/90 transition-colors disabled:opacity-50"
            >
              <CheckCircle2 size={13} />
              {isPending ? "Advancing..." : `Approve as ${short}`}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function InitiatorStageAdvancePanel() {
  const { data: projects = [] } = useListProjects();
  const active = (projects as Array<{ id: number; title: string; stage?: string | null; status?: string | null }>)
    .filter(p => p.status !== "closed" && p.stage);
  return (
    <div className="glass-surface rounded-2xl p-4 ph-rise ph-rise-3">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-primary/10 border border-primary/20">
          <FileText size={14} className="text-primary" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-foreground">Stage Approvals (All Projects)</h3>
          <p className="text-[11px] text-muted-foreground">
            One row per active project. Click any approver button to approve as that role and push the project to the next stage. Bypasses checklist / document gates — testing only.
          </p>
        </div>
      </div>
      {active.length === 0 ? (
        <p className="text-xs text-muted-foreground italic px-1 py-2">No active projects.</p>
      ) : (
        <div className="space-y-2">
          {active.map(p => (
            <StageAdvanceRow key={p.id} projectId={p.id} projectTitle={p.title} stageKey={p.stage!} />
          ))}
        </div>
      )}
    </div>
  );
}

function InitiatorApproverGroups({ approvals }: { approvals: ApprovalLike[] }) {
  // Group by approverRole
  const groups = new Map<string, ApprovalLike[]>();
  for (const a of approvals) {
    const key = a.approverRole ?? "unassigned";
    const list = groups.get(key) ?? [];
    list.push(a);
    groups.set(key, list);
  }
  const orderedRoles = ["hod", "executive_director", "cfo", "scm", "chairman", "finance", "pmo"];
  const sortedKeys = [
    ...orderedRoles.filter(r => groups.has(r)),
    ...Array.from(groups.keys()).filter(k => !orderedRoles.includes(k)),
  ];

  return (
    <div className="space-y-5 stagger-children">
      {sortedKeys.map(roleKey => {
        const items = groups.get(roleKey)!;
        const label = APPROVER_ROLE_LABELS[roleKey] ?? roleKey.replace(/_/g, " ");
        return (
          <div key={roleKey} className="glass-surface rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-primary/10 border border-primary/20">
                  <FileText size={14} className="text-primary" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-foreground capitalize">{label}</h3>
                  <p className="text-[11px] text-muted-foreground">{items.length} item{items.length === 1 ? "" : "s"} awaiting this approver</p>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              {items.map(a => (
                <QuickDecideRow key={a.id} approval={a as ApprovalLike & Record<string, unknown>} />
              ))}
            </div>
          </div>
        );
      })}
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

export default function ApprovalsList() {
  const { role, userId } = useUserStore();
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
  const totalPending = filteredApprovals.length + stageRowCount;

  const roleDesc = ROLE_DESCRIPTIONS[role];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Approvals"
        subtitle={isInitiator
          ? "Testing mode — every approver's queue, so you can drive the workflow forward"
          : `Items awaiting your review as ${role.replace(/_/g, " ")}`}
        icon={Stamp}
        actions={
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-primary/10 border border-primary/20">
            <Clock size={13} className="text-primary" />
            <span className="text-xs font-semibold text-primary">{totalPending} pending</span>
          </div>
        }
      />

      {/* Role context info */}
      {isInitiator ? (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-primary/5 border border-primary/30 ph-rise ph-rise-2">
          <AlertCircle size={16} className="text-primary flex-shrink-0 mt-0.5" />
          <p className="text-sm text-foreground/90">
            Two sections below: <span className="font-semibold">Stage Approvals</span> lets you push any active project to its next stage as any allowed approver (covers every lifecycle stage). <span className="font-semibold">Charter Approvals</span> shows individual sign-offs on the parallel-review / SCM / Chairman / Finance / PMO chain.
          </p>
        </div>
      ) : roleDesc ? (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-warn/10 border border-warn/30 ph-rise ph-rise-2">
          <AlertCircle size={16} className="text-warn flex-shrink-0 mt-0.5" />
          <p className="text-sm text-foreground/90">{roleDesc}</p>
        </div>
      ) : null}

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
          // Visual workflow: Escalated (SLA-breached) lane first, then Pending.
          const escalated = filteredApprovals.filter(a => isEscalated(a as { dueAt?: string | null; breachedAt?: string | null }));
          const pending = filteredApprovals.filter(a => !isEscalated(a as { dueAt?: string | null; breachedAt?: string | null }));
          const renderCard = (approval: typeof filteredApprovals[number], lane: "pending" | "escalated") => {
            const isOpen = expanded === approval.id;
            const a = approval as unknown as Record<string, unknown>;
            const roleKey = approval.approverRole ?? "";
            const roleLbl = APPROVER_ROLE_LABELS[roleKey] ?? roleKey.replace(/_/g, " ");
            const dp = daysPending((approval as { createdAt?: string }).createdAt);
            const accent = lane === "escalated" ? "bg-destructive/10 border-destructive/30" : "bg-warn/10 border-warn/30";
            const accentText = lane === "escalated" ? "text-destructive" : "text-warn";
            return (
              <div
                key={approval.id}
                className={`glass-surface lift-card rounded-2xl p-4 transition-all ${isOpen ? "ring-1 ring-primary/30 shadow-lg" : ""}`}
              >
                <div className="flex items-start gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 border ${accent}`}>
                    {lane === "escalated" ? <AlertOctagon size={18} className={accentText} /> : <FileText size={18} className={accentText} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Link href={`/charters/${approval.charterId}`}>
                          <h3 className="font-semibold text-foreground hover:text-primary transition-colors truncate">
                            {(a.charterTitle as string) || `Charter #${approval.charterId}`}
                          </h3>
                        </Link>
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          {roleLbl && <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{roleLbl}</span>}
                          <span className="text-xs text-muted-foreground/80 flex items-center gap-1">
                            <CheckSquare size={11} />
                            {STAGE_LABELS[approval.stage ?? ""] ?? (approval.stage ?? "Review")}
                          </span>
                          <span className="text-[11px] text-muted-foreground">· {dp}d pending</span>
                          <SlaBadge approval={approval as unknown as { slaHours?: number; dueAt?: string | null; breachedAt?: string | null; createdAt?: string }} />
                        </div>
                      </div>
                      <button
                        onClick={() => setExpanded(isOpen ? null : approval.id)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground flex-shrink-0"
                      >
                        <MessageSquare size={12} />
                        Review
                        <ChevronRight size={12} className={`transition-transform ${isOpen ? "rotate-90" : ""}`} />
                      </button>
                    </div>
                    {isOpen && <DecisionPanel approvalId={approval.id} onDone={() => setExpanded(null)} />}
                  </div>
                </div>
              </div>
            );
          };
          return (
            <div className="space-y-6">
              {escalated.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <AlertOctagon size={15} className="text-destructive" />
                    <h3 className="text-sm font-bold text-destructive">Escalated · SLA breached</h3>
                    <span className="text-xs font-semibold text-muted-foreground">{escalated.length}</span>
                  </div>
                  <div className="space-y-3 stagger-children">{escalated.map(a => renderCard(a, "escalated"))}</div>
                </div>
              )}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Clock size={15} className="text-warn" />
                  <h3 className="text-sm font-bold text-foreground">Pending review</h3>
                  <span className="text-xs font-semibold text-muted-foreground">{pending.length}</span>
                </div>
                <div className="space-y-3 stagger-children">{pending.map(a => renderCard(a, "pending"))}</div>
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
