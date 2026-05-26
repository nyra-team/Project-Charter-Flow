import { LIFECYCLE_STAGES, type LifecycleStageKey } from "./lifecycle-config";

// ---------------------------------------------------------------------------
// Single source of truth for the 5 main lifecycle phases that group the
// 16 sub-stages. Used by project-lifecycle-card, dashboard funnel, and the
// pipeline kanban filter chips.
// ---------------------------------------------------------------------------

export type PhaseKey = "initiate" | "procure" | "execute" | "deliver" | "close";

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
    description: "Concept & requirements",
    color: "#6366F1",
    stageKeys: ["project_case", "urs"],
  },
  {
    key: "procure",
    label: "Procure",
    shortLabel: "PROC",
    description: "Sourcing, approvals & contract",
    color: "#EC4899",
    stageKeys: ["rfp", "vendor_evaluation", "charter", "nfa", "legal", "pr_po"],
  },
  {
    key: "execute",
    label: "Execute",
    shortLabel: "EXEC",
    description: "Mobilise, design & build",
    color: "#0EA5E9",
    stageKeys: ["kickoff", "technical_design", "development", "implementation_plan"],
  },
  {
    key: "deliver",
    label: "Deliver",
    shortLabel: "DLVR",
    description: "Test & launch",
    color: "#F59E0B",
    stageKeys: ["uat", "go_live"],
  },
  {
    key: "close",
    label: "Close",
    shortLabel: "CLOSE",
    description: "Stabilise & wrap up",
    color: "#10B981",
    stageKeys: ["closure_readiness", "project_closure"],
  },
];

export function getPhaseForStage(stageKey: string): LifecyclePhase | null {
  return LIFECYCLE_PHASES.find((p) => (p.stageKeys as readonly string[]).includes(stageKey)) ?? null;
}

export function getPhaseIndex(phaseKey: string): number {
  return LIFECYCLE_PHASES.findIndex((p) => p.key === phaseKey);
}

export const STAGE_COUNT = LIFECYCLE_STAGES.length;
