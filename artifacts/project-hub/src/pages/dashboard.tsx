import { useGetDashboardSummary, useGetRecentActivity } from "@workspace/api-client-react";
import { formatCurrency } from "../lib/format";
import {
  FileText, CheckSquare, BarChart3, DollarSign, ArrowUpRight, Clock,
  CheckCircle2, AlertTriangle, XCircle, Trophy, Zap, TrendingUp,
} from "lucide-react";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";

const STATUS_COLORS: Record<string, string> = {
  draft: "#94A3B8", submitted: "#3B82F6", parallel_review: "#8B5CF6",
  scm_review: "#F59E0B", chairman_review: "#F97316", finance_review: "#10B981",
  pmo_review: "#06B6D4", approved: "#22C55E", rejected: "#EF4444", active: "#6366F1",
};
const FALLBACK_COLORS = ["#6366F1", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#64748B", "#3B82F6"];

const RANK_EMOJIS = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"];
const RANK_LABELS = ["Champion", "Runner Up", "Third Place", "Rising Star", "Promising"];

function useGamification() {
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
  });
}

function MetricCard({
  label, value, sub, icon: Icon, gradient, href,
}: {
  label: string; value: string | number; sub?: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  gradient: string; href?: string;
}) {
  const inner = (
    <div
      className="rounded-2xl p-5 flex items-start justify-between group cursor-pointer transition-all hover:shadow-md hover:-translate-y-0.5"
      style={{ background: "white", border: "1px solid #E2E8F0" }}
    >
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-1">{label}</p>
        <div className="text-2xl font-bold text-gray-900">{value}</div>
        {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
      </div>
      <div
        className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform"
        style={{ background: gradient }}
      >
        <Icon size={20} className="text-white" />
      </div>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function ProjectHealthSection({ health }: { health: NonNullable<ReturnType<typeof useGetDashboardSummary>["data"]>["projectHealth"] }) {
  if (!health) return null;

  const tiles = [
    {
      label: "Total Active", value: health.active ?? 0,
      icon: BarChart3, color: "#6366F1", bg: "#EEF2FF", textColor: "#4338CA",
    },
    {
      label: "On Track", value: health.onTrack ?? 0,
      icon: CheckCircle2, color: "#10B981", bg: "#ECFDF5", textColor: "#065F46",
    },
    {
      label: "Off Track", value: health.offTrack ?? 0,
      icon: AlertTriangle, color: "#F59E0B", bg: "#FFFBEB", textColor: "#92400E",
    },
    {
      label: "Delayed", value: health.delayed ?? 0,
      icon: XCircle, color: "#EF4444", bg: "#FEF2F2", textColor: "#991B1B",
    },
  ];

  const problems = [
    ...(health.offTrackProjects ?? []).map(p => ({ ...p, kind: "off-track" as const })),
    ...(health.delayedProjects ?? []).map(p => ({ ...p, kind: "delayed" as const })),
  ];

  return (
    <div
      className="rounded-2xl p-5 h-full"
      style={{ background: "white", border: "1px solid #E2E8F0" }}
    >
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold text-gray-900">Project Health</h3>
          <p className="text-xs text-gray-400 mt-0.5">Live status across all running projects</p>
        </div>
        <Link href="/projects">
          <button className="text-xs text-indigo-600 font-medium flex items-center gap-1 hover:text-indigo-700">
            View all <ArrowUpRight size={12} />
          </button>
        </Link>
      </div>

      <div className="grid grid-cols-4 gap-3 mb-4">
        {tiles.map(t => {
          const Icon = t.icon;
          return (
            <div
              key={t.label}
              className="rounded-xl p-3 text-center"
              style={{ background: t.bg }}
            >
              <div className="flex justify-center mb-1">
                <Icon size={18} style={{ color: t.color }} />
              </div>
              <div className="text-2xl font-bold" style={{ color: t.textColor }}>{t.value}</div>
              <div className="text-xs font-medium" style={{ color: t.textColor, opacity: 0.7 }}>{t.label}</div>
            </div>
          );
        })}
      </div>

      {problems.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Issues Requiring Attention</p>
          {problems.map((p, i) => (
            <Link key={i} href={`/projects/${p.id}`}>
              <div
                className="flex items-start gap-3 p-3 rounded-xl hover:opacity-80 transition-opacity cursor-pointer"
                style={{ background: p.kind === "delayed" ? "#FEF2F2" : "#FFFBEB" }}
              >
                {p.kind === "delayed"
                  ? <XCircle size={15} className="text-red-500 mt-0.5 flex-shrink-0" />
                  : <AlertTriangle size={15} className="text-amber-500 mt-0.5 flex-shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800 truncate">{p.name}</p>
                  <p className="text-xs text-gray-500 truncate">{p.reason}</p>
                </div>
                {p.kind === "delayed" && "daysOverdue" in p && (
                  <span className="text-xs font-bold text-red-600 flex-shrink-0">+{p.daysOverdue}d</span>
                )}
                {p.kind === "off-track" && "behindBy" in p && (
                  <span className="text-xs font-bold text-amber-600 flex-shrink-0">{p.behindBy}% behind</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      ) : health.active > 0 ? (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-50">
          <CheckCircle2 size={16} className="text-emerald-500" />
          <p className="text-sm font-medium text-emerald-700">All projects are on track</p>
        </div>
      ) : null}
    </div>
  );
}

function GamificationPanel() {
  const { data, isLoading } = useGamification();

  return (
    <div
      className="rounded-2xl p-5"
      style={{ background: "white", border: "1px solid #E2E8F0" }}
    >
      <div className="flex items-center gap-2 mb-4">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: "linear-gradient(135deg, #F59E0B, #F97316)" }}
        >
          <Trophy size={16} className="text-white" />
        </div>
        <div>
          <h3 className="font-semibold text-gray-900">Speed Champions</h3>
          <p className="text-xs text-gray-400">Fastest approvers this month</p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 rounded-xl" />)}
        </div>
      ) : !data?.leaderboard?.length ? (
        <div className="text-center py-6 text-gray-400 text-sm">No approval activity yet</div>
      ) : (
        <div className="space-y-2">
          {data.leaderboard.slice(0, 5).map((user, idx) => (
            <div
              key={user.userId}
              className="flex items-center gap-3 p-3 rounded-xl"
              style={{
                background: idx === 0 ? "linear-gradient(135deg, #FFFBEB, #FEF3C7)" : "#F8FAFC",
                border: idx === 0 ? "1px solid #FCD34D" : "1px solid #E2E8F0",
              }}
            >
              <div className="text-xl flex-shrink-0">{RANK_EMOJIS[idx] ?? `${idx + 1}.`}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-semibold text-gray-800 truncate">{user.name}</p>
                  {idx === 0 && (
                    <span className="text-xs px-1.5 py-0.5 rounded font-medium" style={{ background: "#FEF3C7", color: "#92400E" }}>
                      {RANK_LABELS[0]}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-400">
                  <span className="capitalize">{user.role.replace(/_/g, " ")}</span>
                  <span className="flex items-center gap-0.5">
                    <Zap size={9} />
                    {user.avgResponseHours}h avg
                  </span>
                  <span>{user.decisionsCount} decisions</span>
                </div>
              </div>
              <div className="flex-shrink-0 text-right">
                <div className="text-base font-bold text-indigo-600">{user.totalScore}</div>
                <div className="text-xs text-gray-400">pts</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { data: summary, isLoading: loadingSummary } = useGetDashboardSummary();
  const { data: activities, isLoading: loadingActivity } = useGetRecentActivity({ query: { enabled: true } });

  if (loadingSummary) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-28 rounded-2xl" />)}
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
          <Skeleton className="xl:col-span-2 h-64 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      </div>
    );
  }

  const charterStatusData = summary?.chartersByStatus?.map((item, i) => ({
    ...item,
    fill: STATUS_COLORS[item.status] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length],
  })) ?? [];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Overview</h2>
          <p className="text-sm text-gray-500 mt-0.5">Enterprise project portfolio at a glance</p>
        </div>
        <Link href="/charters/new">
          <button
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90 active:scale-95"
            style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)" }}
          >
            <FileText size={14} />
            New Charter
          </button>
        </Link>
      </div>

      {/* Top Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard
          label="Total Charters" value={summary?.totalCharters ?? 0}
          icon={FileText} gradient="linear-gradient(135deg,#6366F1,#8B5CF6)"
          href="/charters" sub="All time"
        />
        <MetricCard
          label="Pending Approvals" value={summary?.pendingApprovals ?? 0}
          icon={CheckSquare} gradient="linear-gradient(135deg,#F59E0B,#F97316)"
          href="/approvals" sub="Awaiting action"
        />
        <MetricCard
          label="Active Projects" value={summary?.activeProjects ?? 0}
          icon={TrendingUp} gradient="linear-gradient(135deg,#10B981,#059669)"
          href="/projects" sub="In execution"
        />
        <MetricCard
          label="Approved Budget" value={formatCurrency(summary?.totalBudgetApproved ?? 0)}
          icon={DollarSign} gradient="linear-gradient(135deg,#3B82F6,#1D4ED8)"
          sub="Total approved"
        />
      </div>

      {/* Main 2-column layout */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
        {/* Project Health — spans 3 cols */}
        <div className="xl:col-span-3 flex flex-col">
          <ProjectHealthSection health={summary?.projectHealth as Parameters<typeof ProjectHealthSection>[0]["health"]} />
        </div>

        {/* Charter Status Pie — spans 2 cols */}
        <div className="xl:col-span-2">
          <div
            className="rounded-2xl p-5 h-full"
            style={{ background: "white", border: "1px solid #E2E8F0" }}
          >
            <div className="mb-3">
              <h3 className="font-semibold text-gray-900">Charter Status</h3>
              <p className="text-xs text-gray-400 mt-0.5">Distribution across workflow</p>
            </div>
            {charterStatusData.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie
                      data={charterStatusData}
                      cx="50%" cy="50%"
                      innerRadius={50} outerRadius={75}
                      paddingAngle={3} dataKey="count" nameKey="status"
                    >
                      {charterStatusData.map((entry, i) => (
                        <Cell key={i} fill={entry.fill} strokeWidth={0} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ background: "#1E293B", border: "none", borderRadius: "8px", color: "white", fontSize: "12px" }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap gap-x-3 gap-y-1.5 mt-2">
                  {charterStatusData.map(item => (
                    <div key={item.status} className="flex items-center gap-1.5 text-xs text-gray-500">
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: item.fill }} />
                      <span className="capitalize">{item.status.replace(/_/g, " ")}</span>
                      <span className="font-semibold text-gray-700">({item.count})</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center text-gray-400 text-sm py-8">No data</div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom row: Gamification + Activity */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
        <div className="xl:col-span-2">
          <GamificationPanel />
        </div>

        {/* Recent Activity */}
        <div
          className="xl:col-span-3 rounded-2xl p-5"
          style={{ background: "white", border: "1px solid #E2E8F0" }}
        >
          <div className="mb-4">
            <h3 className="font-semibold text-gray-900">Recent Activity</h3>
            <p className="text-xs text-gray-400 mt-0.5">Latest actions across the system</p>
          </div>

          {loadingActivity ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-10 rounded-xl" />)}
            </div>
          ) : activities && activities.length > 0 ? (
            <div className="space-y-0 divide-y divide-gray-50">
              {activities.slice(0, 7).map((activity) => (
                <div key={activity.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                    style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)" }}
                  >
                    <BarChart3 size={11} className="text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-700 font-medium leading-snug">{activity.message}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Clock size={10} className="text-gray-400" />
                      <span className="text-xs text-gray-400">
                        {format(new Date(activity.createdAt), "MMM d, h:mm a")}
                      </span>
                      {activity.userName && (
                        <>
                          <span className="text-gray-300">·</span>
                          <span className="text-xs text-gray-400">{activity.userName}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-10 text-gray-400 text-sm">No recent activity</div>
          )}
        </div>
      </div>
    </div>
  );
}
