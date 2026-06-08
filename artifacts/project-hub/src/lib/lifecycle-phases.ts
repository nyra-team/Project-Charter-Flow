import { LIFECYCLE_STAGES, type LifecycleStageKey } from "./lifecycle-config";

// ---------------------------------------------------------------------------
// Single source of truth for the 4 main lifecycle phases that group the
// 9 sub-stages (Option B simplification). Used by project-lifecycle-card,
// dashboard funnel, and the pipeline kanban filter chips.
// ---------------------------------------------------------------------------

export type PhaseKey = "plan" | "execute" | "close";

export interface LifecyclePhase {
  key: PhaseKey;
  label: string;
  shortLabel: string;
  description: string;
  color: string;
  stageKeys: LifecycleStageKey[];
}

// 2026-06-02 canonical project life cycle. Three phases, 13 stages:
//
//   Plan      → Business Case · RFP · Vendor Evaluation and
//               Finalization · Solution Design · Project Plan
//   Execute   → Development & Configuration · System Testing & Validation
//               · Deployment Readiness · Production Deployment & Go-Live
//   Close     → Business closure · Operational handover · Financial
//               closure · PMO Closure
//
// Stage keys preserved from the older lifecycle (initiation, vendor_selection,
// uat, go_live, closure) keep their internal identifiers — only their labels
// changed. The four deprecated keys (design, build, investment_authorization,
// contract_po) still exist in LIFECYCLE_STAGES for back-compat with old
// project data but are intentionally NOT listed here, so the new lifecycle
// bar / pipeline / phase cards never render them.
export const LIFECYCLE_PHASES: LifecyclePhase[] = [
  {
    key: "plan",
    label: "Plan",
    shortLabel: "Plan",
    description: "Requirements, sourcing, vendor finalization, design & schedule",
    color: "#6366F1",
    stageKeys: ["initiation", "rfp", "vendor_selection", "solution_design", "project_plan"],
  },
  {
    key: "execute",
    label: "Execute",
    shortLabel: "Execute",
    description: "Build, test, prepare and go-live",
    color: "#0EA5E9",
    stageKeys: ["dev_config", "uat", "deployment_readiness", "go_live"],
  },
  {
    key: "close",
    label: "Close",
    shortLabel: "Close",
    description: "Business sign-off, operational handover, financials, PMO closure",
    color: "#F59E0B",
    stageKeys: ["business_closure", "operational_handover", "financial_closure", "closure"],
  },
];

// Canonical 13-stage flow, in order, EXCLUDING the deprecated keys that still
// live in LIFECYCLE_STAGES for old-project back-compat. This — not the raw
// LIFECYCLE_STAGES array index — is the source of truth for the stage NUMBER
// shown to users. (The deprecated keys are interspersed mid-array, so
// getStageIndex() over LIFECYCLE_STAGES mis-numbers Close as 14–17.)
export const CANONICAL_STAGE_KEYS: string[] = LIFECYCLE_PHASES.flatMap((p) => p.stageKeys as string[]);

/** 1-based position in the canonical 13-stage flow, or null for deprecated/unknown keys. */
export function getCanonicalStageNumber(stageKey: string): number | null {
  const i = CANONICAL_STAGE_KEYS.indexOf(stageKey);
  return i < 0 ? null : i + 1;
}

export function getPhaseForStage(stageKey: string): LifecyclePhase | null {
  return LIFECYCLE_PHASES.find((p) => (p.stageKeys as readonly string[]).includes(stageKey)) ?? null;
}

export function getPhaseIndex(phaseKey: string): number {
  return LIFECYCLE_PHASES.findIndex((p) => p.key === phaseKey);
}

export const STAGE_COUNT = LIFECYCLE_STAGES.length;
