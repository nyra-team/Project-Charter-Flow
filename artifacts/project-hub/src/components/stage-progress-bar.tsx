import { LIFECYCLE_STAGES, getStageIndex } from "../lib/lifecycle-config";
import { Check, Eye } from "lucide-react";

interface StageProgressBarProps {
  currentStageKey: string;
  stageRecords: Array<{ stage: string; status: string }>;
  onStageClick?: (stageKey: string) => void;
  selectedStageKey?: string;
  role?: string;
}

// Any role may click any stage to PREVIEW its requirements and progress.
// Role-gated *actions* (submit, advance, sign-off) remain enforced inside each stage panel.
export function StageProgressBar({ currentStageKey, stageRecords, onStageClick, selectedStageKey }: StageProgressBarProps) {
  const currentIdx = getStageIndex(currentStageKey);

  function getStageStatus(key: string, idx: number): "complete" | "active" | "upcoming" {
    const record = stageRecords.find(r => r.stage === key);
    if (record?.status === "complete") return "complete";
    if (record?.status === "in_progress") return "active";
    if (idx < currentIdx) return "complete";
    if (idx === currentIdx) return "active";
    return "upcoming";
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

            const dotClass =
              status === "complete" ? "bg-success text-primary-foreground border-success"
              : status === "active" ? "bg-primary text-primary-foreground border-primary"
              : "bg-muted text-muted-foreground border-border hover:border-primary/40 hover:text-primary";

            const labelClass =
              status === "complete" ? "text-success"
              : status === "active" ? "text-primary"
              : "text-muted-foreground/80 group-hover:text-primary";

            const connectorClass = status === "complete" ? "bg-success" : "bg-border";

            return (
              <div key={stage.key} className="flex items-center">
                <div className="flex flex-col items-center gap-1.5">
                  <button
                    onClick={() => onStageClick?.(stage.key)}
                    title={status === "upcoming" ? `${stage.label} · preview (not yet reached)` : stage.label}
                    className="flex flex-col items-center gap-1 transition-all group cursor-pointer"
                  >
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-semibold font-mono flex-shrink-0 transition-all border ${dotClass} ${
                        isSelected || status === "active" ? "ring-2 ring-primary/30 ring-offset-1 ring-offset-card" : ""
                      } ${isSelected ? "scale-110" : ""}`}
                    >
                      {status === "complete" ? (
                        <Check size={13} />
                      ) : isSelected && status === "upcoming" ? (
                        <Eye size={11} />
                      ) : (
                        <span>{idx + 1}</span>
                      )}
                    </div>
                    <span
                      className={`text-[11px] text-center leading-tight transition-colors ${labelClass} ${
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
            Upcoming
          </span>
          <span className="hidden sm:inline text-muted-foreground/70 italic">Click any stage to preview</span>
        </div>
      </div>
    </div>
  );
}
