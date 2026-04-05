import { useGetDashboardSummary, useGetRecentActivity } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "../lib/format";
import { FileText, CheckSquare, BarChart3, DollarSign, ArrowUpRight, Clock } from "lucide-react";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts";
import { format } from "date-fns";

const STATUS_COLORS: Record<string, string> = {
  draft: "#94A3B8",
  submitted: "#3B82F6",
  parallel_review: "#8B5CF6",
  scm_review: "#F59E0B",
  chairman_review: "#F97316",
  finance_review: "#10B981",
  pmo_review: "#06B6D4",
  approved: "#22C55E",
  rejected: "#EF4444",
  active: "#6366F1",
};

const FALLBACK_COLORS = ["#6366F1", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#64748B", "#3B82F6"];

function StatCard({
  title,
  value,
  icon: Icon,
  gradient,
  href,
  subtitle,
}: {
  title: string;
  value: string | number;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  gradient: string;
  href?: string;
  subtitle?: string;
}) {
  const content = (
    <div
      className="rounded-xl p-5 flex items-start justify-between transition-all hover:shadow-lg cursor-pointer group"
      style={{
        background: "white",
        border: "1px solid #E2E8F0",
        boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
      }}
    >
      <div className="flex-1">
        <p className="text-sm font-medium text-gray-500 mb-1">{title}</p>
        <h3 className="text-2xl font-bold text-gray-900">{value}</h3>
        {subtitle && <p className="text-xs text-gray-400 mt-1">{subtitle}</p>}
      </div>
      <div
        className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ml-4 group-hover:scale-110 transition-transform"
        style={{ background: gradient }}
      >
        <Icon size={20} className="text-white" />
      </div>
    </div>
  );

  if (href) return <Link href={href}>{content}</Link>;
  return content;
}

export default function Dashboard() {
  const { data: summary, isLoading: loadingSummary } = useGetDashboardSummary();
  const { data: activities, isLoading: loadingActivity } = useGetRecentActivity({ query: { enabled: true } });

  if (loadingSummary) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <Skeleton className="xl:col-span-2 h-72 rounded-xl" />
          <Skeleton className="h-72 rounded-xl" />
        </div>
      </div>
    );
  }

  // Build area chart data from charter statuses
  const charterStatusData = summary?.chartersByStatus?.map((item, i) => ({
    ...item,
    fill: STATUS_COLORS[item.status] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length],
  })) ?? [];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Good morning! 👋</h2>
          <p className="text-gray-500 text-sm mt-0.5">Here's what's happening across your projects today.</p>
        </div>
        <Link href="/charters/new">
          <button
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90 active:scale-95"
            style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)" }}
          >
            <FileText size={15} />
            New Charter
          </button>
        </Link>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          title="Total Charters"
          value={summary?.totalCharters ?? 0}
          icon={FileText}
          gradient="linear-gradient(135deg, #6366F1, #8B5CF6)"
          href="/charters"
          subtitle="All time"
        />
        <StatCard
          title="Pending Approvals"
          value={summary?.pendingApprovals ?? 0}
          icon={CheckSquare}
          gradient="linear-gradient(135deg, #F59E0B, #F97316)"
          href="/approvals"
          subtitle="Awaiting action"
        />
        <StatCard
          title="Active Projects"
          value={summary?.activeProjects ?? 0}
          icon={BarChart3}
          gradient="linear-gradient(135deg, #10B981, #059669)"
          href="/projects"
          subtitle="In execution"
        />
        <StatCard
          title="Approved Budget"
          value={formatCurrency(summary?.totalBudgetApproved ?? 0)}
          icon={DollarSign}
          gradient="linear-gradient(135deg, #3B82F6, #1D4ED8)"
          subtitle="Total approved"
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Charter Pipeline */}
        <div
          className="xl:col-span-2 rounded-xl p-5"
          style={{ background: "white", border: "1px solid #E2E8F0", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}
        >
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold text-gray-900">Approval Pipeline</h3>
              <p className="text-xs text-gray-400 mt-0.5">Charters by workflow stage</p>
            </div>
            <Link href="/charters">
              <button className="text-xs text-indigo-600 font-medium flex items-center gap-1 hover:text-indigo-700">
                View all <ArrowUpRight size={12} />
              </button>
            </Link>
          </div>

          {charterStatusData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={charterStatusData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366F1" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#6366F1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Tooltip
                  contentStyle={{ background: "#1E293B", border: "none", borderRadius: "8px", color: "white", fontSize: "12px" }}
                  cursor={{ stroke: "#6366F1", strokeWidth: 1, strokeDasharray: "4 2" }}
                />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke="#6366F1"
                  strokeWidth={2.5}
                  fill="url(#areaGrad)"
                  name="Charters"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-56 flex items-center justify-center text-gray-400 text-sm">No pipeline data</div>
          )}

          {/* Status chips */}
          <div className="flex flex-wrap gap-2 mt-3">
            {charterStatusData.map(item => (
              <div key={item.status} className="flex items-center gap-1.5 text-xs text-gray-500">
                <div className="w-2 h-2 rounded-full" style={{ background: item.fill }} />
                <span className="capitalize">{item.status.replace(/_/g, " ")}</span>
                <span className="font-semibold text-gray-700">({item.count})</span>
              </div>
            ))}
          </div>
        </div>

        {/* Charters by Status - Pie */}
        <div
          className="rounded-xl p-5"
          style={{ background: "white", border: "1px solid #E2E8F0", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}
        >
          <div className="mb-4">
            <h3 className="font-semibold text-gray-900">Status Distribution</h3>
            <p className="text-xs text-gray-400 mt-0.5">Across all charters</p>
          </div>
          {charterStatusData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={charterStatusData}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={80}
                  paddingAngle={3}
                  dataKey="count"
                  nameKey="status"
                >
                  {charterStatusData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} strokeWidth={0} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: "#1E293B", border: "none", borderRadius: "8px", color: "white", fontSize: "12px" }}
                />
                <Legend
                  formatter={(v) => <span className="text-xs text-gray-500 capitalize">{String(v).replace(/_/g, " ")}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-48 flex items-center justify-center text-gray-400 text-sm">No data</div>
          )}
        </div>
      </div>

      {/* Recent Activity */}
      <div
        className="rounded-xl p-5"
        style={{ background: "white", border: "1px solid #E2E8F0", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-gray-900">Recent Activity</h3>
            <p className="text-xs text-gray-400 mt-0.5">Latest actions across the system</p>
          </div>
        </div>

        {loadingActivity ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 rounded-lg" />)}
          </div>
        ) : activities && activities.length > 0 ? (
          <div className="divide-y divide-gray-50">
            {activities.slice(0, 8).map((activity) => (
              <div key={activity.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                  style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)" }}
                >
                  <BarChart3 size={12} className="text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-700 font-medium">{activity.message}</p>
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
  );
}
