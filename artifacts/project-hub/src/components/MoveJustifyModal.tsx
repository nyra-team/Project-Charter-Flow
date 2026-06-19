import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

// Justification gate for kanban status moves — mirrors the CXO Action Centre
// board, which asks for a reason before a drag changes an item's status. Used
// by both the project board (projects.tsx) and the task board (project-detail).
export function MoveJustifyModal({ toLabel, pending, onCancel, onConfirm }: {
  toLabel: string;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative z-10 w-[460px] max-w-[92vw] rounded-xl border border-gray-200 bg-white shadow-2xl">
        <div className="flex items-center gap-2 px-5 pt-4 pb-1">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
          <h3 className="text-[15px] font-semibold text-gray-900">Reason for moving to {toLabel}</h3>
        </div>
        <p className="px-5 text-[12px] text-gray-500">Please provide a justification before changing the status.</p>
        <div className="px-5 py-3">
          <label className="text-[12px] font-semibold text-gray-600">Reason <span className="text-rose-500">*</span></label>
          <Textarea
            autoFocus
            rows={4}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}
            placeholder={`Why is this moving to ${toLabel}?`}
            className="mt-1"
          />
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100">
          <button type="button" onClick={onCancel} className="text-[13px] px-3 py-1.5 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50">Cancel</button>
          <button
            type="button"
            disabled={!reason.trim() || pending}
            onClick={() => onConfirm(reason.trim())}
            className="text-[13px] px-3 py-1.5 rounded-md bg-[#1868db] text-white hover:bg-[#1558bc] disabled:opacity-50"
          >
            {pending ? "Saving…" : "Confirm move"}
          </button>
        </div>
      </div>
    </div>
  );
}
