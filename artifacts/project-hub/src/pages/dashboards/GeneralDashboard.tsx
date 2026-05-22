import { useGetDashboardSummary, useGetRecentActivity, type DashboardSummary } from "@workspace/api-client-react";
import { formatCurrency } from "../../lib/format";
import {
  FileText, CheckSquare, DollarSign, ArrowUpRight, Clock,
  CheckCircle2, AlertTriangle, XCircle, Trophy, Zap, TrendingUp,
  FolderKanban, Activity,
} from "lucide-react";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, AreaChart, Area, XAxis, YAxis, CartesianGrid } from "recharts";
import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { KPITile, DashboardCard, useAutoRefresh } from "../../components/dashboard/primitives";

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
  type ProblemItem = { id: number; name: string; kind: "off-track" | "delayed"; reason?: string; daysOverdue?: number; behindBy?: number };
  const problems: ProblemItem[] = [
    ...(health.offTrackProjects ?? []).map(p => ({ ...(p as unknown as ProblemItem), kind: "off-track" as const })),
    ...(health.delayedProjects  ?? []).map(p => ({ ...(p as unknown as ProblemItem), kind: "delayed"   as const })),
  ];
  return (
    <DashboardCard
      title="Project Health"
      subtitle="Live status across all running projects"
      className="h-full"
      actions={
        <Link href="/projects">
          <button className="text-[11px] text-primary font-medium flex items-center gap-1 hover:opacity-80">
            View all <ArrowUpRight size={11} />
          </button>
        </Link>
      }
    >
      <div className="grid grid-cols-4 gap-3 mb-4">
        {tiles.map(t => {
          const Icon = t.icon;
          return (
            <div key={t.label} className={`rounded-lg p-3 text-center border border-border ${t.bg} ring-1 ${t.ring}`}>
              <div className="flex justify-center mb-1.5"><Icon size={16} className={t.iconCls} /></div>
              <div className={`text-2xl font-mono font-semibold num-tabular ${t.accentText}`}>{t.value}</div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mt-0.5">{t.label}</div>
            </div>
          );
        })}
      </div>
      {problems.length > 0 ? (
        <div className="space-y-2">
          <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground mb-2">Issues Requiring Attention</p>
          {problems.map((p, i) => (
            <Link key={i} href={`/projects/${p.id}`}>
              <div className={`flex items-start gap-3 p-3 rounded-md cursor-pointer transition-colors border-l-2 ${
                p.kind === "delayed"
                  ? "bg-destructive/5 hover:bg-destructive/10 border-destructive/40"
                  : "bg-warn/5 hover:bg-warn/10 border-warn/40"
              }`}>
                {p.kind === "delayed"
                  ? <XCircle size={14} className="text-destructive mt-0.5 flex-shrink-0" />
                  : <AlertTriangle size={14} className="text-warn mt-0.5 flex-shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-card-foreground truncate">{p.name}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{p.reason}</p>
                </div>
                {p.kind === "delayed" && p.daysOverdue != null && <span className="text-[11px] font-mono font-bold text-destructive flex-shrink-0">+{p.daysOverdue}d</span>}
                {p.kind === "off-track" && p.behindBy != null && <span className="text-[11px] font-mono font-bold text-warn flex-shrink-0">{p.behindBy}% behind</span>}
              </div>
            </Link>
          ))}
        </div>
      ) : health.active > 0 ? (
        <div className="flex items-center gap-2 p-3 rounded-md bg-success/5 border border-success/20">
          <CheckCircle2 size={15} className="text-success" />
          <p className="text-sm font-medium text-success">All projects are on track</p>
        </div>
      ) : null}
    </DashboardCard>
  );
}

function GamificationPanel({ refetchInterval }: { refetchInterval: number | false }) {
  const { data, isLoading } = useGamification(refetchInterval);
  return (
    <DashboardCard
      title="Speed Champions"
      subtitle="Fastest approvers this month"
      className="h-full"
      actions={<Trophy size={14} className="text-warn" />}
    >
      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-14 rounded-md" />)}</div>
      ) : !data?.leaderboard?.length ? (
        <div className="text-center py-8 text-muted-foreground text-sm">No approval activity yet</div>
      ) : (
        <div className="space-y-1.5">
          {data.leaderboard.slice(0, 5).map((user, idx) => (
            <div
              key={user.userId}
              className={`flex items-center gap-3 p-3 rounded-md border ${
                idx === 0
                  ? "bg-warn/5 border-warn/30"
                  : "bg-muted/40 border-border hover:border-foreground/20"
              } transition-colors`}
            >
              <div className={`w-8 h-8 rounded-md flex items-center justify-center text-[10px] font-mono font-bold flex-shrink-0 ${
                idx === 0 ? "bg-warn text-warn-foreground" : "bg-muted text-muted-foreground"
              }`}>
                {RANK_BADGES[idx] ?? `${idx + 1}`}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-semibold text-card-foreground truncate">{user.name}</p>
                  {idx === 0 && <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-warn/15 text-warn">Champion</span>}
                </div>
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground font-mono">
                  <span className="capitalize">{user.role.replace(/_/g, " ")}</span>
                  <span className="flex items-center gap-0.5"><Zap size={9} />{user.avgResponseHours}h avg</span>
                  <span>{user.decisionsCount} decisions</span>
                </div>
              </div>
              <div className="flex-shrink-0 text-right">
                <div className="text-base font-mono font-semibold num-tabular text-primary">{user.totalScore}</div>
                <div className="text-[10px] text-muted-foreground font-mono">pts</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </DashboardCard>
  );
}

export default function GeneralDashboard() {
  const { refetchInterval, markRefreshed, RefreshButton } = useAutoRefresh();
  const { data: summary, isLoading: loadingSummary } = useGetDashboardSummary({ query: { refetchInterval } as never });
  const { data: activities, isLoading: loadingActivity } = useGetRecentActivity({ query: { refetchInterval } as never });
  useEffect(() => { if (summary) markRefreshed(); }, [summary]);

  // Portfolio velocity — illustrative 8-week ramp anchored to current counts.
  // TODO: replace with /api/dashboard/velocity time-series once backend endpoint exists.
  const velocitySeries = useMemo(() => {
    const charters = summary?.totalCharters ?? 0;
    const approvals = summary?.pendingApprovals ?? 0;
    const active = summary?.activeProjects ?? 0;
    const ceiling = Math.max(charters, active, approvals, 4);
    return ["W-7", "W-6", "W-5", "W-4", "W-3", "W-2", "W-1", "Now"].map((name, i) => {
      const t = (i + 1) / 8;
      const baseline = ceiling * (0.45 + t * 0.50);
      const actual = baseline * (1.03 + 0.02 * Math.sin(i * 1.1));
      return { name, actual: Math.round(actual * 10) / 10, baseline: Math.round(baseline * 10) / 10 };
    });
  }, [summary?.totalCharters, summary?.pendingApprovals, summary?.activeProjects]);

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

  return (
    <div className="space-y-6">
      {/* Hero header — Atelier glass + ambient mesh, Command Center mono caption */}
      <div className="relative rounded-2xl overflow-hidden ph-rise glass-surface">
        <div className="absolute inset-0 ambient-mesh opacity-70 pointer-events-none" />
        <div className="relative flex items-start justify-between flex-wrap gap-4 p-6 lg:p-8">
          <div className="min-w-0">
            <p className="text-[10px] font-mono tracking-[0.22em] uppercase text-muted-foreground mb-2">
              Enterprise PMO · Overview
            </p>
            <h2 className="text-3xl lg:text-4xl font-bold tracking-tight text-card-foreground">
              Good {greeting()}.
            </h2>
            <p className="text-sm text-muted-foreground mt-2 max-w-xl">
              <span className="font-mono num-tabular text-card-foreground font-semibold">{summary?.activeProjects ?? 0}</span> active project{summary?.activeProjects === 1 ? "" : "s"} ·
              {" "}<span className="font-mono num-tabular text-card-foreground font-semibold">{summary?.pendingApprovals ?? 0}</span> awaiting approval ·
              {" "}<span className="font-mono num-tabular text-card-foreground font-semibold">{summary?.totalCharters ?? 0}</span> charter{summary?.totalCharters === 1 ? "" : "s"} in pipeline
            </p>
          </div>
          <div className="flex items-center gap-3">
            <RefreshButton />
            <Link href="/charters/new">
              <button className="flex items-center gap-2 px-4 h-9 rounded-md text-[13px] font-semibold bg-cta text-cta-foreground hover:opacity-90 active:scale-[0.98] transition-all glow-cta">
                <FileText size={14} /> New Charter
              </button>
            </Link>
          </div>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="ph-rise">
          <Link href="/charters"><div><KPITile label="Total Charters"   value={summary?.totalCharters ?? 0}                      tone="default" icon={FileText}    sub="All time" /></div></Link>
        </div>
        <div className="ph-rise ph-rise-2">
          <Link href="/approvals"><div><KPITile label="Pending Approvals" value={summary?.pendingApprovals ?? 0}                  tone="warn"    icon={CheckSquare} sub="Awaiting action" /></div></Link>
        </div>
        <div className="ph-rise ph-rise-3">
          <Link href="/projects"><div><KPITile label="Active Projects" value={summary?.activeProjects ?? 0}                       tone="primary" icon={TrendingUp}  sub="In execution" /></div></Link>
        </div>
        <div className="ph-rise ph-rise-4">
          <KPITile label="Approved Budget"  value={formatCurrency(summary?.totalBudgetApproved ?? 0)} tone="success" icon={DollarSign}  sub="Total approved" />
        </div>
      </div>

      {/* Portfolio Velocity — area chart (Command Center cyan area + Atelier amber dashed baseline) */}
      <DashboardCard
        title="Portfolio Velocity"
        subtitle="Illustrative ramp · anchored to current pipeline · awaiting time-series feed"
        actions={
          <div className="hidden md:flex items-center gap-4 text-[10px] font-mono uppercase tracking-wider">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-primary" />
              <span className="text-muted-foreground">Projected</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-px border-t border-dashed border-amber-accent" style={{ borderTopWidth: 2 }} />
              <span className="text-muted-foreground">Baseline</span>
            </div>
            <span className="px-1.5 py-0.5 rounded-sm border border-border bg-muted text-muted-foreground">Preview</span>
          </div>
        }
      >
        <div className="h-[240px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={velocitySeries} margin={{ top: 10, right: 12, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id="velocityFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.45} />
                  <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 6" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} style={{ fontFamily: "var(--app-font-mono)" }} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} style={{ fontFamily: "var(--app-font-mono)" }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--popover))",
                  borderColor: "hsl(var(--popover-border))",
                  borderRadius: 8,
                  fontSize: 12,
                  color: "hsl(var(--popover-foreground))",
                }}
                itemStyle={{ color: "hsl(var(--popover-foreground))" }}
                labelStyle={{ color: "hsl(var(--muted-foreground))", fontFamily: "var(--app-font-mono)" }}
              />
              <Area type="monotone" dataKey="actual" stroke="hsl(var(--primary))" strokeWidth={2.2} fill="url(#velocityFill)" />
              <Area type="monotone" dataKey="baseline" stroke="hsl(var(--amber-accent))" strokeWidth={1.5} strokeDasharray="5 5" fill="none" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </DashboardCard>

      {/* Health + Charter status */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
        <div className="xl:col-span-3 flex flex-col">
          <ProjectHealthSection health={summary?.projectHealth as Parameters<typeof ProjectHealthSection>[0]["health"]} />
        </div>
        <div className="xl:col-span-2 flex flex-col">
          <DashboardCard title="Charter Status" subtitle="Distribution across workflow" className="h-full">
            {charterStatusData.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={charterStatusData} cx="50%" cy="50%" innerRadius={56} outerRadius={84} paddingAngle={2} dataKey="count" nameKey="status">
                      {charterStatusData.map((entry, i) => <Cell key={i} fill={entry.fill} strokeWidth={0} />)}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--popover))",
                        borderColor: "hsl(var(--popover-border))",
                        borderRadius: 8,
                        fontSize: 12,
                        color: "hsl(var(--popover-foreground))",
                      }}
                      itemStyle={{ color: "hsl(var(--popover-foreground))" }}
                      labelStyle={{ color: "hsl(var(--muted-foreground))" }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="grid grid-cols-2 gap-1.5 mt-3">
                  {charterStatusData.map(item => (
                    <div key={item.status} className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: item.fill }} />
                      <span className="capitalize truncate">{item.status.replace(/_/g, " ")}</span>
                      <span className="ml-auto font-mono font-semibold text-card-foreground num-tabular">{item.count}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center text-muted-foreground text-sm py-12">No data</div>
            )}
          </DashboardCard>
        </div>
      </div>

      {/* Gamification + Activity */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
        <div className="xl:col-span-2 flex flex-col">
          <GamificationPanel refetchInterval={refetchInterval} />
        </div>
        <div className="xl:col-span-3 flex flex-col">
          <DashboardCard
            title="Recent Activity"
            subtitle="Latest actions across the system"
            className="h-full"
            actions={<Activity size={13} className="text-muted-foreground" />}
          >
            {loadingActivity ? (
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
                      <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground font-mono">
                        <Clock size={9} />
                        <span>{format(new Date(activity.createdAt), "MMM d, h:mm a")}</span>
                        {activity.userName && <><span className="opacity-50">·</span><span>{activity.userName}</span></>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-10 text-muted-foreground text-sm">No recent activity</div>
            )}
          </DashboardCard>
        </div>
      </div>
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
}
