import { useListProjects, useListPortfolios } from "@workspace/api-client-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { BarChart2, ArrowUpRight, DollarSign, Calendar } from "lucide-react";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { useState, useMemo } from "react";
import { RAGBadge, DashboardCard, KPITile, FilterBar, exportCSV } from "../components/dashboard/primitives";
import { formatCurrency } from "../lib/format";

const RAG_COLORS = { green: "#22C55E", amber: "#EAB308", red: "#EF4444", grey: "#94A3B8" };

const STATUS_OPTS = ["active", "planning", "completed", "on_hold", "closed"].map(v => ({ value: v, label: v.replace(/_/g, " ").replace(/^\w/, c => c.toUpperCase()) }));
const PRIORITY_OPTS = ["P1", "P2", "P3"].map(v => ({ value: v, label: v }));

export default function PortfolioView() {
  const { data: projects, isLoading: loadingProjects } = useListProjects();
  const { data: portfolios, isLoading: loadingPortfolios } = useListPortfolios();

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

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Department Portfolio View</h2>
          <p className="text-sm text-gray-500 mt-0.5">Filter and drill into projects across departments and portfolios</p>
        </div>
        <button
          onClick={() => exportCSV("portfolio-export.csv", filteredProjects.map(p => ({
            Name: p.name, Status: p.status, Priority: p.priority ?? "",
            RAG: p.ragStatus ?? "green", Budget: (p.capexBudget ?? 0) + (p.opexBudget ?? 0),
            Department: ((p as unknown as Record<string, unknown>).function as string) ?? "",
            StartDate: p.startDate ?? "", EndDate: p.endDate ?? "",
          })))}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-colors"
          style={{ background: "white", border: "1px solid #E2E8F0", color: "#64748B" }}
        >
          Export CSV
        </button>
      </div>

      {/* Filter Bar */}
      <div className="rounded-2xl p-4 space-y-3" style={{ background: "white", border: "1px solid #E2E8F0" }}>
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
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Date Range</span>
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-gray-500">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="text-xs border rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              style={{ borderColor: "#E2E8F0" }}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-gray-500">To</label>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="text-xs border rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              style={{ borderColor: "#E2E8F0" }}
            />
          </div>
          {(dateFrom || dateTo) && (
            <button
              onClick={() => { setDateFrom(""); setDateTo(""); }}
              className="text-xs text-indigo-500 hover:text-indigo-700 font-medium"
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
                    <span className="text-gray-500">{d.name}</span>
                    <span className="font-bold text-gray-700">({d.value})</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="text-center py-8 text-gray-400 text-sm">No projects match the current filters</div>
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
              <div className="text-center py-8 text-gray-400 text-sm">No budget data</div>
            )}
          </DashboardCard>
        </div>
      </div>

      {/* Project Table */}
      <DashboardCard title="Projects" subtitle={`${filteredProjects.length} projects matching current filters`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-400 uppercase tracking-wider border-b" style={{ borderColor: "#F1F5F9" }}>
                <th className="pb-3 text-left font-semibold">Project</th>
                <th className="pb-3 text-left font-semibold hidden sm:table-cell">Status</th>
                <th className="pb-3 text-left font-semibold">RAG</th>
                <th className="pb-3 text-left font-semibold hidden md:table-cell">Priority</th>
                <th className="pb-3 text-left font-semibold hidden lg:table-cell">Budget</th>
                <th className="pb-3 text-left font-semibold hidden xl:table-cell">Progress</th>
                <th className="pb-3 text-left font-semibold hidden lg:table-cell">End Date</th>
                <th className="pb-3 text-right font-semibold">View</th>
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: "#F8FAFC" }}>
              {isLoading ? (
                [1,2,3,4,5].map(i => (
                  <tr key={i}><td colSpan={8} className="py-3"><Skeleton className="h-6 w-full" /></td></tr>
                ))
              ) : filteredProjects.length > 0 ? filteredProjects.map(p => (
                <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                  <td className="py-3 pr-4">
                    <div className="font-medium text-gray-900">{p.name}</div>
                    {!!(p as unknown as Record<string, unknown>).function && (
                      <div className="text-xs text-gray-400">{String((p as unknown as Record<string, unknown>).function)}</div>
                    )}
                  </td>
                  <td className="py-3 pr-4 hidden sm:table-cell">
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium capitalize" style={{ background: p.status === "active" ? "#ECFDF5" : "#F1F5F9", color: p.status === "active" ? "#16A34A" : "#64748B" }}>
                      {p.status.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="py-3 pr-4"><RAGBadge status={p.ragStatus} size="xs" /></td>
                  <td className="py-3 pr-4 hidden md:table-cell">
                    <span className="text-xs px-2 py-0.5 rounded font-bold" style={{
                      background: p.priority === "P1" ? "#FEE2E2" : p.priority === "P2" ? "#FFFBEB" : "#F1F5F9",
                      color: p.priority === "P1" ? "#DC2626" : p.priority === "P2" ? "#D97706" : "#64748B",
                    }}>
                      {p.priority ?? "P3"}
                    </span>
                  </td>
                  <td className="py-3 pr-4 hidden lg:table-cell">
                    <span className="text-xs text-gray-600">{formatCurrency((p.capexBudget ?? 0) + (p.opexBudget ?? 0))}</span>
                  </td>
                  <td className="py-3 pr-4 hidden xl:table-cell">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden min-w-[50px]">
                        <div className="h-full rounded-full" style={{ width: `${p.progress ?? 0}%`, background: "linear-gradient(90deg,#6366F1,#8B5CF6)" }} />
                      </div>
                      <span className="text-xs font-bold text-gray-600 w-8">{p.progress ?? 0}%</span>
                    </div>
                  </td>
                  <td className="py-3 pr-4 hidden lg:table-cell">
                    <span className="text-xs text-gray-400 flex items-center gap-1">
                      {p.endDate ? <><Calendar size={10} />{format(new Date(p.endDate), "MMM d, yyyy")}</> : "—"}
                    </span>
                  </td>
                  <td className="py-3 text-right">
                    <Link href={`/projects/${p.id}`}>
                      <button className="p-1.5 rounded-lg hover:bg-indigo-50 transition-colors">
                        <ArrowUpRight size={14} className="text-indigo-400" />
                      </button>
                    </Link>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={8} className="py-12 text-center">
                    <BarChart2 size={28} className="text-gray-200 mx-auto mb-2" />
                    <p className="text-sm text-gray-400">No projects match the current filters</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </DashboardCard>
    </div>
  );
}
