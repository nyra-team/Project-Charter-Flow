import { LIFECYCLE_STAGES, type LifecycleStageKey } from "./lifecycle-config";

// ---------------------------------------------------------------------------
// Single source of truth for the 4 main lifecycle phases that group the
// 9 sub-stages (Option B simplification). Used by project-lifecycle-card,
// dashboard funnel, and the pipeline kanban filter chips.
// ---------------------------------------------------------------------------

export type PhaseKey = "plan" | "execute" | "release_close";

export interface LifecyclePhase {
  key: PhaseKey;
  label: string;
  shortLabel: string;
  description: string;
  color: string;
  stageKeys: LifecycleStageKey[];
}

// 'Plan' merges the former 'Initiate' and 'Procure' phases (per 2026-06-02
// product call). One umbrella card spans initiation → sourcing → investment
// authorization → contract, which is how the business actually scopes the
// 'planning' part of a project before execution begins. Three phases total now
// (Plan → Execute → Release & Close).
export const LIFECYCLE_PHASES: LifecyclePhase[] = [
  {
    key: "plan",
    label: "Plan",
    shortLabel: "PLAN",
    description: "BRD, sourcing, authorization & contract",
    color: "#6366F1",
    stageKeys: ["initiation", "vendor_selection", "investment_authorization", "contract_po"],
  },
  {
    key: "execute",
    label: "Execute",
    shortLabel: "EXEC",
    description: "Design & build",
    color: "#0EA5E9",
    stageKeys: ["design", "build"],
  },
  {
    key: "release_close",
    label: "Release & Close",
    shortLabel: "REL",
    description: "Test, launch & wrap up",
    color: "#F59E0B",
    stageKeys: ["uat", "go_live", "closure"],
  },
];

export function getPhaseForStage(stageKey: string): LifecyclePhase | null {
  return LIFECYCLE_PHASES.find((p) => (p.stageKeys as readonly string[]).includes(stageKey)) ?? null;
}

export function getPhaseIndex(phaseKey: string): number {
  return LIFECYCLE_PHASES.findIndex((p) => p.key === phaseKey);
}

export const STAGE_COUNT = LIFECYCLE_STAGES.length;
