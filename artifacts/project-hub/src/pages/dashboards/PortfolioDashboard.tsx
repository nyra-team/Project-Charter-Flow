import { useQuery } from "@tanstack/react-query";
import { useListProjects, useListScoringCriteria, useGetDashboardSummary } from "@workspace/api-client-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { AlertTriangle, CheckSquare, Clock, TrendingUp, Trophy, AlertCircle } from "lucide-react";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useMemo, useEffect } from "react";
import { Slider } from "@/components/ui/slider";
import {
  KPITile, RAGBadge, DashboardCard, FilterBar, useAutoRefresh, exportCSV,
} from "../../components/dashboard/primitives";

type StuckApproval = { id: number; charterId: number; charterTitle: string; stage: string; approverName: string; approverRole: string; daysWaiting: number; severity: "red" | "amber" | "green" };
type Achiever = { userId: number; name: string; role: string; department: string; completed: number; onTimeOrEarly: number; late: number; onTimePct: number; avgDaysVsPlan: number };

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

function useStuckApprovals(refetchInterval: number | false) {
  return useQuery({
    queryKey: ["/api/dashboard/stuck-approvals"],
    queryFn: async () => {
      const r = await fetch("/api/dashboard/stuck-approvals");
      if (!r.ok) throw new Error("Failed");
      return r.json() as Promise<{ items: StuckApproval[]; totalPending: number }>;
    },
    refetchInterval,
  });
}

function useMilestoneAchievers(refetchInterval: number | false) {
  return useQuery({
    queryKey: ["/api/dashboard/milestone-achievers"],
    queryFn: async () => {
      const r = await fetch("/api/dashboard/milestone-achievers");
      if (!r.ok) throw new Error("Failed");
      return r.json() as Promise<{ window: string; leaderboard: Achiever[] }>;
    },
    refetchInterval,
  });
}

const THEME_OPTS = ["Digital Transformation", "Cost Optimization", "Growth", "Compliance", "Innovation"].map(v => ({ value: v, label: v }));

function utilizationClasses(u: number): { bg: string; text: string } {
  if (u > 90) return { bg: "bg-destructive/15", text: "text-destructive" };
  if (u > 70) return { bg: "bg-warn/15", text: "text-warn" };
  if (u > 30) return { bg: "bg-success/15", text: "text-success" };
  return { bg: "bg-muted", text: "text-muted-foreground" };
}

function CapacityHeatmap({ data }: { data: ReturnType<typeof useCapacityDemand>["data"] }) {
  if (!data) return <Skeleton className="h-40 rounded-xl" />;
  if (!data.functions.length) return <p className="text-sm text-muted-foreground text-center py-8">No resource allocation data</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr>
            <th className="text-left pb-2 pr-3 text-muted-foreground font-semibold w-28">Function</th>
            {data.months.map(m => (
              <th key={m} className="pb-2 px-1 text-center text-muted-foreground font-semibold font-mono">{m}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.functions.map(fn => (
            <tr key={fn}>
              <td className="pr-3 py-1 text-foreground font-medium truncate max-w-[100px]">{fn}</td>
              {data.months.map(m => {
                const cell = data.cells.find(c => c.function === fn && c.month === m);
                const u = cell?.utilization ?? 0;
                const cls = utilizationClasses(u);
                return (
                  <td key={m} className="px-1 py-1">
                    <div
                      className={`rounded text-center py-1.5 font-bold font-mono ${cls.bg} ${cls.text}`}
                      style={{ minWidth: 40 }}
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

function severityTone(s: "red" | "amber" | "green"): { wrap: string; text: string } {
  if (s === "red") return { wrap: "bg-destructive/10 border-l-2 border-destructive", text: "text-destructive" };
  if (s === "amber") return { wrap: "bg-warn/10 border-l-2 border-warn", text: "text-warn" };
  return { wrap: "bg-success/10 border-l-2 border-success", text: "text-success" };
}

export default function PortfolioDashboard() {
  const { refetchInterval, markRefreshed, RefreshButton } = useAutoRefresh();
  const { data: summary } = useGetDashboardSummary({ query: { refetchInterval } as never });
  const { data: projects } = useListProjects(undefined, { query: { refetchInterval } as never });
  const { data: scoringData, isLoading: loadingRank } = useScoringRank(refetchInterval);
  const { data: healthData } = usePortfolioHealth(refetchInterval);
  const { data: capacityData } = useCapacityDemand(refetchInterval);
  const { data: criteria } = useListScoringCriteria({ query: { refetchInterval } as never });
  const { data: stuck, isLoading: loadingStuck, isError: stuckError } = useStuckApprovals(refetchInterval);
  const { data: achievers, isLoading: loadingAchievers, isError: achieversError } = useMilestoneAchievers(refetchInterval);

  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sortBy, setSortBy] = useState<"score" | "name" | "priority">("score");
  const [scenarioWeights, setScenarioWeights] = useState<Record<number, number>>({});
  const [showScenario, setShowScenario] = useState(false);

  const handleFilter = (k: string, v: string) => setFilters(f => ({ ...f, [k]: v }));

  useEffect(() => { if (summary || projects) markRefreshed(); }, [summary, projects]);

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
          <h2 className="text-xl font-bold text-foreground">Portfolio / PMO Dashboard</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Portfolio intake, prioritization, and capacity management</p>
        </div>
        <div className="flex items-center gap-3">
          <RefreshButton />
        </div>
      </div>

      {/* Intake Pipeline KPIs */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <KPITile label="New Submissions" value={submittedCharters} icon={TrendingUp} tone="primary" sub="Awaiting review" />
        <KPITile label="In Review" value={pendingReviews} icon={Clock} tone="warn" sub="Active review stages" />
        <KPITile label="Pending Approvals" value={summary?.pendingApprovals ?? 0} icon={CheckSquare} tone="success" sub="Awaiting sign-off" />
        <KPITile label="Active Projects" value={health?.active ?? 0} icon={AlertTriangle} tone="primary" sub="In execution" />
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
              className="text-xs rounded-md px-2 py-1 bg-card text-card-foreground border border-border focus:outline-none focus:ring-2 focus:ring-ring/40"
            >
              <option value="score">Sort by Score</option>
              <option value="name">Sort by Name</option>
              <option value="priority">Sort by Priority</option>
            </select>
            <button
              onClick={() => setShowScenario(!showScenario)}
              className={`text-xs px-2 py-1 rounded-md font-medium transition-colors border ${
                showScenario
                  ? "bg-primary/10 text-primary border-primary/30"
                  : "bg-card text-muted-foreground border-border hover:text-foreground"
              }`}
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
          <div className="mb-4 p-4 rounded-xl bg-primary/5 border border-primary/20">
            <p className="text-xs font-semibold text-primary mb-3">Scenario Planning — Adjust weights to preview rank changes</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {criteria.map((c: { id: number; name: string; weightPct: number }) => (
                <div key={c.id} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-foreground font-medium truncate flex-1 mr-2">{c.name}</span>
                    <span className="text-primary font-bold font-mono">{scenarioWeights[c.id] ?? c.weightPct}%</span>
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
            <p className="text-xs text-primary/70 mt-2">Note: Scenario weights do not affect saved scores. They only preview how ranking would change.</p>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground uppercase tracking-wider border-b border-border/60">
                <th className="pb-3 text-left font-semibold w-12">Rank</th>
                <th className="pb-3 text-left font-semibold">Project</th>
                <th className="pb-3 text-left font-semibold hidden md:table-cell">Theme</th>
                <th className="pb-3 text-left font-semibold hidden sm:table-cell">RAG</th>
                <th className="pb-3 text-left font-semibold">Score</th>
                <th className="pb-3 text-left font-semibold hidden lg:table-cell">Priority</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {loadingRank ? (
                [1,2,3,4,5].map(i => (
                  <tr key={i}><td colSpan={6} className="py-3"><Skeleton className="h-6 w-full" /></td></tr>
                ))
              ) : filteredRanked.length > 0 ? filteredRanked.map(p => (
                <tr key={p.id} className="hover:bg-accent/30 transition-colors">
                  <td className="py-3">
                    <span className="text-base font-bold text-muted-foreground/60 font-mono">#{p.rank}</span>
                  </td>
                  <td className="py-3 pr-4">
                    <Link href={`/projects/${p.id}`}>
                      <span className="font-medium text-foreground hover:text-primary cursor-pointer">{p.name}</span>
                    </Link>
                  </td>
                  <td className="py-3 pr-4 hidden md:table-cell">
                    <span className="text-xs text-muted-foreground">{p.strategicTheme || "—"}</span>
                  </td>
                  <td className="py-3 pr-4 hidden sm:table-cell"><RAGBadge status={p.ragStatus} size="xs" /></td>
                  <td className="py-3 pr-4">
                    <span className="text-base font-bold text-primary font-mono">{p.scoringTotal?.toFixed(1) ?? "—"}</span>
                  </td>
                  <td className="py-3 hidden lg:table-cell">
                    <span className="text-xs px-2 py-0.5 rounded-md font-medium bg-secondary text-secondary-foreground">{p.priority}</span>
                  </td>
                </tr>
              )) : (
                <tr><td colSpan={6} className="py-10 text-center text-muted-foreground text-sm">No scored projects yet. Add scoring criteria and score projects to see rankings.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </DashboardCard>

      {/* Milestone Achievers + Stuck Approvals — accountability and recognition row */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {/* Milestone Achievers */}
        <DashboardCard
          title="Milestone Achievers — Last 90 Days"
          subtitle="Top assignees by on-time completions · earned, not gamified"
          onExportCSV={() => exportCSV("milestone-achievers.csv", (achievers?.leaderboard ?? []).map(a => ({
            Name: a.name, Role: a.role, Department: a.department,
            Completed: a.completed, "On-time or Early": a.onTimeOrEarly, Late: a.late,
            "On-time %": a.onTimePct, "Avg Days vs Plan": a.avgDaysVsPlan,
          })))}
        >
          {loadingAchievers ? (
            <Skeleton className="h-40 rounded-xl" />
          ) : achieversError ? (
            <p className="text-sm text-destructive text-center py-6">Couldn't load leaderboard. Refresh to try again.</p>
          ) : !achievers || achievers.leaderboard.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No completed tasks with plan dates in the last 90 days.</p>
          ) : (
            <div className="space-y-2">
              {achievers.leaderboard.slice(0, 6).map((a, i) => {
                const podium = i === 0 ? "text-amber-accent" : i === 1 ? "text-foreground/70" : i === 2 ? "text-warn/80" : "text-muted-foreground";
                return (
                  <div key={a.userId} className="flex items-center gap-3 p-3 rounded-lg bg-muted/40 hover:bg-muted/60 transition-colors">
                    <div className="flex items-center gap-1.5 w-10 flex-shrink-0">
                      {i < 3 && <Trophy size={14} className={podium} />}
                      <span className={`text-sm font-bold font-mono ${podium}`}>#{i + 1}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{a.name}</p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {a.role || "—"} · {a.department || "—"}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-bold text-success font-mono">{a.onTimeOrEarly}<span className="text-muted-foreground font-normal">/{a.completed}</span></p>
                      <p className="text-[10px] text-muted-foreground font-mono">{a.onTimePct}% on time</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </DashboardCard>

        {/* Stuck Approvals */}
        <DashboardCard
          title="Stuck Approvals"
          subtitle="Pending approvals · oldest first (accountability)"
          onExportCSV={() => exportCSV("stuck-approvals.csv", (stuck?.items ?? []).map(a => ({
            Charter: a.charterTitle, Stage: a.stage, Approver: a.approverName, Role: a.approverRole,
            "Days Waiting": a.daysWaiting, Severity: a.severity,
          })))}
        >
          {loadingStuck ? (
            <Skeleton className="h-40 rounded-xl" />
          ) : stuckError ? (
            <p className="text-sm text-destructive text-center py-6">Couldn't load approvals. Refresh to try again.</p>
          ) : !stuck || stuck.items.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No pending approvals — clean queue.</p>
          ) : (
            <div className="space-y-1.5">
              {stuck.items.slice(0, 6).map(a => {
                const tone = severityTone(a.severity);
                return (
                  <Link key={a.id} href="/approvals">
                    <div className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer hover:translate-x-0.5 transition-transform ${tone.wrap}`}>
                      <AlertCircle size={14} className={`flex-shrink-0 ${tone.text}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{a.charterTitle}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          <span className="capitalize">{a.stage.replace(/_/g, " ")}</span> · {a.approverName}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className={`text-lg font-bold font-mono ${tone.text}`}>{a.daysWaiting}d</p>
                      </div>
                    </div>
                  </Link>
                );
              })}
              {stuck.totalPending > 6 && (
                <Link href="/approvals">
                  <p className="text-xs text-primary font-medium text-center mt-2 hover:text-primary/80 cursor-pointer">View all {stuck.totalPending} pending →</p>
                </Link>
              )}
            </div>
          )}
        </DashboardCard>
      </div>

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
                <p className="text-sm text-muted-foreground text-center py-6">No charter data yet</p>
              ) : (
                <div className="space-y-3 pt-1">
                  {funnel.map((f, i) => (
                    <div key={f.stage} className="flex items-center gap-3">
                      <span className="text-xs font-medium text-muted-foreground w-28 flex-shrink-0">{labels[f.stage] ?? f.stage}</span>
                      <div className="flex-1 h-5 bg-muted rounded-md overflow-hidden">
                        <div
                          className={`h-full rounded-md flex items-center justify-end pr-2 transition-all ${i === funnel.length - 1 ? "bg-success" : "bg-primary"}`}
                          style={{ width: `${Math.max(4, (f.count / maxCount) * 100)}%` }}
                        >
                          {f.count > 0 && <span className="text-[10px] text-primary-foreground font-bold font-mono">{f.count}</span>}
                        </div>
                      </div>
                      {f.count === 0 && <span className="text-xs text-muted-foreground font-mono">0</span>}
                    </div>
                  ))}
                </div>
              );
            })()}
          </DashboardCard>
        </div>

        <div className="space-y-4">
          {/* Intake Cycle Time KPI */}
          <div className="rounded-2xl p-5 bg-card border border-card-border glass-surface lift-card">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-1">Avg Intake Cycle Time</p>
            <div className="text-3xl font-bold text-foreground font-mono num-tabular tracking-tight">
              {(summary as unknown as Record<string, unknown>)?.avgCycleTimeDays != null ? `${(summary as unknown as Record<string, unknown>).avgCycleTimeDays}d` : "—"}
            </div>
            <p className="text-[10px] text-muted-foreground font-mono mt-2">Submission to approval (approved charters)</p>
          </div>

          {/* SLA Warnings */}
          <DashboardCard title="SLA Warnings" subtitle="Charters awaiting action beyond normal cycle time">
            {(() => {
              const pipeline = ((summary as unknown as Record<string, unknown>)?.stageGateFunnel as Array<{ stage: string; count: number }> ?? []);
              const avgDays = ((summary as unknown as Record<string, unknown>)?.avgCycleTimeDays as number | null | undefined) ?? 14;
              const warnings = pipeline.filter(f => f.count > 0 && !["submitted", "approved"].includes(f.stage));
              return warnings.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No SLA concerns</p>
              ) : (
                <div className="space-y-2">
                  {warnings.map(f => (
                    <div key={f.stage} className="flex items-center justify-between p-2 rounded-lg bg-warn/10 border-l-2 border-warn">
                      <span className="text-xs font-medium text-foreground capitalize">{f.stage.replace(/_/g, " ")}</span>
                      <div className="text-right">
                        <span className="text-xs font-bold text-warn font-mono">{f.count} charter{f.count > 1 ? "s" : ""}</span>
                        <p className="text-[10px] text-muted-foreground font-mono">SLA: {avgDays}d avg</p>
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
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="week" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} interval={1} />
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} />
                <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--popover-border))", borderRadius: 8, color: "hsl(var(--popover-foreground))", fontSize: 12 }} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="green" stroke="hsl(var(--success))" strokeWidth={2} dot={false} name="Green" />
                <Line type="monotone" dataKey="amber" stroke="hsl(var(--warn))" strokeWidth={2} dot={false} name="Amber" />
                <Line type="monotone" dataKey="red" stroke="hsl(var(--destructive))" strokeWidth={2} dot={false} name="Red" />
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
