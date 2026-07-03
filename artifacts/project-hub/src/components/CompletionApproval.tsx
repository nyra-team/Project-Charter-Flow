// Task-completion approval gate (shared UI).
//
// Marking a task/subtask "Completed" is not self-service: whoever marks it must
// give a justification, and the task's approver (its assigner) accepts or
// rejects. This file has the three reusable pieces the surfaces plug in:
//   • useReasonPrompt()      — imperative modal: ask({...}) → Promise<reason|null>,
//                              used both to justify a completion and to justify a
//                              rejection. Render the returned `node` once.
//   • CompletionApprovalBanner — the pending-request banner shown in the task
//                              drawer; the approver gets Accept / Reject.
import { useCallback, useState } from "react";
import { AlertTriangle, Check, X, Clock } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/extra-api";

// ── Reason modal + imperative hook ──────────────────────────────────────────
function ReasonModal({ title, label, confirmText, tone, onCancel, onConfirm }: {
  title: string; label: string; confirmText: string; tone: "default" | "danger";
  onCancel: () => void; onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const confirmCls = tone === "danger" ? "bg-rose-600 hover:bg-rose-700" : "bg-[#1868db] hover:bg-[#1558bc]";
  // Radix Dialog (not a hand-rolled overlay) so it layers above and takes focus
  // even when opened from INSIDE another dialog (the task drawer) — a plain
  // portal there gets its typing blocked by the parent dialog's focus trap.
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-[460px] p-0 gap-0 overflow-hidden">
        <div className="flex items-center gap-2 px-5 pt-4 pb-1">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
          <DialogTitle className="text-[15px] font-semibold text-gray-900">{title}</DialogTitle>
        </div>
        <div className="px-5 py-3">
          <label className="text-[12px] font-semibold text-gray-600">{label} <span className="text-rose-500">*</span></label>
          <Textarea
            autoFocus rows={4} value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}
            placeholder={label}
            className="mt-1"
          />
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100">
          <button type="button" onClick={onCancel} className="text-[13px] px-3 py-1.5 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50">Cancel</button>
          <button
            type="button"
            disabled={!reason.trim() || saving}
            onClick={() => { setSaving(true); onConfirm(reason.trim()); }}
            className={`text-[13px] px-3 py-1.5 rounded-md text-white disabled:opacity-50 ${confirmCls}`}
          >
            {saving ? "Saving…" : confirmText}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type AskOpts = { title: string; label: string; confirmText?: string; tone?: "default" | "danger" };

/** Imperative reason prompt. `await ask({...})` resolves to the entered reason,
 *  or null if cancelled. Render the returned `node` somewhere in the tree. */
export function useReasonPrompt() {
  const [state, setState] = useState<(AskOpts & { resolve: (v: string | null) => void }) | null>(null);
  const ask = useCallback(
    (opts: AskOpts) => new Promise<string | null>((resolve) => setState({ ...opts, resolve })),
    [],
  );
  const node = state ? (
    <ReasonModal
      title={state.title}
      label={state.label}
      confirmText={state.confirmText ?? "Confirm"}
      tone={state.tone ?? "default"}
      onCancel={() => { state.resolve(null); setState(null); }}
      onConfirm={(reason) => { state.resolve(reason); setState(null); }}
    />
  ) : null;
  return { ask, node };
}

// ── Approver banner ─────────────────────────────────────────────────────────
type PendingTask = {
  id: number;
  completionRequestedBy?: number | null;
  completionApproverId?: number | null;
  completionReason?: string | null;
  completionRequestedByName?: string | null;
};

/** Shown in the task drawer whenever a completion is pending. The approver
 *  (currentUserId === completionApproverId) gets Accept / Reject; everyone else
 *  sees a read-only "awaiting approval" note. */
export function CompletionApprovalBanner({ task, currentUserId, onDone }: {
  task: PendingTask; currentUserId: number | null; onDone: () => void;
}) {
  const { ask, node } = useReasonPrompt();
  const [busy, setBusy] = useState(false);
  if (!task.completionRequestedBy) return null;
  const isApprover = currentUserId != null && currentUserId === task.completionApproverId;
  const who = task.completionRequestedByName ?? "Someone";

  const decide = async (decision: "accept" | "reject") => {
    let reason: string | undefined;
    if (decision === "reject") {
      const r = await ask({ title: "Reason for rejecting completion", label: "Why is this not complete?", confirmText: "Reject", tone: "danger" });
      if (r == null) return;
      reason = r;
    }
    setBusy(true);
    try {
      await api.post(`/api/tasks/${task.id}/complete-decision`, { decision, reason });
      onDone();
    } finally { setBusy(false); }
  };

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 mb-3">
      <div className="flex items-start gap-2">
        <Clock className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold text-amber-900">Completion pending approval</p>
          <p className="text-[12px] text-amber-800 mt-0.5">
            <span className="font-medium">{who}</span> marked this complete
            {task.completionReason ? <> — “{task.completionReason}”</> : null}.
          </p>
          {isApprover ? (
            <div className="flex items-center gap-2 mt-2">
              <button type="button" disabled={busy} onClick={() => decide("accept")}
                className="inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1 rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">
                <Check size={13} /> Accept
              </button>
              <button type="button" disabled={busy} onClick={() => decide("reject")}
                className="inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1 rounded-md border border-rose-300 text-rose-700 hover:bg-rose-50 disabled:opacity-50">
                <X size={13} /> Reject
              </button>
            </div>
          ) : (
            <p className="text-[11px] text-amber-700 mt-1">Waiting for the task approver to accept or reject.</p>
          )}
        </div>
      </div>
      {node}
    </div>
  );
}
