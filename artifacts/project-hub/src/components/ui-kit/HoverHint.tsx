// HoverHint — the single, standard hover-content surface for the PMO app.
//
// Wraps Radix Tooltip (TooltipProvider is mounted globally in App.tsx) with the
// app's popover design language so every hover card looks identical:
//   - plain `label` → one-line tooltip
//   - `title` / `rows` / `footer` → rich "citation" card (label · value rows
//     with an optional rule/source footer), used e.g. by the dashboard's
//     Issues Requiring Attention list.
//
// Prefer this over native `title=` attributes (unstylable) and over hand-rolled
// hover divs. For Recharts, spread `chartTooltipProps` instead.

import type { ReactNode } from "react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Info } from "lucide-react";

export type HoverHintRow = { label: string; value: ReactNode };

export function HoverHint({
  children, label, title, rows, footer, side = "top", align = "center", className,
}: {
  children: ReactNode;
  /** Simple one-line hint. Ignored when `rows`/`title` are provided. */
  label?: ReactNode;
  /** Heading of a rich hint card. */
  title?: ReactNode;
  /** Label · value lines of a rich hint card. */
  rows?: HoverHintRow[];
  /** Muted footer line — the rule / data source ("citation"). */
  footer?: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  className?: string;
}) {
  const rich = !!(title || rows?.length || footer);
  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} align={align} className={rich ? `max-w-[240px] p-0 ${className ?? ""}` : className}>
        {rich ? (
          <div className="text-left">
            {title && (
              <p className="px-2.5 pt-2 pb-1 text-[10px] font-semibold text-popover-foreground border-b border-popover-border/60">
                {title}
              </p>
            )}
            {rows && rows.length > 0 && (
              <div className="px-2.5 py-1.5 space-y-0.5">
                {rows.map((r, i) => (
                  <div key={i} className="flex items-baseline justify-between gap-3 text-[10px]">
                    <span className="text-muted-foreground">{r.label}</span>
                    <span className="font-medium text-popover-foreground text-right num-tabular">{r.value}</span>
                  </div>
                ))}
              </div>
            )}
            {footer && (
              <p className="px-2.5 pb-2 pt-1 text-[9px] leading-snug text-muted-foreground border-t border-popover-border/60 flex items-start gap-1">
                <Info size={9} className="mt-0.5 flex-shrink-0 text-primary" />
                <span>{footer}</span>
              </p>
            )}
          </div>
        ) : (
          label
        )}
      </TooltipContent>
    </Tooltip>
  );
}

// Shared Recharts <Tooltip> styling — spread into every chart tooltip so all
// charts match the popover surface in BOTH themes (several charts previously
// hardcoded a dark #1E293B background that broke in light mode).
export const chartTooltipProps = {
  contentStyle: {
    background: "hsl(var(--popover))",
    border: "1px solid hsl(var(--popover-border))",
    borderRadius: 8,
    fontSize: 12,
    color: "hsl(var(--popover-foreground))",
    boxShadow: "0 8px 24px -8px hsl(var(--foreground) / 0.18)",
  },
  itemStyle: { color: "hsl(var(--popover-foreground))" },
  labelStyle: { color: "hsl(var(--muted-foreground))" },
} as const;
