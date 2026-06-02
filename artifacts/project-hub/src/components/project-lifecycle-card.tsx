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

  // Initiation = single combined node "Business Requirements". Previously
  // rendered as TWO sub-gate dots (BC + URS) which contradicted the new unified
  // label and confused users. Now: one StageStatus computed from BOTH halves
  // being approved (BC + both URS approvals).
  //
  // In org-wide counts mode, the aggregate completion count is `ursDone` — the
  // server enforces BC → URS sequencing (URS approval requires BC approved first),
  // so any project counted in `ursDone` necessarily completed both gates.
  const showInitSub = !counts;
  const initNotes: Record<string, unknown> = (() => {
    try { return JSON.parse(stageRecords.find((r) => r.stage === "initiation")?.notes ?? "{}"); } catch { return {}; }
  })();
  const initStageSt = stageStatus("initiation");
  const initTotal = initiationAggregate?.inInitiation ?? 0;
  const initBothApproved =
    initNotes.__bc_approved === true &&
    initNotes.__urs_biz_approved === true &&
    initNotes.__urs_it_approved === true;
  const initAggDone = initiationAggregate?.ursDone ?? 0;
  const initCombinedStatus: StageStatus = (() => {
    const done = counts
      ? initStageSt === "complete" || (initTotal > 0 && initAggDone >= initTotal)
      : initStageSt === "complete" || initBothApproved;
    return done ? "complete" : initStageSt === "upcoming" ? "upcoming" : "active";
  })();

  // Sub-stage nodes for the currently-visible phase. The 'initiation' stage
  // (now living inside the merged 'plan' phase alongside the three procure
  // stages) contributes ONE combined node — the BRD gate — wherever it
  // appears. Every other stage contributes a normal stageStatus() dot.
  // Drives BOTH the connector line and the dot row.
  const visibleNodeStatuses: StageStatus[] = visiblePhase.stageKeys.map((k) =>
    k === "initiation" ? initCombinedStatus : stageStatus(k),
  );

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
                  {phase.key === "plan" && showInitSub && currentStageKey === "initiation" ? (
                    /* Single project sitting in the Plan phase's initiation stage:
                       show the combined Business Requirements status. Projects further
                       along inside Plan (Vendor Selection / IA / Contract & PO) fall
                       through to the default 'done/total' counter below. */
                    <p className="text-[9px] leading-none mt-0.5 font-semibold">
                      <span className={initCombinedStatus === "complete" ? "text-success" : "text-warn"}>
                        Business Requirements {initCombinedStatus === "complete" ? "✓" : "⏳"}
                      </span>
                    </p>
                  ) : phase.key === "plan" && counts && initiationAggregate && initiationAggregate.inInitiation > 0 ? (
                    /* Org-wide aggregate: Business Requirements approved-count among
                       projects in initiation. URS approval requires BC first
                       (server-enforced), so ursDone counts projects that completed
                       both halves. */
                    <p className="text-[9px] leading-none mt-0.5 font-semibold">
                      <span className="text-muted-foreground">
                        Business Requirements {initiationAggregate.ursDone}/{initiationAggregate.inInitiation} approved
                      </span>
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
              {visiblePhase.key === "plan" && currentStageKey === "initiation"
                ? "Business Requirements"
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
                // Initiation renders as ONE combined "Business Case &
                // Requirements" dot (collapsed from the previous BC + URS
                // pair) to match the unified user-facing label. Internal
                // dual-gating still runs server-side.
                stageKey === "initiation"
                  ? renderInitiationCombined()
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

  // Initiation = ONE combined gate ("Business Requirements"). Renders with the
  // SAME circle-dot + label + count-badge styling as every other phase's
  // single-stage dot, so it reads identically to the other stages. Two internal
  // halves (BC, URS) still gate independently server-side; the dot just
  // collapses them visually to match the unified user-facing label.
  function renderInitiationCombined() {
    const total = initTotal;
    const done = initAggDone;
    const isSelected = selectedStageKey === "initiation";
    const badge = counts && total > 0 ? done : undefined;
    const dotClass =
      initCombinedStatus === "complete"
        ? "bg-success text-primary-foreground border-success"
        : initCombinedStatus === "active"
          ? "bg-primary text-primary-foreground border-primary lifecycle-pulse"
          : "bg-card text-muted-foreground border-border hover:border-primary/50 hover:text-primary";

    return (
      <button
        key="initiation"
        type="button"
        onClick={() => onStageClick?.("initiation")}
        title={`Business Requirements${counts ? ` — ${done}/${total} approved` : ` — ${initCombinedStatus}`}`}
        className="group flex flex-col items-center gap-1 min-w-0 cursor-pointer focus:outline-none flex-1"
      >
        <div className="relative">
          <span
            className={`flex items-center justify-center rounded-full border-2 transition-all duration-200 ${dotClass} ${
              isSelected ? "ring-2 ring-primary/40 ring-offset-2 ring-offset-card scale-110" : ""
            }`}
            style={{ width: dotSize, height: dotSize }}
          >
            {initCombinedStatus === "complete" ? <Check size={dotIcon} strokeWidth={3} /> : <FileText size={dotIcon} strokeWidth={2.2} />}
          </span>
          {badge != null && badge > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded-full bg-amber-accent text-[9px] font-bold text-background flex items-center justify-center border-2 border-card">
              {badge}
            </span>
          )}
        </div>
        <span
          className={`text-[9px] text-center leading-tight font-medium tracking-tight truncate w-full ${
            initCombinedStatus === "complete" ? "text-success" : initCombinedStatus === "active" ? "text-primary font-semibold" : "text-muted-foreground/80 group-hover:text-primary"
          }`}
        >
          Initiation
        </span>
        {counts && total > 0 && (
          <span className="text-[8px] text-muted-foreground/60 leading-none">{done}/{total}</span>
        )}
      </button>
    );
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
