import { useState, useMemo } from "react";
import { useUpdateMilestone, useListIssues } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { ArrowUpDown, AlertTriangle, Search } from "lucide-react";
import { StatusSelect, PrioritySelect, RagDot } from "./task-status-chip";
import { fmtVariance, getStatusMeta, TASK_STATUSES, TASK_PRIORITIES } from "../lib/task-constants";
import { IssueRaiseModal } from "./issue-raise-modal";

export interface GridMilestone {
  id: number;
  projectId: number;
  name: string;
  status: string;
  priority: string;
  rag?: string | null;
  dueDate?: string | null;
  actualStart?: string | null;
  actualEnd?: string | null;
  plannedEffortHours?: number | null;
  scheduleVarianceDays?: number | null;
  gateDecision?: string | null;
}

interface GridTask {
  milestoneId?: number | null;
  status: string;
  assigneeId?: number | null;
  assigneeName?: string | null;
  managerId?: number | null;
  startDate?: string | null;
}

interface MilestoneGridProps {
  milestones: GridMilestone[];
  tasks: GridTask[];
  projectId: number;
  onRefresh: () => void;
  users?: Array<{ id: number; name: string }>;
}

type SortKey =
  | "name" | "status" | "consolidatedStatus" | "priority" | "rag"
  | "dueDate" | "actualStart" | "actualEnd" | "plannedStart"
  | "scheduleVarianceDays" | "plannedEffortHours" | "gateDecision"
  | "derivedOwner" | "derivedManager";

function computeConsolidatedStatus(tasks: GridTask[]): string {
  if (!tasks.length) return "not_started";
  if (tasks.every(t => t.status === "completed")) return "completed";
  if (tasks.some(t => t.status === "delayed")) return "delayed";
  if (tasks.some(t => t.status === "at_risk")) return "at_risk";
  if (tasks.some(t => t.status === "in_progress")) return "in_progress";
  if (tasks.some(t => t.status === "on_hold")) return "on_hold";
  return "not_started";
}

function ConsolidatedStatusPill({ tasks }: { tasks: GridTask[] }) {
  const status = computeConsolidatedStatus(tasks);
  const meta = getStatusMeta(status);
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold"
      style={{ background: meta.bg, color: meta.color }}
    >
      {meta.label}
    </span>
  );
}

function InlineDateCell({ value, onSave }: { value?: string | null; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(value ?? "");

  if (!editing) {
    return (
      <span
        className="text-xs text-foreground cursor-pointer hover:bg-primary/10 px-1 rounded block truncate"
        onClick={() => { setLocal(value ?? ""); setEditing(true); }}
      >
        {value
          ? new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" })
          : <span className="text-muted-foreground/60 italic">—</span>}
      </span>
    );
  }

  return (
    <input
      autoFocus
      type="date"
      value={local}
      onChange={e => setLocal(e.target.value)}
      onBlur={() => { setEditing(false); onSave(local); }}
      onKeyDown={e => {
        if (e.key === "Enter") { setEditing(false); onSave(local); }
        if (e.key === "Escape") setEditing(false);
      }}
      className="text-xs border rounded px-1 py-0.5 w-full outline-none"
      style={{ maxWidth: 110 }}
    />
  );
}

function InlineNumberCell({ value, onSave, suffix = "h" }: { value?: number | null; onSave: (v: number | null) => void; suffix?: string }) {
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
        className="text-xs text-foreground cursor-pointer hover:bg-primary/10 px-1 rounded block text-center"
        onClick={() => { setLocal(value?.toString() ?? ""); setEditing(true); }}
      >
        {value != null ? `${value}${suffix}` : <span className="text-muted-foreground/60">—</span>}
      </span>
    );
  }

  return (
    <input
      autoFocus
      type="number"
      value={local}
      onChange={e => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
      className="text-xs border rounded px-1 py-0.5 w-full outline-none text-center"
      style={{ maxWidth: 65 }}
      min={0}
    />
  );
}

const GATE_OPTIONS = [
  { value: "", label: "—" },
  { value: "go", label: "Go" },
  { value: "no_go", label: "No-Go" },
  { value: "conditional", label: "Conditional" },
];

const RAG_OPTIONS = [
  { value: "", label: "All RAG" },
  { value: "green", label: "Green" },
  { value: "amber", label: "Amber" },
  { value: "red", label: "Red" },
];

export function MilestoneGrid({ milestones, tasks, projectId, onRefresh, users = [] }: MilestoneGridProps) {
  const { toast } = useToast();
  const updateMilestone = useUpdateMilestone();
  const { data: issues = [] } = useListIssues(projectId);

  // Optimistic patches
  const [pendingPatches, setPendingPatches] = useState<Record<number, Record<string, unknown>>>({});

  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [issueModal, setIssueModal] = useState<{ milestoneId: number; name: string } | null>(null);

  // Filters
  const [searchText, setSearchText] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterPriority, setFilterPriority] = useState("");
  const [filterRag, setFilterRag] = useState("");
  const [filterGate, setFilterGate] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");

  const issueCountByMilestone = useMemo(() => {
    const m: Record<number, number> = {};
    for (const i of issues as Array<{ milestoneId?: number | null; status: string }>) {
      if (i.milestoneId && i.status !== "resolved") {
        m[i.milestoneId] = (m[i.milestoneId] ?? 0) + 1;
      }
    }
    return m;
  }, [issues]);

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  }

  const filtered = useMemo(() => {
    return milestones.filter(ms => {
      const d = { ...ms, ...pendingPatches[ms.id] } as GridMilestone;
      if (searchText && !d.name.toLowerCase().includes(searchText.toLowerCase())) return false;
      if (filterStatus && d.status !== filterStatus) return false;
      if (filterPriority && d.priority !== filterPriority) return false;
      if (filterRag && d.rag !== filterRag) return false;
      if (filterGate && (d.gateDecision ?? "") !== filterGate) return false;
      if (filterDateFrom && d.dueDate && d.dueDate < filterDateFrom) return false;
      if (filterDateTo && d.dueDate && d.dueDate > filterDateTo) return false;
      return true;
    });
  }, [milestones, searchText, filterStatus, filterPriority, filterRag, filterGate, filterDateFrom, filterDateTo, pendingPatches]);

  // Pre-compute derived fields per milestone for sorting
  const derivedMap = useMemo(() => {
    const map: Record<number, { owner: string; manager: string; plannedStart: string; consolidatedStatus: string }> = {};
    for (const ms of milestones) {
      const msTasks = tasks.filter(t => t.milestoneId === ms.id);
      // Owner: most-frequent assignee name
      const freq: Record<string, number> = {};
      for (const t of msTasks) if (t.assigneeName) freq[t.assigneeName] = (freq[t.assigneeName] ?? 0) + 1;
      const owner = Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
      // Manager: first task's manager name
      const managerTask = msTasks.find(t => t.managerId);
      const manager = managerTask ? (users.find(u => u.id === managerTask.managerId)?.name ?? "") : "";
      // Planned start: earliest task start date
      const plannedStart = msTasks.filter(t => t.startDate).map(t => t.startDate!).sort()[0] ?? "";
      // Consolidated status
      const consolidatedStatus = computeConsolidatedStatus(msTasks);
      map[ms.id] = { owner, manager, plannedStart, consolidatedStatus };
    }
    return map;
  }, [milestones, tasks, users]);

  const sorted = useMemo(() => {
    const priorityOrder: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
    return [...filtered].sort((a, b) => {
      const aD = { ...a, ...pendingPatches[a.id] } as GridMilestone;
      const bD = { ...b, ...pendingPatches[b.id] } as GridMilestone;
      let va: string | number = "";
      let vb: string | number = "";

      if (sortKey === "scheduleVarianceDays" || sortKey === "plannedEffortHours") {
        va = Number(aD[sortKey] ?? 0); vb = Number(bD[sortKey] ?? 0);
      } else if (sortKey === "priority") {
        va = priorityOrder[aD.priority] ?? 9; vb = priorityOrder[bD.priority] ?? 9;
      } else if (sortKey === "derivedOwner") {
        va = derivedMap[a.id]?.owner ?? ""; vb = derivedMap[b.id]?.owner ?? "";
      } else if (sortKey === "derivedManager") {
        va = derivedMap[a.id]?.manager ?? ""; vb = derivedMap[b.id]?.manager ?? "";
      } else if (sortKey === "plannedStart") {
        va = derivedMap[a.id]?.plannedStart ?? ""; vb = derivedMap[b.id]?.plannedStart ?? "";
      } else if (sortKey === "consolidatedStatus") {
        va = derivedMap[a.id]?.consolidatedStatus ?? ""; vb = derivedMap[b.id]?.consolidatedStatus ?? "";
      } else {
        va = (aD[sortKey as keyof GridMilestone] as string) ?? "";
        vb = (bD[sortKey as keyof GridMilestone] as string) ?? "";
      }

      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [filtered, sortKey, sortDir, pendingPatches, derivedMap]);

  function patch(msId: number, data: Record<string, unknown>) {
    setPendingPatches(prev => ({ ...prev, [msId]: { ...(prev[msId] ?? {}), ...data } }));
    updateMilestone.mutate(
      { id: msId, data: data as Parameters<typeof updateMilestone.mutate>[0]["data"] },
      {
        onSuccess: () => {
          setPendingPatches(prev => { const n = { ...prev }; delete n[msId]; return n; });
          onRefresh();
        },
        onError: () => {
          setPendingPatches(prev => { const n = { ...prev }; delete n[msId]; return n; });
          toast({ title: "Update failed — changes reverted", variant: "destructive" });
        },
      }
    );
  }

  function SortBtn({ col }: { col: SortKey }) {
    return (
      <button onClick={() => handleSort(col)} className="inline-flex items-center opacity-50 hover:opacity-100 ml-0.5">
        <ArrowUpDown size={10} />
      </button>
    );
  }

  // Derived columns from child tasks
  function getMilestoneOwner(msId: number): string {
    const msTasks = tasks.filter(t => t.milestoneId === msId && t.assigneeName);
    if (!msTasks.length) return "—";
    const freq: Record<string, number> = {};
    for (const t of msTasks) if (t.assigneeName) freq[t.assigneeName] = (freq[t.assigneeName] ?? 0) + 1;
    return Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";
  }

  function getMilestoneManager(msId: number): string {
    const msTasks = tasks.filter(t => t.milestoneId === msId && t.managerId);
    if (!msTasks.length) return "—";
    return users.find(u => u.id === msTasks[0].managerId)?.name ?? `#${msTasks[0].managerId}`;
  }

  function getMilestonePlannedStart(msId: number): string | null {
    const dates = tasks.filter(t => t.milestoneId === msId && t.startDate).map(t => t.startDate!).sort();
    return dates[0] ?? null;
  }

  const hasFilters = searchText || filterStatus || filterPriority || filterRag || filterGate || filterDateFrom || filterDateTo;

  const thCls = "text-left text-xs font-bold text-muted-foreground uppercase tracking-wide py-2.5 px-2 border-b border-border/60 bg-muted/40 whitespace-nowrap sticky top-0 z-10";

  return (
    <>
      {/* Comprehensive filter bar */}
      <div
        className="flex flex-wrap items-center gap-2 py-2 mb-2 px-1"
        style={{ position: "sticky", top: 0, zIndex: 10, background: "white" }}
      >
        <div className="relative flex-1 min-w-[150px]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            placeholder="Search milestones..."
            className="w-full pl-8 text-xs border rounded-lg px-2 py-1.5 outline-none h-8"
          />
        </div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="text-xs border rounded-lg px-2 py-1.5 h-8 outline-none" style={{ minWidth: 120 }}>
          <option value="">All Statuses</option>
          {TASK_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)} className="text-xs border rounded-lg px-2 py-1.5 h-8 outline-none" style={{ minWidth: 110 }}>
          <option value="">All Priorities</option>
          {TASK_PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
        <select value={filterRag} onChange={e => setFilterRag(e.target.value)} className="text-xs border rounded-lg px-2 py-1.5 h-8 outline-none" style={{ minWidth: 95 }}>
          {RAG_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={filterGate} onChange={e => setFilterGate(e.target.value)} className="text-xs border rounded-lg px-2 py-1.5 h-8 outline-none" style={{ minWidth: 110 }}>
          <option value="">All Gates</option>
          <option value="go">Go</option>
          <option value="no_go">No-Go</option>
          <option value="conditional">Conditional</option>
        </select>
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">Due from</span>
          <input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)} className="text-xs border rounded px-1.5 py-1 h-8 outline-none" style={{ maxWidth: 120 }} />
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">to</span>
          <input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)} className="text-xs border rounded px-1.5 py-1 h-8 outline-none" style={{ maxWidth: 120 }} />
        </div>
        {hasFilters && (
          <button
            onClick={() => { setSearchText(""); setFilterStatus(""); setFilterPriority(""); setFilterRag(""); setFilterGate(""); setFilterDateFrom(""); setFilterDateTo(""); }}
            className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded-lg hover:bg-accent/60 flex items-center gap-1"
          >
            ✕ Clear
          </button>
        )}
        <span className="text-xs text-muted-foreground ml-2">{sorted.length} / {milestones.length}</span>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border">
        <table className="w-full border-collapse" style={{ tableLayout: "fixed", minWidth: 1400 }}>
          <thead>
            <tr>
              <th style={{ width: 180 }} className={thCls}>Milestone <SortBtn col="name" /></th>
              <th style={{ width: 120 }} className={thCls}>Status <SortBtn col="status" /></th>
              <th style={{ width: 110 }} className={thCls}>Consolidated <SortBtn col="consolidatedStatus" /></th>
              <th style={{ width: 50 }} className={thCls}>RAG <SortBtn col="rag" /></th>
              <th style={{ width: 90 }} className={thCls}>Priority <SortBtn col="priority" /></th>
              <th style={{ width: 90 }} className={thCls}>Owner <SortBtn col="derivedOwner" /></th>
              <th style={{ width: 90 }} className={thCls}>Manager <SortBtn col="derivedManager" /></th>
              <th style={{ width: 85 }} className={thCls}>Plan. Start <SortBtn col="plannedStart" /></th>
              <th style={{ width: 85 }} className={thCls}>Plan. End <SortBtn col="dueDate" /></th>
              <th style={{ width: 85 }} className={thCls}>Act. Start <SortBtn col="actualStart" /></th>
              <th style={{ width: 85 }} className={thCls}>Act. End <SortBtn col="actualEnd" /></th>
              <th style={{ width: 80 }} className={thCls}>Variance <SortBtn col="scheduleVarianceDays" /></th>
              <th style={{ width: 65 }} className={thCls}>Effort <SortBtn col="plannedEffortHours" /></th>
              <th style={{ width: 100 }} className={thCls}>Gate <SortBtn col="gateDecision" /></th>
              <th style={{ width: 60 }} className={thCls}>Issues</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={15} className="text-center py-12 text-muted-foreground text-sm">No milestones found.</td>
              </tr>
            )}
            {sorted.map(ms => {
              const d = { ...ms, ...pendingPatches[ms.id] } as GridMilestone;
              const msTasks = tasks.filter(t => t.milestoneId === ms.id);
              const variance = fmtVariance(d.scheduleVarianceDays);
              const issueCount = issueCountByMilestone[ms.id] ?? 0;
              const derivedOwner = getMilestoneOwner(ms.id);
              const derivedManager = getMilestoneManager(ms.id);
              const derivedStart = getMilestonePlannedStart(ms.id);

              return (
                <tr
                  key={ms.id}
                  className="border-b border-border/40 hover:bg-primary/10 transition-colors text-xs"
                >
                  <td className="py-2.5 px-2">
                    <span className="font-semibold text-foreground truncate block" title={d.name}>{d.name}</span>
                  </td>
                  <td className="py-2 px-2">
                    <StatusSelect value={d.status} onChange={v => patch(ms.id, { status: v })} />
                  </td>
                  <td className="py-2 px-2">
                    <ConsolidatedStatusPill tasks={msTasks} />
                    {msTasks.length > 0 && (
                      <span className="text-muted-foreground text-xs ml-1">({msTasks.length})</span>
                    )}
                  </td>
                  <td className="py-2 px-2 text-center">
                    <RagDot rag={d.rag ?? "green"} />
                  </td>
                  <td className="py-2 px-2">
                    <PrioritySelect value={d.priority} onChange={v => patch(ms.id, { priority: v })} />
                  </td>
                  <td className="py-2 px-2">
                    <span className="text-xs text-foreground block truncate" title={derivedOwner}>{derivedOwner}</span>
                    <span className="text-muted-foreground" style={{ fontSize: 9 }}>tasks</span>
                  </td>
                  <td className="py-2 px-2">
                    <span className="text-xs text-foreground block truncate">{derivedManager}</span>
                    <span className="text-muted-foreground" style={{ fontSize: 9 }}>tasks</span>
                  </td>
                  <td className="py-2 px-2">
                    <span className="text-xs text-foreground block">
                      {derivedStart
                        ? new Date(derivedStart).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" })
                        : <span className="text-muted-foreground/60">—</span>}
                    </span>
                  </td>
                  <td className="py-2 px-2">
                    <InlineDateCell value={d.dueDate} onSave={v => patch(ms.id, { dueDate: v || null })} />
                  </td>
                  <td className="py-2 px-2">
                    <InlineDateCell value={d.actualStart} onSave={v => patch(ms.id, { actualStart: v || null })} />
                  </td>
                  <td className="py-2 px-2">
                    <InlineDateCell value={d.actualEnd} onSave={v => patch(ms.id, { actualEnd: v || null })} />
                  </td>
                  <td className="py-2 px-2 text-center">
                    <span className="font-semibold" style={{ color: variance.color }}>{variance.text}</span>
                  </td>
                  <td className="py-2 px-2">
                    <InlineNumberCell
                      value={d.plannedEffortHours}
                      onSave={v => patch(ms.id, { plannedEffortHours: v })}
                    />
                  </td>
                  <td className="py-2 px-2">
                    <select
                      value={d.gateDecision ?? ""}
                      onChange={e => patch(ms.id, { gateDecision: e.target.value || null })}
                      className="text-xs border rounded px-1.5 py-0.5 w-full outline-none"
                    >
                      {GATE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </td>
                  <td className="py-2 px-2 text-center">
                    <button
                      onClick={() => setIssueModal({ milestoneId: ms.id, name: d.name })}
                      className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${
                        issueCount > 0
                          ? "bg-destructive/10 text-destructive border-destructive/20"
                          : "bg-muted text-muted-foreground border-border"
                      }`}
                    >
                      <AlertTriangle size={10} />
                      {issueCount > 0 ? issueCount : "+"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {issueModal && (
        <IssueRaiseModal
          open={true}
          onClose={() => setIssueModal(null)}
          projectId={projectId}
          milestoneId={issueModal.milestoneId}
          taskName={issueModal.name}
        />
      )}
    </>
  );
}
