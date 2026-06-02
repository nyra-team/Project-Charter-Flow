// Monday-style status pill — rounded, soft-tinted, with a leading dot.
// Driven entirely by the centralized status-tokens, so every status surface
// across the app reads the same.

import {
  TONES, type Tone, type ToneClasses,
  healthTone, healthLabel, stageTone, stageLabel,
  approvalTone, genericTone, prettify,
} from "@/lib/status-tokens";

type Size = "xs" | "sm" | "md";

const SIZE: Record<Size, { px: string; dot: string }> = {
  xs: { px: "px-1.5 py-0.5 text-[10px] gap-1", dot: "w-1.5 h-1.5" },
  sm: { px: "px-2 py-0.5 text-[11px] gap-1.5", dot: "w-2 h-2" },
  md: { px: "px-2.5 py-1 text-xs gap-1.5", dot: "w-2.5 h-2.5" },
};

interface BaseProps {
  size?: Size;
  /** Solid filled variant for high emphasis (e.g. a blocked stage). */
  solid?: boolean;
  /** Hide the leading dot. */
  noDot?: boolean;
  className?: string;
  label?: string;
}

function Chip({
  tone, label, size = "sm", solid, noDot, className = "",
}: BaseProps & { tone: Tone }) {
  const cfg: ToneClasses = TONES[tone];
  const s = SIZE[size];
  const surface = solid ? cfg.solid + " border-transparent" : cfg.wrap;
  return (
    <span className={`inline-flex items-center font-medium rounded-full border whitespace-nowrap ${s.px} ${surface} ${className}`}>
      {!noDot && (
        <span className={`rounded-full flex-shrink-0 ${s.dot} ${solid ? "bg-current opacity-80" : cfg.dot}`} />
      )}
      {label}
    </span>
  );
}

/** Project / critical-path health (on_track | at_risk | blocked). */
export function HealthChip({ health, ...rest }: BaseProps & { health?: string | null }) {
  return <Chip tone={healthTone(health)} label={rest.label ?? healthLabel(health)} {...rest} />;
}

/** Lifecycle stage stop status (complete | active | blocked | upcoming | skipped). */
export function StageChip({ status, ...rest }: BaseProps & { status?: string | null }) {
  return <Chip tone={stageTone(status)} label={rest.label ?? stageLabel(status)} {...rest} />;
}

/** Approval status (pending | approved | rejected | escalated). */
export function ApprovalChip({ status, ...rest }: BaseProps & { status?: string | null }) {
  return <Chip tone={approvalTone(status)} label={rest.label ?? prettify(status ?? "")} {...rest} />;
}

/** Generic project/task status — the StatusBadge replacement. */
export function StatusChip({ status, ...rest }: BaseProps & { status?: string | null }) {
  return <Chip tone={genericTone(status)} label={rest.label ?? prettify(status ?? "")} {...rest} />;
}

export { Chip as ToneChip };
