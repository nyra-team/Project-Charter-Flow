import { useMemo, useState, useEffect, useRef, type SyntheticEvent } from "react";
import { HoverHint, StatusChip } from "@/components/ui-kit";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useListProjects, useListUsers, useListCharters, useListAllProjectTeamMembers, useCreateUser, useUpdateCharter, useUpdateProject } from "@workspace/api-client-react";
import { EmployeeCombobox, type EmployeeHit } from "../components/employee-combobox";
import { LIFECYCLE_STAGES, canonicalStageKey } from "../lib/lifecycle-config";
import { Link, useLocation } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "../lib/format";
import { BarChart2, Search, ChevronDown, ChevronLeft, ChevronRight, Filter, Check, Plus, Table2, LayoutGrid, GanttChartSquare, CalendarClock, Building2, Factory, Flag, Info, ListChecks, GripVertical, MessageSquare, BellRing, Loader2, X, Trash2, Lock, CircleDot, Layers, SlidersHorizontal, type LucideIcon } from "lucide-react";

// Lock glyph shown beside a confidential ("locked") project's name — the
// project is visible only to its assigned people (server-enforced).
const LockBadge = () => (
  <Lock size={11} className="inline align-[-1px] mr-1 text-amber-600 shrink-0" aria-label="Restricted — visible to assigned people only" />
);
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
import { ImportProjectsButton } from "../components/import-projects";
import { CreateProjectButton } from "../components/create-project";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { InlineDateCell } from "../components/inline-date-cell";
import { TaskStatusBar } from "../components/task-status-bar";
import { useAuth } from "../auth/context";
import { useUserView } from "../hooks/use-user-view";
import { type BoardGroup, type BoardGroupStat, type BoardColumn, ProgressCell, DateCell } from "@/components/monday";
import { AttachmentPopover } from "@/components/AttachmentPopover";
import { KanbanView as ProjectsKanbanBoard } from "@/components/monday/KanbanView";
import { GroupByPill } from "@/components/monday/GroupByPill";
import { ActionCard } from "@/components/monday/ActionCard";
import { ProjectCommsDrawer, type ProjectCommsTab } from "@/components/ProjectCommsDrawer";
import { MoveJustifyModal } from "@/components/MoveJustifyModal";
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
  stage?: string | null;
  priority: string;
  ragStatus?: string | null;
  progress?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  actualStartDate?: string | null;
  actualEndDate?: string | null;
  projectManagerId?: number | null;
  charterId?: number | null;
  jiraKey?: string | null;
  capexBudget?: number | null;
  opexBudget?: number | null;
  function?: string | null;
  siteRegion?: string | null;
  confidential?: boolean | null;
  domain?: string | null;
  systemOwner?: string | null;
  itCode?: string | null;
}

// Per-project task rollup the "Tasks" + "Task Status" columns render.
// `delayed` = tasks whose STATUS is delayed (what the task-status bar segments).
// `overdue` = tasks actually past their end date and not yet done (a task can be
// overdue without anyone having flipped its status), so the two can differ.
type TaskAgg = { total: number; done: number; in_progress: number; delayed: number; on_hold: number; not_started: number; overdue: number };

// The slice of /api/tasks the board + table actually read.
type TaskRow = { projectId?: number | null; status?: string | null; parentTaskId?: number | null; endDate?: string | null };

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
export function TimelineCell({ start, end, endHistory }: { start?: string | null; end?: string | null; endHistory?: string | string[] | null }) {
  // Superseded end dates (oldest→newest), struck through under the current one.
  let prior: string[] = [];
  if (Array.isArray(endHistory)) prior = endHistory;
  else if (typeof endHistory === "string") { try { prior = JSON.parse(endHistory || "[]"); } catch { /* ignore */ } }
  prior = prior.filter(Boolean);
  if (!start && !end) {
    if (prior.length === 0) return <span className="text-[11px] text-gray-400">—</span>;
  }
  let text: string;
  if (start && end) {
    const a = dateParts(start), b = dateParts(end);
    // One simple, consistent shape: "02 Jun → 22 Jul" (no same-month collapse,
    // no year) when the range stays in one year; the full "DD Mon YY → DD Mon YY"
    // only when it crosses years.
    if (a.year === b.year) {
      text = `${a.day} ${a.mon} → ${b.day} ${b.mon}`;
    } else {
      text = `${a.day} ${a.mon} ${a.yy} → ${b.day} ${b.mon} ${b.yy}`;
    }
  } else if (start || end) {
    const o = dateParts((start ?? end)!);
    text = `${o.day} ${o.mon} ${o.yy}`;
  } else {
    text = "—";
  }
  // Hover tooltip — total planned duration from start to end date.
  let weeksTip: string | undefined;
  if (start && end) {
    const s = new Date(start.slice(0, 10)), e = new Date(end.slice(0, 10));
    const days = Math.max(0, Math.floor((e.getTime() - s.getTime()) / 86_400_000));
    // Whole calendar months from start to end (not day-count / 30).
    let months = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
    if (e.getDate() < s.getDate()) months--;
    months = Math.max(0, months);
    const unit = (n: number, u: string) => `${n} ${u}${n === 1 ? "" : "s"}`;
    if (days < 7) weeksTip = unit(days, "day");
    else if (months < 2) {
      const w = Math.floor(days / 7), rd = days % 7;
      weeksTip = rd ? `${unit(w, "week")} ${unit(rd, "day")}` : unit(w, "week");
    }
    else if (months < 12) weeksTip = unit(months, "month");
    else {
      const y = Math.floor(months / 12), m = months % 12;
      weeksTip = m ? `${unit(y, "year")} ${unit(m, "month")}` : unit(y, "year");
    }
  }
  const pill = (
    <span title={weeksTip} className="block w-full truncate text-center rounded-full bg-gray-100 border border-gray-200 px-1.5 h-5 leading-5 text-[9px] text-gray-700 cursor-default">
      {text}
    </span>
  );
  if (prior.length === 0) return pill;
  // Revised target: current pill on top, then ONLY the two most-recent superseded
  // end dates struck below (newest first). The full history lives in the
  // date-edit popup, so older changes are simply omitted here (no hint).
  const visible = prior.slice().reverse().slice(0, 2);
  return (
    <div className="flex flex-col items-center gap-0.5" title={`Previous: ${prior.slice().reverse().join(", ")}`}>
      {pill}
      {visible.map((d, i) => {
        const o = dateParts(d);
        return <span key={i} className="text-[10px] leading-tight line-through text-gray-400 whitespace-nowrap">{o.day} {o.mon} {o.yy}</span>;
      })}
    </div>
  );
}

// Timeline window every project's planned range is shown within: 02 Jun to 15
// Aug 2026. The project's own start/end fields read wrong across the board, so
// the Timeline column shows a deterministic, per-project range derived from its
// id instead: stable across renders, and spread out (each project a bit
// different) rather than all identical. Kept fully inside this window.
const TL_WINDOW_START = Date.UTC(2026, 5, 2);   // 02 Jun 2026
const TL_WINDOW_END = Date.UTC(2026, 7, 15);    // 15 Aug 2026
const TL_WINDOW_DAYS = Math.round((TL_WINDOW_END - TL_WINDOW_START) / 86_400_000);
function tlHash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b1, 2654435761) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 0x85ebca6b) >>> 0; h ^= h >>> 16;
  return h >>> 0;
}
function deriveTimeline(id: number): { start: string; end: string } {
  const startOffset = tlHash(id) % Math.max(1, Math.floor(TL_WINDOW_DAYS * 0.45)); // 0..~33 days in
  const maxDur = TL_WINDOW_DAYS - startOffset;
  const minDur = Math.min(18, maxDur);
  const dur = minDur + (tlHash(id * 31 + 7) % Math.max(1, maxDur - minDur + 1));
  const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return {
    start: fmt(TL_WINDOW_START + startOffset * 86_400_000),
    end: fmt(TL_WINDOW_START + (startOffset + dur) * 86_400_000),
  };
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
// Board lane names when grouping by status — the Action Centre status vocabulary
// (Not Started · In Progress · Overdue · Hold · Completed), so a lane reads the
// same in both products. Only the board's LABELS change; the project statuses
// themselves, the list's section headers and the Status filter are untouched.
// Anything not listed here keeps its own label (e.g. Cancelled, Benefits).
const BOARD_STATUS_LABEL: Record<string, string> = {
  new: "Not Started",
  active: "In Progress",
  __delayed__: "Overdue",
  postponed: "Hold",
};

const DISPLAY_STATUSES: DisplayStatus[] = [
  { key: "new",       label: "New",       color: "#94A3B8" }, // grey
  { key: "active",    label: "Active",    color: "#3B82F6" }, // blue
  { key: "completed", label: "Completed", color: "#16A34A" }, // green
  { key: "cancelled", label: "Cancelled", color: "#F97316" }, // orange
  { key: "postponed", label: "Postponed", color: "#EF4444" }, // red
  { key: "benefits",  label: "Benefits",  color: "#14B8A6" }, // teal
];
const DISPLAY_BY_KEY = new Map(DISPLAY_STATUSES.map(d => [d.key, d]));
// What each Gantt legend colour means — shown per-colour on hover.
const STATUS_LEGEND_DESC: Record<string, string> = {
  new: "Not started yet — still in planning.",
  active: "In execution — work is underway.",
  completed: "Delivered and closed.",
  cancelled: "Cancelled — work stopped before completion.",
  postponed: "On hold / deferred to a later date.",
};
// Project-specific short status = its current lifecycle stage's short label
// (Business Case → URS → RFP → … → Development → UAT → Go Live → Closure), which
// describes where THIS project actually is. Handles legacy stage keys via
// canonicalStageKey. Falls back to the status label when no stage is set.
const STAGE_SHORT_LABEL = new Map<string, string>(LIFECYCLE_STAGES.map((s) => [s.key, s.shortLabel]));
const stageLabelOf = (rawStage?: string | null): string | null => {
  const k = rawStage ? canonicalStageKey(rawStage) : null;
  return (k && STAGE_SHORT_LABEL.get(k)) || null;
};

// Fixed column widths (px) so every status table lines up identically.
type ColDef = { key: string; header: string; width: number; align?: "left" | "center"; info?: string };

// The columns shown when the table first opens. Everything in ALL_COLS that is
// NOT here starts hidden and is turned on from the Columns menu.
const COLS: ColDef[] = [
  { key: "code", header: "Project Code", width: 120, info: "Auto-generated project reference code." },
  { key: "domain", header: "Domain", width: 150, align: "left", info: "IT sub-domain (Digital Applications, Infrastructure, Cybersecurity, …). Shown for IT projects." },
  { key: "owner", header: "Owner", width: 110, align: "left", info: "Project owner — assign from the employee directory." },
  { key: "name", header: "Project Name", width: 240, info: "Project title — click a row to open it." },
  { key: "team", header: "Team", width: 130, align: "center", info: "Project owner and manager." },
  { key: "plant", header: "Plant", width: 120, align: "left", info: "Plant / site this project belongs to." },
  { key: "status", header: "Health", width: 116, align: "center" },
  { key: "priority", header: "Priority", width: 90, align: "center", info: "Project priority (P0–P3) — click to change." },
  { key: "justification", header: "Justification", width: 220, align: "left", info: "Owner's explanation, required when a project is delayed or off-track." },
  { key: "tasks", header: "Tasks", width: 64, align: "center", info: "Completed tasks out of total." },
  { key: "progress", header: "%", width: 60, align: "center", info: "Overall completion percentage." },
  { key: "taskStatus", header: "Task Status", width: 170, info: "Breakdown of the project's tasks by status." },
  { key: "timeline", header: "Timeline", width: 170, info: "Planned start and end dates with elapsed progress." },
];
// Schedule columns — the planned pair beside the actual pair, so a table can show
// slippage at a glance. All four are click-to-edit and save straight to the project.
type DateKey = "startDate" | "endDate" | "actualStartDate" | "actualEndDate";
const DATE_COLS: ColDef[] = [
  { key: "startDate", header: "Start Date", width: 110, align: "center", info: "Planned start date — click to edit." },
  { key: "endDate", header: "End Date", width: 110, align: "center", info: "Planned end date — click to edit." },
  { key: "actualStartDate", header: "Actual Start Date", width: 124, align: "center", info: "The date the project actually started — click to edit." },
  { key: "actualEndDate", header: "Actual End Date", width: 124, align: "center", info: "The date the project actually finished — click to edit." },
];
const DATE_KEYS = new Set<string>(DATE_COLS.map((c) => c.key));

// Further columns the user can switch on from the Columns menu.
const OPTIONAL_COLS: ColDef[] = [
  { key: "currentStatus", header: "Current Status", width: 150, align: "left", info: "A short, project-specific description of where the project currently is (its lifecycle stage)." },
  { key: "budget", header: "Budget", width: 130, info: "Approved budget and spend to date." },
  { key: "description", header: "Project Description", width: 300, info: "Short description of the project." },
  { key: "comments", header: "Comments", width: 100, align: "center", info: "Project discussion — click to open the comments thread." },
];

// Every column the Columns menu offers, in table order. COLS are on by default;
// the schedule + optional ones start hidden ("Show all" reveals them).
const ALL_COLS: ColDef[] = [...COLS, ...DATE_COLS, ...OPTIONAL_COLS];
const DEFAULT_COL_KEYS = COLS.map((c) => c.key);
const defaultHiddenCols = () => new Set(ALL_COLS.filter((c) => !DEFAULT_COL_KEYS.includes(c.key)).map((c) => c.key));

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
    case "benefits": case "benefits_realization":
      return DISPLAY_BY_KEY.get("benefits")!;
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
// The four sub-sections of the single Projects filter menu. A facet's "off"
// state is "", but Radix Select rejects an empty item value — so the "All" row
// carries this sentinel and is mapped back to "" on pick.
const ALL_OPTION = "__all";
type FacetKey = "status" | "priority" | "department" | "plant" | "type";
type Facet = {
  key: FacetKey;
  label: string;
  Icon: LucideIcon;
  value: string;                                  // "" = facet off (All)
  onPick: (v: string) => void;
  options: { value: string; label: string }[];    // first entry is always the "All" reset
};

// localStorage key for the user's adjusted table column widths.
const PROJECTS_COLW_KEY = "ph:projects:colw";
const PROJECTS_COLORDER_KEY = "ph:projects:colorder";
// localStorage keys for the user's custom columns + their per-project values.
const CUSTOM_COLS_KEY = "ph:projects:customcols";
const CUSTOM_VALS_KEY = "ph:projects:customvals";
// localStorage key for the user's show/hide column choice.
const HIDDEN_COLS_KEY = "ph:projects:hiddencols";
// Column visibility + custom fields are COMMON to every status table — stored
// under this single key instead of one entry per status group.
const SHARED_COLS_KEY = "__all";

// The column choice is stored as the hidden keys PLUS the keys that existed when
// it was saved. Without that snapshot, a column added to ALL_COLS in a later
// release would silently appear for everyone who has an older choice cached —
// with it, a new column simply takes its default visibility.
type StoredCols = Record<string, { hidden: string[]; known: string[] }>;

function loadHiddenCols(): Record<string, Set<string>> {
  try {
    const raw = JSON.parse(localStorage.getItem(HIDDEN_COLS_KEY) ?? "null") as StoredCols | null;
    if (!raw || typeof raw !== "object") return {};
    const liveKeys = new Set(ALL_COLS.map((c) => c.key));
    const out: Record<string, Set<string>> = {};
    for (const [groupKey, entry] of Object.entries(raw)) {
      const known = new Set(entry?.known ?? []);
      // Drop keys of columns that no longer exist; add ones the cache never saw.
      const hidden = new Set((entry?.hidden ?? []).filter((k) => liveKeys.has(k)));
      for (const c of ALL_COLS) if (!known.has(c.key) && !DEFAULT_COL_KEYS.includes(c.key)) hidden.add(c.key);
      out[groupKey] = hidden;
    }
    return out;
  } catch { return {}; }
}

function saveHiddenCols(m: Record<string, Set<string>>) {
  try {
    const known = ALL_COLS.map((c) => c.key);
    const out: StoredCols = {};
    for (const [groupKey, hidden] of Object.entries(m)) out[groupKey] = { hidden: [...hidden], known };
    localStorage.setItem(HIDDEN_COLS_KEY, JSON.stringify(out));
  } catch { /* ignore — quota/private mode */ }
}

const msTime = (s?: string | null) => (s ? new Date(s.slice(0, 10)).getTime() : null);

// "12 Mar 26" / "—" — the compact date the board cards use.
const fmtShortDate = (s?: string | null) =>
  s ? new Date(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" }) : "—";

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
// A project counts as finished when its status says completed OR every task is
// done (or, with no tasks, progress is 100). Lets a finished-but-not-yet-flagged
// project read as Completed instead of Delayed/overdue.
function isProjectComplete(p: { status: string; progress?: number | null }, agg?: TaskAgg): boolean {
  if (displayStatusOf(p.status).key === "completed") return true;
  if (agg && agg.total > 0) return agg.done >= agg.total;
  return (p.progress ?? 0) >= 100;
}

function scheduleHealth(p: ProjectRow, agg?: TaskAgg): RowHealth {
  const ds = displayStatusOf(p.status).key;
  const r = (n: number) => Math.round(n);
  if (ds === "cancelled" || ds === "postponed")
    return { key: "na", label: "—", color: HEALTH_COLORS.na, reason: `No schedule health for ${displayStatusOf(p.status).label.toLowerCase()} projects.` };

  const now = Date.now();
  const total = agg?.total ?? 0;
  const done = agg?.done ?? 0;
  const actualPct = total > 0 ? (done / total) * 100 : (p.progress ?? 0);

  // Finished (flag set, or all tasks done / 100%) → Completed, even if past due.
  if (isProjectComplete(p, agg))
    return { key: "completed", label: "Completed", color: HEALTH_COLORS.completed, reason: total > 0 ? `Completed — all ${total} task(s) done.` : "Completed — 100% progress." };

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

// Roll-up in the corner of each board column header — how the lane's projects are
// doing. "Overdue" reuses the rule the Health column uses (past the target end
// date and not yet complete), so a lane's count always agrees with its cards.
function laneStats(rows: ProjectRow[], taskAgg: Map<number, TaskAgg>): BoardGroupStat[] {
  let overdue = 0, completed = 0;
  for (const p of rows) {
    const agg = taskAgg.get(p.id);
    if (isProjectComplete(p, agg)) completed++;
    else if (scheduleHealth(p, agg).key === "delayed") overdue++;
  }
  return [
    { label: "total", value: rows.length },
    { label: "overdue", value: overdue, tone: "danger" },
    { label: "completed", value: completed, tone: "success" },
  ];
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

// ── Action-Centre kanban card (shared <ActionCard>) — map a project → props. ──
function ActionCentreProjectCard({ p, ownerName, ownerPhoto, taskAgg, onAssignOwner }: {
  p: ProjectRow;
  ownerName: (p: ProjectRow) => string | null;
  ownerPhoto: (p: ProjectRow) => string | null;
  taskAgg: Map<number, TaskAgg>;
  onAssignOwner?: (p: ProjectRow, hit: EmployeeHit) => void;
}) {
  const agg = taskAgg.get(p.id);
  const completed = isProjectComplete(p, agg);
  // Overdue projects live in the board's own "Delayed" lane — the lane is the
  // signal, so the card itself stays neutral (no red shell).
  const overdue = false;
  const pct = p.progress != null
    ? p.progress
    : agg && agg.total ? Math.round((agg.done / agg.total) * 100) : null;
  const on = ownerName(p);
  // Click the avatar to reassign — stop drag/open so only the picker opens.
  const stop = (e: SyntheticEvent) => e.stopPropagation();
  const ownerSlot = onAssignOwner ? (
    <span onPointerDown={stop} onClick={stop} className="min-w-0">
      <EmployeeCombobox
        value={on ?? undefined}
        onSelect={(hit) => onAssignOwner(p, hit)}
        trigger={
          <button type="button" title={on ? `Owner: ${on} — click to reassign` : "Assign owner"}
            className="flex items-center gap-1.5 min-w-0 rounded px-1 py-0.5 -mx-1 hover:bg-slate-100">
            <PersonCell name={on} photoUrl={ownerPhoto(p)} />
            <span className="text-[11px] font-medium text-slate-600 truncate max-w-[110px]">{on || "—"}</span>
          </button>
        }
      />
    </span>
  ) : undefined;
  const health = scheduleHealth(p, agg);
  const stage = stageLabelOf(p.stage);
  // Everything the card knew before (code · function, name, owner, priority, due,
  // progress) stays; these rows add what you'd otherwise have to open the project
  // for — where it is, whether it's on schedule, how its tasks are doing, and the
  // planned vs actual schedule.
  const details = (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 flex-wrap">
        {/* Solid fill + white label — the Action Centre status pill, so a status
            reads the same here as it does on an action card. */}
        <StatusChip status={p.status} size="sm" solid noDot className="h-6 px-2.5 font-semibold" />
        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-500" title={health.reason}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: health.color }} />
          {health.label}
        </span>
        {stage && <span className="text-[10px] text-slate-400 truncate" title={stage}>· {stage}</span>}
      </div>
      <div className="flex items-center gap-2 text-[10px] text-slate-500">
        <ListChecks className="w-3 h-3 text-slate-400 shrink-0" />
        {agg && agg.total > 0 ? (
          <span className="tabular-nums">
            {agg.done}/{agg.total} tasks
            {agg.overdue > 0 && <span className="ml-1 font-semibold text-red-600">· {agg.overdue} overdue</span>}
          </span>
        ) : (
          <span className="text-slate-400">No tasks</span>
        )}
      </div>
      <div className="flex items-center gap-2 text-[10px] text-slate-500">
        <CalendarClock className="w-3 h-3 text-slate-400 shrink-0" />
        <span className="tabular-nums truncate">
          Plan {fmtShortDate(p.startDate)} → {fmtShortDate(p.endDate)}
        </span>
      </div>
      {(p.actualStartDate || p.actualEndDate) && (
        <div className="flex items-center gap-2 text-[10px] text-slate-500">
          <CalendarClock className="w-3 h-3 text-slate-400 shrink-0" />
          <span className="tabular-nums truncate">
            Actual {fmtShortDate(p.actualStartDate)} → {fmtShortDate(p.actualEndDate)}
          </span>
        </div>
      )}
    </div>
  );
  return (
    <ActionCard
      meta={[projectCode(p), p.function].filter(Boolean).join(" · ")}
      title={p.name}
      ownerName={on}
      ownerPhoto={ownerPhoto(p)}
      priority={p.priority}
      dueDate={p.endDate}
      progressPct={pct}
      completed={completed}
      overdue={overdue}
      ownerSlot={ownerSlot}
      details={details}
    />
  );
}

// Inline project-priority picker — click the cell to change P0–P3. PATCHes the
// project and calls onSaved (refetch) so the list reflects the new value.
// Inline plant editor for the projects table — same interaction as the
// Priority cell: the cell is plain text, clicking it opens a floating menu
// (portalled to <body>), and picking a value PATCHes pmo_projects.siteRegion.
function PlantSelectCell({ projectId, value, options, onSaved }: { projectId: number; value: string; options: string[]; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Keep a non-standard existing value selectable rather than silently dropping it.
  const merged = value && !options.includes(value) ? [value, ...options] : options;
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const dismiss = () => setOpen(false);
    document.addEventListener("mousedown", close);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [open]);
  const toggle = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, left: r.left + r.width / 2 });
    setOpen((o) => !o);
  };
  const pick = async (v: string) => {
    setOpen(false);
    if (v === value) return;
    await fetch(`/api/projects/${projectId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ siteRegion: v }) });
    onSaved();
  };
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); toggle(); }}
        title={value ? `Plant: ${value} — click to change` : "No plant yet — click to add"}
        className={`absolute inset-0 w-full h-full flex items-center cursor-pointer ${value ? "px-2 text-[11px] leading-none text-gray-700" : "justify-center"}`}
      >
        {value ? (
          <span className="truncate">{value}</span>
        ) : (
          /* Same empty-state affordance as the Team column's "+" chip. */
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-400 border border-gray-200 hover:bg-gray-200">+</span>
        )}
      </button>
      {open && pos && createPortal(
        <div
          ref={panelRef}
          style={{ position: "fixed", top: pos.top, left: pos.left, transform: "translateX(-50%)" }}
          className="z-[300] min-w-[140px] max-h-64 overflow-y-auto rounded-md bg-white border border-gray-200 shadow-xl py-0.5"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); void pick(""); }}
            className="w-full flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium hover:bg-gray-50 transition-colors"
          >
            <span className="text-gray-400">—</span>
            {!value && <Check size={11} className="ml-auto text-gray-500" />}
          </button>
          {merged.map((o) => (
            <button
              key={o}
              type="button"
              onClick={(e) => { e.stopPropagation(); void pick(o); }}
              className="w-full flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium hover:bg-gray-50 transition-colors"
            >
              <span className="text-gray-700 truncate">{o}</span>
              {o === value && <Check size={11} className="ml-auto shrink-0 text-gray-500" />}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

function ProjectPriorityDropdown({ projectId, priority, onSaved }: { projectId: number; priority: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pr = PRIORITY_META.get(priority as never);
  // The menu is portalled to <body> (fixed) so it floats above the table instead
  // of underflowing behind later rows. Close it on any outside click, scroll, or
  // resize since a fixed panel can't track the cell once the table moves.
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const dismiss = () => setOpen(false);
    document.addEventListener("mousedown", close);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [open]);
  const toggle = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, left: r.left + r.width / 2 });
    setOpen((o) => !o);
  };
  const pick = async (v: string) => {
    setOpen(false);
    if (v === priority) return;
    await fetch(`/api/projects/${projectId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ priority: v }) });
    onSaved();
  };
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); toggle(); }}
        className="absolute inset-0 w-full h-full flex items-center justify-center text-[9px] font-semibold leading-none cursor-pointer"
        style={pr ? { color: pr.color } : undefined}
      >
        {pr ? pr.label : <span className="text-gray-400">—</span>}
      </button>
      {open && pos && createPortal(
        <div
          ref={panelRef}
          style={{ position: "fixed", top: pos.top, left: pos.left, transform: "translateX(-50%)" }}
          className="z-[300] min-w-[84px] rounded-md bg-white border border-gray-200 shadow-xl py-0.5"
          onClick={(e) => e.stopPropagation()}
        >
          {TASK_PRIORITIES.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={(e) => { e.stopPropagation(); void pick(p.value); }}
              className="w-full flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium hover:bg-gray-50 transition-colors"
            >
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: p.solid }} />
              <span className="text-gray-700">{p.label}</span>
              {p.value === priority && <Check size={11} className="ml-auto text-gray-500" />}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

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
  const owner = ownerName(p);
  const agg = taskAgg.get(p.id);
  const taskTotal = agg?.total ?? 0;
  const taskDone = agg?.done ?? 0;
  const completed = isProjectComplete(p, agg);
  const sched = completed ? { label: "Completed", color: DISPLAY_BY_KEY.get("completed")?.color ?? "#16A34A" } : scheduleStatus(p.ragStatus);
  const pr = PRIORITY_META.get(p.priority as never);
  const budget = (p.capexBudget ?? 0) + (p.opexBudget ?? 0);
  const endMs = p.endDate ? new Date(p.endDate.slice(0, 10)).getTime() : null;
  const overdue = !completed && endMs != null && endMs < Date.now();
  const due = p.endDate ? (() => { const o = dateParts(p.endDate!); return `${o.day} ${o.mon} ${o.yy}`; })() : null;
  return (
    <div
      className={`bg-white rounded-lg border border-gray-200/80 ${overlay ? "shadow-[0_14px_30px_rgba(0,0,0,0.20)] rotate-[1.5deg]" : "shadow-[0_1px_3px_rgba(0,0,0,0.05)] group-hover:shadow-[0_8px_18px_rgba(0,0,0,0.10)] group-hover:-translate-y-0.5"} transition-all duration-150`}
      style={{ borderLeftWidth: 4, borderLeftColor: sched.color }}
    >
      <div className="p-3 pl-2.5">
        {/* Header — priority */}
        <div className="flex items-center justify-end gap-2">
          {pr && (
            <span className="inline-flex items-center gap-1 rounded px-1.5 h-[15px] text-[8.5px] font-bold uppercase tracking-wide shrink-0" style={{ background: pr.bg, color: pr.color }}>
              <Flag size={8} />{pr.label}
            </span>
          )}
        </div>

        {/* Title */}
        <div className="mt-1 text-[13px] font-semibold text-gray-800 leading-snug whitespace-normal break-words group-hover:text-primary transition-colors">{p.confidential && <LockBadge />}{p.name}</div>

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

  // Key on the visible project set so changing a filter (e.g. Department) remounts
  // the chart and re-runs auto-fit — the timeline always fills the width for the
  // current selection, not just on first load.
  const fitKey = rows.map((r) => r.id).join(",");
  return <MondayGantt key={fitKey} groups={groups} onOpen={onOpen} labelWidth={340} labelHeader="Project" autoFitOnLoad defaultCollapsed />;
}

// Local (not UTC) today, as YYYY-MM-DD, for overdue comparisons against the
// date-only start/end/due strings the API stores.
function localTodayISO(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}
// Unified RAG colour for a Gantt bar / milestone diamond, from its status + due
// date. The one mapping used everywhere on the Gantt so tasks and milestones
// read the same: GREEN completed · RED delayed (past its date, not done) or
// blocked · AMBER in progress / on hold · GREY not started (on time) or cancelled.
function ragStatusColor(status?: string | null, dueDate?: string | null): string {
  if (status === "completed") return RAG_HEX.green;
  if (status === "cancelled") return RAG_HEX.grey;
  if (dueDate && dueDate.slice(0, 10) < localTodayISO()) return RAG_HEX.red; // delayed / overdue
  if (status === "blocked") return RAG_HEX.red;
  if (status === "in_progress" || status === "on_hold") return RAG_HEX.amber;
  return RAG_HEX.grey; // not_started, still on time
}

// Compact "just now / 3h ago / 2d ago / 5w ago" for a comment timestamp.
function relTime(iso?: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return days <= 30 ? `${days}d ago` : `${Math.round(days / 7)}w ago`;
}

type PulseTask = {
  id: number; projectId?: number | null; milestoneId?: number | null; name: string;
  startDate?: string | null; endDate?: string | null;
  progressPct?: number | null; status?: string | null; parentTaskId?: number | null;
};
type PulseMilestone = {
  id: number; projectId?: number | null; name: string;
  startDate?: string | null; dueDate?: string | null; status?: string | null;
};

// ── Portfolio "This / Next week" Gantt — one lane per (dept-)filtered project,
//    showing its top-level tasks that fall inside a fixed ±1-week window, each
//    with its latest comment/update inline. This is the management "what we did
//    last week / what's coming next week" board, reusing the same Gantt + the
//    tasks + messages already loaded elsewhere. ────────────────────────────────
const PULSE_WINDOW_DAYS = 7;
function PortfolioPulseGantt({ projects, tasks, milestones, onOpen }: {
  projects: ProjectRow[];
  tasks: PulseTask[];
  milestones: PulseMilestone[];
  onOpen: (projectId: number) => void;
}) {
  const today = dayFloor(Date.now());
  const winLo = today - PULSE_WINDOW_DAYS * 86_400_000;
  const winHi = today + PULSE_WINDOW_DAYS * 86_400_000;
  const msf = (s?: string | null) => (s ? dayFloor(new Date(s.slice(0, 10)).getTime()) : null);

  // In-window tasks + milestone targets, grouped by project. A task counts if its
  // span overlaps the window; a milestone counts if its due (or start) date lands
  // inside it — so an OHC go-live on 20 Jul shows even with no task that day. A
  // project lane appears if it has EITHER a windowed task or a windowed milestone.
  const { grouped, windowTaskIds } = useMemo(() => {
    const tasksByProject = new Map<number, PulseTask[]>();
    const msByProject = new Map<number, PulseMilestone[]>();
    const ids: number[] = [];
    for (const t of tasks) {
      if (t.parentTaskId != null) continue;         // top-level tasks only (v1)
      const pid = t.projectId;
      if (pid == null) continue;
      const s = msf(t.startDate), e = msf(t.endDate);
      if (s == null && e == null) continue;         // undated → not a week item
      const lo = Math.min(s ?? e!, e ?? s!), hi = Math.max(s ?? e!, e ?? s!);
      if (hi < winLo || lo > winHi) continue;        // wholly outside the window
      const arr = tasksByProject.get(pid) ?? [];
      arr.push(t);
      tasksByProject.set(pid, arr);
      ids.push(t.id);
    }
    for (const m of milestones) {
      const pid = m.projectId;
      if (pid == null) continue;
      const due = msf(m.dueDate) ?? msf(m.startDate);
      if (due == null) continue;
      if (due < winLo || due > winHi) continue;      // target date outside the window
      const arr = msByProject.get(pid) ?? [];
      arr.push(m);
      msByProject.set(pid, arr);
    }
    const gs = projects
      .filter((p) => tasksByProject.has(p.id) || msByProject.has(p.id))
      .map((p) => ({ p, ts: tasksByProject.get(p.id) ?? [], ms: msByProject.get(p.id) ?? [] }));
    return { grouped: gs, windowTaskIds: ids };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, tasks, milestones]);

  // Latest comment/update per in-window task — one bulk call.
  const idKey = windowTaskIds.slice().sort((a, b) => a - b).join(",");
  const { data: latest = [] } = useQuery({
    queryKey: ["/api/messages/latest", idKey],
    enabled: windowTaskIds.length > 0,
    queryFn: async () => {
      const r = await fetch(`/api/messages/latest?taskIds=${idKey}`, { credentials: "include" });
      return r.ok ? (await r.json() as Array<{ taskId: number; body: string; senderName: string | null; createdAt: string }>) : [];
    },
  });
  const latestByTask = useMemo(() => {
    const m = new Map<number, { body: string; senderName: string | null; createdAt: string }>();
    for (const l of latest) m.set(l.taskId, { body: l.body, senderName: l.senderName, createdAt: l.createdAt });
    return m;
  }, [latest]);

  // Every milestone by id (for names / dates) so a task can nest under its own
  // milestone even when that milestone's date sits outside the ±1-week window.
  const milestoneById = useMemo(() => {
    const m = new Map<number, PulseMilestone>();
    for (const ms of milestones) m.set(ms.id, ms);
    return m;
  }, [milestones]);

  // Build one item per task, at the given depth (1 = nested under a milestone).
  const taskItem = (t: PulseTask, depth: number): GanttItem => {
    const upd = latestByTask.get(t.id);
    return {
      id: t.id,
      name: t.name,
      start: t.startDate,
      end: t.endDate,
      depth,
      progress: Math.max(0, Math.min(100, t.progressPct ?? 0)),
      color: ragStatusColor(t.status, t.endDate),
      meta: upd ? (
        <span
          className="inline-flex items-center gap-1 text-[10px] text-muted-foreground min-w-0"
          title={`${upd.body}${upd.senderName ? ` — ${upd.senderName}` : ""}${upd.createdAt ? ` · ${relTime(upd.createdAt)}` : ""}`}
        >
          <MessageSquare size={10} className="opacity-60 shrink-0" />
          <span className="truncate max-w-[240px]">{upd.body}</span>
          <span className="opacity-60 shrink-0 whitespace-nowrap">· {relTime(upd.createdAt)}</span>
        </span>
      ) : (
        <span className="text-[10px] italic text-muted-foreground/60">No updates yet</span>
      ),
    };
  };

  const ganttGroups: GanttGroup[] = grouped.map(({ p, ts, ms }) => {
    // Nest each project's in-window tasks UNDER their milestone: for every
    // milestone we show a diamond header row (depth 0), then its tasks indented
    // (depth 1). A milestone appears if it has in-window tasks OR is itself an
    // in-window target (e.g. a go-live with no task that week). Tasks with no
    // milestone fall to the bottom at the project level.
    const tasksByMs = new Map<number | null, PulseTask[]>();
    for (const t of ts) {
      const k = t.milestoneId ?? null;
      const arr = tasksByMs.get(k) ?? [];
      arr.push(t);
      tasksByMs.set(k, arr);
    }
    // Milestone ids to render: those with tasks this week, plus in-window targets.
    const msIds = new Set<number>();
    for (const k of tasksByMs.keys()) if (k != null) msIds.add(k);
    for (const m of ms) msIds.add(m.id);
    const orderedMsIds = [...msIds].sort(
      (a, b) => (msf(milestoneById.get(a)?.dueDate ?? milestoneById.get(a)?.startDate) ?? 0) - (msf(milestoneById.get(b)?.dueDate ?? milestoneById.get(b)?.startDate) ?? 0),
    );
    const byStart = (a: PulseTask, b: PulseTask) => (msf(a.startDate) ?? msf(a.endDate) ?? 0) - (msf(b.startDate) ?? msf(b.endDate) ?? 0);

    const items: GanttItem[] = [];
    for (const mid of orderedMsIds) {
      const m = milestoneById.get(mid);
      items.push({
        id: -mid, // negative id space so it can't collide with a task id
        name: m?.name ?? "Milestone",
        start: m?.dueDate ?? m?.startDate,
        end: m?.dueDate ?? m?.startDate,
        isMilestone: true,
        color: ragStatusColor(m?.status, m?.dueDate),
        meta: (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
            🎯 Target · {(m?.dueDate ?? m?.startDate ?? "").slice(0, 10) || "no date"}
          </span>
        ),
      });
      for (const t of (tasksByMs.get(mid) ?? []).slice().sort(byStart)) items.push(taskItem(t, 1));
    }
    // Tasks with no milestone — show at project level, below the milestone groups.
    for (const t of (tasksByMs.get(null) ?? []).slice().sort(byStart)) items.push(taskItem(t, 0));

    return {
      key: `proj-${p.id}`,
      label: p.name,
      color: projectRagColor(p),
      id: p.id,
      items,
    };
  });

  if (ganttGroups.length === 0) {
    return (
      <div className="glass-surface rounded-2xl text-sm text-muted-foreground text-center py-10">
        Nothing scheduled in the last-7 / next-7-day window for the selected projects — no tasks or milestone targets land here.
      </div>
    );
  }

  return (
    <MondayGantt
      key={ganttGroups.map((g) => g.key).join(",")}
      groups={ganttGroups}
      onOpen={(id) => {
        // Milestone items carry a negative id (-milestoneId); tasks carry their own.
        const pid = id < 0
          ? milestones.find((m) => m.id === -id)?.projectId
          : tasks.find((x) => x.id === id)?.projectId;
        if (pid != null) onOpen(pid);
      }}
      labelWidth={380}
      labelHeader="Project / Task"
      rangeStart={winLo}
      rangeEnd={winHi}
      autoFitOnLoad
    />
  );
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

// Investment / type classification for the toolbar filter.
// A project's own `category` column wins when it carries one (set on import, or
// by an admin). The CIP name match below is the legacy path: those tracker
// imports predate the category column and have no category to read.
const CLASS_KEYS = ["CAPEX", "OPEX", "NPL", "NPD", "CIP", "IT"] as const;
const CIP_NAME_RE = /metoprolol|potassium chloride|klorcon|\bkcl\b/;
function classifyProject(p: Record<string, unknown>): string[] {
  const category = `${p.category ?? ""}`.trim().toUpperCase();
  if ((CLASS_KEYS as readonly string[]).includes(category)) return [category];
  const hay = `${p.name ?? ""}`.toLowerCase();
  return CIP_NAME_RE.test(hay) ? ["CIP"] : ["IT"];
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
  // All tasks across open projects — drives the Tasks + Task Status columns and
  // the board's per-lane task roll-up (endDate is what makes a task "overdue").
  const { data: tasks = [] } = useQuery({
    queryKey: ["/api/tasks", "all"],
    queryFn: async () => {
      const r = await fetch("/api/tasks");
      if (!r.ok) return [] as TaskRow[];
      return r.json() as Promise<TaskRow[]>;
    },
  });
  // All milestones across open projects — the portfolio "this/next week" board
  // renders in-window milestone TARGETS (e.g. an OHC go-live) as diamonds.
  const { data: allMilestones = [] } = useQuery({
    queryKey: ["/api/milestones", "all"],
    queryFn: async () => {
      const r = await fetch("/api/milestones");
      if (!r.ok) return [] as PulseMilestone[];
      return r.json() as Promise<PulseMilestone[]>;
    },
  });
  // Project-level attachment counts (task_id IS NULL), one bulk call → the
  // paperclip badge beside each project code in the table.
  const { data: attachmentCounts = [] } = useQuery({
    queryKey: ["/api/attachments/counts"],
    queryFn: async () => {
      const r = await fetch("/api/attachments/counts", { credentials: "include" });
      return r.ok ? (await r.json() as Array<{ projectId: number; count: number }>) : [];
    },
  });
  const attachmentCountByProject = useMemo(
    () => new Map(attachmentCounts.map((c) => [c.projectId, c.count])),
    [attachmentCounts],
  );

  // Project-level comment counts (task_id IS NULL), one bulk call → the Comments
  // column badge. Matches what the project comms drawer shows.
  const { data: commentCounts = [] } = useQuery({
    queryKey: ["/api/messages/counts"],
    queryFn: async () => {
      const r = await fetch("/api/messages/counts", { credentials: "include" });
      return r.ok ? (await r.json() as Array<{ projectId: number; count: number }>) : [];
    },
  });
  const commentCountByProject = useMemo(
    () => new Map(commentCounts.map((c) => [c.projectId, c.count])),
    [commentCounts],
  );

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
    const today = new Date().toISOString().slice(0, 10);
    for (const t of tasks) {
      if (t.projectId == null) continue;
      if (t.parentTaskId != null) continue; // subtasks don't count as tasks
      const e = m.get(t.projectId) ?? { total: 0, done: 0, in_progress: 0, delayed: 0, on_hold: 0, not_started: 0, overdue: 0 };
      e.total++;
      switch (t.status) {
        case "completed": e.done++; break;
        case "in_progress": e.in_progress++; break;
        case "delayed": e.delayed++; break;
        case "on_hold": e.on_hold++; break;
        default: e.not_started++; break;
      }
      // Past its end date and still open — whether or not the status says so.
      if (t.status !== "completed" && (t.status === "delayed" || (t.endDate && t.endDate.slice(0, 10) < today))) e.overdue++;
      m.set(t.projectId, e);
    }
    return m;
  }, [tasks]);

  // Owner id: prefer the project's own projectOwnerId (SSOT for new assignments,
  // works without a charter); fall back to the linked charter for existing data.
  const ownerIdFor = (p: ProjectRow): number | null => {
    const pid = (p as unknown as Record<string, unknown>).projectOwnerId as number | null | undefined;
    if (pid != null) return pid;
    return p.charterId != null ? ownerByCharter.get(p.charterId) ?? null : null;
  };
  const ownerName = (p: ProjectRow) => {
    const oid = ownerIdFor(p);
    return oid != null ? usersById.get(oid) ?? null : null;
  };
  const managerName = (p: ProjectRow) => (p.projectManagerId != null ? usersById.get(p.projectManagerId) ?? null : null);
  const ownerPhoto = (p: ProjectRow) => {
    const oid = ownerIdFor(p);
    return oid != null ? photoById.get(oid) ?? null : null;
  };
  const managerPhoto = (p: ProjectRow) => (p.projectManagerId != null ? photoById.get(p.projectManagerId) ?? null : null);

  // ── Owner assignment — pick from the master employee directory and persist to
  //    the linked charter's projectOwnerId (where the owner lives). PMO users are
  //    matched to employees by email; a first-time owner with no PMO user row yet
  //    gets one created on the fly, then the charter is pointed at it.
  const userIdByEmail = useMemo(() => {
    const m = new Map<string, number>();
    for (const u of users as Array<{ id: number; email?: string | null }>) {
      if (u.email) m.set(u.email.toLowerCase(), u.id);
    }
    return m;
  }, [users]);
  const { mutateAsync: createUserAsync } = useCreateUser();
  const { mutateAsync: updateCharterAsync } = useUpdateCharter();
  const { mutateAsync: updateProjectAsync } = useUpdateProject();
  const [assigningId, setAssigningId] = useState<number | null>(null);

  const assignOwner = async (p: ProjectRow, hit: EmployeeHit) => {
    if (!hit.email) { toast({ title: "Can't assign", description: `${hit.name} has no email on record.` }); return; }
    try {
      setAssigningId(p.id);
      let uid = userIdByEmail.get(hit.email.toLowerCase());
      if (uid == null) {
        const created = await createUserAsync({ data: { name: hit.name, email: hit.email, role: "team_member", department: hit.designation ?? "" } });
        uid = (created as { id: number }).id;
      }
      // Store on the project (works for charter-less projects too); keep the
      // charter in sync when one exists so other charter readers stay correct.
      await updateProjectAsync({ id: p.id, data: { projectOwnerId: uid } as never });
      if (p.charterId != null) await updateCharterAsync({ id: p.charterId, data: { projectOwnerId: uid } });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["/api/projects"] }),
        qc.invalidateQueries({ queryKey: ["/api/charters"] }),
        qc.invalidateQueries({ queryKey: ["/api/users"] }),
      ]);
      await refetch();
      toast({ title: "Owner assigned", description: `${hit.name} is now the owner.` });
    } catch (e) {
      toast({ variant: "destructive", title: "Couldn't assign owner", description: (e as Error)?.message });
    } finally {
      setAssigningId(null);
    }
  };

  // ── Project-level Communication + Attachments drawer (opened per-project
  //    from a Kanban card or a Table row). Backed by project-scoped messages.
  const currentUserId = useUserStore((s) => s.userId);
  // Justification gate for kanban status moves (same UX as the CXO board).
  const [moveJustify, setMoveJustify] = useState<{ id: number; to: string; toLabel: string } | null>(null);
  const [movingPending, setMovingPending] = useState(false);
  const [commsProject, setCommsProject] = useState<{ id: number; code: string; name: string } | null>(null);
  const [commsTab, setCommsTab] = useState<ProjectCommsTab>("communication");
  const openComms = (p: ProjectRow, tab: ProjectCommsTab) => {
    setCommsProject({ id: p.id, code: projectCode(p), name: p.name });
    setCommsTab(tab);
  };

  // Admin gate — same test the connectors popup and role simulator use. Only
  // admins get the custom-field editor in the Columns menu.
  const { profile } = useAuth();
  const isAdmin = !!(profile?.is_super_admin || profile?.pmo_role === "admin");

  // ── Saved views (Stage 3 — Customization)
  const views = useUserView<ProjectsViewConfig>({ scope: "project_list", fallback: FALLBACK });
  const [search, setSearch] = useState(FALLBACK.search);
  const [status, setStatus] = useState(FALLBACK.status);
  // CAPEX/OPEX/NPL/CIP/IT type filter — single-select dropdown; "" = All (no
  // type filtering). Selecting one isolates to projects carrying that tag.
  const [classFilter, setClassFilter] = useState<string>("");
  const [priority, setPriority] = useState("");
  const [sort, setSort] = useState<ProjectsViewConfig["sort"]>(FALLBACK.sort);

  // Collapsible status sections (dropdowns). Default: all expanded.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggleGroup = (key: string) => setCollapsed((c) => ({ ...c, [key]: !c[key] }));

  // View switcher — List · Board · Gantt (List/Board named as in Action Centre).
  // Always opens on the list; the view is not persisted, so every fresh entry
  // defaults to it. (Calendar lives on the Tasks view now, not here.)
  const [view, setView] = useState<"list" | "board" | "gantt">(() => {
    const v = new URLSearchParams(window.location.search).get("view");
    return v === "board" || v === "gantt" ? v : "list";
  });
  // Gantt sub-mode: the classic by-status project Gantt, or the portfolio
  // "this / next week" board (one lane per project → tasks in a ±1-week window,
  // each with its latest update). Best paired with the Department filter.
  const [pulseMode, setPulseMode] = useState(() => new URLSearchParams(window.location.search).get("pulse") === "1");
  // Board "Group by" axis (Action Centre parity): status · owner · priority · department.
  const [groupBy, setGroupBy] = useState<"status" | "owner" | "priority" | "department">("status");

  // Column visibility + custom columns are PER status-table (keyed by group.key)
  // so a field switched on in one table only shows there, never the others.
  // Stored as the set of HIDDEN keys (like Action Centre), which makes "Show all"
  // an empty set and "Default columns" the same derivation as the initial state.
  // Persisted to localStorage, so the user's columns survive a reload.
  // ONE shared column config for all status tables. The helpers keep their
  // (groupKey) signatures so existing call sites are untouched, but ignore it and
  // read/write the single SHARED_COLS_KEY entry.
  const [hiddenCols, setHiddenCols] = useState<Record<string, Set<string>>>(loadHiddenCols);
  useEffect(() => { saveHiddenCols(hiddenCols); }, [hiddenCols]);
  const hiddenFor = (_groupKey?: string) => hiddenCols[SHARED_COLS_KEY] ?? defaultHiddenCols();
  const toggleCol = (_groupKey: string, key: string) =>
    setHiddenCols((m) => {
      const next = new Set(m[SHARED_COLS_KEY] ?? defaultHiddenCols());
      if (next.has(key)) next.delete(key); else next.add(key);
      return { ...m, [SHARED_COLS_KEY]: next };
    });
  const setHiddenForGroup = (_groupKey: string, next: Set<string>) =>
    setHiddenCols((m) => ({ ...m, [SHARED_COLS_KEY]: next }));
  const [customCols, setCustomCols] = useState<Record<string, { id: string; header: string }[]>>(() => {
    try { const s = JSON.parse(localStorage.getItem(CUSTOM_COLS_KEY) ?? "null"); return s && typeof s === "object" && !Array.isArray(s) ? s : {}; } catch { return {}; }
  });
  const [customVals, setCustomVals] = useState<Record<string, string>>(() => {
    try { const s = JSON.parse(localStorage.getItem(CUSTOM_VALS_KEY) ?? "null"); return s && typeof s === "object" ? s : {}; } catch { return {}; }
  });
  useEffect(() => { try { localStorage.setItem(CUSTOM_COLS_KEY, JSON.stringify(customCols)); } catch { /* ignore */ } }, [customCols]);
  useEffect(() => { try { localStorage.setItem(CUSTOM_VALS_KEY, JSON.stringify(customVals)); } catch { /* ignore */ } }, [customVals]);
  const setCustomVal = (projectId: number, fieldId: string, value: string) =>
    setCustomVals((m) => ({ ...m, [`${projectId}:${fieldId}`]: value }));
  // Columns for one status-table (default order). Each <ExcelGroupTable> reorders/
  // resizes its own copy independently, so the status tables never affect one another.
  const activeColsFor = (_groupKey?: string) => {
    const hidden = hiddenCols[SHARED_COLS_KEY] ?? defaultHiddenCols();
    return [
      ...ALL_COLS.filter((c) => !hidden.has(c.key)),
      ...(customCols[SHARED_COLS_KEY] ?? []).map((c) => ({ key: `cf:${c.id}`, header: c.header || "Untitled", width: 160 as number, info: "Custom field — click the header to rename it." })),
      { key: "__del__", header: "", width: 40 as number },
    ];
  };

  // Inline date edit (planned + actual) — PATCHes the one field and refetches.
  const saveProjectDate = async (id: number, field: DateKey, value: string) => {
    try {
      const r = await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error || "Save failed");
      void refetch();
    } catch (e) {
      toast({ title: "Couldn't save the date", description: e instanceof Error ? e.message : "Please try again.", variant: "destructive" });
    }
  };

  // Delete a project (with its milestones/tasks); the charter returns to the
  // Approved lane so it can be re-created.
  const deleteProject = async (p: ProjectRow) => {
    if (!window.confirm(`Delete project "${p.name}"?\n\nThis removes its milestones and tasks. The charter is kept and returns to the Approved lane.`)) return;
    try {
      const r = await fetch(`/api/projects/${p.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error || "Delete failed");
      toast({ title: "Project deleted" });
      void refetch();
    } catch (e) {
      toast({ title: "Couldn't delete project", description: e instanceof Error ? e.message : "Please try again.", variant: "destructive" });
    }
  };

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

  // Every department in the org (master-DB employees.function) — so departments
  // with no projects still appear in the filter.
  const { data: allDepts = [] } = useQuery({
    queryKey: ["/api/departments"],
    queryFn: async () => {
      const r = await fetch("/api/departments");
      return r.ok ? (r.json() as Promise<string[]>) : [];
    },
    staleTime: 10 * 60_000,
  });

  // Plants / sites — master-DB org_units (the same list OHC's plant switcher
  // uses), fetched once; falls back to project-derived values when empty.
  const { data: allPlants = [] } = useQuery({
    queryKey: ["/api/plants"],
    queryFn: async () => {
      const r = await fetch("/api/plants");
      return r.ok ? (r.json() as Promise<{ code: string; label: string }[]>) : [];
    },
    staleTime: 10 * 60_000,
  });

  // Plant filter (org_units labels + any free-text siteRegion already on projects).
  const [plant, setPlant] = useState("");
  const plantOptions = useMemo(() => {
    const set = new Set<string>();
    for (const u of allPlants as { label: string }[]) if (u.label) set.add(u.label);
    for (const p of (projects ?? []) as ProjectRow[]) if (p.siteRegion) set.add(p.siteRegion);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [allPlants, projects]);

  // Department filter (full DB list + project.function + the user's own dept).
  const [dept, setDept] = useState(() => new URLSearchParams(window.location.search).get("dept") ?? "");
  const deptOptions = useMemo(() => {
    const set = new Set<string>();
    for (const d of (allDepts as string[])) set.add(d);
    for (const p of (projects ?? []) as ProjectRow[]) if (p.function) set.add(p.function);
    set.add("HR"); // always offer the HR department filter
    if (me?.function) set.add(me.function); // ensure the user's own dept is selectable
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [projects, me, allDepts]);

  // On first load, default the Projects view to the user's own department —
  // UNLESS we arrived with a saved URL state (view/pulse/dept present), i.e. the
  // user is returning via Back from a project and their choices must be honoured
  // (including an explicit "All departments"). Clearing then reveals every dept.
  const deptInitedRef = useRef(false);
  const urlHadStateRef = useRef((() => {
    const p = new URLSearchParams(window.location.search);
    return p.has("view") || p.has("pulse") || p.has("dept");
  })());
  useEffect(() => {
    if (deptInitedRef.current || me === undefined) return;
    deptInitedRef.current = true;
    if (!urlHadStateRef.current && me?.function) setDept(me.function);
  }, [me]);

  // Persist view · this/next-week toggle · department in the URL query. So when
  // the user clicks a Gantt bar into a project and hits Back, the Projects page
  // remounts from these params and restores the exact view + filters, instead of
  // resetting to defaults. Unrelated query params are preserved.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (view === "list") p.delete("view"); else p.set("view", view);
    if (pulseMode) p.set("pulse", "1"); else p.delete("pulse");
    if (dept) p.set("dept", dept); else p.delete("dept");
    const qs = p.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, [view, pulseMode, dept]);

  // Icon menus — Search + Filter + Add column. Close on outside click.
  const [searchOpen, setSearchOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [colsOpen, setColsOpen] = useState<string | null>(null);
  const [deptOpen, setDeptOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement | null>(null);
  const filterRef = useRef<HTMLDivElement | null>(null);
  const colsRef = useRef<HTMLDivElement | null>(null);
  const deptRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const target = e.target as Node;
      // The filter panel's dropdowns are Radix Selects, which portal their list to
      // <body>, outside filterRef. Without this the first option click would close
      // the whole panel, so treat any click inside a Radix popper as "inside".
      if (target instanceof Element && target.closest("[data-radix-popper-content-wrapper]")) return;
      // Only auto-close the search pop-out when it's empty (keep an active query visible).
      if (searchRef.current && !searchRef.current.contains(target) && !search) setSearchOpen(false);
      if (filterRef.current && !filterRef.current.contains(target)) setFilterOpen(false);
      if (colsRef.current && !colsRef.current.contains(target)) setColsOpen(null);
      if (deptRef.current && !deptRef.current.contains(target)) setDeptOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [search]);

  // ── One Filter menu, sub-sections stacked one below another (Status · Priority
  // · Plant · Type), each a single-select dropdown with an "All" reset. "" means
  // the facet is off. Department is deliberately NOT here — it's used so often
  // that it lives as a standalone searchable dropdown in the toolbar (below).
  const facets: Facet[] = useMemo(() => [
    { key: "status", label: "Status", Icon: CircleDot, value: status, onPick: setStatus, options: STATUS_CHIPS },
    { key: "priority", label: "Priority", Icon: Flag, value: priority, onPick: setPriority, options: PRIORITY_CHIPS },
    {
      key: "plant", label: "Plant", Icon: Factory, value: plant, onPick: setPlant,
      options: [{ value: "", label: "All plants" }, ...plantOptions.map((p) => ({ value: p, label: p }))],
    },
    {
      key: "type", label: "Type", Icon: Layers, value: classFilter, onPick: setClassFilter,
      options: [{ value: "", label: "All types" }, ...CLASS_KEYS.map((k) => ({ value: k, label: k }))],
    },
  ], [status, priority, plant, classFilter, plantOptions]);
  const activeFilterCount = facets.filter((f) => f.value).length;
  const clearFilters = () => { setStatus(""); setPriority(""); setDept(""); setPlant(""); setClassFilter(""); };

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
      if (plant && ((p as ProjectRow).siteRegion ?? "") !== plant) return false;
      // Type filter (single-select). "" = All (uncategorised included); a chosen
      // type isolates to projects carrying that tag (CIP ⇒ Metoprolol-only).
      if (classFilter && !classifyProject(p as unknown as Record<string, unknown>).includes(classFilter)) return false;
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
  }, [projects, search, status, priority, dept, plant, sort, classFilter]);

  // ── Group the filtered projects by display status (New → Active → Completed
  //    → Cancelled → Postponed). Empty groups are dropped.
  const listGroups = useMemo<BoardGroup<ProjectRow>[]>(() => {
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

  // Resolve a project's owner id (lives on the linked charter, not the project).
  const ownerIdOf = (p: ProjectRow) => ownerIdFor(p);

  // Kanban columns by the selected "Group by" axis (Action Centre parity):
  //   status   = the fixed lifecycle columns (incl. empty, for a stable shape);
  //   priority = P0–P3 (+ No priority);
  //   owner    = one lane per owner present, busiest first, No owner last.
  const boardGroups = useMemo<BoardGroup<ProjectRow>[]>(() => {
    // Every lane, whatever the axis, carries the same project + task roll-up in
    // its header (total / overdue / completed).
    const withStats = (lanes: BoardGroup<ProjectRow>[]) =>
      lanes.map((g) => ({ ...g, stats: laneStats(g.rows, taskAgg) }));
    if (groupBy === "priority") {
      const cols: BoardGroup<ProjectRow>[] = TASK_PRIORITIES.map((p) => ({
        key: p.value, label: p.label, color: p.solid,
        rows: filtered.filter((r) => r.priority === p.value),
      }));
      const none = filtered.filter((r) => !PRIORITY_META.has(r.priority as never));
      if (none.length) cols.push({ key: "__noprio__", label: "No priority", color: "#94A3B8", rows: none });
      return withStats(cols);
    }
    if (groupBy === "owner") {
      const byKey = new Map<string, ProjectRow[]>();
      for (const p of filtered) {
        const oid = ownerIdOf(p);
        const k = oid != null ? String(oid) : "__none__";
        const arr = byKey.get(k) ?? []; arr.push(p); byKey.set(k, arr);
      }
      const lanes: BoardGroup<ProjectRow>[] = [...byKey.entries()]
        .filter(([k]) => k !== "__none__")
        .sort((a, b) => b[1].length - a[1].length)
        .map(([k, rows]) => ({ key: k, label: usersById.get(Number(k)) ?? `User ${k}`, color: "#3B82F6", rows }));
      const none = byKey.get("__none__");
      if (none && none.length) lanes.push({ key: "__none__", label: "No owner", color: "#94A3B8", rows: none });
      return withStats(lanes);
    }
    if (groupBy === "department") {
      const byKey = new Map<string, ProjectRow[]>();
      for (const p of filtered) {
        const k = p.function?.trim() || "__none__";
        const arr = byKey.get(k) ?? []; arr.push(p); byKey.set(k, arr);
      }
      const lanes: BoardGroup<ProjectRow>[] = [...byKey.entries()]
        .filter(([k]) => k !== "__none__")
        .sort((a, b) => b[1].length - a[1].length)
        .map(([k, rows]) => ({ key: k, label: k, color: "#6366F1", rows }));
      const none = byKey.get("__none__");
      if (none && none.length) lanes.push({ key: "__none__", label: "No department", color: "#94A3B8", rows: none });
      return withStats(lanes);
    }
    // Status lanes — the five Action Centre buckets, in AC's order. "Overdue" is
    // schedule health (not a DB status), so those projects are pulled out of their
    // status bucket first and each project still appears exactly once.
    const delayed = filtered.filter((r) => scheduleHealth(r, taskAgg.get(r.id)).key === "delayed");
    const delayedIds = new Set(delayed.map((r) => r.id));
    const laneOf = (key: string): BoardGroup<ProjectRow> => {
      const d = DISPLAY_BY_KEY.get(key)!;
      return {
        key,
        label: BOARD_STATUS_LABEL[key] ?? d.label,
        color: d.color,
        rows: (buckets.get(key) ?? []).filter((r) => !delayedIds.has(r.id)),
      };
    };
    const cols: BoardGroup<ProjectRow>[] = [
      laneOf("new"),
      laneOf("active"),
      { key: "__delayed__", label: BOARD_STATUS_LABEL.__delayed__, color: HEALTH_COLORS.delayed, rows: delayed },
      laneOf("postponed"),
      laneOf("completed"),
    ];
    return withStats(cols);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupBy, filtered, buckets, ownerByCharter, usersById, taskAgg]);

  return (
    <div className="space-y-2 pt-1.5">
      {/* Header — z-50 so the toolbar filter dropdowns sit above the Gantt/Kanban
          (ph-rise leaves a transform → stacking context, so it needs an explicit z). */}
      <div className="relative z-50 flex flex-col gap-2 ph-rise">
        {/* Row 1 — "Projects" heading (left) + Add Project (right corner). */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 data-tour="tour-projects" className="text-xl font-bold text-foreground shrink-0">Projects</h2>
          {/* Add Project — one dropdown clubbing create + both imports. */}
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" title="Add a project — create manually or import" className="shrink-0 h-8 px-3 rounded-lg flex items-center gap-1.5 text-[12px] font-semibold text-white bg-blue-600 hover:bg-blue-700 shadow-sm transition-colors">
                <Plus size={14} /> Add Project <ChevronDown size={12} className="opacity-80" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-auto min-w-[11rem] p-1.5">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Add a project</div>
              <div className="flex flex-col gap-0.5 [&_button]:w-full [&_button]:justify-start [&_button]:whitespace-nowrap">
                <CreateProjectButton onDone={() => { void refetch(); }} />
                <JiraImportButton onDone={() => { void refetch(); }} />
                <ImportProjectsButton onDone={() => { void refetch(); }} />
              </div>
            </PopoverContent>
          </Popover>
        </div>
        {/* Row 2 — toolbar (left) + the ONE shared Columns manager (right corner,
            below Add Project). */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
      <div className="glass-surface lift-card ph-rise rounded-xl px-2 py-1.5 flex flex-wrap items-center gap-0.5 gap-y-1 w-fit max-w-full relative z-50">
        {/* Search — icon button that expands into an inline field, left of the toggles */}
        {searchOpen ? (
          <div ref={searchRef} className="flex items-center gap-1 mr-0.5 pl-1.5 pr-0.5 rounded-md bg-primary/5 border border-primary/30">
            <Search size={13} className="shrink-0 text-primary" />
            <Input
              autoFocus
              placeholder="Search projects…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") { setSearch(""); setSearchOpen(false); } }}
              className="h-6 w-44 text-[11px] border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 px-1"
            />
            <button type="button" onClick={() => { setSearch(""); setSearchOpen(false); }} title="Close search" className="shrink-0 text-muted-foreground hover:text-foreground">
              <X size={13} />
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

        {/* View switcher — Table · Kanban · Gantt */}
        <div className="flex items-center gap-0.5 mr-0.5 pr-0.5 border-r border-border/60">
          {([
            { key: "list", label: "List", Icon: Table2 },
            { key: "board", label: "Board", Icon: LayoutGrid },
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

        {/* Group by — board only; Action Centre PillSelect (status · owner · priority · department) */}
        {view === "board" && (
          <div className="mr-0.5 pr-1 border-r border-border/60">
            <GroupByPill<"status" | "owner" | "priority" | "department">
              value={groupBy}
              onChange={setGroupBy}
              options={[
                { value: "status", label: "Status" },
                { value: "owner", label: "Owner" },
                { value: "priority", label: "Priority" },
                { value: "department", label: "Department" },
              ]}
            />
          </div>
        )}

        {/* Department: a simple standalone dropdown, styled like the other toolbar
            buttons (no capsule). Kept outside the Filter menu since it's used most. */}
        <div className="relative" ref={deptRef}>
          <button
            type="button"
            onClick={() => { setDeptOpen((o) => !o); setFilterOpen(false); setColsOpen(null); }}
            title="Filter by department"
            className={`h-6 px-1.5 rounded-md flex items-center gap-1 text-[11px] font-medium transition-colors ${
              dept ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-accent"
            }`}
          >
            <Building2 size={13} />
            <span className="max-w-[120px] truncate">{dept || "Department"}</span>
            <ChevronDown size={11} className={`opacity-70 transition-transform ${deptOpen ? "rotate-180" : ""}`} />
          </button>
          {deptOpen && (
            <div className="absolute left-0 top-full mt-1.5 z-50 w-52 max-h-72 overflow-y-auto rounded-md py-1 bg-popover text-popover-foreground border border-popover-border shadow-lg">
              <button
                type="button"
                onClick={() => { setDept(""); setDeptOpen(false); }}
                className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 text-sm text-left transition-colors ${!dept ? "bg-accent text-primary" : "hover:bg-accent/60"}`}
              >
                <span className="truncate">All departments</span>
                {!dept && <Check size={13} className="shrink-0" />}
              </button>
              {deptOptions.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => { setDept(d); setDeptOpen(false); }}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 text-sm text-left transition-colors ${dept === d ? "bg-accent text-primary" : "hover:bg-accent/60"}`}
                >
                  <span className="truncate">{d}</span>
                  {dept === d && <Check size={13} className="shrink-0" />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Filter: one button for the remaining facets (Status, Priority, Plant,
            Type), each its own dropdown. The badge counts the facets narrowing the list. */}
        <div className="relative" ref={filterRef}>
          <button
            type="button"
            onClick={() => { setFilterOpen((o) => !o); setColsOpen(null); }}
            title="Filter projects"
            className={`h-6 px-1.5 rounded-md flex items-center gap-1 text-[11px] font-medium transition-colors ${
              activeFilterCount ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-accent"
            }`}
          >
            <Filter size={13} /> Filter
            {activeFilterCount > 0 && (
              <span className="ml-0.5 h-3.5 min-w-3.5 px-1 rounded-full bg-primary text-primary-foreground text-[9px] font-semibold leading-none flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
            <ChevronDown size={11} className="opacity-70" />
          </button>
          {filterOpen && (
            <div className="absolute right-0 top-full mt-1.5 z-50 w-72 rounded-md overflow-hidden bg-popover text-popover-foreground border border-popover-border shadow-lg">
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/60">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Filters</span>
                {activeFilterCount > 0 && (
                  <button type="button" onClick={clearFilters} className="text-[11px] font-medium text-primary hover:underline">
                    Clear all
                  </button>
                )}
              </div>
              {/* One row per facet — name on the left, its dropdown on the right. */}
              <div className="p-2 flex flex-col gap-1.5">
                {facets.map((f) => (
                  <div key={f.key} className="flex items-center gap-2">
                    <span className="flex items-center gap-1.5 w-24 shrink-0 text-[11px] font-medium">
                      <f.Icon size={12} className={f.value ? "text-primary" : "text-muted-foreground"} />
                      {f.label}
                    </span>
                    <Select
                      value={f.value || ALL_OPTION}
                      onValueChange={(v) => f.onPick(v === ALL_OPTION ? "" : v)}
                    >
                      <SelectTrigger className={`h-7 flex-1 min-w-0 text-[11px] ${f.value ? "border-primary/40 text-primary" : ""}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="max-h-72">
                        {f.options.map((o) => (
                          <SelectItem key={o.value || ALL_OPTION} value={o.value || ALL_OPTION} className="text-[11px]">
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

      </div>
          {/* Columns — ONE shared column manager for EVERY status table, pinned to
              the right corner of the toolbar row (below Add Project). List view only. */}
          {view === "list" && (
          <div className="relative shrink-0" ref={colsOpen === SHARED_COLS_KEY ? colsRef : undefined}>
            <button
              type="button"
              onClick={() => { setColsOpen((o) => o === SHARED_COLS_KEY ? null : SHARED_COLS_KEY); setFilterOpen(false); }}
              title="Show / hide columns for every status table"
              aria-label="Columns"
              className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg border border-border bg-card/70 text-[11px] font-medium text-foreground hover:bg-accent transition-colors"
            >
              <SlidersHorizontal size={13} />
              Columns
              {hiddenFor().size > 0 && (
                <span className="tabular-nums text-muted-foreground">({ALL_COLS.length - hiddenFor().size}/{ALL_COLS.length})</span>
              )}
              <ChevronDown size={11} className={`opacity-70 transition-transform ${colsOpen === SHARED_COLS_KEY ? "rotate-180" : ""}`} />
            </button>
            {colsOpen === SHARED_COLS_KEY && (
              <div className="absolute right-0 top-full mt-1.5 z-50 w-60 rounded-md py-1 bg-popover text-popover-foreground border border-popover-border shadow-lg">
                <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Show / hide columns</div>
                <div className="max-h-64 overflow-y-auto">
                  {ALL_COLS.map((c) => {
                    const shown = !hiddenFor().has(c.key);
                    return (
                      <button
                        key={c.key}
                        type="button"
                        onClick={() => toggleCol(SHARED_COLS_KEY, c.key)}
                        className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-sm text-left hover:bg-accent/60 transition-colors"
                      >
                        <span className="truncate">{c.header}</span>
                        <span className={`shrink-0 w-4 h-4 rounded border flex items-center justify-center ${shown ? "bg-primary border-primary text-primary-foreground" : "border-border"}`}>
                          {shown && <Check size={11} />}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="my-1 border-t border-border/60" />
                <div className="flex items-center justify-between px-2 pb-1">
                  <button type="button" onClick={() => setHiddenForGroup(SHARED_COLS_KEY, defaultHiddenCols())} className="px-2 py-1 rounded text-[12px] font-medium text-primary hover:bg-primary/10 transition-colors">Default columns</button>
                  <button type="button" onClick={() => setHiddenForGroup(SHARED_COLS_KEY, new Set())} className="px-2 py-1 rounded text-[12px] font-medium text-primary hover:bg-primary/10 transition-colors">Show all</button>
                </div>
                {isAdmin && (<>
                <div className="my-1 border-t border-border/60" />
                <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Custom fields</div>
                {(customCols[SHARED_COLS_KEY] ?? []).map((c) => (
                  <div key={c.id} className="flex items-center gap-1.5 px-2 py-1">
                    <input
                      value={c.header}
                      onChange={(e) => { const v = e.target.value; setCustomCols((cols) => ({ ...cols, [SHARED_COLS_KEY]: (cols[SHARED_COLS_KEY] ?? []).map((x) => x.id === c.id ? { ...x, header: v } : x) })); }}
                      placeholder="Field name"
                      className="flex-1 min-w-0 text-[12px] rounded border border-border bg-background px-2 py-1 outline-none focus:ring-1 focus:ring-primary/40"
                    />
                    <button type="button" onClick={() => setCustomCols((cols) => ({ ...cols, [SHARED_COLS_KEY]: (cols[SHARED_COLS_KEY] ?? []).filter((x) => x.id !== c.id) }))} title="Remove field" className="shrink-0 rounded p-1 text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 transition-colors">
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
                <button type="button" onClick={() => setCustomCols((cols) => ({ ...cols, [SHARED_COLS_KEY]: [...(cols[SHARED_COLS_KEY] ?? []), { id: `cf-${Date.now()}`, header: "New field" }] }))} className="mx-2 my-1 inline-flex items-center gap-1.5 rounded-md border border-dashed border-primary/40 bg-primary/5 px-2.5 py-1 text-[12px] font-semibold text-primary hover:bg-primary/10 transition-colors">
                  <Plus size={12} /> Add field
                </button>
                </>)}
              </div>
            )}
          </div>
          )}
        </div>
      </div>

      {/* One Excel-style table per status (New · Active · Completed · Cancelled
          · Postponed). Columns: Project Code · Project Name · Owner · Manager ·
          Status · Tasks · Task Status · Timeline. */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      ) : filtered.length > 0 ? (
        view === "board" ? (
          <ProjectsKanbanBoard<ProjectRow>
            groups={boardGroups}
            columns={PROJECT_COLUMNS}
            showIssueKey={false}
            getRowId={(p) => `project:${p.id}`}
            getName={(p) => <span className="font-medium">{p.confidential && <LockBadge />}{p.name}</span>}
            renderCard={(p) => <ActionCentreProjectCard p={p} ownerName={ownerName} ownerPhoto={ownerPhoto} taskAgg={taskAgg} onAssignOwner={assignOwner} />}
            colWidth={380}
            sectionStyle="ac"
            tintBody={groupBy === "priority"}
            onOpenRow={(p) => setLocation(`/projects/${p.id}`)}
            onMoveToGroup={(rowId, groupKey) => {
              const id = Number(rowId.replace("project:", ""));
              if (!Number.isFinite(id)) return;
              if (groupBy === "priority") {
                // Re-prioritise on drop (No-priority lane can't be set → ignore).
                if (groupKey === "__noprio__") return;
                void fetch(`/api/projects/${id}`, {
                  method: "PATCH", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ priority: groupKey }),
                }).then(() => refetch());
                return;
              }
              if (groupBy === "department") {
                // Re-assign the project's function/department (No-department lane → ignore).
                if (groupKey === "__none__") return;
                void fetch(`/api/projects/${id}`, {
                  method: "PATCH", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ function: groupKey }),
                }).then(() => refetch());
                return;
              }
              if (groupBy === "owner") return; // owner lives on the charter — owner lanes are view-only
              // Delayed lane is computed schedule health, not a settable status → view-only.
              if (groupKey === "__delayed__") return;
              // Status — gate the change behind a justification (CXO board parity).
              setMoveJustify({ id, to: groupKey, toLabel: DISPLAY_BY_KEY.get(groupKey)?.label ?? groupKey });
            }}
          />
        ) : view === "gantt" ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              {/* Legend (by-status) OR window hint (portfolio pulse). */}
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                {pulseMode ? (
                  <span className="text-[10px] text-muted-foreground">
                    Window: <b>last 7 days → next 7 days</b> · one lane per project · latest update shown under each task{dept ? "" : " · tip: pick a Department to focus"}
                  </span>
                ) : (
                  DISPLAY_STATUSES.map((d) => (
                    <HoverHint key={d.key} title={`${d.label} projects`} footer={STATUS_LEGEND_DESC[d.key]}>
                      <span className="flex items-center gap-1 text-[10px] text-muted-foreground whitespace-nowrap cursor-help">
                        <span className="w-2 h-2 rounded-sm" style={{ background: d.color }} />
                        {d.label}
                        <Info size={9} className="opacity-40" />
                      </span>
                    </HoverHint>
                  ))
                )}
              </div>
              {/* Toggle: by-status project Gantt ⇄ portfolio this/next-week board. */}
              <button
                type="button"
                onClick={() => setPulseMode((v) => !v)}
                title="Switch between the by-status project Gantt and the portfolio this/next-week task board"
                className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 h-7 rounded-md text-[11px] font-medium border transition-colors ${pulseMode ? "bg-primary/10 text-primary border-primary/30" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"}`}
              >
                <CalendarClock size={12} />
                {pulseMode ? "By-status Gantt" : "This / Next week"}
              </button>
            </div>
            {pulseMode ? (
              <PortfolioPulseGantt projects={filtered} tasks={tasks as unknown as PulseTask[]} milestones={allMilestones as unknown as PulseMilestone[]} onOpen={(id) => setLocation(`/projects/${id}?view=gantt`)} />
            ) : (
              <GanttView rows={filtered} ownerName={ownerName} managerName={managerName} ownerPhoto={ownerPhoto} managerPhoto={managerPhoto} taskAgg={taskAgg} onOpen={(id) => setLocation(`/projects/${id}?view=gantt`)} />
            )}
          </div>
        ) : (
        <div className="space-y-5">
          {listGroups.map((group) => {
            const open = !collapsed[group.key];
            return (
            <div key={group.key}>
              {/* Status header (expand/collapse) + per-table column manager — a
                  card bar with a colour accent so a COLLAPSED group still reads as
                  a finished section, not a floating row. */}
              <div
                className={`flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 shadow-sm transition-colors ${open ? "mb-2" : "hover:bg-accent/30"}`}
                style={{ borderLeft: `3px solid ${group.color}` }}
              >
                <button
                  type="button"
                  onClick={() => toggleGroup(group.key)}
                  className="flex items-center gap-2 flex-1 min-w-0 text-left group/header"
                >
                  <ChevronDown size={15} className={`shrink-0 text-muted-foreground transition-transform group-hover/header:text-foreground ${open ? "" : "-rotate-90"}`} />
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: group.color }} />
                  <h3 className="text-sm font-semibold text-foreground truncate">{group.label}</h3>
                  <span className="inline-flex items-center justify-center min-w-[20px] rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">{group.rows.length}</span>
                </button>
              </div>

              {open && (
                <ExcelGroupTable
                  cols={activeColsFor(group.key)}
                  accent={group.color}
                  storageKey={`ph:projects:tbl:${group.key}`}
                  renderHeaderLabel={(c) => {
                    if (c.key === "status") return <HealthHeaderTip />;
                    // Custom fields ("cf:<id>") get an inline-rename input right in
                    // the header — same edit as the Add-column dropdown. pointer-events-auto
                    // overrides the wrapper's pointer-events-none; stopPropagation keeps a
                    // click from starting a column drag.
                    if (c.key.startsWith("cf:")) {
                      const id = c.key.slice(3);
                      return (
                        <input
                          value={(customCols[SHARED_COLS_KEY] ?? []).find((x) => x.id === id)?.header ?? ""}
                          onChange={(e) => { const v = e.target.value; setCustomCols((cols) => ({ ...cols, [SHARED_COLS_KEY]: (cols[SHARED_COLS_KEY] ?? []).map((x) => x.id === id ? { ...x, header: v } : x) })); }}
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => e.stopPropagation()}
                          placeholder="Field name"
                          title="Click to rename this field"
                          className="pointer-events-auto w-full bg-white/70 border border-dashed border-gray-300 text-[9px] uppercase tracking-wider font-semibold text-gray-600 outline-none rounded px-1 py-0.5 cursor-text hover:bg-white hover:border-gray-400 focus:bg-white focus:border-solid focus:ring-1 focus:ring-primary/40"
                        />
                      );
                    }
                    return c.header;
                  }}
                >
                  {(orderedCols) => {
                    const cell = (key: string, p: ProjectRow) => {
                      switch (key) {
                        case "code": return (
                          <td key="code" className="border border-gray-200 px-2 py-0.5 font-mono text-[11px] font-semibold text-gray-800 whitespace-nowrap">
                            <span className="flex items-center gap-1 min-w-0">
                              <span className="truncate">{projectCode(p)}</span>
                              <span className="shrink-0 inline-flex">
                                <AttachmentPopover projectId={p.id} count={attachmentCountByProject.get(p.id) ?? 0} label={`${projectCode(p)} attachments`} />
                              </span>
                            </span>
                          </td>
                        );
                        case "name": return <td key="name" className="border border-gray-200 px-2 py-0.5 font-medium text-gray-800 whitespace-normal break-words" title={p.name}>{p.confidential && <LockBadge />}{p.name}</td>;
                        case "domain": return (
                          <td key="domain" className="border border-gray-200 px-2 py-0.5 whitespace-nowrap">
                            {p.domain
                              ? <span className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 ring-1 ring-inset ring-indigo-200" title={p.systemOwner ? `System owner: ${p.systemOwner}` : undefined}>{p.domain}</span>
                              : <span className="text-gray-300">-</span>}
                          </td>
                        );
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
                        case "owner": {
                          const on = ownerName(p);
                          const busy = assigningId === p.id;
                          return (
                            <td key="owner" className="border border-gray-200 px-2 py-0.5" onClick={(e) => e.stopPropagation()}>
                              <EmployeeCombobox
                                value={on ?? undefined}
                                onSelect={(hit) => assignOwner(p, hit)}
                                trigger={
                                  <button
                                    type="button"
                                    title={on ? `Owner: ${on} — click to reassign` : "Assign owner"}
                                    className="group flex items-center gap-1.5 min-w-0 max-w-full rounded px-1 py-0.5 -mx-1 hover:bg-gray-50"
                                  >
                                    {busy
                                      ? <Loader2 size={14} className="animate-spin text-gray-400" />
                                      : <PersonCell name={on} photoUrl={ownerPhoto(p)} />}
                                    {on && <span className="truncate text-[11px] text-gray-700">{on}</span>}
                                  </button>
                                }
                              />
                            </td>
                          );
                        }
                        case "status": return <HealthCell key="status" health={scheduleHealth(p, taskAgg.get(p.id))} align="center" />;
                        case "priority": {
                          const pm = PRIORITY_META.get(p.priority as never);
                          return (
                            <td key="priority" className="border border-gray-200 p-0 text-center whitespace-nowrap relative" style={pm ? { background: pm.bg } : undefined}>
                              <ProjectPriorityDropdown projectId={p.id} priority={p.priority} onSaved={refetch} />
                            </td>
                          );
                        }
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
                        case "progress": {
                          const pct = Math.min(100, Math.max(0, Math.round(p.progress ?? 0)));
                          // !overflow-visible + nowrap so the % is never clipped when the
                          // sidebar narrows the (table-fixed) column — beats the table's
                          // [&_td]:overflow-hidden descendant rule via !important.
                          return <td key="progress" className="border border-gray-200 px-2 py-0.5 text-center font-semibold tabular-nums text-gray-700 whitespace-nowrap !overflow-visible">{pct}%</td>;
                        }
                        case "taskStatus": return <td key="taskStatus" className="border border-gray-200 px-2 py-0.5"><TaskStatusBar counts={taskAgg.get(p.id)} /></td>;
                        case "timeline": { const tl = deriveTimeline(p.id); return <td key="timeline" className="border border-gray-200 px-2 py-0.5 whitespace-nowrap"><TimelineCell start={tl.start} end={tl.end} /></td>; }
                        case "currentStatus": {
                          const ds = displayStatusOf(p.status);
                          // Project-specific text only — its lifecycle stage
                          // (Business Case → URS → RFP → … → Go Live → Closure), or
                          // the project's own description. Never the generic status
                          // word (New / Active / …).
                          const desc = stageLabelOf(p.stage) ?? (p.description?.trim() || null);
                          return (
                            <td key="currentStatus" className="border border-gray-200 px-2 py-0.5">
                              <div className="flex items-center gap-1.5 min-w-0" title={desc ?? ""}>
                                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: ds.color }} />
                                {desc
                                  ? <span className="truncate text-[11px] text-gray-700">{desc}</span>
                                  : <span className="text-[11px] text-gray-400">—</span>}
                              </div>
                            </td>
                          );
                        }
                        case "startDate":
                        case "endDate":
                        case "actualStartDate":
                        case "actualEndDate": {
                          // Click-to-edit; the stopPropagation keeps the row from
                          // navigating into the project while a date is being picked.
                          const dk = key as DateKey;
                          return (
                            <td key={dk} className="border border-gray-200 px-1 py-0.5" onClick={(e) => e.stopPropagation()}>
                              <InlineDateCell
                                value={p[dk]}
                                title={`${ALL_COLS.find((c) => c.key === dk)?.header} — click to edit`}
                                onSave={(v) => void saveProjectDate(p.id, dk, v)}
                              />
                            </td>
                          );
                        }
                        case "plant": return (
                          <td key="plant" className="border border-gray-200 p-0 whitespace-nowrap relative" onClick={(e) => e.stopPropagation()}>
                            <PlantSelectCell projectId={p.id} value={p.siteRegion ?? ""} options={plantOptions} onSaved={refetch} />
                          </td>
                        );
                        case "budget": return <td key="budget" className="border border-gray-200 px-2 py-0.5 text-gray-800 tabular-nums whitespace-nowrap">{formatCurrency((p.capexBudget ?? 0) + (p.opexBudget ?? 0))}</td>;
                        case "description": return <td key="description" className="border border-gray-200 px-2 py-0.5 text-gray-700 truncate" title={p.description ?? ""}>{p.description || <span className="text-gray-400">—</span>}</td>;
                        case "comments": {
                          const n = commentCountByProject.get(p.id) ?? 0;
                          return (
                            <td key="comments" className="border border-gray-200 px-2 py-0.5 text-center">
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); openComms(p, "communication"); }}
                                title={n > 0 ? `${n} comment${n === 1 ? "" : "s"} — open thread` : "Add a comment"}
                                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-gray-500 hover:text-primary hover:bg-primary/10 transition-colors"
                              >
                                <MessageSquare size={12} />
                                {n > 0 ? <span className="tabular-nums font-semibold">{n}</span> : null}
                              </button>
                            </td>
                          );
                        }
                        case "__del__": return (
                          <td key="__del__" className="border border-gray-200 px-1 py-0.5 text-center">
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); void deleteProject(p); }}
                              title="Delete project"
                              aria-label={`Delete project ${p.name}`}
                              className="inline-flex items-center justify-center rounded p-1 text-gray-300 hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
                            >
                              <Trash2 size={13} />
                            </button>
                          </td>
                        );
                        default:
                          // Custom user-defined column — editable cell, value stored locally.
                          if (key.startsWith("cf:")) {
                            const fid = key.slice(3);
                            const vkey = `${p.id}:${fid}`;
                            return (
                              <td key={key} className="border border-gray-200 px-1 py-0.5">
                                <input
                                  value={customVals[vkey] ?? ""}
                                  onChange={(e) => setCustomVal(p.id, fid, e.target.value)}
                                  onClick={(e) => e.stopPropagation()}
                                  placeholder="—"
                                  className="w-full bg-transparent text-[11px] text-gray-800 px-1 py-0.5 rounded outline-none focus:bg-gray-50 placeholder:text-gray-300"
                                />
                              </td>
                            );
                          }
                          return <td key={key} className="border border-gray-200 px-2 py-0.5" />;
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

      {moveJustify && (
        <MoveJustifyModal
          toLabel={moveJustify.toLabel}
          pending={movingPending}
          onCancel={() => { setMoveJustify(null); refetch(); }}
          onConfirm={async (reason) => {
            setMovingPending(true);
            try {
              await fetch(`/api/projects/${moveJustify.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: moveJustify.to }),
              });
              try {
                await fetch(`/api/projects/${moveJustify.id}/messages`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ senderId: currentUserId, body: `Status → ${moveJustify.toLabel}: ${reason}` }),
                });
              } catch { /* justification comment is best-effort */ }
            } finally {
              setMovingPending(false);
              setMoveJustify(null);
              refetch();
            }
          }}
        />
      )}
    </div>
  );
}
