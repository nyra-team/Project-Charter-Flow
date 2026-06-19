import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useListProjects } from "@workspace/api-client-react";
import { Kanban, Table2, BarChart2, CheckSquare, ChevronDown, ListTree, LayoutGrid, CalendarDays, Info } from "lucide-react";
import { api } from "@/lib/extra-api";
import { PageHeader } from "@/components/ui-kit";
import { TaskFilterBar, applyTaskFilters, type TaskFilters } from "@/components/task-filter-bar";
import { ConnectBoard, type BoardTask } from "@/components/connect-board";
import { TaskDetailModal } from "@/components/task-detail-modal";
import { WbsTree, type WbsTask, type WbsMilestone } from "@/components/wbs-tree";
import { TaskStatusChip, PriorityChip } from "@/components/task-status-chip";
import { HoverHint } from "@/components/ui-kit";
import { KanbanView } from "@/components/monday/KanbanView";
import { CalendarView, type CalendarItem } from "@/components/monday/CalendarView";
import { PriorityCell, OwnerCell, DateCell, type BoardColumn, type BoardGroup } from "@/components/monday";
import { PersonAvatar } from "@/components/person-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { LIFECYCLE_STAGES } from "@/lib/lifecycle-config";
import { TASK_STATUSES } from "@/lib/task-constants";
import type { AggTask, AggMilestone } from "@/lib/work-types";

// Task code shown in the table — TSK- + the task's zero-padded DB id.
const taskCode = (id: number) => `TSK-${String(id).padStart(4, "0")}`;

// Card cells for the Tasks Kanban (mirrors the Projects board's compact stack).
const TASK_BOARD_COLUMNS: BoardColumn<AggTask>[] = [
  { key: "priority", header: "Priority", render: (t) => <PriorityCell priority={t.priority} /> },
  { key: "owner", header: "Owner", render: (t) => <OwnerCell id={t.assigneeId} name={t.assigneeName} /> },
  { key: "due", header: "Due", render: (t) => <DateCell value={t.endDate} /> },
];

type View = "tree" | "board" | "kanban" | "table" | "timeline" | "calendar";
type GroupBy = "none" | "status" | "owner" | "project" | "milestone" | "stage";

const STAGE_LABEL = Object.fromEntries(LIFECYCLE_STAGES.map((s) => [s.key, s.label]));
const EMPTY_FILTERS: TaskFilters = { search: "", status: "", priority: "", rag: "", dateFrom: "", dateTo: "" };

export default function TasksPage() {
  const qc = useQueryClient();
  const { data: tasks, isLoading } = useQuery({
    queryKey: ["/api/tasks"],
    queryFn: () => api.get<AggTask[]>("/api/tasks"),
  });
  const { data: users } = useQuery({ queryKey: ["/api/users"], queryFn: () => api.get<Array<{ id: number; name: string }>>("/api/users") });
  const { data: allMilestones } = useQuery({ queryKey: ["/api/milestones"], queryFn: () => api.get<AggMilestone[]>("/api/milestones") });
  const { data: projects } = useListProjects();

  const [view, setView] = useState<View>("tree");
  const [groupBy, setGroupBy] = useState<GroupBy>("status");
  const [filters, setFilters] = useState<TaskFilters>(EMPTY_FILTERS);
  const [ownerFilter, setOwnerFilter] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [openTask, setOpenTask] = useState<AggTask | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ["/api/tasks"] });

  const filtered = useMemo(() => {
    let list = applyTaskFilters((tasks ?? []) as AggTask[], filters, ownerFilter);
    if (projectFilter) list = list.filter((t) => String(t.projectId) === projectFilter);
    if (stageFilter) list = list.filter((t) => t.stage === stageFilter);
    return list;
  }, [tasks, filters, ownerFilter, projectFilter, stageFilter]);

  const groups = useMemo(() => groupTasks(filtered, groupBy), [filtered, groupBy]);

  // Kanban — one column per task status, same board as the Projects view.
  const kanbanGroups = useMemo<BoardGroup<AggTask>[]>(
    () => TASK_STATUSES.map((s) => ({ key: s.value, label: s.label, color: s.solid, rows: filtered.filter((t) => t.status === s.value) })),
    [filtered],
  );
  const moveTaskToStatus = (rowId: string, status: string) => {
    const id = Number(rowId.replace("task:", ""));
    if (!Number.isFinite(id)) return;
    void api.patch(`/api/tasks/${id}`, { status }).then(refresh);
  };
  // Calendar — place each task on its due (else start) date.
  const calendarItems = useMemo<CalendarItem[]>(
    () => filtered.map((t) => ({ id: t.id, date: t.endDate ?? t.startDate, title: t.name, status: t.status })),
    [filtered],
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Tasks"
        subtitle={`${filtered.length} task${filtered.length === 1 ? "" : "s"} across all projects`}
        icon={CheckSquare}
        actions={<ViewSwitch view={view} setView={setView} />}
      />

      {/* Filters + group-by */}
      <div className="rounded-2xl bg-card border border-card-border glass-surface p-3 space-y-2">
        <TaskFilterBar filters={filters} onChange={setFilters} owners={users ?? []} ownerFilter={ownerFilter} onOwnerChange={setOwnerFilter} />
        <div className="flex flex-wrap items-center gap-2">
          <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} className="text-xs h-8 rounded-lg border border-input bg-background px-2 outline-none focus:ring-2 focus:ring-ring/40">
            <option value="">All Projects</option>
            {(projects ?? []).map((p: { id: number; name: string }) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} className="text-xs h-8 rounded-lg border border-input bg-background px-2 outline-none focus:ring-2 focus:ring-ring/40">
            <option value="">All Stages</option>
            {LIFECYCLE_STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          {view === "table" && (
            <div className="flex items-center gap-1.5 ml-auto">
              <span className="text-[11px] text-muted-foreground uppercase tracking-wider">Group by</span>
              <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)} className="text-xs h-8 rounded-lg border border-input bg-background px-2 outline-none focus:ring-2 focus:ring-ring/40">
                <option value="none">None</option>
                <option value="status">Status</option>
                <option value="owner">Owner</option>
                <option value="project">Project</option>
                <option value="milestone">Milestone</option>
                <option value="stage">Stage</option>
              </select>
            </div>
          )}
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-96 w-full rounded-2xl" />
      ) : view === "tree" ? (
        <WbsByProject tasks={filtered} milestones={allMilestones ?? []} onOpen={(t) => setOpenTask(t)} onRefresh={refresh} />
      ) : view === "board" ? (
        <ConnectBoard
          tasks={filtered.map(toBoardTask)}
          milestones={[]}
          projectId={0}
          onRefresh={refresh}
          onTaskClick={(id) => setOpenTask(filtered.find((t) => t.id === id) ?? null)}
        />
      ) : view === "kanban" ? (
        <KanbanView<AggTask>
          groups={kanbanGroups}
          columns={TASK_BOARD_COLUMNS}
          getRowId={(t) => `task:${t.id}`}
          getName={(t) => <span className="font-medium">{t.name}</span>}
          onOpenRow={(t) => setOpenTask(t)}
          onMoveToGroup={moveTaskToStatus}
        />
      ) : view === "calendar" ? (
        <CalendarView<CalendarItem>
          items={calendarItems}
          onOpenItem={(it) => setOpenTask(filtered.find((t) => t.id === it.id) ?? null)}
        />
      ) : view === "timeline" ? (
        <TimelineView tasks={filtered} onOpen={setOpenTask} />
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <TaskTableGroup key={g.key} label={g.label} tasks={g.items} onOpen={setOpenTask} />
          ))}
          {groups.length === 0 && <p className="text-sm text-muted-foreground text-center py-12">No tasks match the current filters.</p>}
        </div>
      )}

      {openTask && (
        <TaskDetailModal task={openTask} allTasks={(tasks ?? []) as AggTask[]} onClose={() => setOpenTask(null)} onRefresh={refresh} />
      )}
    </div>
  );
}

function toBoardTask(t: AggTask): BoardTask {
  return {
    id: t.id, name: t.name, status: t.status, priority: t.priority, rag: t.rag,
    assigneeName: t.assigneeName, endDate: t.endDate, parentTaskId: t.parentTaskId,
    isCritical: t.isCritical, projectName: t.projectName,
  };
}

function groupTasks(tasks: AggTask[], by: GroupBy): Array<{ key: string; label: string; items: AggTask[] }> {
  if (by === "none") return [{ key: "all", label: `All Tasks (${tasks.length})`, items: tasks }];
  const map = new Map<string, AggTask[]>();
  for (const t of tasks) {
    let key: string;
    if (by === "status") key = t.status;
    else if (by === "owner") key = t.assigneeName ?? "Unassigned";
    else if (by === "project") key = t.projectName;
    else if (by === "milestone") key = t.milestoneName ?? "No milestone";
    else key = t.stage ? STAGE_LABEL[t.stage] ?? t.stage : "No stage";
    (map.get(key) ?? map.set(key, []).get(key)!).push(t);
  }
  return [...map.entries()].map(([key, items]) => ({
    key,
    label: `${by === "status" ? (STATUS_LABEL[key] ?? key) : key} · ${items.length}`,
    items,
  }));
}

const STATUS_LABEL: Record<string, string> = {
  not_started: "Not Started", in_progress: "In Progress", completed: "Completed",
  delayed: "Delayed", on_hold: "On Hold", blocked: "Blocked",
};

function TaskTableGroup({ label, tasks, onOpen }: { label: string; tasks: AggTask[]; onOpen: (t: AggTask) => void }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-2xl bg-card border border-card-border glass-surface overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-accent/40 transition-colors">
        <ChevronDown size={15} className={`text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`} />
        <span className="text-sm font-semibold text-foreground">{label}</span>
      </button>
      {open && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] text-muted-foreground uppercase tracking-wider border-y border-border/60 bg-muted/30">
                <th className="text-left font-semibold px-3 py-2 whitespace-nowrap">
                  <span className="inline-flex items-center gap-1">
                    Code
                    <HoverHint
                      title="How task codes are formed"
                      footer={<>“TSK-” + the task's zero-padded database ID (e.g. <b className="text-popover-foreground">TSK-0042</b>) — generated automatically and stable for the life of the task.</>}
                    >
                      <span className="inline-flex cursor-help" aria-label="How task codes are formed">
                        <Info size={11} className="opacity-60" />
                      </span>
                    </HoverHint>
                  </span>
                </th>
                <th className="text-left font-semibold px-4 py-2">Task</th>
                <th className="text-left font-semibold px-3 py-2 hidden md:table-cell">Project</th>
                <th className="text-left font-semibold px-3 py-2 hidden lg:table-cell">Milestone</th>
                <th className="text-left font-semibold px-3 py-2">Owner</th>
                <th className="text-left font-semibold px-3 py-2">Status</th>
                <th className="text-left font-semibold px-3 py-2 hidden sm:table-cell">Priority</th>
                <th className="text-left font-semibold px-3 py-2 hidden md:table-cell">Due</th>
                <th className="text-left font-semibold px-3 py-2">Progress</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {tasks.map((t) => (
                <tr key={t.id} onClick={() => onOpen(t)} className="hover:bg-accent/30 cursor-pointer transition-colors">
                  <td className="px-3 py-2.5 font-mono text-[11px] font-semibold text-muted-foreground whitespace-nowrap">{taskCode(t.id)}</td>
                  <td className="px-4 py-2.5 font-medium text-foreground">
                    <span className="flex items-center gap-1.5">{t.parentTaskId && <span className="text-muted-foreground/50">↳</span>}{t.name}</span>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground hidden md:table-cell truncate max-w-[160px]">{t.projectName}</td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground hidden lg:table-cell truncate max-w-[140px]">{t.milestoneName ?? "—"}</td>
                  <td className="px-3 py-2.5">
                    {t.assigneeName ? <span className="inline-flex items-center gap-1.5"><PersonAvatar id={t.assigneeId} name={t.assigneeName} size={20} /><span className="text-xs truncate max-w-[90px]">{t.assigneeName}</span></span> : <span className="text-xs text-muted-foreground/50">—</span>}
                  </td>
                  <td className="px-3 py-2.5"><TaskStatusChip status={t.status} /></td>
                  <td className="px-3 py-2.5 hidden sm:table-cell"><PriorityChip priority={t.priority} /></td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground hidden md:table-cell font-mono">
                    {t.endDate ? new Date(t.endDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "—"}
                    {(t.gate?.daysOverdue ?? 0) > 0 && <span className="ml-1 text-destructive font-semibold">+{t.gate!.daysOverdue}d</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <div className="w-14 h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full bg-primary rounded-full" style={{ width: `${t.progressPct}%` }} /></div>
                      <span className="text-[10px] text-muted-foreground font-mono w-7">{t.progressPct}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Lightweight month-scale timeline (start→end bars). Not the full zoomable Gantt
// (that stays on the project Timeline tab) — a quick cross-project schedule view.
function TimelineView({ tasks, onOpen }: { tasks: AggTask[]; onOpen: (t: AggTask) => void }) {
  const dated = tasks.filter((t) => t.startDate || t.endDate);
  if (dated.length === 0) return <p className="text-sm text-muted-foreground text-center py-12">No tasks with dates to chart.</p>;
  const times = dated.flatMap((t) => [t.startDate, t.endDate].filter(Boolean).map((d) => new Date(d as string).getTime()));
  const min = Math.min(...times), max = Math.max(...times);
  const span = Math.max(1, max - min);
  const pct = (d: string) => ((new Date(d).getTime() - min) / span) * 100;
  return (
    <div className="rounded-2xl bg-card border border-card-border glass-surface p-4 overflow-x-auto">
      <div className="space-y-1.5 min-w-[640px]">
        {dated.map((t) => {
          const s = t.startDate ?? t.endDate!;
          const e = t.endDate ?? t.startDate!;
          const left = pct(s), width = Math.max(2, pct(e) - left);
          const overdue = (t.gate?.daysOverdue ?? 0) > 0;
          return (
            <div key={t.id} className="flex items-center gap-3">
              <button onClick={() => onOpen(t)} className="w-44 text-left text-xs truncate text-foreground hover:text-primary flex-shrink-0">{t.name}</button>
              <div className="relative flex-1 h-6 bg-muted/40 rounded">
                <div
                  onClick={() => onOpen(t)}
                  className={`absolute top-1 bottom-1 rounded cursor-pointer ${overdue ? "bg-destructive" : t.status === "completed" ? "bg-success" : "bg-primary"}`}
                  style={{ left: `${left}%`, width: `${width}%` }}
                  title={`${s} → ${e}`}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Cross-project WBS: one collapsible Project group → Stage → Milestone → Task → Subtask.
function WbsByProject({
  tasks, milestones, onOpen, onRefresh,
}: {
  tasks: AggTask[];
  milestones: AggMilestone[];
  onOpen: (t: AggTask) => void;
  onRefresh: () => void;
}) {
  const projIds = [...new Set(tasks.map((t) => t.projectId))];
  // Project name + type from the task/milestone rows.
  const nameOf = (pid: number) => tasks.find((t) => t.projectId === pid)?.projectName ?? milestones.find((m) => m.projectId === pid)?.projectName ?? `Project ${pid}`;
  if (projIds.length === 0) return <p className="text-sm text-muted-foreground text-center py-12">No tasks match the current filters.</p>;
  return (
    <div className="space-y-4">
      {projIds.map((pid) => (
        <ProjectWbsGroup
          key={pid}
          name={nameOf(pid)}
          projectId={pid}
          tasks={tasks.filter((t) => t.projectId === pid) as unknown as WbsTask[]}
          milestones={milestones.filter((m) => m.projectId === pid) as unknown as WbsMilestone[]}
          onOpen={(t) => onOpen(t as unknown as AggTask)}
          onRefresh={onRefresh}
        />
      ))}
    </div>
  );
}

function ProjectWbsGroup({
  name, projectId, tasks, milestones, onOpen, onRefresh,
}: {
  name: string; projectId: number; tasks: WbsTask[]; milestones: WbsMilestone[];
  onOpen: (t: WbsTask) => void; onRefresh: () => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 mb-2 text-left">
        <ChevronDown size={16} className={`text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`} />
        <span className="text-sm font-bold text-foreground">{name}</span>
        <span className="text-[11px] text-muted-foreground">· {tasks.filter((t) => t.parentTaskId == null).length} tasks</span>
      </button>
      {open && <WbsTree projectId={projectId} milestones={milestones} tasks={tasks} onOpenTask={onOpen} onRefresh={onRefresh} />}
    </div>
  );
}

function ViewSwitch({ view, setView }: { view: View; setView: (v: View) => void }) {
  const opts: Array<{ v: View; icon: typeof Kanban; label: string }> = [
    { v: "tree", icon: ListTree, label: "Tree" },
    { v: "board", icon: Kanban, label: "Board" },
    { v: "kanban", icon: LayoutGrid, label: "Kanban" },
    { v: "table", icon: Table2, label: "Table" },
    { v: "timeline", icon: BarChart2, label: "Timeline" },
    { v: "calendar", icon: CalendarDays, label: "Calendar" },
  ];
  return (
    <div className="flex gap-1 p-1 rounded-xl bg-muted/60 border border-border">
      {opts.map((o) => {
        const Icon = o.icon;
        return (
          <button key={o.v} onClick={() => setView(o.v)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${view === o.v ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            <Icon size={14} /> {o.label}
          </button>
        );
      })}
    </div>
  );
}
