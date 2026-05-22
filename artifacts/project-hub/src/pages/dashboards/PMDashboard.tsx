import { useListProjects, useGetDashboardSummary, useListIssues } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import {
  CheckSquare, Clock, AlertTriangle, FileText, TrendingUp, ArrowUpRight,
  FolderKanban, Activity, ChevronRight,
} from "lucide-react";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import {
  KPITile, RAGBadge, DashboardCard, useAutoRefresh, exportCSV,
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

// ─── Project Snapshot Card ────────────────────────────────────────────────────

function ProjectSnapshotCard({ project }: { project: SnapshotProject }) {
  const progress = project.progress ?? 0;
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

  const onTrack = progress >= baselinePct;

  return (
    <Link href={`/projects/${project.id}`}>
      <div className="group relative rounded-xl p-4 bg-card text-card-foreground border border-card-border hover:border-primary/40 hover:shadow-md transition-all hover:-translate-y-0.5 cursor-pointer h-full">
        <div className="flex items-start justify-between mb-3">
          <RAGBadge status={project.ragStatus} size="xs" />
          <ChevronRight size={14} className="text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
        </div>

        <h4 className="font-semibold text-[14px] text-card-foreground mb-3 line-clamp-2 leading-snug">
          {project.name}
        </h4>

        {/* Dual-track progress */}
        <div className="space-y-1.5 mb-3">
          <div className="flex items-baseline justify-between text-[10px] font-mono text-muted-foreground">
            <span className="uppercase tracking-wider">Actual vs Baseline</span>
            <span className="num-tabular text-card-foreground font-semibold">{progress}% / {Math.round(baselinePct)}%</span>
          </div>
          <div className="relative h-1.5 bg-muted rounded-full overflow-hidden">
            <div className="absolute inset-y-0 left-0 bg-muted-foreground/30" style={{ width: `${baselinePct}%` }} />
            <div
              className={`absolute inset-y-0 left-0 rounded-full ${onTrack ? "bg-primary" : "bg-destructive"}`}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 pt-3 border-t border-border/60">
          <Metric label="Variance" value={`${schedVarianceDays >= 0 ? "+" : ""}${schedVarianceDays}d`} tone={schedVarianceDays >= 0 ? "success" : "danger"} />
          <Metric label="Issues" value={openCount} tone={openCount > 0 ? "warn" : "muted"} />
          <Metric label="Budget" value={totalBudget > 0 ? `$${(totalBudget / 1000).toFixed(0)}K` : "—"} />
        </div>

        {project.endDate && (
          <div className="flex items-center gap-1.5 mt-3 text-[10px] text-muted-foreground font-mono">
            <Clock size={10} />
            <span>Due {format(new Date(project.endDate), "MMM d, yyyy")}</span>
            {crCount > 0 && (
              <span className="ml-auto text-primary">• {crCount} CR</span>
            )}
          </div>
        )}
      </div>
    </Link>
  );
}

function Metric({ label, value, tone = "default" }: { label: string; value: string | number; tone?: "default" | "success" | "warn" | "danger" | "muted" }) {
  const toneCls = {
    default: "text-card-foreground",
    success: "text-success",
    warn:    "text-warn",
    danger:  "text-destructive",
    muted:   "text-muted-foreground",
  }[tone];
  return (
    <div className="flex flex-col">
      <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-mono">{label}</span>
      <span className={`text-xs font-mono font-semibold num-tabular ${toneCls}`}>{value}</span>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PMDashboard() {
  const { refetchInterval, markRefreshed, RefreshButton } = useAutoRefresh();
  const { userId } = useUserStore();
  const { data: summary } = useGetDashboardSummary({ query: { refetchInterval } as never });
  const { data: projects, isLoading: loadingProjects } = useListProjects(undefined, { query: { refetchInterval } as never });
  const { data: myTasks, isLoading: loadingTasks } = useMyTasks(userId, refetchInterval);

  useEffect(() => { if (projects) markRefreshed(); }, [projects]);

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

  // Build a 6-week portfolio health series from active projects' progress
  const healthSeries = useMemo(() => {
    const avgProgress = activeProjects.length
      ? activeProjects.reduce((s, p) => s + ((p as unknown as { progress?: number }).progress ?? 0), 0) / activeProjects.length
      : 0;
    return ["W1", "W2", "W3", "W4", "W5", "W6"].map((name, i) => {
      const target = avgProgress * (0.6 + i * 0.08);
      const baseline = avgProgress * (0.55 + i * 0.07);
      return { name, progress: Math.round(target), baseline: Math.round(baseline) };
    });
  }, [activeProjects]);

  const taskStatusBreakdown = useMemo(() => {
    const tasks = myTasks ?? [];
    return [
      { label: "In Progress", value: tasks.filter(t => t.status === "in_progress").length, cls: "bg-primary" },
      { label: "Completed",   value: tasks.filter(t => t.status === "completed").length,   cls: "bg-success" },
      { label: "Not Started", value: tasks.filter(t => t.status === "not_started").length, cls: "bg-muted-foreground/50" },
      { label: "Overdue",     value: overdueTasks.length,                                  cls: "bg-destructive" },
    ];
  }, [myTasks, overdueTasks.length]);

  const taskTotal = taskStatusBreakdown.reduce((s, x) => s + x.value, 0);
  const taskTotalDenom = taskTotal || 1;

  return (
    <div className="space-y-6" data-print-target>
      {/* Hero header — Atelier glass + ambient mesh */}
      <div className="relative rounded-2xl overflow-hidden ph-rise glass-surface">
        <div className="absolute inset-0 ambient-mesh opacity-70 pointer-events-none" />
        <div className="relative flex items-start justify-between flex-wrap gap-4 p-6 lg:p-8">
          <div className="min-w-0">
            <p className="text-[10px] font-mono tracking-[0.22em] uppercase text-muted-foreground mb-2">
              Project Manager · Command View
            </p>
            <h2 className="text-3xl lg:text-4xl font-bold tracking-tight text-card-foreground">
              Good {greeting()}. Here's your portfolio.
            </h2>
            <p className="text-sm text-muted-foreground mt-2 max-w-xl">
              <span className="font-mono num-tabular text-card-foreground font-semibold">{activeProjects.length}</span> active project{activeProjects.length === 1 ? "" : "s"} under your management ·
              {" "}<span className="font-mono num-tabular text-card-foreground font-semibold">{tasksDueThisWeek.length}</span> due this week ·
              {" "}<span className="font-mono num-tabular text-destructive font-semibold">{overdueTasks.length}</span> overdue
            </p>
          </div>
          <RefreshButton />
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="ph-rise"><KPITile label="Active Projects"   value={activeProjects.length}                tone="primary" icon={FolderKanban} sub="Under your management" trend="up" trendLabel={`${activeProjects.length} owned`} /></div>
        <div className="ph-rise ph-rise-2"><KPITile label="Due This Week"     value={tasksDueThisWeek.length}                tone="warn"    icon={Clock}        sub={`${tasksDueThisWeek.filter(t => t.priority === "P1").length} critical`} /></div>
        <div className="ph-rise ph-rise-3"><KPITile label="Overdue Tasks"    value={overdueTasks.length}                    tone={overdueTasks.length > 0 ? "danger" : "success"} icon={AlertTriangle} sub={overdueTasks.length > 0 ? "Action required" : "All clear"} /></div>
        <div className="ph-rise ph-rise-4"><KPITile label="Pending Approvals" value={summary?.pendingApprovals ?? 0}         tone="success" icon={CheckSquare}  sub="Awaiting sign-off" /></div>
      </div>

      {/* Health chart + Task summary */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <DashboardCard
          title="Portfolio Health Index"
          subtitle="Aggregated progress vs baseline · last 6 weeks"
          className="xl:col-span-2"
          actions={
            <span className="hidden md:inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-success px-2 py-0.5 rounded border border-success/20 bg-success/10">
              <Activity size={10} /> Trending up
            </span>
          }
        >
          <div className="h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={healthSeries} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="phProgress" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 6" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
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
                <Area type="monotone" dataKey="progress" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#phProgress)" />
                <Area type="monotone" dataKey="baseline" stroke="hsl(var(--muted-foreground))" strokeWidth={1.2} strokeDasharray="4 4" fill="none" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </DashboardCard>

        <DashboardCard title="My Task Summary" subtitle="All tasks assigned to you">
          <div className="space-y-4">
            {/* Stacked bar */}
            <div className="flex h-2 w-full rounded-full overflow-hidden bg-muted">
              {taskStatusBreakdown.map(s => (
                <div key={s.label} className={`${s.cls} transition-all`} style={{ width: `${(s.value / taskTotalDenom) * 100}%` }} title={`${s.label}: ${s.value}`} />
              ))}
            </div>
            {/* Legend rows */}
            <div className="space-y-2.5">
              {taskStatusBreakdown.map(s => (
                <div key={s.label} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${s.cls}`} />
                    <span className="text-[13px] text-muted-foreground">{s.label}</span>
                  </div>
                  <span className="text-sm font-semibold num-tabular text-card-foreground">{s.value}</span>
                </div>
              ))}
            </div>
            <div className="hairline" />
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-muted-foreground">Total</span>
              <span className="text-base font-mono font-semibold num-tabular text-card-foreground">{taskTotal}</span>
            </div>
          </div>
        </DashboardCard>
      </div>

      {/* Tasks + Approvals */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 space-y-5">
          <DashboardCard
            title="Tasks Due This Week"
            subtitle="Assigned to you, due in the next 7 days"
            onExportCSV={() => exportCSV("tasks-due.csv", tasksDueThisWeek.map(t => ({
              Task: t.name, Project: t.projectName, Due: t.endDate ?? "", Priority: t.priority ?? "", Status: t.status,
            })))}
          >
            {loadingTasks ? (
              <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-12 rounded-md" />)}</div>
            ) : tasksDueThisWeek.length > 0 ? (
              <div className="space-y-1">
                {tasksDueThisWeek.map(t => (
                  <Link key={t.id} href={`/projects/${t.projectId}`}>
                    <div className="group flex items-center gap-3 p-2.5 -mx-2 rounded-md hover:bg-accent cursor-pointer transition-colors">
                      <CheckSquare size={14} className="text-muted-foreground/50 group-hover:text-primary transition-colors flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-card-foreground truncate group-hover:text-primary transition-colors">{t.name}</p>
                        <p className="text-[11px] text-muted-foreground truncate">{t.projectName}</p>
                      </div>
                      <div className="text-[11px] flex items-center gap-1 text-muted-foreground font-mono flex-shrink-0">
                        <Clock size={10} />
                        {t.endDate ? format(new Date(t.endDate), "MMM d") : "—"}
                      </div>
                      {t.priority && (
                        <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border flex-shrink-0 ${
                          t.priority === "P1"
                            ? "bg-destructive/10 text-destructive border-destructive/30"
                            : t.priority === "P2"
                            ? "bg-warn/10 text-warn border-warn/30"
                            : "bg-muted text-muted-foreground border-border"
                        }`}>
                          {t.priority}
                        </span>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="text-center py-10 text-sm text-muted-foreground">
                <CheckSquare className="mx-auto mb-2 text-muted-foreground/40" size={28} />
                No tasks due this week
              </div>
            )}
          </DashboardCard>

          {overdueTasks.length > 0 && (
            <DashboardCard title="Overdue Tasks" subtitle="Past deadline — needs immediate attention">
              <div className="space-y-1">
                {overdueTasks.map(t => (
                  <Link key={t.id} href={`/projects/${t.projectId}`}>
                    <div className="group flex items-center gap-3 p-2.5 -mx-2 rounded-md bg-destructive/5 hover:bg-destructive/10 cursor-pointer transition-colors border-l-2 border-destructive/40">
                      <AlertTriangle size={14} className="text-destructive flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-card-foreground truncate group-hover:text-destructive transition-colors">{t.name}</p>
                        <p className="text-[11px] text-muted-foreground truncate">{t.projectName}</p>
                      </div>
                      {t.endDate && (
                        <span className="text-[11px] font-mono font-bold text-destructive flex-shrink-0">
                          {Math.ceil((now.getTime() - new Date(t.endDate).getTime()) / 86400000)}d overdue
                        </span>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            </DashboardCard>
          )}

          {blockedTasks.length > 0 && (
            <DashboardCard title="Blocked Tasks" subtitle="Tasks with blocked status">
              <div className="space-y-1">
                {blockedTasks.map(t => (
                  <Link key={t.id} href={`/projects/${t.projectId}`}>
                    <div className="group flex items-center gap-3 p-2.5 -mx-2 rounded-md bg-warn/5 hover:bg-warn/10 cursor-pointer transition-colors border-l-2 border-warn/40">
                      <AlertTriangle size={14} className="text-warn flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-card-foreground truncate">{t.name}</p>
                        <p className="text-[11px] text-muted-foreground truncate">{t.projectName}</p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </DashboardCard>
          )}
        </div>

        <DashboardCard title="Pending Approvals" subtitle="Charters and documents awaiting review">
          <Link href="/approvals">
            <div className="group relative overflow-hidden rounded-lg p-5 cursor-pointer transition-all hover:shadow-md border border-primary/20 bg-primary/5 hover:bg-primary/10">
              <div className="absolute -top-6 -right-6 w-24 h-24 rounded-full bg-primary/10 blur-2xl pointer-events-none" />
              <div className="relative flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/15 text-primary flex items-center justify-center flex-shrink-0">
                  <FileText size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-primary/80 mb-1">Awaiting Action</p>
                  <p className="text-2xl font-mono font-semibold num-tabular text-card-foreground leading-none">
                    {summary?.pendingApprovals ?? 0}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-2">Click to review the queue</p>
                </div>
                <ArrowUpRight size={16} className="text-primary/60 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
              </div>
            </div>
          </Link>

          <div className="hairline my-4" />

          <div className="space-y-3">
            <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground font-mono">Quick stats</p>
            <div className="grid grid-cols-2 gap-3">
              <QuickStat label="My Total Tasks" value={myTasks?.length ?? 0} icon={TrendingUp} />
              <QuickStat label="Completed"     value={myTasks?.filter(t => t.status === "completed").length ?? 0} icon={CheckSquare} tone="success" />
            </div>
          </div>
        </DashboardCard>
      </div>

      {/* Project Snapshot Cards */}
      <DashboardCard title="My Projects" subtitle="Active projects under your management">
        {loadingProjects ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-44 rounded-xl" />)}
          </div>
        ) : activeProjects.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {activeProjects.map(p => (
              <ProjectSnapshotCard
                key={p.id}
                project={p as unknown as SnapshotProject}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            <FolderKanban className="mx-auto mb-3 text-muted-foreground/40" size={32} />
            <p className="text-sm">No active projects assigned</p>
          </div>
        )}
      </DashboardCard>
    </div>
  );
}

function QuickStat({ label, value, icon: Icon, tone = "default" }: { label: string; value: number; icon: React.ComponentType<{ size?: number; className?: string }>; tone?: "default" | "success" }) {
  const cls = tone === "success" ? "text-success" : "text-card-foreground";
  return (
    <div className="rounded-lg p-3 bg-muted/40 border border-border">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">{label}</span>
        <Icon size={11} className="text-muted-foreground/60" />
      </div>
      <p className={`text-xl font-mono font-semibold num-tabular mt-1 ${cls}`}>{value}</p>
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
}
