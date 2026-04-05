import { Badge } from "@/components/ui/badge";

export function StatusBadge({ status }: { status: string }) {
  let variant: "default" | "secondary" | "destructive" | "outline" = "default";
  let colorClass = "";

  switch (status.toLowerCase()) {
    case "approved":
    case "active":
    case "completed":
      colorClass = "bg-green-100 text-green-800 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400";
      break;
    case "rejected":
    case "cancelled":
      variant = "destructive";
      break;
    case "draft":
    case "planning":
    case "not_started":
      variant = "secondary";
      break;
    case "pending":
    case "in_progress":
    case "parallel_review":
    case "scm_review":
    case "chairman_review":
    case "finance_review":
    case "pmo_review":
    case "submitted":
      colorClass = "bg-amber-100 text-amber-800 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400";
      break;
    default:
      variant = "outline";
  }

  return (
    <Badge variant={variant} className={`capitalize ${colorClass} whitespace-nowrap`}>
      {status.replace(/_/g, " ")}
    </Badge>
  );
}
