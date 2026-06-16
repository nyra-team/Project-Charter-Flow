import { useGetDashboardSummary, useGetRecentActivity, useListProjects, type DashboardSummary } from "@workspace/api-client-react";
import { formatCurrency } from "../../lib/format";
import {
  FileText, CheckSquare, DollarSign, IndianRupee, ArrowUpRight, Clock,
  CheckCircle2, AlertTriangle, XCircle, Trophy, Zap, TrendingUp,
  FolderKanban, Activity, Sparkles, Inbox, Info,
} from "lucide-react";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { format } from "date-fns";
import { getStageConfig } from "../../lib/lifecycle-config";
import { LifecycleOverview } from "../../components/lifecycle-overview";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { KPITile, DashboardCard, useAutoRefresh, type DrillColumn } from "../../components/dashboard/primitives";
import { HoverHint, chartTooltipProps, type HoverHintRow } from "../../components/ui-kit";
import { StageDetailDialog } from "../../components/stage-detail-dialog";
import { useAuth } from "../../auth/context";

const DEMAND_STAGES = ["initiation", "vendor_selection"] as const;

const STATUS_TOKEN: Record<string, string> = {
  draft: "hsl(var(--muted-foreground))",
  submitted: "hsl(var(--chart-1))",
  parallel_review: "hsl(var(--chart-5))",
  scm_review: "hsl(var(--chart-3))",
  chairman_review: "hsl(var(--warn))",
  finance_review: "hsl(var(--chart-2))",
  pmo_review: "hsl(var(--primary))",
  approved: "hsl(var(--success))",
  rejected: "hsl(var(--destructive))",
  active: "hsl(var(--primary))",
};
const FALLBACK = [
  "hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))",
  "hsl(var(--chart-4))", "hsl(var(--chart-5))",
];
const RANK_BADGES = ["1st", "2nd", "3rd", "4th", "5th"];

function useGamification(refetchInterval: number | false) {
  return useQuery({
    queryKey: ["/api/dashboard/gamification"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard/gamification");
      if (!res.ok) throw new Error("Failed to fetch gamification");
      return res.json() as Promise<{
        leaderboard: Array<{
          userId: number; name: string; role: string; totalScore: number;
          decisionsCount: number; approvedCount: number; avgResponseHours: number; rank: number;
        }>;
      }>;
    },
    refetchInterval,
  });
}

function ProjectHealthSection({ health }: { health: DashboardSummary["projectHealth"] }) {
  if (!health) return null;
  const tiles = [
    { label: "Active",    value: health.active   ?? 0, icon: FolderKanban,   ring: "ring-primary/30",      iconCls: "text-primary",     bg: "bg-primary/10",     accentText: "text-primary" },
    { label: "On Track",  value: health.onTrack  ?? 0, icon: CheckCircle2,   ring: "ring-success/30",      iconCls: "text-success",     bg: "bg-success/10",     accentText: "text-success" },
    { label: "Off Track", value: health.offTrack ?? 0, icon: AlertTriangle,  ring: "ring-warn/30",         iconCls: "text-warn",        bg: "bg-warn/10",        accentText: "text-warn" },
    { label: "Delayed",   value: health.delayed  ?? 0, icon: XCircle,        ring: "ring-destructive/30",  iconCls: "text-destructive", bg: "bg-destructive/10", accentText: "text-destructive" },
  ];
  return (
    <DashboardCard
      title="Project Health"
      subtitle="Live status across all running projects"
      actions={
        <Link href="/projects">
          <button className="text-[11px] text-primary font-medium flex items-center gap-1 hover:opacity-80">
            View all <ArrowUpRight size={11} />
          </button>
        </Link>
      }
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {tiles.map(t => {
          const Icon = t.icon;
          return (
            <div key={t.label} className={`rounded-lg p-3 text-center border border-border ${t.bg} ring-1 ${t.ring}`}>
              <div className="flex justify-center mb-1.5"><Icon size={16} className={t.iconCls} /></div>
              <div className={`text-2xl font-semibold num-tabular ${t.accentText}`}>{t.value}</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">{t.label}</div>
            </div>
          );
        })}
      </div>
      {/* "Issues Requiring Attention" was moved to the Portfolio page. */}
    </DashboardCard>
  );
}

// Charter Status — compact, donut-only card. Sized to its content (no h-full
// stretch), so it never leaves a large empty area.
function CharterStatusCard({ charterStatusData }: { charterStatusData: Array<{ status: string; count: number; fill: string }> }) {
  return (
    <DashboardCard title="Charter Status" subtitle="Distribution across workflow"
      drill={{
        subtitle: "Charter count by workflow status",
        columns: [
          { key: "status", label: "Status", render: (v) => String(v).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) },
          { key: "count", label: "Charters", align: "right" },
        ],
        rows: charterStatusData.map((d) => ({ status: d.status, count: d.count })),
        linkHref: "/charters/new",
        linkLabel: "Start Charter + e-NFA",
        emptyText: "No charter data yet.",
      }}>
      {charterStatusData.length > 0 ? (
        <>
          <ResponsiveContainer width="100%" height={170}>
            <PieChart>
              <Pie data={charterStatusData} cx="50%" cy="50%" innerRadius={50} outerRadius={76} paddingAngle={2} dataKey="count" nameKey="status">
                {charterStatusData.map((entry, i) => <Cell key={i} fill={entry.fill} strokeWidth={0} />)}
              </Pie>
              <Tooltip {...chartTooltipProps} />
            </PieChart>
          </ResponsiveContainer>
          <div className="grid grid-cols-2 gap-1.5 mt-2">
            {charterStatusData.map(item => (
              <div key={item.status} className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: item.fill }} />
                <span className="capitalize truncate">{item.status.replace(/_/g, " ")}</span>
                <span className="ml-auto font-semibold text-card-foreground num-tabular">{item.count}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="text-xs text-muted-foreground text-center py-2">No charter data yet</p>
      )}
    </DashboardCard>
  );
}

// Speed Champions — separate card, sized to content. Empty state is a single
// compact line so it adds almost no height when there's no approval activity.
function SpeedChampionsCard({ refetchInterval }: { refetchInterval: number | false }) {
  const { data, isLoading } = useGamification(refetchInterval);
  const champions = data?.leaderboard ?? [];
  return (
    <DashboardCard title="Speed Champions" subtitle="Fastest approvers this month" actions={<Trophy size={14} className="text-warn" />}>
      {isLoading ? (
        <div className="space-y-1.5">{[1, 2, 3].map(i => <Skeleton key={i} className="h-12 rounded-md" />)}</div>
      ) : champions.length === 0 ? (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5 py-0.5">
          <Trophy size={12} className="opacity-40" /> No approval activity yet
        </p>
      ) : (
        <div className="space-y-1.5">
          {champions.slice(0, 5).map((user, idx) => (
            <div
              key={user.userId}
              className={`flex items-center gap-3 p-2.5 rounded-md border ${
                idx === 0 ? "bg-warn/5 border-warn/30" : "bg-muted/40 border-border hover:border-foreground/20"
              } transition-colors`}
            >
              <div className={`w-7 h-7 rounded-md flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
                idx === 0 ? "bg-warn text-warn-foreground" : "bg-muted text-muted-foreground"
              }`}>
                {RANK_BADGES[idx] ?? `${idx + 1}`}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-semibold text-card-foreground truncate">{user.name}</p>
                  {idx === 0 && <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-warn/15 text-warn">Champion</span>}
                </div>
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                  <span className="capitalize">{user.role.replace(/_/g, " ")}</span>
                  <span className="flex items-center gap-0.5"><Zap size={9} />{user.avgResponseHours}h avg</span>
                  <span>{user.decisionsCount} decisions</span>
                </div>
              </div>
              <div className="flex-shrink-0 text-right">
                <div className="text-base font-semibold num-tabular text-primary">{user.totalScore}</div>
                <div className="text-[10px] text-muted-foreground">pts</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </DashboardCard>
  );
}

export default function GeneralDashboard() {
  const { profile } = useAuth();
  const firstName = profile?.full_name?.trim().split(/\s+/)[0] ?? profile?.email?.split("@")[0] ?? "";
  const { refetchInterval, markRefreshed, RefreshButton } = useAutoRefresh();
  const { data: summary, isLoading: loadingSummary } = useGetDashboardSummary({ query: { refetchInterval } as never });
  const { data: activities, isLoading: loadingActivity } = useGetRecentActivity({ query: { refetchInterval } as never });
  const { data: projects } = useListProjects(undefined, { query: { refetchInterval } as never });
  useEffect(() => { if (summary) markRefreshed(); }, [summary]);

  const demands = (projects ?? []).filter(
    (p) => DEMAND_STAGES.includes((p.stage ?? "initiation") as typeof DEMAND_STAGES[number]),
  );
  const demandsByStage = DEMAND_STAGES.map((key) => ({
    key, cfg: getStageConfig(key)!, count: demands.filter((d) => (d.stage ?? "initiation") === key).length,
  }));

  const [stageDetail, setStageDetail] = useState<string | null>(null);
  const projectsAtSelectedStage = useMemo(
    () => (stageDetail ? (projects ?? []).filter((p) => (p.stage ?? "initiation") === stageDetail) : []),
    [projects, stageDetail],
  );

  if (loadingSummary) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-32 rounded-2xl" />
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
          <Skeleton className="xl:col-span-3 h-72 rounded-xl" />
          <Skeleton className="xl:col-span-2 h-72 rounded-xl" />
        </div>
      </div>
    );
  }

  const charterStatusData = summary?.chartersByStatus?.map((item, i) => ({
    ...item, fill: STATUS_TOKEN[item.status] ?? FALLBACK[i % FALLBACK.length],
  })) ?? [];

  // ── Drill-down data — the actual rows behind each KPI / chart ──────────────
  const stageLbl = (s?: string | null) => getStageConfig((s ?? "initiation") as string)?.label ?? (s ?? "—");
  const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const activeProjectList = (projects ?? []).filter((p) => p.status === "active");

  const projectCols: DrillColumn[] = [
    { key: "name", label: "Project" },
    { key: "stage", label: "Stage" },
    { key: "progress", label: "Progress", align: "right", render: (v) => `${v ?? 0}%` },
    { key: "rag", label: "RAG", render: (v) => titleCase(String(v ?? "—")) },
    { key: "priority", label: "Priority" },
  ];
  const toProjectRow = (p: { name: string; stage?: string | null; progress?: number | null; ragStatus?: string | null; priority?: string | null }) => ({
    name: p.name, stage: stageLbl(p.stage), progress: p.progress ?? 0, rag: p.ragStatus ?? "—", priority: p.priority ?? "—",
  });

  const demandRows = demands.map((d) => toProjectRow(d as never));
  const activeProjectRows = activeProjectList.map((p) => toProjectRow(p as never));

  const charterStatusRows = (summary?.chartersByStatus ?? []).map((c) => ({ status: titleCase(c.status), count: c.count }));
  const REVIEW_STAGES = ["parallel_review", "scm_review", "chairman_review", "finance_review", "pmo_review", "submitted"];
  const pendingApprovalRows = (summary?.chartersByStatus ?? [])
    .filter((c) => REVIEW_STAGES.includes(c.status))
    .map((c) => ({ stage: titleCase(c.status), count: c.count }));
  const statusCountCols: DrillColumn[] = [
    { key: "status", label: "Status" },
    { key: "count", label: "Charters", align: "right" },
  ];

  const budgetProjectRows = activeProjectList.map((p) => ({
    name: p.name,
    capex: (p as { capexBudget?: number | null }).capexBudget ?? 0,
    opex: (p as { opexBudget?: number | null }).opexBudget ?? 0,
    total: ((p as { capexBudget?: number | null }).capexBudget ?? 0) + ((p as { opexBudget?: number | null }).opexBudget ?? 0),
  }));
  const budgetCols: DrillColumn[] = [
    { key: "name", label: "Project" },
    { key: "capex", label: "CapEx", align: "right", render: (v) => formatCurrency(Number(v ?? 0)) },
    { key: "opex", label: "OpEx", align: "right", render: (v) => formatCurrency(Number(v ?? 0)) },
    { key: "total", label: "Total", align: "right", render: (v) => formatCurrency(Number(v ?? 0)) },
  ];

  return (
    <div className="space-y-6">
      {/* Hero header — Atelier glass + ambient mesh, Command Center mono caption */}
      <div className="relative rounded-2xl overflow-hidden ph-rise glass-surface">
        <div className="absolute inset-0 ambient-mesh opacity-70 pointer-events-none" />
        <div className="relative flex items-start justify-between flex-wrap gap-4 p-6 lg:p-8">
          <div className="min-w-0">
            <p className="text-[10px] tracking-[0.22em] uppercase text-muted-foreground mb-2">
              Enterprise PMO · Overview
            </p>
            <h2 className="text-3xl lg:text-4xl font-bold tracking-tight text-card-foreground">
              Good {greeting()}{firstName ? `, ${firstName}` : ""}.
            </h2>
            <p className="text-sm text-muted-foreground mt-2 max-w-xl">
              <span className="num-tabular text-card-foreground font-semibold">{summary?.activeProjects ?? 0}</span> active project{summary?.activeProjects === 1 ? "" : "s"} ·
              {" "}<span className="num-tabular text-card-foreground font-semibold">{summary?.pendingApprovals ?? 0}</span> awaiting approval ·
              {" "}<span className="num-tabular text-card-foreground font-semibold">{summary?.totalCharters ?? 0}</span> charter{summary?.totalCharters === 1 ? "" : "s"} in pipeline
            </p>
          </div>
          <div className="flex items-center gap-3">
            <RefreshButton />
            <Link href="/demands/new">
              <button className="btn-glossy-cta flex items-center gap-2 px-4 h-9 rounded-md text-[13px] font-semibold" data-testid="button-new-demand">
                <Sparkles size={14} />
                <span>Business Case</span>
              </button>
            </Link>
          </div>
        </div>
      </div>

      {/* KPI Row — click any tile to see the underlying records */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        <div className="ph-rise">
          <KPITile label="Active Demands" value={demands.length} tone="default" icon={Inbox} sub="Pre-charter pipeline"
            drill={{ subtitle: "Demands in the first lifecycle stages", columns: projectCols, rows: demandRows, linkHref: "/demands", linkLabel: "View all demands", emptyText: "No active demands." }} />
        </div>
        <div className="ph-rise ph-rise-2">
          <KPITile label="Total Charters" value={summary?.totalCharters ?? 0} tone="default" icon={FileText} sub="All time"
            drill={{ subtitle: "Charters by workflow status", columns: statusCountCols, rows: charterStatusRows, linkHref: "/charters/new", linkLabel: "Start Charter + e-NFA", emptyText: "No charters yet." }} />
        </div>
        <div className="ph-rise ph-rise-3">
          <KPITile label="Pending Approvals" value={summary?.pendingApprovals ?? 0} tone="warn" icon={CheckSquare} sub="Awaiting action"
            drill={{ subtitle: "Charters currently in review stages", columns: [{ key: "stage", label: "Review Stage" }, { key: "count", label: "Charters", align: "right" }], rows: pendingApprovalRows, linkHref: "/approvals", linkLabel: "Open approvals queue", emptyText: "No charters awaiting review." }} />
        </div>
        <div className="ph-rise ph-rise-4">
          <KPITile label="Active Projects" value={summary?.activeProjects ?? 0} tone="primary" icon={TrendingUp} sub="In execution"
            drill={{ subtitle: "Projects currently in execution", columns: projectCols, rows: activeProjectRows, linkHref: "/projects", linkLabel: "View all projects", emptyText: "No active projects." }} />
        </div>
        <div className="ph-rise ph-rise-4">
          <KPITile label="Approved Budget" value={formatCurrency(summary?.totalBudgetApproved ?? 0)} tone="success" icon={IndianRupee} sub="Total approved"
            drill={{ subtitle: "Budget allocated across active projects (CapEx + OpEx)", columns: budgetCols, rows: budgetProjectRows, linkHref: "/projects", linkLabel: "View all projects", emptyText: "No project budgets recorded." }} />
        </div>
      </div>

      {/* Lifecycle — the ONE shared visualization (ProjectLifecycleCard via the
          org-wide LifecycleOverview adapter). Identical to Project Details + Pipeline. */}
      <LifecycleOverview projects={(projects ?? []) as Array<{ stage?: string | null }>} />

      {/* Demand sub-pipeline reminder + board link */}
      <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-primary/5 border border-primary/20">
        <div className="flex items-center gap-2 text-[12px]">
          <Inbox size={13} className="text-primary" />
          <span className="text-card-foreground font-semibold">{demands.length}</span>
          <span className="text-muted-foreground">active demand{demands.length === 1 ? "" : "s"} in the first 4 stages</span>
          <span className="hidden sm:inline text-muted-foreground/60">·</span>
          <span className="hidden sm:flex items-center gap-1.5">
            {demandsByStage.map((d) => (
              <span key={d.key} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: `${d.cfg.color}1A`, color: d.cfg.color }}>
                {d.cfg.shortLabel} {d.count}
              </span>
            ))}
          </span>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <Link href="/pipeline">
            <button className="text-[11px] font-semibold text-primary inline-flex items-center gap-1 hover:underline whitespace-nowrap">
              Open board <ArrowUpRight size={10} />
            </button>
          </Link>
          <Link href="/demands">
            <button className="text-[11px] font-semibold text-primary inline-flex items-center gap-1 hover:underline whitespace-nowrap">
              View demands <ArrowUpRight size={10} />
            </button>
          </Link>
        </div>
      </div>

      {/* Main (Project Health) + right sidebar (Charter Status → Speed Champions →
          Recent Activity), all content-sized. The sidebar stack fills the space
          beside the tall Health panel, so there are no large empty areas. */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-5 items-start">
        <div className="xl:col-span-3">
          <ProjectHealthSection health={summary?.projectHealth as Parameters<typeof ProjectHealthSection>[0]["health"]} />
        </div>
        <div className="xl:col-span-2 flex flex-col gap-5">
          <CharterStatusCard charterStatusData={charterStatusData} />
          <RecentActivityCard activities={activities as ActivityItem[] | undefined} loading={loadingActivity} />
          <SpeedChampionsCard refetchInterval={refetchInterval} />
        </div>
      </div>

      <StageDetailDialog
        stageKey={stageDetail}
        onClose={() => setStageDetail(null)}
        projects={projectsAtSelectedStage.map((p) => ({
          id: p.id,
          name: p.name,
          ragStatus: (p as { ragStatus?: string | null }).ragStatus ?? null,
          priority: (p as { priority?: string | null }).priority ?? null,
        }))}
      />
    </div>
  );
}

type ActivityItem = { id: number | string; message: string; createdAt: string; userName?: string | null };
function RecentActivityCard({ activities, loading }: { activities?: ActivityItem[]; loading: boolean }) {
  return (
    <DashboardCard title="Recent Activity" subtitle="Latest actions across the system" actions={<Activity size={13} className="text-muted-foreground" />}>
      {loading ? (
        <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-12 rounded-md" />)}</div>
      ) : activities && activities.length > 0 ? (
        <div className="relative space-y-0">
          <div className="absolute left-[14px] top-2 bottom-2 w-px bg-border" />
          {activities.slice(0, 7).map((activity) => (
            <div key={activity.id} className="relative flex items-start gap-3 py-2.5">
              <div className="relative z-10 w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 bg-primary/15 border border-primary/30 text-primary">
                <Activity size={11} />
              </div>
              <div className="flex-1 min-w-0 pt-0.5">
                <p className="text-sm text-card-foreground leading-snug">{activity.message}</p>
                <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
                  <Clock size={9} />
                  <span>{format(new Date(activity.createdAt), "MMM d, h:mm a")}</span>
                  {activity.userName && <><span className="opacity-50">·</span><span>{activity.userName}</span></>}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground py-0.5 flex items-center gap-1.5"><Clock size={12} className="opacity-40" /> No recent activity</p>
      )}
    </DashboardCard>
  );
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
}
