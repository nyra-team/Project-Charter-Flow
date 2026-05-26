import { useGetPendingApprovals, useDecideApproval } from "@workspace/api-client-react";
import { useUserStore } from "../lib/store";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  CheckSquare, CheckCircle2, XCircle, ChevronRight,
  Clock, FileText, MessageSquare, AlertCircle,
} from "lucide-react";

function SlaBadge({ approval }: { approval: { slaHours?: number; dueAt?: string | null; breachedAt?: string | null; createdAt?: string } }) {
  const due = approval.dueAt ? new Date(approval.dueAt) : null;
  const now = new Date();
  const breached = approval.breachedAt || (due && due < now);
  if (!due) {
    return <span className="text-xs text-muted-foreground/80 flex items-center gap-1"><Clock size={11} />Awaiting your review</span>;
  }
  const hoursLeft = (due.getTime() - now.getTime()) / 3_600_000;
  if (breached) {
    return <span className="text-xs font-bold flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200"><AlertCircle size={11} /> SLA BREACHED · {Math.abs(Math.round(hoursLeft))}h overdue</span>;
  }
  if (hoursLeft < 4) {
    return <span className="text-xs font-bold flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200"><Clock size={11} /> Due in {Math.round(hoursLeft)}h</span>;
  }
  return <span className="text-xs flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100"><Clock size={11} /> SLA {approval.slaHours ?? 48}h · due {due.toLocaleString()}</span>;
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

  const roleDesc = ROLE_DESCRIPTIONS[role];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 ph-rise">
        <div>
          <h2 className="text-xl font-bold text-foreground">Pending Approvals</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {isInitiator
              ? <>Testing mode — showing <span className="font-semibold text-foreground">every approver's queue</span> so you can drive the workflow forward.</>
              : <>Items awaiting your review as <span className="font-semibold capitalize text-foreground">{role.replace(/_/g, " ")}</span></>
            }
          </p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-primary/10 border border-primary/20">
          <Clock size={13} className="text-primary" />
          <span className="text-xs font-semibold text-primary">{filteredApprovals.length} pending</span>
        </div>
      </div>

      {/* Role context info */}
      {isInitiator ? (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-primary/5 border border-primary/30 ph-rise ph-rise-2">
          <AlertCircle size={16} className="text-primary flex-shrink-0 mt-0.5" />
          <p className="text-sm text-foreground/90">
            Each item below shows which approver it belongs to. Click <span className="font-semibold">Review</span> on any item to approve or reject as that role — useful for walking the project through the lifecycle during testing.
          </p>
        </div>
      ) : roleDesc ? (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-warn/10 border border-warn/30 ph-rise ph-rise-2">
          <AlertCircle size={16} className="text-warn flex-shrink-0 mt-0.5" />
          <p className="text-sm text-foreground/90">{roleDesc}</p>
        </div>
      ) : null}

      {/* Approval items */}
      {isLoading ? (
        <div className="space-y-6">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-28 rounded-2xl" />)}
        </div>
      ) : filteredApprovals.length > 0 ? (
        isInitiator ? (
          <InitiatorApproverGroups approvals={filteredApprovals} />
        ) : (
          <div className="space-y-6 stagger-children">
            {filteredApprovals.map(approval => {
              const isOpen = expanded === approval.id;
              return (
                <div
                  key={approval.id}
                  className={`glass-surface lift-card rounded-2xl p-4 transition-all ${isOpen ? "ring-1 ring-primary/30 shadow-lg" : ""}`}
                >
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-warn/10 border border-warn/30">
                      <FileText size={18} className="text-warn" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <Link href={`/charters/${approval.charterId}`}>
                            <h3 className="font-semibold text-foreground hover:text-primary transition-colors">
                              {(approval as unknown as Record<string, unknown>).charterTitle as string || `Charter #${approval.charterId}`}
                            </h3>
                          </Link>
                          <div className="flex items-center gap-3 mt-1 flex-wrap">
                            <span className="text-xs text-muted-foreground/80 flex items-center gap-1">
                              <CheckSquare size={11} />
                              {STAGE_LABELS[approval.stage ?? ""] ?? (approval.stage ?? "Review")}
                            </span>
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

                      {isOpen && (
                        <DecisionPanel
                          approvalId={approval.id}
                          onDone={() => setExpanded(null)}
                        />
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )
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
