import { useMemo, useState } from "react";
import { HoverHint } from "@/components/ui-kit";
import { ChevronDown, ChevronRight, Search, User, Plus, Info, Star, Link2, Paperclip, MessageSquare } from "lucide-react";

// ─── Statement of Work board (Monday.com-style WBS) ─────────────────────────
//
// Visual replica of the "Statement of Work" Monday board. Groups = milestones
// (cycling colours), rows = the tasks owned by each milestone. Designed to
// be a drop-in third view in the Work tab toggle, sitting next to
// List (WbsTree) and Board (Kanban).
//
// Data is read-only in v1 — Add Item / row edits open the existing
// TaskDetailModal flow via onOpenTask. This keeps the component pure and
// focused on the visual match; per-cell inline editing can come next.

export type SowTask = {
  id: number;
  name: string;
  milestoneId: number | null;
  description?: string | null;
  status: string;
  priority?: string;
  rag?: string | null;
  progressPct: number;
  assigneeId?: number | null;
  assigneeName?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  estimatedHours?: number | null;
  plannedEffortHours?: number | null;
  isCritical?: boolean;
};

export type SowMilestone = {
  id: number;
  name: string;
  dueDate?: string | null;
  rag?: string | null;
  status: string;
};

// Monday group palette — cycles per milestone in order.
const GROUP_COLORS = [
  { name: "coral", hex: "#E2445C", soft: "#FCE9EC" },
  { name: "blue", hex: "#0086C0", soft: "#E0F1F8" },
  { name: "purple", hex: "#A25DDC", soft: "#F1E6FB" },
  { name: "amber", hex: "#FDAB3D", soft: "#FFF1DE" },
  { name: "emerald", hex: "#00C875", soft: "#DEF5EB" },
  { name: "indigo", hex: "#6366F1", soft: "#E4E5FB" },
  { name: "pink", hex: "#EC4899", soft: "#FCE3EE" },
  { name: "slate", hex: "#64748B", soft: "#E8ECF1" },
] as const;

// Status → Monday pill mapping. Anything unrecognised falls back to
// "Not yet started" so the column never looks empty.
function statusPill(status: string): { label: string; bg: string } {
  const s = (status ?? "").toLowerCase();
  if (["completed", "done", "complete", "finished"].includes(s)) return { label: "Done", bg: "#00C875" };
  if (["in_progress", "in-progress", "working", "in progress", "review", "active"].includes(s)) return { label: "Working on it", bg: "#FDAB3D" };
  if (["blocked", "stuck", "on_hold", "on hold"].includes(s)) return { label: "Stuck", bg: "#E2445C" };
  return { label: "Not yet started", bg: "#C4C4C4" };
}

function ragColor(rag?: string | null): string {
  const r = (rag ?? "").toLowerCase();
  if (r === "red") return "#E2445C";
  if (r === "amber" || r === "yellow") return "#FDAB3D";
  if (r === "green") return "#00C875";
  return "#C4C4C4";
}

function shortDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function initials(name?: string | null): string {
  if (!name) return "";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return ((parts[0]![0] ?? "") + (parts[parts.length - 1]![0] ?? "")).toUpperCase();
}

export function SowBoard({
  milestones, tasks, projectName,
  onOpenTask, onAddTask,
}: {
  milestones: SowMilestone[];
  tasks: SowTask[];
  projectName?: string | null;
  onOpenTask?: (taskId: number) => void;
  onAddTask?: (milestoneId: number | null) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<number | "orphan">>(new Set());
  const [activeTab, setActiveTab] = useState<"main" | "milestones">("main");
  const [search, setSearch] = useState("");

  function toggle(key: number | "orphan") {
    const next = new Set(collapsed);
    next.has(key) ? next.delete(key) : next.add(key);
    setCollapsed(next);
  }

  // Bucket tasks by milestone. Orphan tasks (no milestone) collect under
  // a synthetic "Other Items" group at the bottom so they're never lost.
  const buckets = useMemo(() => {
    const byMs = new Map<number | "orphan", SowTask[]>();
    for (const m of milestones) byMs.set(m.id, []);
    byMs.set("orphan", []);
    for (const t of tasks) {
      const key = t.milestoneId ?? "orphan";
      if (!byMs.has(key)) byMs.set(key, []);
      byMs.get(key)!.push(t);
    }
    return byMs;
  }, [milestones, tasks]);

  const filteredTasks = useMemo(() => {
    if (!search.trim()) return null;
    const needle = search.toLowerCase();
    return new Set(tasks.filter(t =>
      t.name.toLowerCase().includes(needle)
      || (t.description ?? "").toLowerCase().includes(needle)
      || (t.assigneeName ?? "").toLowerCase().includes(needle)
    ).map(t => t.id));
  }, [tasks, search]);

  const orphans = buckets.get("orphan") ?? [];
  const groups = [
    ...milestones.map((m, i) => ({
      key: m.id as number | "orphan",
      name: m.name,
      color: GROUP_COLORS[i % GROUP_COLORS.length]!,
      tasks: buckets.get(m.id) ?? [],
      dueDate: m.dueDate,
    })),
    ...(orphans.length > 0 ? [{
      key: "orphan" as const,
      name: "Other Items",
      color: GROUP_COLORS[milestones.length % GROUP_COLORS.length]!,
      tasks: orphans,
      dueDate: null as string | null,
    }] : []),
  ];

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      {/* ── Board header ─────────────────────────────────────────────── */}
      <div className="px-6 pt-5 pb-3 border-b border-border">
        <div className="flex items-center gap-2">
          <h2 className="text-[22px] font-semibold tracking-tight text-foreground">Statement of Work</h2>
          <Info size={14} className="text-muted-foreground" />
          <Star size={14} className="text-muted-foreground" />
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {projectName ? `${projectName} — ` : ""}Add board description
        </p>
        <div className="flex items-center gap-4 mt-3 border-b border-border -mb-3">
          {([
            { v: "main" as const, label: "Main Table" },
            { v: "milestones" as const, label: "Major Milestones" },
          ]).map(t => (
            <button key={t.v} onClick={() => setActiveTab(t.v)}
              className={`text-sm font-medium pb-2 border-b-2 ${activeTab === t.v ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Toolbar ───────────────────────────────────────────────────── */}
      <div className="px-6 py-3 flex items-center gap-2 border-b border-border bg-card/40">
        <button
          onClick={() => onAddTask?.(null)}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-[#0073EA] hover:bg-[#0060C2] text-white text-sm font-semibold shadow-sm"
        >
          New Item <ChevronDown size={14} />
        </button>
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search"
            className="pl-7 pr-3 h-8 rounded-md border border-border bg-background text-sm w-44 focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <button className="inline-flex items-center gap-1.5 px-3 h-8 rounded-md border border-border text-sm text-muted-foreground hover:bg-muted">
          <User size={13} /> Person
        </button>
      </div>

      {activeTab === "milestones" ? (
        <MajorMilestonesView milestones={milestones} buckets={buckets} />
      ) : (
        <div className="overflow-x-auto">
          {groups.map(g => (
            <SowGroup
              key={String(g.key)}
              name={g.name}
              color={g.color}
              tasks={filteredTasks ? g.tasks.filter(t => filteredTasks.has(t.id)) : g.tasks}
              groupDue={g.dueDate}
              collapsed={collapsed.has(g.key)}
              onToggle={() => toggle(g.key)}
              onOpenTask={onOpenTask}
              onAddItem={() => onAddTask?.(g.key === "orphan" ? null : (g.key as number))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Group section ─────────────────────────────────────────────────────────

function SowGroup({
  name, color, tasks, groupDue, collapsed, onToggle, onOpenTask, onAddItem,
}: {
  name: string;
  color: typeof GROUP_COLORS[number];
  tasks: SowTask[];
  groupDue: string | null | undefined;
  collapsed: boolean;
  onToggle: () => void;
  onOpenTask?: (id: number) => void;
  onAddItem: () => void;
}) {
  // Aggregates rendered in the group footer row.
  const done = tasks.filter(t => statusPill(t.status).label === "Done").length;
  const working = tasks.filter(t => statusPill(t.status).label === "Working on it").length;
  const stuck = tasks.filter(t => statusPill(t.status).label === "Stuck").length;
  const todo = tasks.filter(t => statusPill(t.status).label === "Not yet started").length;
  const totalCost = tasks.reduce((s, t) => s + Number(t.plannedEffortHours ?? 0) * 0, 0); // no per-task $ field yet
  const total = tasks.length || 1;

  return (
    <div className="border-b border-border last:border-b-0">
      {/* Group header */}
      <button onClick={onToggle} className="w-full flex items-center gap-2 px-6 py-3 hover:bg-muted/30">
        <span className="flex items-center justify-center w-5 h-5 rounded-full" style={{ background: color.hex }}>
          {collapsed ? <ChevronRight size={12} className="text-white" /> : <ChevronDown size={12} className="text-white" />}
        </span>
        <span className="font-semibold text-[15px]" style={{ color: color.hex }}>{name}</span>
      </button>

      {!collapsed && (
        <>
          {/* Column header row */}
          <div className="grid items-center text-[11px] uppercase tracking-wider text-muted-foreground bg-muted/30 border-y border-border"
               style={{ gridTemplateColumns: "4px 240px 1fr 140px 80px 180px 130px 110px 110px 120px" }}>
            <div />
            <div className="px-3 py-2">Item</div>
            <div className="px-3 py-2">Description</div>
            <div className="px-3 py-2">Performance</div>
            <div className="px-3 py-2 text-center">Leader</div>
            <div className="px-3 py-2 text-center">Progress</div>
            <div className="px-3 py-2">Estimated Cost</div>
            <div className="px-3 py-2">Start Date</div>
            <div className="px-3 py-2 flex items-center gap-1"><Link2 size={10} />End date</div>
            <div className="px-3 py-2">Additional Info</div>
          </div>

          {/* Rows */}
          {tasks.length === 0 ? (
            <div className="px-6 py-3 text-xs text-muted-foreground italic">No items in this group yet.</div>
          ) : tasks.map(t => (
            <SowRow key={t.id} task={t} color={color} onOpen={() => onOpenTask?.(t.id)} />
          ))}

          {/* Add item row */}
          <div className="grid items-center text-sm border-b border-border"
               style={{ gridTemplateColumns: "4px 240px 1fr 140px 80px 180px 130px 110px 110px 120px" }}>
            <div className="self-stretch" style={{ background: color.soft }} />
            <button onClick={onAddItem} className="text-left px-3 py-2 text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
              <Plus size={12} /> Add Item
            </button>
            <div /><div /><div /><div /><div /><div /><div /><div />
          </div>

          {/* Group footer row (aggregates) */}
          <div className="grid items-center text-sm bg-muted/20 border-b border-border"
               style={{ gridTemplateColumns: "4px 240px 1fr 140px 80px 180px 130px 110px 110px 120px" }}>
            <div className="self-stretch" style={{ background: color.hex, opacity: 0.45 }} />
            <div className="px-3 py-2 text-xs text-muted-foreground">{tasks.length} item{tasks.length === 1 ? "" : "s"}</div>
            <div />
            <div />
            <div className="px-3 py-2 flex items-center justify-center">
              <span className="w-6 h-6 rounded-full bg-muted flex items-center justify-center"><User size={12} className="text-muted-foreground" /></span>
            </div>
            <div className="px-3 py-2">
              <ProgressStack
                segments={[
                  { color: "#00C875", pct: (done / total) * 100 },
                  { color: "#FDAB3D", pct: (working / total) * 100 },
                  { color: "#E2445C", pct: (stuck / total) * 100 },
                  { color: "#C4C4C4", pct: (todo / total) * 100 },
                ]}
              />
            </div>
            <div className="px-3 py-2 tabular-nums text-xs">
              <span className="font-semibold">${totalCost.toLocaleString()}</span> <span className="text-muted-foreground">sum</span>
            </div>
            <div />
            <div className="px-3 py-2">
              {groupDue && (
                <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-foreground text-background text-xs font-semibold">
                  {shortDate(groupDue)}
                </span>
              )}
            </div>
            <div className="px-3 py-2 flex items-center gap-1.5 text-muted-foreground">
              <Paperclip size={11} /><MessageSquare size={11} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Row ────────────────────────────────────────────────────────────────────

function SowRow({ task, color, onOpen }: { task: SowTask; color: typeof GROUP_COLORS[number]; onOpen: () => void }) {
  const pill = statusPill(task.status);
  const done = pill.label === "Done";
  const perfHex = ragColor(task.rag);
  return (
    <div
      className="grid items-center text-sm border-b border-border last:border-b-0 hover:bg-muted/20 cursor-pointer"
      style={{ gridTemplateColumns: "4px 240px 1fr 140px 80px 180px 130px 110px 110px 120px" }}
      onClick={onOpen}
    >
      {/* Left stripe */}
      <div className="self-stretch" style={{ background: color.hex }} />

      {/* Item name */}
      <div className="px-3 py-2 flex items-center gap-2 min-w-0">
        <span className="truncate font-medium">{task.name}</span>
        <button
          onClick={(e) => { e.stopPropagation(); onOpen(); }}
          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground"
          aria-label="Expand"
        >
          <Plus size={12} className="rotate-45" />
        </button>
      </div>

      {/* Description */}
      <div className="px-3 py-2 text-muted-foreground truncate">{task.description || "—"}</div>

      {/* Performance — RAG dot + label */}
      <div className="px-3 py-2">
        {task.rag ? (
          <span className="inline-flex items-center gap-1.5 text-xs">
            <span className="w-2 h-2 rounded-full" style={{ background: perfHex }} />
            <span className="capitalize text-muted-foreground">{task.rag}</span>
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </div>

      {/* Leader avatar */}
      <div className="px-3 py-2 flex items-center justify-center">
        {task.assigneeName ? (
          <HoverHint label={task.assigneeName}>
            <span className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-[11px] font-semibold">
              {initials(task.assigneeName)}
            </span>
          </HoverHint>
        ) : (
          <span className="w-7 h-7 rounded-full bg-muted flex items-center justify-center"><User size={13} className="text-muted-foreground" /></span>
        )}
      </div>

      {/* Progress status pill */}
      <div className="px-3 py-2">
        <span
          className="block text-center px-3 py-1.5 rounded-md text-white text-[11px] font-bold uppercase tracking-wide leading-tight"
          style={{ background: pill.bg }}
        >
          {pill.label}
        </span>
      </div>

      {/* Estimated cost */}
      <div className="px-3 py-2 tabular-nums text-xs">
        {task.plannedEffortHours
          ? <span>${Number(task.plannedEffortHours).toLocaleString()}</span>
          : <span className="text-muted-foreground">—</span>}
      </div>

      {/* Start date */}
      <div className="px-3 py-2">
        {task.startDate ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="text-xs">{shortDate(task.startDate)}</span>
            {done && <span className="w-3.5 h-3.5 rounded-full bg-emerald-500 text-white text-[9px] flex items-center justify-center">✓</span>}
            {!done && <span className="w-3.5 h-3.5 rounded-full border border-muted-foreground/40" />}
          </span>
        ) : <span className="text-xs text-muted-foreground">—</span>}
      </div>

      {/* End date */}
      <div className="px-3 py-2">
        {task.endDate ? (
          <span className={`text-xs ${done ? "line-through text-muted-foreground" : ""}`}>{shortDate(task.endDate)}</span>
        ) : <span className="text-xs text-muted-foreground">—</span>}
      </div>

      {/* Additional info icons */}
      <div className="px-3 py-2 flex items-center gap-1.5 text-muted-foreground">
        {task.isCritical && <span title="Critical path" className="w-1.5 h-1.5 rounded-full bg-rose-500" />}
        <Paperclip size={11} />
        <MessageSquare size={11} />
        <Link2 size={11} />
      </div>
    </div>
  );
}

// ─── Stacked progress bar (group footer) ───────────────────────────────────

function ProgressStack({ segments }: { segments: Array<{ color: string; pct: number }> }) {
  return (
    <div className="flex h-6 w-full rounded-md overflow-hidden border border-border">
      {segments.map((s, i) => s.pct > 0 ? (
        <div key={i} style={{ width: `${s.pct}%`, background: s.color }} />
      ) : null)}
    </div>
  );
}

// ─── Major Milestones sub-tab ──────────────────────────────────────────────

function MajorMilestonesView({ milestones, buckets }: { milestones: SowMilestone[]; buckets: Map<number | "orphan", SowTask[]> }) {
  if (milestones.length === 0) {
    return <div className="px-6 py-10 text-center text-sm text-muted-foreground">No milestones defined yet.</div>;
  }
  return (
    <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      {milestones.map((m, i) => {
        const color = GROUP_COLORS[i % GROUP_COLORS.length]!;
        const items = buckets.get(m.id) ?? [];
        const doneCount = items.filter(t => statusPill(t.status).label === "Done").length;
        return (
          <div key={m.id} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full" style={{ background: color.hex }} />
              <p className="font-semibold flex-1 truncate">{m.name}</p>
              {m.dueDate && <span className="text-xs px-2 py-0.5 rounded-full bg-foreground text-background">{shortDate(m.dueDate)}</span>}
            </div>
            <div className="mt-3 text-xs text-muted-foreground">{doneCount} / {items.length} items done</div>
            <div className="mt-2"><ProgressStack segments={[{ color: color.hex, pct: items.length ? (doneCount / items.length) * 100 : 0 }, { color: "#E5E7EB", pct: items.length ? 100 - (doneCount / items.length) * 100 : 100 }]} /></div>
          </div>
        );
      })}
    </div>
  );
}
