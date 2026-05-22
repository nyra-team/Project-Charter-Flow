import React, { useState, useEffect, useCallback } from "react";
import { Download, RefreshCw, TrendingUp, TrendingDown, Minus } from "lucide-react";
import * as XLSX from "xlsx";

// ─── RAG Badge ───────────────────────────────────────────────────────────────

const RAG_CONFIG = {
  green: { bg: "#DCFCE7", text: "#16A34A", dot: "#22C55E", label: "Green" },
  amber: { bg: "#FEF9C3", text: "#CA8A04", dot: "#EAB308", label: "Amber" },
  red:   { bg: "#FEE2E2", text: "#DC2626", dot: "#EF4444", label: "Red" },
  grey:  { bg: "#F1F5F9", text: "#64748B", dot: "#94A3B8", label: "N/A" },
};

export function RAGBadge({ status, size = "sm" }: { status?: string | null; size?: "xs" | "sm" | "md" }) {
  const key = (status ?? "grey").toLowerCase() as keyof typeof RAG_CONFIG;
  const cfg = RAG_CONFIG[key] ?? RAG_CONFIG.grey;
  const dotSize = size === "xs" ? 6 : size === "md" ? 10 : 8;
  const px = size === "xs" ? "px-1.5 py-0.5 text-[10px]" : size === "md" ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-xs";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-semibold ${px}`} style={{ background: cfg.bg, color: cfg.text }}>
      <span className="rounded-full flex-shrink-0" style={{ width: dotSize, height: dotSize, background: cfg.dot }} />
      {cfg.label}
    </span>
  );
}

// ─── KPI Tile ─────────────────────────────────────────────────────────────────

export function KPITile({
  label, value, sub, icon: Icon, gradient, trend, trendLabel,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  gradient?: string;
  trend?: "up" | "down" | "flat";
  trendLabel?: string;
}) {
  const TrendIcon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;
  const trendColor = trend === "up" ? "#10B981" : trend === "down" ? "#EF4444" : "#94A3B8";

  return (
    <div className="rounded-2xl p-5 flex items-start justify-between" style={{ background: "white", border: "1px solid #E2E8F0" }}>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-1">{label}</p>
        <div className="text-2xl font-bold text-gray-900 truncate">{value}</div>
        {(sub || trendLabel) && (
          <div className="flex items-center gap-1.5 mt-1">
            {trend && <TrendIcon size={11} style={{ color: trendColor }} />}
            <p className="text-xs text-gray-400">{trendLabel ?? sub}</p>
          </div>
        )}
      </div>
      {Icon && (
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ml-3"
          style={{ background: gradient ?? "linear-gradient(135deg,#6366F1,#8B5CF6)" }}
        >
          <Icon size={20} className="text-white" />
        </div>
      )}
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
    <span
      className="text-xs font-bold px-2 py-0.5 rounded-full"
      style={{ background: urgent ? "#FEE2E2" : "#ECFDF5", color: urgent ? "#DC2626" : "#16A34A" }}
    >
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
          <label className="text-xs text-gray-500 font-medium whitespace-nowrap">{f.label}:</label>
          <select
            value={values[f.key] ?? ""}
            onChange={e => onChange(f.key, e.target.value)}
            className="text-xs border rounded-lg px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            style={{ borderColor: "#E2E8F0" }}
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
      <div className="flex items-center gap-2">
        <RefreshCw size={12} className="text-gray-400" />
        <span className="text-xs text-gray-400">
          Last refreshed: {lastRefreshed.toLocaleTimeString()}
        </span>
        <select
          value={intervalMs}
          onChange={e => setIntervalMs(Number(e.target.value))}
          className="text-xs border rounded px-1.5 py-1 bg-white text-gray-600"
          style={{ borderColor: "#E2E8F0" }}
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
    <div
      className={`rounded-2xl p-5 ${className}`}
      style={{ background: "white", border: "1px solid #E2E8F0" }}
    >
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="font-semibold text-gray-900">{title}</h3>
          {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
          {lastRefreshed && (
            <p className="text-[10px] text-gray-300 mt-0.5">
              Updated {lastRefreshed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 ml-4">
          {actions}
          {(onExportCSV || onExportXLSX || onExportPDF) && (
            <div className="relative">
              <button
                onClick={() => setShowExport(!showExport)}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded border transition-colors"
                style={{ borderColor: "#E2E8F0" }}
              >
                <Download size={11} /> Export
              </button>
              {showExport && (
                <div
                  className="absolute right-0 top-full mt-1 rounded-lg py-1 z-20 min-w-[130px]"
                  style={{ background: "white", border: "1px solid #E2E8F0", boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}
                >
                  {onExportCSV && (
                    <button
                      className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"
                      onClick={() => { onExportCSV(); setShowExport(false); }}
                    >
                      Export CSV
                    </button>
                  )}
                  {onExportXLSX && (
                    <button
                      className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"
                      onClick={() => { onExportXLSX(); setShowExport(false); }}
                    >
                      Export Excel
                    </button>
                  )}
                  {onExportPDF && (
                    <button
                      className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"
                      onClick={() => { onExportPDF(); setShowExport(false); }}
                    >
                      Export PDF
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {children}
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
