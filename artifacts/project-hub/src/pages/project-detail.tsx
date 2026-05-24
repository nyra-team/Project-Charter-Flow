import { useState, useMemo, useCallback, useEffect } from "react";
import { useRoute, Link, useSearch } from "wouter";
import {
  useGetProject, useListMilestones, useListTasks,
  useGetBurndown, useGetCriticalPath, useListProjectStages, useListUsers,
  useListIssues, useUpdateProject, useListTimelogs,
  useListScoringCriteria, useListProjectScores, useCreateProjectScore, useUpdateProjectScore,
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
  ChevronLeft, BarChart2, List, Milestone as MilestoneIcon,
  Plus, CheckCircle2, Clock, AlertTriangle, Flag,
  ChevronDown, ChevronRight, Layers, XCircle,
  LayoutGrid, Kanban, Table2, Star, Users, DollarSign, FileText,
  Shield, AlertCircle, UserCheck, Zap, MessageSquare, History,
  TrendingUp, GitBranch, Calendar as CalendarIcon, Sparkles,
} from "lucide-react";
import { MessagesTab } from "../components/messages-tab";
import { AuditTab } from "../components/audit-tab";
import { BenefitsTab } from "../components/benefits-tab";
import { ChangeRequestsTab } from "../components/change-requests-tab";
import { MeetingsTab } from "../components/meetings-tab";
import { AiButton, AiResultPanel } from "../components/ai-button";
import { EffortBurnChart } from "../components/effort-burn-chart";
import { ResourceTab } from "../components/resource-tab";
import { BudgetTab } from "../components/budget-tab";
import { DocumentsTab } from "../components/documents-tab";
import { RiskTab } from "../components/risk-tab";
import { IssuesTab } from "../components/issues-tab";
import { RaciTab } from "../components/raci-tab";
import { EscalationRulesTab } from "../components/escalation-rules-tab";
import { StageProgressBar } from "../components/stage-progress-bar";
import { StagePanel } from "../components/stage-panel";
import { getCurrentStageKey, LIFECYCLE_STAGES } from "../lib/lifecycle-config";
import { useUserStore } from "../lib/store";
import { TaskGrid, type GridTask } from "../components/task-grid";
import { MilestoneGrid, type GridMilestone } from "../components/milestone-grid";
import { ConnectBoard } from "../components/connect-board";
import { ProgressTrackingPanel } from "../components/progress-tracking-panel";
import { TaskFilterBar, applyTaskFilters, type TaskFilters } from "../components/task-filter-bar";
import { getStatusMeta, fmtVariance, getPriorityMeta, TASK_PRIORITIES } from "../lib/task-constants";

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

type MilestoneRaw = {
  id: number; name: string; dueDate?: string | null; status: string;
  description?: string | null; priority?: string; rag?: string | null;
  actualStart?: string | null; actualEnd?: string | null;
  plannedEffortHours?: number | null; scheduleVarianceDays?: number | null;
  gateDecision?: string | null;
};

type TaskRaw = {
  id: number; name: string; milestoneId?: number | null; workstreamId?: number | null;
  startDate?: string | null; endDate?: string | null;
  status: string; priority: string; estimatedHours?: number | null;
  assigneeId?: number | null; assigneeName?: string | null;
  predecessorIds?: string | number[] | null;
  parentTaskId?: number | null; managerId?: number | null;
  cftOwner?: number | null; cftDept?: string | null;
  actualStart?: string | null; actualEnd?: string | null;
  scheduleVarianceDays?: number | null; plannedEffortHours?: number | null;
  rag?: string | null; isCritical?: boolean;
};

function datesForProject(project: { startDate?: string | null; endDate?: string | null }, milestones: MilestoneRaw[], tasks: TaskRaw[]) {
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

// ── Gantt SVG ────────────────────────────────────────────────────────────────
function GanttChart({
  milestones, tasks, criticalIds, minDate, maxDate,
}: {
  milestones: MilestoneRaw[]; tasks: TaskRaw[];
  criticalIds: Set<number>; minDate: Date; maxDate: Date;
}) {
  const totalDays = Math.ceil((maxDate.getTime() - minDate.getTime()) / DAY_MS);
  const svgW = totalDays * DAY_W;

  type Row = { type: "milestone"; item: MilestoneRaw } | { type: "task"; item: TaskRaw };
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
    const t = row.item as TaskRaw;
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
  rows.forEach((r, i) => { if (r.type === "task") taskRowIdx[(r.item as TaskRaw).id] = i; });
  const taskBarX: Record<number, { x: number; w: number }> = {};
  rows.forEach(r => {
    if (r.type === "task") {
      const props = rowBarProps(r);
      if (props && props.type === "task") taskBarX[(r.item as TaskRaw).id] = { x: props.x, w: props.w };
    }
  });

  const arrows: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (const row of rows) {
    if (row.type !== "task") continue;
    const t = row.item as TaskRaw;
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
    <div className="flex bg-card text-foreground" style={{ height: svgH + 2, overflow: "hidden" }}>
      <div className="flex-shrink-0 border-r border-border/60" style={{ width: LEFT_W, minWidth: LEFT_W, height: svgH }}>
        <div className="flex items-center px-4 border-b border-border/60 bg-muted/40" style={{ height: 56 }}>
          <span className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-wider">Task / Milestone</span>
        </div>
        {rows.map((row, i) => (
          <div
            key={`${row.type}-${row.item.id}`}
            className={`flex items-center border-b border-border/30 ${i % 2 === 0 ? "bg-card" : "bg-muted/20"}`}
            style={{ height: ROW_H, paddingLeft: row.type === "task" ? 28 : 12 }}
          >
            {row.type === "milestone" ? (
              <div className="flex items-center gap-1.5">
                <Flag size={12} className="text-primary flex-shrink-0" />
                <span className="text-xs font-semibold text-foreground truncate">{row.item.name}</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 w-full">
                <div
                  className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    criticalIds.has((row.item as TaskRaw).id) ? "bg-destructive"
                    : row.item.status === "completed" ? "bg-success" : "bg-primary"
                  }`}
                />
                <span className="text-xs text-foreground truncate">{row.item.name}</span>
                {(row.item as TaskRaw).assigneeName && (
                  <span className="text-[11px] text-muted-foreground ml-auto pr-2 flex-shrink-0 hidden xl:block font-mono">
                    {(row.item as TaskRaw).assigneeName}
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
            <rect key={`bg-${i}`} x={0} y={56 + i * ROW_H} width={svgW} height={ROW_H} fill={i % 2 === 0 ? "hsl(var(--card))" : "hsl(var(--muted) / 0.25)"} />
          ))}
          {weeks.map((w, i) => (
            <g key={i}>
              <rect x={w.x} y={0} width={w.w} height={56} fill={i % 2 === 0 ? "hsl(var(--muted) / 0.4)" : "hsl(var(--muted) / 0.6)"} />
              <line x1={w.x} y1={0} x2={w.x} y2={svgH} stroke="hsl(var(--border))" strokeWidth={1} />
              <text x={w.x + w.w / 2} y={34} textAnchor="middle" fontSize={10} fill="hsl(var(--muted-foreground))" fontWeight={600}>{w.label}</text>
            </g>
          ))}
          <line x1={0} y1={56} x2={svgW} y2={56} stroke="hsl(var(--border))" strokeWidth={1} />
          {todayX >= 0 && todayX <= svgW && (
            <g>
              <line x1={todayX} y1={0} x2={todayX} y2={svgH} stroke="hsl(var(--destructive))" strokeWidth={1.5} strokeDasharray="4 3" opacity={0.7} />
              <rect x={todayX - 16} y={2} width={32} height={14} rx={3} fill="hsl(var(--destructive))" opacity={0.9} />
              <text x={todayX} y={12} textAnchor="middle" fontSize={8} fill="hsl(var(--primary-foreground))" fontWeight={700}>TODAY</text>
            </g>
          )}
          <defs>
            <marker id="arrowhead" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 Z" fill="hsl(var(--muted-foreground))" />
            </marker>
          </defs>
          {arrows.map((a, i) => {
            const mx = (a.x1 + a.x2) / 2;
            const dPath = `M${a.x1},${a.y1} C${mx},${a.y1} ${mx},${a.y2} ${a.x2},${a.y2}`;
            return <path key={i} d={dPath} fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth={1.5} markerEnd="url(#arrowhead)" opacity={0.6} />;
          })}
          {rows.map((row, i) => {
            const bp = rowBarProps(row);
            if (!bp) return null;
            const y = 56 + i * ROW_H;
            const isCritical = row.type === "task" && criticalIds.has((row.item as TaskRaw).id);
            const isDone = row.item.status === "completed";
            if (bp.type === "milestone") {
              const size = 9;
              return (
                <g key={`bar-${i}`}>
                  <polygon
                    points={`${bp.cx},${y + ROW_H / 2 - size} ${bp.cx + size},${y + ROW_H / 2} ${bp.cx},${y + ROW_H / 2 + size} ${bp.cx - size},${y + ROW_H / 2}`}
                    fill="hsl(var(--primary))" opacity={0.9}
                  />
                </g>
              );
            }
            const { x: bx, w: bw } = bp as { x: number; w: number; type: "task" };
            const barH = 18;
            const by = y + (ROW_H - barH) / 2;
            const barFill = isDone
              ? "hsl(var(--success))"
              : isCritical
              ? "hsl(var(--destructive))"
              : row.item.status === "blocked"
              ? "hsl(var(--warn))"
              : "hsl(var(--primary))";
            return (
              <g key={`bar-${i}`}>
                <rect x={bx} y={by} width={bw} height={barH} rx={4} fill={barFill} opacity={isDone ? 0.6 : 0.85} />
                {bw > 40 && (
                  <text x={bx + 6} y={by + 12} fontSize={9} fill="hsl(var(--primary-foreground))" fontWeight={600}>
                    {row.item.name.substring(0, Math.floor(bw / 8))}
                  </text>
                )}
                {isCritical && <rect x={bx} y={by + barH - 3} width={bw} height={3} rx={0} fill="hsl(var(--destructive))" opacity={0.8} />}
              </g>
            );
          })}
        </svg>
      </div>
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
  nfaChain: string[];
}

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

  useEffect(() => {
    if (status?.triggered && !status.nfaChainExists) {
      fetch(`/api/projects/${projectId}/nfa-trigger`, { method: "POST" })
        .then(r => r.json())
        .then(result => {
          const r = result as { created?: boolean; chainLength?: number };
          if (r.created) {
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

  const [activeTab, setActiveTab] = useState<"lifecycle" | "grid" | "gantt" | "board" | "resources" | "budget" | "documents" | "risks" | "issues" | "raci" | "escalation" | "messages" | "audit" | "analytics" | "scoring" | "meetings" | "changes" | "benefits">("lifecycle");
  const [aiSummary, setAiSummary] = useState<{ summary?: string; highlights?: string[]; concerns?: string[] } | null>(null);
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);
  const [aiSummaryError, setAiSummaryError] = useState<string | null>(null);
  const [gridSubTab, setGridSubTab] = useState<"tasks" | "milestones">("tasks");
  const [selectedStageKey, setSelectedStageKey] = useState<string | undefined>(undefined);

  // Sync activeTab / gridSubTab from ?tab= query string so stage-section deep-links work.
  const search = useSearch();
  useEffect(() => {
    const params = new URLSearchParams(search);
    const tab = params.get("tab");
    if (!tab) return;
    if (tab === "milestones") { setActiveTab("grid"); setGridSubTab("milestones"); return; }
    if (tab === "tasks") { setActiveTab("grid"); setGridSubTab("tasks"); return; }
    const allowed = ["lifecycle","grid","gantt","board","resources","budget","documents","risks","issues","raci","escalation","messages","audit","analytics","scoring","meetings","changes","benefits"] as const;
    if ((allowed as readonly string[]).includes(tab)) setActiveTab(tab as typeof allowed[number]);
  }, [search]);
  const [nfaDismissed, setNfaDismissed] = useState(false);
  const [selectedBoardTaskId, setSelectedBoardTaskId] = useState<number | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  // Filters
  const [taskFilters, setTaskFilters] = useState<TaskFilters>({ search: "", status: "", priority: "", rag: "", dateFrom: "", dateTo: "" });
  const [ownerFilter, setOwnerFilter] = useState("");

  const { data: project, isLoading: loadingProject, refetch: refetchProject } = useGetProject(projectId);
  const { data: rawMilestones, refetch: refetchMilestones } = useListMilestones(projectId);
  const { data: rawTasks, refetch: refetchTasks } = useListTasks(projectId);
  const updateProject = useUpdateProject();
  const { data: burndown } = useGetBurndown(projectId);
  const { data: criticalPath } = useGetCriticalPath(projectId);
  const { data: stageRecords = [] } = useListProjectStages(projectId);
  const { data: users = [] } = useListUsers();
  const { data: projectIssues = [] } = useListIssues(projectId);
  const { data: selectedTaskTimelogs = [] } = useListTimelogs(selectedBoardTaskId ?? 0);
  const { data: scoringCriteria = [] } = useListScoringCriteria();
  const { data: projectScores = [], refetch: refetchScores } = useListProjectScores(projectId);
  const createScore = useCreateProjectScore();
  const updateScore = useUpdateProjectScore();

  const nfaStatus = useNFAStatus(projectId);

  const milestones: MilestoneRaw[] = (rawMilestones ?? []) as MilestoneRaw[];
  const tasks: TaskRaw[] = (rawTasks ?? []) as TaskRaw[];
  const criticalIds = useMemo(() => new Set<number>((criticalPath?.criticalTasks ?? []).map((t: { id: number }) => t.id)), [criticalPath]);

  const { min: minDate, max: maxDate } = useMemo(() => datesForProject(project ?? {}, milestones, tasks), [project, milestones, tasks]);

  const totalTasks = tasks.filter(t => !t.parentTaskId).length;
  const completedTasks = tasks.filter(t => t.status === "completed" && !t.parentTaskId).length;
  const blockedTasks = tasks.filter(t => (t.status === "delayed" || t.status === "at_risk") && !t.parentTaskId).length;
  const inProgressTasks = tasks.filter(t => t.status === "in_progress" && !t.parentTaskId).length;

  const currentStageKey = useMemo(
    () => getCurrentStageKey(project?.stage, stageRecords as Array<{ stage: string; status: string }>),
    [project?.stage, stageRecords]
  );

  const handleStageClick = useCallback((key: string) => {
    setSelectedStageKey(key);
    setActiveTab("lifecycle");
  }, []);

  function handleRefresh() {
    refetchTasks();
    refetchMilestones();
    setLastUpdated(new Date());
  }

  const usersArr = users as Array<{ id: number; name: string }>;

  const filteredTasks = useMemo(() => {
    const top = tasks.filter(t => !t.parentTaskId);
    return applyTaskFilters(top, taskFilters, ownerFilter);
  }, [tasks, taskFilters, ownerFilter]);

  // Include subtasks of filtered tasks
  const filteredTasksWithSubs = useMemo(() => {
    const topIds = new Set(filteredTasks.map(t => t.id));
    const subs = tasks.filter(t => t.parentTaskId && topIds.has(t.parentTaskId));
    return [...filteredTasks, ...subs];
  }, [filteredTasks, tasks]);

  if (loadingProject) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 rounded-2xl" />
        <Skeleton className="h-48 rounded-2xl" />
      </div>
    );
  }
  if (!project) return <div className="text-center py-16 text-muted-foreground">Project not found</div>;

  const TABS = [
    { id: "lifecycle" as const, label: "Lifecycle", icon: Layers },
    { id: "grid" as const, label: "Grid", icon: Table2 },
    { id: "gantt" as const, label: "Gantt", icon: BarChart2 },
    { id: "board" as const, label: "Board", icon: Kanban },
    { id: "resources" as const, label: "Resources", icon: Users },
    { id: "budget" as const, label: "Budget", icon: DollarSign },
    { id: "documents" as const, label: "Documents", icon: FileText },
    { id: "risks" as const, label: "Risks", icon: Shield },
    { id: "issues" as const, label: "Issues", icon: AlertCircle },
    { id: "raci" as const, label: "RACI", icon: UserCheck },
    { id: "escalation" as const, label: "Escalation", icon: Zap },
    { id: "meetings" as const, label: "Meetings", icon: CalendarIcon },
    { id: "changes" as const, label: "Changes", icon: GitBranch },
    { id: "benefits" as const, label: "Benefits", icon: TrendingUp },
    { id: "messages" as const, label: "Messages", icon: MessageSquare },
    { id: "audit" as const, label: "Audit", icon: History },
    { id: "analytics" as const, label: "Analytics", icon: LayoutGrid },
    { id: "scoring" as const, label: "Scoring", icon: Star },
  ];

  return (
    <div className="space-y-5">
      {/* Back */}
      <Link href="/projects">
        <button className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft size={15} />
          Back to Projects
        </button>
      </Link>

      {/* NFA Budget Overrun Alert */}
      {nfaStatus?.triggered && !nfaDismissed && (
        <div className="glass-surface lift-card ph-rise rounded-2xl p-4 flex items-start gap-3 border-warn/30 bg-warn/5">
          <AlertTriangle size={18} className="text-warn flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-foreground tracking-tight">NFA Budget Overrun Triggered</p>
            <p className="text-xs text-muted-foreground mt-1">
              Actual budget has exceeded the baseline by <strong className="text-warn">{nfaStatus.overrunPct.toFixed(1)}%</strong>
              {" "}(threshold: {nfaStatus.threshold}%).
              An NFA approval workflow has been automatically triggered.
              Routing to: <span className="font-mono text-foreground">{nfaStatus.nfaChain.join(" → ")}</span>.
            </p>
          </div>
          <button
            onClick={() => setNfaDismissed(true)}
            className="text-muted-foreground hover:text-foreground flex-shrink-0 transition-colors"
          >
            <XCircle size={16} />
          </button>
        </div>
      )}

      {/* Header */}
      <div className="glass-surface lift-card ph-rise rounded-2xl p-6 relative overflow-hidden">
        <span aria-hidden className="pointer-events-none absolute bottom-0 left-6 right-6 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-foreground tracking-tight">{project.name}</h1>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <StatusBadge status={project.status} />
              {project.startDate && (
                <span className="text-[11px] font-mono text-muted-foreground">
                  {formatDate(project.startDate)} — {formatDate(project.endDate)}
                </span>
              )}
              {project.stage && (
                <span className="inline-flex items-center text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-sm border bg-primary/10 text-primary border-primary/20 font-semibold">
                  {LIFECYCLE_STAGES.find(s => s.key === currentStageKey)?.label ?? currentStageKey}
                </span>
              )}
              {/* Project-level Priority — inline editable */}
              {(() => {
                const rawPriority = (project as { priority?: string }).priority ?? "P2";
                const priMeta = getPriorityMeta(rawPriority);
                return (
                  <div className="relative group inline-flex items-center">
                    <select
                      value={rawPriority}
                      onChange={e => {
                        updateProject.mutate(
                          { id: projectId, data: { priority: e.target.value } },
                          { onSuccess: () => refetchProject() }
                        );
                      }}
                      className="text-[10px] font-mono uppercase tracking-wider font-semibold px-2 py-0.5 rounded-sm border-0 outline-none appearance-none cursor-pointer pr-5"
                      style={{ background: priMeta.bg, color: priMeta.color }}
                      title="Project priority"
                    >
                      {TASK_PRIORITIES.map(p => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                      ))}
                    </select>
                    <span className="pointer-events-none absolute right-1.5 opacity-60" style={{ fontSize: 9 }}>▾</span>
                  </div>
                );
              })()}
            </div>
            {project.description && (
              <p className="text-sm text-muted-foreground mt-2 max-w-2xl leading-relaxed">{project.description}</p>
            )}
          </div>
          <Link href={`/projects/${project.id}/tasks/new`}>
            <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm flex-shrink-0">
              <Plus size={14} />
              Add Task
            </button>
          </Link>
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5 stagger-children">
          {([
            { label: "Total Tasks",     value: totalTasks,      icon: List,          tone: "primary" as const },
            { label: "Completed",       value: completedTasks,  icon: CheckCircle2,  tone: "success" as const },
            { label: "In Progress",     value: inProgressTasks, icon: Clock,         tone: "info"    as const },
            { label: "At Risk/Delayed", value: blockedTasks,    icon: AlertTriangle, tone: "warn"    as const },
          ]).map(s => {
            const Icon = s.icon;
            const toneClasses = {
              primary: { wrap: "bg-primary/10 border-primary/20",         text: "text-primary"     },
              success: { wrap: "bg-success/10 border-success/20",         text: "text-success"     },
              info:    { wrap: "bg-primary/10 border-primary/20",         text: "text-primary"     },
              warn:    { wrap: "bg-warn/10 border-warn/20",               text: "text-warn"        },
            }[s.tone];
            return (
              <div key={s.label} className={`rounded-xl p-3 border ${toneClasses.wrap}`}>
                <div className="flex items-center justify-between mb-1.5">
                  <Icon size={14} className={toneClasses.text} />
                  <span className={`text-[10px] font-mono uppercase tracking-wider font-semibold opacity-80 ${toneClasses.text}`}>{s.label}</span>
                </div>
                <div className={`text-2xl font-semibold font-mono num-tabular tracking-tight ${toneClasses.text}`}>{s.value}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-2 overflow-x-auto scrollbar-thin">
        <div className="flex gap-1 p-1 rounded-xl bg-muted/60 border border-border backdrop-blur-sm">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-all whitespace-nowrap ${
                  active
                    ? "bg-card text-primary shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon size={14} />
                {tab.label}
              </button>
            );
          })}
        </div>
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
          <div className="glass-surface lift-card rounded-2xl p-5 ph-rise relative overflow-hidden">
            <span aria-hidden className="pointer-events-none absolute bottom-0 left-5 right-5 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-primary/10 border border-primary/20">
                <Layers size={18} className="text-primary" />
              </div>
              <div>
                <h4 className="text-[14px] font-semibold text-foreground tracking-tight">All Lifecycle Stages</h4>
                <p className="text-[11px] text-muted-foreground mt-0.5">15-stage governance flow · click to inspect</p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2 stagger-children">
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
                    className={`flex items-center gap-3 p-3 rounded-xl text-left transition-all border ${
                      isSelected
                        ? "bg-primary/5 border-primary/30 shadow-sm"
                        : "bg-muted/40 border-border hover:bg-accent/40 hover:border-border"
                    }`}
                  >
                    <div
                      className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold font-mono flex-shrink-0 ${
                        isComplete
                          ? "bg-success text-primary-foreground"
                          : isActive
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground border border-border"
                      }`}
                    >
                      {isComplete ? "✓" : idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-foreground truncate">{stage.label}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{stage.description.substring(0, 40)}...</p>
                    </div>
                    {isActive && (
                      <span className="text-[10px] font-mono uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded-sm border bg-primary/10 text-primary border-primary/20 flex-shrink-0">Active</span>
                    )}
                    {isComplete && !isActive && (
                      <CheckCircle2 size={14} className="text-success flex-shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Grid Tab ─────────────────────────────────────────────────── */}
      {activeTab === "grid" && (
        <div className="space-y-4">
          {/* Grid sub-tab: Tasks vs Milestones */}
          <div className="flex items-center gap-3">
            <div className="flex gap-1 p-1 rounded-xl bg-muted/60 border border-border backdrop-blur-sm">
              {([
                { id: "tasks" as const, label: "Tasks & Subtasks" },
                { id: "milestones" as const, label: "Milestones" },
              ]).map(sub => {
                const active = gridSubTab === sub.id;
                return (
                  <button
                    key={sub.id}
                    onClick={() => setGridSubTab(sub.id)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                      active ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {sub.label}
                  </button>
                );
              })}
            </div>
            <span className="text-[11px] text-muted-foreground font-mono">
              {gridSubTab === "tasks"
                ? `${filteredTasks.length} task${filteredTasks.length !== 1 ? "s" : ""}`
                : `${milestones.length} milestone${milestones.length !== 1 ? "s" : ""}`}
            </span>
          </div>

          {/* Filter bar */}
          <div className="glass-surface lift-card ph-rise rounded-2xl px-4 py-2">
            <TaskFilterBar
              filters={taskFilters}
              onChange={setTaskFilters}
              owners={usersArr}
              ownerFilter={ownerFilter}
              onOwnerChange={setOwnerFilter}
            />
          </div>

          {/* Progress panel */}
          <ProgressTrackingPanel milestones={milestones} tasks={tasks} lastUpdated={lastUpdated} />

          {/* Grid view */}
          {gridSubTab === "tasks" && (
            <TaskGrid
              tasks={filteredTasksWithSubs as GridTask[]}
              projectId={projectId}
              onRefresh={handleRefresh}
              users={usersArr}
            />
          )}

          {gridSubTab === "milestones" && (
            <MilestoneGrid
              milestones={milestones as GridMilestone[]}
              tasks={tasks}
              projectId={projectId}
              onRefresh={handleRefresh}
              users={usersArr}
            />
          )}
        </div>
      )}

      {/* ── Gantt Tab ────────────────────────────────────────────────── */}
      {activeTab === "gantt" && (
        <div className="glass-surface lift-card rounded-2xl overflow-hidden ph-rise">
          <div className="flex items-center gap-5 px-4 py-2.5 border-b border-border/60 bg-muted/40 flex-wrap">
            <span className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-wider">Gantt Legend</span>
            {[
              { cls: "bg-primary",     label: "Task" },
              { cls: "bg-destructive", label: "Critical Path" },
              { cls: "bg-success",     label: "Completed" },
            ].map(l => (
              <div key={l.label} className="flex items-center gap-1.5">
                <div className={`w-8 h-3 rounded ${l.cls}`} />
                <span className="text-[11px] text-muted-foreground">{l.label}</span>
              </div>
            ))}
            <div className="flex items-center gap-1.5">
              <div className="w-4 h-4 rotate-45 bg-primary" />
              <span className="text-[11px] text-muted-foreground">Milestone</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-6 h-0.5 border-t-2 border-dashed border-destructive/70" />
              <span className="text-[11px] text-muted-foreground">Today</span>
            </div>
          </div>

          {milestones.length === 0 && tasks.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground text-sm">
              Add tasks with start/end dates to see the Gantt chart.
            </div>
          ) : (
            <GanttChart milestones={milestones} tasks={tasks} criticalIds={criticalIds} minDate={minDate} maxDate={maxDate} />
          )}
        </div>
      )}

      {/* ── Board Tab ────────────────────────────────────────────────── */}
      {activeTab === "board" && (
        <div className="space-y-4">
          <div className="glass-surface lift-card ph-rise rounded-2xl px-4 py-2">
            <div className="flex items-center justify-between py-1">
              <p className="text-[11px] text-muted-foreground">Drag cards between columns to update status. Milestones shown as <span className="font-semibold text-foreground">[M]</span> cards.</p>
              <span className="text-[11px] text-muted-foreground font-mono">{tasks.filter(t => !t.parentTaskId).length + milestones.length} items</span>
            </div>
          </div>
          <ConnectBoard
            tasks={tasks as Parameters<typeof ConnectBoard>[0]["tasks"]}
            milestones={milestones as Parameters<typeof ConnectBoard>[0]["milestones"]}
            projectId={projectId}
            onRefresh={handleRefresh}
            onTaskClick={taskId => {
              setSelectedBoardTaskId(taskId);
            }}
          />

          {/* Task Detail Drawer */}
          {selectedBoardTaskId !== null && (() => {
            const t = tasks.find(x => x.id === selectedBoardTaskId);
            if (!t) return null;
            const ownerName = usersArr.find(u => u.id === t.assigneeId)?.name;
            const managerName = usersArr.find(u => u.id === t.managerId)?.name;
            return (
              <div
                className="fixed inset-0 z-50 flex justify-end"
                onClick={() => setSelectedBoardTaskId(null)}
              >
                <div
                  className="relative w-full max-w-sm bg-card h-full shadow-2xl overflow-y-auto border-l border-border"
                  onClick={e => e.stopPropagation()}
                >
                  <div className="px-5 py-4 border-b border-border/60 flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-primary uppercase tracking-wider mb-1">Task Detail</p>
                      <h2 className="font-bold text-foreground text-base leading-tight">{t.name}</h2>
                    </div>
                    <button
                      onClick={() => setSelectedBoardTaskId(null)}
                      className="text-muted-foreground hover:text-foreground flex-shrink-0 mt-0.5"
                    >
                      <XCircle size={18} />
                    </button>
                  </div>
                  <div className="px-5 py-4 space-y-3 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-muted-foreground w-20">Status</span>
                      <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{
                        background: getStatusMeta(t.status).bg, color: getStatusMeta(t.status).color
                      }}>{getStatusMeta(t.status).label}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-muted-foreground w-20">Priority</span>
                      <span className="text-xs text-foreground">{t.priority}</span>
                    </div>
                    {ownerName && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-muted-foreground w-20">Owner</span>
                        <span className="text-xs text-foreground">{ownerName}</span>
                      </div>
                    )}
                    {managerName && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-muted-foreground w-20">Manager</span>
                        <span className="text-xs text-foreground">{managerName}</span>
                      </div>
                    )}
                    {t.startDate && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-muted-foreground w-20">Start</span>
                        <span className="text-xs text-foreground">{formatDate(t.startDate)}</span>
                      </div>
                    )}
                    {t.endDate && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-muted-foreground w-20">Due</span>
                        <span className="text-xs text-foreground">{formatDate(t.endDate)}</span>
                      </div>
                    )}
                    {t.cftDept && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-muted-foreground w-20">CFT Team</span>
                        <span className="text-xs text-foreground">{t.cftDept}</span>
                      </div>
                    )}
                    {t.scheduleVarianceDays != null && t.scheduleVarianceDays !== 0 && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-muted-foreground w-20">Variance</span>
                        <span className="text-xs font-semibold" style={{ color: fmtVariance(t.scheduleVarianceDays).color }}>
                          {fmtVariance(t.scheduleVarianceDays).text}
                        </span>
                      </div>
                    )}
                    {t.isCritical && (
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono uppercase tracking-wider font-semibold px-2 py-0.5 rounded-sm border bg-destructive/10 text-destructive border-destructive/20">
                          Critical Path
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Issues section */}
                  {(() => {
                    const taskIssues = (projectIssues as Array<{
                      id: number; title: string; status: string;
                      dependencyType?: string | null;
                      blockingOwnerId?: number | null;
                      originalDeadline?: string | null;
                      proposedRevisedDeadline?: string | null;
                      taskId?: number | null;
                    }>).filter(i => i.taskId === selectedBoardTaskId);
                    if (!taskIssues.length) return null;
                    return (
                      <div className="mt-4 pt-4 border-t border-border/60">
                        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">
                          Issues ({taskIssues.length})
                        </p>
                        <div className="space-y-2">
                          {taskIssues.map(issue => {
                            const isOpen = issue.status !== "resolved";
                            const blockingOwner = usersArr.find(u => u.id === issue.blockingOwnerId)?.name;
                            return (
                              <div
                                key={issue.id}
                                className={`rounded-lg p-2.5 space-y-1 border ${
                                  isOpen
                                    ? "bg-warn/10 border-warn/30"
                                    : "bg-success/10 border-success/30"
                                }`}
                              >
                                <div className="flex items-start gap-1.5">
                                  <AlertTriangle size={11} className={isOpen ? "text-warn" : "text-success"} style={{ flexShrink: 0, marginTop: 1 }} />
                                  <p className="text-xs font-semibold text-foreground flex-1 leading-tight">{issue.title}</p>
                                </div>
                                {issue.dependencyType && (
                                  <p className="text-xs text-muted-foreground pl-4">Type: <b>{issue.dependencyType}</b></p>
                                )}
                                {blockingOwner && (
                                  <p className="text-xs text-muted-foreground pl-4">Blocking: <b>{blockingOwner}</b></p>
                                )}
                                {issue.proposedRevisedDeadline && (
                                  <p className="text-xs text-warn pl-4">Proposed deadline: <b>{formatDate(issue.proposedRevisedDeadline)}</b></p>
                                )}
                                <p className={`text-xs pl-4 font-medium ${isOpen ? "text-destructive" : "text-success"}`}>
                                  {issue.status.charAt(0).toUpperCase() + issue.status.slice(1)}
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Time Logs section */}
                  {(() => {
                    const logs = (selectedTaskTimelogs as Array<{
                      id: number; date: string; hours: number; note?: string | null; userName?: string | null;
                    }>);
                    const totalLogged = logs.reduce((s, l) => s + l.hours, 0);
                    const planned = (t as { plannedEffortHours?: number | null }).plannedEffortHours ?? 0;
                    return (
                      <div className="mt-4 pt-4 border-t border-border/60">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                            <Clock size={10} /> Time Logged
                          </p>
                          {totalLogged > 0 && (
                            <span className="text-[10px] font-mono uppercase tracking-wider font-semibold px-2 py-0.5 rounded-sm border bg-primary/10 text-primary border-primary/20">
                              {totalLogged.toFixed(1)}h{planned > 0 ? ` / ${planned}h` : ""}
                            </span>
                          )}
                        </div>
                        {planned > 0 && totalLogged > 0 && (
                          <div className="w-full rounded-full overflow-hidden mb-2 bg-primary/15" style={{ height: 4 }}>
                            <div
                              className={`h-full rounded-full ${totalLogged > planned ? "bg-destructive" : "bg-primary"}`}
                              style={{ width: `${Math.min(100, Math.round((totalLogged / planned) * 100))}%` }}
                            />
                          </div>
                        )}
                        {logs.length === 0 ? (
                          <p className="text-xs text-muted-foreground italic">No time logged yet.</p>
                        ) : (
                          <div className="space-y-1.5">
                            {logs.map(log => (
                              <div key={log.id} className="flex items-start gap-2 rounded-lg px-2.5 py-2 bg-muted/40 border border-border">
                                <span className="text-xs font-bold text-primary flex-shrink-0">{log.hours.toFixed(1)}h</span>
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs text-muted-foreground">{formatDate(log.date)}{log.userName ? ` · ${log.userName}` : ""}</p>
                                  {log.note && <p className="text-xs text-muted-foreground truncate" title={log.note}>{log.note}</p>}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ── Resources Tab ────────────────────────────────────────────── */}
      {activeTab === "resources" && (
        <ResourceTab
          projectId={projectId}
          projectStartDate={project.startDate}
          projectEndDate={project.endDate}
        />
      )}

      {/* ── Budget Tab ───────────────────────────────────────────────── */}
      {activeTab === "budget" && (
        <BudgetTab
          projectId={projectId}
          budgetThresholdPct={Number((project as { budgetThresholdPct?: number }).budgetThresholdPct ?? 10)}
        />
      )}

      {/* ── Documents Tab ────────────────────────────────────────────── */}
      {activeTab === "documents" && (
        <DocumentsTab projectId={projectId} />
      )}

      {/* ── Risks Tab ────────────────────────────────────────────────── */}
      {activeTab === "risks" && (
        <RiskTab projectId={projectId} charterId={(project as { charterId?: number }).charterId ?? null} />
      )}

      {/* ── Issues Tab ───────────────────────────────────────────────── */}
      {activeTab === "issues" && (
        <IssuesTab projectId={projectId} />
      )}

      {/* ── RACI Tab ─────────────────────────────────────────────────── */}
      {activeTab === "raci" && (
        <RaciTab projectId={projectId} />
      )}

      {/* ── Escalation Rules Tab ─────────────────────────────────────── */}
      {activeTab === "escalation" && (
        <EscalationRulesTab projectId={projectId} />
      )}

      {activeTab === "meetings" && <MeetingsTab projectId={projectId} />}
      {activeTab === "changes" && <ChangeRequestsTab projectId={projectId} currentStage={currentStageKey} />}
      {activeTab === "benefits" && <BenefitsTab projectId={projectId} />}
      {activeTab === "messages" && <MessagesTab projectId={projectId} />}
      {activeTab === "audit" && <AuditTab projectId={projectId} />}

      {/* ── Analytics Tab ────────────────────────────────────────────── */}
      {activeTab === "analytics" && (
        <div className="space-y-5">
          <div className="glass-surface lift-card rounded-2xl p-5 ph-rise relative overflow-hidden">
            <span aria-hidden className="pointer-events-none absolute bottom-0 left-5 right-5 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-gradient-to-br from-primary/20 to-primary/10 border border-primary/20">
                  <Sparkles size={18} className="text-primary" />
                </div>
                <div>
                  <h3 className="text-[14px] font-semibold text-foreground tracking-tight">AI Project Summary</h3>
                  <p className="text-[11px] text-muted-foreground mt-0.5">One-click executive briefing from all signals</p>
                </div>
              </div>
              <AiButton
                label="Generate Summary"
                endpoint={`/api/ai/projects/${projectId}/dashboard-summary`}
                variant="primary"
                size="md"
                onResult={(d) => {
                  const raw = d as { headline?: string; summary?: string; key_wins?: string[]; highlights?: string[]; key_concerns?: string[]; concerns?: string[]; decisions_needed?: string[]; next_two_weeks?: string[] };
                  setAiSummary({
                    summary: raw.headline ?? raw.summary,
                    highlights: raw.key_wins ?? raw.highlights ?? [],
                    concerns: [...(raw.key_concerns ?? raw.concerns ?? []), ...(raw.decisions_needed?.map(d => `Decision needed: ${d}`) ?? [])],
                  });
                  setAiSummaryError(null); setAiSummaryLoading(false);
                }}
              >
                {({ run, loading, error }) => (
                  <button
                    onClick={() => { setAiSummaryLoading(true); run(); }}
                    disabled={loading}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold text-primary-foreground bg-primary hover:bg-primary/90 disabled:opacity-50 shadow-sm transition-all"
                  >
                    <Sparkles size={12} />
                    {loading || aiSummaryLoading ? "Thinking…" : "Generate Summary"}
                    {error && <span className="text-primary-foreground/70 text-xs ml-1">!</span>}
                  </button>
                )}
              </AiButton>
            </div>
            {aiSummaryError && <div className="mt-3 text-xs text-destructive">{aiSummaryError}</div>}
            {aiSummary && (
              <div className="mt-4 space-y-3 text-sm">
                {aiSummary.summary && <p className="text-foreground leading-relaxed">{aiSummary.summary}</p>}
                <div className="grid grid-cols-2 gap-3">
                  {aiSummary.highlights?.length ? (
                    <div className="rounded-lg bg-success/5 p-3 border border-success/20">
                      <div className="text-[10px] font-mono uppercase tracking-wider font-semibold text-success mb-1.5">Highlights</div>
                      <ul className="list-disc pl-4 text-xs space-y-0.5 text-foreground">{aiSummary.highlights.map((h, i) => <li key={i}>{h}</li>)}</ul>
                    </div>
                  ) : null}
                  {aiSummary.concerns?.length ? (
                    <div className="rounded-lg bg-destructive/5 p-3 border border-destructive/20">
                      <div className="text-[10px] font-mono uppercase tracking-wider font-semibold text-destructive mb-1.5">Concerns</div>
                      <ul className="list-disc pl-4 text-xs space-y-0.5 text-foreground">{aiSummary.concerns.map((h, i) => <li key={i}>{h}</li>)}</ul>
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </div>
          <ProgressTrackingPanel milestones={milestones} tasks={tasks} lastUpdated={lastUpdated} />
          <EffortBurnChart projectId={projectId} />

          <div className="glass-surface lift-card rounded-2xl p-5 ph-rise relative overflow-hidden">
            <span aria-hidden className="pointer-events-none absolute bottom-0 left-5 right-5 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-primary/10 border border-primary/20">
                <TrendingUp size={18} className="text-primary" />
              </div>
              <div>
                <h3 className="text-[14px] font-semibold text-foreground tracking-tight">Burndown Chart</h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">Ideal vs actual remaining work</p>
              </div>
            </div>
            <div style={{ height: 300 }}>
              {burndown?.dataPoints && burndown.dataPoints.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={burndown.dataPoints} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tickFormatter={(v) => formatDate(v)} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                    <Tooltip
                      contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--popover-border))", borderRadius: "8px", color: "hsl(var(--popover-foreground))", fontSize: "12px" }}
                      labelFormatter={(v) => formatDate(v)}
                    />
                    <Legend wrapperStyle={{ fontSize: "12px" }} />
                    <Line type="monotone" dataKey="ideal" stroke="hsl(var(--muted-foreground))" strokeDasharray="5 5" name="Ideal" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="remaining" stroke="hsl(var(--primary))" name="Actual" strokeWidth={2.5} dot={{ r: 3, fill: "hsl(var(--primary))" }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                  No burndown data available yet.
                </div>
              )}
            </div>
          </div>

          <div className="glass-surface lift-card rounded-2xl p-5 ph-rise relative overflow-hidden">
            <span aria-hidden className="pointer-events-none absolute bottom-0 left-5 right-5 h-px bg-gradient-to-r from-transparent via-destructive/40 to-transparent" />
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-destructive/10 border border-destructive/20">
                <Zap size={18} className="text-destructive" />
              </div>
              <div>
                <h3 className="text-[14px] font-semibold text-foreground tracking-tight">Critical Path</h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">Tasks that directly impact the project end date</p>
              </div>
            </div>
            {criticalPath?.criticalTasks?.length ? (
              <div className="space-y-2 stagger-children">
                {criticalPath.criticalTasks.map((t: TaskRaw, idx: number) => (
                  <div
                    key={t.id}
                    className="flex items-center gap-3 p-3 rounded-xl bg-destructive/5 border border-destructive/20"
                  >
                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold font-mono text-primary-foreground flex-shrink-0 bg-destructive">
                      {idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">{t.name}</p>
                      <p className="text-[11px] text-muted-foreground font-mono">
                        {formatDate(t.startDate)} — {formatDate(t.endDate)}
                        {t.estimatedHours != null && ` · ${t.estimatedHours}h`}
                      </p>
                    </div>
                    <StatusBadge status={t.status} />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No critical path computed yet.</p>
            )}
          </div>
        </div>
      )}

      {/* ── Scoring Tab ───────────────────────────────────────────────── */}
      {activeTab === "scoring" && (() => {
        const isPMORole = ["pmo", "executive_director", "chairman"].includes(role);
        const criteria = scoringCriteria as Array<{ id: number; name: string; weightPct: number; description?: string | null }>;
        const scores = projectScores as Array<{ id: number; criterionId: number; score: number; weightedScore: number }>;
        const scoreMap = Object.fromEntries(scores.map(s => [s.criterionId, s]));
        const weightedTotal = scores.reduce((sum, s) => sum + Number(s.weightedScore ?? 0), 0);

        async function handleSaveScore(criterionId: number, score: number) {
          const existing = scoreMap[criterionId];
          if (existing) {
            await updateScore.mutateAsync({ id: existing.id, data: { score } });
          } else {
            await createScore.mutateAsync({ id: projectId, data: { criterionId, score } });
          }
          refetchScores();
        }

        return (
          <div className="space-y-4">
            <div className="glass-surface lift-card rounded-2xl p-5 flex items-center justify-between ph-rise relative overflow-hidden">
              <span aria-hidden className="pointer-events-none absolute bottom-0 left-5 right-5 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-primary/10 border border-primary/20">
                  <Star size={18} className="text-primary" />
                </div>
                <div>
                  <h3 className="text-[14px] font-semibold text-foreground tracking-tight">Project Scoring</h3>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Rate this project 1–5 against each weighted criterion</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-mono uppercase tracking-wider font-semibold text-muted-foreground mb-1">Weighted Score</p>
                <p className="text-3xl font-semibold font-mono num-tabular tracking-tight text-primary">{weightedTotal.toFixed(1)}</p>
              </div>
            </div>

            {criteria.length === 0 ? (
              <div className="glass-surface lift-card ph-rise rounded-2xl p-10 text-center">
                <Star size={32} className="text-muted-foreground/40 mx-auto mb-3" />
                <p className="text-sm text-foreground">No scoring criteria configured.</p>
                <p className="text-xs text-muted-foreground mt-1">A PMO admin can add criteria in <strong className="text-foreground">Admin → Scoring</strong>.</p>
              </div>
            ) : (
              <div className="space-y-3 stagger-children">
                {criteria.map(c => {
                  const existing = scoreMap[c.id];
                  const currentScore = existing?.score ?? 0;
                  const weightedContrib = existing ? Number(existing.weightedScore) : 0;
                  return (
                    <div key={c.id} className="glass-surface lift-card ph-rise rounded-2xl p-5">
                      <div className="flex items-start justify-between gap-4 mb-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-semibold text-foreground truncate tracking-tight">{c.name}</p>
                            <span className="text-[10px] font-mono uppercase tracking-wider font-semibold px-2 py-0.5 rounded-sm border bg-primary/10 text-primary border-primary/20">
                              {c.weightPct}%
                            </span>
                          </div>
                          {c.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{c.description}</p>}
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Contribution</p>
                          <p className="text-lg font-semibold font-mono num-tabular text-foreground">{weightedContrib.toFixed(2)}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground w-10">Score</span>
                        <div className="flex gap-2">
                          {[1,2,3,4,5].map(v => {
                            const active = currentScore === v;
                            return (
                              <button
                                key={v}
                                disabled={!isPMORole}
                                onClick={() => { void handleSaveScore(c.id, v); }}
                                className={`w-8 h-8 rounded-lg text-sm font-semibold font-mono transition-all border ${
                                  active
                                    ? "bg-primary text-primary-foreground border-primary shadow-sm"
                                    : "bg-muted/40 text-muted-foreground border-border hover:bg-accent/40 hover:text-foreground"
                                } ${isPMORole ? "cursor-pointer" : "cursor-default opacity-70"}`}
                              >
                                {v}
                              </button>
                            );
                          })}
                        </div>
                        {currentScore > 0 && (
                          <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden ml-2">
                            <div className="h-full rounded-full bg-primary" style={{ width: `${(currentScore / 5) * 100}%` }} />
                          </div>
                        )}
                        {!isPMORole && (
                          <span className="text-xs text-muted-foreground italic ml-auto">View only — PMO role can score</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
