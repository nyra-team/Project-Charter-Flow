import { useState, useEffect } from "react";
import { useListProjectStages, useUpdateProjectStage } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2 } from "lucide-react";

interface Criterion {
  id: string;
  label: string;
  weight: number;
}

const CRITERIA: Criterion[] = [
  { id: "functional", label: "Functional Fit to URS", weight: 40 },
  { id: "technical", label: "Technical Architecture", weight: 20 },
  { id: "commercial", label: "Commercial Competitiveness", weight: 25 },
  { id: "track_record", label: "Vendor Track Record", weight: 15 },
];

type ScoreMap = Record<string, number>;

function weightedScore(scores: ScoreMap): number {
  return Math.round(
    CRITERIA.reduce((sum, c) => sum + (scores[c.id] ?? 0) * (c.weight / 100), 0),
  );
}

export function VendorEvalScorecard({ projectId }: { projectId: number }) {
  const { data: stages = [] } = useListProjectStages(projectId);
  const updateStage = useUpdateProjectStage();
  const { toast } = useToast();

  const evalRecord = (
    stages as Array<{ id: number; stage: string; notes?: string | null }>
  ).find((s) => s.stage === "vendor_evaluation");

  const parsedNotes: Record<string, unknown> = (() => {
    try { return JSON.parse(evalRecord?.notes ?? "{}"); }
    catch { return {}; }
  })();

  const savedScores = (parsedNotes.__vendor_scores as ScoreMap | undefined) ?? {};
  const savedVendor = (parsedNotes.__vendor_name as string | undefined) ?? "";
  const savedAt = parsedNotes.__vendor_scored_at as string | undefined;

  const [vendorName, setVendorName] = useState(savedVendor);
  const [scores, setScores] = useState<ScoreMap>(savedScores);

  useEffect(() => {
    if (evalRecord?.notes) {
      try {
        const p = JSON.parse(evalRecord.notes) as Record<string, unknown>;
        if (p.__vendor_name) setVendorName(p.__vendor_name as string);
        if (p.__vendor_scores) setScores(p.__vendor_scores as ScoreMap);
      } catch {}
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evalRecord?.id]);

  const totalWeighted = weightedScore(scores);
  const allScored = CRITERIA.every((c) => scores[c.id] !== undefined);
  const qualified = allScored && totalWeighted >= 60;

  function saveScorecard() {
    if (!evalRecord?.id) {
      toast({ title: "Initialise the Vendor Evaluation stage first", variant: "destructive" });
      return;
    }
    const now = new Date().toISOString();
    updateStage.mutate(
      {
        id: evalRecord.id,
        data: {
          notes: JSON.stringify({
            ...parsedNotes,
            __vendor_name: vendorName,
            __vendor_scores: scores,
            __vendor_scored_at: now,
          }),
        },
      },
      {
        onSuccess: () => toast({ title: "Vendor scorecard saved" }),
        onError: () => toast({ title: "Failed to save scorecard", variant: "destructive" }),
      },
    );
  }

  function setScore(criterionId: string, value: number) {
    setScores((prev) => ({ ...prev, [criterionId]: Math.min(100, Math.max(0, value)) }));
  }

  return (
    <div
      className="rounded-2xl p-4 space-y-4"
      style={{ background: "linear-gradient(135deg,#FFF7ED,#FFEDD5)" }}
    >
      <div>
        <p className="text-sm font-bold text-orange-900">Vendor Evaluation Scorecard</p>
        <p className="text-xs text-orange-700 mt-0.5">
          Score each criterion 0–100. Minimum qualifying weighted score: 60%.
          Weights: Functional 40% · Technical 20% · Commercial 25% · Track Record 15%.
        </p>
      </div>

      <div>
        <label className="text-xs font-semibold text-orange-800 block mb-1">Vendor / Solution Name</label>
        <input
          value={vendorName}
          onChange={(e) => setVendorName(e.target.value)}
          placeholder="e.g. Acme ERP Solution"
          className="w-full text-sm border border-orange-200 rounded-lg px-3 py-1.5 bg-white outline-none focus:ring-1 focus:ring-orange-400"
        />
      </div>

      <div className="space-y-3">
        {CRITERIA.map((c) => (
          <div key={c.id}>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-semibold text-gray-700">
                {c.label}
                <span className="ml-1 text-gray-400 font-normal">({c.weight}%)</span>
              </label>
              <span
                className="text-xs font-bold px-2 py-0.5 rounded-full"
                style={{
                  background:
                    (scores[c.id] ?? 0) >= 70
                      ? "#ECFDF5"
                      : (scores[c.id] ?? 0) >= 50
                        ? "#FFFBEB"
                        : "#FEF2F2",
                  color:
                    (scores[c.id] ?? 0) >= 70
                      ? "#065F46"
                      : (scores[c.id] ?? 0) >= 50
                        ? "#92400E"
                        : "#991B1B",
                }}
              >
                {scores[c.id] !== undefined ? `${scores[c.id]}/100` : "—"}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={scores[c.id] ?? 0}
              onChange={(e) => setScore(c.id, Number(e.target.value))}
              className="w-full h-2 rounded-full appearance-none cursor-pointer"
              style={{ accentColor: "#F97316" }}
            />
          </div>
        ))}
      </div>

      {allScored && (
        <div
          className="rounded-xl p-3 text-center"
          style={{
            background: qualified ? "#ECFDF5" : "#FEF2F2",
            border: `1px solid ${qualified ? "#A7F3D0" : "#FECACA"}`,
          }}
        >
          <p
            className="text-2xl font-black"
            style={{ color: qualified ? "#059669" : "#DC2626" }}
          >
            {totalWeighted}%
          </p>
          <p
            className="text-xs font-semibold mt-0.5"
            style={{ color: qualified ? "#065F46" : "#991B1B" }}
          >
            {qualified ? "✓ Qualifying score — vendor recommended" : "Below 60% threshold — not recommended"}
          </p>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={saveScorecard}
          disabled={!vendorName.trim() || !allScored || updateStage.isPending}
          className="flex-1 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40"
          style={{ background: "linear-gradient(135deg,#F97316,#EA580C)" }}
        >
          Save Scorecard
        </button>
        {savedAt && (
          <span className="text-xs text-orange-700 flex items-center gap-1">
            <CheckCircle2 size={11} />
            Saved {new Date(savedAt).toLocaleDateString()}
          </span>
        )}
      </div>
    </div>
  );
}
