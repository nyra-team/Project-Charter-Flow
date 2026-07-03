import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { History, CalendarClock, Milestone as MilestoneIcon } from "lucide-react";

// One project-audit row (pmo activity log). Milestone date changes + their
// justifications are logged here (see api-server projects.ts milestone PATCH
// and the task→milestone auto-extend cascade), so this is the history source.
type AuditEntry = {
  id: number; type: string; message: string;
  entityId: number; entityType: string;
  userId?: number | null; userName?: string | null;
  createdAt: string;
};

export interface HistoryMilestone {
  id: number;
  name: string;
  startDate?: string | null;
  dueDate?: string | null;
  justification?: string | null;
}

const fmtDate = (d?: string | null) =>
  d ? new Date(d.slice(0, 10)).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function MilestoneHistoryModal({ open, onClose, projectId, milestone }: {
  open: boolean;
  onClose: () => void;
  projectId: number;
  milestone: HistoryMilestone | null;
}) {
  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["/api/projects", projectId, "audit"],
    queryFn: () => customFetch<AuditEntry[]>(`/api/projects/${projectId}/audit`),
    enabled: open && milestone != null,
  });

  const log = (entries as AuditEntry[])
    .filter((a) => a.entityType === "milestone" && milestone != null && a.entityId === milestone.id);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History size={18} className="text-primary" />
            {milestone?.name ?? "Milestone"} — timeline history
          </DialogTitle>
        </DialogHeader>

        {/* Current timeline */}
        <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <CalendarClock size={15} className="text-muted-foreground" />
            {fmtDate(milestone?.startDate)} <span className="text-muted-foreground">→</span> {fmtDate(milestone?.dueDate)}
            <span className="text-[11px] text-muted-foreground ml-1">(current)</span>
          </div>
          {milestone?.justification && (
            <p className="mt-1.5 text-xs text-muted-foreground"><span className="font-semibold">Latest reason:</span> {milestone.justification}</p>
          )}
        </div>

        {/* Change log — previous timelines + justifications, newest first */}
        <div className="mt-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Previous timelines &amp; justification log</h4>
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Loading history…</p>
          ) : log.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No changes recorded yet.</p>
          ) : (
            <ol className="relative border-l border-border ml-2 space-y-3">
              {log.map((a) => (
                <li key={a.id} className="ml-4">
                  <span className="absolute -left-[5px] mt-1.5 w-2.5 h-2.5 rounded-full bg-primary/70 ring-2 ring-background" />
                  <div className="flex items-start gap-2">
                    <MilestoneIcon size={13} className="mt-0.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="text-sm text-foreground">{a.message}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {a.userName ? `${a.userName} · ` : ""}{fmtTime(a.createdAt)}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
