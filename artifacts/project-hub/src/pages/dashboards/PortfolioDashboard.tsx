import { useQuery } from "@tanstack/react-query";
import { useListProjects, useListScoringCriteria, useGetDashboardSummary } from "@workspace/api-client-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell,
} from "recharts";
import { AlertTriangle, CheckSquare, Clock, TrendingUp, Trophy, AlertCircle, AlertOctagon, CheckCircle2, Activity, FolderKanban, Bell, Gauge, LayoutDashboard } from "lucide-react";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useMemo, useEffect } from "react";
import { Slider } from "@/components/ui/slider";
import { ViewsMenu } from "../../components/views-menu";
import { useUserView } from "../../hooks/use-user-view";
import {
  KPITile, RAGBadge, DashboardCard, FilterBar, useAutoRefresh, exportCSV,
} from "../../components/dashboard/primitives";
import { BottlenecksByPerson } from "../../components/dashboard/bottlenecks-by-person";
import { PageHeader, MetricCard } from "@/components/ui-kit";

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

type CPPortfolio = {
  onTrack: number; atRisk: number; blocked: number; unmapped: number; total: number;
  bottlenecks: Array<{ stageKey: string; label: string; count: number }>;
  blockedProjects: Array<{ id: number; name: string; blockedStageKey: string; stageLabel: string; daysOverdue: number; owner: { id: number; name: string } | null }>;
};

function useCriticalPathPortfolio(refetchInterval: number | false) {
  return useQuery({
    queryKey: ["/api/dashboard/critical-path-portfolio"],
    queryFn: async () => {
      const r = await fetch("/api/dashboard/critical-path-portfolio");
      if (!r.ok) throw new Error("Failed");
      return r.json() as Promise<CPPortfolio>;
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
      <table className="w-full min-w-[560px] text-xs">
        <thead>
          <tr>
            <th className="text-left pb-2 pr-3 text-muted-foreground font-semibold w-28">Function</th>
            {data.months.map(m => (
              <th key={m} className="pb-2 px-1 text-center text-muted-foreground font-semibold">{m}</th>
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
                      className={`rounded text-center py-1.5 font-bold ${cls.bg} ${cls.text}`}
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

function CriticalPathHealthDonut({ data }: { data?: CPPortfolio }) {
  if (!data) return <Skeleton className="h-40 rounded-xl" />;
  const slices = [
    { name: "On Track", value: data.onTrack, color: "hsl(var(--success))" },
    { name: "At Risk", value: data.atRisk, color: "hsl(var(--warn))" },
    { name: "Blocked", value: data.blocked, color: "hsl(var(--destructive))" },
    { name: "Pre-lifecycle", value: data.unmapped, color: "hsl(var(--muted-foreground) / 0.5)" },
  ].filter((s) => s.value > 0);
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (total === 0) return <p className="text-sm text-muted-foreground text-center py-8">No active projects.</p>;
  return (
    <div className="flex items-center gap-4">
      <ResponsiveContainer width={140} height={140}>
        <PieChart>
          <Pie data={slices} dataKey="value" nameKey="name" innerRadius={42} outerRadius={62} paddingAngle={2} stroke="none">
            {slices.map((s, i) => <Cell key={i} fill={s.color} />)}
          </Pie>
          <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--popover-border))", borderRadius: 8, fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
      <div className="space-y-1.5 flex-1">
        {slices.map((s) => (
          <div key={s.name} className="flex items-center gap-2 text-xs">
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: s.color }} />
            <span className="text-muted-foreground flex-1">{s.name}</span>
            <span className="font-semibold text-foreground num-tabular">{s.value}</span>
            <span className="text-muted-foreground/60 w-9 text-right">{Math.round((s.value / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
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
  const { data: cpPortfolio } = useCriticalPathPortfolio(refetchInterval);

  // Governance metric-row sources — escalations due now + per-person SLA on-time.
  const { data: escRows } = useQuery({
    queryKey: ["/api/dashboard/escalations-required"],
    queryFn: async () => { const r = await fetch("/api/dashboard/escalations-required"); if (!r.ok) throw new Error("Failed"); return r.json() as Promise<unknown[]>; },
    refetchInterval,
  });
  const { data: slaRows } = useQuery({
    queryKey: ["/api/dashboard/approval-sla-performance"],
    queryFn: async () => { const r = await fetch("/api/dashboard/approval-sla-performance"); if (!r.ok) throw new Error("Failed"); return r.json() as Promise<Array<{ onTimePct: number }>>; },
    refetchInterval,
  });
  const avgSla = useMemo(() => {
    if (!slaRows || slaRows.length === 0) return null;
    return Math.round(slaRows.reduce((s, r) => s + (r.onTimePct ?? 0), 0) / slaRows.length);
  }, [slaRows]);
  const mostDelayedStage = cpPortfolio?.bottlenecks?.[0] ?? null;

  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sortBy, setSortBy] = useState<"score" | "name" | "priority">("score");
  const [scenarioWeights, setScenarioWeights] = useState<Record<number, number>>({});
  const [showScenario, setShowScenario] = useState(false);

  // ── Saved scenarios (Stage 3 — Customization). Persists the slider state
  // as named what-if scenarios per user, so a CXO can flip between e.g.
  // "Speed-to-market focus" and "Cash-cost focus" without re-dragging
  // sliders every session.
  const scenarioViews = useUserView<{ scenarioWeights: Record<number, number> }>({
    scope: "portfolio_dashboard",
    fallback: { scenarioWeights: {} },
  });
  useEffect(() => {
    if (scenarioViews.activeId == null) return;
    setScenarioWeights(scenarioViews.activeConfig.scenarioWeights ?? {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarioViews.activeId]);

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
      <PageHeader
        title="Portfolio / PMO Dashboard"
        subtitle="Executive governance · critical path · approvals & escalations"
        icon={LayoutDashboard}
        actions={<RefreshButton />}
      />

      {/* ── Executive governance metric row ──────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        <MetricCard label="Total Projects" value={cpPortfolio?.total ?? 0} icon={FolderKanban} tone="muted" sub={cpPortfolio?.unmapped ? `${cpPortfolio.unmapped} pre-lifecycle` : undefined} />
        <MetricCard label="On Track" value={cpPortfolio?.onTrack ?? 0} icon={CheckCircle2} tone="success" />
        <MetricCard label="At Risk" value={cpPortfolio?.atRisk ?? 0} icon={Clock} tone="warn" />
        <MetricCard label="Blocked" value={cpPortfolio?.blocked ?? 0} icon={AlertOctagon} tone="danger" highlight />
        <MetricCard label="Pending Approvals" value={summary?.pendingApprovals ?? 0} icon={CheckSquare} tone="primary" />
        <MetricCard label="Escalations Req." value={escRows?.length ?? 0} icon={Bell} tone="danger" highlight={(escRows?.length ?? 0) > 0} />
        <MetricCard label="Avg Approval SLA" value={avgSla == null ? "—" : `${avgSla}%`} icon={Gauge} tone={avgSla == null ? "muted" : avgSla >= 80 ? "success" : avgSla >= 50 ? "warn" : "danger"} sub="on-time" />
      </div>

      {/* Intake Pipeline KPIs */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <KPITile label="New Submissions" value={submittedCharters} icon={TrendingUp} tone="primary" sub="Awaiting review" />
        <KPITile label="In Review" value={pendingReviews} icon={Clock} tone="warn" sub="Active review stages" />
        <KPITile label="Pending Approvals" value={summary?.pendingApprovals ?? 0} icon={CheckSquare} tone="success" sub="Awaiting sign-off" />
        <KPITile label="Active Projects" value={health?.active ?? 0} icon={AlertTriangle} tone="primary" sub="In execution" />
      </div>

      {/* ── Critical Path Health ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* Health donut + most delayed stage + bottlenecks */}
        <div className="xl:col-span-2 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <DashboardCard title="Critical Path Health" subtitle="Distribution across active projects">
              <CriticalPathHealthDonut data={cpPortfolio} />
            </DashboardCard>
            <DashboardCard title="Most Delayed Stage" subtitle="Lifecycle stage blocking the most projects">
              {mostDelayedStage ? (
                <div className="flex flex-col items-center justify-center py-4 text-center">
                  <p className="text-4xl font-bold font-mono text-destructive num-tabular">{mostDelayedStage.count}</p>
                  <p className="text-sm font-semibold text-foreground mt-2">{mostDelayedStage.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">project{mostDelayedStage.count === 1 ? "" : "s"} blocked / at risk here</p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">No bottleneck stage — all clear.</p>
              )}
            </DashboardCard>
          </div>
          <DashboardCard
            title="Most Common Bottlenecks"
            subtitle="Lifecycle stages blocking the most projects"
            onExportCSV={() => exportCSV("critical-path-bottlenecks.csv", (cpPortfolio?.bottlenecks ?? []).map(b => ({ Stage: b.label, Projects: b.count })))}
          >
            {!cpPortfolio ? (
              <Skeleton className="h-32 rounded-xl" />
            ) : cpPortfolio.bottlenecks.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No bottlenecks — every active project is on track.</p>
            ) : (
              <div className="space-y-3 pt-1">
                {(() => {
                  const max = Math.max(1, ...cpPortfolio.bottlenecks.map(b => b.count));
                  return cpPortfolio.bottlenecks.map(b => (
                    <div key={b.stageKey} className="flex items-center gap-3">
                      <span className="text-xs font-medium text-muted-foreground w-40 flex-shrink-0 truncate">{b.label}</span>
                      <div className="flex-1 h-5 bg-muted rounded-md overflow-hidden">
                        <div className="h-full rounded-md bg-destructive flex items-center justify-end pr-2" style={{ width: `${Math.max(8, (b.count / max) * 100)}%` }}>
                          <span className="text-[10px] text-destructive-foreground font-bold">{b.count}</span>
                        </div>
                      </div>
                    </div>
                  ));
                })()}
              </div>
            )}
          </DashboardCard>
        </div>

        {/* Blocked projects drill list */}
        <DashboardCard
          title="Top Delayed Projects"
          subtitle="Most overdue first"
          onExportCSV={() => exportCSV("blocked-projects.csv", (cpPortfolio?.blockedProjects ?? []).map(p => ({ Project: p.name, Stage: p.stageLabel, "Days Overdue": p.daysOverdue, Owner: p.owner?.name ?? "—" })))}
        >
          {!cpPortfolio ? (
            <Skeleton className="h-40 rounded-xl" />
          ) : cpPortfolio.blockedProjects.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No blocked projects.</p>
          ) : (
            <div className="space-y-1.5">
              {cpPortfolio.blockedProjects.slice(0, 7).map(p => (
                <Link key={p.id} href={`/projects/${p.id}`}>
                  <div className="flex items-center gap-3 p-3 rounded-lg cursor-pointer hover:translate-x-0.5 transition-transform bg-destructive/10 border-l-2 border-destructive">
                    <Activity size={14} className="flex-shrink-0 text-destructive" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{p.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{p.stageLabel}{p.owner ? ` · ${p.owner.name}` : ""}</p>
                    </div>
                    <p className="text-lg font-bold text-destructive flex-shrink-0">{p.daysOverdue}d</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </DashboardCard>
      </div>

      {/* ── Bottlenecks by Person ─────────────────────────────────────────── */}
      <BottlenecksByPerson />

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
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <p className="text-xs font-semibold text-primary">Scenario Planning — Adjust weights to preview rank changes</p>
              <ViewsMenu
                views={scenarioViews.views}
                activeView={scenarioViews.activeView}
                setActive={scenarioViews.setActive}
                setDefault={scenarioViews.setDefault}
                deleteView={scenarioViews.deleteView}
                saveAs={scenarioViews.saveAs}
                currentConfig={{ scenarioWeights }}
                triggerLabel="Saved scenarios"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {criteria.map((c: { id: number; name: string; weightPct: number }) => (
                <div key={c.id} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-foreground font-medium truncate flex-1 mr-2">{c.name}</span>
                    <span className="text-primary font-bold">{scenarioWeights[c.id] ?? c.weightPct}%</span>
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
                    <span className="text-base font-bold text-muted-foreground/60">#{p.rank}</span>
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
                    <span className="text-base font-bold text-primary">{p.scoringTotal?.toFixed(1) ?? "—"}</span>
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
                      <span className={`text-sm font-bold ${podium}`}>#{i + 1}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{a.name}</p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {a.role || "—"} · {a.department || "—"}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-bold text-success">{a.onTimeOrEarly}<span className="text-muted-foreground font-normal">/{a.completed}</span></p>
                      <p className="text-[10px] text-muted-foreground">{a.onTimePct}% on time</p>
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
                        <p className={`text-lg font-bold ${tone.text}`}>{a.daysWaiting}d</p>
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
                          {f.count > 0 && <span className="text-[10px] text-primary-foreground font-bold">{f.count}</span>}
                        </div>
                      </div>
                      {f.count === 0 && <span className="text-xs text-muted-foreground">0</span>}
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
            <div className="text-3xl font-bold text-foreground num-tabular tracking-tight">
              {(summary as unknown as Record<string, unknown>)?.avgCycleTimeDays != null ? `${(summary as unknown as Record<string, unknown>).avgCycleTimeDays}d` : "—"}
            </div>
            <p className="text-[10px] text-muted-foreground mt-2">Submission to approval (approved charters)</p>
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
                        <span className="text-xs font-bold text-warn">{f.count} charter{f.count > 1 ? "s" : ""}</span>
                        <p className="text-[10px] text-muted-foreground">SLA: {avgDays}d avg</p>
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
