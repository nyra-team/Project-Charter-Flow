// Project detail — a tasks-and-subtasks mirror of the Projects table view.
// Same chrome as projects.tsx (glass filter bar, collapsible colour-coded
// status groups, Excel-style bordered tables with draggable column widths),
// but the rows are this project's top-level tasks, each expandable to show
// its subtasks indented beneath it.
// The previous full detail page is preserved at ./project-detail.legacy.tsx.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/extra-api";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "../lib/format";
import { useRoute } from "wouter";
import { useGoBack } from "../lib/back";
import {
  useGetProject, useListMilestones, useListTasks, useListUsers, useUpdateTask, useCreateTask, useDeleteTask,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Check, ChevronDown, ChevronLeft, Flag, GanttChartSquare,
  ListTree, Search, Table2, Zap, Milestone, MessageSquare, Users,
  GitBranch, X, Plus, Trash2, Copy, LayoutDashboard, FileDown, Loader2, FolderOpen, Upload,
  LayoutGrid, CalendarDays, Info, AlertTriangle, ShieldAlert, Group,
} from "lucide-react";
import { jsPDF } from "jspdf";
import { TASK_PRIORITIES, TASK_STATUSES } from "../lib/task-constants";
import { PersonCell, TimelineCell, projectCode, SCALE_PRESETS } from "./projects";
import { HoverHint } from "@/components/ui-kit";
import { MondayGantt, type GanttGroup, type GanttItem } from "@/components/monday-gantt";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ExcelGroupTable, type ExcelCol } from "@/components/excel-group-table";
import { TaskCreateModal } from "@/components/task-create-modal";
import { KanbanView } from "@/components/monday/KanbanView";
import { GroupByPill } from "@/components/monday/GroupByPill";
import { ActionCard } from "@/components/monday/ActionCard";
import { CalendarView, type CalendarItem } from "@/components/monday/CalendarView";
import { PriorityCell, OwnerCell, DateCell, type BoardColumn } from "@/components/monday";
import { RangeCalendar } from "@/components/ui/calendar-rac";
import { parseDate, getLocalTimeZone, today as racToday, type CalendarDate } from "@internationalized/date";
import type { DateRange } from "react-aria-components";
import { useUserStore } from "../lib/store";
import { CharterOverview } from "../components/charter-overview";
import { TaskCommsDrawer, type TaskCommsTarget } from "../components/TaskCommsDrawer";
import { MoveJustifyModal } from "../components/MoveJustifyModal";
import { ProjectCommsDrawer, type ProjectCommsTab } from "../components/ProjectCommsDrawer";
import { TeamTab } from "../components/team-tab";
import { DocumentsTab } from "../components/documents-tab";
import { TaskDetailModal } from "../components/task-detail-modal";
import { IssuesTab } from "../components/issues-tab";
import { RaiseIssueForm } from "../components/raise-issue-form";
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
  endDateHistory?: string | null;
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
// Task-Gantt legend — one hover explainer per bar colour (RAG palette).
const TASK_GANTT_LEGEND: { label: string; color: string; desc: string }[] = [
  { label: "Completed", color: RAG_HEX.green, desc: "Done — the task is complete." },
  { label: "In progress", color: RAG_HEX.amber, desc: "Working on it (or on hold)." },
  { label: "Delayed", color: RAG_HEX.red, desc: "Stuck / past due — behind schedule." },
  { label: "Not started", color: RAG_HEX.grey, desc: "Not yet started." },
];
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
const COLS: { key: string; header: string; width: number; align?: "left" | "center"; info?: string }[] = [
  { key: "code", header: "Task Code", width: 110 },
  { key: "name", header: "Task Name", width: 300, info: "Task title — click to open task details." },
  { key: "owner", header: "Assignee", width: 70, align: "center", info: "Person responsible for the task." },
  { key: "status", header: "Status", width: 120, align: "center", info: "Current task status (Not Started, In Progress, Delayed, On Hold, Completed)." },
  { key: "priority", header: "Priority", width: 110, align: "center", info: "Task priority, P0 (highest) to P3 (lowest)." },
  { key: "progress", header: "Progress", width: 100, align: "center", info: "Percent complete; rolls up from subtasks where present." },
  { key: "subtasks", header: "Subtasks", width: 80, align: "center", info: "Completed subtasks out of total." },
  { key: "dependency", header: "Predecessors", width: 160, info: "Tasks that must finish before this one can proceed." },
  { key: "timeline", header: "Timeline", width: 180, info: "Planned start and end dates." },
];

// Card cells for the per-project Tasks Kanban (mirrors the Projects board).
const TASK_BOARD_COLUMNS: BoardColumn<TaskRow>[] = [
  { key: "priority", header: "Priority", render: (t) => <PriorityCell priority={t.priority} /> },
  { key: "owner", header: "Owner", render: (t) => <OwnerCell id={t.assigneeId} name={t.assigneeName} /> },
  { key: "due", header: "Due", render: (t) => <DateCell value={t.endDate} /> },
];

// Kanban "Group by" axes — mirrors the CXO Action Centre board (Status/Owner/
// Priority). Status & priority are fixed columns; owner lanes are derived.
const GROUP_BY_OPTIONS = [
  { value: "status", label: "Status" },
  { value: "owner", label: "Owner" },
  { value: "priority", label: "Priority" },
  { value: "department", label: "Department" },
] as const;
type GroupByAxis = (typeof GROUP_BY_OPTIONS)[number]["value"];

// Action-Centre RAG palette for the Kanban status columns — scoped to the board
// so the global task palette (task-constants.ts) is untouched. Mirrors the AC
// STATUS_META hexes: slate / amber / red / light-red (hold) / green.
const KANBAN_STATUS_COLOR: Record<string, string> = {
  not_started: "#94A3B8",
  in_progress: "#F59E0B",
  delayed: "#DC2626",
  on_hold: "#F87171",
  completed: "#16A34A",
};
const OWNER_LANE_COLOR = "#3B82F6";   // blue lane dot per owner (AC parity)
const UNGROUPED_COLOR = "#94A3B8";    // slate — Unassigned / No-priority lanes

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
// Inline "add subtask" row — shown under an expanded parent task in the table,
// so a subtask can be added right here without opening the task-detail popup.
// Module-level (not an inline closure) so its input keeps focus/state across
// parent re-renders. Mirrors the modal's addSubtask payload.
function AddSubtaskRow({ parent, projectId, colSpan, indent, createTask }: {
  parent: TaskRow; projectId: number; colSpan: number; indent: number;
  createTask: ReturnType<typeof useCreateTask>;
}) {
  const [name, setName] = useState("");
  const add = () => {
    const n = name.trim();
    if (!n) return;
    createTask.mutate(
      { id: projectId, data: {
        name: n, parentTaskId: parent.id,
        milestoneId: parent.milestoneId ?? undefined,
        priority: parent.priority ?? "P2",
        status: "not_started", rag: "green",
      } } as never,
      { onSuccess: () => setName("") },
    );
  };
  return (
    <tr className="bg-gray-50/40">
      <td colSpan={colSpan} className="border border-gray-200 px-2 py-1">
        <div className="flex items-center gap-2" style={{ paddingLeft: indent }}>
          <Plus size={12} className="shrink-0 text-gray-400" />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") add(); }}
            placeholder="Add subtask…"
            className="flex-1 max-w-md bg-transparent text-[12px] text-gray-700 outline-none placeholder:text-gray-400"
          />
          <button
            type="button"
            onClick={add}
            disabled={!name.trim() || createTask.isPending}
            className="shrink-0 text-[11px] px-2.5 py-1 rounded bg-[#1868db] text-white hover:bg-[#1558bc] disabled:opacity-50"
          >Add</button>
        </div>
      </td>
    </tr>
  );
}

// Floating status dropdown — click cell to open, pick a status to save.
function StatusDropdown({ task, updateTask }: { task: TaskRow; updateTask: ReturnType<typeof useUpdateTask> }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const st = taskStatusOf(task.status);
  // Portal to <body> with fixed coords so the menu isn't clipped by the table's
  // overflow container or painted under the rows below it. Flips above the cell
  // when there isn't room below (rows low on screen would otherwise underflow).
  const place = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const menuH = TASK_STATUSES.length * 28 + 8;
    const below = window.innerHeight - r.bottom;
    const top = below < menuH + 8 ? Math.max(8, r.top - menuH - 4) : r.bottom + 4;
    setPos({ left: r.left + r.width / 2, top });
  };
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { const t = e.target as Node; if (!btnRef.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false); };
    const onScroll = () => setOpen(false);
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => { document.removeEventListener("mousedown", onDoc); window.removeEventListener("scroll", onScroll, true); window.removeEventListener("resize", onScroll); };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); if (!open) place(); setOpen((o) => !o); }}
        className="w-full h-full px-2 py-1 text-[10px] font-semibold cursor-pointer"
        style={{ color: st.color }}
      >
        {st.label}
      </button>
      {open && pos && createPortal(
        <div ref={menuRef} style={{ position: "fixed", left: pos.left, top: pos.top, transform: "translateX(-50%)" }} className="z-[300] min-w-[104px] rounded-md bg-white border border-gray-200 shadow-xl py-0.5 animate-in fade-in-0 zoom-in-95" onClick={(e) => e.stopPropagation()}>
          {TASK_STATUSES.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={(e) => { e.stopPropagation(); setOpen(false); if (s.value !== task.status) updateTask.mutate({ id: task.id, data: { status: s.value } as never }); }}
              className="w-full flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium hover:bg-gray-50 transition-colors whitespace-nowrap"
            >
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.bg }} />
              <span className="text-gray-700">{s.label}</span>
              {s.value === task.status && <Check size={12} className="ml-auto text-gray-500" />}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

// Priority cell — click to pick P0–P3 from a dropdown (mirrors StatusDropdown).
function PriorityDropdown({ task, updateTask }: { task: TaskRow; updateTask: ReturnType<typeof useUpdateTask> }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const pr = PRIORITY_BY_VALUE.get(task.priority as never);
  const place = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const menuH = TASK_PRIORITIES.length * 28 + 8;
    const below = window.innerHeight - r.bottom;
    const top = below < menuH + 8 ? Math.max(8, r.top - menuH - 4) : r.bottom + 4;
    setPos({ left: r.left + r.width / 2, top });
  };
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { const t = e.target as Node; if (!btnRef.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false); };
    const onScroll = () => setOpen(false);
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => { document.removeEventListener("mousedown", onDoc); window.removeEventListener("scroll", onScroll, true); window.removeEventListener("resize", onScroll); };
  }, [open]);
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); if (!open) place(); setOpen((o) => !o); }}
        className="w-full h-full px-2 py-1 text-[10px] font-semibold cursor-pointer"
        style={{ color: pr ? pr.color : undefined }}
      >
        {pr ? pr.label : <span className="text-[11px] text-gray-400">—</span>}
      </button>
      {open && pos && createPortal(
        <div ref={menuRef} style={{ position: "fixed", left: pos.left, top: pos.top, transform: "translateX(-50%)" }} className="z-[300] min-w-[84px] rounded-md bg-white border border-gray-200 shadow-xl py-0.5 animate-in fade-in-0 zoom-in-95" onClick={(e) => e.stopPropagation()}>
          {TASK_PRIORITIES.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={(e) => { e.stopPropagation(); setOpen(false); if (p.value !== task.priority) updateTask.mutate({ id: task.id, data: { priority: p.value } as never }); }}
              className="w-full flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium hover:bg-gray-50 transition-colors"
            >
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.solid }} />
              <span className="text-gray-700">{p.label}</span>
              {p.value === task.priority && <Check size={12} className="ml-auto text-gray-500" />}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

// Timeline cell with an in-cell calendar icon to pick start / end dates.
// Native <input type="date"> carries its own picker; the icon just toggles the editor.
function TimelineEditCell({ task, updateTask }: { task: TaskRow; updateTask: ReturnType<typeof useUpdateTask> }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);
  const save = (field: "startDate" | "endDate", v: string) =>
    updateTask.mutate({ id: task.id, data: { [field]: v || null } as never });
  // Same react-aria range picker as the CXO Action Centre (calendar-rac).
  const parse = (iso?: string | null): CalendarDate | null => {
    if (!iso) return null;
    try { return parseDate(iso.slice(0, 10)); } catch { return null; }
  };
  const startCd = parse(task.startDate);
  const endCd = parse(task.endDate);
  const value: DateRange | null = startCd ? { start: startCd, end: endCd ?? startCd } : null;
  const onChange = (val: DateRange | null) => {
    if (!val) { save("startDate", ""); save("endDate", ""); return; }
    save("startDate", val.start.toString());
    save("endDate", val.end.toString());
    setOpen(false);
  };
  const setTodayRange = () => { const t = racToday(getLocalTimeZone()).toString(); save("startDate", t); save("endDate", t); };
  return (
    <div ref={ref} className="relative flex items-center gap-1 w-full">
      <button type="button" title="Set start / end date"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className="shrink-0 text-gray-500 hover:text-primary p-0.5 rounded">
        <CalendarDays size={14} />
      </button>
      <div className="min-w-0 flex-1 overflow-hidden"><TimelineCell start={task.startDate} end={task.endDate} endHistory={task.endDateHistory} /></div>
      {open && (
        <div className="absolute top-full right-0 mt-1 z-50 rounded-lg bg-white border border-gray-200 shadow-xl select-none p-2 scale-[0.65] origin-top-right" onClick={(e) => e.stopPropagation()}>
          <RangeCalendar
            aria-label="Task start / end date range"
            value={value}
            onChange={onChange}
            defaultFocusedValue={startCd ?? undefined}
            className="w-fit"
          />
          <div className="flex items-center justify-between px-1 pt-2 mt-1 border-t border-border">
            <span className="text-[11px] text-muted-foreground">
              {task.startDate && task.endDate
                ? (task.startDate.slice(0, 10) === task.endDate.slice(0, 10) ? "Pick an end date" : `${task.startDate.slice(0, 10)} – ${task.endDate.slice(0, 10)}`)
                : "Pick a start & end date"}
            </span>
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => { save("startDate", ""); save("endDate", ""); }} className="text-[12px] text-primary hover:underline font-medium">Clear</button>
              <button type="button" onClick={setTodayRange} className="text-[12px] text-primary hover:underline font-medium">Today</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Progress — read-only display (rolls up from subtasks / status). Not editable.
// ponytail: updateTask kept in the signature so the call site needn't change.
function ProgressInput({ task }: { task: TaskRow; updateTask: ReturnType<typeof useUpdateTask> }) {
  const pp = (task as Record<string, unknown>).progressPct as number | undefined;
  const pct = task.status === "completed" ? 100 : Math.max(0, Math.min(100, pp ?? 0));
  const barColor = pct >= 100 ? "#10B981" : pct > 0 ? "#F59E0B" : "#E5E7EB";
  return (
    <span className="inline-flex items-center gap-1" title={`${pct}% complete`}>
      <span className="w-10 h-1.5 rounded-full bg-gray-200 overflow-hidden">
        <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: barColor }} />
      </span>
      <span className="text-[10px] font-semibold text-gray-600 tabular-nums">{pct}%</span>
    </span>
  );
}

// Inline owner picker — click the avatar to assign/reassign right in the row
// (subtasks included), no need to open the task popup. Searchable people list.
function OwnerSelect({ task, users, updateTask, currentName }: {
  task: TaskRow;
  users: { id: number; name: string; photoUrl?: string | null }[];
  updateTask: ReturnType<typeof useUpdateTask>;
  currentName: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Portal to <body> with fixed coords so the menu isn't clipped by / painted
  // under the rows below it (table rows make their own stacking contexts).
  const place = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ left: r.left + r.width / 2, top: r.bottom + 4 });
  };
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!btnRef.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false);
    };
    const onScroll = () => setOpen(false);
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);
  const needle = q.trim().toLowerCase();
  const list = needle ? users.filter((u) => u.name.toLowerCase().includes(needle)) : users;
  const pick = (id: number | null) => {
    setOpen(false); setQ("");
    if (id !== (task.assigneeId ?? null)) updateTask.mutate({ id: task.id, data: { assigneeId: id } as never });
  };
  return (
    <div className="inline-flex">
      <button ref={btnRef} type="button" title="Assign owner" onClick={(e) => { e.stopPropagation(); if (!open) place(); setOpen((o) => !o); }} className="cursor-pointer hover:opacity-80">
        <PersonCell name={currentName} />
      </button>
      {open && pos && createPortal(
        <div ref={menuRef} style={{ position: "fixed", left: pos.left, top: pos.top, transform: "translateX(-50%)" }} className="z-[300] w-56 rounded-lg bg-white border border-gray-200 shadow-xl py-1 animate-in fade-in-0 zoom-in-95" onClick={(e) => e.stopPropagation()}>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people…" className="w-[calc(100%-12px)] mx-1.5 mb-1 px-2 py-1 text-xs border border-input rounded outline-none focus:ring-2 focus:ring-ring/40" />
          <div className="max-h-56 overflow-y-auto">
            <button type="button" onClick={() => pick(null)} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-50 text-gray-500">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[9px] bg-gray-100 text-gray-400 border border-gray-200">—</span> Unassigned
            </button>
            {list.map((u) => (
              <button key={u.id} type="button" onClick={() => pick(u.id)} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-50">
                <PersonCell name={u.name} photoUrl={u.photoUrl} />
                <span className="text-gray-700 truncate">{u.name}</span>
                {u.id === task.assigneeId && <Check size={12} className="ml-auto text-gray-500" />}
              </button>
            ))}
            {list.length === 0 && <div className="px-3 py-2 text-xs text-gray-400">No matches</div>}
          </div>
        </div>,
        document.body,
      )}
    </div>
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
  const goBack = useGoBack();
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
  const createTask = useCreateTask({ mutation: { onSuccess: () => { void refetchTasks(); } } });
  const deleteTask = useDeleteTask({ mutation: { onSuccess: () => { void refetchTasks(); } } });

  const tasks = (rawTasks ?? []) as TaskRow[];

  // Clicking a task (row name or Gantt bar) opens the shared Jira-style detail modal.
  const [openTaskId, setOpenTaskId] = useState<number | null>(null);
  const openTask = openTaskId != null ? tasks.find((t) => t.id === openTaskId) ?? null : null;

  // Add-task modal target. "generic" = toolbar add (milestone is pickable);
  // { milestoneId } = opened from a milestone group header (milestone locked).
  const [addFor, setAddFor] = useState<{ milestoneId: number | null } | "generic" | null>(null);

  // Clone-ordering overlay (clone id → source id). pmo_tasks has no ordering
  // column, so the server returns a clone at the end of the list; this renders
  // it directly under its source row instead. Session-only (resets on reload).
  const [cloneAfter, setCloneAfter] = useState<Map<number, number>>(() => new Map());

  // Duplicate a task as a new top-level task "… (copy)". Reads the full enriched
  // row (cast — TaskRow types only the subset the table reads).
  const cloneTask = (t: TaskRow) => {
    const r = t as unknown as Record<string, unknown>;
    const sourceId = t.id;
    createTask.mutate(
      { id: projectId, data: {
        name: `${t.name} (copy)`,
        description: (r.description as string | null) ?? undefined,
        milestoneId: t.milestoneId ?? undefined,
        parentTaskId: t.parentTaskId ?? undefined,
        assigneeId: t.assigneeId ?? undefined,
        priority: t.priority ?? "P2",
        rag: (r.rag as string | null) ?? "green",
        stage: (r.stage as string | null) ?? undefined,
        startDate: t.startDate ?? undefined,
        endDate: t.endDate ?? undefined,
        estimatedHours: (r.estimatedHours as number | null) ?? undefined,
        plannedEffortHours: (r.plannedEffortHours as number | null) ?? undefined,
        cftOwner: (r.cftOwner as number | null) ?? undefined,
        cftDept: (r.cftDept as string | null) ?? undefined,
      } } as never,
      { onSuccess: (nt: unknown) => {
        const nid = (nt as { id?: number })?.id;
        if (nid) setCloneAfter((m) => new Map(m).set(nid, sourceId));
      } },
    );
  };

  // Reorder a row list so each clone sits immediately after its source (within
  // the same milestone group). Recurses for clones-of-clones; no-op when nothing
  // has been cloned this session.
  const orderRows = useCallback((rows: TaskRow[]): TaskRow[] => {
    if (cloneAfter.size === 0) return rows;
    const byId = new Map(rows.map((r) => [r.id, r] as const));
    const clonesOf = new Map<number, number[]>();
    for (const [clone, src] of cloneAfter) {
      if (byId.has(clone) && byId.has(src)) {
        const arr = clonesOf.get(src) ?? []; arr.push(clone); clonesOf.set(src, arr);
      }
    }
    if (clonesOf.size === 0) return rows;
    const placed = new Set<number>();
    const out: TaskRow[] = [];
    const append = (r: TaskRow) => {
      if (placed.has(r.id)) return;
      out.push(r); placed.add(r.id);
      for (const cid of clonesOf.get(r.id) ?? []) { const cr = byId.get(cid); if (cr) append(cr); }
    };
    for (const r of rows) {
      const src = cloneAfter.get(r.id);
      if (src != null && byId.has(src)) continue; // a clone — placed under its source
      append(r);
    }
    for (const r of rows) if (!placed.has(r.id)) out.push(r); // safety net
    return out;
  }, [cloneAfter]);

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
      endDateHistory: (r.endDateHistory as string | null) ?? null,
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
  // Justification gate for kanban status moves (same UX as the CXO board).
  const [moveJustify, setMoveJustify] = useState<{ id: number; to: string; toLabel: string } | null>(null);
  const [movingPending, setMovingPending] = useState(false);
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

  // View switcher — Overview · Table · Kanban · Gantt · Calendar. Always opens
  // on the table, EXCEPT when drilled in from the Projects Gantt (?view=gantt),
  // which lands on Gantt. We deliberately do NOT restore the last-picked view
  // from localStorage — every fresh entry defaults to table.
  const [view, setView] = useState<"overview" | "table" | "kanban" | "gantt" | "calendar">(() => {
    const q = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("view") : null;
    if (q === "overview" || q === "gantt" || q === "table" || q === "kanban" || q === "calendar") return q;
    return "table";
  });

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
  // Live Project Report — a professional project STATUS report (not a charter).
  // Sections are limited to those we can populate from stored data: reporting
  // period, per-dimension RAG health, schedule status (incl. proxy SPI), period
  // accomplishments/next, RAID (risks + issues), change requests, decisions /
  // action items, and dependencies & blockers. Cost/EVM is intentionally
  // omitted — the project stores planned budgets only, no actual spend.
  const generateLiveCharter = async () => {
    setGenBusy(true);
    try {
      const p = (project ?? {}) as Record<string, unknown>;
      const charterId = Number(p.charterId ?? 0);
      let ch: Record<string, unknown> = {};
      if (charterId > 0) { try { ch = await api.get<Record<string, unknown>>(`/api/charters/${charterId}`); } catch { /* no charter — dates fall back to the project */ } }
      const cstr = (k: string) => { const v = ch[k]; return typeof v === "string" ? v.trim() : ""; };
      const pnum = (k: string) => { const v = p[k]; return v != null && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : null; };
      const pstr = (k: string) => { const v = p[k]; return typeof v === "string" ? v.trim() : ""; };
      const cnum = (k: string) => { const v = ch[k]; return v != null && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : null; };
      const fmt = (d?: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");
      const cap = (s?: string) => (s ? s.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()) : "—");
      const money = (n: number | null) => (n != null ? formatCurrency(n) : "—");
      const tags = Array.isArray(ch.strategicAlignmentTags) ? (ch.strategicAlignmentTags as string[]) : [];
      const pcRef = tags.find((t) => t.startsWith("PC_ID:"))?.slice(6) ?? null;

      // Live feeds: risks live on the charter; issues + change requests on the project.
      type RiskRow = { title: string; impact: string; likelihood: string; mitigation?: string; status: string; owner?: string };
      type IssueRow = { title: string; description?: string; status: string; dependencyType?: string; blockingDept?: string; blockingOwnerId?: number | null; originalDeadline?: string | null; proposedRevisedDeadline?: string | null };
      type CrRow = { title: string; changeType?: string; status: string; scheduleImpactDays?: number; scopeImpactSummary?: string; raisedById?: number | null; createdAt?: string };
      type RT = { id: number; name: string; status: string; priority?: string; parentTaskId?: number | null; assigneeId?: number | null; assigneeName?: string | null; endDate?: string | null; actualEnd?: string | null; scheduleVarianceDays?: number; predecessorIds?: string; milestoneId?: number | null; estimatedHours?: number | string | null; actualHours?: number | string | null; plannedEffortHours?: number | string | null };
      const [risks, issues, crs] = await Promise.all([
        charterId > 0 ? api.get<RiskRow[]>(`/api/charters/${charterId}/risks`).catch(() => [] as RiskRow[]) : Promise.resolve([] as RiskRow[]),
        api.get<IssueRow[]>(`/api/projects/${projectId}/issues`).catch(() => [] as IssueRow[]),
        api.get<CrRow[]>(`/api/projects/${projectId}/change-requests`).catch(() => [] as CrRow[]),
      ]);
      const nameOf = (id?: number | null) => (id ? (usersById.get(Number(id)) ?? "—") : "—");

      // ── Metrics ──────────────────────────────────────────────────────────
      const nowMs = Date.now();
      const allT = (rawTasks ?? []) as unknown as RT[];
      const taskById = new Map(allT.map((t) => [t.id, t]));
      const topT = allT.filter((t) => t.parentTaskId == null);
      const tc = (s: string) => topT.filter((t) => t.status === s).length;
      const tt = topT.length, tDone = tc("completed"), tProg = tc("in_progress"), tDelay = tc("delayed"), tHold = tc("on_hold");
      const tNot = Math.max(0, tt - tDone - tProg - tDelay - tHold);
      // Progress: same subtask-aware unit roll-up as the Project Overview, so the
      // two surfaces agree. A parent with subtasks is represented by its subtasks
      // (3/4 done = 75%); a leaf task counts as one all-or-nothing unit.
      const subsByParent = new Map<number, RT[]>();
      for (const t of allT) { if (t.parentTaskId != null) { const a = subsByParent.get(t.parentTaskId) ?? []; a.push(t); subsByParent.set(t.parentTaskId, a); } }
      let unitTotal = 0, unitDone = 0;
      for (const t of topT) {
        const subs = subsByParent.get(t.id) ?? [];
        if (subs.length) { unitTotal += subs.length; unitDone += subs.filter((s) => s.status === "completed").length; }
        else { unitTotal += 1; if (t.status === "completed") unitDone += 1; }
      }
      const actualPct = unitTotal ? Math.round((unitDone / unitTotal) * 100) : (pnum("progress") ?? 0);
      const pms = (rawMilestones ?? []) as Array<{ id: number; name: string; dueDate?: string | null; status: string }>;
      const msDone = pms.filter((m) => m.status === "completed").length;
      const msOverdue = pms.filter((m) => m.status !== "completed" && m.dueDate && new Date(m.dueDate).getTime() < nowMs);
      const overdueTasks = topT.filter((t) => t.status !== "completed" && t.endDate && new Date(t.endDate).getTime() < nowMs);
      const varianceDays = allT.reduce((s, t) => s + (Number(t.scheduleVarianceDays) || 0), 0);
      const startD = cstr("startDate") || pstr("startDate");
      const endD = cstr("endDate") || pstr("endDate");
      let plannedPct: number | null = null, spi: number | null = null;
      if (startD && endD) {
        const s = new Date(startD).getTime(), e = new Date(endD).getTime();
        if (e > s) { plannedPct = Math.min(100, Math.max(0, Math.round(((nowMs - s) / (e - s)) * 100))); if (plannedPct > 0) spi = Number((actualPct / plannedPct).toFixed(2)); }
      }
      const worst = (...xs: string[]) => (xs.includes("red") ? "red" : xs.includes("amber") ? "amber" : "green");
      const scheduleRag = (msOverdue.length > 0 || (spi != null && spi < 0.85)) ? "red" : ((spi != null && spi < 0.98) || overdueTasks.length > 0) ? "amber" : "green";
      const sevRank: Record<string, number> = { low: 1, medium: 2, high: 3 };
      const openRisks = risks.filter((r) => !["closed", "mitigated", "resolved"].includes((r.status || "").toLowerCase()));
      const riskScore = (r: RiskRow) => (sevRank[(r.impact || "medium").toLowerCase()] || 2) * (sevRank[(r.likelihood || "medium").toLowerCase()] || 2);
      const riskRag = openRisks.some((r) => riskScore(r) >= 6) ? "red" : openRisks.some((r) => riskScore(r) >= 4) ? "amber" : "green";
      const openScopeCrs = crs.filter((c) => (c.status || "").toLowerCase() === "submitted" && ((c.scopeImpactSummary || "").trim() || (c.changeType || "").toLowerCase().includes("scope")));
      const scopeRag = openScopeCrs.some((c) => (Number(c.scheduleImpactDays) || 0) > 14) ? "red" : openScopeCrs.length > 0 ? "amber" : "green";

      // ── Cost & budget (planned figures from the charter; money actuals are not
      //    tracked, so spend/burn/CPI use an effort-hours proxy from the tasks).
      const num = (v: unknown) => (v != null && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : 0);
      const capexAmt = pnum("capexBudget") ?? cnum("capexAmount");
      const opexAmt = pnum("opexBudget") ?? cnum("opexAmount");
      const sumCapOpex = (capexAmt != null || opexAmt != null) ? (capexAmt ?? 0) + (opexAmt ?? 0) : null;
      const budget = cnum("tentativeBudget") ?? cnum("finalNegotiatedBudget") ?? sumCapOpex;
      const eac = cnum("leAmount"); // Latest Estimate = EAC
      const vac = budget != null && eac != null ? budget - eac : null; // Variance at Completion
      const estHrs = allT.reduce((s, t) => s + (num(t.plannedEffortHours) || num(t.estimatedHours)), 0);
      const actHrs = allT.reduce((s, t) => s + num(t.actualHours), 0);
      const doneEst = allT.filter((t) => t.status === "completed").reduce((s, t) => s + (num(t.plannedEffortHours) || num(t.estimatedHours)), 0);
      const doneAct = allT.filter((t) => t.status === "completed").reduce((s, t) => s + num(t.actualHours), 0);
      const effortCpi = doneAct > 0 ? Number((doneEst / doneAct).toFixed(2)) : null; // >1 = under effort budget
      const costRag =
        (budget != null && eac != null && eac > budget * 1.1) || (effortCpi != null && effortCpi < 0.8) ? "red"
        : (budget != null && eac != null && eac > budget) || (effortCpi != null && effortCpi < 0.95) ? "amber"
        : (budget != null || effortCpi != null) ? "green" : "grey";

      const overallRag = worst(scheduleRag, riskRag, scopeRag, costRag === "grey" ? "green" : costRag);

      // Reporting period: trailing 14 days up to today (the project stores no defined period).
      const periodEnd = new Date(nowMs);
      const periodStart = new Date(nowMs - 14 * 864e5);
      const inPeriod = (d?: string | null) => !!d && new Date(d).getTime() >= periodStart.getTime();
      const accomplishments = topT.filter((t) => t.status === "completed" && (inPeriod(t.actualEnd) || inPeriod(t.endDate))).slice(0, 12);
      const plannedNext = topT.filter((t) => t.status !== "completed" && t.endDate).sort((a, b) => new Date(a.endDate as string).getTime() - new Date(b.endDate as string).getTime()).slice(0, 12);
      const actionItems = topT.filter((t) => t.status !== "completed" && t.assigneeId).sort((a, b) => (a.endDate || "9999").localeCompare(b.endDate || "9999")).slice(0, 15);
      const decisionsCrs = crs.filter((c) => (c.status || "").toLowerCase() === "submitted");
      const blockers = topT.filter((t) => t.status !== "completed").map((t) => {
        let preds: number[] = []; try { preds = JSON.parse(t.predecessorIds || "[]"); } catch { preds = []; }
        const pending = preds.map((id) => taskById.get(id)).filter((d): d is RT => !!d && d.status !== "completed");
        return { t, pending };
      }).filter((b) => b.pending.length > 0).slice(0, 15);

      // ── PDF ──────────────────────────────────────────────────────────────
      const doc = new jsPDF({ unit: "pt", format: "a4" });
      const M = 44;
      const W = doc.internal.pageSize.getWidth();
      const H = doc.internal.pageSize.getHeight();
      const CW = W - M * 2;
      const RAG: Record<string, [number, number, number]> = { green: [22, 163, 74], amber: [217, 119, 6], red: [220, 38, 38], grey: [100, 116, 139] };
      const RAG_TINT: Record<string, [number, number, number]> = { green: [236, 253, 245], amber: [255, 247, 237], red: [254, 242, 242], grey: [241, 245, 249] };
      const RAG_TEXT: Record<string, string> = { green: "On Track", amber: "At Risk", red: "Off Track", grey: "N/A" };
      let y = 0;
      const ensure = (h: number) => { if (y + h > H - 54) { doc.addPage(); y = M; } };
      const heading = (t: string) => {
        ensure(34); y += 10;
        doc.setFillColor(37, 99, 235); doc.rect(M, y - 9, 3.5, 13, "F");
        doc.setFont("helvetica", "bold"); doc.setFontSize(11.5); doc.setTextColor(15, 23, 42);
        doc.text(t.toUpperCase(), M + 9, y); y += 7;
        doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.7); doc.line(M, y, W - M, y); y += 14;
      };
      const kvRow = (label: string, value: string) => {
        const vx = M + 135; doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(71, 85, 105);
        const vlines = doc.splitTextToSize(value || "—", W - M - vx) as string[];
        ensure(Math.max(14, vlines.length * 12));
        doc.text(label, M, y); doc.setFont("helvetica", "normal"); doc.setTextColor(15, 23, 42); doc.text(vlines, vx, y);
        y += Math.max(14, vlines.length * 12);
      };
      const bulletRow = (txt: string) => {
        doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(55, 65, 81);
        const lines = doc.splitTextToSize(txt, CW - 14) as string[];
        ensure(lines.length * 12 + 1); doc.text("•", M + 2, y); doc.text(lines, M + 14, y); y += lines.length * 12 + 1;
      };
      const noneRow = (msg: string) => { doc.setFont("helvetica", "italic"); doc.setFontSize(9); doc.setTextColor(148, 163, 184); ensure(15); doc.text(msg, M, y); y += 16; };
      // Hand-drawn table (no autotable dependency). Column widths should sum to <= CW.
      const table = (cols: { h: string; w: number }[], rows: string[][]) => {
        const total = cols.reduce((s, c) => s + c.w, 0);
        const drawHeader = () => {
          ensure(20); doc.setFillColor(30, 41, 59); doc.rect(M, y - 10, total, 17, "F");
          doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(255, 255, 255);
          let x = M; for (const c of cols) { doc.text((doc.splitTextToSize(c.h.toUpperCase(), c.w - 8) as string[])[0] ?? "", x + 4, y); x += c.w; } y += 11;
        };
        drawHeader();
        rows.forEach((r, ri) => {
          const cells = r.map((cell, ci) => doc.splitTextToSize(cell || "—", cols[ci].w - 8) as string[]);
          const rh = Math.max(15, Math.max(...cells.map((l) => l.length)) * 10 + 6);
          if (y + rh > H - 54) { doc.addPage(); y = M; drawHeader(); }
          if (ri % 2 === 1) { doc.setFillColor(248, 250, 252); doc.rect(M, y - 10, total, rh, "F"); }
          doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(31, 41, 55);
          let x = M; cells.forEach((lines, ci) => { doc.text(lines, x + 4, y); x += cols[ci].w; });
          y += rh;
        });
        doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.5); doc.line(M, y - 9, M + total, y - 9); y += 12;
      };

      // ── Header band ──────────────────────────────────────────────────────
      doc.setFillColor(15, 23, 42); doc.rect(0, 0, W, 84, "F");
      doc.setFillColor(37, 99, 235); doc.rect(0, 84, W, 3, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.setTextColor(255, 255, 255);
      doc.text("PROJECT STATUS REPORT", M, 38);
      doc.setFont("helvetica", "normal"); doc.setFontSize(12); doc.setTextColor(203, 213, 225);
      doc.text((doc.splitTextToSize(cstr("title") || (p.name as string) || "Project", CW - 150) as string[])[0], M, 58);
      doc.setFontSize(8.5); doc.setTextColor(148, 163, 184);
      doc.text([pcRef ? `Ref ${pcRef}` : null, `Report date: ${fmt(periodEnd.toISOString())}`].filter(Boolean).join("    ·    "), M, 74);
      {
        const oc = RAG[overallRag]; const label = RAG_TEXT[overallRag];
        doc.setFont("helvetica", "bold"); doc.setFontSize(9);
        const pw = doc.getTextWidth(label) + 22; doc.setFillColor(oc[0], oc[1], oc[2]); doc.roundedRect(W - M - pw, 30, pw, 18, 9, 9, "F");
        doc.setTextColor(255, 255, 255); doc.text(label, W - M - pw + 11, 42);
        doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(148, 163, 184); doc.text("OVERALL", W - M - pw, 24);
      }
      y = 104;

      // ── Reporting period ─────────────────────────────────────────────────
      heading("Reporting Period");
      kvRow("Period", `${fmt(periodStart.toISOString())}  to  ${fmt(periodEnd.toISOString())}`);
      kvRow("Report date", fmt(periodEnd.toISOString()));
      kvRow("Project status", cap(p.status as string));
      kvRow("Overall completion", `${actualPct}%`);

      // ── RAG health ───────────────────────────────────────────────────────
      heading("Health Summary (RAG)");
      {
        const dims: Array<[string, string, string]> = [
          ["Scope", scopeRag, openScopeCrs.length ? `${openScopeCrs.length} open scope change(s)` : "No open scope changes"],
          ["Schedule", scheduleRag, msOverdue.length ? `${msOverdue.length} milestone(s) overdue` : (spi != null ? `SPI ${spi}` : "On plan")],
          ["Cost", costRag, effortCpi != null ? `Effort CPI ${effortCpi}${eac != null ? ` · LE ${money(eac)}` : ""}` : (budget != null ? `Budget ${money(budget)}` : "No budget data")],
          ["Risk", riskRag, `${openRisks.length} open risk(s)`],
        ];
        const gap = 10; const cw = (CW - gap * 3) / 4; const top = y;
        dims.forEach((d, i) => {
          const x = M + i * (cw + gap); const c = RAG[d[1]]; const tint = RAG_TINT[d[1]];
          doc.setFillColor(tint[0], tint[1], tint[2]); doc.roundedRect(x, top, cw, 50, 5, 5, "F");
          doc.setFillColor(c[0], c[1], c[2]); doc.circle(x + 11, top + 14, 4, "F");
          doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(71, 85, 105); doc.text(d[0].toUpperCase(), x + 20, top + 17);
          doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(c[0], c[1], c[2]); doc.text(RAG_TEXT[d[1]], x + 11, top + 33);
          doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(100, 116, 139);
          doc.text(doc.splitTextToSize(d[2], cw - 16) as string[], x + 11, top + 44);
        });
        y = top + 50 + 16;
      }

      // ── Schedule status ──────────────────────────────────────────────────
      heading("Schedule Status");
      kvRow("Planned dates", `${fmt(startD)}  to  ${fmt(endD)}`);
      kvRow("Progress (actual)", `${actualPct}%   (${unitDone}/${unitTotal} units complete · ${tDone}/${tt} top-level tasks)`);
      if (plannedPct != null) kvRow("Planned to date", `${plannedPct}%`);
      kvRow("Schedule variance", varianceDays > 0 ? `${varianceDays} day(s) behind` : varianceDays < 0 ? `${Math.abs(varianceDays)} day(s) ahead` : "On schedule");
      if (spi != null) kvRow("SPI (proxy)", `${spi}  (${spi >= 1 ? "on/ahead of plan" : "behind plan"})`);
      kvRow("Milestones", `${msDone}/${pms.length} complete${msOverdue.length ? ` · ${msOverdue.length} overdue` : ""}`);
      kvRow("Tasks", `${tDone} done · ${tProg} in progress · ${tDelay} delayed · ${tHold} on hold · ${tNot} not started`);

      // ── Cost & budget status (planned + LE/EAC from charter; money actuals
      //    not tracked → shown as such, with an effort-hours CPI proxy) ───────
      heading("Cost & Budget Status");
      kvRow("Approved / tentative budget", money(budget));
      kvRow("CapEx", money(pnum("capexBudget") ?? cnum("capexAmount")));
      kvRow("OpEx", money(pnum("opexBudget") ?? cnum("opexAmount")));
      if (cnum("finalNegotiatedBudget") != null) kvRow("Final negotiated budget", money(cnum("finalNegotiatedBudget")));
      kvRow("Latest Estimate (LE / EAC)", money(eac));
      kvRow("Variance at completion", vac != null ? `${money(vac)} (${vac >= 0 ? "under" : "over"} budget)` : "—");
      kvRow("Actual spend / burn / CPI", "Not tracked — no cost-actuals source");
      kvRow("Planned vs actual effort", `${estHrs || "—"} h planned · ${actHrs || "—"} h actual`);
      kvRow("Effort CPI (proxy)", effortCpi != null ? `${effortCpi}  (${effortCpi >= 1 ? "within effort budget" : "over effort budget"})` : "—");
      if (cnum("roiPerAnnum") != null) kvRow("ROI / annum", money(cnum("roiPerAnnum")));
      if (cnum("paybackMonths") != null) kvRow("Payback", `${cnum("paybackMonths")} months`);
      if (cnum("nfaThreshold") != null) kvRow("NFA threshold", money(cnum("nfaThreshold")));

      // ── Accomplishments / next ───────────────────────────────────────────
      heading("Accomplishments This Period");
      if (accomplishments.length) { for (const t of accomplishments) bulletRow(`${t.name}${(t.actualEnd || t.endDate) ? `  (${fmt(t.actualEnd || t.endDate)})` : ""}`); y += 5; }
      else noneRow("No tasks completed in this period.");
      heading("Planned Next Period");
      if (plannedNext.length) { for (const t of plannedNext) bulletRow(`${t.name}  —  due ${fmt(t.endDate)} (${cap(t.status)})`); y += 5; }
      else noneRow("No upcoming tasks scheduled.");

      // ── RAID: risks + issues ─────────────────────────────────────────────
      heading("Risks Register");
      if (risks.length) table([{ h: "Risk", w: 150 }, { h: "Impact", w: 55 }, { h: "Likelihood", w: 65 }, { h: "Owner", w: 80 }, { h: "Mitigation", w: 99 }, { h: "Status", w: 58 }],
        risks.map((r) => [r.title, cap(r.impact), cap(r.likelihood), r.owner || "—", r.mitigation || "—", cap(r.status)]));
      else noneRow("No risks logged.");
      heading("Issues Register");
      if (issues.length) table([{ h: "Issue", w: 200 }, { h: "Type", w: 80 }, { h: "Blocking", w: 120 }, { h: "Status", w: 107 }],
        issues.map((i) => [i.title, cap(i.dependencyType || "—"), i.blockingDept || nameOf(i.blockingOwnerId), cap(i.status)]));
      else noneRow("No issues logged.");

      // ── Change requests ──────────────────────────────────────────────────
      heading("Change Requests");
      if (crs.length) table([{ h: "Change", w: 175 }, { h: "Type", w: 70 }, { h: "Sched Δ (days)", w: 70 }, { h: "Raised by", w: 95 }, { h: "Status", w: 97 }],
        crs.map((c) => [c.title, cap(c.changeType || "—"), String(c.scheduleImpactDays ?? 0), nameOf(c.raisedById), cap(c.status)]));
      else noneRow("No change requests raised.");

      // ── Decisions / action items ─────────────────────────────────────────
      heading("Decisions Required & Action Items");
      const decisionRows: string[][] = [
        ...decisionsCrs.map((c) => [c.title, nameOf(c.raisedById), "—", "Awaiting decision"]),
        ...actionItems.map((t) => [t.name, nameOf(t.assigneeId), fmt(t.endDate), cap(t.status)]),
      ];
      if (decisionRows.length) table([{ h: "Item", w: 210 }, { h: "Owner", w: 110 }, { h: "Due", w: 90 }, { h: "Status", w: 97 }], decisionRows);
      else noneRow("No open decisions or action items.");

      // ── Dependencies & blockers ──────────────────────────────────────────
      heading("Dependencies & Blockers");
      if (blockers.length) table([{ h: "Task", w: 200 }, { h: "Waiting on", w: 200 }, { h: "Due", w: 107 }],
        blockers.map((b) => [b.t.name, b.pending.map((d) => d.name).join(", "), fmt(b.t.endDate)]));
      else noneRow("No blocking dependencies.");

      // ── Footer ───────────────────────────────────────────────────────────
      const pageCount = doc.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i); doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.5); doc.line(M, H - 34, W - M, H - 34);
        doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(148, 163, 184);
        doc.text(`${(p.name as string) ?? "Project"} · Status Report · Confidential`, M, H - 22);
        doc.text(`Page ${i} of ${pageCount}`, W - M, H - 22, { align: "right" });
      }
      const safe = `${(p.name as string) ?? "project"} - Status Report`.replace(/[^\w.\- ]/g, "").trim();
      doc.save(`${safe || "Status Report"}.pdf`);
      toast({ title: "Project status report generated" });
    } catch (e) {
      toast({ title: (e as Error)?.message || "Could not generate report", variant: "destructive" });
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
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!searchOpen) return;
    const onDoc = (e: MouseEvent) => {
      // Keep an active query visible — only auto-close the pop-out when empty.
      if (searchRef.current && !searchRef.current.contains(e.target as Node) && !search) setSearchOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [searchOpen, search]);
  // ?milestone=<id> deep-link (e.g. the task popup's breadcrumb) pre-selects it.
  const [milestone, setMilestone] = useState(
    () => (typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("milestone") : null) ?? "",
  );
  const [priority, setPriority] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [prioOpen, setPrioOpen] = useState(false);
  const [issuesPanelOpen, setIssuesPanelOpen] = useState(false);
  // Kanban "Group by" axis (Status/Owner/Priority/Department) — Action Centre parity.
  const [groupBy, setGroupBy] = useState<GroupByAxis>("status");
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
        ordered.push({ key: String(ms.id), label: ms.name, color: MS_COLORS[i % MS_COLORS.length]!, rows: orderRows(rows) });
        i++;
      }
    }
    const none = byKey.get("__none__");
    if (none && none.length > 0) {
      ordered.push({ key: "__none__", label: "No Milestone", color: "#94A3B8", rows: orderRows(none) });
    }
    return ordered;
  }, [filtered, rawMilestones, orderRows]);

  // ── Kanban columns by the selected "Group by" axis (Action Centre parity):
  //    status = the 5 fixed RAG columns; priority = P0–P3 (+ No priority);
  //    owner = one lane per assignee present, busiest first, Unassigned last.
  const kanbanGroups = useMemo(() => {
    if (groupBy === "priority") {
      const cols = TASK_PRIORITIES.map((p) => ({
        key: p.value, label: p.label, color: p.solid,
        rows: filtered.filter((t) => t.priority === p.value),
      })) as { key: string; label: string; color: string; rows: TaskRow[] }[];
      const none = filtered.filter((t) => !PRIORITY_BY_VALUE.has(t.priority as never));
      if (none.length > 0) cols.push({ key: "__none__", label: "No priority", color: UNGROUPED_COLOR, rows: none });
      return cols;
    }
    if (groupBy === "owner") {
      const byKey = new Map<string, TaskRow[]>();
      for (const t of filtered) {
        const k = t.assigneeId != null ? String(t.assigneeId) : "__none__";
        const arr = byKey.get(k) ?? [];
        arr.push(t);
        byKey.set(k, arr);
      }
      const lanes = [...byKey.entries()]
        .filter(([k]) => k !== "__none__")
        .sort((a, b) => b[1].length - a[1].length)
        .map(([k, rows]) => ({
          key: k,
          label: usersById.get(Number(k)) ?? rows[0]?.assigneeName ?? `User ${k}`,
          color: OWNER_LANE_COLOR,
          rows,
        }));
      const none = byKey.get("__none__");
      if (none && none.length > 0) lanes.push({ key: "__none__", label: "Unassigned", color: UNGROUPED_COLOR, rows: none });
      return lanes;
    }
    if (groupBy === "department") {
      const byKey = new Map<string, TaskRow[]>();
      for (const t of filtered) {
        const dept = ((t as Record<string, unknown>).cftDept as string | null | undefined)?.trim() || "__none__";
        const arr = byKey.get(dept) ?? []; arr.push(t); byKey.set(dept, arr);
      }
      const lanes = [...byKey.entries()]
        .filter(([k]) => k !== "__none__")
        .sort((a, b) => b[1].length - a[1].length)
        .map(([k, rows]) => ({ key: k, label: k, color: "#6366F1", rows }));
      const none = byKey.get("__none__");
      if (none && none.length > 0) lanes.push({ key: "__none__", label: "No department", color: UNGROUPED_COLOR, rows: none });
      return lanes;
    }
    // status (default)
    return TASK_STATUSES.map((s) => ({
      key: s.value, label: s.label, color: KANBAN_STATUS_COLOR[s.value] ?? s.solid,
      rows: filtered.filter((t) => t.status === s.value),
    }));
  }, [groupBy, filtered, usersById]);

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

  // Per-task subtask expansion — default: collapsed (subtasks hidden until clicked).
  // Map now tracks *opened* tasks; absence = collapsed.
  const [closedTasks, setClosedTasks] = useState<Record<number, boolean>>({});
  const toggleTask = (id: number) => setClosedTasks((c) => ({ ...c, [id]: !c[id] }));

  // Column order + widths are owned per-table by each <ExcelGroupTable> instance
  // (keyed by milestone group), so reordering / resizing one milestone's table
  // never affects the others.

  const subtaskCount = filtered.reduce((s, t) => s + (subtasksByParent.get(t.id)?.length ?? 0), 0);

  // One <tr> — shared by parent tasks and (indented) subtasks.
  const TaskTr = ({ t, depth, cols, isLast }: { t: TaskRow; depth: number; cols: ExcelCol[]; isLast?: boolean }) => {
    const subs = subtasksByParent.get(t.id) ?? [];
    const st = taskStatusOf(t.status);
    const pr = PRIORITY_BY_VALUE.get(t.priority as never);
    const open = !!closedTasks[t.id];
    // One <td> per column key — rendered in the current (drag-reorderable) order.
    const cell = (key: string) => {
      switch (key) {
        case "code": {
          // Tree connector — one continuous spine flowing through the cell rows,
          // linking each subtask code to its parent. The spine drops from the
          // *middle* of the parent's "TSK" label (BASE + indent + MID); children
          // indent by STEP so the curved tick still flows rightward into them.
          // Anchored to the <td> so it spans the full cell height (incl. borders).
          const BASE = 8, STEP = 26, MID = 13;          // px-2 pad, per-level indent, spine offset into "TSK"
          const spineX = BASE + (depth - 1) * STEP + MID; // parent code mid (for this child row)
          return (
            <td key="code" className="relative border border-gray-200 px-2 py-0.5 font-mono text-[11px] font-semibold text-gray-800 whitespace-nowrap">
              {open && subs.length > 0 && (
                // Parent: spine descends from just *below* its code (not through it) toward the subtasks.
                <span aria-hidden className="absolute w-px bg-gray-400" style={{ left: BASE + depth * STEP + MID, top: "calc(50% + 8px)", bottom: -1 }} />
              )}
              {depth > 0 && (
                <>
                  <span aria-hidden className="absolute w-px bg-gray-400" style={{ left: spineX, top: -1, ...(isLast ? { height: "calc(50% + 1px)" } : { bottom: -1 }) }} />
                  {/* square elbow tick into the code — stops ~4px short of "TSK" */}
                  <span aria-hidden className="absolute h-px bg-gray-400" style={{ left: spineX, top: "50%", width: STEP - MID - 4 }} />
                </>
              )}
              <span className="relative flex items-center gap-1.5" style={{ paddingLeft: depth * STEP }}>
                <span className={`${depth > 0 ? "text-gray-500" : ""} bg-inherit`}>{taskCode(t)}</span>
              </span>
            </td>
          );
        }
        case "name":
          return (
            <td key="name" className="border border-gray-200 px-2 py-0.5 font-medium text-gray-800">
              <span className="flex items-center gap-1 min-w-0" style={{ paddingLeft: depth * 14 }}>
                {depth === 0 ? (
                  // Top-level rows are always expandable (to reveal subtasks or the
                  // "add subtask" row), so show the chevron on every parent — on
                  // hover when collapsed, persistent when open.
                  <ChevronDown size={12} className={`shrink-0 text-gray-400 transition-all ${open ? "" : "-rotate-90"} ${open ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`} />
                ) : (
                  <span className="w-3 shrink-0 mr-0.5" />
                )}
                {depth > 0 ? (
                  <span className="group/sub flex items-center gap-1 min-w-0">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setOpenTaskId(t.id); }}
                      className="whitespace-normal break-words text-left font-normal text-gray-700 hover:text-primary hover:underline"
                      title={t.name}
                    >{t.name}</button>
                    <button
                      type="button"
                      title="Clone task"
                      onClick={(e) => { e.stopPropagation(); cloneTask(t); }}
                      className="shrink-0 opacity-0 group-hover/sub:opacity-100 p-0.5 rounded text-gray-400 hover:text-primary hover:bg-blue-50 transition"
                    >
                      <Copy size={12} />
                    </button>
                    <button
                      type="button"
                      title="Delete subtask"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm(`Delete subtask "${t.name}"?`)) deleteTask.mutate({ id: t.id } as never);
                      }}
                      className="shrink-0 opacity-0 group-hover/sub:opacity-100 p-0.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition"
                    >
                      <Trash2 size={12} />
                    </button>
                  </span>
                ) : (
                  <span className="group/top flex items-center gap-1 min-w-0">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setOpenTaskId(t.id); }}
                      className="whitespace-normal break-words text-left hover:text-primary hover:underline"
                      title={t.name}
                    >{t.name}</button>
                    <button
                      type="button"
                      title="Clone task"
                      onClick={(e) => { e.stopPropagation(); cloneTask(t); }}
                      className="shrink-0 opacity-0 group-hover/top:opacity-100 p-0.5 rounded text-gray-400 hover:text-primary hover:bg-blue-50 transition"
                    >
                      <Copy size={12} />
                    </button>
                  </span>
                )}
              </span>
            </td>
          );
        case "owner":
          return <td key="owner" className="border border-gray-200 px-2 py-0.5 text-center"><OwnerSelect task={t} users={users} updateTask={updateTask} currentName={assigneeName(t)} /></td>;
        case "status":
          return (
            <td key="status" className="border border-gray-200 px-0 py-0 text-center whitespace-nowrap relative" style={{ background: st.bg, color: st.color }}>
              <StatusDropdown task={t} updateTask={updateTask} />
            </td>
          );
        case "priority":
          return (
            <td key="priority" className="border border-gray-200 px-0 py-0 text-center whitespace-nowrap relative" style={pr ? { background: pr.bg, color: pr.color } : undefined}>
              <PriorityDropdown task={t} updateTask={updateTask} />
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
          return <td key="timeline" className="border border-gray-200 px-2 py-0.5 whitespace-nowrap"><TimelineEditCell task={t} updateTask={updateTask} /></td>;
        default:
          return <td key={key} className="border border-gray-200 px-2 py-0.5" />;
      }
    };
    return (
      <>
        <tr
          className={`group transition-colors ${depth > 0 ? "bg-gray-50/70 hover:bg-gray-100/70" : "bg-white hover:bg-gray-50"} ${(depth === 0 || subs.length > 0) ? "cursor-pointer" : ""}`}
          onClick={() => (depth === 0 || subs.length > 0) && toggleTask(t.id)}
        >
          {cols.map((c) => cell(c.key))}
        </tr>
        {open && subs.map((s, i) => <TaskTr key={s.id} t={s} depth={depth + 1} cols={cols} isLast={i === subs.length - 1} />)}
        {open && depth === 0 && (
          <AddSubtaskRow parent={t} projectId={projectId} colSpan={cols.length} indent={(depth + 1) * 14 + 16} createTask={createTask} />
        )}
      </>
    );
  };

  const isLoading = loadingProject || loadingTasks;

  return (
    <div className="space-y-2">
      {/* Header — back to Projects + project identity */}
      <div className="relative flex items-center justify-between gap-3 flex-wrap ph-rise">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => goBack("/projects")}
            title="Back"
            className="w-8 h-8 rounded-lg border border-border bg-card/70 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
          >
            <ChevronLeft size={16} />
          </button>
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
            className="h-7 px-2 rounded-lg flex items-center gap-1 text-[11px] font-semibold glass-surface lift-card text-primary hover:bg-primary/10 transition-colors"
          >
            <FolderOpen size={12} />
            Documents
          </button>

          {/* Generate Live Charter — fresh PDF (scope · out-of-scope · background ·
              current status · timeline) built from the latest project data. */}
          <button
            type="button"
            onClick={() => void generateLiveCharter()}
            disabled={genBusy}
            title="Generate a live PDF charter (In Scope · Out of Scope · Background · Current Status · Timeline) from the latest data"
            className="h-7 px-2 rounded-lg flex items-center gap-1 text-[11px] font-semibold border border-border bg-card/70 text-foreground hover:bg-accent disabled:opacity-50 transition-colors"
          >
            {genBusy ? <Loader2 size={12} className="animate-spin" /> : <FileDown size={12} />}
            Live Project Report
          </button>

          <div className="flex items-center gap-0.5 glass-surface lift-card rounded-lg p-0.5">
            {([
              { key: "tasks", label: "Tasks", Icon: ListTree },
              { key: "team", label: "Team", Icon: Users },
            ] as const).map(({ key, label, Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setSection(key)}
                className={`h-6 px-2 rounded-md flex items-center gap-1 text-[11px] font-semibold transition-colors ${
                  section === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent"
                }`}
              >
                <Icon size={12} />
                {label}
              </button>
            ))}
          </div>
        </div>

      </div>

      {section === "team" && <TeamTab projectId={projectId} />}

      {section === "tasks" && (<>
      {/* ── Toolbar: Search + View switcher (left) · Filters (right) ───────── */}
      <div className="glass-surface lift-card ph-rise rounded-xl px-2.5 py-1.5 flex flex-wrap items-center gap-x-2 gap-y-2 w-fit max-w-full relative z-50">
        {/* Search — icon button that expands into an inline field, left of the toggles */}
        {searchOpen ? (
          <div ref={searchRef} className="flex items-center gap-1.5 px-3 h-6 rounded-full bg-card border border-primary/30 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/10 transition-colors">
            <Search size={14} className="shrink-0 text-primary" />
            <Input
              autoFocus
              placeholder="Search tasks…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") { setSearch(""); setSearchOpen(false); } }}
              className="h-6 w-80 text-[12px] border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 px-0"
            />
            <button type="button" onClick={() => { setSearch(""); setSearchOpen(false); }} title="Close search" className="shrink-0 text-muted-foreground hover:text-foreground">
              <X size={15} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            title="Search"
            className={`h-6 px-1.5 rounded-md flex items-center gap-1 text-[11px] font-medium transition-colors ${search ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-accent"}`}
          >
            <Search size={13} />
          </button>
        )}

        {/* View switcher — Overview · Table · Gantt (borderless segmented pills) */}
        <div className="flex items-center gap-0.5 rounded-lg p-0.5">
          {([
            { key: "overview", label: "Overview", Icon: LayoutDashboard },
            { key: "table", label: "Table", Icon: Table2 },
            { key: "kanban", label: "Kanban", Icon: LayoutGrid },
            { key: "gantt", label: "Gantt", Icon: GanttChartSquare },
            { key: "calendar", label: "Calendar", Icon: CalendarDays },
          ] as const).map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              title={`${label} view`}
              className={`h-6 px-2 rounded-md flex items-center gap-1 text-[11px] font-medium transition-colors ${
                view === key ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-accent"
              }`}
            >
              <Icon size={13} />
              {label}
            </button>
          ))}

          {/* Group by (Kanban only) — Action Centre PillSelect: Status / Owner / Priority / Department */}
          {view === "kanban" && (
            <div className="ml-1">
              <GroupByPill<GroupByAxis>
                value={groupBy}
                onChange={setGroupBy}
                options={GROUP_BY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              />
            </div>
          )}

          {/* Divider, then the two filters — same grey group as the view tabs */}
          <span className="w-px h-4 bg-border/70 mx-1 self-center" />

          {/* Milestone filter */}
          <div className="relative" ref={filterRef}>
            <button
              type="button"
              onClick={() => { setFilterOpen((o) => !o); setPrioOpen(false); }}
              title="Filter tasks by milestone"
              className={`h-6 pl-2 pr-1.5 rounded-md flex items-center gap-1 text-[11px] transition-colors ${
                milestone ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-accent"
              }`}
            >
              <Milestone size={12} />
              <span className="font-medium">Milestone</span>
              <ChevronDown size={12} className={`opacity-60 transition-transform ${filterOpen ? "rotate-180" : ""}`} />
            </button>
            {filterOpen && (
              <div className="absolute left-0 top-full mt-1.5 z-50 w-56 max-h-72 overflow-y-auto rounded-md py-1 bg-popover text-popover-foreground border border-popover-border shadow-lg">
                <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Filter by milestone</div>
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
              title="Filter tasks by priority"
              className={`h-6 pl-2 pr-1.5 rounded-md flex items-center gap-1 text-[11px] transition-colors ${
                priority ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-accent"
              }`}
            >
              <Flag size={12} />
              <span className="font-medium">Priority</span>
              <ChevronDown size={12} className={`opacity-60 transition-transform ${prioOpen ? "rotate-180" : ""}`} />
            </button>
            {prioOpen && (
              <div className="absolute left-0 top-full mt-1.5 z-50 w-48 rounded-md py-1 bg-popover text-popover-foreground border border-popover-border shadow-lg">
                <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Filter by priority</div>
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

          {/* Issues — opens this project's issues register */}
          <button
            type="button"
            onClick={() => setIssuesPanelOpen(true)}
            title="Open this project's issues"
            className="h-6 pl-2 pr-2 rounded-md flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <AlertTriangle size={12} />
            <span className="font-medium">Issues</span>
          </button>

          {/* Clear filters — only when a filter is active */}
          {(milestone || priority) && (
            <button
              type="button"
              onClick={() => { setMilestone(""); setPriority(""); }}
              title="Clear all filters"
              className="h-6 px-1.5 rounded-md flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <X size={12} /> Clear
            </button>
          )}
        </div>

        {/* Task-Gantt legend — one hover explainer per bar colour (Gantt only) */}
        {view === "gantt" && (
          <div className="flex items-center gap-2 pl-1.5 ml-0.5 border-l border-border/60">
            {TASK_GANTT_LEGEND.map((l) => (
              <HoverHint key={l.label} title={l.label} footer={l.desc}>
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground whitespace-nowrap cursor-help">
                  <span className="w-2 h-2 rounded-sm" style={{ background: l.color }} />
                  {l.label}
                  <Info size={9} className="opacity-40" />
                </span>
              </HoverHint>
            ))}
          </div>
        )}

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
      ) : view === "kanban" ? (
        <KanbanView<TaskRow>
          groups={kanbanGroups}
          columns={TASK_BOARD_COLUMNS}
          colWidth={320}
          sectionStyle="ac"
          tintBody={groupBy === "priority"}
          getRowId={(t) => `task:${t.id}`}
          getName={(t) => <span className="font-medium">{t.name}</span>}
          renderCard={(t) => {
            const completed = t.status === "completed";
            const overdue = !completed && !!t.endDate && new Date(t.endDate).getTime() < new Date().setHours(0, 0, 0, 0);
            const photo = t.assigneeId != null ? ((users.find((u) => u.id === t.assigneeId) as { photoUrl?: string | null } | undefined)?.photoUrl ?? null) : null;
            const meta = [taskCode(t), t.milestoneId != null ? msNameById.get(t.milestoneId) : null].filter(Boolean).join(" · ");
            const pct = (t as Record<string, unknown>).progressPct as number | undefined;
            return (
              <ActionCard
                meta={meta}
                title={t.name}
                ownerName={assigneeName(t)}
                ownerPhoto={photo}
                priority={t.priority}
                dueDate={t.endDate}
                progressPct={pct ?? null}
                completed={completed}
                overdue={overdue}
              />
            );
          }}
          onOpenRow={(t) => setOpenTaskId(t.id)}
          onMoveToGroup={(rowId, groupKey) => {
            const id = Number(rowId.replace("task:", ""));
            if (!Number.isFinite(id)) return;
            if (groupBy === "owner") {
              // Reassign — drop onto an owner lane (or Unassigned).
              const assigneeId = groupKey === "__none__" ? null : Number(groupKey);
              updateTask.mutate({ id, data: { assigneeId } as never });
            } else if (groupBy === "priority") {
              // Re-prioritise — can't blank a priority, so ignore the No-priority lane.
              if (groupKey === "__none__") return;
              updateTask.mutate({ id, data: { priority: groupKey } as never });
            } else if (groupBy === "department") {
              // Re-assign the task's CFT department (No-department lane → ignore).
              if (groupKey === "__none__") return;
              updateTask.mutate({ id, data: { cftDept: groupKey } as never });
            } else {
              // Status move — gated behind a justification (CXO board parity).
              setMoveJustify({ id, to: groupKey, toLabel: STATUS_BY_VALUE.get(groupKey as never)?.label ?? groupKey });
            }
          }}
        />
      ) : view === "calendar" ? (
        <CalendarView<CalendarItem>
          items={filtered.map((t) => ({ id: t.id, date: t.endDate ?? t.startDate ?? null, title: t.name, status: t.status }))}
          onOpenItem={(it) => setOpenTaskId(Number(it.id))}
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
                <div className="flex items-center gap-2 mb-2 px-0.5 group/header">
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.key)}
                    className="flex items-center gap-2 flex-1 min-w-0 text-left"
                  >
                    <ChevronDown size={15} className={`text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`} />
                    <Milestone size={14} className="shrink-0" style={{ color: group.color }} />
                    <h3 className="text-sm font-semibold text-foreground">{group.label}</h3>
                    <span className="text-xs text-muted-foreground">({group.rows.length} task{group.rows.length === 1 ? "" : "s"})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAddFor({ milestoneId: group.key === "__none__" ? null : Number(group.key) })}
                    title={`Add a task to ${group.label}`}
                    className="inline-flex items-center gap-1 px-2 h-6 rounded-md text-[11px] font-medium text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors shrink-0"
                  >
                    <Plus size={13} /> Add task
                  </button>
                </div>

                {open && (
                  <ExcelGroupTable
                    cols={COLS}
                    accent={group.color}
                    storageKey={`ph:project-tasks:tbl:${group.key}`}
                    renderHeaderLabel={(c) => c.key === "code" ? (
                      <span className="inline-flex items-center gap-1">
                        {c.header}
                        <HoverHint
                          title="How task codes are formed"
                          footer={<>“TSK-” + the task's zero-padded database ID (e.g. <b className="text-popover-foreground">TSK-0042</b>) — generated automatically and stable for the life of the task.</>}
                        >
                          <span className="inline-flex cursor-help pointer-events-auto" aria-label="How task codes are formed">
                            <Info size={10} className="opacity-60" />
                          </span>
                        </HoverHint>
                      </span>
                    ) : c.header}
                  >
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

      {moveJustify && (
        <MoveJustifyModal
          toLabel={moveJustify.toLabel}
          pending={movingPending}
          onCancel={() => { setMoveJustify(null); void refetchTasks(); }}
          onConfirm={async (reason) => {
            const mv = moveJustify;
            setMovingPending(true);
            try {
              await updateTask.mutateAsync({ id: mv.id, data: { status: mv.to } as never });
              try {
                await fetch(`/api/projects/${projectId}/messages`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ senderId: currentUserId, taskId: mv.id, body: `Status → ${mv.toLabel}: ${reason}` }),
                });
              } catch { /* justification comment is best-effort */ }
            } finally {
              setMovingPending(false);
              setMoveJustify(null);
              void refetchTasks();
            }
          }}
        />
      )}

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
          onOpenTask={(id) => setOpenTaskId(id)}
          onRefresh={() => { void refetchTasks(); }}
        />
      )}

      {addFor && (
        <TaskCreateModal
          key={addFor === "generic" ? "generic" : `ms-${addFor.milestoneId}`}
          open
          onClose={() => setAddFor(null)}
          projectId={projectId}
          milestones={(rawMilestones ?? []) as Array<{ id: number; name: string }>}
          users={users}
          createTask={createTask}
          milestonePreset={addFor === "generic" ? undefined : addFor.milestoneId}
          onCreated={(id) => setOpenTaskId(id)}
        />
      )}

      {/* Project Documents modal — the full document repository for this
          project, reusing the same DocumentsTab as the Documents page. */}
      <Dialog open={docsOpen} onOpenChange={(v) => { if (!v) { setDocsOpen(false); setDocsUploadOpen(false); } }}>
        <DialogContent className="max-w-5xl w-[92vw] h-[88vh] flex flex-col p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-5 py-3 border-b border-border/60 flex-shrink-0">
            <DialogTitle className="flex items-center gap-2 tracking-tight text-base pr-10">
              <FolderOpen size={16} className="text-primary" />
              <span className="truncate">Documents · {project?.name ?? "Project"}</span>
              <button
                type="button"
                onClick={() => setDocsUploadOpen(true)}
                className="ml-auto mr-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm"
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
              showSearch={false}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Issues — raise + manage this project's issues */}
      <Dialog open={issuesPanelOpen} onOpenChange={(v) => { if (!v) setIssuesPanelOpen(false); }}>
        <DialogContent className="max-w-3xl w-[88vw] max-h-[88vh] flex flex-col p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-4 py-2 border-b border-border/60 flex-shrink-0">
            <DialogTitle className="flex items-center gap-2 tracking-tight text-sm pr-10">
              <AlertTriangle size={14} className="text-primary" />
              <span className="truncate">Issues · {project?.name ?? "Project"}</span>
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-auto scrollbar-thin p-3 space-y-3">
            <RaiseIssueForm projectId={projectId} />
            <IssuesTab projectId={projectId} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
