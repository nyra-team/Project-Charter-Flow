import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useListProjects, useListUsers, useGetDashboardSummary } from "@workspace/api-client-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, LabelList,
} from "recharts";
import {
  FolderKanban, CheckCircle2, AlertTriangle, AlertOctagon, Wallet, Coins,
  ListChecks, Flag, Users2,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { KPITile, DashboardCard, FilterBar, exportCSV } from "../components/dashboard/primitives";
import { PageHeader } from "@/components/ui-kit";
import { formatCurrency } from "../lib/format";
import { classify, HEALTH_META, type Health } from "../lib/health";

// ── Chart palette ─────────────────────────────────────────────────────────────
// Health hex live in lib/health.ts (HEALTH_HEX); these add the chart-only
// accent hues (indigo/violet) the bars and donut use.
const C = {
  green: "#22C55E",
  amber: "#EAB308",
  red: "#EF4444",
  blue: "#3B82F6",
  indigo: "#6366F1",
  violet: "#8B5CF6",
  grey: "#94A3B8",
};
const PRIORITY_COLORS: Record<string, string> = { P0: C.red, P1: "#F97316", P2: C.amber, P3: C.green };

// ── Local data hooks (same endpoints the role dashboards use) ─────────────────
function usePortfolioHealthTrend() {
  return useQuery({
    queryKey: ["/api/dashboard/portfolio-health"],
    queryFn: async () => {
      const r = await fetch("/api/dashboard/portfolio-health");
      if (!r.ok) throw new Error("Failed");
      return r.json() as Promise<{ trend: Array<{ week: string; date: string; green: number; amber: number; red: number; total: number }> }>;
    },
  });
}
function useCapacityDemand() {
  return useQuery({
    queryKey: ["/api/dashboard/capacity-demand"],
    queryFn: async () => {
      const r = await fetch("/api/dashboard/capacity-demand");
      if (!r.ok) throw new Error("Failed");
      return r.json() as Promise<{
        functions: string[];
        months: string[];
        cells: Array<{ function: string; month: string; demand: number; capacity: number; utilization: number }>;
      }>;
    },
  });
}

const STATUS_OPTS = [
  { value: "planning", label: "Planning" },
  { value: "active", label: "Active" },
  { value: "on_hold", label: "On Hold" },
  { value: "completed", label: "Completed" },
];
const PRIORITY_OPTS = ["P0", "P1", "P2", "P3"].map(v => ({ value: v, label: v }));

export default function PortfolioOverview() {
  const { data: projects = [], isLoading } = useListProjects();
  const { data: users = [] } = useListUsers();
  const { data: summary } = useGetDashboardSummary();
  const { data: healthTrend } = usePortfolioHealthTrend();
  const { data: capacity } = useCapacityDemand();
  const [, setLocation] = useLocation();

  const [filters, setFilters] = useState<Record<string, string>>({});
  const handleFilter = (k: string, v: string) => setFilters(f => ({ ...f, [k]: v }));

  const userById = useMemo(() => {
    const m = new Map<number, string>();
    for (const u of users) m.set(u.id, u.name);
    return m;
  }, [users]);

  const deptOptions = useMemo(() => {
    const d = [...new Set(projects.map(p => p.function).filter(Boolean) as string[])];
    return d.map(x => ({ value: x, label: x }));
  }, [projects]);

  const filtered = useMemo(() => {
    let list = projects;
    if (filters.dept) list = list.filter(p => p.function === filters.dept);
    if (filters.status) list = list.filter(p => p.status === filters.status);
    if (filters.priority) list = list.filter(p => p.priority === filters.priority);
    return list;
  }, [projects, filters]);

  // ── Derived aggregates ──────────────────────────────────────────────────────
  const rows = useMemo(() => filtered.map(p => {
    const budget = (p.capexBudget ?? 0) + (p.opexBudget ?? 0);
    // No per-project actuals in the schema — estimate spend as budget × progress.
    const spend = Math.round(budget * (p.progress ?? 0) / 100);
    return {
      id: p.id,
      name: p.name,
      manager: p.projectManagerId ? (userById.get(p.projectManagerId) ?? "—") : "—",
      start: p.startDate, end: p.endDate,
      progress: p.progress ?? 0,
      health: classify(p),
      priority: p.priority,
      dept: p.function ?? "—",
      budget, spend,
    };
  }), [filtered, userById]);

  const counts = useMemo(() => {
    const c = { on_track: 0, at_risk: 0, delayed: 0, completed: 0 };
    for (const r of rows) c[r.health]++;
    return c;
  }, [rows]);

  const totalBudget = rows.reduce((s, r) => s + r.budget, 0);
  const totalSpend = rows.reduce((s, r) => s + r.spend, 0);
  const usedPct = totalBudget > 0 ? Math.round((totalSpend / totalBudget) * 100) : 0;
  const n = rows.length || 1;

  const statusBars = (Object.keys(HEALTH_META) as Health[]).map(h => ({
    name: HEALTH_META[h].label, value: counts[h], color: HEALTH_META[h].color,
  }));

  const priorityDonut = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.priority, (m.get(r.priority) ?? 0) + 1);
    return [...m.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, v]) => ({ name: k, value: v, color: PRIORITY_COLORS[k] ?? C.grey }));
  }, [rows]);

  // On-track share over time — the closest real time-series to the template's
  // "Monthly Progress Trend". Reads % of the portfolio that was green each week.
  const trendData = useMemo(() => {
    const t = healthTrend?.trend ?? [];
    return t.map(w => ({
      week: new Date(w.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }),
      pct: w.total > 0 ? Math.round((w.green / w.total) * 100) : 0,
    }));
  }, [healthTrend]);

  // Resource workload by department — average utilisation across the planning
  // horizon, per function. Colour by load: <75 healthy, 75–90 watch, >90 hot.
  const workload = useMemo(() => {
    const cells = capacity?.cells ?? [];
    const byFn = new Map<string, { util: number; n: number }>();
    for (const c of cells) {
      const e = byFn.get(c.function) ?? { util: 0, n: 0 };
      e.util += c.utilization; e.n++; byFn.set(c.function, e);
    }
    return [...byFn.entries()]
      .map(([fn, e]) => ({ fn, util: Math.round(e.util / Math.max(e.n, 1)) }))
      .sort((a, b) => b.util - a.util)
      .slice(0, 8);
  }, [capacity]);
  const loadColor = (u: number) => (u > 90 ? C.red : u >= 75 ? C.amber : C.green);

  const fmtD = (d?: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" }) : "—");

  if (isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-16 rounded-2xl" />
        <div className="grid grid-cols-2 xl:grid-cols-6 gap-4">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Portfolio"
        title="Portfolio"
        titleClassName="text-lg sm:text-xl"
        subtitle="Multi-project planning & tracking — health, budget and resourcing at a glance"
        chips={[{ text: `${rows.length} projects`, className: "bg-primary/10 text-primary border-primary/20" }]}
        actions={
          <button
            onClick={() => exportCSV("portfolio-overview.csv", rows.map(r => ({
              Project: r.name, Manager: r.manager, Department: r.dept,
              Start: r.start ?? "", End: r.end ?? "", PercentComplete: r.progress,
              Health: HEALTH_META[r.health].label, Priority: r.priority,
              Budget: r.budget, EstimatedSpend: r.spend,
            })))}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium glass-surface lift-card text-muted-foreground hover:text-foreground transition-colors"
          >
            Export CSV
          </button>
        }
      />

      {/* Filters */}
      <div className="glass-surface rounded-2xl p-4 ph-rise ph-rise-2">
        <FilterBar
          filters={[
            { key: "dept", label: "Department", options: deptOptions },
            { key: "status", label: "Status", options: STATUS_OPTS },
            { key: "priority", label: "Priority", options: PRIORITY_OPTS },
          ]}
          values={filters}
          onChange={handleFilter}
        />
      </div>

      {/* KPI strip — 6 cards. Unlike the source template, At Risk is a first-class
          card (no phantom status), and Completed lives in the status chart. */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <KPITile compact label="Total Projects" value={rows.length} icon={FolderKanban} sub="Matching filters" />
        <KPITile compact label="On Track" value={counts.on_track} icon={CheckCircle2} valueClassName="text-success" sub={`${Math.round(counts.on_track / n * 100)}%`} />
        <KPITile compact label="At Risk" value={counts.at_risk} icon={AlertTriangle} valueClassName="text-warn" sub={`${Math.round(counts.at_risk / n * 100)}%`} />
        <KPITile compact label="Delayed" value={counts.delayed} icon={AlertOctagon} valueClassName="text-destructive" sub={`${Math.round(counts.delayed / n * 100)}%`} />
        <KPITile compact label="Total Budget" value={formatCurrency(totalBudget)} icon={Wallet} sub="Across all projects" />
        <KPITile compact label="Budget Used" value={formatCurrency(totalSpend)} icon={Coins} valueClassName="text-primary" sub={`${usedPct}% of total (est.)`} />
      </div>

      {/* Charts row — Status · Budget vs Spend · Priority mix */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <DashboardCard title="Project Status" subtitle="Health distribution">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={statusBars} margin={{ top: 18, right: 8, bottom: 4, left: -16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: "#1E293B", border: "none", borderRadius: 8, color: "white", fontSize: 12 }} cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }} />
              <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={56}>
                <LabelList dataKey="value" position="top" style={{ fontSize: 12, fontWeight: 700, fill: "hsl(var(--foreground))" }} />
                {statusBars.map((e, i) => <Cell key={i} fill={e.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </DashboardCard>

        <DashboardCard title="Budget vs Spend" subtitle="Spend estimated as Σ(budget × % complete)">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={[{ name: "Budget", v: totalBudget, c: C.indigo }, { name: "Est. Spend", v: totalSpend, c: C.violet }]} margin={{ top: 18, right: 8, bottom: 4, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `₹${(v / 1e6).toFixed(0)}M`} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: "#1E293B", border: "none", borderRadius: 8, color: "white", fontSize: 12 }} formatter={(v: number) => [formatCurrency(v), ""]} cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }} />
              <Bar dataKey="v" radius={[6, 6, 0, 0]} maxBarSize={70}>
                <LabelList dataKey="v" position="top" formatter={(v: number) => `₹${(v / 1e6).toFixed(1)}M`} style={{ fontSize: 11, fontWeight: 700, fill: "hsl(var(--foreground))" }} />
                {[C.indigo, C.violet].map((c, i) => <Cell key={i} fill={c} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </DashboardCard>

        <DashboardCard title="Priority Mix" subtitle="Projects by priority band">
          <div className="relative">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={priorityDonut} cx="50%" cy="50%" innerRadius={52} outerRadius={78} paddingAngle={3} dataKey="value" nameKey="name">
                  {priorityDonut.map((e, i) => <Cell key={i} fill={e.color} />)}
                </Pie>
                <Tooltip contentStyle={{ background: "#1E293B", border: "none", borderRadius: 8, color: "white", fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-2xl font-bold font-mono text-foreground leading-none">{rows.length}</span>
              <span className="text-[10px] text-muted-foreground mt-0.5">Projects</span>
            </div>
          </div>
          <div className="flex justify-center gap-3 mt-1 flex-wrap">
            {priorityDonut.map(d => (
              <span key={d.name} className="flex items-center gap-1.5 text-xs">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: d.color }} />
                <span className="text-muted-foreground">{d.name}</span>
                <span className="font-bold text-foreground">({d.value})</span>
              </span>
            ))}
          </div>
        </DashboardCard>
      </div>

      {/* Trend (wide) + RAG legend */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2">
          <DashboardCard title="On-Track Trend" subtitle="Share of portfolio rated green, by week">
            {trendData.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={trendData} margin={{ top: 12, right: 16, bottom: 4, left: -16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="week" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} tickFormatter={v => `${v}%`} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: "#1E293B", border: "none", borderRadius: 8, color: "white", fontSize: 12 }} formatter={(v: number) => [`${v}%`, "On track"]} />
                  <Line type="monotone" dataKey="pct" stroke={C.indigo} strokeWidth={2.5} dot={{ r: 3, fill: C.indigo }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-center py-12 text-sm text-muted-foreground/70">No trend data yet</div>
            )}
          </DashboardCard>
        </div>

        <DashboardCard title="RAG Status Legend" subtitle="What each health band means">
          <div className="space-y-3 pt-1">
            {(Object.keys(HEALTH_META) as Health[]).map(h => (
              <div key={h} className="flex items-start gap-3">
                <span className="w-3 h-3 rounded-full mt-1 shrink-0" style={{ background: HEALTH_META[h].color }} />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground leading-tight">
                    {HEALTH_META[h].label} <span className="text-muted-foreground font-normal">· {counts[h]}</span>
                  </p>
                  <p className="text-[11px] text-muted-foreground leading-snug">{HEALTH_META[h].desc}</p>
                </div>
              </div>
            ))}
          </div>
        </DashboardCard>
      </div>

      {/* Portfolio summary table */}
      <DashboardCard title="Portfolio Summary" subtitle={`${rows.length} projects · click a row to open`}>
        <div className="overflow-x-auto -mx-2">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                <th className="py-2 px-2 font-semibold">Project</th>
                <th className="py-2 px-2 font-semibold">Manager</th>
                <th className="py-2 px-2 font-semibold">Start</th>
                <th className="py-2 px-2 font-semibold">End</th>
                <th className="py-2 px-2 font-semibold w-40">% Complete</th>
                <th className="py-2 px-2 font-semibold">Status</th>
                <th className="py-2 px-2 font-semibold text-right">Budget</th>
                <th className="py-2 px-2 font-semibold text-right">Est. Spend</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr
                  key={r.id}
                  onClick={() => setLocation(`/projects/${r.id}`)}
                  className="border-b border-border/50 hover:bg-accent/50 cursor-pointer transition-colors"
                >
                  <td className="py-2 px-2">
                    <div className="font-medium text-foreground truncate max-w-[180px]">{r.name}</div>
                    <div className="text-[10px] text-muted-foreground">{r.dept}</div>
                  </td>
                  <td className="py-2 px-2 text-muted-foreground whitespace-nowrap">{r.manager}</td>
                  <td className="py-2 px-2 text-muted-foreground whitespace-nowrap tabular-nums">{fmtD(r.start)}</td>
                  <td className="py-2 px-2 text-muted-foreground whitespace-nowrap tabular-nums">{fmtD(r.end)}</td>
                  <td className="py-2 px-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${r.progress}%`, background: HEALTH_META[r.health].color }} />
                      </div>
                      <span className="text-[11px] font-mono tabular-nums text-muted-foreground w-8 text-right">{r.progress}%</span>
                    </div>
                  </td>
                  <td className="py-2 px-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap">
                      <span className="w-2 h-2 rounded-full" style={{ background: HEALTH_META[r.health].color }} />
                      {HEALTH_META[r.health].label}
                    </span>
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap">{formatCurrency(r.budget)}</td>
                  <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap text-muted-foreground">{formatCurrency(r.spend)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={8} className="py-10 text-center text-muted-foreground/70 text-sm">No projects match the current filters</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </DashboardCard>

      {/* Resource workload + Attention list */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <DashboardCard title="Resource Workload" subtitle="Avg utilisation by department">
          {workload.length > 0 ? (
            <div className="space-y-3 pt-1">
              {workload.map(w => (
                <div key={w.fn} className="flex items-center gap-3">
                  <span className="w-28 text-xs text-muted-foreground truncate shrink-0">{w.fn}</span>
                  <div className="flex-1 h-3 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(w.util, 100)}%`, background: loadColor(w.util) }} />
                  </div>
                  <span className="text-xs font-mono tabular-nums w-10 text-right" style={{ color: loadColor(w.util) }}>{w.util}%</span>
                </div>
              ))}
              <div className="flex items-center gap-4 pt-2 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: C.green }} />Healthy &lt;75%</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: C.amber }} />Watch 75–90%</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: C.red }} />Hot &gt;90%</span>
              </div>
            </div>
          ) : (
            <div className="text-center py-12 text-sm text-muted-foreground/70 flex flex-col items-center gap-2">
              <Users2 size={24} className="text-muted-foreground/40" />
              No capacity data available
            </div>
          )}
        </DashboardCard>

        <DashboardCard title="Needs Attention" subtitle="Delayed & at-risk projects, by budget exposure">
          {(() => {
            const att = rows.filter(r => r.health === "delayed" || r.health === "at_risk").sort((a, b) => b.budget - a.budget).slice(0, 6);
            if (att.length === 0) return (
              <div className="text-center py-12 text-sm text-muted-foreground/70 flex flex-col items-center gap-2">
                <CheckCircle2 size={24} className="text-success/50" />
                Nothing off-track — every project is green
              </div>
            );
            return (
              <div className="space-y-2 pt-1">
                {att.map(r => (
                  <div
                    key={r.id}
                    onClick={() => setLocation(`/projects/${r.id}`)}
                    className="flex items-center gap-3 p-2.5 rounded-lg cursor-pointer hover:bg-accent/50 transition-colors border-l-2"
                    style={{ borderColor: HEALTH_META[r.health].color, background: `${HEALTH_META[r.health].color}0d` }}
                  >
                    {r.health === "delayed" ? <AlertOctagon size={16} className="text-destructive shrink-0" /> : <AlertTriangle size={16} className="text-warn shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">{r.name}</p>
                      <p className="text-[11px] text-muted-foreground">{r.dept} · {r.manager} · {r.progress}% complete</p>
                    </div>
                    <span className="text-xs font-mono tabular-nums text-muted-foreground whitespace-nowrap">{formatCurrency(r.budget)}</span>
                  </div>
                ))}
              </div>
            );
          })()}
        </DashboardCard>
      </div>
    </div>
  );
}
