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
  ClipboardCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

// ---------------------------------------------------------------------------
// ProjectLifecycleCard — the ONE lifecycle visualization for the whole app.
// Renders 4 phase pills + the ACTIVE/SELECTED phase's sub-stage dots underneath,
// connected by a continuous progress line, with an optional per-stage count
// badge. No variants. Used everywhere via two thin data adapters:
//   - project-detail → stage-progress-bar  (single project: real stageRecords)
//   - dashboard + pipeline → lifecycle-overview  (org-wide: frontier + counts)
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
  stageRecords?: Array<{ stage: string; status: string; notes?: string | null }>;
  selectedStageKey?: string;
  onStageClick?: (stageKey: string) => void;
  /** Optional per-stage badge (e.g. project counts on the dashboard). */
  counts?: Record<string, number>;
  /** Org-wide Initiation BC/URS aggregate (counts mode) — shows "BC x/n · URS y/n" under INIT. */
  initiationAggregate?: { inInitiation: number; bcDone: number; ursDone: number };
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
}

export function ProjectLifecycleCard({
  currentStageKey,
  stageRecords = [],
  selectedStageKey,
  onStageClick,
  counts,
  initiationAggregate,
  variant = "full",
  hideHeader = false,
  hideLegend = false,
  title = "Project Lifecycle",
  subtitle,
}: ProjectLifecycleCardProps) {
  const compact = variant === "compact";
  const currentIdx = getStageIndex(currentStageKey);
  const currentStage = LIFECYCLE_STAGES[currentIdx];
  const currentPhase = getPhaseForStage(currentStageKey);
  const currentPhaseIdx = currentPhase ? getPhaseIndex(currentPhase.key) : 0;

  // Which phase to expand below.
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

  // Initiation sub-gate status. BC + URS are two checkpoints inside the single
  // Initiation stage; we compute each one's StageStatus so they render with the
  // SAME dot + connector visual language as every other stage (just two nodes).
  const showInitSub = !counts;
  const initNotes: Record<string, unknown> = (() => {
    try { return JSON.parse(stageRecords.find((r) => r.stage === "initiation")?.notes ?? "{}"); } catch { return {}; }
  })();
  const initStageSt = stageStatus("initiation");
  const initTotal = initiationAggregate?.inInitiation ?? 0;
  const subGateStatus = (singleDone: boolean, aggDone: number): StageStatus => {
    const done = counts ? initStageSt === "complete" || (initTotal > 0 && aggDone >= initTotal) : initStageSt === "complete" || singleDone;
    return done ? "complete" : initStageSt === "upcoming" ? "upcoming" : "active";
  };
  const bcStatus = subGateStatus(initNotes.__bc_approved === true, initiationAggregate?.bcDone ?? 0);
  const ursStatus = subGateStatus(initNotes.__urs_biz_approved === true && initNotes.__urs_it_approved === true, initiationAggregate?.ursDone ?? 0);
  const bcDone = bcStatus === "complete";
  const ursDone = ursStatus === "complete";

  // Sub-stage nodes for the currently-visible phase. For Initiate this is the two
  // sub-gates (BC, URS); for every other phase it's the phase's real stages. Drives
  // BOTH the connector line and the dot row, so all phases render identically.
  const visibleNodeStatuses: StageStatus[] = visiblePhase.key === "initiate"
    ? [bcStatus, ursStatus]
    : visiblePhase.stageKeys.map((k) => stageStatus(k));

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
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            {title}
          </span>
          <div className="flex items-center gap-3 text-[11px]">
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
          Each pill is equal-weight (flex-1); click a pill to expand that
          phase's sub-stage dots below. */}
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
                onClick={() => setPinnedPhaseKey(phase.key)}
                className={`relative flex-1 flex items-center gap-2 px-2.5 py-2 rounded-xl border overflow-hidden transition-all text-left focus:outline-none focus:ring-2 focus:ring-primary/40 ${tone} ${
                  isVisible ? "ring-2 ring-primary/30 ring-offset-1 ring-offset-card" : ""
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
                  <p className="text-[9px] uppercase tracking-wider text-muted-foreground/70 leading-none mb-0.5">
                    Phase {idx + 1}
                  </p>
                  <p
                    className={`${compact ? "text-[11px]" : "text-xs"} font-semibold leading-tight truncate`}
                  >
                    {phase.label}
                  </p>
                  {phase.key === "initiate" && showInitSub ? (
                    /* Single project: live BC/URS status */
                    <p className="text-[9px] leading-none mt-0.5 flex items-center gap-1 font-semibold">
                      <span className={bcDone ? "text-success" : "text-warn"}>BC {bcDone ? "✓" : "⏳"}</span>
                      <span className="opacity-40">·</span>
                      <span className={ursDone ? "text-success" : "text-warn"}>URS {ursDone ? "✓" : "⏳"}</span>
                    </p>
                  ) : phase.key === "initiate" && counts && initiationAggregate && initiationAggregate.inInitiation > 0 ? (
                    /* Org-wide: BC/URS approved-count among projects in Initiation */
                    <p className="text-[9px] leading-none mt-0.5 flex items-center gap-1 font-semibold">
                      <span className="text-muted-foreground">BC {initiationAggregate.bcDone}/{initiationAggregate.inInitiation}</span>
                      <span className="opacity-40">·</span>
                      <span className="text-muted-foreground">URS {initiationAggregate.ursDone}/{initiationAggregate.inInitiation}</span>
                    </p>
                  ) : (
                    <p className="text-[9px] leading-none mt-0.5 opacity-80">
                      {done}/{total}
                    </p>
                  )}
                </div>

                {/* Per-card progress border — only under this pill, never in the gaps. */}
                <span className="absolute left-0 right-0 bottom-0 h-[3px] rounded-b-xl bg-border/50 overflow-hidden">
                  <span
                    className="block h-full rounded-b-xl transition-[width] duration-500 ease-out"
                    style={{
                      width: `${total > 0 ? (done / total) * 100 : 0}%`,
                      background:
                        status === "complete"
                          ? "hsl(var(--success))"
                          : status === "active"
                            ? "hsl(var(--primary))"
                            : "hsl(var(--muted-foreground) / 0.4)",
                    }}
                  />
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* === SUB-STAGE ROW — the active/selected phase's sub-stages, in a
          panel that visually attaches to the pill above. === */}
      <div
        className="relative mt-3 rounded-2xl border px-4 pt-4 pb-3 bg-muted/15"
        style={{ borderColor: `${visiblePhase.color}55` }}
      >
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {visiblePhase.label} ·{" "}
              {visiblePhase.key === "initiate"
                ? "Business Case + URS gates"
                : `${visiblePhase.stageKeys.length} stage${visiblePhase.stageKeys.length === 1 ? "" : "s"}`}
            </p>
            <p className="text-[10px] text-muted-foreground/80 italic truncate ml-3">
              {visiblePhase.description}
            </p>
          </div>
          {/* Connector line behind the dots — uses visibleNodeStatuses so the
              Initiate phase (BC + URS) gets the SAME connector as every other phase. */}
          <div className="relative">
            {visibleNodeStatuses.length > 1 && (() => {
              const total = visibleNodeStatuses.length;
              // Highest dot index that is complete or currently active —
              // the connector fills from the first dot up to this one.
              let lastReached = -1;
              for (let i = 0; i < total; i++) {
                const s = visibleNodeStatuses[i];
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
              {visiblePhase.stageKeys.map((stageKey) =>
                // Initiation always expands into its two sub-gates (BC + URS) — both
                // single-project (live status) and org-wide (per-gate approved counts) —
                // so every surface shows the internal structure, never a bare INIT dot.
                stageKey === "initiation"
                  ? renderInitiationSubGates()
                  : renderStageDot(stageKey),
              )}
            </div>
          </div>
        </div>

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

  // Initiation = one stage, two governed sub-gates (Business Case → URS). Rendered
  // with the SAME circle-dot + label + count-badge styling as every other stage
  // (renderStageDot), placed in the same justify-around row with the shared
  // connector line behind them — so Initiate reads identically to Procure/Execute/
  // Release, just with two nodes (BC, URS) that are checkpoints inside one stage.
  function renderInitiationSubGates() {
    const agg = initiationAggregate;
    const total = agg?.inInitiation ?? 0;
    const subs: Array<{ short: string; label: string; Icon: LucideIcon; status: StageStatus; aggDone: number }> = [
      { short: "BC", label: "Business Case", Icon: FileText, status: bcStatus, aggDone: agg?.bcDone ?? 0 },
      { short: "URS", label: "URS", Icon: ClipboardCheck, status: ursStatus, aggDone: agg?.ursDone ?? 0 },
    ];
    const isSelected = selectedStageKey === "initiation";

    return subs.map((sub) => {
      const badge = counts && total > 0 ? sub.aggDone : undefined;
      const dotClass =
        sub.status === "complete"
          ? "bg-success text-primary-foreground border-success"
          : sub.status === "active"
            ? "bg-primary text-primary-foreground border-primary lifecycle-pulse"
            : "bg-card text-muted-foreground border-border hover:border-primary/50 hover:text-primary";
      return (
        <button
          key={sub.short}
          type="button"
          onClick={() => onStageClick?.("initiation")}
          title={`Initiation · ${sub.label}${counts ? ` — ${sub.aggDone}/${total} approved` : ` — ${sub.status}`}`}
          className="group flex flex-col items-center gap-1 min-w-0 cursor-pointer focus:outline-none flex-1"
        >
          <div className="relative">
            <span
              className={`flex items-center justify-center rounded-full border-2 transition-all duration-200 ${dotClass} ${
                isSelected ? "ring-2 ring-primary/40 ring-offset-2 ring-offset-card" : ""
              }`}
              style={{ width: dotSize, height: dotSize }}
            >
              {sub.status === "complete" ? <Check size={dotIcon} strokeWidth={3} /> : <sub.Icon size={dotIcon} strokeWidth={2.2} />}
            </span>
            {badge != null && badge > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded-full bg-amber-accent text-[9px] font-bold text-background flex items-center justify-center border-2 border-card">
                {badge}
              </span>
            )}
          </div>
          <span
            className={`text-[9px] text-center leading-tight font-medium tracking-tight truncate w-full ${
              sub.status === "complete" ? "text-success" : sub.status === "active" ? "text-primary font-semibold" : "text-muted-foreground/80 group-hover:text-primary"
            }`}
          >
            {sub.short}
          </span>
          <span className="text-[8px] text-muted-foreground/60 leading-none">{counts && total > 0 ? `${sub.aggDone}/${total}` : "gate"}</span>
        </button>
      );
    });
  }

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
            <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded-full bg-amber-accent text-[9px] font-bold text-background flex items-center justify-center border-2 border-card">
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
        <span className="text-[8px] text-muted-foreground/60 leading-none">
          {String(globalIdx + 1).padStart(2, "0")}
        </span>
      </button>
    );
  }
}
