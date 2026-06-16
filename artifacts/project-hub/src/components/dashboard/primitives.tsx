import React, { useState, useEffect, useCallback, useRef } from "react";
import { Download, RefreshCw, TrendingUp, TrendingDown, Minus, Maximize2, ArrowUpRight, Table2, Inbox } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import * as XLSX from "xlsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { HoverHint, type HoverHintRow } from "../ui-kit/HoverHint";

// ─── Metric Drill-Down ─────────────────────────────────────────────────────────
// Click any KPI card / chart → a popup listing the actual rows that produced the
// number. One shared modal so every dashboard surface behaves identically.

export type DrillColumn = {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
  /** Custom cell renderer. Receives the raw cell value and the whole row. */
  render?: (value: unknown, row: Record<string, unknown>) => React.ReactNode;
  className?: string;
};

export type DrillData = {
  /** Defaults to the card/metric label. */
  title?: string;
  subtitle?: string;
  /** Longer explanation of how the metric is calculated. */
  description?: string;
  /** Column definitions. If omitted, derived from the first row's keys. */
  columns?: DrillColumn[];
  rows: Array<Record<string, unknown>>;
  /** Optional "open the full view" deep-link rendered in the footer. */
  linkHref?: string;
  linkLabel?: string;
  /** Message when there are no rows. */
  emptyText?: string;
};

function drillCell(value: unknown): React.ReactNode {
  if (value == null || value === "") return <span className="text-muted-foreground/50">—</span>;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

export function MetricDrillModal({
  open, onClose, title, subtitle, description, columns, rows, linkHref, linkLabel, emptyText,
}: { open: boolean; onClose: () => void } & DrillData) {
  const cols: DrillColumn[] = columns && columns.length
    ? columns
    : rows.length
      ? Object.keys(rows[0]).map((k) => ({ key: k, label: k }))
      : [];

  const exportRows = () =>
    exportCSV(
      `${(title ?? "metric").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}.csv`,
      rows.map((r) =>
        Object.fromEntries(cols.map((c) => [c.label, r[c.key] == null ? "" : String(r[c.key])])),
      ),
    );

  // The column header only shows when the body is scrolled to the very top;
  // any scroll (up or down) hides it. Position-based → no flicker.
  const [hideHeader, setHideHeader] = useState(false);
  const onBodyScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setHideHeader(e.currentTarget.scrollTop > 0);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[90vw] max-w-lg h-[48vh] p-0 gap-0 overflow-hidden rounded-2xl border border-border/60 bg-card shadow-2xl flex flex-col">
        {/* Brand gradient accent strip — OHC-style */}
        <div className="h-1 shrink-0 bg-gradient-to-r from-blue-500 via-indigo-500 to-violet-500" />

        <DialogHeader className="px-4 pt-3.5 pb-2.5 border-b border-border/60 space-y-0.5 text-left">
          <div className="flex items-center gap-2">
            <DialogTitle className="text-[13px] font-semibold text-card-foreground tracking-tight">{title}</DialogTitle>
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary num-tabular">
              {rows.length}
            </span>
          </div>
          {(subtitle || description) && (
            <DialogDescription className="text-[10px] text-muted-foreground">
              {subtitle}{subtitle && description ? " · " : ""}{description}
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="overflow-y-auto overflow-x-hidden px-3 sm:px-4 py-2 flex-1" onScroll={onBodyScroll}>
          {rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
              <Inbox size={24} className="text-muted-foreground/40" />
              <p className="text-xs">{emptyText ?? "No underlying records to show."}</p>
            </div>
          ) : (
            <table className="w-full table-fixed text-[11px] border-separate border-spacing-0">
              <thead className="sticky top-0 z-10">
                <tr className="text-[9px] text-muted-foreground uppercase tracking-wider">
                  {cols.map((c, ci) => (
                    <th
                      key={c.key}
                      className={`bg-muted px-2 font-semibold border-border overflow-hidden transition-all duration-200 ${hideHeader ? "h-0 py-0 leading-[0] text-[0px] opacity-0 border-y-0" : "py-1.5 border-y"} ${ci === 0 ? "rounded-l-md border-l" : ""} ${ci === cols.length - 1 ? "rounded-r-md border-r" : ""} ${c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left"}`}
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} className="group">
                    {cols.map((c) => (
                      <td
                        key={c.key}
                        className={`px-2 py-1.5 border-b border-border/40 group-hover:bg-accent/40 transition-colors truncate ${c.align === "right" ? "text-right num-tabular" : c.align === "center" ? "text-center" : "text-left"} ${c.className ?? "text-card-foreground"}`}
                      >
                        {c.render ? c.render(row[c.key], row) : drillCell(row[c.key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-4 py-2 border-t border-border/60 bg-muted/20 rounded-b-2xl">
          {linkHref ? (
            <Link href={linkHref} onClick={onClose}>
              <button className="text-[11px] text-primary font-semibold inline-flex items-center gap-1 hover:gap-1.5 transition-all">
                {linkLabel ?? "Open full view"} <ArrowUpRight size={12} />
              </button>
            </Link>
          ) : <span />}
          {rows.length > 0 && (
            <button
              onClick={exportRows}
              className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground px-2 py-1 rounded-md border border-border hover:border-foreground/30 hover:bg-accent/40 transition-colors"
            >
              <Download size={11} /> Export CSV
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Wraps any bespoke stat-card markup to make it open the drill-down popup on
 *  click — without changing the card's existing design. Use where a custom tile
 *  (not KPITile/MetricCard) shows a backend-derived number. */
export function Drillable({
  drill, className = "", children,
}: { drill: DrillData; className?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div
        className={`group relative cursor-pointer ${className}`}
        role="button"
        tabIndex={0}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(true); } }}
        title={drill.title ? `View underlying data for ${drill.title}` : "View underlying data"}
      >
        <Maximize2 size={12} className="absolute top-2.5 right-2.5 text-muted-foreground/0 group-hover:text-muted-foreground/60 transition-colors pointer-events-none z-10" />
        {children}
      </div>
      <MetricDrillModal open={open} onClose={() => setOpen(false)} {...drill} />
    </>
  );
}

// ─── RAG Badge ───────────────────────────────────────────────────────────────

type RagKey = "green" | "amber" | "red" | "grey";

const RAG_CLASSES: Record<RagKey, { wrap: string; dot: string; ring: string; label: string }> = {
  green: { wrap: "bg-success/10 text-success border-success/20",                  dot: "bg-success",          ring: "ring-success/30",     label: "Green" },
  amber: { wrap: "bg-warn/10 text-warn border-warn/20",                           dot: "bg-warn",             ring: "ring-warn/30",        label: "Amber" },
  red:   { wrap: "bg-destructive/10 text-destructive border-destructive/20",      dot: "bg-destructive",      ring: "ring-destructive/30", label: "Red" },
  grey:  { wrap: "bg-muted text-muted-foreground border-border",                  dot: "bg-muted-foreground/60", ring: "ring-border",      label: "N/A" },
};

export function RAGBadge({ status, size = "sm" }: { status?: string | null; size?: "xs" | "sm" | "md" }) {
  const key = ((status ?? "grey").toLowerCase() as RagKey);
  const cfg = RAG_CLASSES[key] ?? RAG_CLASSES.grey;
  const dotSize = size === "xs" ? "w-1.5 h-1.5" : size === "md" ? "w-2.5 h-2.5" : "w-2 h-2";
  const px = size === "xs" ? "px-1.5 py-0.5 text-[10px]" : size === "md" ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-[11px]";
  return (
    <span className={`inline-flex items-center gap-1.5 font-medium font-mono uppercase tracking-wider rounded-sm border ${px} ${cfg.wrap}`}>
      <span className={`rounded-full flex-shrink-0 ${dotSize} ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

/** RAG dot with ring — Command Center style. */
export function RAGDot({ status, size = "sm" }: { status?: string | null; size?: "xs" | "sm" | "md" }) {
  const key = ((status ?? "grey").toLowerCase() as RagKey);
  const cfg = RAG_CLASSES[key] ?? RAG_CLASSES.grey;
  const sz = size === "xs" ? "w-2 h-2" : size === "md" ? "w-3 h-3" : "w-2.5 h-2.5";
  return (
    <span className={`inline-block rounded-full ring-2 ring-offset-2 ring-offset-card ${sz} ${cfg.dot} ${cfg.ring}`} />
  );
}

// ─── KPI Tile ─────────────────────────────────────────────────────────────────
// Command Center structure: secondary icon pill top-right, large mono numeral,
// uppercase label, trend caption. Highlight variant gets a top accent bar.

type KpiTone = "default" | "primary" | "warn" | "danger" | "success" | "amber";

const KPI_TONES: Record<KpiTone, { iconText: string; iconBg: string; accentText: string; bar: string; glow: string; hoverBorder: string; featBg: string; featBorder: string }> = {
  default: { iconText: "text-foreground/80",   iconBg: "bg-secondary",       accentText: "text-foreground",    bar: "bg-border",         glow: "from-primary/10",      hoverBorder: "hover:border-primary/40",       featBg: "from-primary/[0.06]",       featBorder: "border-primary/30" },
  primary: { iconText: "text-primary",         iconBg: "bg-primary/10",      accentText: "text-foreground",    bar: "bg-primary",        glow: "from-primary/12",      hoverBorder: "hover:border-primary/50",       featBg: "from-primary/[0.10]",       featBorder: "border-primary/35" },
  warn:    { iconText: "text-warn",            iconBg: "bg-warn/10",         accentText: "text-foreground",    bar: "bg-warn",           glow: "from-warn/12",         hoverBorder: "hover:border-warn/50",          featBg: "from-warn/[0.12]",          featBorder: "border-warn/35" },
  danger:  { iconText: "text-destructive",     iconBg: "bg-destructive/10",  accentText: "text-destructive",   bar: "bg-destructive",    glow: "from-destructive/12",  hoverBorder: "hover:border-destructive/50",   featBg: "from-destructive/[0.12]",   featBorder: "border-destructive/35" },
  success: { iconText: "text-success",         iconBg: "bg-success/10",      accentText: "text-foreground",    bar: "bg-success",        glow: "from-success/12",      hoverBorder: "hover:border-success/50",       featBg: "from-success/[0.12]",       featBorder: "border-success/35" },
  amber:   { iconText: "text-amber-accent",    iconBg: "bg-amber-accent/10", accentText: "text-foreground",    bar: "bg-amber-accent",   glow: "from-amber-accent/12", hoverBorder: "hover:border-amber-accent/50",  featBg: "from-amber-accent/[0.12]",  featBorder: "border-amber-accent/35" },
};

export function KPITile({
  label, value, sub, icon: Icon, tone = "default", trend, trendLabel, highlight, compact = false, featured = false, valueClassName, drill, caption, hint,
}: {
  label: string;
  value: string | number;
  sub?: string;
  /** Small italic formula / methodology line shown at the bottom of the tile. */
  caption?: string;
  /** Standardized hover card explaining how the metric is measured (HoverHint). */
  hint?: { title?: React.ReactNode; rows?: HoverHintRow[]; footer?: React.ReactNode };
  /** Override the value's text color (e.g. "text-success" / "text-warn"). */
  valueClassName?: string;
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  tone?: KpiTone;
  /** ignored — legacy compat */
  gradient?: string;
  trend?: "up" | "down" | "flat";
  trendLabel?: string;
  /** Show a thin colored bar across the top — for critical metrics. */
  highlight?: boolean;
  /** Smaller padding + value — for dense KPI rows. */
  compact?: boolean;
  /** Hero treatment — larger numeral, tone-tinted wash, always-on accent bar
   *  and shimmer. For the few headline KPIs that should dominate the view. */
  featured?: boolean;
  /** When set, the tile is clickable and opens a popup listing the underlying rows. */
  drill?: DrillData;
}) {
  const TrendIcon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;
  const trendCls = trend === "up" ? "text-success" : trend === "down" ? "text-destructive" : "text-muted-foreground";
  const t = KPI_TONES[tone];
  const [drillOpen, setDrillOpen] = useState(false);
  const interactive = !!drill;

  const tile = (
      <div
        className={`group relative overflow-hidden rounded-xl bg-card text-card-foreground border glass-surface glass-surface-hover lift-card ${t.hoverBorder} ${featured ? `${t.featBorder} shadow-lg shimmer-on-hover` : "border-card-border"} ${interactive ? "cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring/40" : ""}`}
        onClick={interactive ? () => setDrillOpen(true) : undefined}
        role={interactive ? "button" : undefined}
        tabIndex={interactive ? 0 : undefined}
        onKeyDown={interactive ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDrillOpen(true); } } : undefined}
        title={interactive && !hint ? `View underlying data for ${label}` : undefined}
      >
        {/* Featured: a persistent tone wash so the headline KPIs stand apart. */}
        {featured && (
          <div aria-hidden className={`absolute inset-0 bg-gradient-to-br ${t.featBg} via-transparent to-transparent pointer-events-none`} />
        )}
        {/* Tone glow wash — appears on hover */}
        <div
          aria-hidden
          className={`absolute inset-0 bg-gradient-to-br ${t.glow} to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none`}
        />
        {(highlight || featured) && <div className={`absolute top-0 left-0 right-0 ${featured ? "h-1" : "h-0.5"} ${t.bar}`} />}
        {interactive && (
          <Maximize2 size={12} className="absolute bottom-2.5 right-2.5 text-muted-foreground/0 group-hover:text-muted-foreground/60 transition-colors pointer-events-none" />
        )}
        <div className={`relative ${featured ? "p-4 sm:p-5" : compact ? "p-2.5" : "p-3 sm:p-3.5"}`}>
          <div className={`flex justify-between items-center ${featured ? "mb-2" : compact ? "mb-1" : "mb-1.5"}`}>
            <p className={`font-semibold uppercase tracking-[0.14em] text-muted-foreground ${featured ? "text-[11px]" : "text-[10px]"}`}>{label}</p>
            {Icon && (
              <div className={`rounded-lg ${t.iconBg} transition-transform duration-300 group-hover:scale-105 ${featured ? "p-2" : "p-1 rounded-md"}`}>
                <Icon size={featured ? 18 : 13} className={t.iconText} />
              </div>
            )}
          </div>
          <div className={`font-semibold font-mono num-tabular tracking-tight truncate ${featured ? "text-3xl sm:text-4xl" : compact ? "text-lg" : "text-2xl"} ${valueClassName ?? t.accentText}`}>
            {value}
          </div>
          {(sub || trendLabel) && (
            <div className={`flex items-center gap-1.5 ${featured ? "mt-1.5" : "mt-1"}`}>
              {trend && <TrendIcon size={featured ? 12 : 10} className={trendCls} />}
              <p className={`font-mono ${featured ? "text-[11px]" : "text-[10px]"} ${trend ? trendCls : "text-muted-foreground"}`}>
                {trendLabel ?? sub}
              </p>
            </div>
          )}
          {caption && (
            <p className="mt-1.5 pt-1.5 border-t border-card-border/60 text-[9px] leading-snug font-mono italic text-muted-foreground/80">
              {caption}
            </p>
          )}
        </div>
      </div>
  );

  return (
    <>
      {hint ? (
        <HoverHint side="top" title={hint.title ?? `How ${label} is measured`} rows={hint.rows} footer={hint.footer}>
          {tile}
        </HoverHint>
      ) : (
        tile
      )}
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

// ─── SLA Countdown ────────────────────────────────────────────────────────────

export function SLACountdown({ deadline }: { deadline: string | Date }) {
  const [remaining, setRemaining] = useState("");
  const [urgent, setUrgent] = useState(false);

  useEffect(() => {
    function compute() {
      const now = Date.now();
      const end = new Date(deadline).getTime();
      const diff = end - now;
      if (diff <= 0) { setRemaining("Overdue"); setUrgent(true); return; }
      const hours = Math.floor(diff / 3600000);
      const mins = Math.floor((diff % 3600000) / 60000);
      setUrgent(hours < 24);
      setRemaining(hours >= 48 ? `${Math.floor(hours / 24)}d` : `${hours}h ${mins}m`);
    }
    compute();
    const id = setInterval(compute, 60000);
    return () => clearInterval(id);
  }, [deadline]);

  return (
    <span className={`text-xs font-mono font-semibold px-2 py-0.5 rounded-sm border ${
      urgent ? "bg-destructive/10 text-destructive border-destructive/20" : "bg-success/10 text-success border-success/20"
    }`}>
      {remaining}
    </span>
  );
}

// ─── Filter Bar ───────────────────────────────────────────────────────────────

export type FilterDef = {
  key: string;
  label: string;
  options: Array<{ value: string; label: string }>;
};

export function FilterBar({
  filters, values, onChange,
}: {
  filters: FilterDef[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2 items-center">
      {filters.map(f => (
        <div key={f.key} className="flex items-center gap-1.5">
          <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground whitespace-nowrap">{f.label}</label>
          <select
            value={values[f.key] ?? ""}
            onChange={e => onChange(f.key, e.target.value)}
            className="text-xs rounded-md px-2 py-1.5 bg-card text-card-foreground border border-border focus:outline-none focus:ring-2 focus:ring-ring/40"
          >
            <option value="">All</option>
            {f.options.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}

// ─── Auto-Refresh Hook ────────────────────────────────────────────────────────

/** Fixed background poll interval shared by every dashboard. 5 minutes is a
 *  reasonable balance between freshness and API load for a PMO workload. */
const AUTO_REFRESH_MS = 300000;

export function useAutoRefresh() {
  const qc = useQueryClient();
  const [lastRefreshed, setLastRefreshed] = useState(new Date());
  const [spinning, setSpinning] = useState(false);

  const markRefreshed = useCallback(() => setLastRefreshed(new Date()), []);

  const refreshNow = useCallback(async () => {
    setSpinning(true);
    try {
      await qc.invalidateQueries();
      setLastRefreshed(new Date());
    } finally {
      // brief spin so the user sees feedback even on fast responses
      setTimeout(() => setSpinning(false), 400);
    }
  }, [qc]);

  return {
    refetchInterval: AUTO_REFRESH_MS,
    lastRefreshed,
    markRefreshed,
    RefreshButton: () => (
      <button
        type="button"
        onClick={refreshNow}
        disabled={spinning}
        aria-label="Refresh dashboard"
        title="Refresh dashboard"
        className="group inline-flex items-center justify-center w-9 h-9 rounded-md text-muted-foreground hover:text-card-foreground bg-card/60 hover:bg-card border border-border/60 hover:border-border transition-all duration-200 hover:shadow-sm hover:-translate-y-px disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <RefreshCw size={14} className={`transition-transform duration-300 ${spinning ? "animate-spin" : ""}`} />
      </button>
    ),
  };
}

// ─── Dashboard Card ───────────────────────────────────────────────────────────

export function DashboardCard({
  title, subtitle, children, className = "", actions,
  onExportCSV, onExportXLSX, onExportPDF, lastRefreshed,
  variant = "default", drill, drillBodyClickable = true,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
  actions?: React.ReactNode;
  onExportCSV?: () => void;
  onExportXLSX?: () => void;
  onExportPDF?: () => void;
  lastRefreshed?: Date;
  /** "mono" gives the Command Center tactical look (mono title, monospace meta). */
  variant?: "default" | "mono";
  /** When set, the card body (e.g. a chart) is clickable and opens a popup
   *  listing the underlying rows. A "Data" button is also added to the header. */
  drill?: DrillData;
  /** Set false when the body already has its own click behavior (e.g. a chart
   *  whose slices filter a table) — only the header "Data" button opens the popup. */
  drillBodyClickable?: boolean;
}) {
  const [showExport, setShowExport] = useState(false);
  const [drillOpen, setDrillOpen] = useState(false);
  const titleCls = variant === "mono"
    ? "text-[13px] font-semibold text-card-foreground tracking-tight"
    : "text-[14px] font-semibold text-card-foreground tracking-tight";

  return (
    /* isolation:isolate gives card its own stacking context so the
       export dropdown stays above neighbours during hover lift */
    <div className={`group relative isolate min-w-0 rounded-xl bg-card text-card-foreground border border-card-border glass-surface lift-card ${className}`}>
      <div className="relative flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-border/60">
        {/* Animated underline beneath the header — grows in on mount */}
        <span aria-hidden className="absolute bottom-0 left-5 right-5 h-px line-grow bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
        <div className="min-w-0">
          <h3 className={`${titleCls} truncate`}>{title}</h3>
          {subtitle && <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{subtitle}</p>}
          {lastRefreshed && (
            <p className="text-[10px] text-muted-foreground/70 mt-0.5 font-mono">
              Updated {lastRefreshed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 ml-2 flex-shrink-0">
          {actions}
          {drill && (
            <button
              type="button"
              onClick={() => setDrillOpen(true)}
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground px-2 py-1 rounded-md border border-border hover:border-foreground/30 transition-colors"
              title={`View underlying data for ${title}`}
            >
              <Table2 size={11} /> Data
            </button>
          )}
          {(onExportCSV || onExportXLSX || onExportPDF) && (
            <div className="relative">
              <button
                onClick={() => setShowExport(!showExport)}
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground px-2 py-1 rounded-md border border-border hover:border-foreground/30 transition-colors"
              >
                <Download size={11} /> Export
              </button>
              {showExport && (
                <div className="absolute right-0 top-full mt-1 rounded-md py-1 z-20 min-w-[140px] bg-popover text-popover-foreground border border-popover-border shadow-lg">
                  {onExportCSV && (
                    <button className="w-full text-left px-3 py-2 text-xs hover:bg-accent" onClick={() => { onExportCSV(); setShowExport(false); }}>
                      Export CSV
                    </button>
                  )}
                  {onExportXLSX && (
                    <button className="w-full text-left px-3 py-2 text-xs hover:bg-accent" onClick={() => { onExportXLSX(); setShowExport(false); }}>
                      Export Excel
                    </button>
                  )}
                  {onExportPDF && (
                    <button className="w-full text-left px-3 py-2 text-xs hover:bg-accent" onClick={() => { onExportPDF(); setShowExport(false); }}>
                      Export PDF
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <div
        className={`p-5 ${drill && drillBodyClickable ? "cursor-pointer" : ""}`}
        onClick={drill && drillBodyClickable ? () => setDrillOpen(true) : undefined}
        title={drill && drillBodyClickable ? `View underlying data for ${title}` : undefined}
      >
        {children}
      </div>
      {drill && (
        <MetricDrillModal
          open={drillOpen}
          onClose={() => setDrillOpen(false)}
          {...drill}
          title={drill.title ?? title}
          subtitle={drill.subtitle ?? subtitle}
        />
      )}
    </div>
  );
}

// ─── Export Utilities ─────────────────────────────────────────────────────────

export function exportCSV(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(","),
    ...rows.map(r =>
      headers.map(h => {
        const v = String(r[h] ?? "").replace(/"/g, '""');
        return v.includes(",") || v.includes('"') || v.includes("\n") ? `"${v}"` : v;
      }).join(",")
    ),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportXLSX(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Data");
  XLSX.writeFile(wb, filename);
}

export function exportPDF(title: string) {
  const printStyle = document.createElement("style");
  printStyle.id = "__dash_print_style";
  printStyle.textContent = `
    @media print {
      body > * { display: none !important; }
      #__print_target { display: block !important; }
    }
  `;
  document.head.appendChild(printStyle);
  const target = document.querySelector("[data-print-target]");
  if (target) target.id = "__print_target";
  document.title = title;
  window.print();
  printStyle.remove();
  if (target) target.removeAttribute("id");
}
