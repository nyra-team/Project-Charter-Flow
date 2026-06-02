// Thin back-compat shim — existing call-sites keep `<StatusBadge status="..." />`
// but the look now flows through the centralized status tokens (StatusChip), so
// every status surface reads consistently. New code should import StatusChip
// directly from "@/components/ui-kit".
import { StatusChip } from "@/components/ui-kit";

export function StatusBadge({ status }: { status: string }) {
  return <StatusChip status={status} size="sm" />;
}
