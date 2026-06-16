import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  useListBudgetLines, useListCharterRisks, useListResourceAllocations, useListIssues, customFetch,
} from "@workspace/api-client-react";
import { api } from "../lib/extra-api";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, LabelList,
} from "recharts";
import {
  Gauge, Wallet, Flag, ShieldAlert, GitBranch, ArrowRight, AlertOctagon,
  CheckCircle2, Clock, History, Users2, Scale,
} from "lucide-react";
import { StageProgressBar } from "./stage-progress-bar";
import { DashboardCard, KPITile, type DrillColumn, type DrillData } from "./dashboard/primitives";
import { TASK_STATUSES } from "../lib/task-constants";
import { formatCurrency } from "../lib/format";
import { chartTooltipProps, HoverHint } from "@/components/ui-kit";
import {
  classify, HEALTH_META, HEALTH_HEX, healthWhy, type RagTone,
  schedulePace, costEfficiency, milestoneSlippage, agingSummary, scopeVolatility, headlineVerdict,
} from "../lib/health";

// ── Local structural types (avoid importing the heavy generated types) ────────
interface TaskLike { id: number; name: string; status: string; endDate?: string | null; parentTaskId?: number | null }
interface MilestoneLike { id: number; name: string; dueDate?: string | null; status: string; scheduleVarianceDays?: number | null }
interface ProjectLike {
  id: number; charterId: number; name: string; status: string; ragStatus?: string;
  progress?: number | null; priority?: string; startDate?: string | null; endDate?: string | null;
  capexBudget?: number | string | null; opexBudget?: number | string | null; projectManagerId?: number | null;
}
interface UserLike { id: number; name: string }
type AuditEntry = { id: number; type: string; message: string; userName?: string | null; createdAt: string };
type RiskRow = { id: number; title: string; impact: string; likelihood: string; status: string; owner?: string | null };
type BudgetLine = { baselineAmount: number; forecastAmount: number; actualAmount: number };
type Alloc = { id: number; userId: number; role?: string | null; allocationPct: number };
type IssueRow = { id: number; title: string; status: string; createdAt: string; blockingDept?: string | null; proposedRevisedDeadline?: string | null };
type CR = { id: number; crNumber: string; title: string; status: string; priority: string; decidedAt: string | null; dueAt: string | null; breachedAt: string | null; createdAt: string };
type Baseline = { id: number; capturedAt: string };

interface Props {
  project: ProjectLike;
  tasks: TaskLike[];
  milestones: MilestoneLike[];
  stageRecords: Array<{ stage: string; status: string }>;
  users: UserLike[];
  currentStageKey: string;
  onOpenLifecycle: (stageKey?: string) => void;
  onOpenTab: (tab: string) => void;
}

const DAY = 86_400_000;
const lvl = (s?: string): number => ({ critical: 4, "very high": 4, very_high: 4, high: 3, medium: 2, moderate: 2, low: 1, "very low": 1 }[(s ?? "").toLowerCase()] ?? 2);
const initials = (name?: string | null): string => {
  if (!name) return "?";
  const p = name.trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1]![0] ?? "" : "")).toUpperCase() || "?";
};
const fmtDay = (d?: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "—");
const TONE_HEX: Record<RagTone, string> = { green: HEALTH_HEX.green, amber: HEALTH_HEX.amber, red: HEALTH_HEX.red };
const toKpiTone = (t: RagTone) => (t === "red" ? "danger" : t === "amber" ? "warn" : "success") as "danger" | "warn" | "success";
const isPendingCR = (s: string) => s === "submitted" || s === "under_review";

export function ProjectOverview({ project, tasks, milestones, stageRecords, users, currentStageKey, onOpenLifecycle, onOpenTab }: Props) {
  const projectId = project.id;
  const now = Date.now();

  const { data: budgetLines = [] } = useListBudgetLines(projectId) as { data: BudgetLine[] };
  const { data: risks = [] } = useListCharterRisks(project.charterId ?? 0, { query: { enabled: !!project.charterId } } as never) as { data: RiskRow[] };
  const { data: allocs = [] } = useListResourceAllocations(projectId) as { data: Alloc[] };
  const { data: issues = [] } = useListIssues(projectId) as { data: IssueRow[] };
  const { data: audit = [] } = useQuery({ queryKey: ["/api/projects", projectId, "audit", "overview"], queryFn: () => customFetch<AuditEntry[]>(`/api/projects/${projectId}/audit`) });
  const { data: changeData } = useQuery({
    queryKey: ["/api/projects", projectId, "change-overview"],
    queryFn: async () => {
      const [crs, baselines] = await Promise.all([
        api.get<CR[]>(`/api/projects/${projectId}/change-requests`).catch(() => [] as CR[]),
        api.get<Baseline[]>(`/api/projects/${projectId}/baselines`).catch(() => [] as Baseline[]),
      ]);
      return { crs, baselines };
    },
  });
  const crs = changeData?.crs ?? [];
  const baselines = changeData?.baselines ?? [];

  const userById = useMemo(() => new Map(users.map(u => [u.id, u.name])), [users]);
  const topTasks = useMemo(() => tasks.filter(t => !t.parentTaskId), [tasks]);
  const totalTasks = topTasks.length;
  const doneTasks = topTasks.filter(t => t.status === "completed").length;

  // ── Budget rollup ───────────────────────────────────────────────────────────
  const budget = useMemo(() => {
    const baseline = budgetLines.reduce((s, b) => s + (b.baselineAmount ?? 0), 0);
    const forecast = budgetLines.reduce((s, b) => s + (b.forecastAmount ?? 0), 0);
    const actual = budgetLines.reduce((s, b) => s + (b.actualAmount ?? 0), 0);
    const headerBudget = Number(project.capexBudget ?? 0) + Number(project.opexBudget ?? 0);
    const base = baseline || headerBudget;
    return { baseline: base, forecast, actual, burn: base > 0 ? Math.round((actual / base) * 100) : 0, hasLines: budgetLines.length > 0 };
  }, [budgetLines, project.capexBudget, project.opexBudget]);

  // ── LEADING INDICATORS (pure helpers in lib/health.ts) ──────────────────────
  const pace = useMemo(() => schedulePace({ startDate: project.startDate, endDate: project.endDate, progress: project.progress, status: project.status, now }), [project.startDate, project.endDate, project.progress, project.status, now]);
  const cost = useMemo(() => costEfficiency({ progress: project.progress, burnPct: budget.burn, hasBudget: budget.baseline > 0 }), [project.progress, budget.burn, budget.baseline]);
  const slip = useMemo(() => milestoneSlippage(milestones, now), [milestones, now]);
  const aging = useMemo(() => agingSummary(issues, now), [issues, now]);
  const scope = useMemo(() => scopeVolatility(crs, baselines, now), [crs, baselines, now]);

  const health = classify({ status: project.status, ragStatus: project.ragStatus ?? "green" });
  const verdict = useMemo(() => headlineVerdict({ health, pace, cost, slip, aging, progress: project.progress, endDate: project.endDate, status: project.status, now }), [health, pace, cost, slip, aging, project.progress, project.endDate, project.status, now]);
  const why = useMemo(() => healthWhy({ status: project.status, endDate: project.endDate, progress: project.progress, baselineSum: budget.baseline, actualSum: budget.actual, openHighRisks: risks.filter(r => lvl(r.impact) >= 3 && r.status !== "closed" && r.status !== "resolved").length, openIssues: aging.openCount, now }), [project.status, project.endDate, project.progress, budget.baseline, budget.actual, risks, aging.openCount, now]);

  // ── Decisions / attention feed ──────────────────────────────────────────────
  const decisions = useMemo(() => {
    const items: { id: string; label: string; meta: string; urgent: boolean; tab: string }[] = [];
    for (const c of crs) {
      if (!isPendingCR(c.status) || c.decidedAt) continue;
      const breached = Boolean(c.breachedAt || (c.dueAt && new Date(c.dueAt).getTime() < now));
      items.push({ id: `cr-${c.id}`, label: `${c.crNumber} · ${c.title}`, meta: breached ? "SLA breached — awaiting decision" : "Change request awaiting decision", urgent: breached, tab: "changes" });
    }
    for (const i of issues) {
      if ((i.status === "resolved" || i.status === "closed") || !i.proposedRevisedDeadline) continue;
      items.push({ id: `iss-${i.id}`, label: i.title, meta: `Proposed deadline change → ${fmtDay(i.proposedRevisedDeadline)}`, urgent: false, tab: "issues" });
    }
    for (const m of milestones) {
      const done = m.status === "completed" || m.status === "done" || m.status === "achieved";
      if (!done && m.dueDate && new Date(m.dueDate).getTime() < now) {
        items.push({ id: `ms-${m.id}`, label: m.name, meta: `Gate overdue since ${fmtDay(m.dueDate)} — decision to proceed`, urgent: true, tab: "milestones" });
      }
    }
    return items.sort((a, b) => Number(b.urgent) - Number(a.urgent)).slice(0, 6);
  }, [crs, issues, milestones, now]);

  // ── Context panels (demoted) ────────────────────────────────────────────────
  const taskDonut = useMemo(() => TASK_STATUSES.map(s => ({ name: s.label, value: topTasks.filter(t => t.status === s.value).length, color: s.solid })).filter(d => d.value > 0), [topTasks]);
  const openRisks = useMemo(() => risks.filter(r => r.status !== "closed" && r.status !== "resolved"), [risks]);
  const topRisks = useMemo(() => [...openRisks].sort((a, b) => lvl(b.impact) * lvl(b.likelihood) - lvl(a.impact) * lvl(a.likelihood)).slice(0, 5), [openRisks]);

  const milestoneRow = (m: MilestoneLike): { color: string; badge?: string } => {
    const done = m.status === "completed" || m.status === "done" || m.status === "achieved";
    if (done) return { color: HEALTH_HEX.blue, badge: "DONE" };
    const sv = m.scheduleVarianceDays ?? 0;
    const overdue = m.dueDate ? new Date(m.dueDate).getTime() < now : false;
    if (sv > 0 || overdue) return { color: HEALTH_HEX.red, badge: sv > 0 ? `SLIP ${sv}d` : "OVERDUE" };
    if (m.dueDate && (new Date(m.dueDate).getTime() - now) / DAY <= 14) return { color: HEALTH_HEX.amber, badge: "DUE SOON" };
    return { color: HEALTH_HEX.green };
  };
  const sortedMilestones = useMemo(() => [...milestones].sort((a, b) => (a.dueDate ? new Date(a.dueDate).getTime() : Infinity) - (b.dueDate ? new Date(b.dueDate).getTime() : Infinity)), [milestones]);

  const overdueTasks = useMemo(() => topTasks.filter(t => t.status !== "completed" && t.endDate && new Date(t.endDate).getTime() < now).sort((a, b) => new Date(a.endDate!).getTime() - new Date(b.endDate!).getTime()).slice(0, 5), [topTasks, now]);
  const upcomingMilestones = useMemo(() => sortedMilestones.filter(m => { const done = m.status === "completed" || m.status === "done" || m.status === "achieved"; return m.dueDate && !done && new Date(m.dueDate).getTime() >= now - DAY; }).slice(0, 4), [sortedMilestones, now]);

  const team = useMemo(() => {
    const seen = new Set<number>(); const out: { userId: number; name: string; role?: string | null; pct: number }[] = [];
    for (const a of allocs) {
      if (seen.has(a.userId)) { const e = out.find(x => x.userId === a.userId); if (e) e.pct += a.allocationPct; continue; }
      seen.add(a.userId); out.push({ userId: a.userId, name: userById.get(a.userId) ?? `User ${a.userId}`, role: a.role, pct: a.allocationPct });
    }
    return out.slice(0, 8);
  }, [allocs, userById]);

  const pmName = project.projectManagerId ? userById.get(project.projectManagerId) : null;
  const budgetBars = [
    { name: "Baseline", v: budget.baseline, c: "#6366F1" },
    { name: "Forecast", v: budget.forecast || budget.baseline, c: "#8B5CF6" },
    { name: "Actual", v: budget.actual, c: budget.burn > 100 ? HEALTH_HEX.red : "#22C55E" },
  ];

  // ── Drill-down data — the actual rows behind each leading indicator / chart ──
  const isDone = (s: string) => s === "completed" || s === "done" || s === "achieved";
  const slippedMilestones = useMemo(() => milestones.filter(m => {
    if (isDone(m.status)) return false;
    const overdue = m.dueDate ? new Date(m.dueDate).getTime() < now : false;
    return (m.scheduleVarianceDays ?? 0) > 0 || overdue;
  }), [milestones, now]);
  const openIssues = useMemo(() => issues.filter(i => i.status !== "resolved" && i.status !== "closed"), [issues]);

  const expectedPct = pace.gap == null ? null : (project.progress ?? 0) - pace.gap;
  const paceDrill: DrillData = {
    subtitle: pace.label,
    columns: [{ key: "metric", label: "Metric" }, { key: "value", label: "Value", align: "right" }],
    rows: [
      { metric: "Actual progress", value: `${project.progress ?? 0}%` },
      { metric: "Expected by now", value: expectedPct == null ? "—" : `${Math.round(expectedPct)}%` },
      { metric: "Gap", value: pace.gap == null ? "—" : `${pace.gap > 0 ? "+" : ""}${pace.gap} pts` },
    ],
    emptyText: "No schedule baseline.",
  };
  const costDrill: DrillData = {
    subtitle: cost.label,
    columns: [{ key: "item", label: "Item" }, { key: "amount", label: "Amount", align: "right", render: (v) => formatCurrency(Number(v ?? 0)) }],
    rows: budget.baseline > 0 ? [
      { item: "Baseline", amount: budget.baseline },
      { item: "Forecast", amount: budget.forecast || budget.baseline },
      { item: "Actual", amount: budget.actual },
    ] : [],
    linkLabel: "Open budget", emptyText: "No budget set.",
  };
  const milestoneDrillCols: DrillColumn[] = [
    { key: "name", label: "Milestone" },
    { key: "due", label: "Due" },
    { key: "variance", label: "Slip", align: "right" },
    { key: "status", label: "Status" },
  ];
  const slipDrill: DrillData = {
    subtitle: slip.label,
    columns: milestoneDrillCols,
    rows: slippedMilestones.map(m => ({ name: m.name, due: fmtDay(m.dueDate), variance: (m.scheduleVarianceDays ?? 0) > 0 ? `${m.scheduleVarianceDays}d` : "overdue", status: m.status })),
    emptyText: "No slipped milestones.",
  };
  const agingDrill: DrillData = {
    subtitle: aging.label,
    columns: [
      { key: "title", label: "Issue" },
      { key: "status", label: "Status", render: (v) => String(v ?? "—").replace(/_/g, " ") },
      { key: "opened", label: "Opened" },
      { key: "dept", label: "Blocking Dept" },
    ],
    rows: openIssues.map(i => ({ title: i.title, status: i.status, opened: fmtDay(i.createdAt), dept: i.blockingDept ?? "—" })),
    emptyText: "No open blockers.",
  };
  const scopeDrill: DrillData = {
    subtitle: scope.label,
    columns: [
      { key: "cr", label: "CR #" },
      { key: "title", label: "Title" },
      { key: "status", label: "Status", render: (v) => String(v ?? "—").replace(/_/g, " ") },
      { key: "created", label: "Raised" },
    ],
    rows: crs.map(c => ({ cr: c.crNumber, title: c.title, status: c.status, created: fmtDay(c.createdAt) })),
    emptyText: "No change requests.",
  };

  // 5 leading-indicator tiles
  const leadTiles: Array<{ label: string; value: string; sub: string; tone: RagTone; icon: typeof Gauge; drill: DrillData }> = [
    { label: "Schedule Pace", value: pace.gap == null ? "—" : `${pace.gap > 0 ? "+" : ""}${pace.gap} pts`, sub: pace.label, tone: pace.tone, icon: Gauge, drill: paceDrill },
    { label: "Cost Efficiency", value: budget.baseline > 0 ? `${budget.burn}% spent` : "—", sub: cost.label, tone: cost.tone, icon: Wallet, drill: costDrill },
    { label: "Milestone Slippage", value: `${slip.slipped}`, sub: slip.label, tone: slip.tone, icon: Flag, drill: slipDrill },
    { label: "Aging Blockers", value: `${aging.openCount}`, sub: aging.label, tone: aging.tone, icon: ShieldAlert, drill: agingDrill },
    { label: "Scope Volatility", value: `${scope.recent}`, sub: scope.label, tone: scope.tone, icon: GitBranch, drill: scopeDrill },
  ];

  return (
    <div className="space-y-5">
      {/* ── Verdict bar — the line a sponsor reads first ─────────────────── */}
      <div className="glass-surface lift-card rounded-2xl p-5 border-l-4" style={{ borderColor: TONE_HEX[verdict.rag] }}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3 min-w-0">
            <span className="w-3.5 h-3.5 rounded-full mt-1 shrink-0" style={{ background: HEALTH_META[health].color }} />
            <div className="min-w-0">
              <p className="text-base font-semibold text-foreground leading-snug">{verdict.sentence}</p>
              <div className="flex items-center gap-3 mt-2 flex-wrap">
                {why.reasons.map((r, i) => (
                  <span key={i} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: TONE_HEX[r.tone] }} />{r.label}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {pmName && (
              <span className="inline-flex items-center gap-2" title="Project Manager">
                <span className="w-7 h-7 rounded-full bg-primary/10 text-primary text-[11px] font-semibold flex items-center justify-center">{initials(pmName)}</span>
                <span className="text-xs text-muted-foreground hidden sm:block">{pmName}</span>
              </span>
            )}
            <button onClick={() => onOpenLifecycle()} className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline">Lifecycle <ArrowRight size={12} /></button>
          </div>
        </div>
      </div>

      {/* ── Needs a Decision — top-value steering panel ──────────────────── */}
      <DashboardCard title="Needs a Decision" subtitle="Open items waiting on you — the steering queue" variant="mono">
        {decisions.length === 0 ? (
          <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground"><CheckCircle2 size={18} style={{ color: HEALTH_HEX.green }} />Nothing needs a decision right now.</div>
        ) : (
          <div className="space-y-2">
            {decisions.map(d => (
              <div key={d.id} onClick={() => onOpenTab(d.tab)} className="flex items-center gap-3 p-2.5 rounded-lg cursor-pointer hover:bg-accent/50 transition-colors border-l-2" style={{ borderColor: d.urgent ? HEALTH_HEX.red : HEALTH_HEX.amber, background: `${d.urgent ? HEALTH_HEX.red : HEALTH_HEX.amber}0d` }}>
                {d.urgent ? <AlertOctagon size={16} className="shrink-0" style={{ color: HEALTH_HEX.red }} /> : <Scale size={16} className="shrink-0" style={{ color: HEALTH_HEX.amber }} />}
                <div className="min-w-0 flex-1"><p className="text-sm font-medium text-foreground truncate">{d.label}</p><p className="text-[11px] text-muted-foreground">{d.meta}</p></div>
                <ArrowRight size={14} className="text-muted-foreground/50 shrink-0" />
              </div>
            ))}
          </div>
        )}
      </DashboardCard>

      {/* ── Leading indicators — predictive, act-on-it signals ───────────── */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-2 ml-1">Leading Indicators · early warning</p>
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          {leadTiles.map(t => <KPITile key={t.label} compact label={t.label} value={t.value} icon={t.icon} tone={toKpiTone(t.tone)} sub={t.sub} highlight={t.tone === "red"} drill={t.drill} />)}
        </div>
      </div>

      {/* ── Lifecycle gate strip ─────────────────────────────────────────── */}
      <DashboardCard title="Lifecycle Gates" subtitle="Stage-gate progress · click a stage for full governance" actions={
        <button onClick={() => onOpenLifecycle()} className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline">Open Lifecycle <ArrowRight size={12} /></button>
      }>
        <StageProgressBar currentStageKey={currentStageKey} stageRecords={stageRecords} onStageClick={key => onOpenLifecycle(key)} />
      </DashboardCard>

      {/* ── Context: task status · budget · top risks ────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <DashboardCard title="Task Status" subtitle={`${doneTasks}/${totalTasks} complete`}
          drill={{ subtitle: "Top-level tasks by status", columns: [{ key: "status", label: "Status" }, { key: "count", label: "Tasks", align: "right" }], rows: taskDonut.map(d => ({ status: d.name, count: d.value })), emptyText: "No tasks yet." }}
          actions={<button onClick={() => onOpenTab("grid")} className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline">Tasks <ArrowRight size={12} /></button>}>
          {taskDonut.length > 0 ? (
            <div className="relative">
              <ResponsiveContainer width="100%" height={185}>
                <PieChart>
                  <Pie data={taskDonut} cx="50%" cy="50%" innerRadius={48} outerRadius={72} paddingAngle={3} dataKey="value" nameKey="name">
                    {taskDonut.map((e, i) => <Cell key={i} fill={e.color} />)}
                  </Pie>
                  <Tooltip {...chartTooltipProps} />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none" style={{ height: 185 }}>
                <span className="text-2xl font-bold font-mono text-foreground leading-none">{totalTasks}</span><span className="text-[10px] text-muted-foreground mt-0.5">Tasks</span>
              </div>
            </div>
          ) : <div className="text-center py-12 text-sm text-muted-foreground/70">No tasks yet</div>}
        </DashboardCard>

        <DashboardCard title="Budget" subtitle={budget.hasLines ? "Baseline · Forecast · Actual" : "From project budget (no detailed lines yet)"}
          drill={{ subtitle: `Burn ${budget.burn}% of baseline`, columns: [{ key: "item", label: "Item" }, { key: "amount", label: "Amount", align: "right", render: (v) => formatCurrency(Number(v ?? 0)) }], rows: budgetBars.map(b => ({ item: b.name, amount: b.v })), emptyText: "No budget set." }}
          actions={<button onClick={() => onOpenTab("budget")} className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline">Budget <ArrowRight size={12} /></button>}>
          {budget.baseline > 0 ? (
            <ResponsiveContainer width="100%" height={185}>
              <BarChart data={budgetBars} margin={{ top: 18, right: 8, bottom: 4, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `₹${(v / 1e6).toFixed(0)}M`} axisLine={false} tickLine={false} />
                <Tooltip {...chartTooltipProps} formatter={(v: number) => [formatCurrency(v), ""]} cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }} />
                <Bar dataKey="v" radius={[6, 6, 0, 0]} maxBarSize={48}>
                  <LabelList dataKey="v" position="top" formatter={(v: number) => `₹${(v / 1e6).toFixed(1)}M`} style={{ fontSize: 10, fontWeight: 700, fill: "hsl(var(--foreground))" }} />
                  {budgetBars.map((b, i) => <Cell key={i} fill={b.c} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="text-center py-12 text-sm text-muted-foreground/70">No budget set</div>}
        </DashboardCard>

        <DashboardCard title="Top Risks" subtitle={`${openRisks.length} open`} actions={<button onClick={() => onOpenTab("risks")} className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline">Risks <ArrowRight size={12} /></button>}>
          {topRisks.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground/70 flex flex-col items-center gap-2"><CheckCircle2 size={22} style={{ color: HEALTH_HEX.green }} />No open risks</div>
          ) : (
            <div className="space-y-2">
              {topRisks.map(r => {
                const score = lvl(r.impact) * lvl(r.likelihood);
                const tone = score >= 9 ? HEALTH_HEX.red : score >= 4 ? HEALTH_HEX.amber : HEALTH_HEX.green;
                return (
                  <div key={r.id} className="flex items-center gap-2.5 p-2 rounded-lg border-l-2" style={{ borderColor: tone, background: `${tone}0d` }}>
                    <span className="text-[11px] font-bold font-mono tabular-nums w-6 text-center shrink-0" style={{ color: tone }}>{score}</span>
                    <div className="min-w-0 flex-1"><p className="text-xs font-medium text-foreground truncate">{r.title}</p><p className="text-[10px] text-muted-foreground capitalize">{r.impact} impact · {r.likelihood} likely{r.owner ? ` · ${r.owner}` : ""}</p></div>
                  </div>
                );
              })}
            </div>
          )}
        </DashboardCard>
      </div>

      {/* ── Context: milestone timeline (slip-aware) · upcoming/overdue ───── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2">
          <DashboardCard title="Milestone Timeline" subtitle={slip.label} actions={<button onClick={() => onOpenTab("milestones")} className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline">All milestones <ArrowRight size={12} /></button>}>
            {sortedMilestones.length === 0 ? (
              <div className="text-center py-10 text-sm text-muted-foreground/70 flex flex-col items-center gap-2"><Flag size={22} className="text-muted-foreground/40" />No milestones yet</div>
            ) : (
              <div className="space-y-1.5">
                {sortedMilestones.slice(0, 7).map(m => {
                  const { color, badge } = milestoneRow(m);
                  const slipBadge = badge && badge !== "DONE";
                  return (
                    <div key={m.id} className="flex items-center gap-3 py-1.5 px-2 rounded-lg hover:bg-accent/40 transition-colors">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
                      <span className="flex-1 text-sm text-foreground truncate">{m.name}</span>
                      {badge === "DONE" && <CheckCircle2 size={14} style={{ color: HEALTH_HEX.blue }} />}
                      {slipBadge && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ color, background: `${color}1a` }}>{badge}</span>}
                      <span className="text-xs font-mono tabular-nums text-muted-foreground w-16 text-right">{fmtDay(m.dueDate)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </DashboardCard>
        </div>

        <DashboardCard title="Upcoming & Overdue" subtitle="What needs attention next">
          {overdueTasks.length === 0 && upcomingMilestones.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground/70 flex flex-col items-center gap-2"><CheckCircle2 size={22} style={{ color: HEALTH_HEX.green }} />Nothing overdue or imminent</div>
          ) : (
            <div className="space-y-2">
              {overdueTasks.map(t => (
                <div key={`t-${t.id}`} onClick={() => onOpenTab("grid")} className="flex items-center gap-2.5 p-2 rounded-lg cursor-pointer hover:bg-accent/50 border-l-2" style={{ borderColor: HEALTH_HEX.red, background: `${HEALTH_HEX.red}0d` }}>
                  <AlertOctagon size={15} className="shrink-0" style={{ color: HEALTH_HEX.red }} /><span className="flex-1 text-sm text-foreground truncate">{t.name}</span><span className="text-[10px] font-semibold" style={{ color: HEALTH_HEX.red }}>due {fmtDay(t.endDate)}</span>
                </div>
              ))}
              {upcomingMilestones.map(m => (
                <div key={`m-${m.id}`} onClick={() => onOpenTab("milestones")} className="flex items-center gap-2.5 p-2 rounded-lg cursor-pointer hover:bg-accent/50 border-l-2" style={{ borderColor: HEALTH_HEX.amber, background: `${HEALTH_HEX.amber}0d` }}>
                  <Flag size={15} className="shrink-0" style={{ color: HEALTH_HEX.amber }} /><span className="flex-1 text-sm text-foreground truncate">{m.name}</span><span className="text-[10px] font-semibold text-muted-foreground">{fmtDay(m.dueDate)}</span>
                </div>
              ))}
            </div>
          )}
        </DashboardCard>
      </div>

      {/* ── Activity & team ──────────────────────────────────────────────── */}
      <DashboardCard title="Activity & Team" subtitle="Recent changes · who's on it" actions={<button onClick={() => onOpenTab("audit")} className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline">Audit <ArrowRight size={12} /></button>}>
        {team.length > 0 && (
          <div className="flex items-center gap-2 mb-3 pb-3 border-b border-border/60 flex-wrap">
            {team.map(p => (
              <HoverHint key={p.userId} label={`${p.name}${p.role ? ` · ${p.role}` : ""} · ${p.pct}%`}>
                <span className="inline-flex items-center gap-1.5 pl-1 pr-2 py-1 rounded-full bg-muted/70">
                  <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-[9px] font-semibold flex items-center justify-center">{initials(p.name)}</span><span className="text-[11px] text-foreground truncate max-w-[90px]">{p.name}</span>
                </span>
              </HoverHint>
            ))}
          </div>
        )}
        {audit.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground/70 flex flex-col items-center gap-2"><History size={20} className="text-muted-foreground/40" />No recent activity</div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2.5">
            {audit.slice(0, 6).map(a => (
              <div key={a.id} className="flex items-start gap-2.5">
                <Clock size={13} className="text-muted-foreground/60 shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1"><p className="text-xs text-foreground leading-snug">{a.message}</p><p className="text-[10px] text-muted-foreground">{a.userName ?? "System"} · {new Date(a.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</p></div>
              </div>
            ))}
          </div>
        )}
        {team.length === 0 && (
          <div className="mt-3 pt-3 border-t border-border/60 flex items-center gap-2 text-[11px] text-muted-foreground"><Users2 size={13} />No team allocated yet</div>
        )}
      </DashboardCard>
    </div>
  );
}
