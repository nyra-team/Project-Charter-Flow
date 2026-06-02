// Phase pill — uses the phase's own brand color from LIFECYCLE_PHASES.
// Soft tinted by default; `solid` for the active phase header.

import { LIFECYCLE_PHASES, getPhaseForStage, type LifecyclePhase } from "@/lib/lifecycle-phases";

export function phaseByKey(key?: string | null): LifecyclePhase | null {
  if (!key) return null;
  return LIFECYCLE_PHASES.find((p) => p.key === key) ?? null;
}

export function PhaseChip({
  phaseKey,
  stageKey,
  size = "sm",
  solid,
  className = "",
}: {
  /** Pass either a phase key directly… */
  phaseKey?: string | null;
  /** …or a stage key and we resolve its phase. */
  stageKey?: string | null;
  size?: "xs" | "sm" | "md";
  solid?: boolean;
  className?: string;
}) {
  const phase = phaseKey ? phaseByKey(phaseKey) : stageKey ? getPhaseForStage(stageKey) : null;
  if (!phase) return null;

  const px =
    size === "xs" ? "px-1.5 py-0.5 text-[10px] gap-1"
    : size === "md" ? "px-2.5 py-1 text-xs gap-1.5"
    : "px-2 py-0.5 text-[11px] gap-1.5";
  const dotSz = size === "xs" ? "w-1.5 h-1.5" : "w-2 h-2";

  return (
    <span
      className={`inline-flex items-center font-medium rounded-full border whitespace-nowrap ${px} ${className}`}
      style={
        solid
          ? { background: phase.color, color: "#fff", borderColor: "transparent" }
          : { background: `${phase.color}1A`, color: phase.color, borderColor: `${phase.color}33` }
      }
    >
      <span className={`rounded-full flex-shrink-0 ${dotSz}`} style={{ background: solid ? "#fff" : phase.color }} />
      {phase.label}
    </span>
  );
}
