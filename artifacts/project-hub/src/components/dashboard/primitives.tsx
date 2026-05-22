import React, { useState, useEffect, useCallback } from "react";
import { Download, RefreshCw, TrendingUp, TrendingDown, Minus } from "lucide-react";
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

const KPI_TONES: Record<KpiTone, { iconText: string; iconBg: string; accentText: string; bar: string }> = {
  default: { iconText: "text-foreground/80",   iconBg: "bg-secondary",       accentText: "text-foreground",    bar: "bg-border" },
  primary: { iconText: "text-primary",         iconBg: "bg-primary/10",      accentText: "text-foreground",    bar: "bg-primary" },
  warn:    { iconText: "text-warn",            iconBg: "bg-warn/10",         accentText: "text-foreground",    bar: "bg-warn" },
  danger:  { iconText: "text-destructive",     iconBg: "bg-destructive/10",  accentText: "text-destructive",   bar: "bg-destructive" },
  success: { iconText: "text-success",         iconBg: "bg-success/10",      accentText: "text-foreground",    bar: "bg-success" },
  amber:   { iconText: "text-amber-accent",    iconBg: "bg-amber-accent/10", accentText: "text-foreground",    bar: "bg-amber-accent" },
};

export function KPITile({
  label, value, sub, icon: Icon, tone = "default", trend, trendLabel, highlight,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  tone?: KpiTone;
  /** ignored — legacy compat */
  gradient?: string;
  trend?: "up" | "down" | "flat";
  trendLabel?: string;
  /** Show a thin colored bar across the top — for critical metrics. */
  highlight?: boolean;
}) {
  const TrendIcon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;
  const trendCls = trend === "up" ? "text-success" : trend === "down" ? "text-destructive" : "text-muted-foreground";
  const t = KPI_TONES[tone];

  return (
    <div className={`group relative overflow-hidden rounded-xl bg-card text-card-foreground border border-card-border glass-surface glass-surface-hover transition-all`}>
      {highlight && <div className={`absolute top-0 left-0 right-0 h-0.5 ${t.bar}`} />}
      <div className="p-4 sm:p-5">
        <div className="flex justify-between items-start mb-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
          {Icon && (
            <div className={`p-1.5 rounded-md ${t.iconBg}`}>
              <Icon size={14} className={t.iconText} />
            </div>
          )}
        </div>
        <div className={`text-3xl font-semibold font-mono num-tabular tracking-tight truncate ${t.accentText}`}>
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

const INTERVALS = [
  { value: 60000, label: "1 min" },
  { value: 300000, label: "5 min" },
  { value: 900000, label: "15 min" },
  { value: 0, label: "Manual" },
] as const;

export function useAutoRefresh() {
  const [intervalMs, setIntervalMs] = useState(300000);
  const [lastRefreshed, setLastRefreshed] = useState(new Date());

  const markRefreshed = useCallback(() => setLastRefreshed(new Date()), []);

  return {
    intervalMs: intervalMs > 0 ? intervalMs : false as const,
    refetchInterval: intervalMs > 0 ? intervalMs : false as const,
    lastRefreshed,
    markRefreshed,
    IntervalPicker: () => (
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground font-mono">
        <RefreshCw size={11} />
        <span>
          {lastRefreshed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
        <select
          value={intervalMs}
          onChange={e => setIntervalMs(Number(e.target.value))}
          className="text-[11px] font-semibold rounded-md px-2 py-1 bg-cta text-cta-foreground border border-cta hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-cta/40 cursor-pointer transition-opacity"
        >
          {INTERVALS.map(i => (
            <option key={i.value} value={i.value}>{i.label}</option>
          ))}
        </select>
      </div>
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
    <div className={`rounded-xl bg-card text-card-foreground border border-card-border glass-surface ${className}`}>
      <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-border/60">
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
