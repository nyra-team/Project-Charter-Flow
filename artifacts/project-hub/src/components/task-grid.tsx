import {
  useState, useMemo, useCallback, useRef, useEffect, type ReactElement,
} from "react";
import { useUpdateTask, useCreateTask, useListIssues } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { ChevronRight, ChevronDown, Plus, AlertTriangle, ArrowUpDown, Layers, Clock, Search, Users, EyeOff, LayoutList } from "lucide-react";
import { RagDot, StatusSelect, PrioritySelect } from "./task-status-chip";
import { PersonAvatar } from "./person-avatar";
import { fmtVariance, DEPARTMENTS, TASK_STATUSES, TASK_PRIORITIES, getStatusMeta, getPriorityMeta } from "../lib/task-constants";
import { IssueRaiseModal } from "./issue-raise-modal";
import { LogTimeModal } from "./log-time-modal";

export interface GridTask {
  id: number;
  projectId: number;
  milestoneId?: number | null;
  workstreamId?: number | null;
  parentTaskId?: number | null;
  name: string;
  status: string;
  priority: string;
  rag?: string | null;
  assigneeId?: number | null;
  assigneeName?: string | null;
  managerId?: number | null;
  cftOwner?: number | null;
  cftDept?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  actualStart?: string | null;
  actualEnd?: string | null;
  scheduleVarianceDays?: number | null;
  predecessorIds?: number[] | string | null;
  estimatedHours?: number | null;
  plannedEffortHours?: number | null;
  actualHours?: number | null;
  isCritical?: boolean;
}

interface TaskGridProps {
  tasks: GridTask[];
  projectId: number;
  onRefresh: () => void;
  users: Array<{ id: number; name: string }>;
}

// All sortable columns
type SortKey =
  | "name" | "status" | "priority" | "rag"
  | "assigneeId" | "managerId" | "parentTaskId"
  | "startDate" | "endDate" | "actualStart" | "actualEnd"
  | "scheduleVarianceDays" | "plannedEffortHours" | "cftDept";

type SortDir = "asc" | "desc";

// Flat row descriptors for virtualization
type FlatRow =
  | { type: "task"; task: GridTask; isSubtask: boolean }
  | { type: "addSubtask"; parentId: number }
  | { type: "groupHeader"; key: string; label: string; color: string; count: number; effortSum: number; collapsed: boolean }
  | { type: "groupSummary"; key: string; count: number; effortSum: number };

type GroupBy = "none" | "status" | "priority" | "assigneeId";
type HideableCol = "manager" | "predecessor" | "cft" | "effort" | "actualHrs" | "issues" | "parent" | "rag" | "plannedStart" | "actualStart" | "actualEnd" | "variance";

const DEFAULT_HIDDEN: HideableCol[] = ["manager", "predecessor", "cft", "effort", "actualHrs", "issues", "parent", "rag", "plannedStart", "actualStart", "actualEnd", "variance"];

const ROW_HEIGHT = 38; // px per rendered row
const VIEWPORT_H = 520; // visible table height
const OVERSCAN = 5;    // extra rows to render above/below viewport

// ── RAG rollup from child statuses ───────────────────────────────────────────
function computeRollupRag(children: GridTask[]): string {
  if (!children.length) return "green";
  const statuses = children.map(t => t.status);
  if (statuses.some(s => s === "delayed")) return "red";
  if (statuses.some(s => s === "at_risk" || s === "on_hold")) return "amber";
  return "green";
}

// ── CFT owner options filtered by dept (using task-history heuristic) ────────
function buildCftOwnerOptions(
  cftDept: string | null | undefined,
  allTasks: GridTask[],
  allUsers: Array<{ id: number; name: string }>
): Array<{ value: string; label: string }> {
  const all = allUsers.map(u => ({ value: u.id.toString(), label: u.name }));
  if (!cftDept) return all;
  const depts = cftDept.split(",").map(d => d.trim()).filter(Boolean);
  const seen = new Set(
    allTasks
      .filter(t => t.cftOwner && t.cftDept && depts.some(d => t.cftDept!.includes(d)))
      .map(t => t.cftOwner!)
  );
  if (seen.size === 0) return all;
  return allUsers.filter(u => seen.has(u.id)).map(u => ({
    value: u.id.toString(),
    label: `${u.name} (${cftDept})`,
  }));
}

// ── Multi-select up to 2 departments ─────────────────────────────────────────
function MultiDeptSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = useMemo(
    () => (value ? value.split(",").map(s => s.trim()).filter(Boolean) : []),
    [value]
  );

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function toggle(dept: string) {
    if (selected.includes(dept)) {
      onChange(selected.filter(d => d !== dept).join(", "));
    } else if (selected.length < 2) {
      onChange([...selected, dept].join(", "));
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="text-xs text-left truncate w-full px-1 py-0.5 rounded hover:bg-primary/10"
        title={selected.join(", ") || "Select CFT Team (up to 2)"}
      >
        {selected.length > 0
          ? <span className="text-foreground">{selected.join(", ")}</span>
          : <span className="text-muted-foreground/60 italic">CFT Team</span>}
      </button>
      {open && (
        <div className="absolute z-50 bg-popover text-popover-foreground border border-popover-border rounded-lg shadow-xl p-1 min-w-36" style={{ top: "100%", left: 0 }}>
          <p className="text-xs text-muted-foreground px-2 py-1">Select up to 2 departments</p>
          {DEPARTMENTS.map(d => {
            const checked = selected.includes(d);
            const disabled = !checked && selected.length >= 2;
            return (
              <label key={d} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-accent/40 text-xs"
                style={{ opacity: disabled ? 0.4 : 1, cursor: disabled ? "not-allowed" : "pointer" }}>
                <input type="checkbox" checked={checked} disabled={disabled}
                  onChange={() => toggle(d)} className="accent-primary w-3 h-3" />
                <span className="text-foreground">{d}</span>
              </label>
            );
          })}
          {selected.length > 0 && (
            <button onClick={() => { onChange(""); setOpen(false); }}
              className="w-full text-left text-xs text-destructive/70 hover:text-destructive px-2 py-1 mt-1 border-t border-border/60">
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Inline number cell (effort, etc.) ────────────────────────────────────────
function InlineNumberCell({ value, onSave }: { value: number | null | undefined; onSave: (v: number | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(value?.toString() ?? "");

  function commit() {
    setEditing(false);
    const parsed = local === "" ? null : parseFloat(local);
    onSave(isNaN(parsed!) ? null : parsed);
  }

  if (!editing) {
    return (
      <span
        className="cursor-pointer hover:bg-primary/10 px-1 rounded text-xs text-foreground block text-center"
        onClick={() => { setLocal(value?.toString() ?? ""); setEditing(true); }}
      >
        {value != null ? `${value}h` : <span className="text-muted-foreground/60">—</span>}
      </span>
    );
  }
  return (
    <input autoFocus type="number" value={local}
      onChange={e => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
      className="text-xs border border-input bg-background text-foreground rounded-md px-1.5 py-0.5 w-full outline-none focus:ring-2 focus:ring-ring/40 text-center" style={{ maxWidth: 65 }}
      min={0} step={0.5} />
  );
}

// ── Generic inline cell (date / select / text) ────────────────────────────────
function getInitials(name: string): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function avatarColor(name: string): string {
  const palette = ["#DC2626", "#EA580C", "#D97706", "#65A30D", "#059669", "#0891B2", "#2563EB", "#7C3AED", "#C026D3", "#DB2777"];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

function AvatarSelect({ value, options, onSave, label }: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onSave: (v: string) => void;
  label: string;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <select
        autoFocus
        value={value}
        onChange={(e) => { onSave(e.target.value); setEditing(false); }}
        onBlur={() => setEditing(false)}
        className="text-xs border border-input bg-background text-foreground rounded-md px-1 py-0.5 w-full outline-none focus:ring-2 focus:ring-ring/40"
      >
        <option value="">—</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }
  if (!label) {
    return (
      <button
        onClick={() => setEditing(true)}
        title="Assign owner"
        className="w-7 h-7 rounded-full border border-dashed border-muted-foreground/40 text-muted-foreground/60 text-xs flex items-center justify-center hover:bg-accent mx-auto"
      >
        +
      </button>
    );
  }
  return (
    <button
      onClick={() => setEditing(true)}
      title={label}
      className="w-7 h-7 rounded-full text-white text-[10px] font-bold flex items-center justify-center mx-auto hover:ring-2 hover:ring-offset-1 hover:ring-primary/40"
      style={{ background: avatarColor(label) }}
    >
      {getInitials(label)}
    </button>
  );
}

function InlineCell({ type, value, options, onSave, placeholder, displayLabel }: {
  type: "text" | "date" | "select";
  value: string;
  options?: Array<{ value: string; label: string }>;
  onSave: (v: string) => void;
  placeholder?: string;
  displayLabel?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(value);

  function commit() { setEditing(false); if (local !== value) onSave(local); }

  const display = displayLabel ?? (value || "");

  if (!editing) {
    return (
      <span className="cursor-pointer hover:bg-primary/10 px-1 rounded text-xs text-foreground truncate block"
        onClick={() => { setLocal(value); setEditing(true); }} title={display || placeholder}>
        {display || <span className="text-muted-foreground/60 italic">{placeholder ?? "—"}</span>}
      </span>
    );
  }

  if (type === "date") {
    return (
      <input type="date" autoFocus value={local}
        onChange={e => setLocal(e.target.value)} onBlur={commit}
        onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
        className="text-xs border border-input bg-background text-foreground rounded-md px-1.5 py-0.5 w-full outline-none focus:ring-2 focus:ring-ring/40" style={{ maxWidth: 115 }} />
    );
  }

  if (type === "select") {
    return (
      <select autoFocus value={local}
        onChange={e => setLocal(e.target.value)}
        onBlur={() => { setEditing(false); onSave(local); }}
        className="text-xs border border-input bg-background text-foreground rounded-md px-1.5 py-0.5 w-full outline-none focus:ring-2 focus:ring-ring/40">
        <option value="">—</option>
        {options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }

  return (
    <input autoFocus type="text" value={local}
      onChange={e => setLocal(e.target.value)} onBlur={commit}
      onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
      className="text-xs border border-input bg-background text-foreground rounded-md px-1.5 py-0.5 w-full outline-none focus:ring-2 focus:ring-ring/40" />
  );
}

// ── Main TaskGrid ─────────────────────────────────────────────────────────────
export function TaskGrid({ tasks, projectId, onRefresh, users }: TaskGridProps) {
  const { toast } = useToast();
  const updateTask = useUpdateTask();
  const createTask = useCreateTask();
  const { data: issues = [] } = useListIssues(projectId);

  // Optimistic patches (local override before server confirms)
  const [pendingPatches, setPendingPatches] = useState<Record<number, Record<string, unknown>>>({});

  // Virtualization
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);

  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [issueModal, setIssueModal] = useState<{ taskId: number; taskName: string } | null>(null);
  const [timelogModal, setTimelogModal] = useState<{ taskId: number; taskName: string; plannedEffortHours?: number | null } | null>(null);
  const [addingSubtask, setAddingSubtask] = useState<number | null>(null);
  const [newSubtaskName, setNewSubtaskName] = useState("");
  const [editingNameId, setEditingNameId] = useState<number | null>(null);

  // ── Monday-style toolbar state (FR-26 / CR-3) ───────────────────────────────
  const [search, setSearch] = useState("");
  const [personFilter, setPersonFilter] = useState<number | "all">("all");
  const [groupBy, setGroupBy] = useState<GroupBy>("status");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [hiddenCols, setHiddenCols] = useState<Set<HideableCol>>(new Set(DEFAULT_HIDDEN));
  const [hideMenuOpen, setHideMenuOpen] = useState(false);
  const hideMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (hideMenuRef.current && !hideMenuRef.current.contains(e.target as Node)) setHideMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function toggleHidden(c: HideableCol) {
    setHiddenCols(prev => { const n = new Set(prev); n.has(c) ? n.delete(c) : n.add(c); return n; });
  }
  function toggleGroupCollapse(k: string) {
    setCollapsedGroups(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });
  }
  const isHidden = (c: HideableCol) => hiddenCols.has(c);

  const issueCountByTask = useMemo(() => {
    const m: Record<number, number> = {};
    for (const i of issues as Array<{ taskId?: number | null; status: string }>) {
      if (i.taskId && i.status !== "resolved") {
        m[i.taskId] = (m[i.taskId] ?? 0) + 1;
      }
    }
    return m;
  }, [issues]);

  const subtaskMap = useMemo(() => {
    const m: Record<number, GridTask[]> = {};
    for (const t of tasks) {
      if (t.parentTaskId) (m[t.parentTaskId] ??= []).push(t);
    }
    return m;
  }, [tasks]);

  const topLevel = useMemo(() => {
    const all = tasks.filter(t => !t.parentTaskId);
    const q = search.trim().toLowerCase();
    return all.filter(t => {
      if (q && !t.name.toLowerCase().includes(q)) {
        // also match if any subtask contains the query
        const subs = tasks.filter(s => s.parentTaskId === t.id);
        if (!subs.some(s => s.name.toLowerCase().includes(q))) return false;
      }
      if (personFilter !== "all") {
        const d = pendingPatches[t.id] ?? {};
        const aid = (d.assigneeId as number | undefined) ?? t.assigneeId;
        const mid = (d.managerId as number | undefined) ?? t.managerId;
        const subs = tasks.filter(s => s.parentTaskId === t.id);
        const matches =
          aid === personFilter ||
          mid === personFilter ||
          subs.some(s => s.assigneeId === personFilter || s.managerId === personFilter);
        if (!matches) return false;
      }
      return true;
    });
  }, [tasks, search, personFilter, pendingPatches]);

  function toggleExpand(id: number) {
    setExpanded(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  }

  const sortedTop = useMemo(() => {
    const priorityOrder: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
    return [...topLevel].sort((a, b) => {
      const aD = { ...a, ...pendingPatches[a.id] };
      const bD = { ...b, ...pendingPatches[b.id] };
      let va: string | number = (aD[sortKey] ?? "") as string | number;
      let vb: string | number = (bD[sortKey] ?? "") as string | number;
      if (sortKey === "scheduleVarianceDays" || sortKey === "plannedEffortHours") {
        va = Number(aD[sortKey] ?? 0); vb = Number(bD[sortKey] ?? 0);
      }
      if (sortKey === "priority") { va = priorityOrder[aD.priority] ?? 9; vb = priorityOrder[bD.priority] ?? 9; }
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [topLevel, sortKey, sortDir, pendingPatches]);

  // ── Group-by sections (monday.com style) ───────────────────────────────────
  function getGroupForTask(t: GridTask): { key: string; label: string; color: string } {
    const d = { ...t, ...pendingPatches[t.id] };
    if (groupBy === "status") {
      const m = getStatusMeta(d.status);
      return { key: d.status || "_none", label: m.label, color: m.solid };
    }
    if (groupBy === "priority") {
      const m = getPriorityMeta(d.priority);
      return { key: d.priority || "_none", label: m.label, color: m.solid };
    }
    if (groupBy === "assigneeId") {
      const u = users.find(u => u.id === d.assigneeId);
      const key = d.assigneeId ? String(d.assigneeId) : "_none";
      return { key, label: u?.name ?? "Unassigned", color: "#64748B" };
    }
    return { key: "_all", label: "All Tasks", color: "#64748B" };
  }

  // Build flat list of visible rows for virtualization (with group headers + summary rows)
  const flatRows = useMemo<FlatRow[]>(() => {
    const rows: FlatRow[] = [];

    if (groupBy === "none") {
      for (const task of sortedTop) {
        rows.push({ type: "task", task, isSubtask: false });
        if (expanded.has(task.id)) {
          for (const sub of subtaskMap[task.id] ?? []) {
            rows.push({ type: "task", task: sub, isSubtask: true });
          }
          if (addingSubtask === task.id) rows.push({ type: "addSubtask", parentId: task.id });
        }
      }
      return rows;
    }

    // Group tasks by status/priority/owner preserving sorted order
    const groupOrder: string[] = [];
    const groupMeta: Record<string, { label: string; color: string }> = {};
    const grouped: Record<string, GridTask[]> = {};
    for (const t of sortedTop) {
      const g = getGroupForTask(t);
      if (!grouped[g.key]) {
        grouped[g.key] = [];
        groupMeta[g.key] = { label: g.label, color: g.color };
        groupOrder.push(g.key);
      }
      grouped[g.key]!.push(t);
    }

    // For status grouping, force canonical order (matches monday.com)
    if (groupBy === "status") {
      const canonical: string[] = TASK_STATUSES.map(s => s.value);
      groupOrder.sort((a, b) => {
        const ai = canonical.indexOf(a);
        const bi = canonical.indexOf(b);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      });
    } else if (groupBy === "priority") {
      const canonical: string[] = TASK_PRIORITIES.map(p => p.value);
      groupOrder.sort((a, b) => {
        const ai = canonical.indexOf(a);
        const bi = canonical.indexOf(b);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      });
    }

    for (const key of groupOrder) {
      const members = grouped[key]!;
      const meta = groupMeta[key]!;
      const effortSum = members.reduce((s, t) => {
        const d = { ...t, ...pendingPatches[t.id] };
        return s + Number(d.plannedEffortHours ?? d.estimatedHours ?? 0);
      }, 0);
      const collapsed = collapsedGroups.has(key);
      rows.push({
        type: "groupHeader",
        key,
        label: meta.label,
        color: meta.color,
        count: members.length,
        effortSum,
        collapsed,
      });
      if (collapsed) continue;
      for (const task of members) {
        rows.push({ type: "task", task, isSubtask: false });
        if (expanded.has(task.id)) {
          for (const sub of subtaskMap[task.id] ?? []) {
            rows.push({ type: "task", task: sub, isSubtask: true });
          }
          if (addingSubtask === task.id) rows.push({ type: "addSubtask", parentId: task.id });
        }
      }
      rows.push({ type: "groupSummary", key, count: members.length, effortSum });
    }
    return rows;
  }, [sortedTop, expanded, subtaskMap, addingSubtask, groupBy, pendingPatches, collapsedGroups, users]);

  // Virtual window
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIdx = Math.min(flatRows.length, startIdx + Math.ceil(VIEWPORT_H / ROW_HEIGHT) + OVERSCAN * 2);
  const visibleRows = flatRows.slice(startIdx, endIdx);
  const topPad = startIdx * ROW_HEIGHT;
  const bottomPad = Math.max(0, (flatRows.length - endIdx) * ROW_HEIGHT);

  // Roll up a parent's status from its subtasks:
  //   - all completed → completed
  //   - any in_progress/at_risk/delayed/on_hold → in_progress
  //   - all not_started → not_started
  function rollupParentStatus(siblingStatuses: string[]): string | null {
    if (siblingStatuses.length === 0) return null;
    if (siblingStatuses.every(s => s === "completed")) return "completed";
    if (siblingStatuses.some(s => s !== "not_started" && s !== "completed")) return "in_progress";
    if (siblingStatuses.some(s => s === "completed")) return "in_progress"; // mixed completed + not_started
    return "not_started";
  }

  // Optimistic patch + rollback on error
  const patch = useCallback((taskId: number, data: Record<string, unknown>) => {
    setPendingPatches(prev => ({ ...prev, [taskId]: { ...(prev[taskId] ?? {}), ...data } }));
    updateTask.mutate(
      { id: taskId, data: data as Parameters<typeof updateTask.mutate>[0]["data"] },
      {
        onSuccess: () => {
          setPendingPatches(prev => { const n = { ...prev }; delete n[taskId]; return n; });

          // Auto-rollup: if a subtask's status changed, recompute & patch the parent
          if ("status" in data) {
            const task = tasks.find(t => t.id === taskId);
            const parentId = task?.parentTaskId;
            if (parentId) {
              const siblings = tasks.filter(t => t.parentTaskId === parentId);
              const siblingStatuses = siblings.map(s =>
                s.id === taskId ? String(data.status) : s.status
              );
              const newParentStatus = rollupParentStatus(siblingStatuses);
              const parent = tasks.find(t => t.id === parentId);
              if (newParentStatus && parent && parent.status !== newParentStatus) {
                updateTask.mutate({
                  id: parentId,
                  data: { status: newParentStatus } as Parameters<typeof updateTask.mutate>[0]["data"],
                }, { onSuccess: () => onRefresh() });
                return; // onRefresh will fire from the parent update
              }
            }
          }
          onRefresh();
        },
        onError: () => {
          setPendingPatches(prev => { const n = { ...prev }; delete n[taskId]; return n; });
          toast({ title: "Update failed — changes reverted", variant: "destructive" });
        },
      }
    );
  }, [updateTask, onRefresh, toast, tasks]);

  function addSubtask(parentId: number) {
    if (!newSubtaskName.trim()) return;
    const parent = tasks.find(t => t.id === parentId);
    createTask.mutate(
      {
        id: projectId,
        data: {
          name: newSubtaskName,
          parentTaskId: parentId,
          milestoneId: parent?.milestoneId ?? undefined,
          workstreamId: parent?.workstreamId ?? undefined,
          priority: parent?.priority ?? "P2",
          status: "not_started",
          rag: "green",
        } as Parameters<typeof createTask.mutate>[0]["data"],
      },
      {
        onSuccess: () => {
          setAddingSubtask(null);
          setNewSubtaskName("");
          setExpanded(prev => new Set([...prev, parentId]));
          onRefresh();
          toast({ title: "Subtask added" });
        },
        onError: () => toast({ title: "Failed to add subtask", variant: "destructive" }),
      }
    );
  }

  const getPredIds = (task: GridTask): number[] => {
    try {
      if (Array.isArray(task.predecessorIds)) return task.predecessorIds.map(Number);
      if (typeof task.predecessorIds === "string" && task.predecessorIds) return JSON.parse(task.predecessorIds);
    } catch {}
    return [];
  };

  const userOptions = users.map(u => ({ value: u.id.toString(), label: u.name }));

  // Computed visible column count for spanning helper rows
  const VISIBLE_COLS = 20
    - (isHidden("manager") ? 1 : 0)
    - (isHidden("predecessor") ? 1 : 0)
    - (isHidden("cft") ? 2 : 0)  // CFT Team + CFT Owner share one toggle
    - (isHidden("effort") ? 1 : 0)
    - (isHidden("actualHrs") ? 1 : 0)
    - (isHidden("issues") ? 1 : 0)
    - (isHidden("parent") ? 1 : 0)
    - (isHidden("rag") ? 1 : 0)
    - (isHidden("plannedStart") ? 1 : 0)
    - (isHidden("actualStart") ? 1 : 0)
    - (isHidden("actualEnd") ? 1 : 0)
    - (isHidden("variance") ? 1 : 0);

  function renderFlatRow(row: FlatRow, rowIdx: number): ReactElement {
    if (row.type === "groupHeader") {
      return (
        <tr key={`gh-${row.key}-${rowIdx}`} style={{ height: ROW_HEIGHT }}>
          <td colSpan={VISIBLE_COLS} className="p-0">
            <div
              className="flex items-center gap-2 px-3 py-1.5 border-l-4 cursor-pointer hover:brightness-95 transition"
              style={{ borderLeftColor: row.color, background: `${row.color}1A` }}
              onClick={() => toggleGroupCollapse(row.key)}
            >
              {row.collapsed
                ? <ChevronRight size={14} style={{ color: row.color }} />
                : <ChevronDown size={14} style={{ color: row.color }} />}
              <span className="text-xs font-bold uppercase tracking-wide" style={{ color: row.color }}>
                {row.label}
              </span>
              <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full"
                    style={{ background: row.color, color: "#FFFFFF" }}>
                {row.count}
              </span>
              <span className="ml-auto text-xs text-muted-foreground">
                {row.effortSum > 0 ? `${row.effortSum.toFixed(1)}h planned` : ""}
              </span>
            </div>
          </td>
        </tr>
      );
    }

    if (row.type === "groupSummary") {
      return (
        <tr key={`gs-${row.key}-${rowIdx}`} style={{ height: ROW_HEIGHT - 6 }} className="border-b border-border/60">
          <td />
          <td className="text-xs text-muted-foreground font-semibold px-2" style={{ paddingLeft: 8 }}>
            {row.count} item{row.count !== 1 ? "s" : ""}
          </td>
          <td colSpan={Math.max(1, VISIBLE_COLS - 4)} />
          <td colSpan={2} className="text-xs text-muted-foreground font-semibold text-right pr-3">
            Σ {row.effortSum.toFixed(1)}h
          </td>
        </tr>
      );
    }

    if (row.type === "addSubtask") {
      return (
        <tr key={`add-${row.parentId}`} className="border-b border-border/60 bg-primary/10" style={{ height: ROW_HEIGHT }}>
          <td />
          <td colSpan={5} className="py-1 px-2" style={{ paddingLeft: 22 }}>
            <div className="flex items-center gap-2">
              <input autoFocus type="text" value={newSubtaskName}
                onChange={e => setNewSubtaskName(e.target.value)} placeholder="Subtask name..."
                className="flex-1 text-xs border border-input bg-background text-foreground rounded-md px-2 py-1 outline-none focus:ring-2 focus:ring-ring/40"
                onKeyDown={e => {
                  if (e.key === "Enter") addSubtask(row.parentId);
                  if (e.key === "Escape") { setAddingSubtask(null); setNewSubtaskName(""); }
                }} />
              <button onClick={() => addSubtask(row.parentId)} className="text-xs px-2 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 font-medium">Add</button>
              <button onClick={() => { setAddingSubtask(null); setNewSubtaskName(""); }} className="text-xs px-2 py-1 rounded bg-muted text-foreground">Cancel</button>
            </div>
          </td>
          <td colSpan={Math.max(1, VISIBLE_COLS - 6)} />
        </tr>
      );
    }

    const { task, isSubtask } = row;
    const d: GridTask = { ...task, ...pendingPatches[task.id] };

    const subs = subtaskMap[task.id] ?? [];
    const isExp = expanded.has(task.id);
    const variance = fmtVariance(d.scheduleVarianceDays);
    const issueCount = issueCountByTask[task.id] ?? 0;
    const userLabel = (id?: number | null) => users.find(u => u.id === id)?.name ?? "";

    const predNames = getPredIds(task).map(id => {
      const t = tasks.find(x => x.id === id);
      return t ? `#${id} ${t.name}` : `#${id}`;
    }).join(", ");

    const rollupRag = !isSubtask && subs.length > 0 ? computeRollupRag(subs) : null;
    const displayRag = rollupRag ?? d.rag ?? "green";
    const cftOwnerOptions = buildCftOwnerOptions(d.cftDept, tasks, users);

    // Parent Task ID + Name
    const parentDisplay = task.parentTaskId
      ? (() => {
          const p = tasks.find(t => t.id === task.parentTaskId);
          return { id: task.parentTaskId, name: p?.name ?? "" };
        })()
      : null;

    return (
      <tr
        key={`${rowIdx}-${task.id}`}
        className={`border-b border-border/40 hover:bg-accent/30 transition-colors text-xs ${
          task.isCritical ? "bg-destructive/5" : isSubtask ? "bg-primary/5" : "bg-card"
        }`}
        style={{ height: ROW_HEIGHT }}
      >
        {/* Expand toggle */}
        <td className="px-1 text-center" style={{ width: 28 }}>
          {!isSubtask && subs.length > 0 && (
            <button onClick={() => toggleExpand(task.id)} className="text-muted-foreground hover:text-primary">
              {isExp ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
          )}
        </td>

        {/* Name */}
        <td className="pr-2" style={{ paddingLeft: isSubtask ? 22 : 8, minWidth: 190, maxWidth: 220 }}>
          <div className="flex items-center gap-1.5 min-w-0">
            {isSubtask && <div className="w-1.5 h-1.5 rounded-full bg-primary/50 flex-shrink-0" />}
            {task.isCritical && !isSubtask && (
              <span className="px-1 rounded-sm font-mono uppercase tracking-wider font-semibold flex-shrink-0 border bg-destructive/10 text-destructive border-destructive/20" style={{ fontSize: 9 }}>CP</span>
            )}
            {editingNameId === task.id ? (
              <input
                autoFocus
                defaultValue={task.name}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== task.name) patch(task.id, { name: v });
                  setEditingNameId(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") { setEditingNameId(null); }
                }}
                className="flex-1 min-w-0 text-xs font-medium border border-primary/40 bg-background text-foreground rounded-none px-1 py-0.5 outline-none focus:ring-1 focus:ring-primary"
              />
            ) : (
              <span
                className="font-medium text-foreground truncate cursor-text"
                title={`${task.name} — double-click to rename`}
                onDoubleClick={() => setEditingNameId(task.id)}
              >
                {task.name}
              </span>
            )}
            {!isSubtask && subs.length > 0 && (
              <span className="ml-1 flex items-center gap-0.5 px-1.5 py-0.5 rounded-full flex-shrink-0 border bg-primary/10 text-primary border-primary/20"
                style={{ fontSize: 9 }}
                title={`${subs.length} subtask${subs.length !== 1 ? "s" : ""}`}>
                <Layers size={9} />{subs.length}
              </span>
            )}
          </div>
        </td>

        {/* Parent Task ID */}
        {!isHidden("parent") && (
          <td className="px-1" style={{ minWidth: 105, maxWidth: 120 }}>
            {parentDisplay ? (
              <span className="text-xs truncate block" title={`#${parentDisplay.id} ${parentDisplay.name}`}>
                <span className="font-mono font-bold text-primary/70">#{parentDisplay.id}</span>
                {parentDisplay.name && <span className="text-muted-foreground ml-0.5">{parentDisplay.name}</span>}
              </span>
            ) : <span className="text-muted-foreground/60 text-xs">—</span>}
          </td>
        )}

        {/* Status */}
        <td className="p-0" style={{ minWidth: 130, height: ROW_HEIGHT, verticalAlign: "middle" }}>
          <StatusSelect value={d.status} onChange={v => patch(task.id, { status: v })} />
        </td>

        {/* Owner */}
        <td className="px-1 text-center" style={{ width: 60 }}>
          <AvatarSelect
            value={d.assigneeId?.toString() ?? ""}
            options={userOptions}
            onSave={v => patch(task.id, { assigneeId: v ? parseInt(v) : null })}
            label={d.assigneeName ?? userLabel(d.assigneeId)}
          />
        </td>

        {/* Priority */}
        <td className="p-0" style={{ minWidth: 95, height: ROW_HEIGHT, verticalAlign: "middle" }}>
          <PrioritySelect value={d.priority} onChange={v => patch(task.id, { priority: v })} />
        </td>

        {/* RAG with rollup */}
        {!isHidden("rag") && (
          <td className="px-1 text-center" style={{ width: 55 }}>
            <div className="flex flex-col items-center">
              <RagDot rag={displayRag} />
              {rollupRag && rollupRag !== (d.rag ?? "green") && (
                <span className="text-muted-foreground" style={{ fontSize: 9 }} title="Rolled up from subtasks">↑</span>
              )}
            </div>
          </td>
        )}

        {/* Manager */}
        {!isHidden("manager") && (
          <td className="px-1" style={{ minWidth: 95, maxWidth: 110 }}>
            <InlineCell type="select" value={d.managerId?.toString() ?? ""} options={userOptions}
              onSave={v => patch(task.id, { managerId: v ? parseInt(v) : null })}
              displayLabel={userLabel(d.managerId)} placeholder="Manager" />
          </td>
        )}

        {/* Planned Start */}
        {!isHidden("plannedStart") && (
          <td className="px-1" style={{ minWidth: 90 }}>
            <InlineCell type="date" value={d.startDate ?? ""} onSave={v => patch(task.id, { startDate: v || null })} placeholder="Start" />
          </td>
        )}

        {/* Planned End (Due Date) */}
        <td className="px-1" style={{ minWidth: 90 }}>
          <InlineCell type="date" value={d.endDate ?? ""} onSave={v => patch(task.id, { endDate: v || null })} placeholder="End" />
        </td>

        {/* Actual Start */}
        {!isHidden("actualStart") && (
          <td className="px-1" style={{ minWidth: 90 }}>
            <InlineCell type="date" value={d.actualStart ?? ""} onSave={v => patch(task.id, { actualStart: v || null })} placeholder="Act. Start" />
          </td>
        )}

        {/* Actual End */}
        {!isHidden("actualEnd") && (
          <td className="px-1" style={{ minWidth: 90 }}>
            <InlineCell type="date" value={d.actualEnd ?? ""} onSave={v => patch(task.id, { actualEnd: v || null })} placeholder="Act. End" />
          </td>
        )}

        {/* Schedule Variance */}
        {!isHidden("variance") && (
          <td className="px-1 text-center" style={{ minWidth: 75 }}>
            <span className="text-xs font-semibold" style={{ color: variance.color }}>{variance.text}</span>
          </td>
        )}

        {/* Predecessor */}
        {!isHidden("predecessor") && (
          <td className="px-1" style={{ minWidth: 115, maxWidth: 130 }}>
            <span className="text-xs text-muted-foreground truncate block" title={predNames}>
              {predNames || <span className="text-muted-foreground/60 italic">—</span>}
            </span>
          </td>
        )}

        {!isHidden("cft") && (
          <>
            {/* CFT Team (≤2 depts) */}
            <td className="px-1" style={{ minWidth: 125 }}>
              <MultiDeptSelect value={d.cftDept ?? ""} onChange={v => patch(task.id, { cftDept: v || null })} />
            </td>
            {/* CFT Owner (filtered by dept) */}
            <td className="px-1" style={{ minWidth: 105 }}>
              <InlineCell type="select" value={d.cftOwner?.toString() ?? ""} options={cftOwnerOptions}
                onSave={v => patch(task.id, { cftOwner: v ? parseInt(v) : null })}
                displayLabel={userLabel(d.cftOwner)} placeholder="CFT Owner" />
            </td>
          </>
        )}

        {/* Planned Effort — inline number */}
        {!isHidden("effort") && (
          <td className="px-1" style={{ minWidth: 65 }}>
            <InlineNumberCell
              value={d.plannedEffortHours ?? d.estimatedHours}
              onSave={v => patch(task.id, { plannedEffortHours: v, estimatedHours: v })}
            />
          </td>
        )}

        {/* Actual Effort (logged hours) */}
        {!isHidden("actualHrs") && (
          <td className="px-1 text-center" style={{ minWidth: 70 }}>
            <button
              onClick={() => setTimelogModal({ taskId: task.id, taskName: task.name, plannedEffortHours: d.plannedEffortHours ?? d.estimatedHours })}
              className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full w-full justify-center border ${
                d.actualHours && d.actualHours > 0
                  ? "bg-primary/10 text-primary border-primary/20"
                  : "bg-muted text-muted-foreground border-border"
              }`}
              title="Log time / view effort"
            >
              <Clock size={9} />
              {d.actualHours != null && d.actualHours > 0 ? `${d.actualHours}h` : "+"}
            </button>
          </td>
        )}

        {/* Issues */}
        {!isHidden("issues") && (
          <td className="px-1 text-center" style={{ width: 60 }}>
            <button
              onClick={() => setIssueModal({ taskId: task.id, taskName: task.name })}
              className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${
                issueCount > 0
                  ? "bg-destructive/10 text-destructive border-destructive/20"
                  : "bg-muted text-muted-foreground border-border"
              }`}
              title={issueCount > 0 ? `${issueCount} open issue${issueCount !== 1 ? "s" : ""}` : "Raise issue"}
            >
              <AlertTriangle size={10} />{issueCount > 0 ? issueCount : "+"}
            </button>
          </td>
        )}

        {/* Add subtask */}
        <td className="px-1 text-center" style={{ width: 32 }}>
          {!isSubtask && (
            <button onClick={() => { setAddingSubtask(task.id); setExpanded(prev => new Set([...prev, task.id])); }}
              className="text-muted-foreground/60 hover:text-primary/70" title="Add subtask">
              <Plus size={13} />
            </button>
          )}
        </td>
      </tr>
    );
  }

  function SortBtn({ col }: { col: SortKey }): ReactElement {
    const active = sortKey === col;
    return (
      <button onClick={() => handleSort(col)}
        className="inline-flex items-center ml-0.5 transition-opacity"
        style={{ opacity: active ? 1 : 0.4 }}>
        <ArrowUpDown size={10} />
      </button>
    );
  }

  const thCls = "text-left text-xs font-bold text-muted-foreground uppercase tracking-wide py-2.5 px-1 border-b border-border/60 bg-muted/40 whitespace-nowrap";

  const HIDEABLE_LABELS: Record<HideableCol, string> = {
    parent: "Parent Task ID",
    rag: "RAG",
    manager: "Manager",
    plannedStart: "Plan. Start",
    actualStart: "Act. Start",
    actualEnd: "Act. End",
    variance: "Variance",
    predecessor: "Predecessor",
    cft: "CFT Team + Owner",
    effort: "Planned Effort",
    actualHrs: "Actual Hours",
    issues: "Issues",
  };

  return (
    <>
      {/* ── Monday-style toolbar (FR-26 / CR-3) ─────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg border border-border bg-background">
          <Search size={13} className="text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search tasks…"
            className="text-xs bg-transparent outline-none w-44 text-foreground placeholder:text-muted-foreground/60"
          />
        </div>

        <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg border border-border bg-background">
          <Users size={13} className="text-muted-foreground" />
          <select
            value={String(personFilter)}
            onChange={e => setPersonFilter(e.target.value === "all" ? "all" : Number(e.target.value))}
            className="text-xs bg-transparent outline-none text-foreground cursor-pointer"
          >
            <option value="all">All people</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>

        <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg border border-border bg-background">
          <LayoutList size={13} className="text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Group:</span>
          <select
            value={groupBy}
            onChange={e => setGroupBy(e.target.value as GroupBy)}
            className="text-xs bg-transparent outline-none text-foreground font-medium cursor-pointer"
          >
            <option value="status">Status</option>
            <option value="priority">Priority</option>
            <option value="assigneeId">Owner</option>
            <option value="none">None</option>
          </select>
        </div>

        <div className="relative" ref={hideMenuRef}>
          <button
            onClick={() => setHideMenuOpen(o => !o)}
            className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg border border-border bg-background text-xs text-foreground hover:bg-accent/40"
          >
            <EyeOff size={13} />
            Hide{hiddenCols.size > 0 ? ` (${hiddenCols.size})` : ""}
          </button>
          {hideMenuOpen && (
            <div className="absolute z-50 mt-1 bg-popover text-popover-foreground border border-popover-border rounded-lg shadow-xl p-1 min-w-44">
              {(Object.keys(HIDEABLE_LABELS) as HideableCol[]).map(c => (
                <label key={c} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-accent/40 text-xs cursor-pointer">
                  <input type="checkbox" checked={hiddenCols.has(c)} onChange={() => toggleHidden(c)} className="accent-primary w-3 h-3" />
                  <span>{HIDEABLE_LABELS[c]}</span>
                </label>
              ))}
              {hiddenCols.size > 0 && (
                <button onClick={() => setHiddenCols(new Set())}
                  className="w-full text-left text-xs text-primary hover:text-primary/80 px-2 py-1 mt-1 border-t border-border/60">
                  Show all columns
                </button>
              )}
            </div>
          )}
        </div>

        <span className="text-xs text-muted-foreground ml-auto">
          {topLevel.length} task{topLevel.length !== 1 ? "s" : ""}
          {(search || personFilter !== "all") && " (filtered)"}
        </span>
      </div>

      {/* Virtualized scrollable table container */}
      <div
        ref={scrollRef}
        onScroll={e => setScrollTop(e.currentTarget.scrollTop)}
        className="glass-surface lift-card ph-rise overflow-x-auto overflow-y-auto rounded-sm"
        style={{ height: VIEWPORT_H, position: "relative" }}
      >
        <table className="border-collapse w-full" style={{ tableLayout: "auto" }}>
          <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
            <tr>
              <th style={{ width: 28 }} className={thCls}></th>
              <th style={{ minWidth: 190 }} className={thCls}>Task Name <SortBtn col="name" /></th>
              {!isHidden("parent") && <th style={{ minWidth: 105 }} className={thCls}>Parent Task ID <SortBtn col="parentTaskId" /></th>}
              <th style={{ minWidth: 130 }} className={thCls}>Status <SortBtn col="status" /></th>
              <th style={{ minWidth: 60, width: 60 }} className={thCls}>Owner <SortBtn col="assigneeId" /></th>
              <th style={{ minWidth: 95 }} className={thCls}>Priority <SortBtn col="priority" /></th>
              {!isHidden("rag") && <th style={{ width: 55 }} className={thCls}>RAG <SortBtn col="rag" /></th>}
              {!isHidden("manager") && <th style={{ minWidth: 95 }} className={thCls}>Manager <SortBtn col="managerId" /></th>}
              {!isHidden("plannedStart") && <th style={{ minWidth: 90 }} className={thCls}>Plan. Start <SortBtn col="startDate" /></th>}
              <th style={{ minWidth: 90 }} className={thCls}>Due Date <SortBtn col="endDate" /></th>
              {!isHidden("actualStart") && <th style={{ minWidth: 90 }} className={thCls}>Act. Start <SortBtn col="actualStart" /></th>}
              {!isHidden("actualEnd") && <th style={{ minWidth: 90 }} className={thCls}>Act. End <SortBtn col="actualEnd" /></th>}
              {!isHidden("variance") && <th style={{ minWidth: 75 }} className={thCls}>Variance <SortBtn col="scheduleVarianceDays" /></th>}
              {!isHidden("predecessor") && <th style={{ minWidth: 115 }} className={thCls}>Predecessor</th>}
              {!isHidden("cft") && <th style={{ minWidth: 125 }} className={thCls}>CFT Team (≤2) <SortBtn col="cftDept" /></th>}
              {!isHidden("cft") && <th style={{ minWidth: 105 }} className={thCls}>CFT Owner</th>}
              {!isHidden("effort") && <th style={{ minWidth: 65 }} className={thCls}>Effort <SortBtn col="plannedEffortHours" /></th>}
              {!isHidden("actualHrs") && <th style={{ minWidth: 70 }} className={thCls}>Actual hrs</th>}
              {!isHidden("issues") && <th style={{ width: 60 }} className={thCls}>Issues</th>}
              <th style={{ width: 32 }} className={thCls}></th>
            </tr>
          </thead>
          <tbody>
            {/* Top virtual spacer */}
            {topPad > 0 && <tr aria-hidden style={{ height: topPad }}><td colSpan={VISIBLE_COLS} /></tr>}

            {flatRows.length === 0 && (
              <tr><td colSpan={VISIBLE_COLS} className="text-center py-16 text-muted-foreground text-sm">No tasks found.</td></tr>
            )}

            {visibleRows.map((row, i) => renderFlatRow(row, startIdx + i))}

            {/* Bottom virtual spacer */}
            {bottomPad > 0 && <tr aria-hidden style={{ height: bottomPad }}><td colSpan={VISIBLE_COLS} /></tr>}
          </tbody>
        </table>
      </div>

      {issueModal && (
        <IssueRaiseModal
          open={true}
          onClose={() => setIssueModal(null)}
          projectId={projectId}
          taskId={issueModal.taskId}
          taskName={issueModal.taskName}
        />
      )}

      {timelogModal && (
        <LogTimeModal
          open={true}
          onClose={() => setTimelogModal(null)}
          taskId={timelogModal.taskId}
          taskName={timelogModal.taskName}
          plannedEffortHours={timelogModal.plannedEffortHours}
        />
      )}
    </>
  );
}
