import { LIFECYCLE_STAGES, getStageIndex } from "../lib/lifecycle-config";
import { Check, Lock } from "lucide-react";

// PMO and admin roles may navigate to any stage (including future) for oversight.
const PMO_ACCESS_ROLES = ["pmo", "executive_director", "chairman"];

interface StageProgressBarProps {
  currentStageKey: string;
  stageRecords: Array<{ stage: string; status: string }>;
  onStageClick?: (stageKey: string) => void;
  selectedStageKey?: string;
  role?: string;
}

export function StageProgressBar({ currentStageKey, stageRecords, onStageClick, selectedStageKey, role }: StageProgressBarProps) {
  const currentIdx = getStageIndex(currentStageKey);
  const hasPmoAccess = role ? PMO_ACCESS_ROLES.includes(role) : false;

  function getStageStatus(key: string, idx: number): "complete" | "active" | "locked" | "available" {
    const record = stageRecords.find(r => r.stage === key);
    if (record?.status === "complete") return "complete";
    if (record?.status === "in_progress") return "active";
    if (idx < currentIdx) return "complete";
    if (idx === currentIdx) return "active";
    // PMO/admin may inspect future stages for oversight purposes
    if (hasPmoAccess) return "available";
    return "locked";
  }

  return (
    <div
      className="rounded-2xl p-4"
      style={{ background: "white", border: "1px solid #E2E8F0" }}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Project Lifecycle</span>
        <span className="text-xs font-semibold text-indigo-600">
          Stage {currentIdx + 1} of {LIFECYCLE_STAGES.length}
        </span>
      </div>

      {/* Desktop: horizontal scrollable stepper */}
      <div className="overflow-x-auto pb-1">
        <div className="flex items-start gap-0 min-w-max">
          {LIFECYCLE_STAGES.map((stage, idx) => {
            const status = getStageStatus(stage.key, idx);
            const isSelected = selectedStageKey === stage.key;
            // "available" = PMO/admin oversight access to future stages
            const isClickable = status === "complete" || status === "active" || status === "available";

            const bgColor = status === "complete"
              ? "#10B981"
              : status === "active"
                ? stage.color
                : status === "available"
                  ? "#F1F5F9"
                  : "#E2E8F0";

            const textColor = status === "complete" || status === "active" ? "white"
              : status === "available" ? "#6366F1" : "#94A3B8";
            const labelColor = status === "complete"
              ? "#10B981"
              : status === "active"
                ? stage.color
                : status === "available" ? "#6366F1" : "#CBD5E1";

            return (
              <div key={stage.key} className="flex items-center">
                <div className="flex flex-col items-center gap-1.5">
                  <button
                    onClick={() => isClickable && onStageClick?.(stage.key)}
                    disabled={!isClickable}
                    title={status === "available" ? `${stage.label} (PMO oversight view)` : stage.label}
                    className="flex flex-col items-center gap-1 transition-all group"
                  >
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 transition-all"
                      style={{
                        background: bgColor,
                        color: textColor,
                        boxShadow: (isSelected || status === "active") ? `0 0 0 3px ${stage.color}33, 0 0 0 1px ${stage.color}` : "none",
                        transform: isSelected ? "scale(1.15)" : "scale(1)",
                      }}
                    >
                      {status === "complete" ? (
                        <Check size={13} />
                      ) : status === "locked" ? (
                        <Lock size={10} />
                      ) : (
                        <span className="text-xs font-bold">{idx + 1}</span>
                      )}
                    </div>
                    <span
                      className="text-xs font-medium text-center leading-tight"
                      style={{
                        color: labelColor,
                        fontWeight: status === "active" || isSelected ? 700 : 500,
                        maxWidth: 56,
                      }}
                    >
                      {stage.shortLabel}
                    </span>
                  </button>
                </div>
                {idx < LIFECYCLE_STAGES.length - 1 && (
                  <div
                    className="h-0.5 transition-all"
                    style={{
                      width: 20,
                      background: status === "complete" ? "#10B981" : "#E2E8F0",
                      marginTop: -16,
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Current stage label bar */}
      <div
        className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between"
      >
        <div>
          <span className="text-xs text-gray-400">Current stage: </span>
          <span className="text-xs font-bold" style={{ color: LIFECYCLE_STAGES[currentIdx]?.color ?? "#6366F1" }}>
            {LIFECYCLE_STAGES[currentIdx]?.label ?? currentStageKey}
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs text-gray-400">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full inline-block" style={{ background: "#10B981" }} />
            Complete
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full inline-block" style={{ background: "#6366F1" }} />
            Active
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full inline-block" style={{ background: "#E2E8F0" }} />
            Pending
          </span>
        </div>
      </div>
    </div>
  );
}
