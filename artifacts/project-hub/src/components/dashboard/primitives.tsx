import React, { useState, useEffect, useCallback } from "react";
import { Download, RefreshCw, TrendingUp, TrendingDown, Minus } from "lucide-react";
import * as XLSX from "xlsx";

// ─── RAG Badge ───────────────────────────────────────────────────────────────

type RagKey = "green" | "amber" | "red" | "grey";

const RAG_CLASSES: Record<RagKey, { wrap: string; dot: string; label: string }> = {
  green: { wrap: "bg-success/10 text-success border-success/20",     dot: "bg-success",     label: "Green" },
  amber: { wrap: "bg-warn/10 text-warn border-warn/20",              dot: "bg-warn",        label: "Amber" },
  red:   { wrap: "bg-destructive/10 text-destructive border-destructive/20", dot: "bg-destructive", label: "Red" },
  grey:  { wrap: "bg-muted text-muted-foreground border-border",     dot: "bg-muted-foreground/60", label: "N/A" },
};

export function RAGBadge({ status, size = "sm" }: { status?: string | null; size?: "xs" | "sm" | "md" }) {
  const key = ((status ?? "grey").toLowerCase() as RagKey);
  const cfg = RAG_CLASSES[key] ?? RAG_CLASSES.grey;
  const dotSize = size === "xs" ? "w-1.5 h-1.5" : size === "md" ? "w-2.5 h-2.5" : "w-2 h-2";
  const px = size === "xs" ? "px-1.5 py-0.5 text-[10px]" : size === "md" ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-xs";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-semibold border ${px} ${cfg.wrap}`}>
      <span className={`rounded-full flex-shrink-0 ${dotSize} ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

// ─── KPI Tile ─────────────────────────────────────────────────────────────────

type KpiTone = "default" | "primary" | "warn" | "danger" | "success";

const KPI_TONES: Record<KpiTone, { ring: string; icon: string; iconBg: string; accentText: string }> = {
  default: { ring: "ring-1 ring-border",                icon: "text-foreground/80",   iconBg: "bg-muted",           accentText: "text-foreground" },
  primary: { ring: "ring-1 ring-primary/30",            icon: "text-primary",         iconBg: "bg-primary/10",      accentText: "text-primary" },
  warn:    { ring: "ring-1 ring-warn/30",               icon: "text-warn",            iconBg: "bg-warn/10",         accentText: "text-warn" },
  danger:  { ring: "ring-1 ring-destructive/40",        icon: "text-destructive",     iconBg: "bg-destructive/10",  accentText: "text-destructive" },
  success: { ring: "ring-1 ring-success/30",            icon: "text-success",         iconBg: "bg-success/10",      accentText: "text-success" },
};

export function KPITile({
  label, value, sub, icon: Icon, tone = "default", trend, trendLabel,
  // legacy `gradient` prop ignored — kept for compat
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  tone?: KpiTone;
  gradient?: string;
  trend?: "up" | "down" | "flat";
  trendLabel?: string;
}) {
  const TrendIcon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;
  const trendCls = trend === "up" ? "text-success" : trend === "down" ? "text-destructive" : "text-muted-foreground";
  const t = KPI_TONES[tone];

  return (
    <div className={`group relative rounded-xl p-5 bg-card text-card-foreground border border-card-border shadow-xs hover:shadow-md transition-all hover:-translate-y-0.5 ${t.ring}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground mb-2">
            {label}
          </p>
          <div className={`text-3xl font-serif font-semibold tracking-tight num-tabular truncate ${t.accentText}`}>
            {value}
          </div>
          {(sub || trendLabel) && (
            <div className="flex items-center gap-1.5 mt-2">
              {trend && <TrendIcon size={11} className={trendCls} />}
              <p className={`text-[11px] ${trend ? trendCls : "text-muted-foreground"}`}>
                {trendLabel ?? sub}
              </p>
            </div>
          )}
        </div>
        {Icon && (
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${t.iconBg}`}>
            <Icon size={18} className={t.icon} />
          </div>
        )}
      </div>
      {/* Subtle bottom accent line on hover */}
      <span className={`absolute left-5 right-5 bottom-0 h-px scale-x-0 group-hover:scale-x-100 origin-left transition-transform ${t.iconBg} opacity-80`} />
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
    <span className={`text-xs font-mono font-semibold px-2 py-0.5 rounded-full border ${
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
  filters,
  values,
  onChange,
}: {
  filters: FilterDef[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2 items-center">
      {filters.map(f => (
        <div key={f.key} className="flex items-center gap-1.5">
          <label className="text-xs text-muted-foreground font-medium whitespace-nowrap">{f.label}:</label>
          <select
            value={values[f.key] ?? ""}
            onChange={e => onChange(f.key, e.target.value)}
            className="text-xs border rounded-md px-2 py-1.5 bg-card text-card-foreground border-border focus:outline-none focus:ring-2 focus:ring-ring/40"
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
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <RefreshCw size={12} />
        <span className="font-mono">
          Updated {lastRefreshed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
        <select
          value={intervalMs}
          onChange={e => setIntervalMs(Number(e.target.value))}
          className="text-xs border rounded-md px-1.5 py-1 bg-card text-card-foreground border-border focus:outline-none focus:ring-2 focus:ring-ring/40"
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
}) {
  const [showExport, setShowExport] = useState(false);

  return (
    <div className={`rounded-xl bg-card text-card-foreground border border-card-border shadow-xs ${className}`}>
      <div className="flex items-start justify-between px-5 pt-4 pb-3 border-b border-border/60">
        <div className="min-w-0">
          <h3 className="font-serif font-semibold text-[15px] text-card-foreground tracking-tight truncate">{title}</h3>
          {subtitle && <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{subtitle}</p>}
          {lastRefreshed && (
            <p className="text-[10px] text-muted-foreground/70 mt-0.5 font-mono">
              Updated {lastRefreshed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 ml-4 flex-shrink-0">
          {actions}
          {(onExportCSV || onExportXLSX || onExportPDF) && (
            <div className="relative">
              <button
                onClick={() => setShowExport(!showExport)}
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground px-2 py-1 rounded border border-border hover:border-foreground/30 transition-colors"
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
