import { LIFECYCLE_STAGES, type LifecycleStageKey } from "./lifecycle-config";

export type PhaseKey = "initiation" | "approval" | "execution" | "closure";

export const LIFECYCLE_PHASES: Array<{
  key: PhaseKey;
  label: string;
  shortLabel: string;
  description: string;
  color: string;
  stageKeys: LifecycleStageKey[];
}> = [
  {
    key: "initiation",
    label: "Initiation",
    shortLabel: "INIT",
    description: "Pre-charter pipeline — demand to vendor selection",
    color: "#6366F1",
    stageKeys: ["project_case", "urs", "rfp", "vendor_evaluation"],
  },
  {
    key: "approval",
    label: "Approval",
    shortLabel: "APR",
    description: "Charter through PO release — governance gates",
    color: "#EC4899",
    stageKeys: ["charter", "nfa", "legal", "pr_po"],
  },
  {
    key: "execution",
    label: "Execution",
    shortLabel: "EXE",
    description: "Kickoff through UAT — build and validate",
    color: "#0EA5E9",
    stageKeys: ["kickoff", "technical_design", "development", "implementation_plan", "uat"],
  },
  {
    key: "closure",
    label: "Closure",
    shortLabel: "CLS",
    description: "Go Live through archival — handover and lessons",
    color: "#10B981",
    stageKeys: ["go_live", "closure_readiness", "project_closure"],
  },
];

export function getPhaseForStage(stageKey: string): typeof LIFECYCLE_PHASES[number] | null {
  return LIFECYCLE_PHASES.find((p) => (p.stageKeys as readonly string[]).includes(stageKey)) ?? null;
}

export const STAGE_COUNT = LIFECYCLE_STAGES.length;
