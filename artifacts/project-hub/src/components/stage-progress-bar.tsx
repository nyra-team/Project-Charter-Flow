import { LIFECYCLE_STAGES, getStageIndex } from "../lib/lifecycle-config";
import { LifecycleStepper } from "./lifecycle-stepper";

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

  return (
    <div className="glass-surface lift-card rounded-2xl p-5 ph-rise relative overflow-hidden">
      <span aria-hidden className="pointer-events-none absolute bottom-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
      <div className="flex items-center justify-between mb-4">
        <span className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-wider">Project Lifecycle</span>
        <span className="text-[11px] font-mono font-semibold text-primary">
          Stage {currentIdx + 1} of {LIFECYCLE_STAGES.length}
        </span>
      </div>

      <LifecycleStepper
        currentStageKey={currentStageKey}
        stageRecords={stageRecords}
        selectedStageKey={selectedStageKey}
        onStageClick={onStageClick}
      />

      {/* Current stage label bar */}
      <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between flex-wrap gap-2">
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
            <span className="w-2 h-2 rounded-full inline-block bg-primary lifecycle-pulse" />
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
