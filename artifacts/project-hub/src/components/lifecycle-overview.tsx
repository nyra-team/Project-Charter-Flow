import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LIFECYCLE_STAGES } from "../lib/lifecycle-config";
import { ProjectLifecycleCard } from "./project-lifecycle-card";

// ---------------------------------------------------------------------------
// LifecycleOverview
// The org-wide adapter for the ONE lifecycle visualization (ProjectLifecycleCard).
// It derives per-stage counts + the portfolio "frontier" from a raw projects
// list, then renders the exact same card used on Project Details — no separate
// variant. Both the Dashboard and the Pipeline board render through this, so
// the frontier/count logic lives in a single place.
// ---------------------------------------------------------------------------

export interface LifecycleOverviewProps {
  /** Raw projects; only `.stage` is read. Counts are derived internally. */
  projects: Array<{ stage?: string | null }>;
  /** Fired with the stage key when a sub-stage dot is clicked (after the
   *  internal selection highlight is toggled). */
  onStageClick?: (stageKey: string) => void;
  title?: string;
  subtitle?: string;
}

export function LifecycleOverview({ projects, onStageClick, title = "Lifecycle", subtitle }: LifecycleOverviewProps) {
  const counts = useMemo(() => {
    const rec: Record<string, number> = {};
    for (const s of LIFECYCLE_STAGES) rec[s.key] = 0;
    for (const p of projects) {
      const k = p.stage ?? "initiation";
      rec[k] = (rec[k] ?? 0) + 1;
    }
    return rec;
  }, [projects]);

  // Portfolio "frontier" — furthest lifecycle stage that still holds projects.
  // Drives currentStageKey so the org view reads like a project nearing the
  // end (earlier phases complete), exactly as a single project would.
  const frontierStageKey = useMemo(() => {
    for (let i = LIFECYCLE_STAGES.length - 1; i >= 0; i--) {
      if ((counts[LIFECYCLE_STAGES[i].key] ?? 0) > 0) return LIFECYCLE_STAGES[i].key;
    }
    return LIFECYCLE_STAGES[0].key;
  }, [counts]);

  const [selected, setSelected] = useState<string | undefined>(undefined);

  // Org-wide Initiation BC/URS aggregate, so the shared card can show the same
  // BC + URS sub-status under INIT here as it does on a single project.
  const { data: initAgg } = useQuery({
    queryKey: ["/api/dashboard/initiation-subgates"],
    queryFn: async () => {
      const r = await fetch("/api/dashboard/initiation-subgates");
      if (!r.ok) throw new Error("Failed");
      return r.json() as Promise<{ inInitiation: number; bcDone: number; ursDone: number }>;
    },
  });

  return (
    <ProjectLifecycleCard
      currentStageKey={frontierStageKey}
      counts={counts}
      initiationAggregate={initAgg}
      selectedStageKey={selected}
      onStageClick={(k) => {
        setSelected(k === selected ? undefined : k);
        onStageClick?.(k);
      }}
      title={title}
      subtitle={subtitle}
    />
  );
}
