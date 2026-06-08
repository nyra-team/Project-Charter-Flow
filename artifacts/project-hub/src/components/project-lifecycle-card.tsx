import { useState } from "react";
import {
  LIFECYCLE_STAGES,
  getStageIndex,
} from "../lib/lifecycle-config";
import {
  LIFECYCLE_PHASES,
  CANONICAL_STAGE_KEYS,
  getCanonicalStageNumber,
  getPhaseForStage,
  getPhaseIndex,
  type LifecyclePhase,
} from "../lib/lifecycle-phases";
import { STAGE_ICONS } from "./lifecycle-stepper";
import {
  Check,
  FileSearch,
  Hammer,
  Flag,
  FileText,
  Lock,
  MapPin,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

// ---------------------------------------------------------------------------
// ProjectLifecycleCard — the ONE lifecycle visualization for the whole app.
// Two modes, branched on `portfolioMode = !!counts`:
//   • Single-project (project-detail → stage-progress-bar): real stageRecords,
//     a JOURNEY read — Cleared / You are here / Upcoming, % complete, next gate.
//   • Org-wide (dashboard + pipeline → lifecycle-overview): a DISTRIBUTION read
//     — how many projects sit in each phase/stage. No single-journey overlay.
// Enterprise-clean: no rank badges / trophies / "journey" naming.
// ---------------------------------------------------------------------------

// Phase keys are plan / execute / close (see lifecycle-phases.ts).
const PHASE_ICONS: Record<string, LucideIcon> = {
  plan: FileSearch,
  execute: Hammer,
  close: Flag,
};

type StageStatus = "complete" | "active" | "upcoming";

export interface ProjectLifecycleCardProps {
  currentStageKey: string;
  stageRecords?: Array<{ stage: string; status: string; notes?: string | null }>;
  selectedStageKey?: string;
  onStageClick?: (stageKey: string) => void;
  /** Optional per-stage badge (e.g. project counts on the dashboard). Presence flips the card to org-wide DISTRIBUTION mode. */
  counts?: Record<string, number>;
  /** Org-wide Initiation BC/URS aggregate (counts mode) — shows "BR y/n approved" under the Plan pill. */
  initiationAggregate?: { inInitiation: number; bcDone: number; ursDone: number };
  /** Compact = smaller padding & dots, no description footer. */
  variant?: "full" | "compact";
  /** Hide the header row. */
  hideHeader?: boolean;
  /** Hide the legend footer. */
  hideLegend?: boolean;
  /** Override the default header label. */
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

  // `counts` present ⇒ org-wide DISTRIBUTION mode; otherwise single-project JOURNEY mode.
  const portfolioMode = !!counts;

  // Which phase to expand below.
  const selectedPhase =
    (selectedStageKey ? getPhaseForStage(selectedStageKey) : null) ?? currentPhase ?? LIFECYCLE_PHASES[0];
  const [pinnedPhaseKey, setPinnedPhaseKey] = useState<string | null>(null);
  const visiblePhase: LifecyclePhase =
    LIFECYCLE_PHASES.find((p) => p.key === pinnedPhaseKey) ?? selectedPhase;

  function stageStatus(stageKey: string): StageStatus {
    const rec = stageRecords.find((r) => r.stage === stageKey);
    if (rec?.status === "complete") return "complete";
    if (rec?.status === "in_progress") return "active";
    const idx = getStageIndex(stageKey);
    if (idx < currentIdx) return "complete";
    if (idx === currentIdx) return "active";
    return "upcoming";
  }

  // Initiation = single combined node "Business Case". One StageStatus
  // computed from BOTH halves being approved (BC + both URS approvals). In
  // org-wide counts mode the aggregate completion count is `ursDone` (server
  // enforces BC → URS sequencing).
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

  // Sub-stage nodes for the currently-visible phase (drives the connector fill
  // in journey mode). Initiation contributes its combined status.
  const visibleNodeStatuses: StageStatus[] = visiblePhase.stageKeys.map((k) =>
    k === "initiation" ? initCombinedStatus : stageStatus(k),
  );

  const statusOf = (k: string): StageStatus =>
    k === "initiation" ? initCombinedStatus : stageStatus(k);

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

  // === DISTRIBUTION (portfolio) figures ===============================
  const projectsInPhase = (phase: LifecyclePhase) =>
    phase.stageKeys.reduce((n, k) => n + (counts?.[k] ?? 0), 0);
  const phaseProjectCounts = LIFECYCLE_PHASES.map(projectsInPhase);
  const totalProjects = phaseProjectCounts.reduce((a, b) => a + b, 0);

  // === JOURNEY (single-project) figures ===============================
  const allKeys = CANONICAL_STAGE_KEYS;
  const totalCount = allKeys.length;
  const doneCount = allKeys.filter((k) => statusOf(k) === "complete").length;
  const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  function stageLabel(stageKey: string): string {
    if (stageKey === "initiation") return "Business Case";
    const s = LIFECYCLE_STAGES.find((x) => x.key === stageKey);
    return s?.label ?? stageKey;
  }

  // Next gate (journey mode): the canonical stage right after the current one.
  const currentNum = getCanonicalStageNumber(currentStageKey);
  const nextGateKey =
    currentNum != null && currentNum < CANONICAL_STAGE_KEYS.length
      ? CANONICAL_STAGE_KEYS[currentNum]
      : null;

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
        <div className={compact ? "mb-3" : "mb-4"}>
          {/* Title row */}
          <div className="flex items-end justify-between gap-2 flex-wrap mb-2">
            <span className={`${compact ? "text-xs" : "text-sm"} font-bold tracking-tight text-foreground truncate`}>
              {title}
            </span>
            {portfolioMode ? (
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {totalProjects} project{totalProjects === 1 ? "" : "s"}
              </span>
            ) : (
              <span
                className={`${compact ? "text-base" : "text-lg"} font-extrabold tabular-nums leading-none ${
                  pct >= 100 ? "text-success" : "text-primary"
                }`}
              >
                {pct}%
              </span>
            )}
          </div>

          {portfolioMode ? (
            <>
              {/* Distribution bar — share of projects in Plan / Execute / Close */}
              <div className="relative h-2 rounded-full bg-border/40 overflow-hidden flex">
                {LIFECYCLE_PHASES.map((phase, idx) => {
                  const w = totalProjects > 0 ? (phaseProjectCounts[idx] / totalProjects) * 100 : 0;
                  return (
                    <span
                      key={phase.key}
                      className="h-full transition-[width] duration-500 ease-out"
                      style={{ width: `${w}%`, background: phase.color }}
                      title={`${phase.label}: ${phaseProjectCounts[idx]} project${phaseProjectCounts[idx] === 1 ? "" : "s"}`}
                    />
                  );
                })}
              </div>
              <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground/90 flex-wrap">
                {LIFECYCLE_PHASES.map((phase, idx) => (
                  <span key={phase.key} className="inline-flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full inline-block" style={{ background: phase.color }} />
                    <span className="font-medium text-foreground/80">{phase.label}</span>
                    <span className="tabular-nums">{phaseProjectCounts[idx]}</span>
                  </span>
                ))}
                {subtitle && (
                  <>
                    <span className="text-muted-foreground/40">·</span>
                    <span>{subtitle}</span>
                  </>
                )}
              </div>
            </>
          ) : (
            <>
              {/* Progress bar — share of the 13 stages complete */}
              <div className="relative h-2 rounded-full bg-border/50 overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out"
                  style={{
                    width: `${pct}%`,
                    background:
                      pct >= 100
                        ? "hsl(var(--success))"
                        : "linear-gradient(90deg, hsl(var(--success)) 0%, hsl(var(--success)) 55%, hsl(var(--primary)) 100%)",
                  }}
                />
              </div>
              <div className="flex items-center justify-between gap-2 flex-wrap mt-2 text-[10px] text-muted-foreground/90">
                <span>{doneCount} of {totalCount} stages complete</span>
                <span className="inline-flex items-center gap-1.5">
                  <span>Current: <span className="font-semibold text-primary">{stageLabel(currentStageKey)}</span></span>
                  {pct < 100 && (
                    <>
                      <span className="text-muted-foreground/40">·</span>
                      <span>Next gate: <span className="font-semibold text-foreground/80">{nextGateKey ? stageLabel(nextGateKey) : "—"}</span></span>
                    </>
                  )}
                </span>
              </div>
            </>
          )}
        </div>
      )}

      {/* === PHASE PILLS ROW ============================================= */}
      <div className="relative">
        <div className="flex items-stretch gap-3">
          {LIFECYCLE_PHASES.map((phase, idx) => {
            const { total, done, status } = phaseStats(idx);
            const Icon = PHASE_ICONS[phase.key] ?? FileText;
            const phaseProjects = phaseProjectCounts[idx];

            // Portfolio: tone by "has projects"; Journey: tone by status.
            const portfolioActive = phaseProjects > 0;
            const tone = portfolioMode
              ? portfolioActive
                ? "border-primary/50 bg-primary/10 text-primary"
                : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-primary"
              : status === "complete"
                ? "border-success/40 bg-success/10 text-success"
                : status === "active"
                  ? "border-primary/50 bg-primary/15 text-primary"
                  : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-primary";

            const iconTone = portfolioMode
              ? portfolioActive
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-muted/40 border-border text-muted-foreground"
              : status === "complete"
                ? "bg-success text-primary-foreground border-success"
                : status === "active"
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted/40 border-border text-muted-foreground";

            return (
              <button
                key={phase.key}
                type="button"
                onClick={() => setPinnedPhaseKey(phase.key)}
                className={`relative flex-1 flex items-center gap-2 px-2.5 py-2 rounded-xl border overflow-hidden transition-all text-left focus:outline-none ${tone} ${!portfolioMode && status === "upcoming" ? "opacity-75" : ""} ${!portfolioMode && status === "complete" ? "hero-shine" : ""}`}
                title={`${phase.label} — ${phase.description}`}
              >
                <span
                  className={`relative flex items-center justify-center rounded-md border flex-shrink-0 ${iconTone}`}
                  style={{ width: compact ? 22 : 28, height: compact ? 22 : 28 }}
                >
                  {!portfolioMode && status === "complete" ? (
                    <Check size={compact ? 11 : 14} strokeWidth={3} />
                  ) : !portfolioMode && status === "upcoming" ? (
                    <Lock size={compact ? 11 : 13} strokeWidth={2.4} />
                  ) : (
                    <Icon size={compact ? 11 : 14} strokeWidth={2.2} />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  {/* Eyebrow */}
                  {portfolioMode ? (
                    <p className="text-[9px] uppercase tracking-wider leading-none mb-0.5 font-semibold text-muted-foreground/60">
                      Phase {idx + 1}
                    </p>
                  ) : (
                    <p
                      className={`text-[9px] uppercase tracking-wider leading-none mb-0.5 inline-flex items-center gap-0.5 font-semibold ${
                        status === "complete"
                          ? "text-success"
                          : status === "active"
                            ? "text-primary"
                            : "text-muted-foreground/60"
                      }`}
                    >
                      {status === "complete" ? (
                        <><Check size={9} strokeWidth={3} /> Cleared</>
                      ) : status === "active" ? (
                        <><MapPin size={9} strokeWidth={2.6} /> You are here</>
                      ) : (
                        <>Upcoming</>
                      )}
                    </p>
                  )}
                  <p className={`${compact ? "text-[11px]" : "text-xs"} font-semibold leading-tight truncate`}>
                    {phase.label}
                  </p>
                  {/* Sub-line */}
                  {portfolioMode ? (
                    <p className="text-[9px] leading-none mt-0.5 font-medium text-muted-foreground">
                      {phaseProjects} project{phaseProjects === 1 ? "" : "s"}
                      {phase.key === "plan" && initiationAggregate && initiationAggregate.inInitiation > 0 && (
                        <span className="text-muted-foreground/70">
                          {" "}· BR {initiationAggregate.ursDone}/{initiationAggregate.inInitiation} approved
                        </span>
                      )}
                    </p>
                  ) : (
                    <p className="text-[9px] leading-none mt-0.5 opacity-80">
                      {done}/{total}
                    </p>
                  )}
                </div>

                {/* Per-card progress border */}
                <span className="absolute left-0 right-0 bottom-0 h-[3px] rounded-b-xl bg-border/50 overflow-hidden">
                  <span
                    className="block h-full rounded-b-xl transition-[width] duration-500 ease-out"
                    style={{
                      width: portfolioMode
                        ? `${totalProjects > 0 ? (phaseProjects / totalProjects) * 100 : 0}%`
                        : `${total > 0 ? (done / total) * 100 : 0}%`,
                      background: portfolioMode
                        ? phase.color
                        : status === "complete"
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

      {/* === SUB-STAGE ROW — the active/selected phase's sub-stages === */}
      <div className="relative mt-3 rounded-2xl border px-4 pt-4 pb-3 bg-muted/15">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {visiblePhase.label} · {visiblePhase.stageKeys.length} stage{visiblePhase.stageKeys.length === 1 ? "" : "s"}
            {portfolioMode && (
              <span className="text-muted-foreground/70">
                {" "}· {projectsInPhase(visiblePhase)} project{projectsInPhase(visiblePhase) === 1 ? "" : "s"}
              </span>
            )}
          </p>
          <p className="text-[10px] text-muted-foreground/80 italic truncate ml-3">
            {visiblePhase.description}
          </p>
        </div>
        {/* Connector line behind the dots — journey mode fills it by progress. */}
        <div className="relative">
          {visibleNodeStatuses.length > 1 && (() => {
            const total = visibleNodeStatuses.length;
            let lastReached = -1;
            for (let i = 0; i < total; i++) {
              const s = visibleNodeStatuses[i];
              if (s === "complete" || s === "active") lastReached = i;
            }
            const trackPct = ((total - 1) / total) * 100;
            const fillPct =
              portfolioMode || lastReached <= 0 ? 0 : (lastReached / (total - 1)) * trackPct;
            const offsetPct = (1 / total) * 50;
            const dotTopPad = 14;
            return (
              <>
                <div
                  className="absolute h-[3px] bg-border/70 rounded-full"
                  style={{ top: dotTopPad + dotSize / 2 - 1, left: `${offsetPct}%`, right: `${offsetPct}%` }}
                />
                {!portfolioMode && (
                  <div
                    className="absolute h-[3px] rounded-full transition-[width] duration-700 ease-out"
                    style={{
                      top: dotTopPad + dotSize / 2 - 1,
                      left: `${offsetPct}%`,
                      width: `${fillPct}%`,
                      background:
                        "linear-gradient(90deg, hsl(var(--success)) 0%, hsl(var(--success)) 65%, hsl(var(--primary)) 100%)",
                    }}
                  />
                )}
              </>
            );
          })()}
          <div className="relative flex items-start justify-around gap-2">
            {visiblePhase.stageKeys.map((stageKey) =>
              stageKey === "initiation" ? renderInitiationCombined() : renderStageDot(stageKey),
            )}
          </div>
        </div>
      </div>

      {/* FOOTER */}
      {!hideLegend && (
        <div className="mt-3 pt-3 border-t border-border/60 flex items-center justify-between flex-wrap gap-2">
          {portfolioMode ? (
            <>
              <div className="text-[11px] text-muted-foreground">
                <span className="font-semibold text-foreground/80 tabular-nums">{totalProjects}</span> project{totalProjects === 1 ? "" : "s"} across {totalCount} stages
              </div>
              <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full inline-block bg-primary" />
                  In this stage
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full inline-block bg-muted border border-border" />
                  None
                </span>
              </div>
            </>
          ) : (
            <>
              <div>
                <span className="text-[11px] text-muted-foreground">Current stage: </span>
                <span className="text-[11px] font-semibold text-primary">
                  {currentStage?.label ?? currentStageKey}
                </span>
                {currentPhase && (
                  <span className="text-[11px] text-muted-foreground/70 ml-1">· in {currentPhase.label}</span>
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
            </>
          )}
        </div>
      )}
    </div>
  );

  // Initiation = ONE combined gate ("Business Case"), rendered like any
  // other single-stage dot. Two internal halves (BC, URS) still gate server-side.
  function renderInitiationCombined() {
    const isSelected = selectedStageKey === "initiation";
    const num = getCanonicalStageNumber("initiation");
    const count = counts?.["initiation"];
    const hasProjects = (count ?? 0) > 0;
    // Portfolio: highlight when projects sit here. Journey: use combined status.
    const active = portfolioMode ? hasProjects : initCombinedStatus === "active";
    const complete = !portfolioMode && initCombinedStatus === "complete";

    const dotClass = complete
      ? "bg-success text-primary-foreground border-success"
      : active
        ? `bg-primary text-primary-foreground border-primary${portfolioMode ? "" : " lifecycle-pulse"}`
        : "bg-card text-muted-foreground border-border hover:border-primary/50 hover:text-primary";

    return (
      <button
        key="initiation"
        type="button"
        onClick={() => onStageClick?.("initiation")}
        title={`Business Case${counts ? ` — ${initAggDone}/${initTotal} approved` : ` — ${initCombinedStatus}`}`}
        className="group relative flex flex-col items-center gap-1 min-w-0 cursor-pointer focus:outline-none flex-1 pt-3.5"
      >
        {!portfolioMode && initCombinedStatus === "active" && (
          <span
            aria-hidden
            className="absolute left-1/2 -translate-x-1/2 top-0 text-primary lifecycle-pulse rounded-full pointer-events-none"
            title="You are here"
          >
            <MapPin size={13} strokeWidth={2.6} className="fill-primary/20" />
          </span>
        )}
        <div className="relative">
          <span
            className={`flex items-center justify-center rounded-full border-2 transition-all duration-200 ${dotClass} ${
              isSelected ? "ring-2 ring-primary/40 ring-offset-2 ring-offset-card scale-110" : ""
            }`}
            style={{ width: dotSize, height: dotSize }}
          >
            {complete ? <Check size={dotIcon} strokeWidth={3} /> : <FileText size={dotIcon} strokeWidth={2.2} />}
          </span>
          {count != null && count > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded-full bg-amber-accent text-[9px] font-bold text-background flex items-center justify-center border-2 border-card">
              {count}
            </span>
          )}
        </div>
        <span
          className={`text-[9px] text-center leading-tight font-medium tracking-tight truncate w-full ${
            complete ? "text-success" : active ? "text-primary font-semibold" : "text-muted-foreground/80 group-hover:text-primary"
          }`}
        >
          Business Case
        </span>
        {portfolioMode && initiationAggregate && initTotal > 0 ? (
          <span className="text-[8px] text-muted-foreground/60 leading-none">{initAggDone}/{initTotal} appr.</span>
        ) : num != null ? (
          <span className="text-[8px] text-muted-foreground/60 leading-none">{String(num).padStart(2, "0")}</span>
        ) : null}
      </button>
    );
  }

  function renderStageDot(stageKey: string) {
    const stage = LIFECYCLE_STAGES.find((s) => s.key === stageKey)!;
    const isSelected = selectedStageKey === stageKey;
    const Icon = STAGE_ICONS[stageKey] ?? FileText;
    const num = getCanonicalStageNumber(stageKey);
    const count = counts?.[stageKey];
    const hasProjects = (count ?? 0) > 0;
    const journeyStatus = stageStatus(stageKey);

    // Portfolio: highlight stages that hold projects. Journey: real status.
    const active = portfolioMode ? hasProjects : journeyStatus === "active";
    const complete = !portfolioMode && journeyStatus === "complete";

    const dotClass = complete
      ? "bg-success text-primary-foreground border-success"
      : active
        ? `bg-primary text-primary-foreground border-primary${portfolioMode ? "" : " lifecycle-pulse"}`
        : "bg-card text-muted-foreground border-border hover:border-primary/50 hover:text-primary";

    return (
      <button
        key={stageKey}
        type="button"
        onClick={() => onStageClick?.(stageKey)}
        title={`${stage.label}${count != null ? ` · ${count} project${count === 1 ? "" : "s"}` : ""}`}
        className="group relative flex flex-col items-center gap-1 min-w-0 cursor-pointer focus:outline-none flex-1 pt-3.5"
      >
        {!portfolioMode && journeyStatus === "active" && (
          <span
            aria-hidden
            className="absolute left-1/2 -translate-x-1/2 top-0 text-primary lifecycle-pulse rounded-full pointer-events-none"
            title="You are here"
          >
            <MapPin size={13} strokeWidth={2.6} className="fill-primary/20" />
          </span>
        )}
        <div className="relative">
          <span
            className={`flex items-center justify-center rounded-full border-2 transition-all duration-200 ${dotClass} ${
              isSelected ? "ring-2 ring-primary/40 ring-offset-2 ring-offset-card scale-110" : ""
            }`}
            style={{ width: dotSize, height: dotSize }}
          >
            {complete ? <Check size={dotIcon} strokeWidth={3} /> : <Icon size={dotIcon} strokeWidth={2.2} />}
          </span>
          {count != null && count > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded-full bg-amber-accent text-[9px] font-bold text-background flex items-center justify-center border-2 border-card">
              {count}
            </span>
          )}
        </div>
        <span
          className={`text-[9px] text-center leading-tight font-medium tracking-tight transition-colors truncate w-full ${
            complete ? "text-success" : active ? "text-primary font-semibold" : "text-muted-foreground/80 group-hover:text-primary"
          }`}
        >
          {stage.shortLabel}
        </span>
        {num != null && (
          <span className="text-[8px] text-muted-foreground/60 leading-none">
            {String(num).padStart(2, "0")}
          </span>
        )}
      </button>
    );
  }
}
