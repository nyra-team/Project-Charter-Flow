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
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
          style={{ background: "#FEF2F2", color: "#991B1B", border: "1px solid #FCA5A5" }}
        >
          <XCircle size={13} />
          Reject
        </button>
        <button
          onClick={() => setAction("approve")}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
          style={{ background: "#ECFDF5", color: "#065F46", border: "1px solid #6EE7B7" }}
        >
          <CheckCircle2 size={13} />
          Approve
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 p-3 rounded-xl" style={{ background: action === "approve" ? "#ECFDF5" : "#FEF2F2" }}>
      <p className="text-xs font-semibold mb-2" style={{ color: action === "approve" ? "#065F46" : "#991B1B" }}>
        {action === "approve" ? "Add a comment (optional):" : "Reason for rejection (required):"}
      </p>
      <textarea
        value={comments}
        onChange={e => setComments(e.target.value)}
        placeholder={action === "approve" ? "e.g. Looks good, approved." : "Explain why this is being rejected..."}
        rows={2}
        className="w-full text-sm p-2 rounded-lg outline-none resize-none"
        style={{
          background: "white",
          border: `1px solid ${action === "approve" ? "#6EE7B7" : "#FCA5A5"}`,
        }}
      />
      <div className="flex gap-2 mt-2">
        <button
          onClick={() => setAction(null)}
          className="px-3 py-1.5 rounded-lg text-xs font-medium"
          style={{ background: "white", color: "#64748B", border: "1px solid #E2E8F0" }}
        >
          Cancel
        </button>
        <button
          onClick={() => handleDecide(action === "approve" ? "approved" : "rejected")}
          disabled={decideMutation.isPending || (action === "reject" && !comments.trim())}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold text-white transition-all disabled:opacity-50"
          style={{ background: action === "approve" ? "#10B981" : "#EF4444" }}
        >
          {decideMutation.isPending ? "Saving..." : action === "approve" ? "Confirm Approval" : "Confirm Rejection"}
        </button>
      </div>
    </div>
  );
}

export default function ApprovalsList() {
  const { role, userId } = useUserStore();
  const { data: approvals, isLoading } = useGetPendingApprovals({ approverId: userId });
  const [expanded, setExpanded] = useState<number | null>(null);

  const filteredApprovals = approvals?.filter(a => a.approverRole === role) ?? [];

  const roleDesc = ROLE_DESCRIPTIONS[role];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Pending Approvals</h2>
          <p className="text-sm text-gray-500 mt-0.5">Items awaiting your review as <span className="font-semibold capitalize">{role.replace(/_/g, " ")}</span></p>
        </div>
        <div
          className="flex items-center gap-2 px-3 py-1.5 rounded-xl"
          style={{ background: "#EEF2FF", border: "1px solid #C7D2FE" }}
        >
          <Clock size={13} className="text-indigo-500" />
          <span className="text-xs font-semibold text-indigo-700">{filteredApprovals.length} pending</span>
        </div>
      </div>

      {/* Role context info */}
      {roleDesc && (
        <div
          className="flex items-start gap-3 p-4 rounded-xl"
          style={{ background: "#FFFBEB", border: "1px solid #FDE68A" }}
        >
          <AlertCircle size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800">{roleDesc}</p>
        </div>
      )}

      {/* Approval items */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-28 rounded-2xl" />)}
        </div>
      ) : filteredApprovals.length > 0 ? (
        <div className="space-y-3">
          {filteredApprovals.map(approval => {
            const isOpen = expanded === approval.id;
            return (
              <div
                key={approval.id}
                className="rounded-2xl p-4 transition-all"
                style={{ background: "white", border: "1px solid #E2E8F0", boxShadow: isOpen ? "0 4px 20px rgba(0,0,0,0.06)" : "none" }}
              >
                <div className="flex items-start gap-3">
                  {/* Icon */}
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: "linear-gradient(135deg, #FFFBEB, #FEF3C7)" }}
                  >
                    <FileText size={18} className="text-amber-500" />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <Link href={`/charters/${approval.charterId}`}>
                          <h3 className="font-semibold text-gray-900 hover:text-indigo-600 transition-colors">
                            {(approval as Record<string, unknown>).charterTitle as string || `Charter #${approval.charterId}`}
                          </h3>
                        </Link>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-xs text-gray-400 flex items-center gap-1">
                            <CheckSquare size={11} />
                            {STAGE_LABELS[approval.stage ?? ""] ?? (approval.stage ?? "Review")}
                          </span>
                          <span className="text-xs text-gray-400 flex items-center gap-1">
                            <Clock size={11} />
                            Awaiting your review
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={() => setExpanded(isOpen ? null : approval.id)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all flex-shrink-0"
                        style={{ background: "#F1F5F9", color: "#475569" }}
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
      ) : (
        <div
          className="rounded-2xl p-12 text-center"
          style={{ background: "white", border: "1px solid #E2E8F0" }}
        >
          <CheckCircle2 size={36} className="text-emerald-300 mx-auto mb-3" />
          <p className="font-semibold text-gray-600 mb-1">All caught up!</p>
          <p className="text-sm text-gray-400">
            No pending approvals for your current role ({role.replace(/_/g, " ")}).
          </p>
          <p className="text-xs text-gray-400 mt-1">
            Switch roles using the sidebar dropdown to view other approval queues.
          </p>
        </div>
      )}
    </div>
  );
}
