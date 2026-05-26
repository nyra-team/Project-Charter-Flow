import { useState } from "react";
import {
  LIFECYCLE_STAGES,
  getStageIndex,
} from "../lib/lifecycle-config";
import {
  LIFECYCLE_PHASES,
  getPhaseForStage,
  getPhaseIndex,
  type LifecyclePhase,
} from "../lib/lifecycle-phases";
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

// ---------------------------------------------------------------------------
// ProjectLifecycleCard
// ONE component used by:
//   - project-detail (per-project — shows 5 phase pills + the ACTIVE/SELECTED
//     phase's sub-stage dots underneath, visually connected by a continuous
//     progress line)
//   - dashboard       (org-wide — full 16-stage funnel with per-stage counts;
//     opt in via showAllSubStages)
// ---------------------------------------------------------------------------

const PHASE_ICONS: Record<string, LucideIcon> = {
  initiate: FileSearch,
  procure: ShoppingCart,
  execute: Hammer,
  deliver: Rocket,
  close: Flag,
};

type StageStatus = "complete" | "active" | "upcoming";

export interface ProjectLifecycleCardProps {
  currentStageKey: string;
  stageRecords?: Array<{ stage: string; status: string }>;
  selectedStageKey?: string;
  onStageClick?: (stageKey: string) => void;
  /** Optional per-stage badge (e.g. project counts on the dashboard). */
  counts?: Record<string, number>;
  /** Compact = smaller padding & dots, no description footer. */
  variant?: "full" | "compact";
  /** Hide the header row with "Project Lifecycle" + counters. */
  hideHeader?: boolean;
  /** Hide the legend footer (Complete / Active / Upcoming). */
  hideLegend?: boolean;
  /** Override the default "Project Lifecycle" header label. */
  title?: string;
  /** Optional secondary text in the header (right side). */
  subtitle?: string;
  /** Dashboard mode: show all 16 sub-stages grouped under their phases.
   *  Default (false) only shows the active/selected phase's sub-stages. */
  showAllSubStages?: boolean;
}

export function ProjectLifecycleCard({
  currentStageKey,
  stageRecords = [],
  selectedStageKey,
  onStageClick,
  counts,
  variant = "full",
  hideHeader = false,
  hideLegend = false,
  title = "Project Lifecycle",
  subtitle,
  showAllSubStages = false,
}: ProjectLifecycleCardProps) {
  const compact = variant === "compact";
  const currentIdx = getStageIndex(currentStageKey);
  const currentStage = LIFECYCLE_STAGES[currentIdx];
  const currentPhase = getPhaseForStage(currentStageKey);
  const currentPhaseIdx = currentPhase ? getPhaseIndex(currentPhase.key) : 0;

  // Which phase to expand below (only matters when !showAllSubStages).
  const selectedPhase =
    (selectedStageKey ? getPhaseForStage(selectedStageKey) : null) ?? currentPhase ?? LIFECYCLE_PHASES[0];
  const [pinnedPhaseKey, setPinnedPhaseKey] = useState<string | null>(null);
  const visiblePhase: LifecyclePhase =
    LIFECYCLE_PHASES.find((p) => p.key === pinnedPhaseKey) ?? selectedPhase;
  const visiblePhaseIdx = getPhaseIndex(visiblePhase.key);

  function stageStatus(stageKey: string): StageStatus {
    const rec = stageRecords.find((r) => r.stage === stageKey);
    if (rec?.status === "complete") return "complete";
    if (rec?.status === "in_progress") return "active";
    const idx = getStageIndex(stageKey);
    if (idx < currentIdx) return "complete";
    if (idx === currentIdx) return "active";
    return "upcoming";
  }

  function phaseStats(phaseIdx: number) {
    const phase = LIFECYCLE_PHASES[phaseIdx];
    const total = phase.stageKeys.length;
    const done = phase.stageKeys.filter((s) => stageStatus(s) === "complete").length;
    const hasActive = phase.stageKeys.some((s) => stageStatus(s) === "active");
    const allDone = done === total;
    const status: StageStatus = allDone
      ? "complete"
      : hasActive || phaseIdx === currentPhaseIdx
        ? "active"
        : phaseIdx < currentPhaseIdx
          ? "complete"
          : "upcoming";
    return { total, done, status };
  }

  const dotSize = compact ? 26 : 32;
  const dotIcon = compact ? 11 : 13;

  return (
    <div
      className={`glass-surface lift-card rounded-2xl ph-rise relative overflow-hidden ${
        compact ? "p-4" : "p-5"
      }`}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent"
      />

      {!hideHeader && (
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <span className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-wider">
            {title}
          </span>
          <div className="flex items-center gap-3 text-[11px] font-mono">
            {subtitle ? (
              <span className="text-muted-foreground">{subtitle}</span>
            ) : (
              <>
                <span className="font-semibold text-primary">
                  Phase {currentPhaseIdx + 1} of {LIFECYCLE_PHASES.length}
                </span>
                <span className="text-muted-foreground/70">·</span>
                <span className="text-muted-foreground">
                  Stage {currentIdx + 1}/{LIFECYCLE_STAGES.length}
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {/* === PHASE PILLS ROW =================================================
          Each pill's flex weight matches its sub-stage count, so the pill
          sits directly above its child dots (in showAllSubStages mode) or so
          the active pill spans a meaningful slice. */}
      <div className="relative">
        <div className="flex items-stretch gap-3">
          {LIFECYCLE_PHASES.map((phase, idx) => {
            const { total, done, status } = phaseStats(idx);
            const isVisible = idx === visiblePhaseIdx;
            const Icon = PHASE_ICONS[phase.key] ?? FileText;

            const tone =
              status === "complete"
                ? "border-success/40 bg-success/10 text-success"
                : status === "active"
                  ? "border-primary/50 bg-primary/15 text-primary"
                  : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-primary";

            const iconTone =
              status === "complete"
                ? "bg-success text-primary-foreground border-success"
                : status === "active"
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted/40 border-border text-muted-foreground";

            return (
              <button
                key={phase.key}
                type="button"
                onClick={() => {
                  if (showAllSubStages) {
                    onStageClick?.(phase.stageKeys[0]);
                  } else {
                    setPinnedPhaseKey(phase.key);
                  }
                }}
                className={`relative flex-1 flex items-center gap-2 px-2.5 py-2 rounded-xl border transition-all text-left focus:outline-none focus:ring-2 focus:ring-primary/40 ${tone} ${
                  isVisible && !showAllSubStages ? "ring-2 ring-primary/30 ring-offset-1 ring-offset-card" : ""
                }`}
                title={`${phase.label} — ${phase.description}`}
              >
                <span
                  className={`flex items-center justify-center rounded-md border flex-shrink-0 ${iconTone}`}
                  style={{ width: compact ? 22 : 28, height: compact ? 22 : 28 }}
                >
                  {status === "complete" ? (
                    <Check size={compact ? 11 : 14} strokeWidth={3} />
                  ) : (
                    <Icon size={compact ? 11 : 14} strokeWidth={2.2} />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground/70 leading-none mb-0.5">
                    Phase {idx + 1}
                  </p>
                  <p
                    className={`${compact ? "text-[11px]" : "text-xs"} font-semibold leading-tight truncate`}
                  >
                    {phase.label}
                  </p>
                  <p className="text-[9px] font-mono leading-none mt-0.5 opacity-80">
                    {done}/{total}
                  </p>
                </div>
              </button>
            );
          })}
        </div>

      </div>

      {/* === SUB-STAGE ROW ===================================================
          Default: shows ONLY the active/selected phase's sub-stages, in a
          panel that visually attaches to the pill above via the notch.
          Dashboard mode (showAllSubStages): renders all 16 dots, grouped
          under each phase using the same flex weights. */}
      {showAllSubStages ? (
        <div className="relative mt-3">
          <div className="flex items-stretch gap-3">
            {LIFECYCLE_PHASES.map((phase) => (
              <div
                key={phase.key}
                style={{ flex: phase.stageKeys.length, borderColor: `${phase.color}40` }}
                className="flex items-start justify-around rounded-xl border px-1 pt-2 pb-2 bg-muted/20"
              >
                {phase.stageKeys.map((stageKey) =>
                  renderStageDot(stageKey),
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div
          className="relative mt-3 rounded-2xl border px-4 pt-4 pb-3 bg-muted/15"
          style={{ borderColor: `${visiblePhase.color}55` }}
        >
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              {visiblePhase.label} · {visiblePhase.stageKeys.length} stage
              {visiblePhase.stageKeys.length === 1 ? "" : "s"}
            </p>
            <p className="text-[10px] text-muted-foreground/80 italic truncate ml-3">
              {visiblePhase.description}
            </p>
          </div>
          {/* Connector line behind the dots */}
          <div className="relative">
            {visiblePhase.stageKeys.length > 1 && (() => {
              const total = visiblePhase.stageKeys.length;
              // Highest dot index that is complete or currently active —
              // the connector fills from the first dot up to this one.
              let lastReached = -1;
              for (let i = 0; i < total; i++) {
                const s = stageStatus(visiblePhase.stageKeys[i]);
                if (s === "complete" || s === "active") lastReached = i;
              }
              const trackPct = ((total - 1) / total) * 100; // dot-1 centre → last-dot centre
              const fillPct =
                lastReached <= 0 ? 0 : (lastReached / (total - 1)) * trackPct;
              const offsetPct = (1 / total) * 50; // half a slot from the left
              return (
                <>
                  <div
                    className="absolute h-[3px] bg-border/70 rounded-full"
                    style={{
                      top: dotSize / 2 - 1,
                      left: `${offsetPct}%`,
                      right: `${offsetPct}%`,
                    }}
                  />
                  <div
                    className="absolute h-[3px] rounded-full transition-[width] duration-700 ease-out"
                    style={{
                      top: dotSize / 2 - 1,
                      left: `${offsetPct}%`,
                      width: `${fillPct}%`,
                      background:
                        "linear-gradient(90deg, hsl(var(--success)) 0%, hsl(var(--success)) 65%, hsl(var(--primary)) 100%)",
                    }}
                  />
                </>
              );
            })()}
            <div className="relative flex items-start justify-around gap-2">
              {visiblePhase.stageKeys.map((stageKey) => renderStageDot(stageKey))}
            </div>
          </div>
        </div>
      )}

      {/* FOOTER */}
      {!hideLegend && (
        <div className="mt-3 pt-3 border-t border-border/60 flex items-center justify-between flex-wrap gap-2">
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
      )}
    </div>
  );

  function renderStageDot(stageKey: string) {
    const stage = LIFECYCLE_STAGES.find((s) => s.key === stageKey)!;
    const status = stageStatus(stageKey);
    const isSelected = selectedStageKey === stageKey;
    const Icon = STAGE_ICONS[stageKey] ?? FileText;
    const globalIdx = getStageIndex(stageKey);
    const count = counts?.[stageKey];

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
        title={`${stage.label}${count != null ? ` · ${count} project${count === 1 ? "" : "s"}` : ""}`}
        className="group flex flex-col items-center gap-1 min-w-0 cursor-pointer focus:outline-none flex-1"
      >
        <div className="relative">
          <span
            className={`flex items-center justify-center rounded-full border-2 transition-all duration-200 ${dotClass} ${
              isSelected ? "ring-2 ring-primary/40 ring-offset-2 ring-offset-card scale-110" : ""
            }`}
            style={{ width: dotSize, height: dotSize }}
          >
            {status === "complete" ? (
              <Check size={dotIcon} strokeWidth={3} />
            ) : (
              <Icon size={dotIcon} strokeWidth={2.2} />
            )}
          </span>
          {count != null && count > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded-full bg-amber-accent text-[9px] font-mono font-bold text-background flex items-center justify-center border-2 border-card">
              {count}
            </span>
          )}
        </div>
        <span
          className={`text-[9px] text-center leading-tight font-medium tracking-tight transition-colors truncate w-full ${
            status === "complete"
              ? "text-success"
              : status === "active"
                ? "text-primary font-semibold"
                : "text-muted-foreground/80 group-hover:text-primary"
          }`}
        >
          {stage.shortLabel}
        </span>
        <span className="text-[8px] font-mono text-muted-foreground/60 leading-none">
          {String(globalIdx + 1).padStart(2, "0")}
        </span>
      </button>
    );
  }
}
