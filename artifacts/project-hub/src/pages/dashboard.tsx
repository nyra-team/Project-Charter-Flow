import { useGetDashboardSummary, useGetRecentActivity } from "@workspace/api-client-react";
import { useUserStore } from "../lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "../lib/format";
import { FileText, CheckSquare, Briefcase, Activity, DollarSign } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { format } from "date-fns";

const COLORS = ["#4f46e5", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#64748b", "#3b82f6"];

export default function Dashboard() {
  const { userId } = useUserStore();
  const { data: summary, isLoading: loadingSummary } = useGetDashboardSummary();
  const { data: activities, isLoading: loadingActivity } = useGetRecentActivity({ query: { enabled: true } });

  if (loadingSummary) {
    return <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-32 w-full" />)}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Skeleton className="h-96 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    </div>;
  }

  const statCards = [
    { title: "Total Charters", value: summary?.totalCharters || 0, icon: FileText, color: "text-blue-600", bg: "bg-blue-100 dark:bg-blue-900/20" },
    { title: "Pending Approvals", value: summary?.pendingApprovals || 0, icon: CheckSquare, color: "text-amber-600", bg: "bg-amber-100 dark:bg-amber-900/20" },
    { title: "Active Projects", value: summary?.activeProjects || 0, icon: Briefcase, color: "text-indigo-600", bg: "bg-indigo-100 dark:bg-indigo-900/20" },
    { title: "Approved Budget", value: formatCurrency(summary?.totalBudgetApproved || 0), icon: DollarSign, color: "text-green-600", bg: "bg-green-100 dark:bg-green-900/20" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-3xl font-bold tracking-tight">Overview</h2>
        <div className="flex gap-2">
          <Link href="/charters/new" className="inline-flex">
            <Button>Create Charter</Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((stat, i) => {
          const Icon = stat.icon;
          return (
            <Card key={i}>
              <CardContent className="p-6 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">{stat.title}</p>
                  <h3 className="text-2xl font-bold">{stat.value}</h3>
                </div>
                <div className={`p-3 rounded-full ${stat.bg} ${stat.color}`}>
                  <Icon size={24} />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="col-span-1 lg:col-span-2">
          <CardHeader>
            <CardTitle>Projects by Status</CardTitle>
          </CardHeader>
          <CardContent className="h-80">
            {summary?.projectsByStatus && summary.projectsByStatus.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={summary.projectsByStatus}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="status" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="count" fill="#4f46e5" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground">No data available</div>
            )}
          </CardContent>
        </Card>

        <Card className="col-span-1">
          <CardHeader>
            <CardTitle>Charters by Status</CardTitle>
          </CardHeader>
          <CardContent className="h-80">
            {summary?.chartersByStatus && summary.chartersByStatus.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={summary.chartersByStatus}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="count"
                    nameKey="status"
                  >
                    {summary.chartersByStatus.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground">No data available</div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity size={18} />
            Recent Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadingActivity ? (
            <div className="space-y-4">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : activities && activities.length > 0 ? (
            <div className="space-y-4">
              {activities.map((activity) => (
                <div key={activity.id} className="flex items-start gap-4 pb-4 border-b border-border last:border-0 last:pb-0">
                  <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                    <Activity size={14} />
                  </div>
                  <div className="flex-1 space-y-1">
                    <p className="text-sm font-medium">{activity.message}</p>
                    <div className="flex items-center text-xs text-muted-foreground gap-2">
                      <span>{activity.userName || "System"}</span>
                      <span>•</span>
                      <span>{format(new Date(activity.createdAt), "MMM d, h:mm a")}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-6 text-muted-foreground">No recent activity</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
