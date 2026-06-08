import React, { useState, useEffect, useCallback } from "react";
import { Download, RefreshCw, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";

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

const KPI_TONES: Record<KpiTone, { iconText: string; iconBg: string; accentText: string; bar: string; glow: string }> = {
  default: { iconText: "text-foreground/80",   iconBg: "bg-secondary",       accentText: "text-foreground",    bar: "bg-border",         glow: "from-transparent" },
  primary: { iconText: "text-primary",         iconBg: "bg-primary/10",      accentText: "text-foreground",    bar: "bg-primary",        glow: "from-primary/12" },
  warn:    { iconText: "text-warn",            iconBg: "bg-warn/10",         accentText: "text-foreground",    bar: "bg-warn",           glow: "from-warn/12" },
  danger:  { iconText: "text-destructive",     iconBg: "bg-destructive/10",  accentText: "text-destructive",   bar: "bg-destructive",    glow: "from-destructive/12" },
  success: { iconText: "text-success",         iconBg: "bg-success/10",      accentText: "text-foreground",    bar: "bg-success",        glow: "from-success/12" },
  amber:   { iconText: "text-amber-accent",    iconBg: "bg-amber-accent/10", accentText: "text-foreground",    bar: "bg-amber-accent",   glow: "from-amber-accent/12" },
};

export function KPITile({
  label, value, sub, icon: Icon, tone = "default", trend, trendLabel, highlight, compact = false, valueClassName,
}: {
  label: string;
  value: string | number;
  sub?: string;
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
}) {
  const TrendIcon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;
  const trendCls = trend === "up" ? "text-success" : trend === "down" ? "text-destructive" : "text-muted-foreground";
  const t = KPI_TONES[tone];

  return (
    <div className={`group relative overflow-hidden rounded-xl bg-card text-card-foreground border border-card-border glass-surface glass-surface-hover lift-card`}>
      {/* Tone glow wash — appears on hover */}
      <div
        aria-hidden
        className={`absolute inset-0 bg-gradient-to-br ${t.glow} to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none`}
      />
      {highlight && <div className={`absolute top-0 left-0 right-0 h-0.5 ${t.bar}`} />}
      <div className={`relative ${compact ? "p-3" : "p-4 sm:p-5"}`}>
        <div className={`flex justify-between items-start ${compact ? "mb-1.5" : "mb-3"}`}>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
          {Icon && (
            <div className={`p-1.5 rounded-md ${t.iconBg} transition-transform duration-300 group-hover:scale-105`}>
              <Icon size={14} className={t.iconText} />
            </div>
          )}
        </div>
        <div className={`font-semibold font-mono num-tabular tracking-tight truncate ${compact ? "text-xl" : "text-3xl"} ${valueClassName ?? t.accentText}`}>
          {value}
        </div>
        {(sub || trendLabel) && (
          <div className="flex items-center gap-1.5 mt-2">
            {trend && <TrendIcon size={10} className={trendCls} />}
            <p className={`text-[10px] font-mono ${trend ? trendCls : "text-muted-foreground"}`}>
              {trendLabel ?? sub}
            </p>
          </div>
        )}
      </div>
    </div>
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
  variant = "default",
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
}) {
  const [showExport, setShowExport] = useState(false);
  const titleCls = variant === "mono"
    ? "text-[13px] font-semibold text-card-foreground tracking-tight"
    : "text-[14px] font-semibold text-card-foreground tracking-tight";

  return (
    /* isolation:isolate gives card its own stacking context so the
       export dropdown stays above neighbours during hover lift */
    <div className={`group relative isolate rounded-xl bg-card text-card-foreground border border-card-border glass-surface lift-card ${className}`}>
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
      <div className="p-5">{children}</div>
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
