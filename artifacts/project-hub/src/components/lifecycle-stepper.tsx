import { LIFECYCLE_STAGES, getStageIndex } from "../lib/lifecycle-config";
import {
  Check, FileSearch, ClipboardList, FileText, Scale, ScrollText,
  ShieldCheck, Gavel, Receipt, Rocket, Compass, Code2, Workflow,
  TestTube, Zap, ClipboardCheck, Flag,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export const STAGE_ICONS: Record<string, LucideIcon> = {
  project_case:        FileSearch,
  urs:                 ClipboardList,
  rfp:                 FileText,
  vendor_evaluation:   Scale,
  charter:             ScrollText,
  nfa:                 ShieldCheck,
  legal:               Gavel,
  pr_po:               Receipt,
  kickoff:             Rocket,
  technical_design:    Compass,
  development:         Code2,
  implementation_plan: Workflow,
  uat:                 TestTube,
  go_live:             Zap,
  closure_readiness:   ClipboardCheck,
  project_closure:     Flag,
};

export type StageStatus = "complete" | "active" | "upcoming";

export interface StageRecord { stage: string; status: string }

interface LifecycleStepperProps {
  currentStageKey: string;
  stageRecords?: StageRecord[];
  selectedStageKey?: string;
  onStageClick?: (stageKey: string) => void;
  /** Optional count badge per stage (used on dashboard) */
  counts?: Record<string, number>;
  /** Compact = smaller circles for dashboard usage */
  size?: "default" | "compact";
}

export function LifecycleStepper({
  currentStageKey,
  stageRecords = [],
  selectedStageKey,
  onStageClick,
  counts,
  size = "default",
}: LifecycleStepperProps) {
  const currentIdx = getStageIndex(currentStageKey);

  function statusOf(key: string, idx: number): StageStatus {
    const rec = stageRecords.find(r => r.stage === key);
    if (rec?.status === "complete") return "complete";
    if (rec?.status === "in_progress") return "active";
    if (idx < currentIdx) return "complete";
    if (idx === currentIdx) return "active";
    return "upcoming";
  }

  // Continuous progress line: % filled = (currentIdx) / (total-1)
  const progressPct = LIFECYCLE_STAGES.length > 1
    ? (currentIdx / (LIFECYCLE_STAGES.length - 1)) * 100
    : 0;

  const circleSize = size === "compact" ? 36 : 44;
  const iconSize   = size === "compact" ? 14 : 17;

  return (
    <div className="w-full overflow-x-auto scrollbar-thin">
      <div className="relative w-full min-w-[760px]">
        {/* Connector track (full width behind the circles) */}
        <div
          className="absolute left-0 right-0 h-[3px] bg-border/60 rounded-full"
          style={{ top: circleSize / 2 - 1.5 }}
        />
        <div
          className="absolute left-0 h-[3px] rounded-full transition-[width] duration-700 ease-out"
          style={{
            top: circleSize / 2 - 1.5,
            width: `${progressPct}%`,
            background: "linear-gradient(90deg, hsl(var(--success)) 0%, hsl(var(--success)) 60%, hsl(var(--primary)) 100%)",
          }}
        />

        {/* Stage circles spread evenly */}
        <div className="relative flex items-start justify-between w-full">
          {LIFECYCLE_STAGES.map((stage, idx) => {
            const status = statusOf(stage.key, idx);
            const isSelected = selectedStageKey === stage.key;
            const Icon = STAGE_ICONS[stage.key] ?? FileText;
            const count = counts?.[stage.key];

            const dotClass =
              status === "complete"
                ? "bg-success text-primary-foreground border-success shadow-[0_2px_8px_-2px_rgba(34,197,94,0.5)]"
              : status === "active"
                ? "bg-primary text-primary-foreground border-primary shadow-[0_2px_12px_-2px_hsl(var(--primary)/0.6)] lifecycle-pulse"
              : "bg-card text-muted-foreground border-border hover:border-primary/50 hover:text-primary";

            const labelClass =
              status === "complete" ? "text-success"
              : status === "active" ? "text-primary"
              : "text-muted-foreground/80 group-hover:text-primary";

            return (
              <button
                key={stage.key}
                type="button"
                onClick={() => onStageClick?.(stage.key)}
                title={`${stage.label}${count != null ? ` · ${count} project${count === 1 ? "" : "s"}` : ""}`}
                className="group relative flex flex-col items-center gap-1.5 flex-1 min-w-0 cursor-pointer focus:outline-none"
              >
                <div className="relative flex items-center justify-center">
                  <span
                    className={`flex items-center justify-center rounded-full border-2 transition-all duration-200 ${dotClass} ${
                      isSelected ? "ring-2 ring-primary/40 ring-offset-2 ring-offset-card scale-110" : ""
                    }`}
                    style={{ width: circleSize, height: circleSize }}
                  >
                    {status === "complete"
                      ? <Check size={iconSize + 1} strokeWidth={3} />
                      : <Icon size={iconSize} strokeWidth={2.2} />}
                  </span>
                  {count != null && count > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-amber-accent text-[10px] font-mono font-bold text-background flex items-center justify-center border-2 border-card">
                      {count}
                    </span>
                  )}
                </div>
                <span
                  className={`text-[10px] text-center leading-tight font-medium tracking-tight transition-colors ${labelClass} ${
                    status === "active" || isSelected ? "font-semibold" : ""
                  }`}
                  style={{ maxWidth: 72 }}
                >
                  {stage.shortLabel}
                </span>
                <span className="text-[9px] font-mono text-muted-foreground/60 leading-none">
                  {String(idx + 1).padStart(2, "0")}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
