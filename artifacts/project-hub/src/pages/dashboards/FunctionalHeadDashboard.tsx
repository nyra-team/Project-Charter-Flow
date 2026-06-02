import { useListProjects, useGetDashboardSummary } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { AlertTriangle, CheckSquare, TrendingUp, Users, DollarSign, Target } from "lucide-react";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { format, addDays } from "date-fns";
import {
  KPITile, RAGBadge, DashboardCard, SLACountdown, useAutoRefresh, exportCSV, exportXLSX,
} from "../../components/dashboard/primitives";
import { formatCurrency } from "../../lib/format";

type DeliveryStats = {
  window: string;
  tasks: { total: number; onTime: number; pct: number };
  milestones: { total: number; onTime: number; pct: number };
  overall: { total: number; onTime: number; pct: number };
  risks: { totalOpen: number; highSeverity: number; unowned: number };
};

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

function useDeliveryStats(refetchInterval: number | false) {
  return useQuery({
    queryKey: ["/api/dashboard/delivery-stats"],
    queryFn: async () => {
      const r = await fetch("/api/dashboard/delivery-stats");
      if (!r.ok) throw new Error("Failed");
      return r.json() as Promise<DeliveryStats>;
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

export default function FunctionalHeadDashboard() {
  const { refetchInterval, markRefreshed, RefreshButton } = useAutoRefresh();
  const { data: summary } = useGetDashboardSummary({ query: { refetchInterval } as never });
  const { data: projects, isLoading: loadingProjects } = useListProjects(undefined, { query: { refetchInterval } as never });
  const { data: capacityData } = useCapacityDemand(refetchInterval);
  const { data: topRisks } = useTopRisks(refetchInterval);
  const { data: delivery, isLoading: loadingDelivery, isError: deliveryError } = useDeliveryStats(refetchInterval);
  useEffect(() => { if (summary || projects) markRefreshed(); }, [summary, projects]);

  const activeProjects = projects?.filter(p => p.status === "active") ?? [];
  const health = summary?.projectHealth as {
    active?: number; onTrack?: number; offTrack?: number; delayed?: number;
  } | undefined;

  const ragPieData = [
    { name: "Green", value: health?.onTrack ?? 0, fill: "hsl(var(--success))" },
    { name: "Amber", value: health?.offTrack ?? 0, fill: "hsl(var(--warn))" },
    { name: "Red", value: health?.delayed ?? 0, fill: "hsl(var(--destructive))" },
  ].filter(d => d.value > 0);

  const totalBudget = activeProjects.reduce((s, p) => s + ((p.capexBudget ?? 0) + (p.opexBudget ?? 0)), 0);

  const now = new Date();
  const upcomingApprovals = activeProjects.slice(0, 3).map((p, i) => ({
    id: p.id,
    name: p.name,
    deadline: addDays(now, i + 1).toISOString(),
    type: "Stage Gate Review",
  }));

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
          <h2 className="text-xl font-bold text-foreground">Functional Head Dashboard</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Function-level project health, resources, and risks</p>
        </div>
        <RefreshButton />
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <KPITile label="Projects Under Function" value={activeProjects.length} icon={TrendingUp} tone="primary" />
        <KPITile label="On Track (Green)" value={health?.onTrack ?? 0} icon={CheckSquare} tone="success" sub="Healthy projects" />
        <KPITile label="Resource Conflicts" value={Object.keys(conflictsByFunction).length} icon={Users} tone="danger" sub="Over-allocated teams" highlight={Object.keys(conflictsByFunction).length > 0} />
        <KPITile label="Total Budget" value={formatCurrency(totalBudget)} icon={DollarSign} tone="primary" sub="CapEx + OpEx" />
      </div>

      {/* Delivery Stats Row (90d) — earned signal, not vanity */}
      <DashboardCard
        title="Delivery Performance — Last 90 Days"
        subtitle="On-time completion rate across tasks, milestones, and open-risk burden"
        onExportCSV={delivery ? () => exportCSV("delivery-stats.csv", [
          { Scope: "Tasks", "On Time": delivery.tasks.onTime, Total: delivery.tasks.total, "%": delivery.tasks.pct },
          { Scope: "Milestones", "On Time": delivery.milestones.onTime, Total: delivery.milestones.total, "%": delivery.milestones.pct },
          { Scope: "Overall", "On Time": delivery.overall.onTime, Total: delivery.overall.total, "%": delivery.overall.pct },
        ]) : undefined}
      >
        {loadingDelivery ? (
          <Skeleton className="h-32 rounded-xl" />
        ) : deliveryError ? (
          <p className="text-sm text-destructive text-center py-6">Couldn't load delivery stats. Refresh to try again.</p>
        ) : !delivery ? (
          <p className="text-sm text-muted-foreground text-center py-6">No delivery data available.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            {(() => {
              const tone = (pct: number) => pct >= 80 ? { bar: "bg-success", text: "text-success" } : pct >= 60 ? { bar: "bg-warn", text: "text-warn" } : { bar: "bg-destructive", text: "text-destructive" };
              const tiles: Array<{ label: string; pct: number; sub: string; icon: typeof Target }> = [
                { label: "Tasks On-Time", pct: delivery.tasks.pct, sub: `${delivery.tasks.onTime} of ${delivery.tasks.total}`, icon: CheckSquare },
                { label: "Milestones On-Time", pct: delivery.milestones.pct, sub: `${delivery.milestones.onTime} of ${delivery.milestones.total}`, icon: Target },
                { label: "Overall On-Time", pct: delivery.overall.pct, sub: `${delivery.overall.onTime} of ${delivery.overall.total}`, icon: TrendingUp },
              ];
              return (
                <>
                  {tiles.map(t => {
                    const T = tone(t.pct);
                    const Icon = t.icon;
                    return (
                      <div key={t.label} className="p-4 rounded-xl bg-muted/40 border border-border/40">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t.label}</p>
                          <Icon size={14} className="text-muted-foreground" />
                        </div>
                        <div className={`text-2xl font-bold num-tabular ${T.text}`}>{t.pct}%</div>
                        <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${T.bar}`} style={{ width: `${t.pct}%` }} />
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-2">{t.sub}</p>
                      </div>
                    );
                  })}
                  <div className="p-4 rounded-xl bg-muted/40 border border-border/40">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Open Risk Pressure</p>
                      <AlertTriangle size={14} className="text-muted-foreground" />
                    </div>
                    <div className="text-2xl font-bold num-tabular text-foreground">{delivery.risks.totalOpen}</div>
                    <div className="mt-2 flex items-center gap-3 text-[11px]">
                      <span className="text-destructive">{delivery.risks.highSeverity} high</span>
                      <span className="text-warn">{delivery.risks.unowned} unowned</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-2">Open + in-progress risks</p>
                  </div>
                </>
              );
            })()}
          </div>
        )}
      </DashboardCard>

      {/* Middle row: RAG Pie + Budget Bar */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
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
                      <Cell key={i} fill={entry.fill} strokeWidth={0} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--popover-border))", borderRadius: 8, color: "hsl(var(--popover-foreground))", fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex justify-center gap-4 mt-1">
                {ragPieData.map(d => (
                  <div key={d.name} className="flex items-center gap-1.5 text-xs">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: d.fill }} />
                    <span className="text-muted-foreground">{d.name}</span>
                    <span className="font-bold text-foreground">({d.value})</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="text-center py-8 text-muted-foreground text-sm">No active projects</div>
          )}
        </DashboardCard>

        <div className="xl:col-span-2">
          <DashboardCard
            title="Budget by Project"
            subtitle="Total allocated budget (CapEx + OpEx)"
            onExportCSV={() => exportCSV("budget-by-project.csv", budgetBarData)}
          >
            {budgetBarData.length > 0 ? (
              <ResponsiveContainer width="100%" height={175}>
                <BarChart data={budgetBarData} margin={{ top: 5, right: 10, bottom: 25, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} angle={-30} textAnchor="end" interval={0} />
                  <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={v => `₹${(v / 1e6).toFixed(1)}M`} />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--popover-border))", borderRadius: 8, color: "hsl(var(--popover-foreground))", fontSize: 12 }}
                    formatter={(v: number) => [formatCurrency(v), "Budget"]}
                  />
                  <Bar dataKey="budget" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-center py-8 text-muted-foreground text-sm">No project budget data</div>
            )}
          </DashboardCard>
        </div>
      </div>

      {/* Bottom row: Resource Conflicts + Risks + Upcoming Approvals */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <DashboardCard title="Resource Conflicts" subtitle="Over-allocated teams this period">
          {Object.keys(conflictsByFunction).length === 0 ? (
            <div className="text-center py-6 text-muted-foreground text-sm">No resource conflicts detected</div>
          ) : (
            <div className="space-y-2">
              {Object.entries(conflictsByFunction).map(([fn, data]) => (
                <div key={fn} className="p-3 rounded-xl bg-destructive/10 border-l-2 border-destructive">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-foreground">{fn}</span>
                    <span className="text-xs font-bold text-destructive">{Math.round(data.demand / data.capacity * 100)}% utilized</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">Months: {data.months.join(", ")}</p>
                  <p className="text-xs text-destructive/80 mt-0.5">
                    Demand: {data.demand}% / Capacity: {data.capacity}%
                  </p>
                </div>
              ))}
            </div>
          )}
        </DashboardCard>

        <DashboardCard title="Risk Hotspots" subtitle="Highest-scoring risks in your function">
          {!topRisks ? (
            <Skeleton className="h-40 rounded-xl" />
          ) : topRisks.length > 0 ? (
            <div className="space-y-2">
              {topRisks.slice(0, 5).map(risk => {
                const tone = risk.riskScore >= 6
                  ? { bg: "bg-destructive/10", icon: "text-destructive" }
                  : risk.riskScore >= 4
                    ? { bg: "bg-warn/10", icon: "text-warn" }
                    : { bg: "bg-success/10", icon: "text-success" };
                return (
                  <div key={risk.id} className={`flex items-start gap-2 p-2.5 rounded-lg ${tone.bg}`}>
                    <AlertTriangle size={13} className={`flex-shrink-0 mt-0.5 ${tone.icon}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-foreground truncate">{risk.title}</p>
                      <p className="text-xs text-muted-foreground capitalize">{risk.impact} · {risk.likelihood}</p>
                    </div>
                    <span className="text-xs font-bold text-muted-foreground flex-shrink-0">#{risk.riskScore}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-6 text-muted-foreground text-sm">No risks recorded</div>
          )}
        </DashboardCard>

        <DashboardCard title="Upcoming Approvals" subtitle="Actions required with SLA countdown">
          {upcomingApprovals.length === 0 && !loadingProjects ? (
            <div className="text-center py-6 text-muted-foreground text-sm">No upcoming approvals</div>
          ) : (
            <div className="space-y-2">
              {upcomingApprovals.map(a => (
                <Link key={a.id} href="/approvals">
                  <div className="flex items-start gap-3 p-3 rounded-xl hover:bg-primary/5 cursor-pointer transition-colors border border-border">
                    <CheckSquare size={14} className="text-primary flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{a.name}</p>
                      <p className="text-xs text-muted-foreground">{a.type}</p>
                    </div>
                    <SLACountdown deadline={a.deadline} />
                  </div>
                </Link>
              ))}
              <Link href="/approvals">
                <p className="text-xs text-primary font-medium text-center mt-2 hover:text-primary/80 cursor-pointer">View all approvals →</p>
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
              const gaugeStroke = avgUtil > 90 ? "hsl(var(--destructive))" : avgUtil > 70 ? "hsl(var(--warn))" : "hsl(var(--success))";
              const gaugeText = avgUtil > 90 ? "text-destructive" : avgUtil > 70 ? "text-warn" : "text-success";
              const circumference = 2 * Math.PI * 24;
              const offset = circumference - (Math.min(avgUtil, 100) / 100) * circumference;
              return (
                <div key={fn} className="flex items-center gap-3 p-3 rounded-xl bg-muted/40 border border-border/40">
                  <div className="relative flex-shrink-0">
                    <svg width={56} height={56} className="-rotate-90">
                      <circle cx={28} cy={28} r={24} fill="none" stroke="hsl(var(--muted))" strokeWidth={5} />
                      <circle cx={28} cy={28} r={24} fill="none" stroke={gaugeStroke} strokeWidth={5}
                        strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className={`text-xs font-bold ${gaugeText}`}>{avgUtil}%</span>
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-foreground truncate">{fn}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Peak: {peakUtil}%</p>
                    {avgUtil > 90 && <p className="text-[10px] text-destructive font-semibold mt-0.5">⚠ Over-allocated</p>}
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

        const sevClasses = {
          high: { wrap: "bg-destructive/10 border-l-2 border-destructive", dot: "bg-destructive" },
          medium: { wrap: "bg-warn/10 border-l-2 border-warn", dot: "bg-warn" },
          low: { wrap: "bg-success/10 border-l-2 border-success", dot: "bg-success" },
        } as const;

        return recommendations.length > 0 ? (
          <DashboardCard title="Recommendations" subtitle="Action items based on current portfolio health">
            <div className="space-y-2">
              {recommendations.map((r, i) => {
                const c = sevClasses[r.severity];
                return (
                  <div key={i} className={`flex items-start gap-3 p-3 rounded-xl ${c.wrap}`}>
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ${c.dot}`} />
                    <p className="text-xs text-foreground leading-relaxed">{r.text}</p>
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
              <tr className="text-xs text-muted-foreground uppercase tracking-wider border-b border-border/60">
                <th className="pb-3 text-left font-semibold">Project</th>
                <th className="pb-3 text-left font-semibold">Priority</th>
                <th className="pb-3 text-left font-semibold hidden sm:table-cell">RAG</th>
                <th className="pb-3 text-left font-semibold hidden md:table-cell">Progress</th>
                <th className="pb-3 text-left font-semibold hidden lg:table-cell">Next Decision</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {loadingProjects ? (
                [1,2,3].map(i => <tr key={i}><td colSpan={5} className="py-3"><Skeleton className="h-6" /></td></tr>)
              ) : activeProjects.sort((a, b) => (a.priority ?? "P3").localeCompare(b.priority ?? "P3")).map(p => {
                const prCls = p.priority === "P1"
                  ? "bg-destructive/15 text-destructive"
                  : p.priority === "P2"
                    ? "bg-warn/15 text-warn"
                    : "bg-secondary text-secondary-foreground";
                return (
                  <tr key={p.id} className="hover:bg-accent/30 transition-colors">
                    <td className="py-3 pr-4">
                      <Link href={`/projects/${p.id}`}>
                        <span className="font-medium text-foreground hover:text-primary cursor-pointer">{p.name}</span>
                      </Link>
                    </td>
                    <td className="py-3 pr-4">
                      <span className={`text-xs px-2 py-0.5 rounded font-bold ${prCls}`}>
                        {p.priority ?? "P3"}
                      </span>
                    </td>
                    <td className="py-3 pr-4 hidden sm:table-cell"><RAGBadge status={p.ragStatus} size="xs" /></td>
                    <td className="py-3 pr-4 hidden md:table-cell">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden min-w-[50px]">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${p.progress ?? 0}%` }} />
                        </div>
                        <span className="text-xs font-bold text-muted-foreground w-8">{p.progress ?? 0}%</span>
                      </div>
                    </td>
                    <td className="py-3 hidden lg:table-cell">
                      <span className="text-xs text-muted-foreground">
                        {p.endDate ? format(new Date(p.endDate), "MMM d, yyyy") : "—"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </DashboardCard>
    </div>
  );
}
