import { useQuery } from "@tanstack/react-query";
import { useListProjects, useListScoringCriteria, useGetDashboardSummary } from "@workspace/api-client-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { AlertTriangle, CheckSquare, Clock, TrendingUp } from "lucide-react";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useMemo, useEffect } from "react";
import { Slider } from "@/components/ui/slider";
import {
  KPITile, RAGBadge, DashboardCard, FilterBar, useAutoRefresh, exportCSV, exportXLSX,
} from "../../components/dashboard/primitives";

function usePortfolioHealth(refetchInterval: number | false) {
  return useQuery({
    queryKey: ["/api/dashboard/portfolio-health"],
    queryFn: async () => {
      const r = await fetch("/api/dashboard/portfolio-health");
      if (!r.ok) throw new Error("Failed");
      return r.json() as Promise<{ trend: Array<{ week: string; date: string; green: number; amber: number; red: number }> }>;
    },
    refetchInterval,
  });
}

function useScoringRank(refetchInterval: number | false) {
  return useQuery({
    queryKey: ["/api/projects/scoring-rank"],
    queryFn: async () => {
      const r = await fetch("/api/projects/scoring-rank");
      if (!r.ok) throw new Error("Failed");
      return r.json() as Promise<{
        ranked: Array<{ id: number; name: string; scoringTotal: number; rank: number; ragStatus: string; strategicTheme: string; priority: string; status: string }>;
        criteriaCount: number;
      }>;
    },
    refetchInterval,
  });
}

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

const THEME_OPTS = ["Digital Transformation", "Cost Optimization", "Growth", "Compliance", "Innovation"].map(v => ({ value: v, label: v }));

function CapacityHeatmap({ data }: { data: ReturnType<typeof useCapacityDemand>["data"] }) {
  if (!data) return <Skeleton className="h-40 rounded-xl" />;
  if (!data.functions.length) return <p className="text-sm text-gray-400 text-center py-8">No resource allocation data</p>;

  const getColor = (utilization: number) => {
    if (utilization > 90) return "#FEE2E2";
    if (utilization > 70) return "#FFFBEB";
    if (utilization > 30) return "#ECFDF5";
    return "#F1F5F9";
  };
  const getTextColor = (utilization: number) => {
    if (utilization > 90) return "#DC2626";
    if (utilization > 70) return "#D97706";
    if (utilization > 30) return "#16A34A";
    return "#94A3B8";
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr>
            <th className="text-left pb-2 pr-3 text-gray-400 font-semibold w-28">Function</th>
            {data.months.map(m => (
              <th key={m} className="pb-2 px-1 text-center text-gray-400 font-semibold">{m}</th>
            ))}
          </tr>
        </thead>
        <tbody className="space-y-1">
          {data.functions.map(fn => (
            <tr key={fn}>
              <td className="pr-3 py-1 text-gray-600 font-medium truncate max-w-[100px]">{fn}</td>
              {data.months.map(m => {
                const cell = data.cells.find(c => c.function === fn && c.month === m);
                const u = cell?.utilization ?? 0;
                return (
                  <td key={m} className="px-1 py-1">
                    <div
                      className="rounded text-center py-1.5 font-bold"
                      style={{ background: getColor(u), color: getTextColor(u), minWidth: 40 }}
                      title={`${fn} · ${m}: ${u}% utilized (${cell?.demand ?? 0}% demand / ${cell?.capacity ?? 0}% capacity)`}
                    >
                      {u}%
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PortfolioDashboard() {
  const { refetchInterval, lastRefreshed, markRefreshed, RefreshButton } = useAutoRefresh();
  const { data: summary } = useGetDashboardSummary({ query: { refetchInterval } as never });
  const { data: projects } = useListProjects(undefined, { query: { refetchInterval } as never });
  const { data: scoringData, isLoading: loadingRank } = useScoringRank(refetchInterval);
  const { data: healthData } = usePortfolioHealth(refetchInterval);
  const { data: capacityData } = useCapacityDemand(refetchInterval);
  const { data: criteria } = useListScoringCriteria({ query: { refetchInterval } as never });

  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sortBy, setSortBy] = useState<"score" | "name" | "priority">("score");
  const [scenarioWeights, setScenarioWeights] = useState<Record<number, number>>({});
  const [showScenario, setShowScenario] = useState(false);

  const handleFilter = (k: string, v: string) => setFilters(f => ({ ...f, [k]: v }));

  // markRefreshed when data arrives
  useEffect(() => { if (summary || projects) markRefreshed(); }, [summary, projects]);

  // Scenario ranking — when scenario weights differ from saved, recompute totals from raw criterion scores
  const scenarioRanked = useMemo(() => {
    if (!scoringData?.ranked) return [];
    const hasCustomWeights = criteria && criteria.length > 0 && Object.keys(scenarioWeights).length > 0;
    if (!hasCustomWeights) return [...scoringData.ranked].sort((a, b) => (b.scoringTotal ?? 0) - (a.scoringTotal ?? 0));

    return [...scoringData.ranked]
      .map(p => {
        const criterionScores = (p as { criterionScores?: Array<{ criterionId: number; rawScore: number }> }).criterionScores ?? [];
        const scenarioTotal = criterionScores.reduce((sum, cs) => {
          const weight = scenarioWeights[cs.criterionId] ?? (criteria?.find(c => c.id === cs.criterionId)?.weightPct ?? 0);
          return sum + (cs.rawScore * weight / 100);
        }, 0);
        return { ...p, scoringTotal: scenarioTotal };
      })
      .sort((a, b) => (b.scoringTotal ?? 0) - (a.scoringTotal ?? 0))
      .map((p, idx) => ({ ...p, rank: idx + 1 }));
  }, [scoringData, scenarioWeights, criteria]);

  const filteredRanked = useMemo(() => {
    let list = scenarioRanked;
    if (filters.strategicTheme) list = list.filter(p => p.strategicTheme === filters.strategicTheme);
    return list.sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name);
      if (sortBy === "priority") return a.priority.localeCompare(b.priority);
      return (b.scoringTotal ?? 0) - (a.scoringTotal ?? 0);
    });
  }, [scenarioRanked, filters, sortBy]);

  const health = summary?.projectHealth as { active?: number; onTrack?: number; offTrack?: number; delayed?: number } | undefined;

  const submittedCharters = (summary?.chartersByStatus as Array<{ status: string; count: number }> ?? [])
    .find(c => c.status === "submitted")?.count ?? 0;
  const pendingReviews = (summary?.chartersByStatus as Array<{ status: string; count: number }> ?? [])
    .filter(c => ["parallel_review", "scm_review", "chairman_review", "finance_review", "pmo_review"].includes(c.status))
    .reduce((s, c) => s + c.count, 0);

  return (
    <div className="space-y-5" data-print-target>
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Portfolio / PMO Dashboard</h2>
          <p className="text-sm text-gray-500 mt-0.5">Portfolio intake, prioritization, and capacity management</p>
        </div>
        <div className="flex items-center gap-3">
          <RefreshButton />
        </div>
      </div>

      {/* Intake Pipeline KPIs */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <KPITile label="New Submissions" value={submittedCharters} icon={TrendingUp} gradient="linear-gradient(135deg,#6366F1,#8B5CF6)" sub="Awaiting review" />
        <KPITile label="In Review" value={pendingReviews} icon={Clock} gradient="linear-gradient(135deg,#F59E0B,#D97706)" sub="Active review stages" />
        <KPITile label="Pending Approvals" value={summary?.pendingApprovals ?? 0} icon={CheckSquare} gradient="linear-gradient(135deg,#10B981,#059669)" sub="Awaiting sign-off" />
        <KPITile label="Active Projects" value={health?.active ?? 0} icon={AlertTriangle} gradient="linear-gradient(135deg,#3B82F6,#1D4ED8)" sub="In execution" />
      </div>

      {/* Filters + Ranked table */}
      <DashboardCard
        title="Prioritization Ranking"
        subtitle="Projects sorted by weighted scoring total"
        actions={
          <div className="flex items-center gap-2">
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as "score" | "name" | "priority")}
              className="text-xs border rounded px-2 py-1 bg-white text-gray-600"
              style={{ borderColor: "#E2E8F0" }}
            >
              <option value="score">Sort by Score</option>
              <option value="name">Sort by Name</option>
              <option value="priority">Sort by Priority</option>
            </select>
            <button
              onClick={() => setShowScenario(!showScenario)}
              className="text-xs px-2 py-1 rounded font-medium transition-colors"
              style={{ background: showScenario ? "#EEF2FF" : "#F8FAFC", color: showScenario ? "#6366F1" : "#64748B", border: "1px solid #E2E8F0" }}
            >
              Scenario
            </button>
          </div>
        }
        onExportCSV={() => exportCSV("prioritization-rank.csv", filteredRanked.map(p => ({
          Rank: p.rank, Name: p.name, Score: p.scoringTotal, RAG: p.ragStatus, Theme: p.strategicTheme, Priority: p.priority,
        })))}
      >
        <div className="mb-3">
          <FilterBar
            filters={[{ key: "strategicTheme", label: "Strategic Theme", options: THEME_OPTS }]}
            values={filters}
            onChange={handleFilter}
          />
        </div>

        {/* Scenario Planning Panel */}
        {showScenario && criteria && criteria.length > 0 && (
          <div className="mb-4 p-4 rounded-xl" style={{ background: "#EEF2FF", border: "1px solid #C7D2FE" }}>
            <p className="text-xs font-semibold text-indigo-700 mb-3">Scenario Planning — Adjust weights to preview rank changes</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {criteria.map(c => (
                <div key={c.id} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-700 font-medium truncate flex-1 mr-2">{c.name}</span>
                    <span className="text-indigo-600 font-bold">{scenarioWeights[c.id] ?? c.weightPct}%</span>
                  </div>
                  <Slider
                    value={[scenarioWeights[c.id] ?? c.weightPct]}
                    onValueChange={([v]) => setScenarioWeights(sw => ({ ...sw, [c.id]: v }))}
                    min={0} max={100} step={5}
                    className="h-4"
                  />
                </div>
              ))}
            </div>
            <p className="text-xs text-indigo-500 mt-2">Note: Scenario weights do not affect saved scores. They only preview how ranking would change.</p>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-400 uppercase tracking-wider border-b" style={{ borderColor: "#F1F5F9" }}>
                <th className="pb-3 text-left font-semibold w-12">Rank</th>
                <th className="pb-3 text-left font-semibold">Project</th>
                <th className="pb-3 text-left font-semibold hidden md:table-cell">Theme</th>
                <th className="pb-3 text-left font-semibold hidden sm:table-cell">RAG</th>
                <th className="pb-3 text-left font-semibold">Score</th>
                <th className="pb-3 text-left font-semibold hidden lg:table-cell">Priority</th>
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: "#F8FAFC" }}>
              {loadingRank ? (
                [1,2,3,4,5].map(i => (
                  <tr key={i}><td colSpan={6} className="py-3"><Skeleton className="h-6 w-full" /></td></tr>
                ))
              ) : filteredRanked.length > 0 ? filteredRanked.map(p => (
                <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                  <td className="py-3">
                    <span className="text-base font-bold text-gray-300">#{p.rank}</span>
                  </td>
                  <td className="py-3 pr-4">
                    <Link href={`/projects/${p.id}`}>
                      <span className="font-medium text-gray-900 hover:text-indigo-600 cursor-pointer">{p.name}</span>
                    </Link>
                  </td>
                  <td className="py-3 pr-4 hidden md:table-cell">
                    <span className="text-xs text-gray-500">{p.strategicTheme || "—"}</span>
                  </td>
                  <td className="py-3 pr-4 hidden sm:table-cell"><RAGBadge status={p.ragStatus} size="xs" /></td>
                  <td className="py-3 pr-4">
                    <span className="text-base font-bold text-indigo-600">{p.scoringTotal?.toFixed(1) ?? "—"}</span>
                  </td>
                  <td className="py-3 hidden lg:table-cell">
                    <span className="text-xs px-2 py-0.5 rounded font-medium" style={{ background: "#F1F5F9", color: "#64748B" }}>{p.priority}</span>
                  </td>
                </tr>
              )) : (
                <tr><td colSpan={6} className="py-10 text-center text-gray-400 text-sm">No scored projects yet. Add scoring criteria and score projects to see rankings.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </DashboardCard>

      {/* Stage-gate Compliance Funnel + Intake Cycle Time */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2">
          <DashboardCard
            title="Stage-Gate Compliance Funnel"
            subtitle="Charters progressing through each approval stage"
            onExportCSV={() => exportCSV("stage-gate.csv", ((summary as unknown as Record<string, unknown>)?.stageGateFunnel as Array<{ stage: string; count: number }> ?? []).map(r => ({ Stage: r.stage.replace(/_/g, " "), Count: r.count })))}
          >
            {(() => {
              const funnel = ((summary as unknown as Record<string, unknown>)?.stageGateFunnel as Array<{ stage: string; count: number }> ?? []);
              const labels: Record<string, string> = {
                submitted: "Submitted", parallel_review: "Parallel Review", scm_review: "SCM Review",
                chairman_review: "Chairman", finance_review: "Finance", pmo_review: "PMO Review", approved: "Approved",
              };
              const maxCount = Math.max(1, ...funnel.map(f => f.count));
              return funnel.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">No charter data yet</p>
              ) : (
                <div className="space-y-3 pt-1">
                  {funnel.map((f, i) => (
                    <div key={f.stage} className="flex items-center gap-3">
                      <span className="text-xs font-medium text-gray-500 w-28 flex-shrink-0">{labels[f.stage] ?? f.stage}</span>
                      <div className="flex-1 h-5 bg-gray-100 rounded-md overflow-hidden">
                        <div
                          className="h-full rounded-md flex items-center justify-end pr-2 transition-all"
                          style={{
                            width: `${Math.max(4, (f.count / maxCount) * 100)}%`,
                            background: i === funnel.length - 1 ? "linear-gradient(90deg,#10B981,#059669)" : "linear-gradient(90deg,#6366F1,#8B5CF6)",
                          }}
                        >
                          {f.count > 0 && <span className="text-[10px] text-white font-bold">{f.count}</span>}
                        </div>
                      </div>
                      {f.count === 0 && <span className="text-xs text-gray-400">0</span>}
                    </div>
                  ))}
                </div>
              );
            })()}
          </DashboardCard>
        </div>

        <div className="space-y-4">
          {/* Intake Cycle Time KPI */}
          <div className="rounded-2xl p-5" style={{ background: "white", border: "1px solid #E2E8F0" }}>
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-1">Avg Intake Cycle Time</p>
            <div className="text-3xl font-bold text-gray-900">
              {(summary as unknown as Record<string, unknown>)?.avgCycleTimeDays != null ? `${(summary as unknown as Record<string, unknown>).avgCycleTimeDays}d` : "—"}
            </div>
            <p className="text-xs text-gray-400 mt-1">Submission to approval (approved charters)</p>
          </div>

          {/* SLA Warnings */}
          <DashboardCard title="SLA Warnings" subtitle="Charters awaiting action beyond normal cycle time">
            {(() => {
              const pipeline = ((summary as unknown as Record<string, unknown>)?.stageGateFunnel as Array<{ stage: string; count: number }> ?? []);
              const avgDays = ((summary as unknown as Record<string, unknown>)?.avgCycleTimeDays as number | null | undefined) ?? 14;
              const warnings = pipeline.filter(f => f.count > 0 && !["submitted", "approved"].includes(f.stage));
              return warnings.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">No SLA concerns</p>
              ) : (
                <div className="space-y-2">
                  {warnings.map(f => (
                    <div key={f.stage} className="flex items-center justify-between p-2 rounded-lg" style={{ background: "#FFFBEB", borderLeft: "3px solid #F59E0B" }}>
                      <span className="text-xs font-medium text-gray-700 capitalize">{f.stage.replace(/_/g, " ")}</span>
                      <div className="text-right">
                        <span className="text-xs font-bold text-amber-600">{f.count} charter{f.count > 1 ? "s" : ""}</span>
                        <p className="text-[10px] text-gray-400">SLA: {avgDays}d avg</p>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </DashboardCard>
        </div>
      </div>

      {/* Bottom row: Health Trend + Capacity Heatmap */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <DashboardCard title="Portfolio Health Trend" subtitle="12-week RAG trend">
          {healthData ? (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={healthData.trend} margin={{ top: 5, right: 10, bottom: 0, left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                <XAxis dataKey="week" tick={{ fontSize: 11 }} interval={1} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={{ background: "#1E293B", border: "none", borderRadius: 8, color: "white", fontSize: 12 }} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="green" stroke="#22C55E" strokeWidth={2} dot={false} name="Green" />
                <Line type="monotone" dataKey="amber" stroke="#EAB308" strokeWidth={2} dot={false} name="Amber" />
                <Line type="monotone" dataKey="red" stroke="#EF4444" strokeWidth={2} dot={false} name="Red" />
              </LineChart>
            </ResponsiveContainer>
          ) : <Skeleton className="h-[200px] w-full rounded-xl" />}
        </DashboardCard>

        <DashboardCard title="Capacity vs Demand" subtitle="Function utilization by month (%)">
          <CapacityHeatmap data={capacityData} />
        </DashboardCard>
      </div>
    </div>
  );
}
