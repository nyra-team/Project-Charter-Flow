import { useMemo, useState, useEffect, useRef } from "react";
import { HoverHint, StatusChip } from "@/components/ui-kit";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useListProjects, useListUsers, useListCharters, useListAllProjectTeamMembers } from "@workspace/api-client-react";
import { Link, useLocation } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "../lib/format";
import { BarChart2, Search, ChevronDown, ChevronLeft, ChevronRight, Filter, Columns3, Check, Plus, Table2, LayoutGrid, GanttChartSquare, CalendarClock, Building2, Flag, Info, ListChecks, GripVertical, MessageSquare, BellRing, Loader2 } from "lucide-react";
import {
  DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors,
  pointerWithin, rectIntersection, defaultDropAnimationSideEffects,
  type DropAnimation, type CollisionDetection,
  type DragStartEvent, type DragOverEvent, type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, useSortable, arrayMove, horizontalListSortingStrategy,
  verticalListSortingStrategy, sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { TASK_PRIORITIES } from "../lib/task-constants";
import { createPortal } from "react-dom";
import { JiraImportButton } from "../components/jira-sync";
import { useUserView } from "../hooks/use-user-view";
import { type BoardGroup, type BoardColumn, ProgressCell, DateCell } from "@/components/monday";
import { KanbanView as ProjectsKanbanBoard } from "@/components/monday/KanbanView";
import { ProjectCommsDrawer, type ProjectCommsTab } from "@/components/ProjectCommsDrawer";
import { useUserStore } from "../lib/store";
import { PriorityChip, RagDot } from "@/components/task-status-chip";
import { MondayGantt, type GanttGroup, type GanttItem } from "@/components/monday-gantt";
import { ExcelGroupTable } from "@/components/excel-group-table";
import { fireConfetti } from "../lib/confetti";


// Structural subset of a project row — the fields the board reads. Real
// useListProjects rows are a superset, so they assign cleanly.
interface ProjectRow {
  id: number;
  name: string;
  description?: string | null;
  status: string;
  priority: string;
  ragStatus?: string | null;
  progress?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  projectManagerId?: number | null;
  charterId?: number | null;
  jiraKey?: string | null;
  capexBudget?: number | null;
  opexBudget?: number | null;
  function?: string | null;
}

// Per-project task rollup the "Tasks" + "Task Status" columns render.
type TaskAgg = { total: number; done: number; in_progress: number; delayed: number; on_hold: number; not_started: number };

// Monday-style project code — no dedicated column in pmo_projects, so derive a
// stable code from the PK (or surface the linked Jira key when present).
export function projectCode(p: Pick<ProjectRow, "id" | "jiraKey">): string {
  return p.jiraKey?.trim() || `PRJ-${String(p.id).padStart(4, "0")}`;
}

// Card-cell config for the (Jira-style) Kanban board — the same compact stack of
// Status / Priority / Health / Progress / Due cells shown on each project card.
const PROJECT_COLUMNS: BoardColumn<ProjectRow>[] = [
  { key: "status", header: "Status", width: 130, align: "center", render: (p) => <StatusChip status={p.status} size="sm" /> },
  { key: "priority", header: "Priority", width: 96, align: "center", render: (p) => <PriorityChip priority={p.priority} /> },
  { key: "rag", header: "Health", width: 60, align: "center", render: (p) => <RagDot rag={p.ragStatus ?? "green"} /> },
  { key: "progress", header: "Progress", width: 130, render: (p) => <ProgressCell pct={p.progress ?? 0} /> },
  { key: "due", header: "Due", width: 84, align: "center", render: (p) => <DateCell value={p.endDate} /> },
];

// Compact multi-segment task-status bar (completed / in-progress / delayed /
// on-hold / not-started), Monday-style.
function TaskStatusBar({ agg }: { agg?: TaskAgg }) {
  if (!agg || agg.total === 0) return <span className="text-[10px] text-gray-400">No tasks</span>;
  const seg = [
    { n: agg.done, c: "#10B981" },
    { n: agg.in_progress, c: "#6366F1" },
    { n: agg.delayed, c: "#EF4444" },
    { n: agg.on_hold, c: "#94A3B8" },
    { n: agg.not_started, c: "#CBD5E1" },
  ].filter(s => s.n > 0);
  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex h-2 flex-1 min-w-[60px] rounded-full overflow-hidden bg-gray-200" title={`${agg.done} done · ${agg.in_progress} in progress · ${agg.delayed} delayed · ${agg.on_hold} on hold · ${agg.not_started} not started`}>
        {seg.map((s, i) => <div key={i} style={{ width: `${(s.n / agg.total) * 100}%`, background: s.c }} />)}
      </div>
      <span className="text-[10px] font-semibold text-gray-700 tabular-nums whitespace-nowrap">{agg.done}/{agg.total}</span>
    </div>
  );
}

// Break a date string (YYYY-MM-DD / ISO) into day / short-month / year parts,
// parsed positionally to avoid timezone drift on date-only strings.
const MON_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function dateParts(s: string) {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return { day: String(d ?? 1).padStart(2, "0"), monIdx: m ?? 1, mon: MON_SHORT[(m ?? 1) - 1] ?? "", year: y ?? 0, yy: String(y ?? 0).slice(2) };
}

// Timeline cell — start → end range inside a pill. Compacts when the two dates
// share a month ("05→12 Jun"); widens to "05 Jun → 12 Jul" across months, and
// adds the year ("05 Jun 25 → 12 Jan 26") when the years differ.
export function TimelineCell({ start, end }: { start?: string | null; end?: string | null }) {
  if (!start && !end) return <span className="text-[11px] text-gray-400">—</span>;
  let text: string;
  if (start && end) {
    const a = dateParts(start), b = dateParts(end);
    if (a.year === b.year && a.monIdx === b.monIdx) {
      text = `${a.day}→${b.day} ${a.mon}`;
    } else if (a.year === b.year) {
      text = `${a.day} ${a.mon} → ${b.day} ${b.mon}`;
    } else {
      text = `${a.day} ${a.mon} ${a.yy} → ${b.day} ${b.mon} ${b.yy}`;
    }
  } else {
    const o = dateParts((start ?? end)!);
    text = `${o.day} ${o.mon} ${o.yy}`;
  }
  return (
    <span className="flex w-full items-center justify-center rounded-full bg-gray-100 border border-gray-200 px-2 h-5 text-[11px] text-gray-700 whitespace-nowrap">
      {text}
    </span>
  );
}

// Initials + a deterministic colour from a name, profile-picture style.
function nameInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return ((parts[0]![0] ?? "") + (parts[parts.length - 1]![0] ?? "")).toUpperCase();
}
const AVATAR_COLORS = ["#6366F1", "#F59E0B", "#10B981", "#EF4444", "#8B5CF6", "#0EA5E9", "#EC4899", "#14B8A6", "#F97316"];
function colorFromName(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}

// Owner/Manager rendered as a profile-style avatar: the person's photo (from the
// directory / master DB, via /api/users `photoUrl`) when one exists, otherwise
// initials on a colour-filled circle. Hovering shows the full name.
export function PersonCell({ name, photoUrl }: { name?: string | null; photoUrl?: string | null }) {
  if (!name) {
    return (
      <HoverHint label="Unassigned">
        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[9px] font-semibold bg-gray-100 text-gray-400 border border-gray-200">—</span>
      </HoverHint>
    );
  }
  if (photoUrl) {
    return (
      <HoverHint label={name}>
        <img src={photoUrl} alt={name} className="w-5 h-5 rounded-full object-cover border border-gray-200 shadow-sm" />
      </HoverHint>
    );
  }
  return (
    <HoverHint label={name}>
      <span
        className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[9px] font-semibold text-white shadow-sm cursor-default select-none"
        style={{ background: colorFromName(name) }}
      >
        {nameInitials(name)}
      </span>
    </HoverHint>
  );
}

// Board "Team" column shape — the subset of a project team member the avatar
// stack + popover need. Replaces the old separate Owner / Manager columns.
type BoardTeamMember = {
  id: number; projectId: number; memberType: "internal" | "external";
  userId?: number | null; externalName?: string | null; externalOrg?: string | null;
  externalKind?: string | null; role?: string | null;
};

// One roster group (Internal / External) inside the Team popover.
function TeamRoster({ label, list, nameOf, photoOf }: {
  label: string; list: BoardTeamMember[];
  nameOf: (m: BoardTeamMember) => string; photoOf: (m: BoardTeamMember) => string | null;
}) {
  if (list.length === 0) return null;
  return (
    <div className="px-3 py-1">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      {list.map((m) => {
        const ph = photoOf(m); const nm = nameOf(m);
        return (
          <div key={m.id} className="flex items-center gap-2 py-0.5">
            {ph
              ? <img src={ph} alt={nm} className="w-5 h-5 rounded-full object-cover" />
              : <span className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[8px] font-semibold text-white shrink-0" style={{ background: m.memberType === "internal" ? colorFromName(nm) : "#0d9488" }}>{nameInitials(nm)}</span>}
            <span className="text-xs text-foreground truncate flex-1">{nm}</span>
            {m.role && <span className="text-[10px] text-muted-foreground truncate max-w-[90px]">{m.role}</span>}
          </div>
        );
      })}
    </div>
  );
}

// Avatar-stack cell for the Projects-board "Team" column. Up to three avatars
// (internal = photo / initials, external = teal initials) + a "+N" overflow.
// Click opens a popover (fixed-positioned so it never clips inside the scrolling
// table) listing the Internal / External roster + a jump to the full Team tab.
function TeamCell({ members, nameById, photoById, onManage }: {
  members: BoardTeamMember[];
  nameById: Map<number, string>;
  photoById: Map<number, string>;
  onManage: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const nameOf = (m: BoardTeamMember) => m.memberType === "internal" ? (nameById.get(m.userId ?? -1) ?? `User ${m.userId}`) : (m.externalName ?? "—");
  const photoOf = (m: BoardTeamMember) => m.memberType === "internal" ? (photoById.get(m.userId ?? -1) ?? null) : null;

  if (members.length === 0) {
    return (
      <HoverHint label="No team yet — click to add">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onManage(); }}
          className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-400 border border-gray-200 hover:bg-gray-200"
        >+</button>
      </HoverHint>
    );
  }

  const internal = members.filter((m) => m.memberType === "internal");
  const external = members.filter((m) => m.memberType === "external");
  const shown = members.slice(0, 3);
  const overflow = members.length - shown.length;

  return (
    <div ref={wrapRef} className="inline-flex">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setPos({ top: r.bottom + 6, left: Math.max(8, r.left - 70) });
          setOpen((o) => !o);
        }}
        className="inline-flex items-center"
        title={`${members.length} team member${members.length === 1 ? "" : "s"}`}
      >
        <span className="flex -space-x-1.5">
          {shown.map((m) => {
            const ph = photoOf(m); const nm = nameOf(m);
            return ph
              ? <img key={m.id} src={ph} alt={nm} className="w-5 h-5 rounded-full object-cover border border-white shadow-sm" />
              : <span key={m.id} className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[8px] font-semibold text-white border border-white shadow-sm" style={{ background: m.memberType === "internal" ? colorFromName(nm) : "#0d9488" }}>{nameInitials(nm)}</span>;
          })}
          {overflow > 0 && <span className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[8px] font-semibold bg-gray-200 text-gray-600 border border-white shadow-sm">+{overflow}</span>}
        </span>
      </button>

      {open && pos && (
        <div
          className="fixed z-[60] w-60 rounded-lg bg-popover text-popover-foreground border border-popover-border shadow-xl py-2 text-left"
          style={{ top: pos.top, left: pos.left }}
          onClick={(e) => e.stopPropagation()}
        >
          <TeamRoster label={`Internal (${internal.length})`} list={internal} nameOf={nameOf} photoOf={photoOf} />
          <TeamRoster label={`External (${external.length})`} list={external} nameOf={nameOf} photoOf={photoOf} />
          <div className="px-3 pt-1.5 mt-1 border-t border-border/60">
            <button onClick={() => { setOpen(false); onManage(); }} className="text-xs font-semibold text-primary hover:underline">Manage team →</button>
          </div>
        </div>
      )}
    </div>
  );
}

// The only five statuses we surface: New · Active · Completed · Cancelled ·
// Postponed. Every raw DB status maps onto exactly one of these.
type DisplayStatus = { key: string; label: string; color: string };
const DISPLAY_STATUSES: DisplayStatus[] = [
  { key: "new",       label: "New",       color: "#94A3B8" }, // grey
  { key: "active",    label: "Active",    color: "#3B82F6" }, // blue
  { key: "completed", label: "Completed", color: "#16A34A" }, // green
  { key: "cancelled", label: "Cancelled", color: "#F97316" }, // orange
  { key: "postponed", label: "Postponed", color: "#EF4444" }, // red
];
const DISPLAY_BY_KEY = new Map(DISPLAY_STATUSES.map(d => [d.key, d]));

// Fixed column widths (px) so every status table lines up identically.
const COLS: { key: string; header: string; width: number; align?: "left" | "center" }[] = [
  { key: "code", header: "Project Code", width: 120 },
  { key: "name", header: "Project Name", width: 240 },
  { key: "team", header: "Team", width: 130, align: "center" },
  { key: "status", header: "Health", width: 116, align: "center" },
  { key: "justification", header: "Justification", width: 220, align: "left" },
  { key: "tasks", header: "Tasks", width: 64, align: "center" },
  { key: "taskStatus", header: "Task Status", width: 170 },
  { key: "timeline", header: "Timeline", width: 170 },
];
// Optional columns the user can add globally via the "Add column" menu.
type OptionalKey = "budget" | "description";
const OPTIONAL_COLS: { key: OptionalKey; header: string; width: number; align?: "left" | "center" }[] = [
  { key: "budget", header: "Budget", width: 130 },
  { key: "description", header: "Project Description", width: 300 },
];

// Map any raw project status onto one of the five display statuses.
function displayStatusOf(raw: string): DisplayStatus {
  switch (raw) {
    case "planning": case "new": case "draft": case "proposed":
      return DISPLAY_BY_KEY.get("new")!;
    case "active": case "in_progress": case "execution":
      return DISPLAY_BY_KEY.get("active")!;
    case "completed": case "closed": case "done":
      return DISPLAY_BY_KEY.get("completed")!;
    case "cancelled": case "canceled": case "rejected":
      return DISPLAY_BY_KEY.get("cancelled")!;
    case "on_hold": case "postponed": case "paused": case "deferred":
      return DISPLAY_BY_KEY.get("postponed")!;
    default:
      return DISPLAY_BY_KEY.get("active")!;
  }
}

// Project List filter shape — stored per saved view.
type ProjectsViewConfig = {
  search: string;
  status: string;           // "" | display-status key (new|active|completed|cancelled|postponed)
  sort: "updated" | "name" | "progress";
};

const FALLBACK: ProjectsViewConfig = { search: "", status: "", sort: "updated" };

// Filter chips — All + the five display statuses.
const STATUS_CHIPS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  ...DISPLAY_STATUSES.map(d => ({ value: d.key, label: d.label })),
];
// Priority filter — readable labels (Critical/High/Medium/Low); values stay
// P0–P3 to match how priority is stored on a project.
const PRIORITY_CHIPS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  ...TASK_PRIORITIES.map(p => ({ value: p.value, label: p.label })),
];
// localStorage key for the user's adjusted table column widths.
const PROJECTS_COLW_KEY = "ph:projects:colw";
const PROJECTS_COLORDER_KEY = "ph:projects:colorder";

const msTime = (s?: string | null) => (s ? new Date(s.slice(0, 10)).getTime() : null);

// Schedule health from the project RAG status.
function scheduleStatus(rag?: string | null): { label: string; color: string } {
  switch ((rag ?? "").toLowerCase()) {
    case "amber": case "yellow": return { label: "Off Track", color: "#F59E0B" };
    case "red": return { label: "Delayed", color: "#EF4444" };
    default: return { label: "On Track", color: "#16A34A" };
  }
}

// Computed schedule health for the table "Health" column — mirrors the dashboard.
//   • Delayed   — past the target end date and not complete.
//   • Off Track — task completion is >15 pts behind where the elapsed timeline expects.
//   • On Track  — otherwise.
// "Tasks behind" = how many more tasks the elapsed schedule expects done by now
// (expected = % of timeline elapsed × total tasks) minus those actually done.
// The `reason` string is shown on hover so the user sees exactly why.
type RowHealth = { key: "on_track" | "off_track" | "delayed" | "na" | "completed"; label: string; color: string; reason: string };
// Health-cell fill hues taken from the Action Centre (apps/cxo, :5190) RAG
// cell-fill SSOT (ActionItems.tsx STATUS_FILL): green #16A34A · amber #F59E0B ·
// red #DC2626 · slate #64748B — On Track→green, Off Track→amber, Delayed→red.
const HEALTH_COLORS = { on_track: "#16A34A", off_track: "#F59E0B", delayed: "#DC2626", na: "#64748B", completed: "#16A34A" } as const;
function scheduleHealth(p: ProjectRow, agg?: TaskAgg): RowHealth {
  const ds = displayStatusOf(p.status).key;
  const r = (n: number) => Math.round(n);
  if (ds === "cancelled" || ds === "postponed")
    return { key: "na", label: "—", color: HEALTH_COLORS.na, reason: `No schedule health for ${displayStatusOf(p.status).label.toLowerCase()} projects.` };

  const now = Date.now();
  const total = agg?.total ?? 0;
  const done = agg?.done ?? 0;
  const actualPct = total > 0 ? (done / total) * 100 : (p.progress ?? 0);

  if (ds === "completed")
    return { key: "completed", label: "Completed", color: HEALTH_COLORS.completed, reason: `Completed — all ${total} task(s) done.` };

  const start = msTime(p.startDate);
  const end = msTime(p.endDate);

  // Delayed — past the target end date and not complete.
  if (end != null && end < now) {
    const daysOverdue = Math.max(1, Math.ceil((now - end) / 86_400_000));
    const open = Math.max(0, total - done);
    return {
      key: "delayed", label: "Delayed", color: HEALTH_COLORS.delayed,
      reason: `${daysOverdue} day(s) past the target end date.\n${done}/${total} tasks complete (${r(actualPct)}%); ${open} task(s) still open past due.`,
    };
  }

  // Off Track — completion behind the elapsed-time expectation by more than 15 pts.
  let expectedPct = 0;
  if (start != null && end != null && end > start)
    expectedPct = Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100));
  const expectedDone = total > 0 ? Math.round((expectedPct / 100) * total) : 0;
  const tasksBehind = Math.max(0, expectedDone - done);
  const behindPct = expectedPct - actualPct;

  if (behindPct > 15)
    return {
      key: "off_track", label: "Off Track", color: HEALTH_COLORS.off_track,
      reason: `${tasksBehind} task(s) behind the expected pace.\nExpected ~${expectedDone}/${total} tasks done by now (${r(expectedPct)}% of the timeline elapsed); actual ${done}/${total} (${r(actualPct)}%).\nBehind by ${r(behindPct)} percentage points.`,
    };

  return {
    key: "on_track", label: "On Track", color: HEALTH_COLORS.on_track,
    reason: `${done}/${total} tasks done (${r(actualPct)}%) vs ~${r(expectedPct)}% expected by now — on pace.`,
  };
}

// Health cell with a styled, portal-rendered hover tooltip (escapes the table's
// overflow clipping). The cell keeps the filled tinted-box style; hovering pops
// a card explaining the calculation + the exact tasks-behind count.
function HealthCell({ health, align }: { health: RowHealth; align?: "left" | "center" }) {
  const ref = useRef<HTMLTableCellElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; below: boolean } | null>(null);
  // Cancelled / postponed projects have no schedule health — no tooltip.
  const hasTip = health.key !== "na";
  const show = () => {
    if (!hasTip) return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = r.top < 150;
    setTip({ x: r.left + r.width / 2, y: below ? r.bottom : r.top, below });
  };
  return (
    <td
      ref={ref}
      onMouseEnter={show}
      onMouseLeave={() => setTip(null)}
      className={`border border-gray-200 px-2 py-0.5 font-semibold text-[11px] ${hasTip ? "cursor-help" : "cursor-default"} ${align === "center" ? "text-center" : "text-left"}`}
      style={{ background: health.color, color: "#fff" }}
    >
      {health.label}
      {tip && createPortal(
        <div
          className="fixed z-[200] pointer-events-none w-52"
          style={{
            left: tip.x,
            top: tip.below ? tip.y + 6 : tip.y - 6,
            transform: `translateX(-50%)${tip.below ? "" : " translateY(-100%)"}`,
          }}
        >
          <div className="relative rounded-md border border-border bg-popover/95 backdrop-blur text-popover-foreground shadow-lg ring-1 ring-black/5 px-2 py-1.5 text-left">
            <div className="flex items-center gap-1 mb-0.5">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: health.color }} />
              <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: health.color }}>{health.label}</span>
            </div>
            <p className="text-[10px] leading-snug text-muted-foreground whitespace-pre-line">{health.reason}</p>
            {/* arrow */}
            <span
              className="absolute left-1/2 w-2 h-2 rotate-45 bg-popover border-border"
              style={tip.below
                ? { top: -4, marginLeft: -4, borderLeftWidth: 1, borderTopWidth: 1 }
                : { bottom: -4, marginLeft: -4, borderRightWidth: 1, borderBottomWidth: 1 }}
            />
          </div>
        </div>,
        document.body,
      )}
    </td>
  );
}

// "Health" column header with an info affordance — hovering explains how the
// On Track / Off Track / Delayed status is derived. Portal-rendered so the
// table's overflow clipping doesn't cut the tooltip off.
function HealthHeaderTip() {
  const ref = useRef<HTMLSpanElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; below: boolean } | null>(null);
  const show = () => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = r.top < 190;
    setTip({ x: r.left + r.width / 2, y: below ? r.bottom : r.top, below });
  };
  const Row = ({ color, name, children }: { color: string; name: string; children: React.ReactNode }) => (
    <li className="flex gap-1">
      <span className="w-1.5 h-1.5 rounded-full mt-1 shrink-0" style={{ background: color }} />
      <span><b className="text-foreground font-semibold">{name}</b> — {children}</span>
    </li>
  );
  return (
    <span
      ref={ref}
      onMouseEnter={show}
      onMouseLeave={() => setTip(null)}
      className="inline-flex items-center gap-1 cursor-help"
    >
      Health
      <Info size={10} className="opacity-60" />
      {tip && createPortal(
        <div
          className="fixed z-[200] pointer-events-none w-56"
          style={{
            left: tip.x,
            top: tip.below ? tip.y + 6 : tip.y - 6,
            transform: `translateX(-50%)${tip.below ? "" : " translateY(-100%)"}`,
          }}
        >
          <div className="relative rounded-md border border-border bg-popover/95 backdrop-blur text-popover-foreground shadow-lg ring-1 ring-black/5 px-2 py-1.5 text-left normal-case tracking-normal">
            <p className="text-[10px] font-bold text-foreground mb-1">How Health is calculated</p>
            <ul className="space-y-0.5 text-[10px] leading-snug text-muted-foreground">
              <Row color={HEALTH_COLORS.on_track} name="On Track">on or ahead of the elapsed-timeline pace.</Row>
              <Row color={HEALTH_COLORS.off_track} name="Off Track">&gt;15 pts behind the expected pace (= % of timeline elapsed × total tasks).</Row>
              <Row color={HEALTH_COLORS.delayed} name="Delayed">past the target end date and not yet complete.</Row>
            </ul>
            <span
              className="absolute left-1/2 w-2 h-2 rotate-45 bg-popover border-border"
              style={tip.below
                ? { top: -4, marginLeft: -4, borderLeftWidth: 1, borderTopWidth: 1 }
                : { bottom: -4, marginLeft: -4, borderRightWidth: 1, borderBottomWidth: 1 }}
            />
          </div>
        </div>,
        document.body,
      )}
    </span>
  );
}

// ── Kanban view — one column per status, project cards stacked within. ──────
// Priority chip lookup for the card header.
const PRIORITY_META = new Map(TASK_PRIORITIES.map((p) => [p.value, p]));

// dnd-kit id helpers — namespaced so a column id and a card id never collide.
const KANBAN_COLORDER_KEY = "ph:projects:kanban:colorder";
const colId = (k: string) => `col:${k}`;
const cardId = (id: number) => `card:${id}`;
const isCardId = (s: string) => s.startsWith("card:");
const cardPid = (s: string) => Number(s.slice(5));
const colKeyOf = (s: string) => (s.startsWith("col:") ? s.slice(4) : null);

// "Drop where the pointer actually is" — far more reliable for cross-column card
// moves than closestCorners (which can stick to the card's origin column). Falls
// back to rect intersection when the pointer is over a gap between lanes.
const kanbanCollision: CollisionDetection = (args) => {
  const pointer = pointerWithin(args);
  return pointer.length > 0 ? pointer : rectIntersection(args);
};

// Shared sortable transition — a touch longer than dnd-kit's default with a soft
// ease-out, so cards/columns glide when the board reshuffles around a drag.
const SORT_TRANSITION = { duration: 260, easing: "cubic-bezier(0.25, 1, 0.5, 1)" };

// Presentational Kanban card — the monday-style item card (shared by the live
// sortable card and the drag overlay).
function KanbanCardInner({ p, d, ownerName, ownerPhoto, taskAgg, overlay }: {
  p: ProjectRow; d: DisplayStatus;
  ownerName: (p: ProjectRow) => string | null;
  ownerPhoto: (p: ProjectRow) => string | null;
  taskAgg: Map<number, TaskAgg>;
  overlay?: boolean;
}) {
  const progress = Math.max(0, Math.min(100, Math.round(p.progress ?? 0)));
  const sched = d.key === "completed" ? { label: "Completed", color: d.color } : scheduleStatus(p.ragStatus);
  const owner = ownerName(p);
  const agg = taskAgg.get(p.id);
  const taskTotal = agg?.total ?? 0;
  const taskDone = agg?.done ?? 0;
  const pr = PRIORITY_META.get(p.priority as never);
  const budget = (p.capexBudget ?? 0) + (p.opexBudget ?? 0);
  const endMs = p.endDate ? new Date(p.endDate.slice(0, 10)).getTime() : null;
  const overdue = endMs != null && endMs < Date.now() && d.key !== "completed";
  const due = p.endDate ? (() => { const o = dateParts(p.endDate!); return `${o.day} ${o.mon} ${o.yy}`; })() : null;
  return (
    <div
      className={`bg-white rounded-lg border border-gray-200/80 ${overlay ? "shadow-[0_14px_30px_rgba(0,0,0,0.20)] rotate-[1.5deg]" : "shadow-[0_1px_3px_rgba(0,0,0,0.05)] group-hover:shadow-[0_8px_18px_rgba(0,0,0,0.10)] group-hover:-translate-y-0.5"} transition-all duration-150`}
      style={{ borderLeftWidth: 4, borderLeftColor: sched.color }}
    >
      <div className="p-3 pl-2.5">
        {/* Header — code + priority */}
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[9.5px] tracking-wide text-gray-400">{projectCode(p)}</span>
          {pr && (
            <span className="inline-flex items-center gap-1 rounded px-1.5 h-[15px] text-[8.5px] font-bold uppercase tracking-wide shrink-0" style={{ background: pr.bg, color: pr.color }}>
              <Flag size={8} />{pr.label}
            </span>
          )}
        </div>

        {/* Title */}
        <div className="mt-1 text-[13px] font-semibold text-gray-800 leading-snug line-clamp-2 group-hover:text-primary transition-colors">{p.name}</div>

        {/* Meta — department · budget */}
        {(p.function || budget > 0) && (
          <div className="mt-1 flex items-center gap-1.5 text-[10px] text-gray-400 min-w-0">
            {p.function && <span className="inline-flex items-center gap-1 truncate"><Building2 size={10} className="shrink-0" />{p.function}</span>}
            {p.function && budget > 0 && <span className="text-gray-300 shrink-0">·</span>}
            {budget > 0 && <span className="tabular-nums whitespace-nowrap shrink-0">{formatCurrency(budget)}</span>}
          </div>
        )}

        {/* Status — monday's signature solid full-width label */}
        <span className="mt-2.5 block w-full text-center rounded-[4px] py-[5px] text-[11px] font-semibold text-white truncate" style={{ background: sched.color }} title={sched.label}>{sched.label}</span>

        {/* Progress + task rollup */}
        <div className="mt-2.5">
          <div className="flex items-center justify-between text-[10px] mb-1">
            <span className="inline-flex items-center gap-1 text-gray-500"><ListChecks size={11} className="text-gray-400" />{taskDone}/{taskTotal} tasks</span>
            <span className="font-semibold text-gray-600 tabular-nums">{progress}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, background: d.color }} />
          </div>
        </div>
      </div>

      {/* Footer — owner + due date */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-gray-100">
        <div className="flex items-center gap-1.5 min-w-0">
          <PersonCell name={owner} photoUrl={ownerPhoto(p)} />
          <span className="text-[10.5px] text-gray-500 truncate">{owner ?? "Unassigned"}</span>
        </div>
        <span className={`inline-flex items-center gap-1 rounded-[4px] px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap shrink-0 ${overdue ? "bg-red-50 text-red-600" : "bg-gray-100 text-gray-500"}`} title={overdue ? "Overdue" : "Target date"}>
          <CalendarClock size={10} className={overdue ? "text-red-500" : "text-gray-400"} />{due ?? "No date"}
        </span>
      </div>
    </div>
  );
}

// Sortable (draggable) Kanban card. Drag to move between / within columns;
// a click (no movement past the sensor threshold) opens the project.
function KanbanSortableCard({ p, d, ownerName, ownerPhoto, taskAgg, onOpen }: {
  p: ProjectRow; d: DisplayStatus;
  ownerName: (p: ProjectRow) => string | null;
  ownerPhoto: (p: ProjectRow) => string | null;
  taskAgg: Map<number, TaskAgg>;
  onOpen: (id: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: cardId(p.id), data: { type: "card", col: d.key }, transition: SORT_TRANSITION });
  const style: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition, willChange: "transform" };
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(p.id)}
      className="group relative block w-full text-left cursor-grab active:cursor-grabbing touch-none"
    >
      {/* While dragging, the original becomes a Monday-style ghost slot — a
          dashed placeholder holding the gap; the floating copy lives in the
          DragOverlay. */}
      <div className={isDragging ? "opacity-0" : ""}>
        <KanbanCardInner p={p} d={d} ownerName={ownerName} ownerPhoto={ownerPhoto} taskAgg={taskAgg} />
      </div>
      {isDragging && (
        <div className="absolute inset-0 rounded-lg border-2 border-dashed border-gray-300/90 bg-gray-200/30" />
      )}
    </div>
  );
}

// Presentational column — used inside the DragOverlay so a dragged section
// floats smoothly (a clean snapshot) instead of the original jumping in place.
function KanbanColumnInner({ d, rows, ownerName, ownerPhoto, taskAgg }: {
  d: DisplayStatus; rows: ProjectRow[];
  ownerName: (p: ProjectRow) => string | null;
  ownerPhoto: (p: ProjectRow) => string | null;
  taskAgg: Map<number, TaskAgg>;
}) {
  const shown = rows.slice(0, 4);
  return (
    <div className="w-[284px] shrink-0 flex flex-col rounded-xl bg-[#f6f7fb] overflow-hidden shadow-2xl ring-1 ring-black/10 rotate-[2deg]">
      <div className="relative flex items-center justify-center h-9 text-white" style={{ background: d.color }}>
        <span className="text-[13px] font-semibold tracking-tight truncate px-9">{d.label}</span>
        <span className="absolute right-2 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-white/25 text-[11px] font-bold tabular-nums">{rows.length}</span>
      </div>
      <div className="flex-1 space-y-2.5 p-2.5 min-h-[72px]">
        {shown.map((p) => <KanbanCardInner key={p.id} p={p} d={d} ownerName={ownerName} ownerPhoto={ownerPhoto} taskAgg={taskAgg} />)}
        {rows.length > shown.length && (
          <div className="text-[11px] text-gray-400 text-center py-1">+{rows.length - shown.length} more</div>
        )}
      </div>
    </div>
  );
}

// Sortable (draggable) Kanban column. The coloured header is the drag handle so
// it reorders columns; the lane body is the droppable target for cards. When a
// card is dragged over the lane, it lights up in the column colour.
function KanbanSortableColumn({ d, rows, ownerName, ownerPhoto, taskAgg, onOpen, highlight }: {
  d: DisplayStatus; rows: ProjectRow[];
  ownerName: (p: ProjectRow) => string | null;
  ownerPhoto: (p: ProjectRow) => string | null;
  taskAgg: Map<number, TaskAgg>;
  onOpen: (id: number) => void;
  highlight?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: colId(d.key), data: { type: "column" }, transition: SORT_TRANSITION });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
    boxShadow: highlight ? `0 0 0 2px ${d.color}66, 0 10px 24px -14px ${d.color}55` : undefined,
    background: highlight ? `${d.color}0d` : undefined,
  };
  return (
    <div ref={setNodeRef} style={style} className="w-[284px] shrink-0 flex flex-col rounded-xl bg-[#f6f7fb] ring-1 ring-black/[0.04] overflow-hidden transition-[box-shadow,background-color] duration-200">
      {/* Column header = drag handle — full-width bar filled with the status
          colour (clipped to the rounded top corners), the name centred. */}
      <div
        {...attributes}
        {...listeners}
        title="Drag to reorder column"
        className="group/colh relative flex items-center justify-center h-9 text-white cursor-grab active:cursor-grabbing touch-none select-none"
        style={{ background: d.color }}
      >
        {/* subtle top sheen for depth */}
        <span aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/15 to-transparent" />
        <GripVertical size={13} className="absolute left-2 opacity-0 group-hover/colh:opacity-70 transition-opacity" />
        <span className="text-[13px] font-semibold tracking-tight truncate px-9">{d.label}</span>
        <span className="absolute right-2 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-white/25 text-[11px] font-bold tabular-nums">{rows.length}</span>
      </div>

      {/* Cards — droppable lane */}
      <div className="flex-1 space-y-2.5 p-2.5 min-h-[88px]">
        <SortableContext items={rows.map((p) => cardId(p.id))} strategy={verticalListSortingStrategy}>
          {rows.length === 0 && (
            <div
              className={`rounded-lg border-2 border-dashed text-[11px] text-center py-8 transition-colors duration-200 ${
                highlight ? "font-semibold" : "border-gray-200 bg-white/40 text-gray-400"
              }`}
              style={highlight ? { borderColor: `${d.color}99`, background: `${d.color}14`, color: d.color } : undefined}
            >
              {highlight ? "Release to move here" : "Drop here"}
            </div>
          )}
          {rows.map((p) => (
            <KanbanSortableCard key={p.id} p={p} d={d} ownerName={ownerName} ownerPhoto={ownerPhoto} taskAgg={taskAgg} onOpen={onOpen} />
          ))}
        </SortableContext>
        <button type="button" className="w-full flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] font-medium text-gray-400 hover:text-primary hover:bg-white transition-colors">
          <Plus size={13} /> Add project
        </button>
      </div>
    </div>
  );
}

// Projects Kanban — a faithful monday.com board clone with drag-and-drop. Cards
// drag between / within columns (a cross-column drop PATCHes the project status);
// columns reorder by dragging their coloured header (order persisted locally).
function KanbanView({ buckets, ownerName, ownerPhoto, taskAgg, onOpen, onMoveProject }: {
  buckets: Map<string, ProjectRow[]>;
  ownerName: (p: ProjectRow) => string | null;
  ownerPhoto: (p: ProjectRow) => string | null;
  taskAgg: Map<number, TaskAgg>;
  onOpen: (id: number) => void;
  onMoveProject: (id: number, statusKey: string) => void;
}) {
  const allKeys = useMemo(() => DISPLAY_STATUSES.map((d) => d.key), []);
  const [colOrder, setColOrder] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KANBAN_COLORDER_KEY) ?? "null");
      if (Array.isArray(saved)) {
        const valid = saved.filter((k: string) => allKeys.includes(k));
        const merged = [...valid, ...allKeys.filter((k) => !valid.includes(k))];
        if (merged.length === allKeys.length) return merged;
      }
    } catch { /* ignore */ }
    return allKeys;
  });

  // Local board state — mirrors `buckets` but is mutated live during a drag for
  // optimistic feedback. Re-synced from the server buckets whenever they change
  // and no drag is in flight.
  const buildItems = () => {
    const o: Record<string, ProjectRow[]> = {};
    for (const k of allKeys) o[k] = buckets.get(k) ?? [];
    return o;
  };
  const [items, setItems] = useState<Record<string, ProjectRow[]>>(buildItems);
  const [activeId, setActiveId] = useState<string | null>(null);
  const originColRef = useRef<string | null>(null);

  useEffect(() => {
    if (activeId) return; // don't clobber an in-progress drag
    setItems(buildItems());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buckets]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const colOfCard = (cidStr: string): string | null => {
    for (const k of allKeys) if ((items[k] ?? []).some((p) => cardId(p.id) === cidStr)) return k;
    return null;
  };

  const activeCardCol = activeId && isCardId(activeId) ? colOfCard(activeId) : null;
  const activeCard = activeCardCol
    ? (items[activeCardCol] ?? []).find((p) => cardId(p.id) === activeId) ?? null
    : null;

  function onDragStart(e: DragStartEvent) {
    const id = String(e.active.id);
    setActiveId(id);
    originColRef.current = isCardId(id) ? colOfCard(id) : null;
  }

  function onDragOver(e: DragOverEvent) {
    const { active, over } = e;
    if (!over) return;
    const activeStr = String(active.id);
    const overStr = String(over.id);
    if (!isCardId(activeStr)) return; // column drags resolve in onDragEnd
    const fromCol = colOfCard(activeStr);
    const toCol = colKeyOf(overStr) ?? colOfCard(overStr);
    if (!fromCol || !toCol || fromCol === toCol) return;
    setItems((prev) => {
      const from = [...(prev[fromCol] ?? [])];
      const to = [...(prev[toCol] ?? [])];
      const idx = from.findIndex((p) => cardId(p.id) === activeStr);
      if (idx < 0) return prev;
      const [moved] = from.splice(idx, 1);
      let insertAt = to.length;
      if (isCardId(overStr)) {
        const overIdx = to.findIndex((p) => cardId(p.id) === overStr);
        if (overIdx >= 0) insertAt = overIdx;
      }
      to.splice(insertAt, 0, moved);
      return { ...prev, [fromCol]: from, [toCol]: to };
    });
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    const activeStr = String(active.id);
    const origin = originColRef.current;
    originColRef.current = null;
    setActiveId(null);
    if (!over) return;
    const overStr = String(over.id);

    // Column reorder.
    if (!isCardId(activeStr)) {
      const a = colKeyOf(activeStr), b = colKeyOf(overStr);
      if (a && b && a !== b) {
        setColOrder((prev) => {
          const oldI = prev.indexOf(a), newI = prev.indexOf(b);
          if (oldI < 0 || newI < 0) return prev;
          const next = arrayMove(prev, oldI, newI);
          try { localStorage.setItem(KANBAN_COLORDER_KEY, JSON.stringify(next)); } catch { /* ignore */ }
          return next;
        });
      }
      return;
    }

    // Card: finalise same-column ordering, then persist a cross-column move.
    const nowCol = colOfCard(activeStr);
    if (nowCol && isCardId(overStr) && overStr !== activeStr) {
      const overCol = colOfCard(overStr);
      if (overCol === nowCol) {
        setItems((prev) => {
          const arr = [...(prev[nowCol] ?? [])];
          const oldI = arr.findIndex((p) => cardId(p.id) === activeStr);
          const newI = arr.findIndex((p) => cardId(p.id) === overStr);
          if (oldI < 0 || newI < 0) return prev;
          return { ...prev, [nowCol]: arrayMove(arr, oldI, newI) };
        });
      }
    }
    // Cross-column move. Prefer the live (over-driven) column; fall back to
    // resolving the drop target directly (covers drops onto an empty lane that
    // onDragOver never relocated the card into).
    const overCol = colKeyOf(overStr) ?? colOfCard(overStr);
    const targetCol =
      nowCol && origin && nowCol !== origin ? nowCol
      : overCol && origin && overCol !== origin ? overCol
      : null;
    if (targetCol) {
      // Ensure the local board reflects the move even if onDragOver didn't.
      const srcCol = nowCol ?? origin;
      if (srcCol && srcCol !== targetCol) {
        setItems((prev) => {
          const fromArr = [...(prev[srcCol] ?? [])];
          const idx = fromArr.findIndex((p) => cardId(p.id) === activeStr);
          if (idx < 0) return prev;
          const [moved] = fromArr.splice(idx, 1);
          return { ...prev, [srcCol]: fromArr, [targetCol]: [...(prev[targetCol] ?? []), moved] };
        });
      }
      onMoveProject(cardPid(activeStr), targetCol);
      // 🎉 dropped into the Done / Completed lane → celebrate.
      if (targetCol === "completed") fireConfetti();
    }
  }

  // Which column (if any) is being dragged — rendered in the DragOverlay so the
  // section floats smoothly instead of jumping in place.
  const activeColKey = activeId && !isCardId(activeId) ? colKeyOf(activeId) : null;
  const activeColumn = activeColKey ? DISPLAY_BY_KEY.get(activeColKey) : null;

  // Smooth settle when a card/column is dropped (instead of an instant snap).
  const dropAnimation: DropAnimation = {
    duration: 300,
    easing: "cubic-bezier(0.25, 1, 0.5, 1)",
    sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: "0.4" } } }),
  };

  return (
    <DndContext sensors={sensors} collisionDetection={kanbanCollision} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd}>
      <div className="flex gap-3 overflow-x-auto pb-3">
        <SortableContext items={colOrder.map(colId)} strategy={horizontalListSortingStrategy}>
          {colOrder.map((key) => {
            const d = DISPLAY_BY_KEY.get(key);
            if (!d) return null;
            return (
              <KanbanSortableColumn key={key} d={d} rows={items[key] ?? []} ownerName={ownerName} ownerPhoto={ownerPhoto} taskAgg={taskAgg} onOpen={onOpen} />
            );
          })}
        </SortableContext>
      </div>
      <DragOverlay dropAnimation={dropAnimation}>
        {activeCard && activeCardCol ? (
          <div className="w-[260px] cursor-grabbing">
            <KanbanCardInner p={activeCard} d={DISPLAY_BY_KEY.get(activeCardCol)!} ownerName={ownerName} ownerPhoto={ownerPhoto} taskAgg={taskAgg} overlay />
          </div>
        ) : activeColumn && activeColKey ? (
          <KanbanColumnInner d={activeColumn} rows={items[activeColKey] ?? []} ownerName={ownerName} ownerPhoto={ownerPhoto} taskAgg={taskAgg} />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

// ── Gantt view — projects as bars on a pixel-based timeline, coloured by status.
// A Day/Month scale toggle controls the granularity; bars carry a progress fill,
// a duration tag and a "Today" marker. ─────────────────────────────────────────
const DAY_MS = 86400000;
function dayFloor(t: number) { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }

// Monday.com status/RAG palette for Gantt bars — Green (done / on track),
// Amber (at risk / postponed), Red (delayed), Grey (new / cancelled).
const RAG_HEX = { green: "#00c875", amber: "#fdab3d", red: "#e2445c", grey: "#c4c4c4" } as const;
function projectRagColor(p: ProjectRow): string {
  const s = displayStatusOf(p.status).key;
  if (s === "cancelled" || s === "new") return RAG_HEX.grey;
  if (s === "completed") return RAG_HEX.green;
  if (s === "postponed") return RAG_HEX.amber;
  const r = (p.ragStatus ?? "").toLowerCase();
  if (r === "red") return RAG_HEX.red;
  if (r === "amber" || r === "yellow") return RAG_HEX.amber;
  return RAG_HEX.green;
}

// Gantt zoom presets — pixels-per-day per granularity, from most zoomed-in
// (Date) to most zoomed-out (Year). The toolbar buttons set these; live
// Ctrl+scroll / pinch can land between them (nearest preset stays highlighted).
export const SCALE_PRESETS = [
  { key: "day", label: "Date", px: 28 },
  { key: "week", label: "Week", px: 12 },
  { key: "month", label: "Month", px: 5 },
  { key: "year", label: "Year", px: 2 },
] as const;

function GanttView({ rows, ownerName, managerName, ownerPhoto, managerPhoto, taskAgg, onOpen }: {
  rows: ProjectRow[];
  ownerName: (p: ProjectRow) => string | null;
  managerName: (p: ProjectRow) => string | null;
  ownerPhoto: (p: ProjectRow) => string | null;
  managerPhoto: (p: ProjectRow) => string | null;
  taskAgg: Map<number, TaskAgg>;
  onOpen: (id: number) => void;
}) {
  // Group projects by display status, then render the shared Monday-style Gantt.
  // Projects have no project-level dependency edges, so no arrows here.
  // (Critical-path highlighting lives only in the milestone/task-view Gantt.)
  const groups: GanttGroup[] = DISPLAY_STATUSES.map((d) => {
    const items: GanttItem[] = rows
      // Undated projects are kept (rendered as a "No dates" row, not dropped) so
      // the Gantt project count matches the Kanban/Table/Portfolio views.
      .filter((p) => displayStatusOf(p.status).key === d.key)
      .map((p) => {
        const progress = Math.max(0, Math.min(100, p.progress ?? 0));
        const item: GanttItem = {
          id: p.id,
          name: p.name,
          start: p.startDate,
          end: p.endDate,
          progress,
          color: projectRagColor(p),
        };
        return item;
      });
    return { key: d.key, label: d.label, color: d.color, items };
  }).filter((g) => g.items.length > 0);

  if (groups.length === 0) {
    return <div className="glass-surface rounded-2xl text-sm text-muted-foreground text-center py-10">No start / end dates to chart.</div>;
  }

  return <MondayGantt groups={groups} onOpen={onOpen} labelWidth={340} labelHeader="Project" autoFitOnLoad defaultCollapsed />;
}

// ── Calendar view — projects marked on a monthly grid on their START and END
// dates only (one chip on each), colour-coded with the Gantt RAG palette and
// tagged S / E. Click a chip to open the project. Month nav + Today jump;
// projects with no dates are surfaced as a count. ────────────────────────────
function CalendarView({ rows, onOpen }: { rows: ProjectRow[]; onOpen: (id: number) => void }) {
  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  // Resolve each project to a [start, end] day-floored span (a project dated on
  // only one end collapses to a single day). Undated projects are excluded.
  const msFloor = (s?: string | null) => (s ? dayFloor(new Date(s.slice(0, 10)).getTime()) : null);
  const scheduled = useMemo(
    () => rows
      .map((p) => ({ p, s: msFloor(p.startDate), e: msFloor(p.endDate) }))
      .filter((x) => x.s != null || x.e != null)
      .map((x) => ({ p: x.p, s: (x.s ?? x.e) as number, e: (x.e ?? x.s) as number })),
    [rows],
  );
  const unscheduled = rows.length - scheduled.length;

  // Default to the month of the earliest scheduled project (else current month).
  const [cursor, setCursor] = useState(() => {
    const base = scheduled.length ? Math.min(...scheduled.map((x) => x.s)) : Date.now();
    const d = new Date(base); d.setDate(1); d.setHours(0, 0, 0, 0); return d.getTime();
  });
  const cur = new Date(cursor);
  const year = cur.getFullYear(), month = cur.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const gridStart = new Date(year, month, 1 - firstDow); gridStart.setHours(0, 0, 0, 0);
  const cells = Array.from({ length: 42 }, (_, i) => { const d = new Date(gridStart); d.setDate(gridStart.getDate() + i); return d; });
  const todayF = dayFloor(Date.now());

  // One marker on the start day and one on the end day (collapsed to a single
  // "S·E" marker when a project is dated on only one day).
  type Marker = { p: ProjectRow; kind: "start" | "end" | "both" };
  const markersByDay = useMemo(() => {
    const m = new Map<number, Marker[]>();
    const push = (t: number, mk: Marker) => { const a = m.get(t) ?? []; a.push(mk); m.set(t, a); };
    for (const x of scheduled) {
      if (x.s === x.e) push(x.s, { p: x.p, kind: "both" });
      else { push(x.s, { p: x.p, kind: "start" }); push(x.e, { p: x.p, kind: "end" }); }
    }
    return m;
  }, [scheduled]);
  const markersOn = (d: Date) => markersByDay.get(dayFloor(d.getTime())) ?? [];
  const shiftMonth = (delta: number) => { const d = new Date(year, month + delta, 1); d.setHours(0, 0, 0, 0); setCursor(d.getTime()); };
  const goToday = () => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); setCursor(d.getTime()); };

  return (
    <div className="mx-auto w-full max-w-xl aspect-square flex flex-col overflow-hidden rounded-2xl border border-white/50 bg-white/55 backdrop-blur-xl shadow-2xl ring-1 ring-black/5">
      {/* Toolbar — month label + nav + Today */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-white/40">
        <CalendarClock size={15} className="text-primary" />
        <span className="text-sm font-semibold text-gray-800 min-w-[150px]">{MONTHS[month]} {year}</span>
        <div className="flex items-center gap-0.5 ml-1">
          <button type="button" onClick={() => shiftMonth(-1)} title="Previous month" className="w-6 h-6 rounded-md flex items-center justify-center text-gray-500 hover:bg-gray-100"><ChevronLeft size={15} /></button>
          <button type="button" onClick={() => shiftMonth(1)} title="Next month" className="w-6 h-6 rounded-md flex items-center justify-center text-gray-500 hover:bg-gray-100"><ChevronRight size={15} /></button>
        </div>
        <button type="button" onClick={goToday} className="px-2.5 h-6 rounded-md text-[11px] font-medium bg-white border border-gray-200 text-gray-600 hover:bg-gray-100">Today</button>
        {unscheduled > 0 && <span className="ml-auto text-[11px] text-muted-foreground">{unscheduled} project{unscheduled === 1 ? "" : "s"} with no dates</span>}
      </div>

      {/* Weekday header */}
      <div className="shrink-0 grid grid-cols-7 border-b border-white/40 bg-white/30">
        {WEEKDAYS.map((w) => (
          <div key={w} className="px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-gray-500 text-center">{w}</div>
        ))}
      </div>

      {/* 6-week month grid — fills the remaining square area */}
      <div className="grid grid-cols-7 grid-rows-6 flex-1 min-h-0">
        {cells.map((d, i) => {
          const inMonth = d.getMonth() === month;
          const isToday = dayFloor(d.getTime()) === todayF;
          const items = markersOn(d);
          const shown = items.slice(0, 2);
          const extra = items.length - shown.length;
          const tag = (k: Marker["kind"]) => (k === "start" ? "S" : k === "end" ? "E" : "S·E");
          return (
            <div key={i} className={`min-h-0 overflow-hidden border-b border-r border-white/30 p-0.5 ${inMonth ? "bg-white/25" : "bg-white/5"} ${(i % 7) === 0 ? "border-l" : ""}`}>
              <div className={`text-[9px] font-medium mb-0.5 text-right pr-0.5 ${isToday ? "" : inMonth ? "text-gray-600" : "text-gray-300"}`}>
                {isToday
                  ? <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-primary text-primary-foreground">{d.getDate()}</span>
                  : d.getDate()}
              </div>
              <div className="space-y-px">
                {shown.map((x, k) => (
                  <button
                    key={`${x.p.id}-${x.kind}-${k}`}
                    type="button"
                    onClick={() => onOpen(x.p.id)}
                    title={`${x.p.name}\n${x.kind === "end" ? "Ends" : x.kind === "both" ? "Starts & ends" : "Starts"} ${x.kind === "end" ? (x.p.endDate ?? "?") : (x.p.startDate ?? x.p.endDate ?? "?")}${x.kind !== "both" ? `\n${x.p.startDate ?? "?"} → ${x.p.endDate ?? "?"}` : ""}`}
                    className="w-full flex items-center gap-0.5 px-0.5 py-px rounded-sm text-[8.5px] font-medium text-white truncate text-left hover:opacity-90 transition-opacity"
                    style={{ background: projectRagColor(x.p) }}
                  >
                    <span className="shrink-0 inline-flex items-center justify-center min-w-[12px] h-[10px] px-0.5 rounded-[2px] bg-white/25 text-[7px] font-bold tracking-tight">{tag(x.kind)}</span>
                    <span className="truncate">{x.p.name}</span>
                  </button>
                ))}
                {extra > 0 && <div className="text-[8px] text-muted-foreground px-0.5 leading-tight">+{extra} more</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Calendar view — a self-contained white month grid. The ENTIRE month renders
// on one screen (a plain 7×N CSS grid with minmax rows, so it never depends on
// flex-height cascades or breakpoints). A month dropdown + ‹ Today › nav drive
// it. Each project's START (S) / END (E) date is marked on its day, colour-coded
// by the Gantt RAG palette; click a marker to open the project.
function ProjectFullCalendar({ rows, onOpen }: { rows: ProjectRow[]; onOpen: (id: number) => void }) {
  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const msFloor = (s?: string | null) => (s ? dayFloor(new Date(s.slice(0, 10)).getTime()) : null);
  const dayKey = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };

  type Marker = { p: ProjectRow; kind: "start" | "end" | "both" };
  const markersByDay = useMemo(() => {
    const m = new Map<string, Marker[]>();
    const push = (t: number, mk: Marker) => { const a = m.get(dayKey(t)) ?? []; a.push(mk); m.set(dayKey(t), a); };
    for (const p of rows) {
      const s = msFloor(p.startDate), e = msFloor(p.endDate);
      if (s != null && e != null && s === e) push(s, { p, kind: "both" });
      else { if (s != null) push(s, { p, kind: "start" }); if (e != null) push(e, { p, kind: "end" }); }
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d.getTime(); });
  const cur = new Date(cursor);
  const year = cur.getFullYear(), month = cur.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const lastDate = new Date(year, month + 1, 0).getDate();
  const weeks = Math.ceil((firstDow + lastDate) / 7);
  const gridStart = new Date(year, month, 1 - firstDow); gridStart.setHours(0, 0, 0, 0);
  const cells = Array.from({ length: weeks * 7 }, (_, i) => { const d = new Date(gridStart); d.setDate(gridStart.getDate() + i); return d; });
  const todayF = dayFloor(Date.now());
  const markersOn = (d: Date) => markersByDay.get(dayKey(d.getTime())) ?? [];

  const baseY = new Date().getFullYear();
  const monthOptions: { value: string; label: string }[] = [];
  for (let y = baseY - 2; y <= baseY + 2; y++) for (let m = 0; m < 12; m++) monthOptions.push({ value: `${y}-${m}`, label: `${MONTHS[m]} ${y}` });
  const setMonthValue = (v: string) => { const [yy, mm] = v.split("-").map(Number); const d = new Date(yy!, mm!, 1); d.setHours(0, 0, 0, 0); setCursor(d.getTime()); };
  const shift = (delta: number) => { const d = new Date(year, month + delta, 1); d.setHours(0, 0, 0, 0); setCursor(d.getTime()); };
  const goToday = () => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); setCursor(d.getTime()); };
  const tag = (k: Marker["kind"]) => (k === "start" ? "S" : k === "end" ? "E" : "S·E");

  return (
    <div className="bg-white text-foreground rounded-2xl border border-gray-200 shadow-sm overflow-hidden flex flex-col w-full h-[calc(100vh-235px)] min-h-0">
      {/* Toolbar — month dropdown + nav */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 flex-wrap">
        <select
          value={`${year}-${month}`}
          onChange={(e) => setMonthValue(e.target.value)}
          aria-label="Select month"
          className="cursor-pointer rounded-md border border-gray-200 bg-white px-2 py-1 text-sm font-semibold text-gray-800 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          {monthOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <div className="ml-auto inline-flex items-center gap-0.5">
          <button type="button" onClick={() => shift(-1)} title="Previous month" className="w-7 h-7 rounded-md flex items-center justify-center text-gray-500 hover:bg-gray-100"><ChevronLeft size={16} /></button>
          <button type="button" onClick={goToday} className="px-2.5 h-7 rounded-md text-[12px] font-medium bg-white border border-gray-200 text-gray-600 hover:bg-gray-100">Today</button>
          <button type="button" onClick={() => shift(1)} title="Next month" className="w-7 h-7 rounded-md flex items-center justify-center text-gray-500 hover:bg-gray-100"><ChevronRight size={16} /></button>
        </div>
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50">
        {WEEKDAYS.map((w) => (
          <div key={w} className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 text-center">{w}</div>
        ))}
      </div>

      {/* Month grid — fills remaining height; rows shrink to fit so the whole
          month is visible with no scroll, whatever the week count. */}
      <div className="grid grid-cols-7 flex-1 min-h-0" style={{ gridTemplateRows: `repeat(${weeks}, minmax(0, 1fr))` }}>
        {cells.map((d, i) => {
          const inMonth = d.getMonth() === month;
          const isToday = dayFloor(d.getTime()) === todayF;
          const items = markersOn(d);
          const shown = items.slice(0, 3);
          const extra = items.length - shown.length;
          return (
            <div key={i} className={`overflow-hidden border-b border-r border-gray-100 p-1 ${inMonth ? "bg-white" : "bg-gray-50/50"} ${(i % 7) === 0 ? "border-l" : ""}`}>
              <div className={`text-[11px] font-medium text-right pr-0.5 ${isToday ? "" : inMonth ? "text-gray-600" : "text-gray-300"}`}>
                {isToday
                  ? <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground">{d.getDate()}</span>
                  : d.getDate()}
              </div>
              <div className="mt-0.5 space-y-0.5">
                {shown.map((x, k) => (
                  <button
                    key={`${x.p.id}-${x.kind}-${k}`}
                    type="button"
                    onClick={() => onOpen(x.p.id)}
                    title={`${x.p.name}\n${x.kind === "end" ? "Ends" : x.kind === "both" ? "Starts & ends" : "Starts"} ${x.kind === "end" ? (x.p.endDate ?? "?") : (x.p.startDate ?? x.p.endDate ?? "?")}`}
                    className="w-full flex items-center gap-1 px-1 py-0.5 rounded text-[10px] font-medium text-white truncate text-left hover:opacity-90 transition-opacity"
                    style={{ background: projectRagColor(x.p) }}
                  >
                    <span className="shrink-0 inline-flex items-center justify-center min-w-[14px] h-[12px] px-0.5 rounded-[2px] bg-white/25 text-[8px] font-bold tracking-tight">{tag(x.kind)}</span>
                    <span className="truncate">{x.p.name}</span>
                  </button>
                ))}
                {extra > 0 && <div className="text-[9px] text-muted-foreground px-0.5">+{extra} more</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function ProjectsList() {
  const { data: projects, isLoading, refetch } = useListProjects();
  const { data: users = [] } = useListUsers();
  const { data: charters = [] } = useListCharters();
  // All project team members in one shot — grouped by project for the board's
  // "Team" column (avatar stack + popover). Replaces the Owner / Manager columns.
  const { data: teamMembers = [] } = useListAllProjectTeamMembers();
  const teamByProject = useMemo(() => {
    const m = new Map<number, BoardTeamMember[]>();
    for (const tm of teamMembers as BoardTeamMember[]) {
      const arr = m.get(tm.projectId) ?? [];
      arr.push(tm);
      m.set(tm.projectId, arr);
    }
    return m;
  }, [teamMembers]);
  // All tasks across open projects — drives the Tasks + Task Status columns.
  const { data: tasks = [] } = useQuery({
    queryKey: ["/api/tasks", "all"],
    queryFn: async () => {
      const r = await fetch("/api/tasks");
      if (!r.ok) return [] as Array<{ projectId?: number | null; status?: string | null }>;
      return r.json() as Promise<Array<{ projectId?: number | null; status?: string | null }>>;
    },
  });
  // Latest delay/off-track justification per project (for the Justification column).
  const { data: justifications = [] } = useQuery({
    queryKey: ["/api/project-justifications/latest"],
    queryFn: async () => {
      const r = await fetch("/api/project-justifications/latest");
      if (!r.ok) return [] as Array<{ projectId: number; kind: string; justification: string; by: string | null }>;
      return r.json() as Promise<Array<{ projectId: number; kind: string; justification: string; by: string | null }>>;
    },
  });
  const justByProject = useMemo(() => {
    const m = new Map<number, { kind: string; justification: string; by: string | null }>();
    for (const j of justifications) m.set(j.projectId, { kind: j.kind, justification: j.justification, by: j.by });
    return m;
  }, [justifications]);
  const [, setLocation] = useLocation();

  // ── "Request justification" — when a delayed/off-track project has no recorded
  //    justification, the column shows a one-click icon that pings the owner via
  //    an in-app notification + branded email (POST /api/project-justifications/
  //    request). `requesting`/`requested` track per-project button state.
  const { toast } = useToast();
  const qc = useQueryClient();
  const [requesting, setRequesting] = useState<Set<number>>(new Set());
  const [requested, setRequested] = useState<Set<number>>(new Set());
  const requestJustification = async (projectId: number) => {
    if (requesting.has(projectId) || requested.has(projectId)) return;
    setRequesting((s) => new Set(s).add(projectId));
    try {
      const r = await fetch("/api/project-justifications/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ projectId }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast({ title: (data as { error?: string })?.error || "Could not send the request", variant: "destructive" });
        return;
      }
      const owner = (data as { owner?: string | null })?.owner;
      const emailed = (data as { emailed?: number })?.emailed ?? 0;
      setRequested((s) => new Set(s).add(projectId));
      toast({
        title: "Justification requested",
        description: owner
          ? `${owner} was notified${emailed ? " by app & email" : " in-app"}.`
          : `The owner was notified${emailed ? " by app & email" : " in-app"}.`,
      });
      void qc.invalidateQueries({ queryKey: ["/api/notifications"] });
    } catch {
      toast({ title: "Network error — please try again", variant: "destructive" });
    } finally {
      setRequesting((s) => { const n = new Set(s); n.delete(projectId); return n; });
    }
  };

  // ── Lookup maps for the Owner / Manager / Tasks columns (resolved client-side
  //    from the directory, charter and task lists — no extra backend round-trip).
  const usersById = useMemo(() => {
    const m = new Map<number, string>();
    for (const u of users) m.set(u.id, u.name);
    return m;
  }, [users]);

  // Profile photos, resolved from the master DB via /api/users (`photoUrl`).
  const photoById = useMemo(() => {
    const m = new Map<number, string>();
    for (const u of users) {
      const url = (u as unknown as Record<string, unknown>).photoUrl as string | null | undefined;
      if (url) m.set(u.id, url);
    }
    return m;
  }, [users]);

  // Project owner lives on the linked charter (projectOwnerId); manager lives on
  // the project (projectManagerId). Map charterId → ownerId once.
  const ownerByCharter = useMemo(() => {
    const m = new Map<number, number | null>();
    for (const c of charters as Array<{ id: number; projectOwnerId?: number | null }>) {
      m.set(c.id, c.projectOwnerId ?? null);
    }
    return m;
  }, [charters]);

  const taskAgg = useMemo(() => {
    const m = new Map<number, TaskAgg>();
    for (const t of tasks as Array<{ projectId?: number | null; status?: string | null }>) {
      if (t.projectId == null) continue;
      const e = m.get(t.projectId) ?? { total: 0, done: 0, in_progress: 0, delayed: 0, on_hold: 0, not_started: 0 };
      e.total++;
      switch (t.status) {
        case "completed": e.done++; break;
        case "in_progress": e.in_progress++; break;
        case "delayed": e.delayed++; break;
        case "on_hold": e.on_hold++; break;
        default: e.not_started++; break;
      }
      m.set(t.projectId, e);
    }
    return m;
  }, [tasks]);

  const ownerName = (p: ProjectRow) => {
    const oid = p.charterId != null ? ownerByCharter.get(p.charterId) : null;
    return oid != null ? usersById.get(oid) ?? null : null;
  };
  const managerName = (p: ProjectRow) => (p.projectManagerId != null ? usersById.get(p.projectManagerId) ?? null : null);
  const ownerPhoto = (p: ProjectRow) => {
    const oid = p.charterId != null ? ownerByCharter.get(p.charterId) : null;
    return oid != null ? photoById.get(oid) ?? null : null;
  };
  const managerPhoto = (p: ProjectRow) => (p.projectManagerId != null ? photoById.get(p.projectManagerId) ?? null : null);

  // ── Project-level Communication + Attachments drawer (opened per-project
  //    from a Kanban card or a Table row). Backed by project-scoped messages.
  const currentUserId = useUserStore((s) => s.userId);
  const [commsProject, setCommsProject] = useState<{ id: number; code: string; name: string } | null>(null);
  const [commsTab, setCommsTab] = useState<ProjectCommsTab>("communication");
  const openComms = (p: ProjectRow, tab: ProjectCommsTab) => {
    setCommsProject({ id: p.id, code: projectCode(p), name: p.name });
    setCommsTab(tab);
  };

  // ── Saved views (Stage 3 — Customization)
  const views = useUserView<ProjectsViewConfig>({ scope: "project_list", fallback: FALLBACK });
  const [search, setSearch] = useState(FALLBACK.search);
  const [status, setStatus] = useState(FALLBACK.status);
  const [priority, setPriority] = useState("");
  const [sort, setSort] = useState<ProjectsViewConfig["sort"]>(FALLBACK.sort);

  // Collapsible status sections (dropdowns). Default: all expanded.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggleGroup = (key: string) => setCollapsed((c) => ({ ...c, [key]: !c[key] }));

  // View switcher — Table · Kanban · Gantt. Defaults to Gantt so the portfolio
  // of projects opens straight onto the timeline (auto-fitted to span).
  const [view, setView] = useState<"table" | "kanban" | "gantt" | "calendar">("gantt");

  // Optional columns (Budget · Project Description) added globally to every table.
  const [extraCols, setExtraCols] = useState<Record<OptionalKey, boolean>>({ budget: false, description: false });
  // Visible columns (default order). Each <ExcelGroupTable> reorders/resizes its
  // own copy independently, so the status tables never affect one another.
  const activeCols = useMemo(() => [...COLS, ...OPTIONAL_COLS.filter((c) => extraCols[c.key])], [extraCols]);

  // Signed-in user's own department (master-DB function), used to default the view.
  const { data: me } = useQuery({
    queryKey: ["/api/users/me"],
    queryFn: async () => {
      const r = await fetch("/api/users/me");
      if (!r.ok) return null;
      return r.json() as Promise<{ function?: string | null }>;
    },
    staleTime: 5 * 60_000,
  });

  // Department filter (derived from project.function + the user's own dept).
  const [dept, setDept] = useState("");
  const deptOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of (projects ?? []) as ProjectRow[]) if (p.function) set.add(p.function);
    set.add("HR"); // always offer the HR department filter
    if (me?.function) set.add(me.function); // ensure the user's own dept is selectable
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [projects, me]);

  // On first load, default the Projects view to the user's own department.
  // Clearing the filter then reveals every other department's projects.
  const deptInitedRef = useRef(false);
  useEffect(() => {
    if (deptInitedRef.current || me === undefined) return;
    deptInitedRef.current = true;
    if (me?.function) setDept(me.function);
  }, [me]);

  // Icon menus — Filter (status) + Department + Add column. Close on outside click.
  const [filterOpen, setFilterOpen] = useState(false);
  const [prioOpen, setPrioOpen] = useState(false);
  const [deptOpen, setDeptOpen] = useState(false);
  const [colsOpen, setColsOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement | null>(null);
  const prioRef = useRef<HTMLDivElement | null>(null);
  const deptRef = useRef<HTMLDivElement | null>(null);
  const colsRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setFilterOpen(false);
      if (prioRef.current && !prioRef.current.contains(e.target as Node)) setPrioOpen(false);
      if (deptRef.current && !deptRef.current.contains(e.target as Node)) setDeptOpen(false);
      if (colsRef.current && !colsRef.current.contains(e.target as Node)) setColsOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // Sync active view → local state when the user picks a different view.
  useEffect(() => {
    if (views.activeId == null) return;
    setSearch(views.activeConfig.search ?? "");
    setStatus(views.activeConfig.status ?? "");
    setSort((views.activeConfig.sort as ProjectsViewConfig["sort"]) ?? "updated");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [views.activeId]);

  // ── Filter + sort pipeline (memoized once on each input change)
  const filtered = useMemo(() => {
    const list = projects ?? [];
    const q = search.trim().toLowerCase();
    const matched = list.filter((p) => {
      if (status && displayStatusOf(p.status).key !== status) return false;
      if (priority && (p as ProjectRow).priority !== priority) return false;
      if (dept && (p as ProjectRow).function !== dept) return false;
      if (q && !`${p.name} ${p.description ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
    const sorted = [...matched].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "progress") return (b.progress ?? 0) - (a.progress ?? 0);
      // "updated" — backend already returns by createdAt desc; mirror that.
      return 0;
    });
    return sorted;
  }, [projects, search, status, priority, dept, sort]);

  // ── Group the filtered projects by display status (New → Active → Completed
  //    → Cancelled → Postponed). Empty groups are dropped.
  const boardGroups = useMemo<BoardGroup<ProjectRow>[]>(() => {
    const byKey = new Map<string, ProjectRow[]>();
    for (const p of filtered) {
      const key = displayStatusOf(p.status).key;
      const arr = byKey.get(key) ?? [];
      arr.push(p);
      byKey.set(key, arr);
    }
    const groups: BoardGroup<ProjectRow>[] = [];
    for (const d of DISPLAY_STATUSES) {
      const rows = byKey.get(d.key);
      if (rows && rows.length) groups.push({ key: d.key, label: d.label, color: d.color, rows });
    }
    return groups;
  }, [filtered]);

  // All five status buckets (incl. empty) — for the Kanban columns.
  const buckets = useMemo(() => {
    const m = new Map<string, ProjectRow[]>();
    for (const d of DISPLAY_STATUSES) m.set(d.key, []);
    for (const p of filtered) m.get(displayStatusOf(p.status).key)!.push(p);
    return m;
  }, [filtered]);

  // Kanban columns (Jira-style board) — one BoardGroup per display status, in
  // lifecycle order, including empty columns so the board keeps a stable shape.
  const kanbanGroups = useMemo<BoardGroup<ProjectRow>[]>(
    () => DISPLAY_STATUSES.map((d) => ({ key: d.key, label: d.label, color: d.color, rows: buckets.get(d.key) ?? [] })),
    [buckets],
  );

  return (
    <div className="space-y-2 -mt-2 sm:-mt-3 lg:-mt-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap ph-rise">
        <div>
          <h2 className="text-xl font-bold text-foreground">Projects</h2>
          <p className="text-sm text-muted-foreground mt-0.5">All projects in execution and planning</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Workspace-wide Communication + Attachments (not per-project) */}
          <button
            type="button"
            onClick={() => { setCommsProject({ id: 0, code: "ALL", name: "All Projects" }); setCommsTab("communication"); }}
            title="Attachments & Communication"
            aria-label="Attachments & Communication"
            className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-border bg-card/70 text-foreground hover:bg-accent transition-colors"
          >
            <MessageSquare size={14} />
          </button>
          <JiraImportButton onDone={() => { void refetch(); }} />
        </div>
      </div>

      {/* ── Filter bar + saved views (Stage 3) ───────────────────────────── */}
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

        {/* View switcher — Table · Kanban · Gantt */}
        <div className="flex items-center gap-0.5 mr-0.5 pr-0.5 border-r border-border/60">
          {([
            { key: "table", label: "Table", Icon: Table2 },
            { key: "kanban", label: "Kanban", Icon: LayoutGrid },
            { key: "gantt", label: "Gantt", Icon: GanttChartSquare },
            { key: "calendar", label: "Calendar", Icon: CalendarClock },
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

        {/* Filter — icon only; opens the status dropdown */}
        <div className="relative" ref={filterRef}>
          <button
            type="button"
            onClick={() => { setFilterOpen((o) => !o); setPrioOpen(false); setDeptOpen(false); setColsOpen(false); }}
            title="Filter by status"
            className={`h-6 px-1.5 rounded-md flex items-center gap-1 text-[11px] font-medium transition-colors ${
              status ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-accent"
            }`}
          >
            <Filter size={13} /> Status
          </button>
          {filterOpen && (
            <div className="absolute left-0 top-full mt-1.5 z-50 w-44 rounded-md py-1 bg-popover text-popover-foreground border border-popover-border shadow-lg">
              <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Status</div>
              {STATUS_CHIPS.map((c) => (
                <button
                  key={c.value || "all"}
                  onClick={() => { setStatus(c.value); setFilterOpen(false); }}
                  className={`w-full flex items-center justify-between px-3 py-1.5 text-sm text-left transition-colors ${status === c.value ? "bg-accent text-primary" : "hover:bg-accent/60"}`}
                >
                  {c.label}
                  {status === c.value && <Check size={13} />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Priority filter — icon only; opens the priority dropdown */}
        <div className="relative" ref={prioRef}>
          <button
            type="button"
            onClick={() => { setPrioOpen((o) => !o); setFilterOpen(false); setDeptOpen(false); setColsOpen(false); }}
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

        {/* Department filter — icon only */}
        <div className="relative" ref={deptRef}>
          <button
            type="button"
            onClick={() => { setDeptOpen((o) => !o); setFilterOpen(false); setPrioOpen(false); setColsOpen(false); }}
            title="Filter by department"
            className={`h-6 px-1.5 rounded-md flex items-center gap-1 text-[11px] font-medium transition-colors ${
              dept ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-accent"
            }`}
          >
            <Building2 size={13} /> Department
          </button>
          {deptOpen && (
            <div className="absolute left-0 top-full mt-1.5 z-50 w-52 max-h-72 overflow-y-auto rounded-md py-1 bg-popover text-popover-foreground border border-popover-border shadow-lg">
              <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Department</div>
              <button
                onClick={() => { setDept(""); setDeptOpen(false); }}
                className={`w-full flex items-center justify-between px-3 py-1.5 text-sm text-left transition-colors ${dept === "" ? "bg-accent text-primary" : "hover:bg-accent/60"}`}
              >
                All departments
                {dept === "" && <Check size={13} />}
              </button>
              {deptOptions.map((d) => (
                <button
                  key={d}
                  onClick={() => { setDept(d); setDeptOpen(false); }}
                  className={`w-full flex items-center justify-between px-3 py-1.5 text-sm text-left transition-colors ${dept === d ? "bg-accent text-primary" : "hover:bg-accent/60"}`}
                >
                  <span className="truncate">{d}</span>
                  {dept === d && <Check size={13} className="shrink-0" />}
                </button>
              ))}
              {deptOptions.length === 0 && <div className="px-3 py-2 text-xs text-muted-foreground">No departments</div>}
            </div>
          )}
        </div>

        {/* Add column — icon only; Budget · Project Description. Table view
            only — the Kanban and Gantt views have no table columns to toggle. */}
        {view === "table" && (
        <div className="relative" ref={colsRef}>
          <button
            type="button"
            onClick={() => { setColsOpen((o) => !o); setFilterOpen(false); setPrioOpen(false); setDeptOpen(false); }}
            title="Add column"
            className="h-6 px-1.5 rounded-md flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <Columns3 size={13} /> Add column
          </button>
          {colsOpen && (
            <div className="absolute left-0 top-full mt-1.5 z-50 w-52 rounded-md py-1 bg-popover text-popover-foreground border border-popover-border shadow-lg">
              <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1"><Plus size={11} /> Add column</div>
              {OPTIONAL_COLS.map((c) => (
                <button
                  key={c.key}
                  onClick={() => setExtraCols((s) => ({ ...s, [c.key]: !s[c.key] }))}
                  className="w-full flex items-center justify-between px-3 py-1.5 text-sm text-left hover:bg-accent/60 transition-colors"
                >
                  {c.header}
                  <span className={`w-4 h-4 rounded border flex items-center justify-center ${extraCols[c.key] ? "bg-primary border-primary text-primary-foreground" : "border-border"}`}>
                    {extraCols[c.key] && <Check size={11} />}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        )}

        {/* Status legend — shown only in the Gantt view */}
        {view === "gantt" && (
          <div className="flex items-center gap-2 pl-1.5 ml-0.5 border-l border-border/60">
            {DISPLAY_STATUSES.map((d) => (
              <span key={d.key} className="flex items-center gap-1 text-[10px] text-muted-foreground whitespace-nowrap">
                <span className="w-2 h-2 rounded-sm" style={{ background: d.color }} />
                {d.label}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* One Excel-style table per status (New · Active · Completed · Cancelled
          · Postponed). Columns: Project Code · Project Name · Owner · Manager ·
          Status · Tasks · Task Status · Timeline. */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      ) : filtered.length > 0 ? (
        view === "kanban" ? (
          <ProjectsKanbanBoard<ProjectRow>
            groups={kanbanGroups}
            columns={PROJECT_COLUMNS}
            getRowId={(p) => `project:${p.id}`}
            getName={(p) => (
              <div className="flex items-start justify-between gap-1.5">
                <span className="font-medium">{p.name}</span>
                <span className="flex items-center gap-0.5 shrink-0">
                  <button
                    type="button"
                    title="Attachments & Communication"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); openComms(p, "communication"); }}
                    className="p-1 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                  >
                    <MessageSquare size={13} />
                  </button>
                </span>
              </div>
            )}
            onOpenRow={(p) => setLocation(`/projects/${p.id}`)}
            onMoveToGroup={(rowId, groupKey) => {
              const id = Number(rowId.replace("project:", ""));
              if (!Number.isFinite(id)) return;
              void (async () => {
                try {
                  await fetch(`/api/projects/${id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ status: groupKey }),
                  });
                } finally {
                  refetch();
                }
              })();
            }}
          />
        ) : view === "gantt" ? (
          <GanttView rows={filtered} ownerName={ownerName} managerName={managerName} ownerPhoto={ownerPhoto} managerPhoto={managerPhoto} taskAgg={taskAgg} onOpen={(id) => setLocation(`/projects/${id}`)} />
        ) : view === "calendar" ? (
          <ProjectFullCalendar rows={filtered} onOpen={(id) => setLocation(`/projects/${id}`)} />
        ) : (
        <div className="space-y-5">
          {boardGroups.map((group) => {
            const open = !collapsed[group.key];
            return (
            <div key={group.key}>
              {/* Status dropdown header — click to expand/collapse the table */}
              <button
                type="button"
                onClick={() => toggleGroup(group.key)}
                className="flex items-center gap-2 mb-2 px-0.5 w-full text-left group/header"
              >
                <ChevronDown size={15} className={`text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`} />
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: group.color }} />
                <h3 className="text-sm font-semibold text-foreground">{group.label}</h3>
                <span className="text-xs text-muted-foreground">({group.rows.length})</span>
              </button>

              {open && (
                <ExcelGroupTable
                  cols={activeCols}
                  accent={group.color}
                  storageKey={`ph:projects:tbl:${group.key}`}
                  renderHeaderLabel={(c) => (c.key === "status" ? <HealthHeaderTip /> : c.header)}
                >
                  {(orderedCols) => {
                    const cell = (key: string, p: ProjectRow) => {
                      switch (key) {
                        case "code": return <td key="code" className="border border-gray-200 px-2 py-0.5 font-mono text-[11px] font-semibold text-gray-800 whitespace-nowrap">{projectCode(p)}</td>;
                        case "name": return <td key="name" className="border border-gray-200 px-2 py-0.5 font-medium text-gray-800 truncate" title={p.name}>{p.name}</td>;
                        case "team": return (
                          <td key="team" className="border border-gray-200 px-2 py-0.5 text-center">
                            <div className="flex justify-center">
                              <TeamCell
                                members={teamByProject.get(p.id) ?? []}
                                nameById={usersById}
                                photoById={photoById}
                                onManage={() => setLocation(`/projects/${p.id}?section=team`)}
                              />
                            </div>
                          </td>
                        );
                        case "status": return <HealthCell key="status" health={scheduleHealth(p, taskAgg.get(p.id))} align="center" />;
                        case "justification": {
                          const j = justByProject.get(p.id);
                          const hk = scheduleHealth(p, taskAgg.get(p.id)).key;
                          if (j) {
                            return (
                              <td key="justification" className="border border-gray-200 px-2 py-0.5">
                                <HoverHint title={j.kind === "delayed" ? "Delay justification" : "Off-track justification"} rows={j.by ? [{ label: "By", value: j.by }] : undefined} footer={j.justification}>
                                  <span className="block truncate text-[11px] text-gray-700 cursor-help">{j.justification}</span>
                                </HoverHint>
                              </td>
                            );
                          }
                          if (hk === "delayed" || hk === "off_track") {
                            const pendingOwner = ownerName(p);
                            const isRequesting = requesting.has(p.id);
                            const isRequested = requested.has(p.id);
                            return (
                              <td key="justification" className="border border-gray-200 px-2 py-0.5">
                                <div className="flex items-center justify-center gap-1.5">
                                  <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-600 ring-1 ring-red-200">
                                    Pending from {pendingOwner ?? "Owner"}
                                  </span>
                                  <HoverHint label={isRequested ? "Reminder sent to the owner" : `Request justification from ${pendingOwner ?? "the owner"} (email + notification)`}>
                                    <button
                                      type="button"
                                      aria-label="Request justification from the owner"
                                      disabled={isRequesting || isRequested}
                                      onClick={(e) => { e.stopPropagation(); void requestJustification(p.id); }}
                                      className={`inline-flex items-center justify-center w-5 h-5 rounded-full ring-1 transition-colors shrink-0 ${
                                        isRequested
                                          ? "bg-green-50 text-green-600 ring-green-200 cursor-default"
                                          : "bg-amber-50 text-amber-600 ring-amber-200 hover:bg-amber-100 disabled:opacity-60"
                                      }`}
                                    >
                                      {isRequesting ? <Loader2 size={11} className="animate-spin" />
                                        : isRequested ? <Check size={11} />
                                        : <BellRing size={11} />}
                                    </button>
                                  </HoverHint>
                                </div>
                              </td>
                            );
                          }
                          return <td key="justification" className="border border-gray-200 px-2 py-0.5 text-center text-gray-400">—</td>;
                        }
                        case "tasks": return <td key="tasks" className="border border-gray-200 px-2 py-0.5 text-center font-semibold tabular-nums text-gray-800">{taskAgg.get(p.id)?.total ?? 0}</td>;
                        case "taskStatus": return <td key="taskStatus" className="border border-gray-200 px-2 py-0.5"><TaskStatusBar agg={taskAgg.get(p.id)} /></td>;
                        case "timeline": return <td key="timeline" className="border border-gray-200 px-2 py-0.5 whitespace-nowrap"><TimelineCell start={p.startDate} end={p.endDate} /></td>;
                        case "budget": return <td key="budget" className="border border-gray-200 px-2 py-0.5 text-gray-800 tabular-nums whitespace-nowrap">{formatCurrency((p.capexBudget ?? 0) + (p.opexBudget ?? 0))}</td>;
                        case "description": return <td key="description" className="border border-gray-200 px-2 py-0.5 text-gray-700 truncate" title={p.description ?? ""}>{p.description || <span className="text-gray-400">—</span>}</td>;
                        default: return <td key={key} className="border border-gray-200 px-2 py-0.5" />;
                      }
                    };
                    return (
                      <tbody>
                        {group.rows.map((p) => (
                          <tr
                            key={p.id}
                            onClick={() => setLocation(`/projects/${p.id}`)}
                            className="cursor-pointer bg-white hover:bg-gray-50 transition-colors"
                          >
                            {orderedCols.map((c) => cell(c.key, p))}
                          </tr>
                        ))}
                      </tbody>
                    );
                  }}
                </ExcelGroupTable>
              )}
            </div>
            );
          })}
        </div>
        )
      ) : (
        // ── Glassmorphic empty-state surface — frosted panel + ambient mesh
        //    + ghost project-card silhouettes so the white space reads as
        //    "this is where projects will live", not "the page is broken".
        <div className="relative overflow-hidden rounded-2xl ph-rise ph-rise-2 min-h-[440px] glass-surface">
          {/* Layer 1 — soft animated gradient mesh */}
          <div
            className="absolute inset-0 opacity-80 pointer-events-none"
            style={{
              background: `
                radial-gradient(at 18% 22%, hsl(var(--primary) / 0.18) 0px, transparent 55%),
                radial-gradient(at 80% 18%, hsl(var(--primary) / 0.10) 0px, transparent 50%),
                radial-gradient(at 50% 95%, hsl(var(--primary) / 0.14) 0px, transparent 60%),
                radial-gradient(at 88% 78%, hsl(217 91% 60% / 0.10) 0px, transparent 55%)
              `,
            }}
          />
          {/* Layer 2 — fine grid pattern, very faint */}
          <div
            className="absolute inset-0 opacity-[0.04] pointer-events-none"
            style={{
              backgroundImage:
                "linear-gradient(hsl(var(--foreground)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--foreground)) 1px, transparent 1px)",
              backgroundSize: "32px 32px",
            }}
          />
          {/* Layer 3 — ghost project cards arranged behind the message */}
          <div className="absolute inset-x-8 bottom-6 grid grid-cols-1 md:grid-cols-3 gap-4 pointer-events-none">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="rounded-2xl p-4 border border-border/40 bg-card/30 backdrop-blur-md"
                style={{
                  opacity: 0.35 - i * 0.08,
                  transform: `translateY(${i * 6}px)`,
                }}
              >
                <div className="h-3 w-16 rounded bg-muted-foreground/30 mb-3" />
                <div className="h-4 w-3/4 rounded bg-muted-foreground/40 mb-2" />
                <div className="h-3 w-full rounded bg-muted-foreground/20 mb-1" />
                <div className="h-3 w-5/6 rounded bg-muted-foreground/20" />
                <div className="mt-4 pt-3 border-t border-border/30 flex justify-between items-center">
                  <div className="h-2 w-12 rounded bg-muted-foreground/20" />
                  <div className="h-2 w-8 rounded bg-muted-foreground/20" />
                </div>
                <div className="mt-2 h-1.5 w-full rounded bg-muted-foreground/15 overflow-hidden">
                  <div className="h-full bg-primary/40 rounded" style={{ width: `${30 + i * 20}%` }} />
                </div>
              </div>
            ))}
          </div>
          {/* Layer 4 — frosted message panel, centred */}
          <div className="relative z-10 flex flex-col items-center text-center px-8 pt-16 pb-10">
            <div className="relative">
              {/* Glow halo behind the icon */}
              <div className="absolute inset-0 -m-4 rounded-full bg-primary/20 blur-xl" aria-hidden />
              <div className="relative w-16 h-16 rounded-2xl border border-primary/30 bg-card/60 backdrop-blur-md flex items-center justify-center shadow-lg">
                <BarChart2 size={28} className="text-primary" />
              </div>
            </div>
            <h3 className="mt-6 text-xl font-semibold tracking-tight text-foreground">
              {projects && projects.length > 0 ? "No projects match these filters" : "No projects yet"}
            </h3>
            <p className="mt-2 max-w-md text-sm text-muted-foreground leading-relaxed">
              {projects && projects.length > 0
                ? "Try clearing the search, switching status, or picking the All chip — your saved view might be too tight for what's loaded."
                : "Approve a charter and create a project to get started. Once projects land, this page becomes your portfolio at a glance."}
            </p>
            {(!projects || projects.length === 0) && (
              <div className="mt-6 flex items-center gap-2">
                <Link href="/charters/new">
                  <button className="inline-flex items-center gap-1.5 px-4 h-9 rounded-md text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm">
                    Start Charter + e-NFA
                  </button>
                </Link>
                <Link href="/pifs/new">
                  <button className="inline-flex items-center gap-1.5 px-4 h-9 rounded-md text-sm font-medium border border-border bg-card/70 backdrop-blur-md hover:bg-accent transition-colors">
                    Start a PIF
                  </button>
                </Link>
              </div>
            )}
          </div>
        </div>
      )}

      <ProjectCommsDrawer
        projectId={commsProject?.id ?? 0}
        projectCode={commsProject?.code ?? ""}
        projectName={commsProject?.name ?? "Project"}
        tab={commsProject ? commsTab : null}
        onTabChange={setCommsTab}
        onClose={() => setCommsProject(null)}
        senderId={currentUserId}
        resolveName={(id) => usersById.get(id) ?? `User ${id}`}
        people={users}
      />
    </div>
  );
}
