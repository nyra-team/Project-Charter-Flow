import { useState, useMemo, useCallback, useEffect } from "react";
import { useRoute, Link } from "wouter";
import {
  useGetProject, useListMilestones, useListTasks,
  useGetBurndown, useGetCriticalPath, useListProjectStages,
} from "@workspace/api-client-react";
import { formatDate, formatCurrency } from "../lib/format";
import { StatusBadge } from "../components/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import {
  ChevronLeft, BarChart2, List, Milestone,
  Plus, CheckCircle2, Clock, AlertTriangle, Flag,
  ChevronDown, ChevronRight, Layers, XCircle,
} from "lucide-react";
import { StageProgressBar } from "../components/stage-progress-bar";
import { StagePanel } from "../components/stage-panel";
import { getCurrentStageKey, LIFECYCLE_STAGES } from "../lib/lifecycle-config";
import { useUserStore } from "../lib/store";

// ── helpers ──────────────────────────────────────────────────────────────────
const DAY_MS = 86_400_000;
const ROW_H = 40;
const LEFT_W = 260;
const DAY_W = 28;

function toDate(s?: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function datesForProject(project: { startDate?: string | null; endDate?: string | null }, milestones: Milestone[], tasks: Task[]) {
  const dates: Date[] = [];
  const p = toDate(project.startDate) ?? toDate(project.endDate);
  if (p) dates.push(p);
  const ep = toDate(project.endDate);
  if (ep) dates.push(ep);
  for (const m of milestones) { const d = toDate(m.dueDate); if (d) dates.push(d); }
  for (const t of tasks) {
    const s = toDate(t.startDate); const e = toDate(t.endDate);
    if (s) dates.push(s); if (e) dates.push(e);
  }
  if (!dates.length) return { min: new Date(), max: new Date(Date.now() + 90 * DAY_MS) };
  const min = new Date(Math.min(...dates.map(d => d.getTime())) - 3 * DAY_MS);
  const max = new Date(Math.max(...dates.map(d => d.getTime())) + 7 * DAY_MS);
  min.setHours(0, 0, 0, 0); max.setHours(23, 59, 59, 0);
  return { min, max };
}

type Milestone = { id: number; name: string; dueDate?: string | null; status: string; description?: string | null };
type Task = {
  id: number; name: string; milestoneId?: number | null;
  startDate?: string | null; endDate?: string | null;
  status: string; priority: string; estimatedHours?: number | null;
  assigneeName?: string | null; predecessorIds?: string | number[] | null;
};

// ── Gantt SVG ────────────────────────────────────────────────────────────────
function GanttChart({
  milestones, tasks, criticalIds, minDate, maxDate,
}: {
  milestones: Milestone[]; tasks: Task[];
  criticalIds: Set<number>; minDate: Date; maxDate: Date;
}) {
  const totalDays = Math.ceil((maxDate.getTime() - minDate.getTime()) / DAY_MS);
  const svgW = totalDays * DAY_W;

  type Row = { type: "milestone"; item: Milestone } | { type: "task"; item: Task };
  const rows: Row[] = [];
  const used = new Set<number>();

  for (const m of milestones) {
    rows.push({ type: "milestone", item: m });
    for (const t of tasks) {
      if (t.milestoneId === m.id) { rows.push({ type: "task", item: t }); used.add(t.id); }
    }
  }
  for (const t of tasks) {
    if (!used.has(t.id)) rows.push({ type: "task", item: t });
  }

  const svgH = rows.length * ROW_H + 56;

  function dayX(d: Date) {
    return ((d.getTime() - minDate.getTime()) / DAY_MS) * DAY_W;
  }

  function rowBarProps(row: Row) {
    if (row.type === "milestone") {
      const dd = toDate(row.item.dueDate);
      if (!dd) return null;
      const cx = dayX(dd);
      return { cx, type: "milestone" as const };
    }
    const t = row.item as Task;
    const s = toDate(t.startDate); const e = toDate(t.endDate);
    if (!s) return null;
    const startX = dayX(s);
    const endX = e ? dayX(e) : startX + (t.estimatedHours ? (t.estimatedHours / 8) * DAY_W : 3 * DAY_W);
    const w = Math.max(endX - startX, 6);
    return { x: startX, w, type: "task" as const };
  }

  const weeks: { label: string; x: number; w: number }[] = [];
  const d = new Date(minDate); d.setDate(d.getDate() - d.getDay());
  while (d < maxDate) {
    const wx = Math.max(0, dayX(d));
    const nd = new Date(d); nd.setDate(nd.getDate() + 7);
    const nwx = Math.min(svgW, dayX(nd));
    if (nwx > wx) {
      weeks.push({ label: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }), x: wx, w: nwx - wx });
    }
    d.setDate(d.getDate() + 7);
  }

  const todayX = dayX(new Date());

  const taskRowIdx: Record<number, number> = {};
  rows.forEach((r, i) => { if (r.type === "task") taskRowIdx[(r.item as Task).id] = i; });
  const taskBarX: Record<number, { x: number; w: number }> = {};
  rows.forEach(r => {
    if (r.type === "task") {
      const props = rowBarProps(r);
      if (props && props.type === "task") taskBarX[(r.item as Task).id] = { x: props.x, w: props.w };
    }
  });

  const arrows: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (const row of rows) {
    if (row.type !== "task") continue;
    const t = row.item as Task;
    let predIds: number[] = [];
    try {
      if (Array.isArray(t.predecessorIds)) predIds = t.predecessorIds.map(Number);
      else if (typeof t.predecessorIds === "string" && t.predecessorIds) predIds = JSON.parse(t.predecessorIds).map(Number);
    } catch {}

    const toBarX = taskBarX[t.id];
    const toRowIdx = taskRowIdx[t.id];
    if (!toBarX || toRowIdx === undefined) continue;
    const toY = 56 + toRowIdx * ROW_H + ROW_H / 2;

    for (const predId of predIds) {
      const fromBarX = taskBarX[predId];
      const fromRowIdx = taskRowIdx[predId];
      if (!fromBarX || fromRowIdx === undefined) continue;
      const fromX = fromBarX.x + fromBarX.w;
      const fromY = 56 + fromRowIdx * ROW_H + ROW_H / 2;
      arrows.push({ x1: fromX, y1: fromY, x2: toBarX.x, y2: toY });
    }
  }

  return (
    <div className="flex" style={{ height: svgH + 2, overflow: "hidden" }}>
      <div className="flex-shrink-0 border-r border-gray-100" style={{ width: LEFT_W, minWidth: LEFT_W, height: svgH }}>
        <div className="flex items-center px-4 border-b border-gray-100" style={{ height: 56, background: "#F8FAFC" }}>
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Task / Milestone</span>
        </div>
        {rows.map((row, i) => (
          <div
            key={`${row.type}-${row.item.id}`}
            className="flex items-center border-b border-gray-50"
            style={{ height: ROW_H, paddingLeft: row.type === "task" ? 28 : 12, background: i % 2 === 0 ? "white" : "#FAFBFC" }}
          >
            {row.type === "milestone" ? (
              <div className="flex items-center gap-1.5">
                <Flag size={12} className="text-indigo-500 flex-shrink-0" />
                <span className="text-xs font-bold text-gray-800 truncate">{row.item.name}</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <div
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{
                    background: criticalIds.has((row.item as Task).id) ? "#EF4444"
                      : row.item.status === "completed" ? "#10B981" : "#6366F1",
                  }}
                />
                <span className="text-xs text-gray-700 truncate">{row.item.name}</span>
                {(row.item as Task).assigneeName && (
                  <span className="text-xs text-gray-400 ml-auto pr-2 flex-shrink-0 hidden xl:block">
                    {(row.item as Task).assigneeName}
                  </span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex-1 overflow-x-auto">
        <svg width={svgW} height={svgH} style={{ display: "block" }}>
          {rows.map((row, i) => (
            <rect key={`bg-${i}`} x={0} y={56 + i * ROW_H} width={svgW} height={ROW_H} fill={i % 2 === 0 ? "white" : "#FAFBFC"} />
          ))}
          {weeks.map((w, i) => (
            <g key={i}>
              <rect x={w.x} y={0} width={w.w} height={56} fill={i % 2 === 0 ? "#F8FAFC" : "#F1F5F9"} />
              <line x1={w.x} y1={0} x2={w.x} y2={svgH} stroke="#E2E8F0" strokeWidth={1} />
              <text x={w.x + w.w / 2} y={34} textAnchor="middle" fontSize={10} fill="#94A3B8" fontWeight={600}>{w.label}</text>
            </g>
          ))}
          <line x1={0} y1={56} x2={svgW} y2={56} stroke="#E2E8F0" strokeWidth={1} />
          {todayX >= 0 && todayX <= svgW && (
            <g>
              <line x1={todayX} y1={0} x2={todayX} y2={svgH} stroke="#EF4444" strokeWidth={1.5} strokeDasharray="4 3" opacity={0.7} />
              <rect x={todayX - 16} y={2} width={32} height={14} rx={3} fill="#EF4444" opacity={0.9} />
              <text x={todayX} y={12} textAnchor="middle" fontSize={8} fill="white" fontWeight={700}>TODAY</text>
            </g>
          )}
          <defs>
            <marker id="arrowhead" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 Z" fill="#94A3B8" />
            </marker>
          </defs>
          {arrows.map((a, i) => {
            const mx = (a.x1 + a.x2) / 2;
            const d = `M${a.x1},${a.y1} C${mx},${a.y1} ${mx},${a.y2} ${a.x2},${a.y2}`;
            return <path key={i} d={d} fill="none" stroke="#94A3B8" strokeWidth={1.5} markerEnd="url(#arrowhead)" opacity={0.6} />;
          })}
          {rows.map((row, i) => {
            const bp = rowBarProps(row);
            if (!bp) return null;
            const y = 56 + i * ROW_H;
            const isCritical = row.type === "task" && criticalIds.has((row.item as Task).id);
            const isDone = row.item.status === "completed";
            if (bp.type === "milestone") {
              const size = 9;
              return (
                <g key={`bar-${i}`}>
                  <polygon
                    points={`${bp.cx},${y + ROW_H / 2 - size} ${bp.cx + size},${y + ROW_H / 2} ${bp.cx},${y + ROW_H / 2 + size} ${bp.cx - size},${y + ROW_H / 2}`}
                    fill="#4F46E5" opacity={0.9}
                  />
                </g>
              );
            }
            const { x: bx, w: bw } = bp as { x: number; w: number; type: "task" };
            const barH = 18;
            const by = y + (ROW_H - barH) / 2;
            const barFill = isDone ? "#10B981" : isCritical ? "#EF4444" : row.item.status === "blocked" ? "#F59E0B" : "#6366F1";
            return (
              <g key={`bar-${i}`}>
                <rect x={bx} y={by} width={bw} height={barH} rx={4} fill={barFill} opacity={isDone ? 0.6 : 0.85} />
                {bw > 40 && (
                  <text x={bx + 6} y={by + 12} fontSize={9} fill="white" fontWeight={600}>
                    {row.item.name.substring(0, Math.floor(bw / 8))}
                  </text>
                )}
                {isCritical && <rect x={bx} y={by + barH - 3} width={bw} height={3} rx={0} fill="#B91C1C" />}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

// ── List View ─────────────────────────────────────────────────────────────────
function HierarchyList({ milestones, tasks, criticalIds }: { milestones: Milestone[]; tasks: Task[]; criticalIds: Set<number> }) {
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  const PRIORITY_COLORS: Record<string, string> = {
    critical: "#FEF2F2", high: "#FFFBEB", medium: "#EFF6FF", low: "#F0FDF4",
  };
  const PRIORITY_TEXT: Record<string, string> = {
    critical: "#991B1B", high: "#92400E", medium: "#1E40AF", low: "#065F46",
  };

  const used = new Set<number>();
  const groups: { milestone: Milestone | null; tasks: Task[] }[] = [];

  for (const m of milestones) {
    const mTasks = tasks.filter(t => t.milestoneId === m.id);
    mTasks.forEach(t => used.add(t.id));
    groups.push({ milestone: m, tasks: mTasks });
  }
  const unassigned = tasks.filter(t => !used.has(t.id));
  if (unassigned.length) groups.push({ milestone: null, tasks: unassigned });

  return (
    <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid #E2E8F0" }}>
      {groups.map((g, gi) => {
        const isCollapsed = g.milestone && collapsed.has(g.milestone.id);
        return (
          <div key={gi}>
            <div
              className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:opacity-90 transition-opacity"
              style={{ background: "linear-gradient(90deg, #EEF2FF, #F5F3FF)" }}
              onClick={() => {
                if (!g.milestone) return;
                setCollapsed(prev => {
                  const n = new Set(prev);
                  if (n.has(g.milestone!.id)) n.delete(g.milestone!.id);
                  else n.add(g.milestone!.id);
                  return n;
                });
              }}
            >
              {g.milestone ? (
                <>
                  {isCollapsed ? <ChevronRight size={14} className="text-indigo-400" /> : <ChevronDown size={14} className="text-indigo-400" />}
                  <Flag size={13} className="text-indigo-600" />
                  <span className="font-bold text-sm text-indigo-900">{g.milestone.name}</span>
                  {g.milestone.dueDate && (
                    <span className="text-xs text-indigo-500 ml-2">Due {formatDate(g.milestone.dueDate)}</span>
                  )}
                  <StatusBadge status={g.milestone.status} />
                  <span className="ml-auto text-xs text-indigo-400">{g.tasks.length} tasks</span>
                </>
              ) : (
                <span className="font-semibold text-sm text-gray-500">Unassigned Tasks</span>
              )}
            </div>

            {!isCollapsed && g.tasks.map(t => {
              const isCritical = criticalIds.has(t.id);
              return (
                <div
                  key={t.id}
                  className="flex items-center gap-3 px-4 py-2.5 border-t border-gray-50 hover:bg-gray-50 transition-colors"
                  style={{ background: isCritical ? "#FFF5F5" : "white", paddingLeft: g.milestone ? 40 : 16 }}
                >
                  <div
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{
                      background: t.status === "completed" ? "#10B981"
                        : t.status === "blocked" ? "#F59E0B"
                          : isCritical ? "#EF4444" : "#6366F1",
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-medium ${isCritical ? "text-red-700" : "text-gray-800"}`}>{t.name}</span>
                      {isCritical && (
                        <span className="text-xs px-1.5 py-0.5 rounded font-bold" style={{ background: "#FEE2E2", color: "#991B1B" }}>CRITICAL</span>
                      )}
                    </div>
                    {t.assigneeName && <p className="text-xs text-gray-400 mt-0.5">{t.assigneeName}</p>}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {t.priority && (
                      <span
                        className="text-xs px-2 py-0.5 rounded-full font-medium capitalize"
                        style={{ background: PRIORITY_COLORS[t.priority] ?? "#F8FAFC", color: PRIORITY_TEXT[t.priority] ?? "#64748B" }}
                      >
                        {t.priority}
                      </span>
                    )}
                    <StatusBadge status={t.status} />
                    {t.estimatedHours != null && (
                      <span className="text-xs text-gray-400 w-14 text-right">{t.estimatedHours}h</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ── NFA status hook ───────────────────────────────────────────────────────────
interface NFAStatus {
  triggered: boolean;
  overrunPct: number;
  threshold: number;
  totalBaseline: number;
  totalActual: number;
  nfaChainExists: boolean;
  // Correct order: hod → scm → cfo → chairman
  nfaChain: string[];
}

// Read-only NFA status — no side effects on GET
function useNFAStatus(projectId: number): NFAStatus | null {
  const [status, setStatus] = useState<NFAStatus | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${projectId}/nfa-status`)
      .then(r => { if (!r.ok) throw new Error("nfa-status failed"); return r.json(); })
      .then(data => { if (!cancelled) setStatus(data as NFAStatus); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [projectId]);

  // When overrun is detected and the chain does not yet exist, create it via POST (side-effect action)
  useEffect(() => {
    if (status?.triggered && !status.nfaChainExists) {
      fetch(`/api/projects/${projectId}/nfa-trigger`, { method: "POST" })
        .then(r => r.json())
        .then(result => {
          const r = result as { created?: boolean; chainLength?: number };
          if (r.created) {
            // Re-fetch status to update nfaChainExists flag
            fetch(`/api/projects/${projectId}/nfa-status`)
              .then(res => res.json())
              .then(data => setStatus(data as NFAStatus))
              .catch(() => {});
          }
        })
        .catch(() => {});
    }
  }, [projectId, status?.triggered, status?.nfaChainExists]);

  return status;
}

// ── Main ─────────────────────────────────────────────────────────────────────
export default function ProjectDetail() {
  const [, params] = useRoute("/projects/:id");
  const { role } = useUserStore();
  const projectId = parseInt(params?.id || "0");
  const [view, setView] = useState<"list" | "gantt">("list");
  const [activeTab, setActiveTab] = useState<"lifecycle" | "plan" | "analytics">("lifecycle");
  const [selectedStageKey, setSelectedStageKey] = useState<string | undefined>(undefined);
  const [nfaDismissed, setNfaDismissed] = useState(false);

  const { data: project, isLoading: loadingProject } = useGetProject(projectId);
  const { data: rawMilestones } = useListMilestones(projectId);
  const { data: rawTasks } = useListTasks(projectId);
  const { data: burndown } = useGetBurndown(projectId);
  const { data: criticalPath } = useGetCriticalPath(projectId);
  const { data: stageRecords = [] } = useListProjectStages(projectId);

  const nfaStatus = useNFAStatus(projectId);

  const milestones: Milestone[] = (rawMilestones ?? []) as Milestone[];
  const tasks: Task[] = (rawTasks ?? []) as Task[];
  const criticalIds = useMemo(() => new Set<number>((criticalPath?.criticalTasks ?? []).map((t: { id: number }) => t.id)), [criticalPath]);

  const { min: minDate, max: maxDate } = useMemo(() => datesForProject(project ?? {}, milestones, tasks), [project, milestones, tasks]);

  const totalTasks = tasks.length;
  const completedTasks = tasks.filter(t => t.status === "completed").length;
  const blockedTasks = tasks.filter(t => t.status === "blocked").length;
  const inProgressTasks = tasks.filter(t => t.status === "in_progress").length;

  const currentStageKey = useMemo(
    () => getCurrentStageKey(project?.stage, stageRecords as Array<{ stage: string; status: string }>),
    [project?.stage, stageRecords]
  );

  const handleStageClick = useCallback((key: string) => {
    setSelectedStageKey(key);
    setActiveTab("lifecycle");
  }, []);

  if (loadingProject) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 rounded-2xl" />
        <Skeleton className="h-48 rounded-2xl" />
      </div>
    );
  }
  if (!project) return <div className="text-center py-16 text-gray-400">Project not found</div>;

  const TABS = [
    { id: "lifecycle" as const, label: "Lifecycle", icon: Layers },
    { id: "plan" as const, label: "Project Plan", icon: Milestone },
    { id: "analytics" as const, label: "Analytics", icon: BarChart2 },
  ];

  return (
    <div className="space-y-5">
      {/* Back */}
      <Link href="/projects">
        <button className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors">
          <ChevronLeft size={15} />
          Back to Projects
        </button>
      </Link>

      {/* NFA Budget Overrun Alert */}
      {nfaStatus?.triggered && !nfaDismissed && (
        <div
          className="rounded-2xl p-4 flex items-start gap-3"
          style={{ background: "#FFF7ED", border: "1px solid #FDBA74" }}
        >
          <AlertTriangle size={18} className="text-orange-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-bold text-orange-800">NFA Budget Overrun Triggered</p>
            <p className="text-xs text-orange-700 mt-1">
              Actual budget has exceeded the baseline by <strong>{nfaStatus.overrunPct.toFixed(1)}%</strong>
              {" "}(threshold: {nfaStatus.threshold}%).
              An NFA approval workflow has been automatically triggered.
              Routing to: {nfaStatus.nfaChain.join(" → ")}.
            </p>
          </div>
          <button
            onClick={() => setNfaDismissed(true)}
            className="text-orange-400 hover:text-orange-600 flex-shrink-0"
          >
            <XCircle size={16} />
          </button>
        </div>
      )}

      {/* Header */}
      <div className="rounded-2xl p-6" style={{ background: "white", border: "1px solid #E2E8F0" }}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{project.name}</h1>
            <div className="flex items-center gap-3 mt-2">
              <StatusBadge status={project.status} />
              {project.startDate && (
                <span className="text-xs text-gray-400">
                  {formatDate(project.startDate)} — {formatDate(project.endDate)}
                </span>
              )}
              {project.stage && (
                <span
                  className="text-xs font-semibold px-2 py-0.5 rounded-full"
                  style={{ background: "#EEF2FF", color: "#4F46E5" }}
                >
                  {LIFECYCLE_STAGES.find(s => s.key === currentStageKey)?.label ?? currentStageKey}
                </span>
              )}
            </div>
            {project.description && (
              <p className="text-sm text-gray-500 mt-2 max-w-xl">{project.description}</p>
            )}
          </div>
          <Link href={`/projects/${project.id}/tasks/new`}>
            <button
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white flex-shrink-0"
              style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)" }}
            >
              <Plus size={14} />
              Add Task
            </button>
          </Link>
        </div>

        {/* Progress */}
        <div className="mt-4">
          <div className="flex justify-between text-sm mb-1.5">
            <span className="font-medium text-gray-600">Overall Progress</span>
            <span className="font-bold text-gray-900">{project.progress ?? 0}%</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${project.progress ?? 0}%`, background: "linear-gradient(90deg, #6366F1, #8B5CF6)" }}
            />
          </div>
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-4 gap-3 mt-4">
          {[
            { label: "Total Tasks", value: totalTasks, icon: List, color: "#6366F1", bg: "#EEF2FF" },
            { label: "Completed", value: completedTasks, icon: CheckCircle2, color: "#10B981", bg: "#ECFDF5" },
            { label: "In Progress", value: inProgressTasks, icon: Clock, color: "#3B82F6", bg: "#EFF6FF" },
            { label: "Blocked", value: blockedTasks, icon: AlertTriangle, color: "#F59E0B", bg: "#FFFBEB" },
          ].map(s => {
            const Icon = s.icon;
            return (
              <div key={s.label} className="rounded-xl p-3 text-center" style={{ background: s.bg }}>
                <div className="flex justify-center mb-1"><Icon size={14} style={{ color: s.color }} /></div>
                <div className="text-lg font-bold" style={{ color: s.color }}>{s.value}</div>
                <div className="text-xs" style={{ color: s.color, opacity: 0.75 }}>{s.label}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1 p-1 rounded-xl" style={{ background: "#F1F5F9" }}>
          {TABS.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-semibold transition-all"
                style={{
                  background: activeTab === tab.id ? "white" : "transparent",
                  color: activeTab === tab.id ? "#4338CA" : "#64748B",
                  boxShadow: activeTab === tab.id ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                }}
              >
                <Icon size={14} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {activeTab === "plan" && (
          <div className="flex gap-1 p-1 rounded-xl" style={{ background: "#F1F5F9" }}>
            {([{ id: "list", icon: List, label: "List" }, { id: "gantt", icon: BarChart2, label: "Gantt" }] as const).map(v => {
              const Icon = v.icon;
              return (
                <button
                  key={v.id}
                  onClick={() => setView(v.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                  style={{
                    background: view === v.id ? "white" : "transparent",
                    color: view === v.id ? "#4338CA" : "#64748B",
                    boxShadow: view === v.id ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                  }}
                >
                  <Icon size={13} />
                  {v.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Lifecycle Tab ────────────────────────────────────────────── */}
      {activeTab === "lifecycle" && (
        <div className="space-y-5">
          <StageProgressBar
            currentStageKey={currentStageKey}
            stageRecords={stageRecords as Array<{ stage: string; status: string }>}
            onStageClick={key => {
              setSelectedStageKey(key === selectedStageKey ? undefined : key);
            }}
            selectedStageKey={selectedStageKey}
            role={role}
          />

          <StagePanel
            projectId={projectId}
            charterId={project.charterId}
            currentStageKey={currentStageKey}
            selectedStageKey={selectedStageKey}
          />

          {/* All stages quick nav */}
          <div className="rounded-2xl p-5" style={{ background: "white", border: "1px solid #E2E8F0" }}>
            <h4 className="text-sm font-bold text-gray-700 mb-3">All Lifecycle Stages</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
              {LIFECYCLE_STAGES.map((stage, idx) => {
                const stageRecord = (stageRecords as Array<{ stage: string; status: string }>)
                  .find(r => r.stage === stage.key);
                const isComplete = stageRecord?.status === "complete" || idx < LIFECYCLE_STAGES.findIndex(s => s.key === currentStageKey);
                const isActive = stage.key === currentStageKey;
                const isSelected = stage.key === (selectedStageKey ?? currentStageKey);

                return (
                  <button
                    key={stage.key}
                    onClick={() => handleStageClick(stage.key)}
                    className="flex items-center gap-3 p-3 rounded-xl text-left transition-all hover:shadow-sm"
                    style={{
                      background: isSelected ? `${stage.color}12` : "#F8FAFC",
                      border: `1px solid ${isSelected ? stage.color + "40" : "#E2E8F0"}`,
                    }}
                  >
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                      style={{
                        background: isComplete ? "#10B981" : isActive ? stage.color : "#E2E8F0",
                        color: isComplete || isActive ? "white" : "#94A3B8",
                      }}
                    >
                      {isComplete ? "✓" : idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-800 truncate">{stage.label}</p>
                      <p className="text-xs text-gray-400 truncate">{stage.description.substring(0, 40)}...</p>
                    </div>
                    {isActive && (
                      <span className="text-xs font-bold px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: "#EEF2FF", color: "#4F46E5" }}>Active</span>
                    )}
                    {isComplete && !isActive && (
                      <CheckCircle2 size={14} className="text-emerald-500 flex-shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Plan Tab ─────────────────────────────────────────────────── */}
      {activeTab === "plan" && (
        <>
          {view === "list" && (
            <div>
              {milestones.length === 0 && tasks.length === 0 ? (
                <div className="rounded-2xl p-12 text-center" style={{ background: "white", border: "1px solid #E2E8F0" }}>
                  <Milestone size={32} className="text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-500 font-medium mb-1">No tasks yet</p>
                  <p className="text-sm text-gray-400">Add milestones and tasks to start planning your project.</p>
                </div>
              ) : (
                <HierarchyList milestones={milestones} tasks={tasks} criticalIds={criticalIds} />
              )}
            </div>
          )}

          {view === "gantt" && (
            <div className="rounded-2xl overflow-hidden" style={{ background: "white", border: "1px solid #E2E8F0" }}>
              <div className="flex items-center gap-5 px-4 py-2.5 border-b border-gray-100" style={{ background: "#F8FAFC" }}>
                <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Gantt Legend</span>
                <div className="flex items-center gap-1.5">
                  <div className="w-8 h-3 rounded" style={{ background: "#6366F1" }} />
                  <span className="text-xs text-gray-500">Task</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-8 h-3 rounded" style={{ background: "#EF4444" }} />
                  <span className="text-xs text-gray-500">Critical Path</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-8 h-3 rounded" style={{ background: "#10B981" }} />
                  <span className="text-xs text-gray-500">Completed</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-4 h-4 rotate-45" style={{ background: "#4F46E5" }} />
                  <span className="text-xs text-gray-500">Milestone</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-6 h-0.5 border-t-2 border-dashed border-red-400" />
                  <span className="text-xs text-gray-500">Today</span>
                </div>
              </div>

              {milestones.length === 0 && tasks.length === 0 ? (
                <div className="p-12 text-center text-gray-400 text-sm">
                  Add tasks with start/end dates to see the Gantt chart.
                </div>
              ) : (
                <GanttChart milestones={milestones} tasks={tasks} criticalIds={criticalIds} minDate={minDate} maxDate={maxDate} />
              )}
            </div>
          )}
        </>
      )}

      {/* ── Analytics Tab ────────────────────────────────────────────── */}
      {activeTab === "analytics" && (
        <div className="space-y-5">
          <div className="rounded-2xl p-5" style={{ background: "white", border: "1px solid #E2E8F0" }}>
            <div className="mb-4">
              <h3 className="font-semibold text-gray-900">Burndown Chart</h3>
              <p className="text-xs text-gray-400 mt-0.5">Ideal vs actual remaining work</p>
            </div>
            <div style={{ height: 300 }}>
              {burndown?.dataPoints && burndown.dataPoints.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={burndown.dataPoints} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                    <XAxis dataKey="date" tickFormatter={(v) => formatDate(v)} tick={{ fontSize: 11, fill: "#94A3B8" }} />
                    <YAxis tick={{ fontSize: 11, fill: "#94A3B8" }} />
                    <Tooltip
                      contentStyle={{ background: "#1E293B", border: "none", borderRadius: "8px", color: "white", fontSize: "12px" }}
                      labelFormatter={(v) => formatDate(v)}
                    />
                    <Legend wrapperStyle={{ fontSize: "12px" }} />
                    <Line type="monotone" dataKey="ideal" stroke="#CBD5E1" strokeDasharray="5 5" name="Ideal" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="remaining" stroke="#6366F1" name="Actual" strokeWidth={2.5} dot={{ r: 3, fill: "#6366F1" }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-gray-400 text-sm">
                  No burndown data available yet.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl p-5" style={{ background: "white", border: "1px solid #E2E8F0" }}>
            <div className="mb-4">
              <h3 className="font-semibold text-gray-900">Critical Path</h3>
              <p className="text-xs text-gray-400 mt-0.5">Tasks that directly impact the project end date</p>
            </div>
            {criticalPath?.criticalTasks?.length ? (
              <div className="space-y-2">
                {criticalPath.criticalTasks.map((t: Task, idx: number) => (
                  <div
                    key={t.id}
                    className="flex items-center gap-3 p-3 rounded-xl"
                    style={{ background: "#FEF2F2", border: "1px solid #FCA5A5" }}
                  >
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                      style={{ background: "#EF4444" }}
                    >
                      {idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-red-800">{t.name}</p>
                      <p className="text-xs text-red-500">
                        {formatDate(t.startDate)} — {formatDate(t.endDate)}
                        {t.estimatedHours != null && ` · ${t.estimatedHours}h`}
                      </p>
                    </div>
                    <StatusBadge status={t.status} />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400">No critical path computed yet.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
