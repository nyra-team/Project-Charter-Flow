import { CheckCircle2, Clock, XCircle } from "lucide-react";

export function ApprovalStatusIcon({ status }: { status: string }) {
  if (status === "approved") return <CheckCircle2 size={14} className="text-emerald-500" />;
  if (status === "rejected") return <XCircle size={14} className="text-red-500" />;
  return <Clock size={14} className="text-amber-500" />;
}

export function DocStatusBadge({ status }: { status: string }) {
  const cfg =
    status === "approved"
      ? { bg: "#ECFDF5", color: "#065F46", label: "Approved" }
      : status === "rejected"
        ? { bg: "#FEF2F2", color: "#991B1B", label: "Rejected" }
        : { bg: "#FFFBEB", color: "#92400E", label: "Pending Review" };
  return (
    <span
      className="text-xs font-semibold px-2 py-0.5 rounded-full"
      style={{ background: cfg.bg, color: cfg.color }}
    >
      {cfg.label}
    </span>
  );
}
