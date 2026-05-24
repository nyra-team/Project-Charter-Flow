import { CheckCircle2, Clock, XCircle } from "lucide-react";

export function ApprovalStatusIcon({ status }: { status: string }) {
 if (status === "approved") return <CheckCircle2 size={14} className="text-success" />;
 if (status === "rejected") return <XCircle size={14} className="text-destructive" />;
 return <Clock size={14} className="text-warn" />;
}

export function DocStatusBadge({ status }: { status: string }) {
 const cfg =
 status === "approved"
 ? { bg: "hsl(var(--success) / 0.12)", color: "hsl(var(--success) / 1)", label: "Approved" }
 : status === "rejected"
 ? { bg: "hsl(var(--destructive) / 0.12)", color: "hsl(var(--destructive) / 1)", label: "Rejected" }
 : { bg: "hsl(var(--warn) / 0.12)", color: "hsl(var(--warn) / 1)", label: "Pending Review" };
 return (
 <span
 className="text-xs font-semibold px-2 py-0.5 rounded-full"
 style={{ background: cfg.bg, color: cfg.color }}
 >
 {cfg.label}
 </span>
 );
}
