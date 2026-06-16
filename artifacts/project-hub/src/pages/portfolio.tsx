import { useListProjects, useListPortfolios } from "@workspace/api-client-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { BarChart2, DollarSign, SlidersHorizontal, Check } from "lucide-react";
import { useLocation } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useMemo, useRef, useEffect } from "react";
import { DashboardCard, KPITile, FilterBar, exportCSV, type DrillColumn } from "../components/dashboard/primitives";
import { formatCurrency } from "../lib/format";
import { MondayBoard, ProgressCell, DateCell, TextCell, type BoardColumn, type BoardGroup } from "@/components/monday";
import { StatusChip, PageHeader } from "@/components/ui-kit";
import { PriorityChip, RagDot } from "@/components/task-status-chip";
import { TASK_PRIORITIES, fmtVariance } from "@/lib/task-constants";
import { chartTooltipProps } from "@/components/ui-kit";

const RAG_COLORS = { green: "#22C55E", amber: "#EAB308", red: "#EF4444", grey: "#94A3B8" };

// Computed project health — industry-standard EVM Schedule Performance Index.
// Health is NOT absolute progress; it's actual progress vs the progress you'd
// EXPECT given how much of the planned timeline has elapsed (Planned Value).
//
//   SPI = actual% / expected%   (expected% = elapsed / total duration × 100)
//     SPI ≥ 0.95          → Green   (on / ahead of schedule)
//     0.85 ≤ SPI < 0.95   → Amber   (minor slip — watch)
//     SPI < 0.85          → Red     (significant slip — off track)
//
// Universal gates applied first: completed/100% = Green, past end date and not
// done = Red (overdue), not yet started = Green, no dates = Grey (can't assess).
// Budget can only DOWNGRADE health when real variance data exists — the table
// stores budgets, not actual spend, so cost is neutral until that's available.
// This is a display signal; the manually-set rag_status is left untouched.
function projectHealth(p: {
  progress?: number | null; status?: string | null;
  startDate?: string | null; endDate?: string | null;
  budgetVariancePct?: number | null; budgetThresholdPct?: number | null;
}): "green" | "amber" | "red" | "grey" {
  const status = (p.status ?? "").toLowerCase();
  const progress = p.progress ?? 0;
  if (status === "completed" || status === "closed" || progress >= 100) return "green";
  if (!p.startDate || !p.endDate) return "grey"; // no schedule baseline → unrated

  const now = Date.now();
  const s = Math.min(new Date(p.startDate).getTime(), new Date(p.endDate).getTime());
  const e = Math.max(new Date(p.startDate).getTime(), new Date(p.endDate).getTime());
  if (now < s) return "green";  // hasn't started — on track by default
  if (now > e) return "red";    // past the deadline and not complete — overdue

  const expected = e > s ? ((now - s) / (e - s)) * 100 : 100;
  const spi = expected > 0 ? progress / expected : 1;
  let health: "green" | "amber" | "red" = spi >= 0.95 ? "green" : spi >= 0.85 ? "amber" : "red";

  // Cost overlay (worst-wins) — only when actual budget variance is present.
  if (p.budgetVariancePct != null) {
    const tol = p.budgetThresholdPct ?? 10; // org tolerance (budget_threshold_pct, default 10%)
    const budget = p.budgetVariancePct <= tol * 0.5 ? "green" : p.budgetVariancePct <= tol ? "amber" : "red";
    const rank = { green: 0, amber: 1, red: 2 } as const;
    if (rank[budget] > rank[health]) health = budget;
  }
  return health;
}

// Structural subset of a project row used by the Monday board on this page.
interface PortfolioRow {
  id: number; name: string; status: string; priority: string;
  ragStatus?: string | null; progress?: number | null; startDate?: string | null; endDate?: string | null;
  capexBudget?: number | null; opexBudget?: number | null;
  scheduleVarianceDays?: number | null; budgetVarianceAmount?: number | null; budgetVariancePct?: number | null;
  budgetThresholdPct?: number | null;
  function?: string | null;
}

// Clean, enterprise-grade "Timeline" cell: a single full-width purple bar with
// the start date at the left and end date at the right. No axis, grid, today
// marker or scale positioning — every row reads the same, calm width.
function TimelineBar({ start, end }: { start?: string | null; end?: string | null }) {
  if (!start || !end) {
    return <span className="text-[10px] italic text-muted-foreground/50">no dates</span>;
  }
  const t0 = new Date(start).getTime(), t1 = new Date(end).getTime();
  const lo = Math.min(t0, t1), hi = Math.max(t0, t1);
  const fmt = (d: number) => new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  return (
    <div className="w-full pr-1" title={`${fmt(lo)} → ${fmt(hi)}`}>
      <div
        className="flex items-center justify-between gap-2 h-4 w-full rounded-full px-2.5"
        style={{ background: "linear-gradient(90deg, #7C3AED, #9333EA)" }}
      >
        <span className="text-[10px] font-semibold tabular-nums text-white whitespace-nowrap leading-none">{fmt(lo)}</span>
        <span className="text-[10px] font-semibold tabular-nums text-white whitespace-nowrap leading-none">{fmt(hi)}</span>
      </div>
    </div>
  );
}

// Canonical project-status vocabulary for the Portfolio — drives the Status
// filter dropdown, the board's status groups, and the status chips.
const STATUS_GROUP_META: { key: string; label: string; color: string }[] = [
  { key: "new", label: "New", color: "#6366F1" },
  { key: "active", label: "Active", color: "#F59E0B" },
  { key: "completed", label: "Completed", color: "#10B981" },
  { key: "cancelled", label: "Cancelled", color: "#EF4444" },
  { key: "postponed", label: "Postponed", color: "#94A3B8" },
];
// Status → display label, shared with the group headers.
const STATUS_LABEL: Record<string, string> = Object.fromEntries(STATUS_GROUP_META.map(g => [g.key, g.label]));

// "Status" filter options — derived from the canonical list above so the
// dropdown, board groups and chips never drift apart.
const STATUS_OPTS = STATUS_GROUP_META.map(g => ({ value: g.key, label: g.label }));
const PRIORITY_OPTS = TASK_PRIORITIES.map(p => ({ value: p.value, label: p.label }));
// Investment category a project belongs to.
// "All" is auto-prepended by FilterBar; order here = All, CAPEX, OPEX, NPL, CIP, IT.
const CATEGORY_OPTS = ["CAPEX", "OPEX", "NPL", "CIP", "IT"].map(v => ({ value: v, label: v }));

export default function PortfolioView() {
  const { data: projects, isLoading: loadingProjects } = useListProjects();
  const { data: portfolios, isLoading: loadingPortfolios } = useListPortfolios();
  const [, setLocation] = useLocation();

  const [filters, setFilters] = useState<Record<string, string>>({});
  // Set by clicking a slice/legend in the Project Health pie; filters the
  // table below to that RAG color ("" = no health filter). Click again clears.
  const [ragFilter, setRagFilter] = useState<string>("");
  const handleFilter = (k: string, v: string) => setFilters(f => ({ ...f, [k]: v }));

  const deptOptions = useMemo(() => {
    const derived = (projects ?? []).map(p => (p as unknown as Record<string, unknown>).function as string).filter(Boolean);
    // Always offer HR (and any departments present in the data). HR is pinned so
    // it can be selected even before an HR project loads; selecting it filters
    // the fetched projects down to function === "HR".
    const depts = [...new Set(["HR", ...derived])];
    return depts.map(d => ({ value: d, label: d }));
  }, [projects]);

  const filteredProjects = useMemo(() => {
    let list = projects ?? [];
    if (filters.dept) list = list.filter(p => (p as unknown as Record<string, unknown>).function === filters.dept);
    if (filters.category) list = list.filter(p => (p as unknown as Record<string, unknown>).category === filters.category);
    if (filters.status) list = list.filter(p => p.status === filters.status);
    if (filters.priority) list = list.filter(p => p.priority === filters.priority);
    if (filters.portfolio) list = list.filter(p => String(p.portfolioId) === filters.portfolio);
    return list;
  }, [projects, filters]);

  // Aggregate KPIs
  const ragCounts = useMemo(() => {
    const list = filteredProjects as unknown as PortfolioRow[];
    const green = list.filter(p => projectHealth(p) === "green").length;
    const amber = list.filter(p => projectHealth(p) === "amber").length;
    const red = list.filter(p => projectHealth(p) === "red").length;
    const grey = list.filter(p => projectHealth(p) === "grey").length; // unrated — no schedule dates
    return { green, amber, red, grey };
  }, [filteredProjects]);

  const totalBudget = filteredProjects.reduce((s, p) => s + ((p.capexBudget ?? 0) + (p.opexBudget ?? 0)), 0);

  const ragPieData = [
    { name: "Green", rag: "green", value: ragCounts.green, color: RAG_COLORS.green },
    { name: "Amber", rag: "amber", value: ragCounts.amber, color: RAG_COLORS.amber },
    { name: "Red", rag: "red", value: ragCounts.red, color: RAG_COLORS.red },
    { name: "Unrated", rag: "grey", value: ragCounts.grey, color: RAG_COLORS.grey },
  ].filter(d => d.value > 0);

  // The board/table reflects the base filters PLUS any RAG slice the user
  // clicked in the Project Health pie. KPIs + pie stay on the base set so the
  // pie doesn't collapse to the clicked slice.
  const tableProjects = useMemo(
    () => (ragFilter ? filteredProjects.filter(p => projectHealth(p as unknown as PortfolioRow) === ragFilter) : filteredProjects),
    [filteredProjects, ragFilter],
  );

  const budgetData = filteredProjects.slice(0, 8).map(p => ({
    name: p.name.length > 16 ? p.name.substring(0, 16) + "…" : p.name,
    budget: (p.capexBudget ?? 0) + (p.opexBudget ?? 0),
  }));

  const isLoading = loadingProjects || loadingPortfolios;

  // ── Drill-down data — the actual rows behind each KPI / chart ──────────────
  const HEALTH_LABEL: Record<string, string> = { green: "On Track", amber: "At Risk", red: "Delayed", grey: "Unrated" };
  const titleCaseP = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const projectDrillCols: DrillColumn[] = [
    { key: "name", label: "Project" },
    { key: "dept", label: "Department" },
    { key: "status", label: "Status", render: (v) => titleCaseP(String(v ?? "—")) },
    { key: "priority", label: "Priority" },
    { key: "progress", label: "Progress", align: "right", render: (v) => `${v ?? 0}%` },
    { key: "health", label: "Health" },
    { key: "budget", label: "Budget", align: "right", render: (v) => formatCurrency(Number(v ?? 0)) },
  ];
  const toDrillRow = (p: PortfolioRow) => ({
    name: p.name, dept: p.function ?? "—", status: p.status, priority: p.priority ?? "—",
    progress: p.progress ?? 0, health: HEALTH_LABEL[projectHealth(p)] ?? "—", budget: (p.capexBudget ?? 0) + (p.opexBudget ?? 0),
  });
  const projRows = filteredProjects as unknown as PortfolioRow[];
  const allDrillRows = projRows.map(toDrillRow);
  const greenDrillRows = projRows.filter((p) => projectHealth(p) === "green").map(toDrillRow);
  const atRiskDrillRows = projRows.filter((p) => { const h = projectHealth(p); return h === "amber" || h === "red"; }).map(toDrillRow);
  const postponedDrillRows = projRows.filter((p) => p.status === "postponed").map(toDrillRow);
  const completedDrillRows = projRows.filter((p) => p.status === "completed").map(toDrillRow);
  const healthDrillRows = ragPieData.map((d) => ({ status: d.name, projects: d.value }));
  const budgetDrillCols: DrillColumn[] = [
    { key: "name", label: "Project" },
    { key: "budget", label: "Budget", align: "right", render: (v) => formatCurrency(Number(v ?? 0)) },
  ];
  const budgetDrillRows = projRows.map((p) => ({ name: p.name, budget: (p.capexBudget ?? 0) + (p.opexBudget ?? 0) }));

  // ── Monday board over the filtered projects, grouped by status ─────────────
  const boardGroups = useMemo<BoardGroup<PortfolioRow>[]>(() => {
    const rows = tableProjects as unknown as PortfolioRow[];
    const byStatus = new Map<string, PortfolioRow[]>();
    for (const p of rows) { const a = byStatus.get(p.status) ?? []; a.push(p); byStatus.set(p.status, a); }
    const groups: BoardGroup<PortfolioRow>[] = [];
    for (const g of STATUS_GROUP_META) {
      const r = byStatus.get(g.key);
      if (r?.length) { groups.push({ key: g.key, label: g.label, color: g.color, rows: r }); byStatus.delete(g.key); }
    }
    for (const [key, r] of byStatus) groups.push({ key, label: key.replace(/_/g, " "), color: "#94A3B8", rows: r });
    return groups;
  }, [tableProjects]);

  const boardColumns = useMemo<BoardColumn<PortfolioRow>[]>(() => [
    { key: "timeline", header: "Timeline", width: 118, render: (p) => (
      <TimelineBar start={p.startDate} end={p.endDate} />
    ) },
    { key: "progress", header: "Project Progress", width: 130, render: (p) => <ProgressCell pct={p.progress ?? 0} /> },
    { key: "status", header: "Status", width: 120, align: "center", render: (p) => <StatusChip status={p.status} label={STATUS_LABEL[p.status]} size="sm" /> },
    { key: "sched_var", header: "Schedule Variance", width: 120, align: "center", render: (p) => {
      const v = p.scheduleVarianceDays;
      if (v == null) return <span className="text-[11px] text-muted-foreground/60">—</span>;
      const f = fmtVariance(v);
      return <span className="text-xs font-medium" style={{ color: f.color }}>{f.text}</span>;
    } },
    { key: "budget_var", header: "Budget Variance", width: 130, align: "right", render: (p) => {
      const amt = p.budgetVarianceAmount;
      if (amt == null) return <span className="text-[11px] text-muted-foreground/60">—</span>;
      const color = amt > 0 ? "#DC2626" : amt < 0 ? "#16A34A" : undefined;
      const pct = p.budgetVariancePct;
      return <span className="text-xs font-medium tabular-nums" style={{ color }}>{amt > 0 ? "+" : ""}{formatCurrency(amt)}{pct != null ? ` (${pct > 0 ? "+" : ""}${pct}%)` : ""}</span>;
    } },
    { key: "rag", header: "Health", width: 56, align: "center", render: (p) => <RagDot rag={projectHealth(p)} /> },
    { key: "priority", header: "Priority", width: 92, align: "center", render: (p) => <PriorityChip priority={p.priority} /> },
    { key: "category", header: "Category", width: 88, align: "center", render: (p) => <TextCell value={((p as unknown as Record<string, unknown>).category as string) || "—"} /> },
    { key: "budget", header: "Budget", width: 110, align: "right", render: (p) => <TextCell value={<span className="tabular-nums">{formatCurrency((p.capexBudget ?? 0) + (p.opexBudget ?? 0))}</span>} /> },
    { key: "due", header: "Due", width: 84, align: "center", render: (p) => <DateCell value={p.endDate} /> },
  ], []);

  // Column show/hide — the user can deselect columns via the "Columns" menu.
  // Default-shown: Timeline · Project Progress · Status · Schedule Variance ·
  // Budget Variance. The rest stay available in the "Columns" chooser.
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set(["rag", "priority", "category", "budget", "due"]));
  const shownColumns = useMemo(() => boardColumns.filter(c => !hiddenCols.has(c.key)), [boardColumns, hiddenCols]);
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const colMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!colMenuOpen) return;
    const onDoc = (e: MouseEvent) => { if (colMenuRef.current && !colMenuRef.current.contains(e.target as Node)) setColMenuOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [colMenuOpen]);
  const toggleCol = (k: string) => setHiddenCols(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  return (
    <div className="space-y-5">
      {/* Header — collapses into a glass floating bar on scroll */}
      <PageHeader
        eyebrow="Portfolio"
        title="Portfolio View"
        titleClassName="text-lg sm:text-xl"
        pill={false}
        subtitle="Filter and drill into projects across departments and portfolios"
        chips={[{ text: `${filteredProjects.length} projects`, className: "bg-primary/10 text-primary border-primary/20" }]}
        actions={
          <button
            onClick={() => exportCSV("portfolio-export.csv", filteredProjects.map(p => ({
              Name: p.name, Status: p.status, Priority: p.priority ?? "",
              RAG: p.ragStatus ?? "green", Budget: (p.capexBudget ?? 0) + (p.opexBudget ?? 0),
              Department: ((p as unknown as Record<string, unknown>).function as string) ?? "",
              StartDate: p.startDate ?? "", EndDate: p.endDate ?? "",
            })))}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-colors glass-surface lift-card text-muted-foreground hover:text-foreground"
          >
            Export CSV
          </button>
        }
      />

      {/* Filter Bar */}
      <div className="glass-surface rounded-2xl p-4 space-y-3 ph-rise ph-rise-2">
        <FilterBar
          filters={[
            { key: "dept", label: "Department", options: deptOptions },
            { key: "category", label: "Category", options: CATEGORY_OPTS },
            { key: "status", label: "Status", options: STATUS_OPTS },
            { key: "priority", label: "Priority", options: PRIORITY_OPTS },
          ]}
          values={filters}
          onChange={handleFilter}
        />
      </div>

      {/* KPI Row */}
      {isLoading ? (
        <div className="grid grid-cols-2 xl:grid-cols-5 gap-4">
          {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-24 rounded-2xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 xl:grid-cols-5 gap-4">
          <KPITile compact label="Total Projects" value={filteredProjects.length} icon={BarChart2} sub="Matching filters"
            drill={{ subtitle: "Projects matching the current filters", columns: projectDrillCols, rows: allDrillRows, linkHref: "/projects", linkLabel: "View all projects", emptyText: "No projects match the filters." }} />
          <KPITile compact label="On Track" value={ragCounts.green} valueClassName="text-success"
            drill={{ subtitle: "Projects with healthy schedule performance (green)", columns: projectDrillCols, rows: greenDrillRows, linkHref: "/projects", linkLabel: "View all projects", emptyText: "No on-track projects." }} />
          <KPITile compact label="At Risk" value={ragCounts.amber + ragCounts.red} valueClassName="text-warn"
            drill={{ subtitle: "Projects slipping schedule (amber + red)", columns: projectDrillCols, rows: atRiskDrillRows, linkHref: "/projects", linkLabel: "View all projects", emptyText: "No at-risk projects." }} />
          <KPITile compact label="Postponed" value={filteredProjects.filter(p => p.status === "postponed").length} valueClassName="text-warn"
            drill={{ subtitle: "Projects currently postponed", columns: projectDrillCols, rows: postponedDrillRows, linkHref: "/projects", linkLabel: "View all projects", emptyText: "No postponed projects." }} />
          <KPITile compact label="Completed" value={filteredProjects.filter(p => p.status === "completed").length} valueClassName="text-success"
            drill={{ subtitle: "Completed projects", columns: projectDrillCols, rows: completedDrillRows, linkHref: "/projects", linkLabel: "View all projects", emptyText: "No completed projects." }} />
        </div>
      )}

      {/* Charts Row */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* RAG Pie */}
        <DashboardCard title="Project Health" subtitle="RAG distribution"
          drillBodyClickable={false}
          drill={{ subtitle: "Project count by health status", columns: [{ key: "status", label: "Health" }, { key: "projects", label: "Projects", align: "right" }], rows: healthDrillRows, emptyText: "No projects match the filters." }}>
          {ragPieData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie
                    data={ragPieData} cx="50%" cy="50%" innerRadius={40} outerRadius={65} paddingAngle={3} dataKey="value" nameKey="name"
                    style={{ cursor: "pointer", outline: "none" }}
                    onClick={(d: { payload?: { rag?: string }; rag?: string }) => {
                      const rag = d?.payload?.rag ?? d?.rag;
                      if (rag) setRagFilter(cur => (cur === rag ? "" : rag));
                    }}
                  >
                    {ragPieData.map((entry, i) => (
                      <Cell
                        key={i}
                        fill={entry.color}
                        stroke={ragFilter === entry.rag ? "#0f172a" : "transparent"}
                        strokeWidth={ragFilter === entry.rag ? 2 : 0}
                        opacity={ragFilter && ragFilter !== entry.rag ? 0.35 : 1}
                      />
                    ))}
                  </Pie>
                  <Tooltip {...chartTooltipProps} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex justify-center gap-3 mt-1 flex-wrap">
                {ragPieData.map(d => (
                  <button
                    key={d.name}
                    type="button"
                    onClick={() => setRagFilter(cur => (cur === d.rag ? "" : d.rag))}
                    title={`Show only ${d.name} projects in the table`}
                    className={`flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full transition-colors ${
                      ragFilter === d.rag ? "bg-muted ring-1 ring-border" : "hover:bg-muted/50"
                    } ${ragFilter && ragFilter !== d.rag ? "opacity-50" : ""}`}
                  >
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: d.color }} />
                    <span className="text-muted-foreground">{d.name}</span>
                    <span className="font-bold text-foreground">({d.value})</span>
                  </button>
                ))}
              </div>
              {ragFilter && (
                <p className="text-center text-[11px] text-muted-foreground mt-1">
                  Table filtered to {ragFilter} health ·{" "}
                  <button type="button" onClick={() => setRagFilter("")} className="text-primary hover:underline font-medium">clear</button>
                </p>
              )}
            </>
          ) : (
            <div className="text-center py-8 text-muted-foreground/70 text-sm">No projects match the current filters</div>
          )}
        </DashboardCard>

        {/* Budget Bar */}
        <div className="xl:col-span-2">
          <DashboardCard title="Budget Utilization" subtitle="Budget by project (top 8)"
            drill={{ subtitle: "Allocated budget per project (CapEx + OpEx)", columns: budgetDrillCols, rows: budgetDrillRows, linkHref: "/projects", linkLabel: "View all projects", emptyText: "No budget data." }}>
            {budgetData.length > 0 ? (
              <ResponsiveContainer width="100%" height={175}>
                <BarChart data={budgetData} margin={{ top: 5, right: 10, bottom: 25, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" interval={0} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `₹${(v / 1e6).toFixed(0)}M`} />
                  <Tooltip
                    {...chartTooltipProps}
                    formatter={(v: number) => [formatCurrency(v), "Budget"]}
                  />
                  <Bar dataKey="budget" fill="#6366F1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-center py-8 text-muted-foreground/70 text-sm">No budget data</div>
            )}
          </DashboardCard>
        </div>
      </div>

      {/* Projects — Monday board (grouped by status) */}
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Projects</h3>
            <p className="text-xs text-muted-foreground">{filteredProjects.length} matching current filters</p>
          </div>
          {/* Columns chooser — show/hide table columns */}
          <div className="relative" ref={colMenuRef}>
            <button
              type="button"
              onClick={() => setColMenuOpen(o => !o)}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border bg-card text-xs font-medium text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
              title="Show / hide columns"
            >
              <SlidersHorizontal size={13} /> Columns
            </button>
            {colMenuOpen && (
              <div role="menu" className="absolute right-0 mt-1 z-50 w-48 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg py-1">
                <p className="px-3 py-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/70">Show columns</p>
                {boardColumns.map(c => {
                  const shown = !hiddenCols.has(c.key);
                  return (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => toggleCol(c.key)}
                      className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-foreground hover:bg-accent/60 transition-colors"
                    >
                      <span>{c.header}</span>
                      {shown && <Check size={13} className="text-primary" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        {isLoading ? (
          <Skeleton className="h-72 w-full rounded-xl" />
        ) : filteredProjects.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card/50 p-12 text-center">
            <BarChart2 size={28} className="text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground/80">No projects match the current filters</p>
          </div>
        ) : (
          <MondayBoard<PortfolioRow>
            groups={boardGroups}
            columns={shownColumns}
            nameHeader="Project Name"
            getRowId={(p) => `project:${p.id}`}
            getName={(p) => (
              <span className="flex flex-col min-w-0">
                <span className="font-medium truncate">{p.name}</span>
                {p.function && <span className="text-[10px] text-muted-foreground truncate">{p.function}</span>}
              </span>
            )}
            getProgress={(p) => p.progress ?? 0}
            storageKey="portfolio-projects"
            onOpenRow={(p) => setLocation(`/projects/${p.id}`)}
          />
        )}
      </div>

    </div>
  );
}
