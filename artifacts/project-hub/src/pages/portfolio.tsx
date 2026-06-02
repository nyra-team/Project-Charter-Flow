import { useListProjects, useListPortfolios } from "@workspace/api-client-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { BarChart2, DollarSign } from "lucide-react";
import { useLocation } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useMemo } from "react";
import { DashboardCard, KPITile, FilterBar, exportCSV } from "../components/dashboard/primitives";
import { formatCurrency } from "../lib/format";
import { MondayBoard, ProgressCell, DateCell, TextCell, type BoardColumn, type BoardGroup } from "@/components/monday";
import { ViewSwitcher, type BoardView } from "@/components/monday/ViewSwitcher";
import { CalendarView } from "@/components/monday/CalendarView";
import { StatusChip } from "@/components/ui-kit";
import { PriorityChip, RagDot } from "@/components/task-status-chip";

const RAG_COLORS = { green: "#22C55E", amber: "#EAB308", red: "#EF4444", grey: "#94A3B8" };

// Structural subset of a project row used by the Monday board on this page.
interface PortfolioRow {
  id: number; name: string; status: string; priority: string;
  ragStatus?: string | null; progress?: number | null; endDate?: string | null;
  capexBudget?: number | null; opexBudget?: number | null;
  function?: string | null;
}

const STATUS_GROUP_META: { key: string; label: string; color: string }[] = [
  { key: "active", label: "Active", color: "#F59E0B" },
  { key: "planning", label: "Planning", color: "#6366F1" },
  { key: "on_hold", label: "On Hold", color: "#94A3B8" },
  { key: "completed", label: "Completed", color: "#10B981" },
  { key: "closed", label: "Closed", color: "#64748B" },
];

const STATUS_OPTS = ["active", "planning", "completed", "on_hold", "closed"].map(v => ({ value: v, label: v.replace(/_/g, " ").replace(/^\w/, c => c.toUpperCase()) }));
const PRIORITY_OPTS = ["P1", "P2", "P3"].map(v => ({ value: v, label: v }));

export default function PortfolioView() {
  const { data: projects, isLoading: loadingProjects } = useListProjects();
  const { data: portfolios, isLoading: loadingPortfolios } = useListPortfolios();
  const [, setLocation] = useLocation();
  const [view, setView] = useState<BoardView>("table");

  const [filters, setFilters] = useState<Record<string, string>>({});
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const handleFilter = (k: string, v: string) => setFilters(f => ({ ...f, [k]: v }));

  const deptOptions = useMemo(() => {
    const depts = [...new Set((projects ?? []).map(p => (p as unknown as Record<string, unknown>).function as string).filter(Boolean))];
    return depts.map(d => ({ value: d, label: d }));
  }, [projects]);

  const portfolioOptions = useMemo(() => {
    return (portfolios ?? []).map(p => ({ value: String(p.id), label: p.name }));
  }, [portfolios]);

  const filteredProjects = useMemo(() => {
    let list = projects ?? [];
    if (filters.dept) list = list.filter(p => (p as unknown as Record<string, unknown>).function === filters.dept);
    if (filters.status) list = list.filter(p => p.status === filters.status);
    if (filters.priority) list = list.filter(p => p.priority === filters.priority);
    if (filters.portfolio) list = list.filter(p => String(p.portfolioId) === filters.portfolio);
    if (dateFrom) list = list.filter(p => p.startDate && p.startDate >= dateFrom);
    if (dateTo) list = list.filter(p => p.endDate && p.endDate <= dateTo);
    return list;
  }, [projects, filters, dateFrom, dateTo]);

  // Aggregate KPIs
  const ragCounts = useMemo(() => {
    const green = filteredProjects.filter(p => (p.ragStatus ?? "green") === "green").length;
    const amber = filteredProjects.filter(p => p.ragStatus === "amber").length;
    const red = filteredProjects.filter(p => p.ragStatus === "red").length;
    return { green, amber, red };
  }, [filteredProjects]);

  const totalBudget = filteredProjects.reduce((s, p) => s + ((p.capexBudget ?? 0) + (p.opexBudget ?? 0)), 0);

  const ragPieData = [
    { name: "Green", value: ragCounts.green, color: RAG_COLORS.green },
    { name: "Amber", value: ragCounts.amber, color: RAG_COLORS.amber },
    { name: "Red", value: ragCounts.red, color: RAG_COLORS.red },
  ].filter(d => d.value > 0);

  const budgetData = filteredProjects.slice(0, 8).map(p => ({
    name: p.name.length > 16 ? p.name.substring(0, 16) + "…" : p.name,
    budget: (p.capexBudget ?? 0) + (p.opexBudget ?? 0),
  }));

  const isLoading = loadingProjects || loadingPortfolios;

  // ── Monday board over the filtered projects, grouped by status ─────────────
  const boardGroups = useMemo<BoardGroup<PortfolioRow>[]>(() => {
    const rows = filteredProjects as unknown as PortfolioRow[];
    const byStatus = new Map<string, PortfolioRow[]>();
    for (const p of rows) { const a = byStatus.get(p.status) ?? []; a.push(p); byStatus.set(p.status, a); }
    const groups: BoardGroup<PortfolioRow>[] = [];
    for (const g of STATUS_GROUP_META) {
      const r = byStatus.get(g.key);
      if (r?.length) { groups.push({ key: g.key, label: g.label, color: g.color, rows: r }); byStatus.delete(g.key); }
    }
    for (const [key, r] of byStatus) groups.push({ key, label: key.replace(/_/g, " "), color: "#94A3B8", rows: r });
    return groups;
  }, [filteredProjects]);

  const boardColumns = useMemo<BoardColumn<PortfolioRow>[]>(() => [
    { key: "status", header: "Status", width: 120, align: "center", render: (p) => <StatusChip status={p.status} size="sm" /> },
    { key: "rag", header: "Health", width: 56, align: "center", render: (p) => <RagDot rag={p.ragStatus ?? "green"} /> },
    { key: "priority", header: "Priority", width: 92, align: "center", render: (p) => <PriorityChip priority={p.priority} /> },
    { key: "budget", header: "Budget", width: 110, align: "right", render: (p) => <TextCell value={<span className="tabular-nums">{formatCurrency((p.capexBudget ?? 0) + (p.opexBudget ?? 0))}</span>} /> },
    { key: "progress", header: "Progress", width: 120, render: (p) => <ProgressCell pct={p.progress ?? 0} /> },
    { key: "due", header: "Due", width: 84, align: "center", render: (p) => <DateCell value={p.endDate} /> },
  ], []);

  const calendarItems = useMemo(
    () => (filteredProjects as unknown as PortfolioRow[]).filter((p) => p.endDate).map((p) => ({ id: p.id, date: p.endDate ?? null, title: p.name, status: p.status })),
    [filteredProjects],
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 ph-rise">
        <div>
          <h2 className="text-xl font-bold text-foreground">Department Portfolio View</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Filter and drill into projects across departments and portfolios</p>
        </div>
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
      </div>

      {/* Filter Bar */}
      <div className="glass-surface rounded-2xl p-4 space-y-3 ph-rise ph-rise-2">
        <FilterBar
          filters={[
            { key: "portfolio", label: "Portfolio", options: portfolioOptions },
            { key: "dept", label: "Department", options: deptOptions },
            { key: "status", label: "Status", options: STATUS_OPTS },
            { key: "priority", label: "Priority", options: PRIORITY_OPTS },
          ]}
          values={filters}
          onChange={handleFilter}
        />
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Date Range</span>
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-muted-foreground">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="text-xs rounded-lg px-2 py-1 bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-muted-foreground">To</label>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="text-xs rounded-lg px-2 py-1 bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40"
            />
          </div>
          {(dateFrom || dateTo) && (
            <button
              onClick={() => { setDateFrom(""); setDateTo(""); }}
              className="text-xs text-primary hover:text-primary/80 font-medium transition-colors"
            >
              Clear dates
            </button>
          )}
        </div>
      </div>

      {/* KPI Row */}
      {isLoading ? (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-24 rounded-2xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          <KPITile label="Total Projects" value={filteredProjects.length} icon={BarChart2} gradient="linear-gradient(135deg,#6366F1,#8B5CF6)" sub="Matching filters" />
          <KPITile label="On Track (Green)" value={ragCounts.green} gradient="linear-gradient(135deg,#10B981,#059669)" />
          <KPITile label="At Risk (Amber/Red)" value={ragCounts.amber + ragCounts.red} gradient="linear-gradient(135deg,#F59E0B,#D97706)" />
          <KPITile label="Total Budget" value={formatCurrency(totalBudget)} icon={DollarSign} gradient="linear-gradient(135deg,#3B82F6,#1D4ED8)" sub="Combined allocation" />
        </div>
      )}

      {/* Charts Row */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* RAG Pie */}
        <DashboardCard title="RAG Distribution" subtitle="Health status breakdown">
          {ragPieData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={ragPieData} cx="50%" cy="50%" innerRadius={40} outerRadius={65} paddingAngle={3} dataKey="value" nameKey="name">
                    {ragPieData.map((entry, i) => <Cell key={i} fill={entry.color} strokeWidth={0} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: "#1E293B", border: "none", borderRadius: 8, color: "white", fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex justify-center gap-4 mt-1">
                {ragPieData.map(d => (
                  <div key={d.name} className="flex items-center gap-1.5 text-xs">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: d.color }} />
                    <span className="text-muted-foreground">{d.name}</span>
                    <span className="font-bold text-foreground">({d.value})</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="text-center py-8 text-muted-foreground/70 text-sm">No projects match the current filters</div>
          )}
        </DashboardCard>

        {/* Budget Bar */}
        <div className="xl:col-span-2">
          <DashboardCard title="Budget Utilization" subtitle="Budget by project (top 8)">
            {budgetData.length > 0 ? (
              <ResponsiveContainer width="100%" height={175}>
                <BarChart data={budgetData} margin={{ top: 5, right: 10, bottom: 25, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" interval={0} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `₹${(v / 1e6).toFixed(0)}M`} />
                  <Tooltip
                    contentStyle={{ background: "#1E293B", border: "none", borderRadius: 8, color: "white", fontSize: 12 }}
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

      {/* Projects — Monday board (grouped by status) with Table / Calendar views */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Projects</h3>
            <p className="text-xs text-muted-foreground">{filteredProjects.length} matching current filters</p>
          </div>
          <ViewSwitcher views={["table", "calendar"]} value={view} onChange={setView} />
        </div>
        {isLoading ? (
          <Skeleton className="h-72 w-full rounded-xl" />
        ) : view === "calendar" ? (
          <CalendarView items={calendarItems} onOpenItem={(it) => setLocation(`/projects/${it.id}`)} />
        ) : filteredProjects.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card/50 p-12 text-center">
            <BarChart2 size={28} className="text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground/80">No projects match the current filters</p>
          </div>
        ) : (
          <MondayBoard<PortfolioRow>
            groups={boardGroups}
            columns={boardColumns}
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
