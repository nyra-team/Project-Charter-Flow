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
    <div className="glass-surface lift-card rounded-2xl p-4 ph-rise relative overflow-hidden">
      <span aria-hidden className="pointer-events-none absolute bottom-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-wider">Project Lifecycle</span>
        <span className="text-[11px] font-mono font-semibold text-primary">
          Stage {currentIdx + 1} of {LIFECYCLE_STAGES.length}
        </span>
      </div>

      {/* Desktop: horizontal scrollable stepper */}
      <div className="overflow-x-auto pb-1 scrollbar-thin">
        <div className="flex items-start gap-0 min-w-max">
          {LIFECYCLE_STAGES.map((stage, idx) => {
            const status = getStageStatus(stage.key, idx);
            const isSelected = selectedStageKey === stage.key;
            const isClickable = status === "complete" || status === "active" || status === "available";

            const dotClass =
              status === "complete"  ? "bg-success text-primary-foreground border-success"
              : status === "active"  ? "bg-primary text-primary-foreground border-primary"
              : status === "available" ? "bg-muted text-primary border-border"
              : "bg-muted/60 text-muted-foreground border-border";

            const labelClass =
              status === "complete"  ? "text-success"
              : status === "active"  ? "text-primary"
              : status === "available" ? "text-primary/70"
              : "text-muted-foreground/70";

            const connectorClass = status === "complete" ? "bg-success" : "bg-border";

            return (
              <div key={stage.key} className="flex items-center">
                <div className="flex flex-col items-center gap-1.5">
                  <button
                    onClick={() => isClickable && onStageClick?.(stage.key)}
                    disabled={!isClickable}
                    title={status === "available" ? `${stage.label} (PMO oversight view)` : stage.label}
                    className="flex flex-col items-center gap-1 transition-all group disabled:cursor-not-allowed"
                  >
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-semibold font-mono flex-shrink-0 transition-all border ${dotClass} ${
                        isSelected || status === "active" ? "ring-2 ring-primary/30 ring-offset-1 ring-offset-card" : ""
                      } ${isSelected ? "scale-110" : ""}`}
                    >
                      {status === "complete" ? (
                        <Check size={13} />
                      ) : status === "locked" ? (
                        <Lock size={10} />
                      ) : (
                        <span>{idx + 1}</span>
                      )}
                    </div>
                    <span
                      className={`text-[11px] text-center leading-tight ${labelClass} ${
                        status === "active" || isSelected ? "font-semibold" : "font-medium"
                      }`}
                      style={{ maxWidth: 56 }}
                    >
                      {stage.shortLabel}
                    </span>
                  </button>
                </div>
                {idx < LIFECYCLE_STAGES.length - 1 && (
                  <div
                    className={`h-0.5 transition-all ${connectorClass}`}
                    style={{ width: 20, marginTop: -16 }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Current stage label bar */}
      <div className="mt-3 pt-3 border-t border-border/60 flex items-center justify-between flex-wrap gap-2">
        <div>
          <span className="text-[11px] text-muted-foreground">Current stage: </span>
          <span className="text-[11px] font-semibold text-primary">
            {LIFECYCLE_STAGES[currentIdx]?.label ?? currentStageKey}
          </span>
        </div>
        <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full inline-block bg-success" />
            Complete
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full inline-block bg-primary" />
            Active
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full inline-block bg-muted border border-border" />
            Pending
          </span>
        </div>
      </div>
    </div>
  );
}
