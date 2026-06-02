import { LIFECYCLE_STAGES, type LifecycleStageKey } from "./lifecycle-config";

// ---------------------------------------------------------------------------
// Single source of truth for the 4 main lifecycle phases that group the
// 9 sub-stages (Option B simplification). Used by project-lifecycle-card,
// dashboard funnel, and the pipeline kanban filter chips.
// ---------------------------------------------------------------------------

export type PhaseKey = "initiate" | "procure" | "execute" | "release_close";

export interface LifecyclePhase {
  key: PhaseKey;
  label: string;
  shortLabel: string;
  description: string;
  color: string;
  stageKeys: LifecycleStageKey[];
}

export const LIFECYCLE_PHASES: LifecyclePhase[] = [
  {
    key: "initiate",
    label: "Initiate",
    shortLabel: "INIT",
    description: "Business case & requirements",
    color: "#6366F1",
    stageKeys: ["initiation"],
  },
  {
    key: "procure",
    label: "Procure",
    shortLabel: "PROC",
    description: "Sourcing, authorization & contract",
    color: "#EC4899",
    stageKeys: ["vendor_selection", "investment_authorization", "contract_po"],
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
