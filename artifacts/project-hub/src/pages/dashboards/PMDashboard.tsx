import { useListProjects, useGetDashboardSummary, useListIssues } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { CheckSquare, Clock, AlertTriangle, FileText, TrendingUp, ArrowUpRight } from "lucide-react";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import {
  KPITile, RAGBadge, DashboardCard, useAutoRefresh, exportCSV, exportXLSX, exportPDF,
} from "../../components/dashboard/primitives";
import { useUserStore } from "../../lib/store";
import { useMemo, useEffect } from "react";

function useMyTasks(userId: number, refetchInterval: number | false) {
  return useQuery({
    queryKey: ["/api/tasks/my", userId],
    queryFn: async () => {
      const projectsRes = await fetch("/api/projects");
      const projects: Array<{ id: number; name: string }> = projectsRes.ok ? await projectsRes.json() : [];
      const taskPromises = projects.slice(0, 20).map(p =>
        fetch(`/api/projects/${p.id}/tasks`).then(r => r.ok ? r.json() : []).then((tasks: Array<Record<string, unknown>>) =>
          tasks.map(t => ({ ...t, projectName: p.name, projectId: p.id }))
        )
      );
      const taskGroups = await Promise.all(taskPromises);
      const allTasks = taskGroups.flat() as Array<{
        id: number; name: string; status: string; endDate?: string; assigneeId?: number;
        projectName: string; projectId: number; priority?: string; rag?: string;
      }>;
      return allTasks.filter(t => t.assigneeId === userId);
    },
    refetchInterval,
  });
}

type SnapshotProject = {
  id: number; name: string; ragStatus?: string | null; progress?: number | null;
  endDate?: string | null; startDate?: string | null; capexBudget?: number | null; opexBudget?: number | null;
};

function ProjectSnapshotCard({ project }: { project: SnapshotProject }) {
  const progress = project.progress ?? 0;
  const circumference = 2 * Math.PI * 20;
  const offset = circumference - (progress / 100) * circumference;
  const { data: issues = [] } = useListIssues(project.id);

  const now = new Date();
  const openIssues = (issues as Array<{ status?: string; type?: string; createdAt?: string }>).filter(i => i.status !== "resolved");
  const openCount = openIssues.length;
  const crCount = openIssues.filter(i => i.type === "change_request").length;

  const totalBudget = (project.capexBudget ?? 0) + (project.opexBudget ?? 0);
  let schedVarianceDays = 0;
  let baselinePct = 0;
  if (project.startDate && project.endDate) {
    const start = new Date(project.startDate), end = new Date(project.endDate);
    const totalDays = Math.max(1, (end.getTime() - start.getTime()) / 86400000);
    const elapsed = Math.max(0, (now.getTime() - start.getTime()) / 86400000);
    baselinePct = Math.min(100, (elapsed / totalDays) * 100);
    schedVarianceDays = Math.round(((progress - baselinePct) / 100) * totalDays);
  }

  return (
    <Link href={`/projects/${project.id}`}>
      <div
        className="rounded-2xl p-5 cursor-pointer transition-all hover:shadow-md hover:-translate-y-0.5 h-full"
        style={{ background: "white", border: "1px solid #E2E8F0" }}
      >
        <div className="flex items-start justify-between mb-3">
          <RAGBadge status={project.ragStatus} size="xs" />
          <ArrowUpRight size={14} className="text-gray-300" />
        </div>
        <h4 className="font-semibold text-gray-900 mb-3 line-clamp-2">{project.name}</h4>

        <div className="flex items-center gap-4 mb-3">
          <div className="relative flex-shrink-0">
            <svg width={50} height={50} className="-rotate-90">
              <circle cx={25} cy={25} r={20} fill="none" stroke="#F1F5F9" strokeWidth={4} />
              {baselinePct > 0 && (
                <circle cx={25} cy={25} r={20} fill="none" stroke="#E2E8F0" strokeWidth={4}
                  strokeDasharray={circumference} strokeDashoffset={circumference - (baselinePct / 100) * circumference}
                  strokeLinecap="round" />
              )}
              <circle cx={25} cy={25} r={20} fill="none"
                stroke={progress >= 80 ? "#10B981" : progress >= 40 ? "#6366F1" : "#F59E0B"}
                strokeWidth={4} strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-xs font-bold text-gray-700">{progress}%</span>
            </div>
          </div>
          <div className="flex-1 text-xs">
            <div className="flex items-center justify-between mb-1">
              <span className="text-gray-500">Actual vs Baseline</span>
              <span className={`font-bold text-[10px] ${schedVarianceDays >= 0 ? "text-green-600" : "text-red-500"}`}>
                {schedVarianceDays >= 0 ? "+" : ""}{schedVarianceDays}d
              </span>
            </div>
            <div className="relative h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="absolute inset-y-0 left-0 bg-gray-200 rounded-full" style={{ width: `${baselinePct}%` }} />
              <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${progress}%`, background: progress >= baselinePct ? "#10B981" : "#EF4444" }} />
            </div>
            {project.endDate && (
              <div className="flex items-center gap-1 text-gray-400 mt-1.5">
                <Clock size={9} /> {format(new Date(project.endDate), "MMM d, yyyy")}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 pt-2 border-t" style={{ borderColor: "#F1F5F9" }}>
          <div className="text-center">
            <p className="text-[10px] text-gray-400 mb-0.5">Issues</p>
            <p className={`text-xs font-bold ${openCount > 0 ? "text-amber-600" : "text-gray-400"}`}>{openCount}</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] text-gray-400 mb-0.5">CRs</p>
            <p className={`text-xs font-bold ${crCount > 0 ? "text-indigo-600" : "text-gray-400"}`}>{crCount}</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] text-gray-400 mb-0.5">Budget</p>
            <p className="text-xs font-bold text-gray-600">{totalBudget > 0 ? `$${(totalBudget / 1000).toFixed(0)}K` : "—"}</p>
          </div>
        </div>
      </div>
    </Link>
  );
}

export default function PMDashboard() {
  const { refetchInterval, markRefreshed, IntervalPicker } = useAutoRefresh();
  const { userId } = useUserStore();
  const { data: summary } = useGetDashboardSummary({ query: { refetchInterval } as never });
  const { data: projects, isLoading: loadingProjects } = useListProjects(undefined, { query: { refetchInterval } as never });
  const { data: myTasks, isLoading: loadingTasks } = useMyTasks(userId, refetchInterval);

  useEffect(() => { if (projects) markRefreshed(); }, [projects]);

  // PM-owned: only projects where projectManagerId matches current user and status is active
  const myProjects = useMemo(() => {
    return (projects ?? []).filter(p => {
      const pp = p as unknown as Record<string, unknown>;
      return pp.projectManagerId === userId && p.status === "active";
    });
  }, [projects, userId]);

  const activeProjects = myProjects;

  const now = new Date();
  const next7 = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const tasksDueThisWeek = myTasks?.filter(t =>
    t.status !== "completed" && t.endDate && new Date(t.endDate) <= next7 && new Date(t.endDate) >= now
  ) ?? [];
  const overdueTasks = myTasks?.filter(t =>
    t.status !== "completed" && t.endDate && new Date(t.endDate) < now
  ) ?? [];
  const blockedTasks = myTasks?.filter(t => t.status === "blocked") ?? [];

  return (
    <div className="space-y-5" data-print-target>
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Project Manager Dashboard</h2>
          <p className="text-sm text-gray-500 mt-0.5">Your active projects, tasks, and pending actions</p>
        </div>
        <IntervalPicker />
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <KPITile label="Active Projects" value={activeProjects.length} icon={TrendingUp} gradient="linear-gradient(135deg,#6366F1,#8B5CF6)" />
        <KPITile label="Due This Week" value={tasksDueThisWeek.length} icon={Clock} gradient="linear-gradient(135deg,#F59E0B,#D97706)" sub="Tasks assigned to you" />
        <KPITile label="Overdue Tasks" value={overdueTasks.length} icon={AlertTriangle} gradient="linear-gradient(135deg,#EF4444,#DC2626)" sub="Requires immediate action" />
        <KPITile label="Pending Approvals" value={summary?.pendingApprovals ?? 0} icon={CheckSquare} gradient="linear-gradient(135deg,#10B981,#059669)" sub="Awaiting sign-off" />
      </div>

      {/* Main 2-col layout */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* My Tasks */}
        <div className="xl:col-span-2 space-y-4">
          <DashboardCard
            title="Tasks Due This Week"
            subtitle="Assigned to you, due in the next 7 days"
            onExportCSV={() => exportCSV("tasks-due.csv", tasksDueThisWeek.map(t => ({
              Task: t.name, Project: t.projectName, Due: t.endDate ?? "", Priority: t.priority ?? "", Status: t.status,
            })))}
          >
            {loadingTasks ? (
              <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
            ) : tasksDueThisWeek.length > 0 ? (
              <div className="space-y-2">
                {tasksDueThisWeek.map(t => (
                  <Link key={t.id} href={`/projects/${t.projectId}`}>
                    <div className="flex items-center gap-3 p-3 rounded-xl hover:bg-indigo-50 cursor-pointer transition-colors">
                      <CheckSquare size={14} className="text-indigo-400 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{t.name}</p>
                        <p className="text-xs text-gray-400">{t.projectName}</p>
                      </div>
                      <div className="text-xs flex items-center gap-1 text-gray-500 flex-shrink-0">
                        <Clock size={10} />
                        {t.endDate ? format(new Date(t.endDate), "MMM d") : "—"}
                      </div>
                      {t.priority && (
                        <span className="text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0" style={{ background: t.priority === "P1" ? "#FEE2E2" : "#F1F5F9", color: t.priority === "P1" ? "#DC2626" : "#64748B" }}>
                          {t.priority}
                        </span>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-400 text-sm">No tasks due this week</div>
            )}
          </DashboardCard>

          {/* Overdue Tasks */}
          {overdueTasks.length > 0 && (
            <DashboardCard title="Overdue Tasks" subtitle="Past deadline — needs immediate attention">
              <div className="space-y-2">
                {overdueTasks.map(t => (
                  <Link key={t.id} href={`/projects/${t.projectId}`}>
                    <div className="flex items-center gap-3 p-3 rounded-xl bg-red-50 hover:bg-red-100 cursor-pointer transition-colors">
                      <AlertTriangle size={14} className="text-red-500 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{t.name}</p>
                        <p className="text-xs text-gray-500">{t.projectName}</p>
                      </div>
                      {t.endDate && (
                        <span className="text-xs font-bold text-red-600 flex-shrink-0">
                          {Math.ceil((now.getTime() - new Date(t.endDate).getTime()) / 86400000)}d overdue
                        </span>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            </DashboardCard>
          )}

          {/* Blocked Tasks */}
          {blockedTasks.length > 0 && (
            <DashboardCard title="Blocked Tasks" subtitle="Tasks with blocked status">
              <div className="space-y-2">
                {blockedTasks.map(t => (
                  <Link key={t.id} href={`/projects/${t.projectId}`}>
                    <div className="flex items-center gap-3 p-3 rounded-xl bg-amber-50 hover:bg-amber-100 cursor-pointer transition-colors">
                      <AlertTriangle size={14} className="text-amber-500 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{t.name}</p>
                        <p className="text-xs text-gray-500">{t.projectName}</p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </DashboardCard>
          )}
        </div>

        {/* Quick summary */}
        <div className="space-y-4">
          <DashboardCard title="My Task Summary" subtitle="All tasks assigned to you">
            <div className="space-y-3">
              {[
                { label: "Total Tasks", value: myTasks?.length ?? 0, color: "#6366F1" },
                { label: "In Progress", value: myTasks?.filter(t => t.status === "in_progress").length ?? 0, color: "#3B82F6" },
                { label: "Completed", value: myTasks?.filter(t => t.status === "completed").length ?? 0, color: "#10B981" },
                { label: "Not Started", value: myTasks?.filter(t => t.status === "not_started").length ?? 0, color: "#94A3B8" },
                { label: "Overdue", value: overdueTasks.length, color: "#EF4444" },
              ].map(item => (
                <div key={item.label} className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">{item.label}</span>
                  <span className="text-base font-bold" style={{ color: item.color }}>{item.value}</span>
                </div>
              ))}
            </div>
          </DashboardCard>

          <DashboardCard title="Pending Approvals" subtitle="Charters and documents awaiting review">
            <Link href="/approvals">
              <div className="flex items-center gap-3 p-3 rounded-xl bg-indigo-50 hover:bg-indigo-100 cursor-pointer transition-colors">
                <FileText size={16} className="text-indigo-500" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-indigo-800">{summary?.pendingApprovals ?? 0} pending</p>
                  <p className="text-xs text-indigo-500">Click to review</p>
                </div>
                <ArrowUpRight size={14} className="text-indigo-400" />
              </div>
            </Link>
          </DashboardCard>
        </div>
      </div>

      {/* Project Snapshot Cards */}
      <DashboardCard title="My Projects" subtitle="Active projects assigned to you as PM">
        {loadingProjects ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {[1,2,3].map(i => <Skeleton key={i} className="h-36 rounded-2xl" />)}
          </div>
        ) : activeProjects.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {activeProjects.map(p => <ProjectSnapshotCard key={p.id} project={p as unknown as { id: number; name: string; ragStatus?: string; progress?: number; endDate?: string; startDate?: string }} />)}
          </div>
        ) : (
          <div className="text-center py-8 text-gray-400 text-sm">No active projects assigned</div>
        )}
      </DashboardCard>
    </div>
  );
}
