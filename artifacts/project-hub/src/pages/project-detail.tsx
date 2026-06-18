// Project detail — a tasks-and-subtasks mirror of the Projects table view.
// Same chrome as projects.tsx (glass filter bar, collapsible colour-coded
// status groups, Excel-style bordered tables with draggable column widths),
// but the rows are this project's top-level tasks, each expandable to show
// its subtasks indented beneath it.
// The previous full detail page is preserved at ./project-detail.legacy.tsx.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/extra-api";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "../lib/format";
import { Link, useRoute } from "wouter";
import {
  useGetProject, useListMilestones, useListTasks, useListUsers, useUpdateTask,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Check, ChevronDown, ChevronLeft, ChevronRight, Flag, GanttChartSquare,
  ListTree, Search, Table2, Zap, Milestone, MessageSquare, Users,
  GitBranch, X, Plus, LayoutDashboard, FileDown, Loader2, FolderOpen, Upload,
} from "lucide-react";
import { jsPDF } from "jspdf";
import { TASK_PRIORITIES, TASK_STATUSES } from "../lib/task-constants";
import { PersonCell, TimelineCell, projectCode, SCALE_PRESETS } from "./projects";
import { MondayGantt, type GanttGroup, type GanttItem } from "@/components/monday-gantt";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ExcelGroupTable, type ExcelCol } from "@/components/excel-group-table";
import { useUserStore } from "../lib/store";
import { CharterOverview } from "../components/charter-overview";
import { TaskCommsDrawer, type TaskCommsTarget } from "../components/TaskCommsDrawer";
import { ProjectCommsDrawer, type ProjectCommsTab } from "../components/ProjectCommsDrawer";
import { TeamTab } from "../components/team-tab";
import { DocumentsTab } from "../components/documents-tab";
import { TaskDetailModal } from "../components/task-detail-modal";
import type { AggTask } from "../lib/work-types";

// Structural subset of what useListTasks returns — the fields this table reads.
type TaskRow = {
  id: number;
  name: string;
  status: string;
  priority: string;
  milestoneId?: number | null;
  parentTaskId?: number | null;
  assigneeId?: number | null;
  assigneeName?: string | null;
  startDate?: string | null;
  endDate?: string | null;
};

// Monday-style task code — no dedicated column on pmo_tasks, derive from the PK.
const taskCode = (t: TaskRow) => `TSK-${String(t.id).padStart(4, "0")}`;

// Map any raw task status onto one of the five display statuses (same palette
// the rest of the app uses for task pills).
const STATUS_BY_VALUE = new Map(TASK_STATUSES.map((s) => [s.value, s]));
function taskStatusOf(raw: string) {
  return STATUS_BY_VALUE.get(raw as never) ?? TASK_STATUSES[0];
}
const PRIORITY_BY_VALUE = new Map(TASK_PRIORITIES.map((p) => [p.value, p]));

// Monday.com status/RAG palette for the Gantt bars — Green (done / on track),
// Amber (working on it / on hold), Red (stuck / delayed), Grey (not started).
const RAG_HEX = { green: "#00c875", amber: "#fdab3d", red: "#e2445c", grey: "#c4c4c4" } as const;
function taskRagColor(status: string): string {
  switch (status) {
    case "completed": return RAG_HEX.green;
    case "delayed": return RAG_HEX.red;
    case "in_progress":
    case "on_hold": return RAG_HEX.amber;
    default: return RAG_HEX.grey;
  }
}

// Fixed column widths (px) — same resizable-weights scheme as the Projects table.
const COLS: { key: string; header: string; width: number; align?: "left" | "center" }[] = [
  { key: "code", header: "Task Code", width: 110 },
  { key: "name", header: "Task Name", width: 300 },
  { key: "owner", header: "Assignee", width: 70, align: "center" },
  { key: "status", header: "Status", width: 120, align: "center" },
  { key: "priority", header: "Priority", width: 110, align: "center" },
  { key: "progress", header: "Progress", width: 100, align: "center" },
  { key: "subtasks", header: "Subtasks", width: 80, align: "center" },
  { key: "dependency", header: "Dependencies", width: 160 },
  { key: "timeline", header: "Timeline", width: 180 },
];

// Accent colours cycled across milestone groups (left border + header swatch).
const MS_COLORS = ["#6366F1", "#0EA5E9", "#10B981", "#F59E0B", "#EC4899", "#8B5CF6", "#14B8A6", "#F97316"];
const TOTAL_W = COLS.reduce((s, c) => s + c.width, 0);
// localStorage key for the user's adjusted column widths on this table.
const TASKS_COLW_KEY = "ph:project-tasks:colw";
const TASKS_COLORDER_KEY = "ph:project-tasks:colorder";

const PRIORITY_CHIPS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  ...TASK_PRIORITIES.map((p) => ({ value: p.value, label: p.label })),
];

// ── Gantt view — tasks (and indented subtasks) as bars on a pixel-based
//    timeline, coloured by task status. Mirrors the Projects-view Gantt: a
//    Day/Month scale toggle, Ctrl+scroll / pinch zoom, a "Today" marker, and a
//    progress-less duration tag on each bar. ───────────────────────────────────
const DAY_MS = 86_400_000;
const MON_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const msTime = (s?: string | null) => (s ? new Date(s.slice(0, 10)).getTime() : null);
function dayFloor(t: number) { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }

const CRITICAL_COLOR = "#DC2626"; // red — critical-path emphasis

// Task Gantt — the shared Monday-style chart fed the milestone-grouped tasks
// (with dependency arrows from each task's predecessors). Keeps the critical-
// path toggle alongside the zoom presets.
// Floating status dropdown — click cell to open, pick a status to save.
function StatusDropdown({ task, updateTask }: { task: TaskRow; updateTask: ReturnType<typeof useUpdateTask> }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const st = taskStatusOf(task.status);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative w-full h-full">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className="w-full h-full px-2 py-1 text-[10px] font-semibold cursor-pointer"
        style={{ color: st.color }}
      >
        {st.label}
      </button>
      {open && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 z-50 min-w-[120px] rounded-lg bg-white border border-gray-200 shadow-xl py-1 animate-in fade-in-0 zoom-in-95">
          {TASK_STATUSES.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={(e) => { e.stopPropagation(); setOpen(false); if (s.value !== task.status) updateTask.mutate({ id: task.id, data: { status: s.value } as never }); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs font-medium hover:bg-gray-50 transition-colors"
            >
              <span className="w-3 h-3 rounded-full shrink-0" style={{ background: s.bg }} />
              <span className="text-gray-700">{s.label}</span>
              {s.value === task.status && <Check size={12} className="ml-auto text-gray-500" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Inline progress editor — click to type, blur/Enter to save.
function ProgressInput({ task, updateTask }: { task: TaskRow; updateTask: ReturnType<typeof useUpdateTask> }) {
  const pp = (task as Record<string, unknown>).progressPct as number | undefined;
  const pct = task.status === "completed" ? 100 : Math.max(0, Math.min(100, pp ?? 0));
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(pct));

  function commit() {
    setEditing(false);
    const v = Math.max(0, Math.min(100, Number(val) || 0));
    if (v !== pct) updateTask.mutate({ id: task.id, data: { progressPct: v } as never });
  }

  if (editing) {
    return (
      <input
        autoFocus
        type="number"
        min={0}
        max={100}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
        onClick={(e) => e.stopPropagation()}
        className="w-14 text-center text-xs border border-input bg-background rounded px-1 py-0.5 outline-none focus:ring-2 focus:ring-ring/40"
      />
    );
  }

  const barColor = pct >= 100 ? "#10B981" : pct > 0 ? "#F59E0B" : "#E5E7EB";
  return (
    <span
      className="inline-flex items-center gap-1 cursor-pointer hover:opacity-80"
      onClick={(e) => { e.stopPropagation(); setVal(String(pct)); setEditing(true); }}
      title="Click to edit progress"
    >
      <span className="w-10 h-1.5 rounded-full bg-gray-200 overflow-hidden">
        <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: barColor }} />
      </span>
      <span className="text-[10px] font-semibold text-gray-600 tabular-nums">{pct}%</span>
    </span>
  );
}

// Inline dependency editor — pick this task's predecessors from the project's
// other tasks. Writes go through the same /tasks/:id/dependencies endpoints the
// Gantt drag-to-link uses, so adding/removing a predecessor here updates the
// task list AND the critical-path schedule (the Gantt "Critical Path" overlay
// recomputes immediately). Predecessor chips render with the task code.
function DependencyCell({ task, allTasks, onAdd, onRemove }: {
  task: TaskRow;
  allTasks: TaskRow[];
  onAdd: (predecessorId: number, successorId: number) => void;
  onRemove: (predecessorId: number, successorId: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const parseIds = (raw: unknown): number[] =>
    typeof raw === "string" ? (raw.match(/\d+/g)?.map(Number) ?? [])
      : Array.isArray(raw) ? (raw as unknown[]).map(Number) : [];
  const depIds = parseIds((task as Record<string, unknown>).predecessorIds);
  const byId = new Map(allTasks.map((t) => [t.id, t]));
  const depTasks = depIds.map((id) => byId.get(id)).filter(Boolean) as TaskRow[];

  // Candidates: every other task in the project that isn't already a
  // predecessor. The backend rejects self-links and cycles (409 → toast).
  const needle = q.trim().toLowerCase();
  const candidates = allTasks
    .filter((t) => t.id !== task.id && !depIds.includes(t.id))
    .filter((t) => !needle || `${t.name} ${taskCode(t)}`.toLowerCase().includes(needle));

  return (
    <div ref={ref} className="relative w-full h-full">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        title="Set predecessor dependencies — these drive the Gantt critical path"
        className="w-full h-full min-h-[26px] px-1.5 py-0.5 flex items-center gap-1 flex-wrap text-left"
      >
        {depTasks.length === 0 ? (
          <span className="text-[11px] text-gray-400 inline-flex items-center gap-1"><GitBranch size={11} /> Add</span>
        ) : (
          depTasks.map((d) => (
            <span key={d.id} className="inline-flex items-center gap-0.5 rounded bg-primary/10 text-primary text-[10px] font-medium px-1 py-0.5" title={d.name}>
              {taskCode(d)}
              <span
                role="button"
                title="Remove dependency"
                onClick={(e) => { e.stopPropagation(); onRemove(d.id, task.id); }}
                className="inline-flex hover:text-red-600"
              >
                <X size={10} />
              </span>
            </span>
          ))
        )}
      </button>
      {open && (
        <div
          className="absolute top-full left-0 mt-1 z-50 w-64 rounded-lg bg-white border border-gray-200 shadow-xl py-1 animate-in fade-in-0 zoom-in-95"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-2 pb-1">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Add predecessor…"
              className="w-full h-7 px-2 text-xs rounded border border-gray-200 outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="max-h-56 overflow-y-auto">
            {candidates.length === 0 && <div className="px-3 py-2 text-[11px] text-gray-400">No matching tasks</div>}
            {candidates.slice(0, 50).map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={(e) => { e.stopPropagation(); onAdd(c.id, task.id); setQ(""); setOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-gray-50 transition-colors"
              >
                <Plus size={11} className="shrink-0 text-gray-400" />
                <span className="font-mono text-[10px] text-gray-400 shrink-0">{taskCode(c)}</span>
                <span className="truncate text-gray-700">{c.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TaskGanttView({ groups, onOpen, onLink, showCritical, setShowCritical, criticalLoading }: {
  groups: GanttGroup[];
  onOpen?: (id: number) => void;
  onLink?: (predecessorId: number, successorId: number) => void;
  showCritical: boolean;
  setShowCritical: React.Dispatch<React.SetStateAction<boolean>>;
  criticalLoading: boolean;
}) {
  const critToggle = (
    <button
      type="button"
      onClick={() => setShowCritical((v) => !v)}
      title="Highlight the critical path (the dependency chain that drives the project's end date)"
      className={`px-2.5 h-6 rounded-md flex items-center gap-1 text-[11px] font-medium transition-colors ${showCritical ? "bg-red-500/10 text-red-600" : "bg-white border border-gray-200 text-gray-500 hover:bg-gray-100"}`}
    >
      <Zap size={12} className={showCritical ? "fill-current" : ""} />
      Critical Path
      {criticalLoading && showCritical && <span className="ml-0.5 w-3 h-3 rounded-full border-[1.5px] border-current border-t-transparent animate-spin" />}
    </button>
  );

  if (groups.length === 0) {
    return <div className="glass-surface rounded-2xl text-sm text-muted-foreground text-center py-10">No task start / end dates to chart.</div>;
  }

  return <MondayGantt groups={groups} onOpen={onOpen} onLink={onLink} showDeps labelWidth={300} labelHeader="Milestones" labelHeaderExpanded="Tasks" extraControls={critToggle} autoFitOnLoad defaultCollapsed />;
}

export default function ProjectDetail() {
  const [, params] = useRoute("/projects/:id");
  const projectId = Number(params?.id ?? 0);

  // Page section — Tasks (default) · Team. Deep-linkable via ?section=team so the
  // Projects-board "Team" column can jump straight here.
  const [section, setSection] = useState<"tasks" | "team">(
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("section") === "team" ? "team" : "tasks",
  );

  // Project Documents — surfaced as a header button (next to Generate Live
  // Charter) that opens this project's document repository in a modal. The
  // upload modal inside DocumentsTab is driven from here so the modal header
  // can carry its own "Upload Document" button.
  const [docsOpen, setDocsOpen] = useState(false);
  const [docsUploadOpen, setDocsUploadOpen] = useState(false);

  const { data: project, isLoading: loadingProject } = useGetProject(projectId);
  const { data: rawTasks, isLoading: loadingTasks, refetch: refetchTasks } = useListTasks(projectId);
  const { data: rawMilestones } = useListMilestones(projectId);
  const { data: users = [] } = useListUsers();
  // Refetch the task list after every task mutation — the generated useUpdateTask
  // hook invalidates nothing, so without this an inline status/progress edit would
  // PATCH the server but never refresh the grid (looked like "it didn't change").
  const updateTask = useUpdateTask({ mutation: { onSuccess: () => { void refetchTasks(); } } });

  const tasks = (rawTasks ?? []) as TaskRow[];

  // Clicking a task (row name or Gantt bar) opens the shared Jira-style detail modal.
  const [openTaskId, setOpenTaskId] = useState<number | null>(null);
  const openTask = openTaskId != null ? tasks.find((t) => t.id === openTaskId) ?? null : null;

  // Map a raw task → the AggTask shape TaskDetailModal consumes. Runtime fields
  // (progressPct, description, predecessorIds, hours, stage) live on the object
  // even though TaskRow doesn't type them, so read them off a cast.
  const msNameById = useMemo(() => {
    const m = new Map<number, string>();
    for (const ms of (rawMilestones ?? []) as Array<{ id: number; name: string }>) m.set(ms.id, ms.name);
    return m;
  }, [rawMilestones]);
  const toAgg = useCallback((t: TaskRow): AggTask => {
    const r = t as unknown as Record<string, unknown>;
    let preds: number[] = [];
    const rp = r.predecessorIds;
    if (Array.isArray(rp)) preds = rp as number[];
    else if (typeof rp === "string") { try { const p = JSON.parse(rp); if (Array.isArray(p)) preds = p; } catch { /* keep [] */ } }
    return {
      id: t.id, projectId, projectName: project?.name ?? "Project",
      milestoneId: t.milestoneId ?? null,
      milestoneName: t.milestoneId != null ? (msNameById.get(t.milestoneId) ?? null) : null,
      parentTaskId: t.parentTaskId ?? null, name: t.name,
      description: (r.description as string | null) ?? null,
      status: t.status, priority: t.priority, rag: (r.rag as string | null) ?? null,
      stage: (r.stage as string | null) ?? null, phase: null,
      assigneeId: t.assigneeId ?? null, assigneeName: t.assigneeName ?? null,
      startDate: t.startDate ?? null, endDate: t.endDate ?? null,
      progressPct: (r.progressPct as number) ?? 0,
      predecessorIds: preds,
      estimatedHours: (r.estimatedHours as number | null) ?? null,
      actualHours: (r.actualHours as number | null) ?? null,
      isCritical: (r.isCritical as boolean) ?? false, gate: null,
    };
  }, [projectId, project, msNameById]);

  const usersById = useMemo(() => {
    const m = new Map<number, string>();
    for (const u of users) m.set(u.id, u.name);
    return m;
  }, [users]);
  const assigneeName = (t: TaskRow) =>
    t.assigneeName ?? (t.assigneeId != null ? usersById.get(t.assigneeId) ?? null : null);

  // ── Per-task comments + attachments (right-side drawer). Backed by the
  //    project's messages; the count map drives the per-row badge, and the
  //    drawer shares the same query key so posting refreshes both.
  const currentUserId = useUserStore((s) => s.userId);
  const [commsTask, setCommsTask] = useState<TaskCommsTarget | null>(null);
  const { data: projectMessages = [] } = useQuery({
    queryKey: ["project-messages", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/messages`);
      if (!r.ok) return [] as { taskId?: number | null }[];
      return r.json() as Promise<{ taskId?: number | null }[]>;
    },
    enabled: projectId > 0,
  });
  const commsCount = useMemo(() => {
    const m = new Map<number, number>();
    for (const msg of projectMessages as { taskId?: number | null }[]) {
      if (msg.taskId == null) continue;
      m.set(msg.taskId, (m.get(msg.taskId) ?? 0) + 1);
    }
    return m;
  }, [projectMessages]);

  // ── Project-level communication + attachments (right-side drawer). Backed by
  //    project-scoped messages (taskId == null), opened from the header.
  const [commsDrawerTab, setCommsDrawerTab] = useState<ProjectCommsTab | null>(null);
  const projectMsgCount = useMemo(
    () => (projectMessages as { taskId?: number | null }[]).filter((m) => m.taskId == null).length,
    [projectMessages],
  );

  // View switcher — Table · Gantt. Defaults to Gantt so selecting a project
  // opens straight onto the milestone/task timeline (auto-fitted to span).
  const [view, setView] = useState<"overview" | "table" | "gantt">("gantt");

  // Critical-path overlay (Gantt only). Lazy + read-only: hit /schedule (pure
  // CPM, returns criticalTaskIds) rather than /critical-path, which persists
  // every task's isCritical flag row-by-row and is far slower to load.
  const [showCritical, setShowCritical] = useState(false);
  const { data: schedule, isFetching: criticalLoading } = useQuery({
    queryKey: [`/api/projects/${projectId}/schedule`],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/schedule`);
      if (!r.ok) throw new Error("Failed to load schedule");
      return r.json() as Promise<{ criticalTaskIds: number[] }>;
    },
    enabled: showCritical && projectId > 0,
    staleTime: 60_000,
  });
  const criticalIds = useMemo(
    () => new Set<number>(schedule?.criticalTaskIds ?? []),
    [schedule],
  );

  // Drag-to-link on the Gantt (Monday-style): dropping task A's connector onto
  // task B adds A as a predecessor of B. POST /tasks/:id/dependencies validates
  // same-project scope + rejects cycles (409 surfaced via toast). On success we
  // refresh the task list (new arrow) and the schedule (critical path recompute).
  const qc = useQueryClient();
  const { toast } = useToast();

  // ── Generate Live Charter (PDF) — built on demand from CURRENT data, so it
  //    always reflects the latest scope/background (from the charter) plus the
  //    live status + timeline (from the project, tasks and milestones).
  const [genBusy, setGenBusy] = useState(false);
  const generateLiveCharter = async () => {
    setGenBusy(true);
    try {
      const p = (project ?? {}) as Record<string, unknown>;
      const charterId = Number(p.charterId ?? 0);
      let ch: Record<string, unknown> = {};
      if (charterId > 0) { try { ch = await api.get<Record<string, unknown>>(`/api/charters/${charterId}`); } catch { /* no charter — narrative blank */ } }
      const cstr = (k: string) => { const v = ch[k]; return typeof v === "string" ? v.trim() : ""; };
      const cnum = (k: string) => { const v = ch[k]; return v != null && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : null; };
      const pnum = (k: string) => { const v = p[k]; return v != null && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : null; };
      const fmt = (d?: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");
      const money = (n: number | null) => (n != null ? formatCurrency(n) : "—");
      const cap = (s?: string) => (s ? s.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()) : "—");

      const tags = Array.isArray(ch.strategicAlignmentTags) ? (ch.strategicAlignmentTags as string[]) : [];
      const pcRef = tags.find((t) => t.startsWith("PC_ID:"))?.slice(6) ?? null;
      const displayTags = tags.filter((t) => !t.startsWith("PC_ID:"));
      const members = Array.isArray(ch.keyProjectMembers) ? (ch.keyProjectMembers as Array<{ name?: string }>) : [];
      const kpis = Array.isArray(ch.kpis) ? (ch.kpis as Array<{ kpi?: string; baseline?: string; goal?: string }>) : [];

      // ── AI summary — read the milestones + tasks and explain the project ───
      let aiSummary = "";
      try {
        const topT = tasks.filter((t) => t.parentTaskId == null);
        const msAll = (rawMilestones ?? []) as Array<{ id: number; name: string; status: string }>;
        const byMs = new Map<number, typeof topT>();
        for (const t of topT) { if (t.milestoneId == null) continue; const a = byMs.get(t.milestoneId) ?? []; a.push(t); byMs.set(t.milestoneId, a); }
        const lines: string[] = [`Project: ${(p.name as string) ?? "Project"}`];
        if (typeof p.status === "string") lines.push(`Status: ${cap(p.status as string)}`);
        if (typeof p.description === "string" && (p.description as string).trim()) lines.push(`Description: ${p.description as string}`);
        if (msAll.length) {
          lines.push("Milestones and their tasks:");
          for (const m of msAll) {
            const ns = byMs.get(m.id)?.map((t) => t.name).filter(Boolean).slice(0, 15) ?? [];
            lines.push(`- ${m.name} [${cap(m.status)}]: ${ns.join("; ") || "no tasks"}`);
          }
        } else if (topT.length) {
          lines.push(`Tasks: ${topT.map((t) => t.name).filter(Boolean).slice(0, 40).join("; ")}`);
        }
        if (topT.length || msAll.length) {
          const r = await api.post<{ rewritten?: string }>("/api/ai/improve-text", {
            text: lines.join("\n"),
            instruction: "The text lists a project's milestones and the tasks under each. Write a clear, plain-English overview (6–10 sentences) explaining what this project is about, its objectives and scope, and how the work is organised across the milestones. Synthesise — do not just restate the list. Do not invent specifics that aren't implied by the tasks.",
            maxWords: 230,
          });
          aiSummary = (r.rewritten ?? "").trim();
        }
      } catch { /* AI optional — PDF still generates without the summary */ }

      // ── PDF document (pure text layout) ────────────────────────────────────
      const doc = new jsPDF({ unit: "pt", format: "a4" });
      const M = 48;
      const W = doc.internal.pageSize.getWidth();
      const H = doc.internal.pageSize.getHeight();
      let y = M;
      const ensure = (h: number) => { if (y + h > H - M) { doc.addPage(); y = M; } };
      const heading = (t: string) => { ensure(34); y += 6; doc.setFont("helvetica", "bold"); doc.setFontSize(12.5); doc.setTextColor(17); doc.text(t, M, y); y += 6; doc.setDrawColor(210); doc.setLineWidth(0.8); doc.line(M, y, W - M, y); y += 15; };
      const para = (t: string) => {
        if (!t || !t.trim()) { ensure(14); doc.setFont("helvetica", "italic"); doc.setFontSize(9.5); doc.setTextColor(150); doc.text("Not specified.", M, y); y += 20; return; }
        doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(45);
        for (const ln of doc.splitTextToSize(t, W - M * 2) as string[]) { ensure(14); doc.text(ln, M, y); y += 14; }
        y += 8;
      };
      const kv = (label: string, value: string) => {
        const vx = M + 150;
        doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); doc.setTextColor(75);
        const vlines = doc.splitTextToSize(value || "—", W - M - vx) as string[];
        ensure(Math.max(15, vlines.length * 13));
        doc.text(label, M, y);
        doc.setFont("helvetica", "normal"); doc.setTextColor(31);
        doc.text(vlines, vx, y);
        y += Math.max(15, vlines.length * 13);
      };
      const bullet = (t: string) => {
        doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(45);
        const x = M + 12;
        const lines = doc.splitTextToSize(t, W - M - x) as string[];
        ensure(lines.length * 13 + 2);
        doc.text("•", M + 2, y); doc.text(lines, x, y); y += lines.length * 13 + 2;
      };

      // Title
      doc.setFont("helvetica", "bold"); doc.setFontSize(19); doc.setTextColor(10);
      doc.text(`${(p.name as string) ?? "Project"} — Project Charter`, M, y); y += 18;
      doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(120);
      doc.text([pcRef ? `Ref ${pcRef}` : null, `Status: ${cap(p.status as string)}`, `Generated ${new Date().toLocaleString("en-GB")}`].filter(Boolean).join("    ·    "), M, y); y += 6;

      // ── Project Information (filled from the charter AND the project) ──────
      const pstr = (k: string) => { const v = p[k]; return typeof v === "string" ? v.trim() : ""; };
      const ownerName = Number(p.projectOwnerId ?? 0) ? (usersById.get(Number(p.projectOwnerId)) ?? "") : "";
      heading("Project Information");
      kv("Project", cstr("title") || (p.name as string) || "—");
      kv("Status", cap(p.status as string));
      kv("Progress", `${pnum("progress") ?? 0}%`);
      kv("Sponsor", cstr("projectSponsor") || "—");
      kv("Project Manager", cstr("pmName") || (Number(p.projectManagerId ?? 0) ? (usersById.get(Number(p.projectManagerId)) ?? "—") : "—"));
      if (ownerName) kv("Project Owner", ownerName);
      kv("Category", cstr("category") || pstr("category") || "—");
      kv("Department / Function", cstr("department") || pstr("function") || "—");
      if (pstr("stage")) kv("Lifecycle Stage", cap(pstr("stage")));
      if (pstr("strategicTheme")) kv("Strategic Theme", pstr("strategicTheme"));
      if (pstr("siteRegion")) kv("Site / Region", pstr("siteRegion"));
      if (cstr("entity")) kv("Entity", cstr("entity"));
      kv("Priority", cap(p.priority as string));
      kv("Timeline", `${fmt(cstr("startDate") || pstr("startDate"))}   to   ${fmt(cstr("endDate") || pstr("endDate"))}`);
      if (cstr("internalOrderNumber")) kv("Internal Order No.", cstr("internalOrderNumber"));
      if (cstr("projectApprovalDate")) kv("Approval Date", fmt(cstr("projectApprovalDate")));
      if (cstr("lastRevisionDate")) kv("Last Revision", fmt(cstr("lastRevisionDate")));

      // ── AI summary (synthesised from milestones & tasks) ───────────────────
      if (aiSummary) { heading("Summary"); para(aiSummary); }

      // ── Narrative — the conventional charter sections (only those with content)
      const sec = (title: string, body: string) => { if (body && body.trim()) { heading(title); para(body); } };
      sec("Project Description", typeof p.description === "string" ? (p.description as string) : "");
      sec("Executive Summary", cstr("executiveSummary"));
      sec("Purpose / Business Justification", cstr("description"));
      sec("Background", cstr("background"));
      sec("Current State", cstr("currentState"));
      sec("Business Drivers", cstr("businessDrivers"));
      sec("In Scope", cstr("scope"));
      sec("Out of Scope", cstr("outOfScope"));
      sec("Scope Limitations", cstr("scopeLimitations"));
      sec("Deliverables", cstr("deliverables"));
      sec("Business Outcome / Benefits", cstr("businessOutcome"));

      const benefits = ([
        ["Top-line improvement", cstr("toplineImprovement")],
        ["Bottom-line optimisation", cstr("bottomLineOptimization")],
        ["Compliance benefits", cstr("complianceBenefits")],
        ["Productivity improvement", cstr("productivityImprovement")],
      ] as Array<[string, string]>).filter(([, v]) => v);
      if (benefits.length) { heading("Benefits"); for (const [l, v] of benefits) bullet(`${l}: ${v}`); }

      sec("Solution Comparison", cstr("solutionComparison"));
      sec("Assumptions", cstr("assumptions"));
      sec("Constraints", cstr("constraints"));
      sec("Risks", cstr("risks"));

      // ── Current Status + Timeline (live, from the project's tasks/milestones)
      {
        const topT = tasks.filter((t) => t.parentTaskId == null);
        const tcnt = (s: string) => topT.filter((t) => t.status === s).length;
        const tt = topT.length, td = tcnt("completed"), ti = tcnt("in_progress"), tdl = tcnt("delayed"), th = tcnt("on_hold");
        const tn = Math.max(0, tt - td - ti - tdl - th);
        const tpc = tt ? Math.round((td / tt) * 100) : (pnum("progress") ?? 0);
        const pms = (rawMilestones ?? []) as Array<{ name: string; dueDate?: string | null; status: string }>;
        const nowT = Date.now();
        const mDone = pms.filter((m) => m.status === "completed").length;
        const mOver = pms.filter((m) => m.status !== "completed" && m.dueDate && new Date(m.dueDate).getTime() < nowT).length;

        heading("Current Status");
        kv("Overall status", cap(p.status as string));
        kv("Progress", `${tpc}%   (${td}/${tt} top-level tasks complete)`);
        kv("Task breakdown", `${td} completed · ${ti} in progress · ${tdl} delayed · ${th} on hold · ${tn} not started`);
        if (pms.length) kv("Milestones", `${mDone}/${pms.length} complete${mOver ? ` · ${mOver} overdue` : ""}`);

        heading("Timeline");
        kv("Planned dates", `${fmt(cstr("startDate") || pstr("startDate"))}   to   ${fmt(cstr("endDate") || pstr("endDate"))}`);
        for (const m of pms) {
          const overdue = m.status !== "completed" && m.dueDate && new Date(m.dueDate).getTime() < nowT;
          bullet(`${m.name} — ${fmt(m.dueDate)} (${cap(m.status)})${overdue ? "  · OVERDUE" : ""}`);
        }
      }

      if (kpis.length) { heading("Success Criteria / KPIs"); for (const k of kpis.filter((k) => k.kpi?.trim())) bullet(`${k.kpi}${(k.baseline || k.goal) ? ` — ${k.baseline || "?"} → ${k.goal || "?"}` : ""}`); }

      // ── High-Level Milestones (the charter's own planned milestones) ───────
      {
        const cms = Array.isArray(ch.milestones) ? (ch.milestones as Array<{ milestone?: string; responsible?: string; targetDate?: string; status?: string }>) : [];
        const named = cms.filter((m) => m.milestone?.trim());
        if (named.length) {
          heading("High-Level Milestones");
          for (const m of named) bullet(`${m.milestone}${m.targetDate ? ` — ${fmt(m.targetDate)}` : ""}${m.responsible ? ` · ${m.responsible}` : ""}${m.status ? ` (${cap(m.status)})` : ""}`);
        }
      }

      // ── Budget & Investment ────────────────────────────────────────────────
      {
        const rows: Array<[string, string]> = [];
        const tentative = cnum("tentativeBudget"); if (tentative != null && tentative > 0) rows.push(["Tentative / Approved Budget", money(tentative)]);
        const capex = pnum("capexBudget") ?? cnum("capexAmount"); if (capex != null && capex > 0) rows.push(["CapEx", money(capex)]);
        const opex = pnum("opexBudget") ?? cnum("opexAmount"); if (opex != null && opex > 0) rows.push(["OpEx", money(opex)]);
        if (cnum("finalNegotiatedBudget") != null) rows.push(["Final Negotiated Budget", money(cnum("finalNegotiatedBudget"))]);
        if (cnum("leAmount") != null) rows.push(["Latest Estimate (LE)", money(cnum("leAmount"))]);
        if (cnum("potentialAdditionalBudget") != null) rows.push(["Potential Additional Budget", money(cnum("potentialAdditionalBudget"))]);
        if (cnum("roiPerAnnum") != null) rows.push(["ROI / annum", money(cnum("roiPerAnnum"))]);
        if (cnum("paybackMonths") != null) rows.push(["Payback", `${cnum("paybackMonths")} months`]);
        if (cnum("nfaThreshold") != null) rows.push(["NFA Threshold", money(cnum("nfaThreshold"))]);
        if (rows.length) { heading("Budget & Investment"); for (const [l, v] of rows) kv(l, v); }
      }

      // ── Stakeholders ───────────────────────────────────────────────────────
      heading("Stakeholders");
      kv("Sponsor", cstr("projectSponsor") || "—");
      kv("Project Manager", cstr("pmName") || (Number(p.projectManagerId ?? 0) ? (usersById.get(Number(p.projectManagerId)) ?? "—") : "—"));
      if (members.length) kv("Key Members", members.filter((m) => m.name?.trim()).map((m) => m.name).join(", ") || "—");

      if (displayTags.length) { heading("Strategic Alignment"); bullet(displayTags.join(", ")); }

      // ── Approvals & Sign-off (from available sponsor / PM / approval date) ──
      heading("Approvals & Sign-off");
      kv("Project Sponsor", cstr("projectSponsor") || "—");
      kv("Project Manager", cstr("pmName") || (Number(p.projectManagerId ?? 0) ? (usersById.get(Number(p.projectManagerId)) ?? "—") : "—"));
      if (ownerName) kv("Project Owner", ownerName);
      kv("Approval Date", cstr("projectApprovalDate") ? fmt(cstr("projectApprovalDate")) : "—");
      y += 6;
      ensure(46);
      doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(45);
      doc.text("Sponsor: ______________________________      Date: ______________", M, y); y += 24;
      doc.text("Project Manager: ______________________      Date: ______________", M, y); y += 16;

      // ── Document Control (reference / revision / generated) ────────────────
      heading("Document Control");
      if (pcRef) kv("Charter Reference", pcRef);
      kv("Project Status", cap(p.status as string));
      if (cstr("revision")) kv("Revision", cstr("revision"));
      if (cstr("lastRevisionDate")) kv("Last Revision", fmt(cstr("lastRevisionDate")));
      kv("Generated", new Date().toLocaleString("en-GB"));

      // Footer page numbers
      const pageCount = doc.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i); doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(150);
        doc.text(`${(p.name as string) ?? "Project"} · Live Charter`, M, H - 24);
        doc.text(`Page ${i} of ${pageCount}`, W - M, H - 24, { align: "right" });
      }

      const safe = `${(p.name as string) ?? "project"} - Live Charter`.replace(/[^\w.\- ]/g, "").trim();
      doc.save(`${safe || "Live Charter"}.pdf`);
      toast({ title: "Live Charter generated" });
    } catch (e) {
      toast({ title: (e as Error)?.message || "Could not generate charter", variant: "destructive" });
    } finally {
      setGenBusy(false);
    }
  };

  const linkTasks = async (predecessorId: number, successorId: number) => {
    try {
      await api.post(`/api/tasks/${successorId}/dependencies`, { predecessorId });
      await Promise.all([
        qc.invalidateQueries({ queryKey: [`/api/projects/${projectId}/tasks`] }),
        qc.invalidateQueries({ queryKey: [`/api/projects/${projectId}/schedule`] }),
      ]);
      toast({ title: "Dependency linked" });
    } catch (e) {
      toast({ title: (e as Error)?.message || "Couldn't link tasks", variant: "destructive" });
    }
  };
  const unlinkTasks = async (predecessorId: number, successorId: number) => {
    try {
      await api.del(`/api/tasks/${successorId}/dependencies/${predecessorId}`);
      await Promise.all([
        qc.invalidateQueries({ queryKey: [`/api/projects/${projectId}/tasks`] }),
        qc.invalidateQueries({ queryKey: [`/api/projects/${projectId}/schedule`] }),
      ]);
      toast({ title: "Dependency removed" });
    } catch (e) {
      toast({ title: (e as Error)?.message || "Couldn't remove dependency", variant: "destructive" });
    }
  };

  // ── Filters (search · milestone · priority). Milestone replaces the old
  //    status filter — the project view is now organised by milestone.
  const [search, setSearch] = useState("");
  const [milestone, setMilestone] = useState("");
  const [priority, setPriority] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [prioOpen, setPrioOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement | null>(null);
  const prioRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setFilterOpen(false);
      if (prioRef.current && !prioRef.current.contains(e.target as Node)) setPrioOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // ── Parent → subtasks index (a row passes the filters if it matches OR any
  //    of its subtasks does, so searching a subtask never hides its parent).
  const subtasksByParent = useMemo(() => {
    const m = new Map<number, TaskRow[]>();
    for (const t of tasks) {
      if (t.parentTaskId == null) continue;
      const arr = m.get(t.parentTaskId) ?? [];
      arr.push(t);
      m.set(t.parentTaskId, arr);
    }
    return m;
  }, [tasks]);

  const taskIds = useMemo(() => new Set(tasks.map((t) => t.id)), [tasks]);

  const matches = (t: TaskRow) => {
    const q = search.trim().toLowerCase();
    if (milestone) {
      const key = t.milestoneId != null ? String(t.milestoneId) : "__none__";
      if (key !== milestone) return false;
    }
    if (priority && t.priority !== priority) return false;
    if (q && !`${t.name} ${taskCode(t)}`.toLowerCase().includes(q)) return false;
    return true;
  };

  // Milestone filter options — All · each milestone · No Milestone.
  const MILESTONE_CHIPS = useMemo(() => {
    const opts = [{ value: "", label: "All" }];
    for (const ms of (rawMilestones ?? []) as Array<{ id: number; name: string }>) {
      opts.push({ value: String(ms.id), label: ms.name });
    }
    opts.push({ value: "__none__", label: "No Milestone" });
    return opts;
  }, [rawMilestones]);

  // Top-level rows: tasks without a parent, plus orphaned subtasks whose parent
  // isn't in this project's list (so nothing silently disappears).
  const topLevel = useMemo(
    () => tasks.filter((t) => t.parentTaskId == null || !taskIds.has(t.parentTaskId)),
    [tasks, taskIds],
  );

  const filtered = useMemo(
    () => topLevel.filter((t) => matches(t) || (subtasksByParent.get(t.id) ?? []).some(matches)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [topLevel, subtasksByParent, search, milestone, priority],
  );

  // ── Group the rows by MILESTONE, ordered by the project's milestone list,
  //    with anything unassigned in a trailing "No Milestone" group. Empty
  //    groups are dropped. Each task keeps its own status (shown per row).
  const groups = useMemo(() => {
    const byKey = new Map<string, TaskRow[]>();
    for (const t of filtered) {
      const key = t.milestoneId != null ? String(t.milestoneId) : "__none__";
      const arr = byKey.get(key) ?? [];
      arr.push(t);
      byKey.set(key, arr);
    }
    const ordered: { key: string; label: string; color: string; rows: TaskRow[] }[] = [];
    let i = 0;
    for (const ms of (rawMilestones ?? []) as Array<{ id: number; name: string }>) {
      const rows = byKey.get(String(ms.id));
      if (rows && rows.length > 0) {
        ordered.push({ key: String(ms.id), label: ms.name, color: MS_COLORS[i % MS_COLORS.length]!, rows });
        i++;
      }
    }
    const none = byKey.get("__none__");
    if (none && none.length > 0) {
      ordered.push({ key: "__none__", label: "No Milestone", color: "#94A3B8", rows: none });
    }
    return ordered;
  }, [filtered, rawMilestones]);

  // Gantt data — the milestone groups mapped to the shared MondayGantt model.
  // Each task becomes a bar (parent at depth 0, subtasks indented at depth 1);
  // bar colour = the task's status colour, with dependency arrows driven by
  // each task's predecessorIds. Critical-path mode recolours the chain red.
  const ganttGroups: GanttGroup[] = useMemo(() => {
    const parseIds = (raw: unknown): number[] =>
      typeof raw === "string" ? (raw.match(/\d+/g)?.map(Number) ?? [])
        : Array.isArray(raw) ? (raw as unknown[]).map(Number) : [];
    const mk = (task: TaskRow, depth: number): GanttItem => {
      const pp = (task as Record<string, unknown>).progressPct as number | undefined;
      const progress = task.status === "completed" ? 100 : Math.max(0, Math.min(100, pp ?? 0));
      const crit = criticalIds.has(task.id);
      return {
        id: task.id,
        name: task.name,
        code: taskCode(task),
        start: task.startDate,
        end: task.endDate,
        progress,
        depth,
        // Monday-style critical path: critical tasks turn red and their
        // connecting arrows are drawn red (handled in MondayGantt). Non-critical
        // tasks keep their normal status colour — Monday does NOT dim them.
        color: showCritical && crit ? "#e2445c" : taskRagColor(task.status),
        emphasise: showCritical && crit,
        predecessorIds: parseIds((task as Record<string, unknown>).predecessorIds),
      };
    };
    return groups
      .map((g) => {
        const items: GanttItem[] = [];
        for (const t of g.rows) {
          items.push(mk(t, 0));
          const subs = (subtasksByParent.get(t.id) ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
          for (const s of subs) items.push(mk(s, 1));
        }
        return { key: g.key, label: g.label, color: g.color, items };
      })
      .filter((g) => g.items.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, subtasksByParent, criticalIds, showCritical]);

  // Collapsible status sections — default: all expanded.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggleGroup = (key: string) => setCollapsed((c) => ({ ...c, [key]: !c[key] }));

  // Per-task subtask expansion — default: expanded (subtasks visible).
  const [closedTasks, setClosedTasks] = useState<Record<number, boolean>>({});
  const toggleTask = (id: number) => setClosedTasks((c) => ({ ...c, [id]: !c[id] }));

  // Column order + widths are owned per-table by each <ExcelGroupTable> instance
  // (keyed by milestone group), so reordering / resizing one milestone's table
  // never affects the others.

  const subtaskCount = filtered.reduce((s, t) => s + (subtasksByParent.get(t.id)?.length ?? 0), 0);

  // One <tr> — shared by parent tasks and (indented) subtasks.
  const TaskTr = ({ t, depth, cols }: { t: TaskRow; depth: number; cols: ExcelCol[] }) => {
    const subs = subtasksByParent.get(t.id) ?? [];
    const st = taskStatusOf(t.status);
    const pr = PRIORITY_BY_VALUE.get(t.priority as never);
    const open = !closedTasks[t.id];
    // One <td> per column key — rendered in the current (drag-reorderable) order.
    const cell = (key: string) => {
      switch (key) {
        case "code":
          return (
            <td key="code" className="border border-gray-200 px-2 py-0.5 font-mono text-[11px] font-semibold text-gray-800 whitespace-nowrap">
              <span className="flex items-center gap-1.5" style={{ paddingLeft: depth * 14 }}>
                <span className={depth > 0 ? "text-gray-500" : ""}>{taskCode(t)}</span>
              </span>
            </td>
          );
        case "name":
          return (
            <td key="name" className="border border-gray-200 px-2 py-0.5 font-medium text-gray-800">
              <span className="flex items-center gap-1 min-w-0" style={{ paddingLeft: depth * 14 }}>
                {subs.length > 0 ? (
                  <ChevronDown size={12} className={`shrink-0 text-gray-400 transition-transform ${open ? "" : "-rotate-90"}`} />
                ) : depth > 0 ? (
                  <ChevronRight size={12} className="shrink-0 text-gray-300" />
                ) : (
                  <span className="w-3 shrink-0" />
                )}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setOpenTaskId(t.id); }}
                  className={`truncate text-left hover:text-primary hover:underline ${depth > 0 ? "font-normal text-gray-700" : ""}`}
                  title={t.name}
                >{t.name}</button>
              </span>
            </td>
          );
        case "owner":
          return <td key="owner" className="border border-gray-200 px-2 py-0.5 text-center"><PersonCell name={assigneeName(t)} /></td>;
        case "status":
          return (
            <td key="status" className="border border-gray-200 px-0 py-0 text-center whitespace-nowrap relative" style={{ background: st.bg, color: st.color }}>
              <StatusDropdown task={t} updateTask={updateTask} />
            </td>
          );
        case "priority":
          return (
            <td key="priority" className="border border-gray-200 px-2 py-0.5 text-center text-[10px] font-semibold whitespace-nowrap" style={pr ? { background: pr.bg, color: pr.color } : undefined}>
              {pr ? pr.label : <span className="text-[11px] text-gray-400">—</span>}
            </td>
          );
        case "progress":
          return <td key="progress" className="border border-gray-200 px-2 py-0.5 text-center"><ProgressInput task={t} updateTask={updateTask} /></td>;
        case "subtasks":
          return (
            <td key="subtasks" className="border border-gray-200 px-2 py-0.5 text-center font-semibold tabular-nums text-gray-800">
              {depth === 0 ? subs.length : <span className="text-gray-400 font-normal">—</span>}
            </td>
          );
        case "dependency":
          return (
            <td key="dependency" className="border border-gray-200 px-0 py-0 align-middle relative">
              <DependencyCell task={t} allTasks={tasks} onAdd={linkTasks} onRemove={unlinkTasks} />
            </td>
          );
        case "timeline":
          return <td key="timeline" className="border border-gray-200 px-2 py-0.5 whitespace-nowrap"><TimelineCell start={t.startDate} end={t.endDate} /></td>;
        default:
          return <td key={key} className="border border-gray-200 px-2 py-0.5" />;
      }
    };
    return (
      <>
        <tr
          className={`transition-colors ${depth > 0 ? "bg-gray-50/70 hover:bg-gray-100/70" : "bg-white hover:bg-gray-50"} ${subs.length > 0 ? "cursor-pointer" : ""}`}
          onClick={() => subs.length > 0 && toggleTask(t.id)}
        >
          {cols.map((c) => cell(c.key))}
        </tr>
        {open && subs.map((s) => <TaskTr key={s.id} t={s} depth={depth + 1} cols={cols} />)}
      </>
    );
  };

  const isLoading = loadingProject || loadingTasks;

  return (
    <div className="space-y-2">
      {/* Header — back to Projects + project identity */}
      <div className="flex items-center justify-between gap-3 flex-wrap ph-rise">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/projects">
            <button
              type="button"
              title="Back to Projects"
              className="w-8 h-8 rounded-lg border border-border bg-card/70 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
            >
              <ChevronLeft size={16} />
            </button>
          </Link>
          <div className="min-w-0">
            <div className="font-mono text-[11px] text-muted-foreground">{project ? projectCode(project as { id: number; jiraKey?: string | null }) : ""}</div>
            <h2 className="text-xl font-bold text-foreground truncate">{project?.name ?? (loadingProject ? "…" : "Project")}</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              {section === "team" ? "Team & RACI" : "Milestones, tasks & subtasks"}
              {section === "tasks" && !isLoading && <> · {ganttGroups.length} milestone{ganttGroups.length === 1 ? "" : "s"} · {filtered.length} task{filtered.length === 1 ? "" : "s"}{subtaskCount > 0 && <> · {subtaskCount} subtask{subtaskCount === 1 ? "" : "s"}</>}</>}
            </p>
          </div>
        </div>

        {/* Section switcher — Tasks · Team */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Project Documents — opens this project's document repository
              (versioning, stages, access controls) in a modal. */}
          <button
            type="button"
            onClick={() => setDocsOpen(true)}
            title="View this project's documents — organised by lifecycle stage, with versioning and access controls"
            className="h-9 px-3 rounded-xl flex items-center gap-1.5 text-[12px] font-semibold glass-surface lift-card text-primary hover:bg-primary/10 transition-colors"
          >
            <FolderOpen size={14} />
            Documents
          </button>

          {/* Generate Live Charter — fresh PDF (scope · out-of-scope · background ·
              current status · timeline) built from the latest project data. */}
          <button
            type="button"
            onClick={() => void generateLiveCharter()}
            disabled={genBusy}
            title="Generate a live PDF charter (In Scope · Out of Scope · Background · Current Status · Timeline) from the latest data"
            className="h-9 px-3 rounded-xl flex items-center gap-1.5 text-[12px] font-semibold border border-border bg-card/70 text-foreground hover:bg-accent disabled:opacity-50 transition-colors"
          >
            {genBusy ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
            Generate Live Charter
          </button>

          <div className="flex items-center gap-0.5 glass-surface lift-card rounded-xl p-1">
            {([
              { key: "tasks", label: "Tasks", Icon: ListTree },
              { key: "team", label: "Team", Icon: Users },
            ] as const).map(({ key, label, Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setSection(key)}
                className={`h-7 px-3 rounded-lg flex items-center gap-1.5 text-[12px] font-semibold transition-colors ${
                  section === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent"
                }`}
              >
                <Icon size={13} />
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {section === "team" && <TeamTab projectId={projectId} />}

      {section === "tasks" && (<>
      {/* ── Filter bar — same glass strip as the Projects view ────────────── */}
      <div className="glass-surface lift-card ph-rise rounded-xl px-2 py-1.5 flex flex-wrap items-center gap-0.5 gap-y-1 w-fit max-w-full relative z-50">
        <div className="relative w-[72px]">
          <Search size={10} className="absolute left-1 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-4 pr-0 h-5 text-[10px] border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
          />
        </div>

        {/* View switcher — Overview · Table · Gantt */}
        <div className="flex items-center gap-0.5 mr-0.5 pr-0.5 border-r border-border/60">
          {([
            { key: "overview", label: "Overview", Icon: LayoutDashboard },
            { key: "table", label: "Table", Icon: Table2 },
            { key: "gantt", label: "Gantt", Icon: GanttChartSquare },
          ] as const).map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              title={`${label} view`}
              className={`h-6 px-1.5 rounded-md flex items-center gap-1 text-[11px] font-medium transition-colors ${
                view === key ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-accent"
              }`}
            >
              <Icon size={13} />
              {label}
            </button>
          ))}
        </div>

        {/* Milestone filter (replaces the old status filter) */}
        <div className="relative" ref={filterRef}>
          <button
            type="button"
            onClick={() => { setFilterOpen((o) => !o); setPrioOpen(false); }}
            title="Filter by milestone"
            className={`h-6 px-1.5 rounded-md flex items-center gap-1 text-[11px] font-medium transition-colors ${
              milestone ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-accent"
            }`}
          >
            <Milestone size={13} /> Milestones
          </button>
          {filterOpen && (
            <div className="absolute left-0 top-full mt-1.5 z-50 w-52 max-h-72 overflow-y-auto rounded-md py-1 bg-popover text-popover-foreground border border-popover-border shadow-lg">
              <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Milestone</div>
              {MILESTONE_CHIPS.map((c) => (
                <button
                  key={c.value || "all"}
                  onClick={() => { setMilestone(c.value); setFilterOpen(false); }}
                  className={`w-full flex items-center justify-between px-3 py-1.5 text-sm text-left transition-colors ${milestone === c.value ? "bg-accent text-primary" : "hover:bg-accent/60"}`}
                >
                  <span className="truncate">{c.label}</span>
                  {milestone === c.value && <Check size={13} className="shrink-0" />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Priority filter */}
        <div className="relative" ref={prioRef}>
          <button
            type="button"
            onClick={() => { setPrioOpen((o) => !o); setFilterOpen(false); }}
            title="Filter by priority"
            className={`h-6 px-1.5 rounded-md flex items-center gap-1 text-[11px] font-medium transition-colors ${
              priority ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-accent"
            }`}
          >
            <Flag size={13} /> Priority
          </button>
          {prioOpen && (
            <div className="absolute left-0 top-full mt-1.5 z-50 w-44 rounded-md py-1 bg-popover text-popover-foreground border border-popover-border shadow-lg">
              <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Priority</div>
              {PRIORITY_CHIPS.map((c) => (
                <button
                  key={c.value || "all"}
                  onClick={() => { setPriority(c.value); setPrioOpen(false); }}
                  className={`w-full flex items-center justify-between px-3 py-1.5 text-sm text-left transition-colors ${priority === c.value ? "bg-accent text-primary" : "hover:bg-accent/60"}`}
                >
                  {c.label}
                  {priority === c.value && <Check size={13} />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── One Excel-style table per task status, Projects-view style ─────── */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      ) : view === "overview" ? (
        <CharterOverview
          project={project as unknown as Record<string, unknown>}
          projectName={(project as { name?: string } | undefined)?.name}
          pmName={(() => { const id = Number((project as { projectManagerId?: number } | undefined)?.projectManagerId ?? 0); return id ? (usersById.get(id) ?? null) : null; })()}
          ownerName={(() => { const id = Number((project as { projectOwnerId?: number } | undefined)?.projectOwnerId ?? 0); return id ? (usersById.get(id) ?? null) : null; })()}
          tasks={tasks as unknown as Array<{ name?: string; status: string; parentTaskId?: number | null; milestoneId?: number | null }>}
          milestones={(rawMilestones ?? []) as unknown as Array<{ id: number; name: string; dueDate?: string | null; status: string }>}
        />
      ) : groups.length > 0 ? (
        view === "gantt" ? (
          <TaskGanttView groups={ganttGroups} onOpen={(id) => setOpenTaskId(id)} onLink={linkTasks} showCritical={showCritical} setShowCritical={setShowCritical} criticalLoading={criticalLoading} />
        ) : (
        <div className="space-y-3">
          {groups.map((group) => {
            const open = !collapsed[group.key];
            return (
              <div key={group.key}>
                {/* Milestone dropdown header — click to expand/collapse the table */}
                <button
                  type="button"
                  onClick={() => toggleGroup(group.key)}
                  className="flex items-center gap-2 mb-2 px-0.5 w-full text-left group/header"
                >
                  <ChevronDown size={15} className={`text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`} />
                  <Milestone size={14} className="shrink-0" style={{ color: group.color }} />
                  <h3 className="text-sm font-semibold text-foreground">{group.label}</h3>
                  <span className="text-xs text-muted-foreground">({group.rows.length} task{group.rows.length === 1 ? "" : "s"})</span>
                </button>

                {open && (
                  <ExcelGroupTable cols={COLS} accent={group.color} storageKey={`ph:project-tasks:tbl:${group.key}`}>
                    {(cols) => (
                      <tbody>
                        {group.rows.map((t) => <TaskTr key={t.id} t={t} depth={0} cols={cols} />)}
                      </tbody>
                    )}
                  </ExcelGroupTable>
                )}
              </div>
            );
          })}
        </div>
        )
      ) : (
        // Empty state — same glass surface language as the Projects view.
        <div className="glass-surface ph-rise rounded-2xl flex flex-col items-center text-center px-8 py-14">
          <div className="w-14 h-14 rounded-2xl border border-primary/30 bg-card/60 flex items-center justify-center shadow-sm mb-4">
            <ListTree size={24} className="text-primary" />
          </div>
          <h3 className="text-lg font-semibold text-foreground">
            {tasks.length > 0 ? "No tasks match these filters" : "No tasks yet"}
          </h3>
          <p className="mt-1.5 max-w-md text-sm text-muted-foreground leading-relaxed">
            {tasks.length > 0
              ? "Try clearing the search or switching the milestone / priority filters."
              : "Tasks and subtasks added to this project will appear here, grouped by milestone."}
          </p>
        </div>
      )}
      </>)}

      <TaskCommsDrawer
        projectId={projectId}
        task={commsTask}
        onClose={() => setCommsTask(null)}
        senderId={currentUserId}
        resolveName={(id) => usersById.get(id) ?? `User ${id}`}
      />

      <ProjectCommsDrawer
        projectId={projectId}
        projectCode={project ? projectCode(project as { id: number; jiraKey?: string | null }) : ""}
        projectName={project?.name ?? "Project"}
        tab={commsDrawerTab}
        onTabChange={setCommsDrawerTab}
        onClose={() => setCommsDrawerTab(null)}
        senderId={currentUserId}
        resolveName={(id) => usersById.get(id) ?? `User ${id}`}
        people={users}
      />

      {openTask && (
        <TaskDetailModal
          task={toAgg(openTask)}
          allTasks={tasks.map(toAgg)}
          onClose={() => setOpenTaskId(null)}
          onRefresh={() => { void refetchTasks(); }}
        />
      )}

      {/* Project Documents modal — the full document repository for this
          project, reusing the same DocumentsTab as the Documents page. */}
      <Dialog open={docsOpen} onOpenChange={(v) => { if (!v) { setDocsOpen(false); setDocsUploadOpen(false); } }}>
        <DialogContent className="max-w-5xl w-[92vw] h-[88vh] flex flex-col p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-5 py-3 border-b border-border/60 flex-shrink-0">
            <DialogTitle className="flex items-center gap-2 tracking-tight text-base">
              <FolderOpen size={16} className="text-primary" />
              <span className="truncate">Documents · {project?.name ?? "Project"}</span>
              <button
                type="button"
                onClick={() => setDocsUploadOpen(true)}
                className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm"
              >
                <Upload size={14} /> Upload Document
              </button>
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-auto scrollbar-thin p-5">
            <DocumentsTab
              projectId={projectId}
              uploadOpen={docsUploadOpen}
              onUploadOpenChange={setDocsUploadOpen}
              showUploadButton={false}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
