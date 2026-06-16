// Compact executive metric tile — shared card grammar for the Portfolio + Pipeline
// stat rows. Denser than the dashboard KPITile so 6–7 fit on one row; optionally
// clickable, optionally tinted by tone, with a top accent bar for critical metrics.

import React, { useState } from "react";
import { Maximize2 } from "lucide-react";
import { TONES, type Tone } from "@/lib/status-tokens";
import { MetricDrillModal, type DrillData } from "@/components/dashboard/primitives";

export function MetricCard({
  label,
  value,
  sub,
  icon: Icon,
  tone = "muted",
  highlight,
  onClick,
  active,
  className = "",
  drill,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  tone?: Tone;
  /** Thin colored top bar — for critical metrics (blocked / escalations). */
  highlight?: boolean;
  onClick?: () => void;
  active?: boolean;
  className?: string;
  /** When set (and no onClick), the card is clickable and opens a popup
   *  listing the underlying rows that produced the number. */
  drill?: DrillData;
}) {
  const t = TONES[tone];
  const [drillOpen, setDrillOpen] = useState(false);
  // An explicit onClick wins; otherwise a drill makes the card clickable.
  const handleClick = onClick ?? (drill ? () => setDrillOpen(true) : undefined);
  const clickable = !!handleClick;
  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={!clickable}
        title={drill && !onClick ? `View underlying data for ${label}` : undefined}
        className={`group relative overflow-hidden rounded-xl bg-card text-card-foreground border text-left w-full transition-all duration-300
          ${active ? "border-primary/40 ring-1 ring-primary/30" : "border-card-border"}
          ${clickable ? "lift-card cursor-pointer hover:border-foreground/20" : "cursor-default"}
          ${className}`}
      >
        {highlight && <div className={`absolute top-0 left-0 right-0 h-0.5 ${t.dot}`} />}
        {drill && !onClick && (
          <Maximize2 size={11} className="absolute bottom-2 right-2 text-muted-foreground/0 group-hover:text-muted-foreground/60 transition-colors pointer-events-none" />
        )}
        <div className="p-3.5 sm:p-4">
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground truncate">{label}</p>
            {Icon && (
              <span className={`p-1 rounded-md ${t.wrap.split(" ")[0]} ${t.text}`}>
                <Icon size={13} />
              </span>
            )}
          </div>
          <div className={`text-2xl font-semibold font-mono num-tabular tracking-tight ${tone === "muted" ? "text-foreground" : t.text}`}>
            {value}
          </div>
          {sub && <p className="text-[10px] text-muted-foreground mt-1 truncate">{sub}</p>}
        </div>
      </button>
      {drill && (
        <MetricDrillModal
          open={drillOpen}
          onClose={() => setDrillOpen(false)}
          {...drill}
          title={drill.title ?? label}
        />
      )}
    </>
  );
}
