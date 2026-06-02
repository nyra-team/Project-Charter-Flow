import { ProjectLifecycleCard } from "./project-lifecycle-card";

interface StageProgressBarProps {
  currentStageKey: string;
  stageRecords: Array<{ stage: string; status: string; notes?: string | null }>;
  onStageClick?: (stageKey: string) => void;
  selectedStageKey?: string;
  role?: string;
}

// Back-compat wrapper — the project-detail page imports `StageProgressBar`.
// All visual logic now lives in ProjectLifecycleCard, which is shared across
// project-detail, the dashboard, and any other surface that needs the same
// connected phase + sub-stage ribbon.
export function StageProgressBar({
  currentStageKey,
  stageRecords,
  onStageClick,
  selectedStageKey,
}: StageProgressBarProps) {
  return (
    <ProjectLifecycleCard
      currentStageKey={currentStageKey}
      stageRecords={stageRecords}
      selectedStageKey={selectedStageKey}
      onStageClick={onStageClick}
      variant="full"
    />
  );
}
