// Mandatory justification gate for task/subtask date changes. Any edit to a
// start/end date routes through `requestDateChange`, which pops a modal asking
// WHY before the change is applied. The reason is logged as a task comment
// (reuses /api/tasks/:id/comments — no schema change), giving a date-change
// audit trail alongside the existing endDateHistory the backend already keeps.
// ponytail: stored as a comment; promote to a dedicated audit table if the
// justification ever needs to be queried/reported on independently.
import { useState, type ReactElement } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/extra-api";
import { CalendarClock } from "lucide-react";

export type DateChange = { label: string; from: string | null; to: string | null };
// apply receives the typed reason so callers can persist it (e.g. task.justification).
// firstAssignment = no prior dates existed; the gate skips the prompt in that case.
// skipComment = the reason is persisted by apply() itself (e.g. onto a milestone's
// justification column) rather than logged as a task comment — used for non-task
// date changes where /api/tasks/:id/comments doesn't apply.
type Pending = { taskId: number; changes: DateChange[]; apply: (reason: string) => void; firstAssignment?: boolean; skipComment?: boolean };

const fmt = (v: string | null) => (v ? v.slice(0, 10) : "—");

export function useDateJustify() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  // Gate a date change behind a mandatory justification. A no-op (same value,
  // e.g. blurring a date field without editing it) is ignored entirely.
  const requestDateChange = (p: Pending) => {
    const real = p.changes.filter((c) => (c.from ?? "").slice(0, 10) !== (c.to ?? "").slice(0, 10));
    if (real.length === 0) return;
    // First-time assignment of a timeline has nothing to justify — apply directly.
    if (p.firstAssignment) { p.apply(""); return; }
    setReason("");
    setPending({ ...p, changes: real });
  };

  const close = () => { if (!saving) { setPending(null); setReason(""); } };

  const confirm = async () => {
    if (!pending || !reason.trim() || saving) return;
    setSaving(true);
    try {
      pending.apply(reason.trim());
      if (!pending.skipComment) {
        const summary = pending.changes.map((c) => `${c.label} ${fmt(c.from)} → ${fmt(c.to)}`).join("; ");
        await api.post(`/api/tasks/${pending.taskId}/comments`, {
          body: `📅 Date changed — ${summary}. Justification: ${reason.trim()}`,
          attachments: [],
        });
      }
    } finally {
      setSaving(false);
      setPending(null);
      setReason("");
    }
  };

  const dateJustifyModal: ReactElement = (
    <Dialog open={!!pending} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
        <div className="flex items-center gap-2 px-5 pt-4 pb-3 border-b border-gray-200">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-amber-500/10 text-amber-600 shrink-0">
            <CalendarClock size={16} />
          </span>
          <div>
            <p className="text-[14px] font-semibold text-gray-900 leading-tight">Justify date change</p>
            <p className="text-[12px] text-gray-500">A reason is required before this date is updated.</p>
          </div>
        </div>
        <div className="px-5 py-4 space-y-3">
          {pending && (
            <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 space-y-1">
              {pending.changes.map((c, i) => (
                <div key={i} className="flex items-center gap-2 text-[12px] text-gray-700">
                  <span className="font-medium text-gray-500 w-12 shrink-0">{c.label}</span>
                  <span className="tabular-nums text-gray-400 line-through">{fmt(c.from)}</span>
                  <span className="text-gray-400">→</span>
                  <span className="tabular-nums font-medium text-gray-900">{fmt(c.to)}</span>
                </div>
              ))}
            </div>
          )}
          <div>
            <label className="text-[12px] font-medium text-gray-700">Reason for the change</label>
            <Textarea
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) confirm(); }}
              placeholder="e.g. vendor delivery slipped two weeks; rescheduled with the CFT team."
              className="mt-1 min-h-[80px] text-[13px]"
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-200 bg-gray-50/60">
          <Button type="button" variant="ghost" size="sm" onClick={close} disabled={saving}>Cancel</Button>
          <Button type="button" size="sm" onClick={confirm} disabled={!reason.trim() || saving}>
            {saving ? "Saving…" : "Save change"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );

  return { requestDateChange, dateJustifyModal };
}
