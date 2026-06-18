import { useQuery } from "@tanstack/react-query";
import { useGetDashboardSummary, useListProjects } from "@workspace/api-client-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  BarChart3, DollarSign, Calendar, AlertTriangle, CheckSquare, FileText, Clock, Sliders,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ViewsMenu } from "../../components/views-menu";
import { useUserView } from "../../hooks/use-user-view";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { format, addDays } from "date-fns";
import {
  KPITile, RAGBadge, DashboardCard, FilterBar, useAutoRefresh, exportCSV, exportXLSX, exportPDF, type DrillColumn,
} from "../../components/dashboard/primitives";
import { useState, useEffect } from "react";
import { formatCurrency } from "../../lib/format";
import { chartTooltipProps } from "@/components/ui-kit";

type IssueRow = { id: number; projectId: number; type?: string | null; status?: string | null; createdAt?: string | null; resolvedAt?: string | null; title?: string | null };
type StuckApproval = { id: number; charterId: number; charterTitle: string; stage: string; approverName: string; approverRole: string; daysWaiting: number; severity: "red" | "amber" | "green" };

function useAllProjectIssues(projectIds: number[], refetchInterval: number | false) {
  // Stable key — array references change on every render, so without the
  // sort+join the React Query cache is invalidated continuously and the
  // 20-request N+1 fan-out reruns on every parent render.
  const stableKey = [...projectIds].sort((a, b) => a - b).join(",");
  return useQuery({
    queryKey: ["/api/all-project-issues", stableKey],
    enabled: projectIds.length > 0,
    refetchInterval,
    queryFn: async () => {
      const results = await Promise.all(
        projectIds.slice(0, 20).map(id =>
          fetch(`/api/projects/${id}/issues`).then(r => r.ok ? r.json() as Promise<IssueRow[]> : ([] as IssueRow[]))
        )
      );
      return results.flat();
    },
  });
}

function usePortfolioHealth(refetchInterval: number | false) {
  return useQuery({
    queryKey: ["/api/dashboard/portfolio-health"],
    queryFn: async () => {
      const r = await fetch("/api/dashboard/portfolio-health");
      if (!r.ok) throw new Error("Failed");
      return r.json() as Promise<{ trend: Array<{ week: string; date: string; green: number; amber: number; red: number; total: number }> }>;
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

function useTopRisks(refetchInterval: number | false) {
  return useQuery({
    queryKey: ["/api/charters/risks/all"],
    queryFn: async () => {
      const chartersRes = await fetch("/api/charters");
      const charters: Array<{ id: number }> = chartersRes.ok ? await chartersRes.json() : [];
      const riskPromises = charters.slice(0, 10).map(c =>
        fetch(`/api/charters/${c.id}/risks`).then(r => r.ok ? r.json() : [])
      );
      const riskGroups = await Promise.all(riskPromises);
      const allRisks = riskGroups.flat() as Array<{
        id: number; title: string; impact: string; likelihood: string;
        owner?: string; mitigation?: string; status?: string;
      }>;
      const scored = allRisks.map(r => {
        const impactScore = r.impact === "high" ? 3 : r.impact === "medium" ? 2 : 1;
        const likelScore = r.likelihood === "high" ? 3 : r.likelihood === "medium" ? 2 : 1;
        return { ...r, riskScore: impactScore * likelScore };
      });
      return scored.sort((a, b) => b.riskScore - a.riskScore).slice(0, 5);
    },
    refetchInterval,
  });
}

const TIME_PERIOD_OPTS = ["Last 30 days", "Last 90 days", "This Year", "All Time"].map(v => ({ value: v, label: v }));
const STRATEGIC_THEMES = ["Digital Transformation", "Cost Optimization", "Growth", "Compliance", "Innovation"].map(v => ({ value: v, label: v }));
const SITE_OPTS = ["HQ", "North", "South", "East", "West"].map(v => ({ value: v, label: v }));
const PROJECT_TYPE_OPTS = ["Infrastructure", "Software", "Process", "Compliance"].map(v => ({ value: v, label: v }));
const FUNCTION_OPTS = ["IT", "Finance", "Operations", "HR", "Commercial", "Supply Chain", "Legal", "Marketing", "Strategy"].map(v => ({ value: v, label: v }));

function severityTone(s: "red" | "amber" | "green"): { wrap: string; text: string } {
  if (s === "red") return { wrap: "bg-destructive/10 border-l-2 border-destructive", text: "text-destructive" };
  if (s === "amber") return { wrap: "bg-warn/10 border-l-2 border-warn", text: "text-warn" };
  return { wrap: "bg-success/10 border-l-2 border-success", text: "text-success" };
}

export default function ExecutiveDashboard() {
  const { refetchInterval, lastRefreshed, markRefreshed, RefreshButton } = useAutoRefresh();
  const { data: summary, isLoading: loadingSummary } = useGetDashboardSummary({ query: { refetchInterval } as never });
  const { data: projects, isLoading: loadingProjects } = useListProjects(undefined, { query: { refetchInterval } as never });
  useEffect(() => { if (summary) markRefreshed(); }, [summary]);
  const { data: healthData } = usePortfolioHealth(refetchInterval);
  const { data: topRisks } = useTopRisks(refetchInterval);
  const { data: stuck, isLoading: loadingStuck, isError: stuckError } = useStuckApprovals(refetchInterval);

  const [filters, setFilters] = useState<Record<string, string>>({});
  const handleFilter = (k: string, v: string) => setFilters(f => ({ ...f, [k]: v }));

  const activeProjects = projects?.filter(p => p.status === "active") ?? [];
  const { data: allIssues = [] } = useAllProjectIssues(activeProjects.map(p => p.id), refetchInterval);

  // Latest delay / on-hold justification per project — fills the drill-down
  // "Justification" column. Same endpoint the Projects page uses.
  const { data: justifications = [] } = useQuery({
    queryKey: ["/api/project-justifications/latest"],
    queryFn: async () => {
      const r = await fetch("/api/project-justifications/latest");
      if (!r.ok) return [] as Array<{ projectId: number; justification: string }>;
      return r.json() as Promise<Array<{ projectId: number; justification: string }>>;
    },
  });
  const justificationByProject = new Map(justifications.map(j => [j.projectId, j.justification]));

  const health = summary?.projectHealth as {
    active?: number; onTrack?: number; offTrack?: number; delayed?: number;
  } | undefined;
  const greenCount = health?.onTrack ?? 0;
  const amberCount = health?.offTrack ?? 0;
  const redCount = health?.delayed ?? 0;

  const upcomingIn30 = activeProjects.filter(p => {
    if (!p.endDate) return false;
    const d = new Date(p.endDate);
    const now = new Date();
    return d >= now && d <= addDays(now, 30);
  });
  const upcomingIn60 = activeProjects.filter(p => {
    if (!p.endDate) return false;
    const d = new Date(p.endDate);
    const now = new Date();
    const cutoff30 = addDays(now, 30);
    return d > cutoff30 && d <= addDays(now, 60);
  });

  const topProjects = [...activeProjects]
    .sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0))
    .slice(0, 10);

  const isLoading = loadingSummary || loadingProjects;

  // ── Drill-down data — the actual rows behind each KPI / chart ──────────────
  const healthFull = summary?.projectHealth as {
    active?: number; onTrack?: number; offTrack?: number; delayed?: number;
    offTrackProjects?: Array<{ id: number; name: string; reason?: string; behindBy?: number }>;
    delayedProjects?: Array<{ id: number; name: string; reason?: string; daysOverdue?: number }>;
  } | undefined;
  const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const fmtDate = (d?: string | null) => (d ? format(new Date(d), "MMM d, yyyy") : "—");
  const schedVarDays = (p: { startDate?: string | null; endDate?: string | null; progress?: number | null }) => {
    if (!p.startDate || !p.endDate) return 0;
    const start = new Date(p.startDate).getTime(), end = new Date(p.endDate).getTime();
    const totalDays = Math.max(1, (end - start) / 86400000);
    const elapsed = Math.max(0, (Date.now() - start) / 86400000);
    const expected = Math.min(100, (elapsed / totalDays) * 100);
    return Math.round((((p.progress ?? 0) - expected) / 100) * totalDays);
  };

  const projectCols: DrillColumn[] = [
    { key: "name", label: "Project" },
    { key: "rag", label: "RAG", render: (v) => titleCase(String(v ?? "—")) },
    { key: "progress", label: "Progress", align: "right", render: (v) => `${v ?? 0}%` },
    { key: "justification", label: "Justification", render: (v) => String(v || "—") },
    { key: "due", label: "Due", render: (v) => String(v ?? "—") },
  ];
  const toProjectRow = (p: typeof activeProjects[number]) => ({
    name: p.name, rag: p.ragStatus ?? "—", progress: p.progress ?? 0,
    justification: justificationByProject.get(p.id) ?? "", due: fmtDate(p.endDate),
  });
  const activeRows = activeProjects.map(toProjectRow);
  const greenRows = activeProjects.filter((p) => (p.ragStatus ?? "green") === "green").map(toProjectRow);
  const amberRows = (healthFull?.offTrackProjects ?? []).map((p) => ({ name: p.name, reason: p.reason ?? "—", behind: p.behindBy != null ? `${p.behindBy}% behind` : "—" }));
  const redRows = (healthFull?.delayedProjects ?? []).map((p) => ({ name: p.name, reason: p.reason ?? "—", overdue: p.daysOverdue != null ? `+${p.daysOverdue}d` : "—" }));
  const budgetRows = activeProjects.map((p) => ({
    name: p.name, capex: p.capexBudget ?? 0, opex: p.opexBudget ?? 0,
    total: (p.capexBudget ?? 0) + (p.opexBudget ?? 0), progress: `${p.progress ?? 0}%`,
  }));
  const budgetCols: DrillColumn[] = [
    { key: "name", label: "Project" },
    { key: "capex", label: "CapEx", align: "right", render: (v) => formatCurrency(Number(v ?? 0)) },
    { key: "opex", label: "OpEx", align: "right", render: (v) => formatCurrency(Number(v ?? 0)) },
    { key: "total", label: "Total", align: "right", render: (v) => formatCurrency(Number(v ?? 0)) },
    { key: "progress", label: "Progress", align: "right" },
  ];
  const schedRows = activeProjects.filter((p) => p.startDate && p.endDate).map((p) => ({
    name: p.name, progress: `${p.progress ?? 0}%`, variance: schedVarDays(p),
  }));
  const schedCols: DrillColumn[] = [
    { key: "name", label: "Project" },
    { key: "progress", label: "Progress", align: "right" },
    { key: "variance", label: "Schedule Variance", align: "right", render: (v) => `${Number(v) >= 0 ? "+" : ""}${v}d` },
  ];
  const dueRows = upcomingIn30.map((p) => ({ name: p.name, due: fmtDate(p.endDate) }));
  const dueCols: DrillColumn[] = [{ key: "name", label: "Project" }, { key: "due", label: "Due Date" }];
  const approvalRows = (stuck?.items ?? []).map((a) => ({
    charter: a.charterTitle, stage: titleCase(a.stage), approver: a.approverName, days: a.daysWaiting,
  }));
  const approvalCols: DrillColumn[] = [
    { key: "charter", label: "Charter" },
    { key: "stage", label: "Stage" },
    { key: "approver", label: "Approver" },
    { key: "days", label: "Days Waiting", align: "right", render: (v) => `${v}d` },
  ];

  // ── Tile customization (Stage 3 — Customization). Stable keys for each
  // KPI tile let the user hide/reorder per-saved-view. Re-ordering is a
  // follow-up; for v1 we ship hide-only because it covers the highest-value
  // "this number is noise for me" complaint without rewriting the JSX.
  const TILE_KEYS = [
    { key: "active", label: "Total Active Projects" },
    { key: "green", label: "On Track (Green)" },
    { key: "amber", label: "At Risk (Amber)" },
    { key: "red", label: "Delayed (Red)" },
    { key: "budgetVar", label: "Budget Variance" },
    { key: "schedVar", label: "Schedule Variance" },
    { key: "dueIn30", label: "Due in 30 Days" },
    { key: "pendingApprovals", label: "Pending Approvals" },
  ] as const;
  type TileKey = (typeof TILE_KEYS)[number]["key"];
  const tileViews = useUserView<{ hiddenKeys: TileKey[] }>({
    scope: "exec_dashboard",
    fallback: { hiddenKeys: [] },
  });
  const hiddenKeys = new Set(tileViews.activeConfig.hiddenKeys ?? []);
  const isShown = (k: TileKey) => !hiddenKeys.has(k);

  // The popover edits the active-view's hiddenKeys live and writes via
  // saveAs against the active key (or "Custom" if no view is active).
  async function toggleTile(k: TileKey) {
    const next = new Set(hiddenKeys);
    if (next.has(k)) next.delete(k); else next.add(k);
    const keyName = tileViews.activeView?.key ?? "Custom";
    await tileViews.saveAs(keyName, { hiddenKeys: Array.from(next) as TileKey[] }, { setDefault: tileViews.activeView?.isDefault });
  }

  return (
    <div className="space-y-5" data-print-target>
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-foreground">Executive Dashboard</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Portfolio-wide view for executive leadership</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Customize tiles (Stage 3) — hide noise per user. */}
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 px-3 h-9 rounded-md text-sm border border-border bg-card hover:bg-accent transition-colors"
                data-testid="btn-customize-tiles"
              >
                <Sliders size={14} />
                Customize tiles
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-3">
              <p className="text-xs font-semibold text-foreground mb-2">Show / hide KPI tiles</p>
              <div className="space-y-2">
                {TILE_KEYS.map((t) => (
                  <div key={t.key} className="flex items-center gap-2">
                    <Checkbox
                      id={`tile-${t.key}`}
                      checked={isShown(t.key)}
                      onCheckedChange={() => toggleTile(t.key)}
                    />
                    <Label htmlFor={`tile-${t.key}`} className="text-xs cursor-pointer">{t.label}</Label>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground mt-3 leading-snug">
                Changes auto-save to the active view (or "Custom" if none is active).
              </p>
            </PopoverContent>
          </Popover>
          <ViewsMenu
            views={tileViews.views}
            activeView={tileViews.activeView}
            setActive={tileViews.setActive}
            setDefault={tileViews.setDefault}
            deleteView={tileViews.deleteView}
            saveAs={tileViews.saveAs}
            currentConfig={{ hiddenKeys: Array.from(hiddenKeys) as TileKey[] }}
            triggerLabel="My layout"
          />
          <RefreshButton />
        </div>
      </div>

      {/* Filter Bar */}
      <div className="rounded-2xl p-4 bg-card border border-card-border glass-surface">
        <FilterBar
          filters={[
            { key: "timePeriod", label: "Time Period", options: TIME_PERIOD_OPTS },
            { key: "function", label: "Function", options: FUNCTION_OPTS },
            { key: "strategicTheme", label: "Strategic Theme", options: STRATEGIC_THEMES },
            { key: "site", label: "Site", options: SITE_OPTS },
            { key: "projectType", label: "Project Type", options: PROJECT_TYPE_OPTS },
          ]}
          values={filters}
          onChange={handleFilter}
        />
      </div>

      {/* KPI Row */}
      {isLoading ? (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {[1,2,3,4,5,6,7,8].map(i => <Skeleton key={i} className="h-24 rounded-2xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {(() => {
            const now = new Date();
            const totalPlanned = activeProjects.reduce((s, p) => s + (p.capexBudget ?? 0) + (p.opexBudget ?? 0), 0);
            const avgProgress = activeProjects.length > 0 ? activeProjects.reduce((s, p) => s + (p.progress ?? 0), 0) / activeProjects.length : 0;
            const estimatedSpend = totalPlanned * (avgProgress / 100);
            const budgetVariancePct = totalPlanned > 0 ? Math.round(((estimatedSpend - totalPlanned * 0.5) / totalPlanned) * 100) : 0;
            const schedVarianceDays = Math.round(activeProjects.reduce((s, p) => {
              if (!p.startDate || !p.endDate) return s;
              const start = new Date(p.startDate), end = new Date(p.endDate);
              const totalDays = Math.max(1, (end.getTime() - start.getTime()) / 86400000);
              const elapsed = Math.max(0, (now.getTime() - start.getTime()) / 86400000);
              const expected = Math.min(100, (elapsed / totalDays) * 100);
              return s + ((((p.progress ?? 0) - expected) / 100) * totalDays);
            }, 0) / Math.max(1, activeProjects.filter(p => p.startDate && p.endDate).length));
            return (
              <>
                {isShown("active") && <KPITile label="Total Active Projects" value={health?.active ?? 0} icon={BarChart3} tone="primary"
                  drill={{ subtitle: "Projects currently in execution", columns: projectCols, rows: activeRows, linkHref: "/projects", linkLabel: "View all projects", emptyText: "No active projects." }} />}
                {isShown("green") && <KPITile label="On Track (Green)" value={greenCount} icon={CheckSquare} tone="success"
                  drill={{ subtitle: "Active projects with a green RAG status", columns: projectCols, rows: greenRows, linkHref: "/projects", linkLabel: "View all projects", emptyText: "No on-track projects." }} />}
                {isShown("amber") && <KPITile label="At Risk (Amber)" value={amberCount} icon={AlertTriangle} tone="warn"
                  drill={{ subtitle: "Projects flagged off-track", columns: [{ key: "name", label: "Project" }, { key: "reason", label: "Reason" }, { key: "behind", label: "Status", align: "right" }], rows: amberRows, linkHref: "/projects", linkLabel: "View all projects", emptyText: "No at-risk projects." }} />}
                {isShown("red") && <KPITile label="Delayed (Red)" value={redCount} icon={AlertTriangle} tone="danger" highlight={redCount > 0}
                  drill={{ subtitle: "Projects past their planned schedule", columns: [{ key: "name", label: "Project" }, { key: "reason", label: "Reason" }, { key: "overdue", label: "Overdue", align: "right" }], rows: redRows, linkHref: "/projects", linkLabel: "View all projects", emptyText: "No delayed projects." }} />}
                {isShown("budgetVar") && (
                  <KPITile
                    label="Budget Variance"
                    value={`${budgetVariancePct >= 0 ? "+" : ""}${budgetVariancePct}%`}
                    icon={DollarSign}
                    tone={budgetVariancePct > 10 ? "danger" : budgetVariancePct > 0 ? "warn" : "success"}
                    sub={`Portfolio: ${formatCurrency(totalPlanned)}`}
                    trend={budgetVariancePct > 5 ? "down" : budgetVariancePct < -5 ? "up" : "flat"}
                    trendLabel={budgetVariancePct > 0 ? "Over baseline" : "Under baseline"}
                    caption="How much over or under budget the project is."
                    drill={{ subtitle: "Budget per active project (CapEx + OpEx) feeding the variance", columns: budgetCols, rows: budgetRows, linkHref: "/projects", linkLabel: "View all projects", emptyText: "No project budgets." }}
                  />
                )}
                {isShown("schedVar") && (
                  <KPITile
                    label="Schedule Variance"
                    value={`${schedVarianceDays >= 0 ? "+" : ""}${schedVarianceDays}d`}
                    icon={Calendar}
                    tone={schedVarianceDays < -5 ? "danger" : schedVarianceDays < 0 ? "warn" : "success"}
                    sub="Avg across active projects"
                    trend={schedVarianceDays >= 0 ? "up" : "down"}
                    trendLabel={schedVarianceDays >= 0 ? "Ahead of plan" : "Behind plan"}
                    caption="How many days ahead of or behind schedule the project is."
                    drill={{ subtitle: "Schedule variance per active project (progress vs elapsed time)", columns: schedCols, rows: schedRows, linkHref: "/projects", linkLabel: "View all projects", emptyText: "No projects with start/end dates." }}
                  />
                )}
                {isShown("dueIn30") && <KPITile label="Due in 30 Days" value={upcomingIn30.length} icon={Clock} tone="amber" sub="Upcoming deadlines"
                  drill={{ subtitle: "Active projects due within 30 days", columns: dueCols, rows: dueRows, linkHref: "/projects", linkLabel: "View all projects", emptyText: "No deadlines in the next 30 days." }} />}
                {isShown("pendingApprovals") && <KPITile label="Pending Approvals" value={summary?.pendingApprovals ?? 0} icon={FileText} tone="primary" sub="Awaiting action"
                  drill={{ subtitle: "Charters awaiting approval, oldest first", columns: approvalCols, rows: approvalRows, linkHref: "/approvals", linkLabel: "Open approvals queue", emptyText: "No pending approvals." }} />}
              </>
            );
          })()}
        </div>
      )}

      {/* Main 2-col layout */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* Top 10 Projects */}
        <div className="xl:col-span-2">
          <DashboardCard
            title="Top Strategic Projects"
            subtitle="Active projects by progress — with sponsor and next milestone"
            onExportCSV={() => exportCSV("top-projects.csv", topProjects.map(p => ({
              Name: p.name, RAG: p.ragStatus ?? "green", Progress: `${p.progress ?? 0}%`,
              Sponsor: (p as unknown as Record<string,unknown>).projectSponsorId ?? "—",
              "End Date": p.endDate ?? "", Budget: (p.capexBudget ?? 0) + (p.opexBudget ?? 0),
            })))}
            onExportXLSX={() => exportXLSX("top-projects.xlsx", topProjects.map(p => ({
              Name: p.name, RAG: p.ragStatus ?? "green", Progress: p.progress ?? 0,
              Sponsor: (p as unknown as Record<string,unknown>).projectSponsorId ?? "—",
              "End Date": p.endDate ?? "", Budget: (p.capexBudget ?? 0) + (p.opexBudget ?? 0),
            })))}
            onExportPDF={() => exportPDF("Executive Dashboard - Top Projects")}
            lastRefreshed={lastRefreshed}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground uppercase tracking-wider border-b border-border/60">
                    <th className="pb-3 text-left font-semibold">Project</th>
                    <th className="pb-3 text-left font-semibold">RAG</th>
                    <th className="pb-3 text-left font-semibold hidden md:table-cell">Progress</th>
                    <th className="pb-3 text-left font-semibold hidden lg:table-cell">Sponsor</th>
                    <th className="pb-3 text-left font-semibold hidden xl:table-cell">Due Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {isLoading ? (
                    [1,2,3,4,5].map(i => (
                      <tr key={i}><td colSpan={5} className="py-3"><Skeleton className="h-6 w-full" /></td></tr>
                    ))
                  ) : topProjects.length > 0 ? topProjects.map(p => {
                    const pp = p as unknown as Record<string,unknown>;
                    const sponsorName = pp.projectSponsorName as string | undefined;
                    return (
                    <tr key={p.id} className="hover:bg-accent/30 transition-colors">
                      <td className="py-3 pr-4">
                        <Link href={`/projects/${p.id}`}>
                          <span className="font-medium text-foreground hover:text-primary cursor-pointer truncate block max-w-[180px]">{p.name}</span>
                        </Link>
                      </td>
                      <td className="py-3 pr-4"><RAGBadge status={p.ragStatus} /></td>
                      <td className="py-3 pr-4 hidden md:table-cell">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden min-w-[60px]">
                            <div className="h-full rounded-full bg-primary" style={{ width: `${p.progress ?? 0}%` }} />
                          </div>
                          <span className="text-xs font-bold text-muted-foreground w-8">{p.progress ?? 0}%</span>
                        </div>
                      </td>
                      <td className="py-3 pr-4 hidden lg:table-cell">
                        <span className="text-xs text-muted-foreground truncate block max-w-[100px]">{sponsorName ?? "—"}</span>
                      </td>
                      <td className="py-3 hidden xl:table-cell">
                        {p.endDate ? (
                          <span className="text-xs text-muted-foreground flex items-center gap-1"><Clock size={10} /> {format(new Date(p.endDate), "MMM d, yyyy")}</span>
                        ) : <span className="text-xs text-muted-foreground/60">—</span>}
                      </td>
                    </tr>
                    );
                  }) : (
                    <tr><td colSpan={5} className="py-8 text-center text-muted-foreground text-sm">No active projects</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </DashboardCard>
        </div>

        {/* Top 5 Risks */}
        <div className="xl:col-span-1">
          <DashboardCard
            title="Top 5 Risks"
            subtitle="Highest risk score across portfolio"
            onExportCSV={() => exportCSV("top-risks.csv", (topRisks ?? []).map(r => ({
              Risk: r.title, Score: r.riskScore, Impact: r.impact, Likelihood: r.likelihood, Owner: r.owner ?? "",
            })))}
          >
            <div className="space-y-2">
              {!topRisks ? (
                [1,2,3,4,5].map(i => <Skeleton key={i} className="h-14 rounded-xl" />)
              ) : topRisks.length > 0 ? topRisks.map((risk, i) => {
                const tone = risk.riskScore >= 6 ? severityTone("red") : risk.riskScore >= 4 ? severityTone("amber") : severityTone("green");
                return (
                  <div key={risk.id} className={`p-3 rounded-xl ${tone.wrap}`}>
                    <div className="flex items-start gap-2">
                      <span className="text-xs font-bold text-muted-foreground/70 w-4 flex-shrink-0 mt-0.5">#{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">{risk.title}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-muted-foreground capitalize">{risk.impact} impact</span>
                          <span className="text-muted-foreground/40">·</span>
                          <span className={`text-xs font-bold ${tone.text}`}>
                            Score: {risk.riskScore}
                          </span>
                        </div>
                        {risk.owner && <p className="text-xs text-muted-foreground/70 mt-0.5">Owner: {risk.owner}</p>}
                      </div>
                    </div>
                  </div>
                );
              }) : (
                <div className="text-center py-6 text-muted-foreground text-sm">No risks recorded</div>
              )}
            </div>
          </DashboardCard>
        </div>
      </div>

      {/* Stuck Approvals — Accountability View */}
      <DashboardCard
        title="Stuck Approvals — Oldest First"
        subtitle="Pending approvals sorted by days waiting · approvers held to account"
        onExportCSV={() => exportCSV("stuck-approvals.csv", (stuck?.items ?? []).map(a => ({
          Charter: a.charterTitle, Stage: a.stage, Approver: a.approverName, Role: a.approverRole,
          "Days Waiting": a.daysWaiting, Severity: a.severity,
        })))}
      >
        {loadingStuck ? (
          <Skeleton className="h-32 rounded-xl" />
        ) : stuckError ? (
          <p className="text-sm text-destructive text-center py-6">Couldn't load approvals. Refresh to try again.</p>
        ) : !stuck || stuck.items.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">No pending approvals — clean queue.</p>
        ) : (
          <div className="space-y-1.5">
            {stuck.items.slice(0, 8).map(a => {
              const tone = severityTone(a.severity);
              return (
                <Link key={a.id} href="/approvals">
                  <div className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer hover:translate-x-0.5 transition-transform ${tone.wrap}`}>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{a.charterTitle}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        <span className="capitalize">{a.stage.replace(/_/g, " ")}</span> · {a.approverName}
                        {a.approverRole && <span className="text-muted-foreground/70"> ({a.approverRole})</span>}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className={`text-lg font-bold ${tone.text}`}>{a.daysWaiting}d</p>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">waiting</p>
                    </div>
                  </div>
                </Link>
              );
            })}
            {stuck.totalPending > 8 && (
              <Link href="/approvals">
                <p className="text-xs text-primary font-medium text-center mt-2 hover:text-primary/80 cursor-pointer">View all {stuck.totalPending} pending →</p>
              </Link>
            )}
          </div>
        )}
      </DashboardCard>

      {/* Budget & Schedule Variance */}
      {(() => {
        const now = new Date();
        const varianceRows = activeProjects.map(p => {
          const startDate = p.startDate ? new Date(p.startDate) : null;
          const endDate = p.endDate ? new Date(p.endDate) : null;
          const progress = p.progress ?? 0;
          let schedVariance = 0;
          if (startDate && endDate) {
            const totalDays = Math.max(1, (endDate.getTime() - startDate.getTime()) / 86400000);
            const elapsed = Math.max(0, (now.getTime() - startDate.getTime()) / 86400000);
            const expectedPct = Math.min(100, (elapsed / totalDays) * 100);
            schedVariance = Math.round(((progress - expectedPct) / 100) * totalDays);
          }
          const totalBudget = (p.capexBudget ?? 0) + (p.opexBudget ?? 0);
          return { id: p.id, name: p.name, ragStatus: p.ragStatus, progress, schedVariance, totalBudget };
        });
        const exportRows = varianceRows.map(r => ({
          Project: r.name, RAG: r.ragStatus ?? "green", Progress: `${r.progress}%`,
          "Schedule Variance (days)": r.schedVariance, "Total Budget": r.totalBudget,
        }));
        return (
          <DashboardCard
            title="Budget & Schedule Variance"
            subtitle="Schedule vs actual progress for active projects"
            onExportCSV={() => exportCSV("variance.csv", exportRows)}
            onExportXLSX={() => exportXLSX("variance.xlsx", exportRows)}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground uppercase tracking-wider border-b border-border/60">
                    <th className="pb-2 text-left font-semibold">Project</th>
                    <th className="pb-2 text-left font-semibold hidden sm:table-cell">RAG</th>
                    <th className="pb-2 text-left font-semibold">Progress</th>
                    <th className="pb-2 text-left font-semibold hidden md:table-cell">Schedule Variance</th>
                    <th className="pb-2 text-left font-semibold hidden lg:table-cell">Budget</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {isLoading ? (
                    [1,2,3].map(i => <tr key={i}><td colSpan={5} className="py-2"><Skeleton className="h-5 w-full" /></td></tr>)
                  ) : varianceRows.length > 0 ? varianceRows.map(p => (
                    <tr key={p.id} className="hover:bg-accent/30">
                      <td className="py-2 pr-4 text-sm font-medium text-foreground truncate max-w-[160px]">
                        <Link href={`/projects/${p.id}`}><span className="hover:text-primary cursor-pointer">{p.name}</span></Link>
                      </td>
                      <td className="py-2 pr-4 hidden sm:table-cell"><RAGBadge status={p.ragStatus} size="xs" /></td>
                      <td className="py-2 pr-4">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden min-w-[50px]">
                            <div className={`h-full rounded-full ${p.progress >= 70 ? "bg-success" : "bg-primary"}`} style={{ width: `${p.progress}%` }} />
                          </div>
                          <span className="text-xs font-bold text-muted-foreground w-8">{p.progress}%</span>
                        </div>
                      </td>
                      <td className="py-2 pr-4 hidden md:table-cell">
                        <span className={`text-xs font-bold ${p.schedVariance >= 0 ? "text-success" : "text-destructive"}`}>
                          {p.schedVariance >= 0 ? "+" : ""}{p.schedVariance}d
                        </span>
                      </td>
                      <td className="py-2 hidden lg:table-cell text-xs text-muted-foreground">{formatCurrency(p.totalBudget)}</td>
                    </tr>
                  )) : (
                    <tr><td colSpan={5} className="py-6 text-center text-muted-foreground text-sm">No active projects</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </DashboardCard>
        );
      })()}

      {/* Charter Pipeline Summary */}
      {(() => {
        const pipeline = (summary?.chartersByStatus as Array<{ status: string; count: number }> ?? []);
        const stageLabels: Record<string, string> = {
          draft: "Draft", submitted: "Submitted", parallel_review: "Parallel Review",
          scm_review: "SCM Review", chairman_review: "Chairman Review",
          finance_review: "Finance Review", pmo_review: "PMO Review",
          approved: "Approved", active: "Active",
        };
        const maxCount = Math.max(1, ...pipeline.map(p => p.count));
        return (
          <DashboardCard
            title="Charter Pipeline"
            subtitle="Charter volume at each approval stage"
            onExportCSV={() => exportCSV("pipeline.csv", pipeline.map(p => ({ Stage: stageLabels[p.status] ?? p.status, Count: p.count })))}
          >
            <div className="space-y-2">
              {pipeline.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No charter data</p>}
              {pipeline.map(p => (
                <div key={p.status} className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground w-32 flex-shrink-0 truncate">{stageLabels[p.status] ?? p.status}</span>
                  <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all bg-primary"
                      style={{ width: `${(p.count / maxCount) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs font-bold text-foreground w-6 text-right">{p.count}</span>
                </div>
              ))}
            </div>
          </DashboardCard>
        );
      })()}

      {/* Benefits Planned vs Actual + Change Requests */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {/* Benefits Summary */}
        <DashboardCard
          title="Benefits — Planned vs Actual"
          subtitle="Business value tracked across active projects"
          lastRefreshed={lastRefreshed}
          onExportCSV={() => exportCSV("benefits.csv", activeProjects.map(p => ({
            Project: p.name,
            "Topline Improvement": (p as unknown as Record<string,unknown>).toplineImprovement ?? "",
            "Bottom Line": (p as unknown as Record<string,unknown>).bottomLineOptimization ?? "",
            "Compliance": (p as unknown as Record<string,unknown>).complianceBenefits ?? "",
            "Productivity": (p as unknown as Record<string,unknown>).productivityImprovement ?? "",
            "Budget Planned": (p.capexBudget ?? 0) + (p.opexBudget ?? 0),
            Progress: `${p.progress ?? 0}%`,
          })))}
          onExportXLSX={() => exportXLSX("benefits.xlsx", activeProjects.map(p => ({
            Project: p.name,
            "Topline Improvement": (p as unknown as Record<string,unknown>).toplineImprovement ?? "",
            "Bottom Line Optimization": (p as unknown as Record<string,unknown>).bottomLineOptimization ?? "",
            "Compliance Benefits": (p as unknown as Record<string,unknown>).complianceBenefits ?? "",
            "Productivity Improvement": (p as unknown as Record<string,unknown>).productivityImprovement ?? "",
            "Budget Planned": (p.capexBudget ?? 0) + (p.opexBudget ?? 0),
            "Progress %": p.progress ?? 0,
          })))}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground uppercase tracking-wider border-b border-border/60">
                  <th className="pb-2 text-left font-semibold">Project</th>
                  <th className="pb-2 text-left font-semibold hidden md:table-cell">Category</th>
                  <th className="pb-2 text-left font-semibold">Budget</th>
                  <th className="pb-2 text-left font-semibold">Progress</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {isLoading ? [1,2,3].map(i => (
                  <tr key={i}><td colSpan={4} className="py-2"><Skeleton className="h-5 w-full" /></td></tr>
                )) : activeProjects.length > 0 ? activeProjects.slice(0, 6).map(p => {
                  const pp = p as unknown as Record<string, unknown>;
                  const categories = [
                    pp.toplineImprovement ? "Revenue" : null,
                    pp.bottomLineOptimization ? "Cost" : null,
                    pp.complianceBenefits ? "Compliance" : null,
                    pp.productivityImprovement ? "Productivity" : null,
                  ].filter(Boolean);
                  return (
                    <tr key={p.id} className="hover:bg-accent/30">
                      <td className="py-2 pr-3">
                        <Link href={`/projects/${p.id}`}>
                          <span className="text-xs font-medium text-foreground hover:text-primary cursor-pointer truncate block max-w-[140px]">{p.name}</span>
                        </Link>
                      </td>
                      <td className="py-2 pr-3 hidden md:table-cell">
                        <div className="flex flex-wrap gap-1">
                          {categories.length > 0 ? categories.slice(0,2).map(cat => (
                            <span key={cat} className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">{cat}</span>
                          )) : <span className="text-[10px] text-muted-foreground/60">—</span>}
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">
                        {formatCurrency((p.capexBudget ?? 0) + (p.opexBudget ?? 0))}
                      </td>
                      <td className="py-2">
                        <div className="flex items-center gap-1.5">
                          <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div className="h-full rounded-full bg-primary" style={{ width: `${p.progress ?? 0}%` }} />
                          </div>
                          <span className="text-[10px] text-muted-foreground">{p.progress ?? 0}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                }) : (
                  <tr><td colSpan={4} className="py-6 text-center text-muted-foreground">No active projects</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </DashboardCard>

        {/* Change Requests Summary */}
        <DashboardCard
          title="Change Requests Summary"
          subtitle="Open · Pending · Approved this month"
          lastRefreshed={lastRefreshed}
          onExportCSV={() => exportCSV("change-requests.csv", allIssues.filter(i => i.type === "change_request").map(i => ({
            Title: i.title ?? "—", Status: i.status ?? "open", "Project ID": i.projectId,
            Created: i.createdAt ? format(new Date(i.createdAt), "yyyy-MM-dd") : "—",
            Resolved: i.resolvedAt ? format(new Date(i.resolvedAt), "yyyy-MM-dd") : "—",
          })))}
          onExportXLSX={() => exportXLSX("change-requests.xlsx", allIssues.filter(i => i.type === "change_request").map(i => ({
            Title: i.title ?? "—", Status: i.status ?? "open", "Project ID": i.projectId,
            Created: i.createdAt ? format(new Date(i.createdAt), "yyyy-MM-dd") : "—",
          })))}
          onExportPDF={() => exportPDF("Executive Dashboard - Change Requests")}
        >
          {(() => {
            const now = new Date();
            const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
            const crs = allIssues.filter(i => i.type === "change_request");
            const allIssuesNonCR = allIssues.filter(i => i.type !== "change_request");
            const openCRs = crs.filter(i => i.status === "open" || !i.status);
            const pendingCRs = crs.filter(i => i.status === "in_progress" || i.status === "pending");
            const approvedThisMonth = crs.filter(i => i.status === "resolved" && i.resolvedAt && new Date(i.resolvedAt) >= thisMonthStart);
            const openIssues = allIssuesNonCR.filter(i => i.status !== "resolved");
            const total = Math.max(1, crs.length);
            const rows: Array<{ label: string; value: number; bar: string; text: string; pct: number }> = [
              { label: "Open CRs", value: openCRs.length, bar: "bg-destructive", text: "text-destructive", pct: openCRs.length / total },
              { label: "In Progress", value: pendingCRs.length, bar: "bg-warn", text: "text-warn", pct: pendingCRs.length / total },
              { label: "Approved This Month", value: approvedThisMonth.length, bar: "bg-success", text: "text-success", pct: approvedThisMonth.length / total },
              { label: "Total CRs (Portfolio)", value: crs.length, bar: "bg-primary", text: "text-primary", pct: 1 },
              { label: "Open Issues (Non-CR)", value: openIssues.length, bar: "bg-chart-3", text: "text-foreground", pct: openIssues.length / Math.max(1, allIssuesNonCR.length) },
            ];
            return (
              <div className="space-y-2.5">
                {rows.map(r => (
                  <div key={r.label} className="flex items-center justify-between p-2.5 rounded-xl bg-muted/40">
                    <span className="text-xs text-muted-foreground">{r.label}</span>
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${r.bar}`} style={{ width: `${Math.min(100, r.pct * 100)}%` }} />
                      </div>
                      <span className={`text-xs font-bold w-5 text-right ${r.text}`}>{r.value}</span>
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </DashboardCard>
      </div>

      {/* Portfolio Health Trend + Upcoming Deadlines */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2">
          <DashboardCard
            title="Portfolio Health Trend"
            subtitle="12-week RAG distribution over time"
            onExportCSV={() => exportCSV("portfolio-health.csv", healthData?.trend ?? [])}
            onExportPDF={() => exportPDF("Executive Dashboard - Portfolio Health")}
            drill={{
              subtitle: "RAG counts per week",
              columns: [
                { key: "week", label: "Week" },
                { key: "green", label: "Green", align: "right" },
                { key: "amber", label: "Amber", align: "right" },
                { key: "red", label: "Red", align: "right" },
                { key: "total", label: "Total", align: "right" },
              ],
              rows: (healthData?.trend ?? []) as unknown as Array<Record<string, unknown>>,
              emptyText: "No trend data yet.",
            }}
          >
            {healthData ? (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={healthData.trend} margin={{ top: 5, right: 10, bottom: 0, left: -10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="week" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} />
                  <Tooltip {...chartTooltipProps} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="green" stroke="hsl(var(--success))" strokeWidth={2} dot={false} name="Green" />
                  <Line type="monotone" dataKey="amber" stroke="hsl(var(--warn))" strokeWidth={2} dot={false} name="Amber" />
                  <Line type="monotone" dataKey="red" stroke="hsl(var(--destructive))" strokeWidth={2} dot={false} name="Red" />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <Skeleton className="h-[200px] w-full rounded-xl" />
            )}
          </DashboardCard>
        </div>

        {/* Upcoming Deadlines */}
        <div>
          <DashboardCard title="Upcoming Deadlines" subtitle="Projects due in 30 and 60 days">
            {upcomingIn30.length + upcomingIn60.length === 0 && !isLoading ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No upcoming deadlines</p>
            ) : (
              <div className="space-y-3">
                {upcomingIn30.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-destructive uppercase tracking-wider mb-2">Due in 30 Days</p>
                    <div className="space-y-1.5">
                      {upcomingIn30.map(p => (
                        <Link key={p.id} href={`/projects/${p.id}`}>
                          <div className="flex items-center justify-between p-2 rounded-lg hover:bg-destructive/10 cursor-pointer transition-colors">
                            <span className="text-sm text-foreground truncate flex-1">{p.name}</span>
                            <span className="text-xs text-destructive font-semibold ml-2 flex-shrink-0">
                              {p.endDate ? format(new Date(p.endDate), "MMM d") : ""}
                            </span>
                          </div>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
                {upcomingIn60.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-warn uppercase tracking-wider mb-2">Due in 60 Days</p>
                    <div className="space-y-1.5">
                      {upcomingIn60.map(p => (
                        <Link key={p.id} href={`/projects/${p.id}`}>
                          <div className="flex items-center justify-between p-2 rounded-lg hover:bg-warn/10 cursor-pointer transition-colors">
                            <span className="text-sm text-foreground truncate flex-1">{p.name}</span>
                            <span className="text-xs text-warn font-semibold ml-2 flex-shrink-0">
                              {p.endDate ? format(new Date(p.endDate), "MMM d") : ""}
                            </span>
                          </div>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </DashboardCard>
        </div>
      </div>
    </div>
  );
}
