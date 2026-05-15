import { useState, useEffect } from "react";
import { useListProjectStages, useUpdateProjectStage } from "@workspace/api-client-react";
import { useUserStore } from "../../lib/store";
import { useToast } from "@/hooks/use-toast";
import { Timer } from "lucide-react";

export function GoLiveCountdown({ projectId }: { projectId: number }) {
  const { role } = useUserStore();
  const { toast } = useToast();
  const canFreeze = role === "pm" || role === "pmo";
  const { data: stageRecords = [] } = useListProjectStages(projectId);
  const updateStage = useUpdateProjectStage();

  const goLiveRecord = (
    stageRecords as Array<{ id: number; stage: string; notes?: string | null }>
  ).find((r) => r.stage === "go_live");

  const parsedNotes = (() => {
    try { return goLiveRecord?.notes ? (JSON.parse(goLiveRecord.notes) as Record<string, unknown>) : {}; }
    catch { return {}; }
  })();

  const [goLiveDate, setGoLiveDateLocal] = useState(
    (parsedNotes.__goLiveDate as string | undefined) ?? "",
  );
  const [frozen, setFrozenLocal] = useState(
    (parsedNotes.__goLiveFrozen as boolean | undefined) ?? false,
  );

  useEffect(() => {
    if (goLiveRecord?.notes) {
      try {
        const p = JSON.parse(goLiveRecord.notes) as Record<string, unknown>;
        if (p.__goLiveDate !== undefined) setGoLiveDateLocal(p.__goLiveDate as string);
        if (p.__goLiveFrozen !== undefined) setFrozenLocal(p.__goLiveFrozen as boolean);
      } catch {}
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goLiveRecord?.id]);

  function persistGoLive(date: string, isFrozen: boolean) {
    if (!goLiveRecord?.id) return;
    const next = { ...parsedNotes, __goLiveDate: date, __goLiveFrozen: isFrozen };
    updateStage.mutate(
      { id: goLiveRecord.id, data: { notes: JSON.stringify(next) } },
      { onError: () => toast({ title: "Failed to save Go Live date", variant: "destructive" }) },
    );
  }

  const daysLeft =
    goLiveDate && frozen
      ? Math.ceil((new Date(goLiveDate).getTime() - Date.now()) / 86400000)
      : null;

  return (
    <div className="rounded-xl p-4 mt-4" style={{ background: "#ECFDF5", border: "1px solid #6EE7B7" }}>
      <div className="flex items-center gap-2 mb-3">
        <Timer size={15} className="text-emerald-600" />
        <span className="text-sm font-bold text-emerald-900">Go Live Date</span>
        {!goLiveRecord && (
          <span className="text-xs text-gray-400">(initialize Go Live stage first)</span>
        )}
      </div>
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <label className="text-xs text-emerald-700 font-medium block mb-1">Target Go Live Date</label>
          <input
            type="date"
            value={goLiveDate}
            onChange={(e) => {
              setGoLiveDateLocal(e.target.value);
              if (!frozen) persistGoLive(e.target.value, false);
            }}
            disabled={frozen || !canFreeze || !goLiveRecord}
            className="w-full rounded-lg px-3 py-1.5 text-sm border border-emerald-300 bg-white outline-none disabled:bg-gray-50"
          />
        </div>
        {canFreeze && goLiveDate && !frozen && goLiveRecord && (
          <button
            onClick={() => { setFrozenLocal(true); persistGoLive(goLiveDate, true); }}
            className="px-3 py-1.5 rounded-lg text-sm font-semibold text-white"
            style={{ background: "linear-gradient(135deg,#10B981,#059669)" }}
          >
            Freeze Date
          </button>
        )}
        {canFreeze && frozen && goLiveRecord && (
          <button
            onClick={() => { setFrozenLocal(false); persistGoLive(goLiveDate, false); }}
            className="px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-300 text-gray-600 bg-white"
          >
            Unfreeze
          </button>
        )}
      </div>
      {frozen && daysLeft !== null && (
        <div className="mt-3 flex items-center gap-3">
          <div
            className="flex-1 text-center rounded-xl py-3"
            style={{
              background: daysLeft <= 0 ? "#FEF2F2" : daysLeft <= 7 ? "#FFFBEB" : "#EEF2FF",
            }}
          >
            <p
              className="text-3xl font-black"
              style={{ color: daysLeft <= 0 ? "#EF4444" : daysLeft <= 7 ? "#D97706" : "#4F46E5" }}
            >
              {daysLeft <= 0 ? "LIVE" : daysLeft}
            </p>
            <p className="text-xs font-semibold text-gray-500 mt-0.5">
              {daysLeft <= 0 ? "System is live" : `${daysLeft === 1 ? "day" : "days"} remaining`}
            </p>
          </div>
          <div className="text-xs text-emerald-800 flex-1">
            <p className="font-bold">Date frozen</p>
            <p>{new Date(goLiveDate).toLocaleDateString("en-US", { dateStyle: "long" })}</p>
          </div>
        </div>
      )}
    </div>
  );
}
