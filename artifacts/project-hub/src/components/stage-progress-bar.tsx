import {
  LIFECYCLE_STAGES,
  LIFECYCLE_PHASES,
  getStageIndex,
  getPhaseForStage,
  getPhaseIndex,
} from "../lib/lifecycle-config";
import { STAGE_ICONS } from "./lifecycle-stepper";
import {
  Check,
  FileSearch,
  ShoppingCart,
  Hammer,
  Rocket,
  Flag,
  FileText,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface StageProgressBarProps {
  currentStageKey: string;
  stageRecords: Array<{ stage: string; status: string }>;
  onStageClick?: (stageKey: string) => void;
  selectedStageKey?: string;
  role?: string;
}

const PHASE_ICONS: Record<string, LucideIcon> = {
  initiate: FileSearch,
  procure: ShoppingCart,
  execute: Hammer,
  deliver: Rocket,
  close: Flag,
};

type StageStatus = "complete" | "active" | "upcoming";

export function StageProgressBar({
  currentStageKey,
  stageRecords,
  onStageClick,
  selectedStageKey,
}: StageProgressBarProps) {
  const currentIdx = getStageIndex(currentStageKey);
  const currentStage = LIFECYCLE_STAGES[currentIdx];
  const currentPhase = getPhaseForStage(currentStageKey);
  const selectedPhase = selectedStageKey ? getPhaseForStage(selectedStageKey) : null;
  // Always show sub-stages of the user's selected phase (or the active phase if none selected)
  const visiblePhase = selectedPhase ?? currentPhase ?? LIFECYCLE_PHASES[0];
  const visiblePhaseIdx = getPhaseIndex(visiblePhase.key);
  const currentPhaseIdx = currentPhase ? getPhaseIndex(currentPhase.key) : 0;

  function stageStatus(stageKey: string): StageStatus {
    const rec = stageRecords.find((r) => r.stage === stageKey);
    if (rec?.status === "complete") return "complete";
    if (rec?.status === "in_progress") return "active";
    const idx = getStageIndex(stageKey);
    if (idx < currentIdx) return "complete";
    if (idx === currentIdx) return "active";
    return "upcoming";
  }

  function phaseStats(phaseKey: string) {
    const phase = LIFECYCLE_PHASES.find((p) => p.key === phaseKey)!;
    const total = phase.stageKeys.length;
    const done = phase.stageKeys.filter((s) => stageStatus(s) === "complete").length;
    const active = phase.stageKeys.some((s) => stageStatus(s) === "active");
    return { total, done, active, allDone: done === total };
  }

  return (
    <div className="glass-surface lift-card rounded-2xl p-5 ph-rise relative overflow-hidden">
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent"
      />

      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <span className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-wider">
          Project Lifecycle
        </span>
        <div className="flex items-center gap-3 text-[11px] font-mono font-semibold text-primary">
          <span>
            Phase {currentPhaseIdx + 1} of {LIFECYCLE_PHASES.length}
          </span>
          <span className="text-muted-foreground/70">·</span>
          <span className="text-muted-foreground">
            Stage {currentIdx + 1}/{LIFECYCLE_STAGES.length}
          </span>
        </div>
      </div>

      {/* ROW 1 — Phase pills */}
      <div className="grid grid-cols-5 gap-2">
        {LIFECYCLE_PHASES.map((phase, idx) => {
          const { total, done, active, allDone } = phaseStats(phase.key);
          const isSelected = visiblePhase.key === phase.key;
          const Icon = PHASE_ICONS[phase.key] ?? FileText;
          const status: StageStatus = allDone ? "complete" : active || idx === currentPhaseIdx ? "active" : idx < currentPhaseIdx ? "complete" : "upcoming";

          const pillClass =
            status === "complete"
              ? "bg-success/15 border-success/40 text-success"
              : status === "active"
                ? "bg-primary/15 border-primary/50 text-primary shadow-[0_2px_12px_-2px_hsl(var(--primary)/0.35)]"
                : "bg-card border-border text-muted-foreground hover:border-primary/40 hover:text-primary";

          return (
            <button
              key={phase.key}
              type="button"
              onClick={() => onStageClick?.(phase.stageKeys[0])}
              className={`relative flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 transition-all text-left focus:outline-none focus:ring-2 focus:ring-primary/40 ${pillClass} ${
                isSelected ? "ring-2 ring-primary/40 ring-offset-2 ring-offset-card" : ""
              }`}
              title={phase.description}
            >
              <span
                className={`flex items-center justify-center w-8 h-8 rounded-lg border ${
                  status === "complete"
                    ? "bg-success text-primary-foreground border-success"
                    : status === "active"
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted/40 border-border text-muted-foreground"
                }`}
              >
                {status === "complete" ? <Check size={16} strokeWidth={3} /> : <Icon size={16} strokeWidth={2.2} />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground/70 leading-none mb-0.5">
                  Phase {idx + 1}
                </p>
                <p className="text-sm font-semibold leading-tight truncate">{phase.label}</p>
                <p className="text-[10px] font-mono leading-none mt-0.5 opacity-80">
                  {done}/{total}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {/* ROW 2 — Sub-stage dots for the visible phase */}
      <div className="mt-4 pt-3 border-t border-border/60">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <span className="text-[10px] font-mono uppercase tracking-wider font-semibold text-muted-foreground">
            {visiblePhase.label} — sub-stages
          </span>
          <span className="text-[10px] text-muted-foreground/70">
            {visiblePhase.description}
          </span>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {visiblePhase.stageKeys.map((stageKey) => {
            const stage = LIFECYCLE_STAGES.find((s) => s.key === stageKey)!;
            const status = stageStatus(stageKey);
            const isSelected = selectedStageKey === stageKey;
            const Icon = STAGE_ICONS[stageKey] ?? FileText;
            const globalIdx = getStageIndex(stageKey);

            const dotClass =
              status === "complete"
                ? "bg-success text-primary-foreground border-success"
                : status === "active"
                  ? "bg-primary text-primary-foreground border-primary lifecycle-pulse"
                  : "bg-card text-muted-foreground border-border hover:border-primary/50 hover:text-primary";

            return (
              <button
                key={stageKey}
                type="button"
                onClick={() => onStageClick?.(stageKey)}
                title={stage.label}
                className={`group flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full border transition-all focus:outline-none focus:ring-2 focus:ring-primary/40 ${
                  isSelected ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                }`}
              >
                <span
                  className={`flex items-center justify-center w-6 h-6 rounded-full border ${dotClass}`}
                >
                  {status === "complete" ? <Check size={11} strokeWidth={3.2} /> : <Icon size={11} strokeWidth={2.4} />}
                </span>
                <span
                  className={`text-[11px] font-medium leading-none ${
                    status === "complete"
                      ? "text-success"
                      : status === "active"
                        ? "text-primary font-semibold"
                        : "text-muted-foreground group-hover:text-foreground"
                  }`}
                >
                  {stage.shortLabel}
                </span>
                <span className="text-[9px] font-mono text-muted-foreground/50 leading-none">
                  {String(globalIdx + 1).padStart(2, "0")}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Legend / current stage */}
      <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between flex-wrap gap-2">
        <div>
          <span className="text-[11px] text-muted-foreground">Current stage: </span>
          <span className="text-[11px] font-semibold text-primary">
            {currentStage?.label ?? currentStageKey}
          </span>
          {currentPhase && (
            <span className="text-[11px] text-muted-foreground/70 ml-1">
              · in {currentPhase.label}
            </span>
          )}
          {visiblePhaseIdx !== currentPhaseIdx && (
            <span className="text-[11px] text-muted-foreground/70 italic ml-2">
              (previewing {visiblePhase.label})
            </span>
          )}
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
        </div>
      </div>
    </div>
  );
}
