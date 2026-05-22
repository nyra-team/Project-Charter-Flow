import { useListProjects, useGetDashboardSummary } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { AlertTriangle, CheckSquare, TrendingUp, Users, DollarSign } from "lucide-react";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { format, addDays } from "date-fns";
import {
  KPITile, RAGBadge, DashboardCard, SLACountdown, useAutoRefresh, exportCSV, exportXLSX,
} from "../../components/dashboard/primitives";
import { formatCurrency } from "../../lib/format";

function useCapacityDemand(refetchInterval: number | false) {
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
    refetchInterval,
  });
}

function useTopRisks(refetchInterval: number | false) {
  return useQuery({
    queryKey: ["/api/charters/risks/all-fh"],
    queryFn: async () => {
      const chartersRes = await fetch("/api/charters");
      const charters: Array<{ id: number }> = chartersRes.ok ? await chartersRes.json() : [];
      const riskPromises = charters.slice(0, 10).map(c =>
        fetch(`/api/charters/${c.id}/risks`).then(r => r.ok ? r.json() : [])
      );
      const riskGroups = await Promise.all(riskPromises);
      const allRisks = riskGroups.flat() as Array<{
        id: number; title: string; impact: string; likelihood: string;
        owner?: string; status?: string; rag?: string;
      }>;
      const scored = allRisks.map(r => {
        const impactScore = r.impact === "high" ? 3 : r.impact === "medium" ? 2 : 1;
        const likelScore = r.likelihood === "high" ? 3 : r.likelihood === "medium" ? 2 : 1;
        return { ...r, riskScore: impactScore * likelScore };
      });
      return scored.sort((a, b) => b.riskScore - a.riskScore).slice(0, 8);
    },
    refetchInterval,
  });
}

const RAG_PIE_COLORS = { green: "#22C55E", amber: "#EAB308", red: "#EF4444" };

export default function FunctionalHeadDashboard() {
  const { refetchInterval, markRefreshed, IntervalPicker } = useAutoRefresh();
  const { data: summary } = useGetDashboardSummary({ query: { refetchInterval } as never });
  const { data: projects, isLoading: loadingProjects } = useListProjects(undefined, { query: { refetchInterval } as never });
  const { data: capacityData } = useCapacityDemand(refetchInterval);
  const { data: topRisks } = useTopRisks(refetchInterval);
  useEffect(() => { if (summary || projects) markRefreshed(); }, [summary, projects]);

  const activeProjects = projects?.filter(p => p.status === "active") ?? [];
  const health = summary?.projectHealth as {
    active?: number; onTrack?: number; offTrack?: number; delayed?: number;
  } | undefined;

  const ragPieData = [
    { name: "Green", value: health?.onTrack ?? 0, color: RAG_PIE_COLORS.green },
    { name: "Amber", value: health?.offTrack ?? 0, color: RAG_PIE_COLORS.amber },
    { name: "Red", value: health?.delayed ?? 0, color: RAG_PIE_COLORS.red },
  ].filter(d => d.value > 0);

  // Budget utilization from projects (capex + opex)
  const totalBudget = activeProjects.reduce((s, p) => s + ((p.capexBudget ?? 0) + (p.opexBudget ?? 0)), 0);

  // Upcoming approvals (simulated SLA of +3 days from now for demo)
  const now = new Date();
  const upcomingApprovals = activeProjects.slice(0, 3).map((p, i) => ({
    id: p.id,
    name: p.name,
    deadline: addDays(now, i + 1).toISOString(),
    type: "Stage Gate Review",
  }));

  // Resource conflicts: utilization > 100%
  const conflictCells = (capacityData?.cells ?? []).filter(c => c.utilization > 100);
  const conflictsByFunction = conflictCells.reduce<Record<string, { demand: number; capacity: number; months: string[] }>>(
    (acc, c) => {
      if (!acc[c.function]) acc[c.function] = { demand: 0, capacity: 0, months: [] };
      acc[c.function].demand = Math.max(acc[c.function].demand, c.demand);
      acc[c.function].capacity = c.capacity;
      acc[c.function].months.push(c.month);
      return acc;
    },
    {}
  );

  const budgetBarData = activeProjects.slice(0, 8).map(p => ({
    name: p.name.length > 15 ? p.name.substring(0, 15) + "…" : p.name,
    budget: (p.capexBudget ?? 0) + (p.opexBudget ?? 0),
  }));

  return (
    <div className="space-y-5" data-print-target>
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Functional Head Dashboard</h2>
          <p className="text-sm text-gray-500 mt-0.5">Function-level project health, resources, and risks</p>
        </div>
        <IntervalPicker />
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <KPITile label="Projects Under Function" value={activeProjects.length} icon={TrendingUp} gradient="linear-gradient(135deg,#6366F1,#8B5CF6)" />
        <KPITile label="On Track (Green)" value={health?.onTrack ?? 0} icon={CheckSquare} gradient="linear-gradient(135deg,#10B981,#059669)" sub="Healthy projects" />
        <KPITile label="Resource Conflicts" value={Object.keys(conflictsByFunction).length} icon={Users} gradient="linear-gradient(135deg,#EF4444,#DC2626)" sub="Over-allocated teams" />
        <KPITile label="Total Budget" value={formatCurrency(totalBudget)} icon={DollarSign} gradient="linear-gradient(135deg,#3B82F6,#1D4ED8)" sub="CapEx + OpEx" />
      </div>

      {/* Middle row: RAG Pie + Budget Bar */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* RAG Distribution Pie */}
        <DashboardCard title="RAG Distribution" subtitle="Active projects by health status">
          {ragPieData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie
                    data={ragPieData} cx="50%" cy="50%"
                    innerRadius={40} outerRadius={65}
                    paddingAngle={3} dataKey="value" nameKey="name"
                  >
                    {ragPieData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} strokeWidth={0} />
                    ))}
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
            <div className="text-center py-8 text-gray-400 text-sm">No active projects</div>
          )}
        </DashboardCard>

        {/* Budget Bar */}
        <div className="xl:col-span-2">
          <DashboardCard
            title="Budget by Project"
            subtitle="Total allocated budget (CapEx + OpEx)"
            onExportCSV={() => exportCSV("budget-by-project.csv", budgetBarData)}
          >
            {budgetBarData.length > 0 ? (
              <ResponsiveContainer width="100%" height={175}>
                <BarChart data={budgetBarData} margin={{ top: 5, right: 10, bottom: 25, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" interval={0} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `₹${(v / 1e6).toFixed(1)}M`} />
                  <Tooltip
                    contentStyle={{ background: "#1E293B", border: "none", borderRadius: 8, color: "white", fontSize: 12 }}
                    formatter={(v: number) => [formatCurrency(v), "Budget"]}
                  />
                  <Bar dataKey="budget" fill="#6366F1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-center py-8 text-gray-400 text-sm">No project budget data</div>
            )}
          </DashboardCard>
        </div>
      </div>

      {/* Bottom row: Resource Conflicts + Risks + Upcoming Approvals */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* Resource Conflicts */}
        <DashboardCard title="Resource Conflicts" subtitle="Over-allocated teams this period">
          {Object.keys(conflictsByFunction).length === 0 ? (
            <div className="text-center py-6 text-gray-400 text-sm">No resource conflicts detected</div>
          ) : (
            <div className="space-y-2">
              {Object.entries(conflictsByFunction).map(([fn, data]) => (
                <div key={fn} className="p-3 rounded-xl bg-red-50" style={{ borderLeft: "3px solid #EF4444" }}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-gray-800">{fn}</span>
                    <span className="text-xs font-bold text-red-600">{Math.round(data.demand / data.capacity * 100)}% utilized</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">Months: {data.months.join(", ")}</p>
                  <p className="text-xs text-red-500 mt-0.5">
                    Demand: {data.demand}% / Capacity: {data.capacity}%
                  </p>
                </div>
              ))}
            </div>
          )}
        </DashboardCard>

        {/* Risk Hotspots */}
        <DashboardCard title="Risk Hotspots" subtitle="Highest-scoring risks in your function">
          {!topRisks ? (
            <Skeleton className="h-40 rounded-xl" />
          ) : topRisks.length > 0 ? (
            <div className="space-y-2">
              {topRisks.slice(0, 5).map((risk, i) => (
                <div
                  key={risk.id}
                  className="flex items-start gap-2 p-2.5 rounded-lg"
                  style={{
                    background: risk.riskScore >= 6 ? "#FEF2F2" : risk.riskScore >= 4 ? "#FFFBEB" : "#F0FDF4",
                  }}
                >
                  <AlertTriangle size={13} className={`flex-shrink-0 mt-0.5 ${risk.riskScore >= 6 ? "text-red-500" : risk.riskScore >= 4 ? "text-amber-500" : "text-green-500"}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-800 truncate">{risk.title}</p>
                    <p className="text-xs text-gray-400 capitalize">{risk.impact} · {risk.likelihood}</p>
                  </div>
                  <span className="text-xs font-bold text-gray-500 flex-shrink-0">#{risk.riskScore}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-6 text-gray-400 text-sm">No risks recorded</div>
          )}
        </DashboardCard>

        {/* Upcoming Approvals */}
        <DashboardCard title="Upcoming Approvals" subtitle="Actions required with SLA countdown">
          {upcomingApprovals.length === 0 && !loadingProjects ? (
            <div className="text-center py-6 text-gray-400 text-sm">No upcoming approvals</div>
          ) : (
            <div className="space-y-2">
              {upcomingApprovals.map(a => (
                <Link key={a.id} href="/approvals">
                  <div className="flex items-start gap-3 p-3 rounded-xl hover:bg-indigo-50 cursor-pointer transition-colors" style={{ border: "1px solid #E2E8F0" }}>
                    <CheckSquare size={14} className="text-indigo-400 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{a.name}</p>
                      <p className="text-xs text-gray-400">{a.type}</p>
                    </div>
                    <SLACountdown deadline={a.deadline} />
                  </div>
                </Link>
              ))}
              <Link href="/approvals">
                <p className="text-xs text-indigo-500 font-medium text-center mt-2 hover:text-indigo-600 cursor-pointer">View all approvals →</p>
              </Link>
            </div>
          )}
        </DashboardCard>
      </div>

      {/* Utilization Gauge per Function */}
      {capacityData && capacityData.functions.length > 0 && (
        <DashboardCard
          title="Function Utilization Summary"
          subtitle="Average utilization across all tracked months"
          onExportCSV={() => exportCSV("utilization.csv", capacityData.functions.map(fn => {
            const fnCells = capacityData.cells.filter(c => c.function === fn);
            const avgUtil = fnCells.length > 0 ? Math.round(fnCells.reduce((s, c) => s + c.utilization, 0) / fnCells.length) : 0;
            return { Function: fn, "Avg Utilization %": avgUtil };
          }))}
          onExportXLSX={() => exportXLSX("utilization.xlsx", capacityData.functions.map(fn => {
            const fnCells = capacityData.cells.filter(c => c.function === fn);
            const avgUtil = fnCells.length > 0 ? Math.round(fnCells.reduce((s, c) => s + c.utilization, 0) / fnCells.length) : 0;
            return { Function: fn, "Avg Utilization %": avgUtil };
          }))}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {capacityData.functions.map(fn => {
              const fnCells = capacityData.cells.filter(c => c.function === fn);
              const avgUtil = fnCells.length > 0 ? Math.round(fnCells.reduce((s, c) => s + c.utilization, 0) / fnCells.length) : 0;
              const peakUtil = fnCells.length > 0 ? Math.max(...fnCells.map(c => c.utilization)) : 0;
              const gaugeColor = avgUtil > 90 ? "#EF4444" : avgUtil > 70 ? "#F59E0B" : "#10B981";
              const circumference = 2 * Math.PI * 24;
              const offset = circumference - (Math.min(avgUtil, 100) / 100) * circumference;
              return (
                <div key={fn} className="flex items-center gap-3 p-3 rounded-xl" style={{ background: "#F8FAFC", border: "1px solid #E2E8F0" }}>
                  <div className="relative flex-shrink-0">
                    <svg width={56} height={56} className="-rotate-90">
                      <circle cx={28} cy={28} r={24} fill="none" stroke="#E2E8F0" strokeWidth={5} />
                      <circle cx={28} cy={28} r={24} fill="none" stroke={gaugeColor} strokeWidth={5}
                        strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-xs font-bold" style={{ color: gaugeColor }}>{avgUtil}%</span>
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-800 truncate">{fn}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">Peak: {peakUtil}%</p>
                    {avgUtil > 90 && <p className="text-[10px] text-red-500 font-semibold mt-0.5">⚠ Over-allocated</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </DashboardCard>
      )}

      {/* Recommendations */}
      {(() => {
        const recommendations: Array<{ severity: "high" | "medium" | "low"; text: string }> = [];
        const overAllocated = capacityData?.cells.filter(c => c.utilization > 100) ?? [];
        const uniqueOverFns = [...new Set(overAllocated.map(c => c.function))];
        uniqueOverFns.forEach(fn => recommendations.push({ severity: "high", text: `${fn} is over-allocated — consider deferring lower-priority projects or adding resources.` }));

        const atRiskProjects = activeProjects.filter(p => p.ragStatus === "red" || p.ragStatus === "amber");
        if (atRiskProjects.length > 0) recommendations.push({ severity: "medium", text: `${atRiskProjects.length} project${atRiskProjects.length > 1 ? "s are" : " is"} at risk (Amber/Red). Schedule a recovery plan review.` });

        const noEndDate = activeProjects.filter(p => !p.endDate);
        if (noEndDate.length > 0) recommendations.push({ severity: "medium", text: `${noEndDate.length} active project${noEndDate.length > 1 ? "s have" : " has"} no defined end date. Set completion targets to enable tracking.` });

        const highProgress = activeProjects.filter(p => (p.progress ?? 0) >= 90);
        if (highProgress.length > 0) recommendations.push({ severity: "low", text: `${highProgress.length} project${highProgress.length > 1 ? "s are" : " is"} 90%+ complete. Prepare closure and lessons-learned reviews.` });

        if (recommendations.length === 0) recommendations.push({ severity: "low", text: "All systems nominal. No immediate actions required." });

        const colors = { high: { bg: "#FEF2F2", border: "#EF4444", text: "#DC2626", dot: "#EF4444" }, medium: { bg: "#FFFBEB", border: "#F59E0B", text: "#D97706", dot: "#F59E0B" }, low: { bg: "#F0FDF4", border: "#22C55E", text: "#16A34A", dot: "#22C55E" } };

        return recommendations.length > 0 ? (
          <DashboardCard title="Recommendations" subtitle="Action items based on current portfolio health">
            <div className="space-y-2">
              {recommendations.map((r, i) => {
                const c = colors[r.severity];
                return (
                  <div key={i} className="flex items-start gap-3 p-3 rounded-xl" style={{ background: c.bg, borderLeft: `3px solid ${c.border}` }}>
                    <div className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5" style={{ background: c.dot }} />
                    <p className="text-xs text-gray-700 leading-relaxed">{r.text}</p>
                  </div>
                );
              })}
            </div>
          </DashboardCard>
        ) : null;
      })()}

      {/* Priority Project List */}
      <DashboardCard
        title="Projects by Priority"
        subtitle="All active projects sorted by priority and next decision"
        onExportCSV={() => exportCSV("projects-priority.csv", activeProjects.map(p => ({
          Name: p.name, Status: p.status, Priority: p.priority ?? "", RAG: p.ragStatus ?? "", Progress: `${p.progress ?? 0}%`, EndDate: p.endDate ?? "",
        })))}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-400 uppercase tracking-wider border-b" style={{ borderColor: "#F1F5F9" }}>
                <th className="pb-3 text-left font-semibold">Project</th>
                <th className="pb-3 text-left font-semibold">Priority</th>
                <th className="pb-3 text-left font-semibold hidden sm:table-cell">RAG</th>
                <th className="pb-3 text-left font-semibold hidden md:table-cell">Progress</th>
                <th className="pb-3 text-left font-semibold hidden lg:table-cell">Next Decision</th>
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: "#F8FAFC" }}>
              {loadingProjects ? (
                [1,2,3].map(i => <tr key={i}><td colSpan={5} className="py-3"><Skeleton className="h-6" /></td></tr>)
              ) : activeProjects.sort((a, b) => (a.priority ?? "P3").localeCompare(b.priority ?? "P3")).map(p => (
                <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                  <td className="py-3 pr-4">
                    <Link href={`/projects/${p.id}`}>
                      <span className="font-medium text-gray-900 hover:text-indigo-600 cursor-pointer">{p.name}</span>
                    </Link>
                  </td>
                  <td className="py-3 pr-4">
                    <span className="text-xs px-2 py-0.5 rounded font-bold" style={{
                      background: p.priority === "P1" ? "#FEE2E2" : p.priority === "P2" ? "#FFFBEB" : "#F1F5F9",
                      color: p.priority === "P1" ? "#DC2626" : p.priority === "P2" ? "#D97706" : "#64748B",
                    }}>
                      {p.priority ?? "P3"}
                    </span>
                  </td>
                  <td className="py-3 pr-4 hidden sm:table-cell"><RAGBadge status={p.ragStatus} size="xs" /></td>
                  <td className="py-3 pr-4 hidden md:table-cell">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden min-w-[50px]">
                        <div className="h-full rounded-full" style={{ width: `${p.progress ?? 0}%`, background: "linear-gradient(90deg,#6366F1,#8B5CF6)" }} />
                      </div>
                      <span className="text-xs font-bold text-gray-600 w-8">{p.progress ?? 0}%</span>
                    </div>
                  </td>
                  <td className="py-3 hidden lg:table-cell">
                    <span className="text-xs text-gray-400">
                      {p.endDate ? format(new Date(p.endDate), "MMM d, yyyy") : "—"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DashboardCard>
    </div>
  );
}
