import { Fragment, useMemo, useState, useRef, useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useListProjects, useListUsers, useGetDashboardSummary, useListCharters } from "@workspace/api-client-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LabelList,
} from "recharts";
import {
  FolderKanban, CheckCircle2, AlertTriangle, AlertOctagon, Wallet,
  ListChecks, Flag, IndianRupee, Calendar, Clock, FileText,
  Trophy, AlertCircle, ChevronDown, ChevronRight, LayoutGrid, BarChart3,
  Search, ArrowUp, ArrowDown, ArrowUpDown, ArrowRight, Users, X,
  BellRing, Check, Loader2, Crown,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { KPITile, DashboardCard, FilterBar, RAGBadge, Drillable, type DrillColumn } from "../components/dashboard/primitives";
import { formatCurrency } from "../lib/format";
import { classify, HEALTH_META, type Health } from "../lib/health";
import { TASK_PRIORITIES } from "../lib/task-constants";
import { chartTooltipProps, HoverHint } from "@/components/ui-kit";
import { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell } from "@/components/ui/table";

// ── Chart palette ─────────────────────────────────────────────────────────────
// Health hex live in lib/health.ts (HEALTH_HEX); these add the chart-only
// accent hues (indigo/violet) the bars and donut use.
const C = {
  green: "#22C55E",
  amber: "#EAB308",
  red: "#EF4444",
  blue: "#3B82F6",
  indigo: "#6366F1",
  violet: "#8B5CF6",
  grey: "#94A3B8",
};
const PRIORITY_COLORS: Record<string, string> = { P0: C.red, P1: "#F97316", P2: C.amber, P3: C.green };
// Readable priority labels for the summary chips (values stay P0–P3 in the data).
const PRIORITY_LABEL: Record<string, string> = { P0: "Critical", P1: "High", P2: "Medium", P3: "Low" };

// ── Local data hooks (same endpoints the role dashboards use) ─────────────────

const STATUS_OPTS = [
  { value: "new", label: "New" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "postponed", label: "Postponed" },
];
// Priority dropdown shows the readable labels (Critical/High/Medium/Low);
// values stay P0–P3 to match how priority is stored on a project.
const PRIORITY_OPTS = TASK_PRIORITIES.map(p => ({ value: p.value, label: p.label }));

// Portfolio Summary table columns + their default share of the table width (%).
// The single "Delivery" bar (ported from the 5191 portfolio board) merges the
// old Timeline + Progress columns: fill = % complete coloured by health, a
// "today" tick at the elapsed share, a red overdue tail, and the start/end
// dates printed inside the bar. Budget / Est. Spend → Budget / Schedule Variance.

// Profile avatar — renders the photo if one exists, otherwise initials on a
// colour-filled circle. Name shown on hover.
const AVATAR_COLORS = ["#6366F1", "#F59E0B", "#10B981", "#EF4444", "#8B5CF6", "#0EA5E9", "#EC4899", "#14B8A6", "#F97316"];
function avatarInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return ((parts[0]![0] ?? "") + (parts[parts.length - 1]![0] ?? "")).toUpperCase();
}
function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}
function Avatar({ name, photoUrl }: { name?: string | null; photoUrl?: string | null }) {
  if (!name || name === "—") {
    return <HoverHint label="Unassigned"><span className="inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-semibold bg-muted text-muted-foreground/60 border border-border">—</span></HoverHint>;
  }
  if (photoUrl) {
    return <HoverHint label={name}><img src={photoUrl} alt={name} className="w-6 h-6 rounded-full object-cover border border-border" /></HoverHint>;
  }
  return (
    <HoverHint label={name}>
      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-semibold text-white shadow-sm select-none" style={{ background: avatarColor(name) }}>
        {avatarInitials(name)}
      </span>
    </HoverHint>
  );
}

// ── Leadership roster ───────────────────────────────────────────────────────
type Leader = { code: string; name: string; role: string; designation: string | null; officeEmail: string | null; photoUrl: string | null };

// Map a project's `function` (department) to the employee_code of the CXO who
// heads that function. Keys are matched case-insensitively against the function
// text (substring), so "Health & Safety" and "EHS" both resolve to the EHS head.
const FUNCTION_LEADER_RULES: Array<{ match: RegExp; code: string }> = [
  { match: /\b(it|information|digital)\b/i,        code: "14450" }, // Chief Information & Digital Officer
  { match: /\b(ehs|health|safety|sustainab)/i,    code: "14019" }, // Head of EHS & Sustainability
  { match: /\b(scm|supply\s*chain|logistic)/i,    code: "14994" }, // Head of Supply Chain Management
  { match: /\b(r\s*&?\s*d|research|formulation)/i, code: "4720"  }, // Head of Formulations R&D
  { match: /\b(sales|marketing|commercial)/i,     code: "1103"  }, // Head of Commercials – Sales & Marketing
  { match: /\b(finance|fin|treasury|account)/i,   code: "10693" }, // Chief Financial Officer
  { match: /\b(hr|human|people)\b/i,              code: "14915" }, // Chief Human Resources Officer
  { match: /\bapi\b/i,                            code: "13944" }, // President – API Operations
  { match: /\b(fd|formulation\s*operations)\b/i,  code: "13188" }, // President – FD Operations
];
function leaderCodeForFunction(fn?: string | null): string | null {
  if (!fn) return null;
  const hit = FUNCTION_LEADER_RULES.find(r => r.match.test(fn));
  return hit ? hit.code : null;
}

// Per-project task aggregate — drives the Delivery bar's completion % and the
// hover-card breakdown. Same shape the 5191 portfolio board computes.
type TaskAgg = { total: number; done: number; in_progress: number; delayed: number; on_hold: number; not_started: number };

// EXACT colours + logic the 5191 portfolio board's scheduleHealth() uses to fill
// the Delivery bar — schedule health, NOT the project's RAG/classify health:
//   • cancelled / postponed → grey (na)
//   • completed            → green (on track)
//   • past target end date  → red (delayed)
//   • >15 pts behind the elapsed-timeline expectation → amber (off track)
//   • otherwise            → green (on track)
const DELIVERY_HEALTH_COLORS = { on_track: "#16A34A", off_track: "#D97706", delayed: "#DC2626", na: "#94A3B8" } as const;
type DeliveryKey = keyof typeof DELIVERY_HEALTH_COLORS;
// Health column shows the STATUS (filled with the SAME RAG colour as the row's
// Delivery bar). Short label for the badge; longer description on hover.
const DELIVERY_STATUS_LABEL: Record<DeliveryKey, string> = { on_track: "On Track", off_track: "Off Track", delayed: "Delayed", na: "N/A" };
const DELIVERY_DESC: Record<DeliveryKey, string> = { on_track: "On track", off_track: "Off track — behind schedule", delayed: "Delayed — past due", na: "Not applicable" };

function deliveryHealthKey(
  p: { status?: string | null; start?: string | null; end?: string | null; progress?: number | null },
  agg?: TaskAgg,
): DeliveryKey {
  const status = (p.status ?? "").toLowerCase();
  if (status === "cancelled" || status === "postponed") return "na";
  if (status === "completed") return "on_track";

  const now = Date.now();
  const total = agg?.total ?? 0;
  const done = agg?.done ?? 0;
  const actualPct = total > 0 ? (done / total) * 100 : (p.progress ?? 0);
  const start = p.start ? new Date(p.start.slice(0, 10)).getTime() : null;
  const end = p.end ? new Date(p.end.slice(0, 10)).getTime() : null;

  // Delayed — past the target end date and not complete.
  if (end != null && end < now) return "delayed";

  // Off Track — completion behind the elapsed-time expectation by more than 15 pts.
  let expectedPct = 0;
  if (start != null && end != null && end > start)
    expectedPct = Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100));
  if (expectedPct - actualPct > 15) return "off_track";

  return "on_track";
}
function deliveryFill(
  p: { status?: string | null; start?: string | null; end?: string | null; progress?: number | null },
  agg?: TaskAgg,
): string {
  return DELIVERY_HEALTH_COLORS[deliveryHealthKey(p, agg)];
}

// Delivery bar — an EXACT replica of the 5191 portfolio board's merged Delivery
// cell. ONE bar carries completion + schedule: the fill (from the left, coloured
// by the row's health) is % complete (task done-ratio when there are tasks, else
// the project's own progress); a vertical "today" tick marks the elapsed share
// of the timeline (a fill ending left of it reads as behind schedule); a red tail
// is the not-done remainder once a project is past its end date; the start / end
// dates are printed inside the bar. The portal hover card carries the full task
// breakdown (done / in-progress / delayed / on-hold) and days-left.
function DeliveryBar({ project, agg, color }: {
  project: { progress: number; start?: string | null; end?: string | null };
  agg?: TaskAgg;
  color: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; below: boolean } | null>(null);

  const s = project.start ? new Date(project.start).getTime() : null;
  const e = project.end ? new Date(project.end).getTime() : null;
  const now = Date.now();
  const total = agg?.total ?? 0;
  const done = agg?.done ?? 0;
  // Completion: task done-ratio when there are tasks, else the project's progress.
  const pct = total > 0
    ? Math.round((done / total) * 100)
    : Math.max(0, Math.min(100, Math.round(project.progress ?? 0)));
  const fill = color;
  const elapsedPct = (s != null && e != null && e > s)
    ? Math.max(0, Math.min(100, ((now - s) / (e - s)) * 100))
    : null;
  const overdue = e != null && e < now && pct < 100;
  const daysToEnd = e != null ? Math.ceil((e - now) / 86_400_000) : null;
  const empty = s == null && e == null && total === 0;

  const lbl = (d?: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : null);
  const sLabel = lbl(project.start);
  const eLabel = lbl(project.end);

  const show = () => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const below = r.top < 150;
    setTip({ x: r.left + r.width / 2, y: below ? r.bottom : r.top, below });
  };

  const breakdown: string[] = [];
  if (agg?.in_progress) breakdown.push(`${agg.in_progress} in progress`);
  if (agg?.delayed) breakdown.push(`${agg.delayed} delayed`);
  if (agg?.on_hold) breakdown.push(`${agg.on_hold} on hold`);
  if (agg?.not_started) breakdown.push(`${agg.not_started} not started`);

  if (empty) return <span className="text-[11px] text-gray-400">—</span>;

  return (
    <div
      ref={ref}
      onMouseEnter={show}
      onMouseLeave={() => setTip(null)}
      className="w-full cursor-help"
    >
      <div className="relative w-full min-w-[150px] h-[18px] rounded-md bg-gray-300 overflow-hidden">
        {/* completion fill */}
        <div className="absolute left-0 top-0 h-full" style={{ width: `${pct}%`, background: fill }} />
        {/* overdue tail — the not-done remainder, red */}
        {overdue && (
          <div className="absolute top-0 h-full" style={{ left: `${pct}%`, width: `${Math.max(0, 100 - pct)}%`, background: "rgb(220 38 38 / 0.55)" }} />
        )}
        {/* today tick — % of the timeline elapsed */}
        {elapsedPct != null && (
          <div className="absolute top-0 bottom-0 w-[2px] -translate-x-1/2 bg-gray-900/80 z-10" style={{ left: `${elapsedPct}%` }} aria-label="Today" />
        )}
        {/* dates inside the pill — white + drop-shadow so they read over both the
            coloured fill and the lighter track. */}
        <div className="absolute inset-0 flex items-center justify-between px-1.5 z-20 pointer-events-none">
          <span className="text-[9px] font-semibold text-white tabular-nums whitespace-nowrap" style={{ textShadow: "0 1px 2px rgb(0 0 0 / 0.65)" }}>{sLabel ?? ""}</span>
          <span className="text-[9px] font-semibold text-white tabular-nums whitespace-nowrap" style={{ textShadow: "0 1px 2px rgb(0 0 0 / 0.65)" }}>{eLabel ?? ""}</span>
        </div>
      </div>
      {tip && createPortal(
        <div
          className="fixed z-[200] pointer-events-none w-56"
          style={{
            left: tip.x,
            top: tip.below ? tip.y + 6 : tip.y - 6,
            transform: `translateX(-50%)${tip.below ? "" : " translateY(-100%)"}`,
          }}
        >
          <div className="relative rounded-md border border-border bg-popover/95 backdrop-blur text-popover-foreground shadow-lg ring-1 ring-black/5 px-2 py-1.5 text-left">
            <div className="flex items-center justify-between gap-2 mb-0.5">
              <span className="text-[10px] font-bold uppercase tracking-wide text-foreground">Delivery</span>
              <span className="text-[10px] font-semibold" style={{ color: fill }}>{pct}% complete</span>
            </div>
            <p className="text-[10px] leading-snug text-muted-foreground">
              {total > 0
                ? <><b className="text-foreground font-semibold">{done}/{total}</b> tasks done{breakdown.length ? ` · ${breakdown.join(" · ")}` : ""}</>
                : "No tasks yet"}
            </p>
            <p className="text-[10px] leading-snug text-muted-foreground mt-0.5">
              {project.start ?? "?"} → {project.end ?? "?"}
              {daysToEnd != null && (overdue ? ` · ${Math.abs(daysToEnd)}d overdue` : daysToEnd >= 0 ? ` · ${daysToEnd}d left` : "")}
            </p>
            {elapsedPct != null && (
              <p className="text-[10px] leading-snug text-muted-foreground/80 mt-0.5">
                {Math.round(elapsedPct)}% of the timeline elapsed
              </p>
            )}
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
    </div>
  );
}

// ── Issues Requiring Attention — surfaced as a KPI tile + drill popup. ──
type ProblemItem = { id: number; name: string; kind: "off-track" | "delayed"; reason?: string; daysOverdue?: number; behindBy?: number };
function problemsFromHealth(health?: { offTrackProjects?: unknown[]; delayedProjects?: unknown[] }): ProblemItem[] {
  return [
    ...((health?.offTrackProjects ?? []) as ProblemItem[]).map((p) => ({ ...p, kind: "off-track" as const })),
    ...((health?.delayedProjects ?? []) as ProblemItem[]).map((p) => ({ ...p, kind: "delayed" as const })),
  ];
}

// Collapsible band for a group of cards/charts. Collapsed → its content hides so
// the Portfolio Summary table rises into view.
function CollapsibleSection({
  title, subtitle, icon: Icon, open, onToggle, children,
}: {
  title: string;
  subtitle?: string;
  icon?: typeof FolderKanban;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2.5 rounded-xl px-3 py-2 hover:bg-accent/40 transition-colors"
        aria-expanded={open}
      >
        {open ? <ChevronDown size={16} className="text-muted-foreground" /> : <ChevronRight size={16} className="text-muted-foreground" />}
        {Icon && <Icon size={15} className="text-primary" />}
        <span className="text-sm font-bold text-foreground">{title}</span>
        {subtitle && <span className="text-xs text-muted-foreground hidden sm:inline">{subtitle}</span>}
        {!open && <span className="ml-auto text-[11px] font-medium text-muted-foreground/70">Collapsed — click to expand</span>}
      </button>
      {open && <div className="mt-3 space-y-4">{children}</div>}
    </div>
  );
}

// Sort indicator for the Portfolio Summary column headers — neutral double
// chevron when inactive, a single directional arrow when the column is active.
function SortIcon({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  if (!active) return <ArrowUpDown size={11} className="text-muted-foreground/40 transition-colors group-hover/sort:text-muted-foreground/80" />;
  return dir === "asc"
    ? <ArrowUp size={11} className="text-primary" />
    : <ArrowDown size={11} className="text-primary" />;
}

export default function PortfolioOverview() {  const { data: projects = [], isLoading } = useListProjects();
  const { data: users = [] } = useListUsers();
  const { data: charters = [] } = useListCharters();
  const { data: summary } = useGetDashboardSummary();
  const [, setLocation] = useLocation();

  // Latest delay/off-track justification per project — drives the Justification
  // column in the Portfolio Summary (same source + request flow as the Projects
  // board's column).
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

  // Leadership roster — the CMD and the 13 CXOs / function heads reporting to
  // them, enriched from the master DB (designation / email / photo).
  const { data: leadership } = useQuery({
    queryKey: ["/api/leadership/cmd-reports"],
    queryFn: async () => {
      const r = await fetch("/api/leadership/cmd-reports");
      if (!r.ok) return { cmd: null, reports: [] } as { cmd: Leader | null; reports: Leader[] };
      return r.json() as Promise<{ cmd: Leader | null; reports: Leader[] }>;
    },
  });

  // "Request justification" — for a delayed/off-track project with no recorded
  // justification, ping the owner via in-app notification + branded email.
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

  // All tasks across projects — drives the Delivery bar's completion % and the
  // hover-card breakdown (same source the 5191 portfolio board uses).
  const { data: allTasks = [] } = useQuery({
    queryKey: ["/api/tasks", "all"],
    queryFn: async () => {
      const r = await fetch("/api/tasks");
      if (!r.ok) return [] as Array<{ projectId?: number | null; status?: string | null }>;
      return r.json() as Promise<Array<{ projectId?: number | null; status?: string | null }>>;
    },
  });
  const taskAgg = useMemo(() => {
    const m = new Map<number, TaskAgg>();
    for (const t of allTasks as Array<{ projectId?: number | null; status?: string | null }>) {
      if (t.projectId == null) continue;
      const a = m.get(t.projectId) ?? { total: 0, done: 0, in_progress: 0, delayed: 0, on_hold: 0, not_started: 0 };
      a.total++;
      switch (t.status) {
        case "completed": a.done++; break;
        case "in_progress": a.in_progress++; break;
        case "delayed": a.delayed++; break;
        case "on_hold": a.on_hold++; break;
        default: a.not_started++; break;
      }
      m.set(t.projectId, a);
    }
    return m;
  }, [allTasks]);

  const [filters, setFilters] = useState<Record<string, string>>({});
  const handleFilter = (k: string, v: string) => setFilters(f => ({ ...f, [k]: v }));

  // Collapsible top bands — collapse to bring the Portfolio Summary into view.
  const [metricsOpen, setMetricsOpen] = useState(true);
  const [chartsOpen, setChartsOpen] = useState(true);
  const [cxoOpen, setCxoOpen] = useState(false);

  // Portfolio Summary toolbar — free-text search + sortable columns.
  type SummarySortKey = "name" | "health" | "progress" | "budgetVar" | "schedVar";
  const [summaryQuery, setSummaryQuery] = useState("");
  const [summarySort, setSummarySort] = useState<{ key: SummarySortKey; dir: "asc" | "desc" }>({ key: "health", dir: "asc" });
  const toggleSummarySort = (key: SummarySortKey) =>
    setSummarySort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "name" ? "asc" : "desc" }));


  const userById = useMemo(() => {
    const m = new Map<number, string>();
    for (const u of users) m.set(u.id, u.name);
    return m;
  }, [users]);

  // Manager profile photos, resolved from the master DB via /api/users.
  const photoById = useMemo(() => {
    const m = new Map<number, string>();
    for (const u of users) {
      const url = (u as unknown as Record<string, unknown>).photoUrl as string | null | undefined;
      if (url) m.set(u.id, url);
    }
    return m;
  }, [users]);

  // Project owner lives on the linked charter (projectOwnerId), not on the
  // project itself — map charterId → ownerId so the summary can show the owner.
  const ownerIdByCharter = useMemo(() => {
    const m = new Map<number, number | null>();
    for (const c of charters as Array<{ id: number; projectOwnerId?: number | null }>) {
      m.set(c.id, c.projectOwnerId ?? null);
    }
    return m;
  }, [charters]);

  const deptOptions = useMemo(() => {
    const derived = projects.map(p => p.function).filter(Boolean) as string[];
    // Always offer HR (plus any departments present in the data). HR is pinned
    // so it can be selected even before an HR project loads; selecting it filters
    // the fetched projects down to function === "HR".
    const d = [...new Set(["HR", ...derived])];
    return d.map(x => ({ value: x, label: x }));
  }, [projects]);

  const filtered = useMemo(() => {
    let list = projects;
    if (filters.dept) list = list.filter(p => p.function === filters.dept);
    if (filters.status) list = list.filter(p => p.status === filters.status);
    if (filters.priority) list = list.filter(p => p.priority === filters.priority);
    return list;
  }, [projects, filters]);

  // ── Derived aggregates ──────────────────────────────────────────────────────
  const rows = useMemo(() => filtered.map(p => {
    const budget = (p.capexBudget ?? 0) + (p.opexBudget ?? 0);
    // No per-project actuals in the schema — estimate spend as budget × progress.
    const spend = Math.round(budget * (p.progress ?? 0) / 100);
    // Owner = projectOwnerId on the linked charter (resolved via the project's charterId).
    const charterId = (p as unknown as { charterId?: number | null }).charterId;
    const ownerId = charterId != null ? ownerIdByCharter.get(charterId) ?? null : null;
    return {
      id: p.id,
      name: p.name,
      ownerId,
      owner: ownerId ? (userById.get(ownerId) ?? "—") : "—",
      ownerPhoto: ownerId ? (photoById.get(ownerId) ?? null) : null,
      start: p.startDate, end: p.endDate,
      progress: p.progress ?? 0,
      status: p.status,
      health: classify(p),
      priority: p.priority,
      dept: p.function ?? "—",
      budget, spend,
      // Per-project variance — additive fields the projects API enriches each row with.
      budgetVarPct: (p as unknown as Record<string, unknown>).budgetVariancePct as number | null,
      schedVarDays: (p as unknown as Record<string, unknown>).scheduleVarianceDays as number | null,
    };
  }), [filtered, userById, photoById, ownerIdByCharter]);

  const counts = useMemo(() => {
    const c = { on_track: 0, at_risk: 0, delayed: 0, completed: 0 };
    for (const r of rows) c[r.health]++;
    return c;
  }, [rows]);

  // Portfolio Summary rows — each row tagged with its delivery-health key (the
  // same schedule-health the Delivery bar uses), then filtered by the search box
  // and ordered by the active sort column. Delivery-health drives the ordering
  // priority so the riskiest projects float to the top by default.
  const SUMMARY_HEALTH_ORDER: Record<DeliveryKey, number> = { delayed: 0, off_track: 1, on_track: 2, na: 3 };
  const summaryRows = useMemo(() => {
    const q = summaryQuery.trim().toLowerCase();
    let list = rows.map((r) => ({
      ...r,
      dKey: deliveryHealthKey({ status: r.status, start: r.start, end: r.end, progress: r.progress }, taskAgg.get(r.id)),
    }));
    if (q) list = list.filter((r) =>
      r.name.toLowerCase().includes(q) || r.dept.toLowerCase().includes(q) || r.owner.toLowerCase().includes(q));
    const dir = summarySort.dir === "asc" ? 1 : -1;
    const num = (v: number | null | undefined) => (v == null ? Number.NEGATIVE_INFINITY : v);
    list.sort((a, b) => {
      switch (summarySort.key) {
        case "name": return dir * a.name.localeCompare(b.name);
        case "progress": return dir * (a.progress - b.progress);
        case "budgetVar": return dir * (num(a.budgetVarPct) - num(b.budgetVarPct));
        case "schedVar": return dir * (num(a.schedVarDays) - num(b.schedVarDays));
        case "health":
        default: {
          const d = SUMMARY_HEALTH_ORDER[a.dKey] - SUMMARY_HEALTH_ORDER[b.dKey];
          return dir * (d !== 0 ? d : a.name.localeCompare(b.name));
        }
      }
    });
    return list;
  }, [rows, taskAgg, summaryQuery, summarySort]);

  // Delivery-health tallies for the header summary chips.
  const summaryHealthCounts = useMemo(() => {
    const c = { on_track: 0, off_track: 0, delayed: 0, na: 0 } as Record<DeliveryKey, number>;
    for (const r of summaryRows) c[r.dKey]++;
    return c;
  }, [summaryRows]);

  // Projects attributed to each leader. Two signals, unioned:
  //   1. Project owner — charter.projectOwnerId → pmo_users, matched to the
  //      leader by office email (authoritative when set).
  //   2. Project function — the project's department mapped to the CXO who
  //      heads that function (most projects today carry only this signal).
  const userIdByEmail = useMemo(() => {
    const m = new Map<string, number>();
    for (const u of users) {
      const email = (u as unknown as { email?: string | null }).email;
      if (email) m.set(email.toLowerCase(), u.id);
    }
    return m;
  }, [users]);
  const projectsByLeaderCode = useMemo(() => {
    const reports = leadership?.reports ?? [];
    const ownerToCode = new Map<number, string>();
    for (const l of reports) {
      const uid = l.officeEmail ? userIdByEmail.get(l.officeEmail.toLowerCase()) : undefined;
      if (uid != null) ownerToCode.set(uid, l.code);
    }
    const m = new Map<string, typeof summaryRows>();
    for (const l of reports) m.set(l.code, []);
    for (const r of summaryRows) {
      const code = (r.ownerId != null && ownerToCode.get(r.ownerId)) || leaderCodeForFunction(r.dept);
      if (code && m.has(code)) m.get(code)!.push(r);
    }
    return m;
  }, [summaryRows, leadership, userIdByEmail]);

  // Which leaders are expanded to reveal their project table.
  const [expandedLeaders, setExpandedLeaders] = useState<Set<string>>(new Set());
  const toggleLeader = (code: string) =>
    setExpandedLeaders(prev => { const n = new Set(prev); n.has(code) ? n.delete(code) : n.add(code); return n; });

  // Top Strategic Projects — top 10 active projects by progress, rendered in the
  // drill popup exactly like the chairman/executive dashboard's section.
  const topProjects = useMemo(() =>
    [...projects]
      .filter((p) => p.status === "active")
      .sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0))
      .slice(0, 10)
      .map((p) => ({
        id: p.id,
        name: p.name,
        ragStatus: p.ragStatus ?? "green",
        progress: p.progress ?? 0,
        sponsor: (p as unknown as Record<string, unknown>).projectSponsorName as string | undefined ?? "—",
        end: p.endDate,
      })),
  [projects]);
  // Columns mirror the dashboard's Top Strategic Projects table (RAG badge,
  // progress bar, sponsor, due date).
  const topDrillCols: DrillColumn[] = [
    { key: "name", label: "Project", render: (v) => <span className="font-medium text-foreground truncate block max-w-[200px]">{v as string}</span> },
    { key: "rag", label: "RAG", render: (v) => <RAGBadge status={v as string | null} /> },
    { key: "progress", label: "Progress", render: (v) => (
      <div className="flex items-center gap-2 min-w-[120px]">
        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden min-w-[60px]">
          <div className="h-full rounded-full bg-primary" style={{ width: `${v as number}%` }} />
        </div>
        <span className="text-xs font-bold text-muted-foreground w-8">{v as number}%</span>
      </div>
    ) },
    { key: "sponsor", label: "Sponsor", render: (v) => <span className="text-xs text-muted-foreground truncate block max-w-[120px]">{v as string}</span> },
    { key: "due", label: "Due Date", render: (v) => v ? (
      <span className="text-xs text-muted-foreground flex items-center gap-1"><Clock size={10} /> {v as string}</span>
    ) : <span className="text-xs text-muted-foreground/60">—</span> },
  ];
  const topDrillRows = topProjects.map((p) => ({
    name: p.name, rag: p.ragStatus, progress: p.progress, sponsor: p.sponsor,
    due: p.end ? new Date(p.end).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "",
  }));

  // Issues Requiring Attention — delayed / off-track projects from the dashboard
  // summary; surfaced as a tile whose drill popup lists the data.
  const issues = useMemo(
    () => problemsFromHealth((summary as unknown as { projectHealth?: { offTrackProjects?: unknown[]; delayedProjects?: unknown[] } })?.projectHealth),
    [summary],
  );
  const issuesDrillCols: DrillColumn[] = [
    { key: "name", label: "Project", render: (v) => <span className="font-medium text-foreground truncate block max-w-[200px]">{v as string}</span> },
    { key: "type", label: "Type", render: (v) => (
      <span className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: v === "Delayed" ? "#EF4444" : "#F59E0B" }}>
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: v === "Delayed" ? "#EF4444" : "#F59E0B" }} />{v as string}
      </span>
    ) },
    { key: "detail", label: "Detail", render: (v) => <span className="text-xs text-muted-foreground">{v as string}</span> },
  ];
  const issuesDrillRows = issues.map((p) => ({
    name: p.name,
    type: p.kind === "delayed" ? "Delayed" : "Off Track",
    detail: p.reason ?? (p.kind === "delayed" ? `${p.daysOverdue ?? 0}d overdue` : `${p.behindBy ?? 0}% behind`),
  }));

  const totalBudget = rows.reduce((s, r) => s + r.budget, 0);
  const totalSpend = rows.reduce((s, r) => s + r.spend, 0);
  const usedPct = totalBudget > 0 ? Math.round((totalSpend / totalBudget) * 100) : 0;
  const n = rows.length || 1;

  const statusBars = (Object.keys(HEALTH_META) as Health[]).map(h => ({
    name: HEALTH_META[h].label, value: counts[h], color: HEALTH_META[h].color,
  }));

  const priorityDonut = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.priority, (m.get(r.priority) ?? 0) + 1);
    return [...m.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, v]) => ({ name: k, value: v, color: PRIORITY_COLORS[k] ?? C.grey }));
  }, [rows]);


  const fmtD = (d?: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" }) : "—");

  // ── Drill-down data — the actual rows behind each KPI / chart ──────────────
  const projectDrillCols: DrillColumn[] = [
    { key: "name", label: "Project" },
    { key: "dept", label: "Department" },
    { key: "owner", label: "Owner" },
    { key: "status", label: "Status" },
    { key: "progress", label: "Progress", align: "right", render: (v) => `${v}%` },
    { key: "budget", label: "Budget", align: "right", render: (v) => formatCurrency(Number(v ?? 0)) },
  ];
  const toProjectDrillRow = (r: typeof rows[number]) => ({
    name: r.name, dept: r.dept, owner: r.owner, status: HEALTH_META[r.health].label, progress: r.progress, budget: r.budget,
  });
  const allProjectDrillRows = rows.map(toProjectDrillRow);
  const projectRowsByHealth = (h: Health) => rows.filter((r) => r.health === h).map(toProjectDrillRow);

  const budgetDrillCols: DrillColumn[] = [
    { key: "name", label: "Project" },
    { key: "budget", label: "Budget", align: "right", render: (v) => formatCurrency(Number(v ?? 0)) },
    { key: "spend", label: "Est. Spend", align: "right", render: (v) => formatCurrency(Number(v ?? 0)) },
    { key: "used", label: "% Used", align: "right" },
  ];
  const budgetDrillRows = rows.map((r) => ({
    name: r.name, budget: r.budget, spend: r.spend, used: `${r.budget > 0 ? Math.round((r.spend / r.budget) * 100) : 0}%`,
  }));

  const statusDrillRows = statusBars.map((s) => ({ status: s.name, projects: s.value }));
  const priorityDrillRows = priorityDonut.map((p) => ({ priority: p.name, projects: p.value }));

  // ── Variance / outlook KPIs (same formulas as the Executive dashboard, shown
  // to everyone here). Computed over ACTIVE projects within the current filters.
  const now = new Date();
  const activeFiltered = filtered.filter((p) => p.status === "active");
  const totalPlanned = activeFiltered.reduce((s, p) => s + (p.capexBudget ?? 0) + (p.opexBudget ?? 0), 0);
  const avgProgress = activeFiltered.length > 0 ? activeFiltered.reduce((s, p) => s + (p.progress ?? 0), 0) / activeFiltered.length : 0;
  const estimatedSpend = totalPlanned * (avgProgress / 100);
  const budgetVariancePct = totalPlanned > 0 ? Math.round(((estimatedSpend - totalPlanned * 0.5) / totalPlanned) * 100) : 0;
  const datedActive = activeFiltered.filter((p) => p.startDate && p.endDate);
  const schedVarianceDays = Math.round(datedActive.reduce((s, p) => {
    const start = new Date(p.startDate!), end = new Date(p.endDate!);
    const totalDays = Math.max(1, (end.getTime() - start.getTime()) / 86400000);
    const elapsed = Math.max(0, (now.getTime() - start.getTime()) / 86400000);
    const expected = Math.min(100, (elapsed / totalDays) * 100);
    return s + ((((p.progress ?? 0) - expected) / 100) * totalDays);
  }, 0) / Math.max(1, datedActive.length));
  const upcomingIn30 = activeFiltered.filter((p) => {
    if (!p.endDate) return false;
    const d = new Date(p.endDate);
    return d >= now && d.getTime() <= now.getTime() + 30 * 86400000;
  });

  const schedDrillRows = datedActive.map((p) => {
    const start = new Date(p.startDate!), end = new Date(p.endDate!);
    const totalDays = Math.max(1, (end.getTime() - start.getTime()) / 86400000);
    const elapsed = Math.max(0, (now.getTime() - start.getTime()) / 86400000);
    const expected = Math.min(100, (elapsed / totalDays) * 100);
    const varDays = Math.round((((p.progress ?? 0) - expected) / 100) * totalDays);
    return { name: p.name, progress: `${p.progress ?? 0}%`, expected: `${Math.round(expected)}%`, variance: `${varDays >= 0 ? "+" : ""}${varDays}d` };
  });
  const dueDrillRows = upcomingIn30.map((p) => ({ name: p.name, due: fmtD(p.endDate) }));
  const REVIEW_STAGES = ["parallel_review", "scm_review", "chairman_review", "finance_review", "pmo_review", "submitted"];
  const approvalDrillRows = (summary?.chartersByStatus ?? [])
    .filter((c) => REVIEW_STAGES.includes(c.status))
    .map((c) => ({ stage: c.status.replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase()), count: c.count }));

  if (isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-16 rounded-2xl" />
        <div className="grid grid-cols-2 xl:grid-cols-6 gap-4">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-5 min-w-0 overflow-x-clip">

      {/* Filters */}
      <div className="glass-surface rounded-2xl p-4 ph-rise ph-rise-2">
        <FilterBar
          filters={[
            { key: "dept", label: "Department", options: deptOptions },
            { key: "status", label: "Status", options: STATUS_OPTS },
            { key: "priority", label: "Priority", options: PRIORITY_OPTS },
          ]}
          values={filters}
          onChange={handleFilter}
        />
      </div>

      <CollapsibleSection
        title="Key Metrics"
        subtitle="Portfolio KPIs & variance"
        icon={LayoutGrid}
        open={metricsOpen}
        onToggle={() => setMetricsOpen(o => !o)}
      >
      {/* ── Headline KPIs ────────────────────────────────────────────────
          Total Projects, On Track, At Risk and Delayed are the numbers that tell
          you the health of the portfolio at a glance, so they get the hero
          treatment — larger tiles, a tone wash and a staggered entrance — and
          sit on their own row above the supporting metrics. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="ph-rise">
          <KPITile featured label="Total Projects" value={rows.length} icon={FolderKanban} tone="primary" sub="Matching filters"
            hint={{ footer: "Count of projects matching the current Department / Status / Priority filters. Click for the list." }}
            drill={{ subtitle: "Projects matching the current filters", columns: projectDrillCols, rows: allProjectDrillRows, linkHref: "/projects", linkLabel: "View all projects", emptyText: "No projects match the filters." }} />
        </div>
        <div className="ph-rise ph-rise-2">
          <KPITile featured label="On Track" value={counts.on_track} icon={CheckCircle2} tone="success" valueClassName="text-success" sub={`${Math.round(counts.on_track / n * 100)}% of portfolio`}
            hint={{ rows: [{ label: "Share of portfolio", value: `${Math.round(counts.on_track / n * 100)}%` }], footer: "Projects whose RAG status is Green (not completed). RAG is set on each project." }}
            drill={{ subtitle: "Projects rated on-track (green)", columns: projectDrillCols, rows: projectRowsByHealth("on_track"), linkHref: "/projects", linkLabel: "View all projects", emptyText: "No on-track projects." }} />
        </div>
        <div className="ph-rise ph-rise-3">
          <KPITile featured label="At Risk" value={counts.at_risk} icon={AlertTriangle} tone="warn" valueClassName="text-warn" sub={`${Math.round(counts.at_risk / n * 100)}% of portfolio`}
            hint={{ rows: [{ label: "Share of portfolio", value: `${Math.round(counts.at_risk / n * 100)}%` }], footer: "Projects whose RAG status is Amber — slipping or at over-spend risk." }}
            drill={{ subtitle: "Projects rated at-risk (amber)", columns: projectDrillCols, rows: projectRowsByHealth("at_risk"), linkHref: "/projects", linkLabel: "View all projects", emptyText: "No at-risk projects." }} />
        </div>
        <div className="ph-rise ph-rise-4">
          <KPITile featured label="Delayed" value={counts.delayed} icon={AlertOctagon} tone="danger" valueClassName="text-destructive" sub={`${Math.round(counts.delayed / n * 100)}% of portfolio`}
            hint={{ rows: [{ label: "Share of portfolio", value: `${Math.round(counts.delayed / n * 100)}%` }], footer: "Projects whose RAG status is Red — behind schedule or over budget." }}
            drill={{ subtitle: "Projects rated delayed (red)", columns: projectDrillCols, rows: projectRowsByHealth("delayed"), linkHref: "/projects", linkLabel: "View all projects", emptyText: "No delayed projects." }} />
        </div>
      </div>

      {/* Variance & outlook strip — same four KPIs the Executive dashboard shows,
          surfaced here for everyone. Hover a tile for the formula behind it. */}
      <div className="grid grid-cols-2 xl:grid-cols-6 gap-4">
        <KPITile compact label="Budget Variance" value={`${budgetVariancePct >= 0 ? "+" : ""}${budgetVariancePct}%`} icon={IndianRupee}
          tone={budgetVariancePct > 10 ? "danger" : budgetVariancePct > 0 ? "warn" : "success"}
          trend={budgetVariancePct > 5 ? "down" : budgetVariancePct < -5 ? "up" : "flat"}
          trendLabel={budgetVariancePct > 0 ? "Over baseline" : "Under baseline"}
          hint={{
            rows: [
              { label: "Planned (active)", value: formatCurrency(totalPlanned) },
              { label: "Est. spend", value: formatCurrency(Math.round(estimatedSpend)) },
              { label: "Avg progress", value: `${Math.round(avgProgress)}%` },
            ],
            footer: "(Est. Spend − 50% of Planned) ÷ Planned × 100 · Est. Spend = Planned × Avg Progress%",
          }}
          drill={{ subtitle: "Budget per active project (CapEx + OpEx) feeding the variance", columns: budgetDrillCols, rows: budgetDrillRows, linkHref: "/projects", linkLabel: "View all projects", emptyText: "No project budgets." }} />
        <KPITile compact label="Schedule Variance" value={`${schedVarianceDays >= 0 ? "+" : ""}${schedVarianceDays}d`} icon={Calendar}
          tone={schedVarianceDays < -5 ? "danger" : schedVarianceDays < 0 ? "warn" : "success"}
          trend={schedVarianceDays >= 0 ? "up" : "down"}
          trendLabel={schedVarianceDays >= 0 ? "Ahead of plan" : "Behind plan"}
          hint={{
            rows: [{ label: "Projects with dates", value: datedActive.length }],
            footer: "Avg of (Actual Progress% − Expected Progress%) × Duration · Expected% = Elapsed ÷ Total Days",
          }}
          drill={{ subtitle: "Schedule variance per active project (progress vs elapsed time)", columns: [{ key: "name", label: "Project" }, { key: "progress", label: "Progress", align: "right" }, { key: "expected", label: "Expected", align: "right" }, { key: "variance", label: "Variance", align: "right" }], rows: schedDrillRows, linkHref: "/projects", linkLabel: "View all projects", emptyText: "No projects with start/end dates." }} />
        <KPITile compact label="Due in 30 Days" value={upcomingIn30.length} icon={Clock} tone="amber" sub="Upcoming deadlines"
          hint={{ footer: "Active projects whose planned end date falls within the next 30 days." }}
          drill={{ subtitle: "Active projects due within 30 days", columns: [{ key: "name", label: "Project" }, { key: "due", label: "Due Date" }], rows: dueDrillRows, linkHref: "/projects", linkLabel: "View all projects", emptyText: "No deadlines in the next 30 days." }} />
        <KPITile compact label="Pending Approvals" value={summary?.pendingApprovals ?? 0} icon={FileText} tone="primary" sub="Awaiting action"
          hint={{ footer: "Charters currently sitting in a review stage (submitted → PMO review), awaiting an approver decision." }}
          drill={{ subtitle: "Charters in review stages", columns: [{ key: "stage", label: "Review Stage" }, { key: "count", label: "Charters", align: "right" }], rows: approvalDrillRows, linkHref: "/approvals", linkLabel: "Open approvals queue", emptyText: "No charters awaiting review." }} />
        <KPITile compact label="Top Strategic Projects" value={topProjects.length} icon={Trophy} tone="primary" sub="By progress"
          hint={{ footer: "Top 10 active projects ranked by % progress — same as the Project Hub executive dashboard." }}
          drill={{ title: "Top Strategic Projects", subtitle: "Active projects by progress — with sponsor and next milestone", columns: topDrillCols, rows: topDrillRows, linkHref: "/projects", linkLabel: "View all projects", emptyText: "No active projects." }} />
        <KPITile compact label="Issues Requiring Attention" value={issues.length} icon={AlertCircle} tone={issues.length > 0 ? "danger" : "success"} sub={issues.length > 0 ? "Delayed / off-track" : "All on track"}
          hint={{ footer: "Active projects flagged Delayed (end date passed) or Off Track (progress gap > 15%). Click to see the data." }}
          drill={{ title: "Issues Requiring Attention", subtitle: "Delayed & off-track projects — click a row to open", columns: issuesDrillCols, rows: issuesDrillRows, linkHref: "/projects", linkLabel: "View all projects", emptyText: "No issues — all projects on track." }} />
      </div>

      {/* Budget — a single slim utilization strip, placed below all the KPI
          cards so it spans the full width without crowding the metric tiles. */}
      <Drillable
        drill={{ title: "Budget", subtitle: "Budget vs estimated spend per project", columns: budgetDrillCols, rows: budgetDrillRows, linkHref: "/projects", linkLabel: "View all projects", emptyText: "No project budgets." }}
        className="rounded-xl border border-card-border glass-surface lift-card"
      >
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-2.5">
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="p-1.5 rounded-lg bg-amber-accent/10"><Wallet size={15} className="text-amber-accent" /></div>
            <div className="leading-tight">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Budget Utilization</p>
              <p className="text-[11px] text-muted-foreground">Est. spend across all projects</p>
            </div>
          </div>

          <div className="flex-1 min-w-[150px]">
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${Math.min(100, usedPct)}%` }} />
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">{usedPct}% used (est.)</p>
          </div>

          <div className="flex items-center gap-5 shrink-0">
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Total Budget</p>
              <p className="text-[15px] font-semibold num-tabular text-card-foreground leading-tight">{formatCurrency(totalBudget)}</p>
            </div>
            <div className="w-px h-8 bg-border/70" />
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Budget Used</p>
              <p className="text-[15px] font-semibold num-tabular text-primary leading-tight">{formatCurrency(totalSpend)}</p>
            </div>
          </div>
        </div>
      </Drillable>
      </CollapsibleSection>

      <CollapsibleSection
        title="Charts & Graphs"
        subtitle="Health · Budget · Priority"
        icon={BarChart3}
        open={chartsOpen}
        onToggle={() => setChartsOpen(o => !o)}
      >
      {/* RAG legend — sits above the charts section, right-aligned */}
      <div className="flex flex-wrap justify-end gap-x-4 gap-y-1.5">
        {(Object.keys(HEALTH_META) as Health[]).map(h => (
          <span key={h} className="flex items-center gap-1.5 text-xs" title={HEALTH_META[h].desc}>
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: HEALTH_META[h].color }} />
            <span className="text-muted-foreground">{HEALTH_META[h].label}</span>
          </span>
        ))}
      </div>

      {/* Charts row — Status · Budget vs Spend · Priority mix */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <DashboardCard title="Project Health" subtitle="Health distribution"
          drill={{ subtitle: "Project count by health status", columns: [{ key: "status", label: "Status" }, { key: "projects", label: "Projects", align: "right" }], rows: statusDrillRows, emptyText: "No projects match the filters." }}>
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={statusBars} layout="vertical" margin={{ top: 8, right: 28, bottom: 4, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={72} />
              <Tooltip {...chartTooltipProps} cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }} />
              <Bar dataKey="value" radius={[0, 6, 6, 0]} maxBarSize={28}>
                <LabelList dataKey="value" position="right" style={{ fontSize: 12, fontWeight: 700, fill: "hsl(var(--foreground))" }} />
                {statusBars.map((e, i) => <Cell key={i} fill={e.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </DashboardCard>

        <DashboardCard title="Budget vs Spend" subtitle="Spend estimated as Σ(budget × % complete)"
          drill={{ subtitle: "Budget vs estimated spend, per project", columns: budgetDrillCols, rows: budgetDrillRows, linkHref: "/projects", linkLabel: "View all projects", emptyText: "No project budgets." }}>
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={[{ name: "Budget", v: totalBudget, c: C.indigo }, { name: "Est. Spend", v: totalSpend, c: C.violet }]} layout="vertical" margin={{ top: 8, right: 48, bottom: 4, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `₹${(v / 1e6).toFixed(0)}M`} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={72} />
              <Tooltip {...chartTooltipProps} formatter={(v: number) => [formatCurrency(v), ""]} cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }} />
              <Bar dataKey="v" radius={[0, 6, 6, 0]} maxBarSize={36}>
                <LabelList dataKey="v" position="right" formatter={(v: number) => `₹${(v / 1e6).toFixed(1)}M`} style={{ fontSize: 11, fontWeight: 700, fill: "hsl(var(--foreground))" }} />
                {[C.indigo, C.violet].map((c, i) => <Cell key={i} fill={c} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </DashboardCard>

        <DashboardCard title="Priority Mix" subtitle="Projects by priority band"
          drill={{ subtitle: "Project count by priority band", columns: [{ key: "priority", label: "Priority" }, { key: "projects", label: "Projects", align: "right" }], rows: priorityDrillRows, emptyText: "No projects match the filters." }}>
          <div className="relative">
            <ResponsiveContainer width="100%" height={120}>
              <PieChart>
                <Pie data={priorityDonut} cx="50%" cy="50%" innerRadius={30} outerRadius={46} paddingAngle={3} dataKey="value" nameKey="name">
                  {priorityDonut.map((e, i) => <Cell key={i} fill={e.color} />)}
                </Pie>
                <Tooltip {...chartTooltipProps} />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-2xl font-bold font-mono text-foreground leading-none">{rows.length}</span>
              <span className="text-[10px] text-muted-foreground mt-0.5">Projects</span>
            </div>
          </div>
          <div className="flex justify-center gap-3 mt-1 flex-wrap">
            {priorityDonut.map(d => (
              <span key={d.name} className="flex items-center gap-1.5 text-xs">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: d.color }} />
                <span className="text-muted-foreground">{d.name}</span>
                <span className="font-bold text-foreground">({d.value})</span>
              </span>
            ))}
          </div>
        </DashboardCard>
      </div>
      </CollapsibleSection>

      {/* ── Leadership ─────────────────────────────────────────────────────
          Accordion above the Portfolio Summary — a grouped table (same language
          as the project / task views): one collapsible group per CXO, expanding
          to the projects attributed to them (by owner email, else by function). */}
      <CollapsibleSection
        title="Leadership"
        icon={Crown}
        open={cxoOpen}
        onToggle={() => setCxoOpen(o => !o)}
      >
        <section className="rounded-xl border border-border bg-card shadow-sm overflow-hidden ph-rise">
          <div className="overflow-x-auto">
            <Table className="min-w-[760px]">
              <colgroup>
                <col style={{ width: "40%" }} />
                <col style={{ width: "18%" }} />
                <col style={{ width: "22%" }} />
                <col style={{ width: "20%" }} />
              </colgroup>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40 border-b border-border">
                  {["CXO / Project", "Status", "Progress", "Timeline"].map((h, hi) => (
                    <TableHead key={h} className={`h-9 text-[10px] font-mono uppercase tracking-wider font-semibold text-muted-foreground/70 ${hi === 0 ? "pl-5" : "px-3"} ${hi === 3 ? "pr-5" : ""}`}>{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {(leadership?.reports ?? []).map((l) => {
                  const open = expandedLeaders.has(l.code);
                  const projs = projectsByLeaderCode.get(l.code) ?? [];
                  const dShort = (d?: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" }) : "—");
                  return (
                    <Fragment key={l.code}>
                      {/* CXO group header — click to expand their projects */}
                      <TableRow className="bg-muted/30 hover:bg-muted/40 cursor-pointer border-t-2 border-border" onClick={() => toggleLeader(l.code)}>
                        <TableCell colSpan={4} className="py-2.5 pl-5 pr-5">
                          <div className="flex items-center gap-2.5">
                            {open ? <ChevronDown size={14} className="text-muted-foreground shrink-0" /> : <ChevronRight size={14} className="text-muted-foreground shrink-0" />}
                            <span className="text-[13px] font-semibold text-card-foreground truncate">{l.name}</span>
                            <span className="text-[11.5px] text-muted-foreground truncate">· {l.role}</span>
                            <span className="ml-auto shrink-0 inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground num-tabular">
                              <FolderKanban size={11} /> {projs.length} project{projs.length === 1 ? "" : "s"}
                            </span>
                          </div>
                        </TableCell>
                      </TableRow>

                      {open && projs.length === 0 && (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={4} className="py-3 pl-12 text-[12px] text-muted-foreground/70 italic">No projects attributed to this CXO.</TableCell>
                        </TableRow>
                      )}

                      {open && projs.map((p, pi) => {
                        const dColor = DELIVERY_HEALTH_COLORS[p.dKey];
                        const prog = Math.round(p.progress);
                        const endDate = p.end ? new Date(p.end) : null;
                        const daysLeft = endDate ? Math.ceil((endDate.getTime() - Date.now()) / 86_400_000) : null;
                        const completed = p.status === "completed";
                        const overdue = !completed && daysLeft != null && daysLeft < 0;
                        return (
                          <TableRow
                            key={p.id}
                            onClick={() => setLocation(`/projects/${p.id}`)}
                            className={`group cursor-pointer border-b border-border/40 transition-colors hover:bg-primary/[0.06] ${pi % 2 === 1 ? "bg-muted/10" : ""}`}
                          >
                            <TableCell className="py-2.5 pl-12 pr-3 align-middle">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[12.5px] font-medium text-card-foreground truncate group-hover:text-primary transition-colors">{p.name}</span>
                                <ArrowRight size={11} className="shrink-0 text-primary opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                              </div>
                              <div className="text-[10px] text-muted-foreground truncate">{p.dept}</div>
                            </TableCell>
                            <TableCell className="py-2.5 px-3 align-middle">
                              <HoverHint label={DELIVERY_DESC[p.dKey]}>
                                <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-card-foreground whitespace-nowrap">
                                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: dColor }} />
                                  {DELIVERY_STATUS_LABEL[p.dKey]}
                                </span>
                              </HoverHint>
                            </TableCell>
                            <TableCell className="py-2.5 px-3 align-middle">
                              <div className="flex items-center gap-2">
                                <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden min-w-[48px]">
                                  <div className="h-full rounded-full" style={{ width: `${prog}%`, background: dColor }} />
                                </div>
                                <span className="text-[11px] font-semibold num-tabular w-8 text-right shrink-0 text-card-foreground">{prog}%</span>
                              </div>
                            </TableCell>
                            <TableCell className="py-2.5 px-3 pr-5 align-middle whitespace-nowrap">
                              {(p.start || p.end) ? (
                                <>
                                  <div className="text-[11px] text-card-foreground tabular-nums">{dShort(p.start)} – {dShort(p.end)}</div>
                                  <div className="text-[10px] font-medium">
                                    {completed ? <span style={{ color: C.green }}>Completed</span>
                                      : overdue ? <span style={{ color: C.red }}>{Math.abs(daysLeft!)}d overdue</span>
                                      : daysLeft != null ? <span className="text-muted-foreground">{daysLeft}d left</span>
                                      : null}
                                  </div>
                                </>
                              ) : <span className="text-[11px] text-muted-foreground/40">—</span>}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </Fragment>
                  );
                })}
                {(leadership?.reports ?? []).length === 0 && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={4} className="px-5 py-8 text-center text-sm text-muted-foreground">Leadership roster unavailable.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </section>
      </CollapsibleSection>

      {/* ── Portfolio Summary ──────────────────────────────────────────────
          A calm enterprise data grid — solid surface (no glass / gradient), a
          full-width segmented health bar, search, then a zebra-striped table
          that splits the old delivery bar into discrete Status / Progress /
          Timeline columns. Deliberately a different visual language from the
          KPI cards above. */}
      <section className="rounded-xl border border-border bg-card shadow-sm overflow-hidden ph-rise">
        {/* Header */}
        <div className="px-5 py-4 border-b border-border">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h3 className="text-[15px] font-semibold text-card-foreground tracking-tight">Portfolio Summary</h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {summaryRows.length === rows.length
                  ? `${rows.length} project${rows.length === 1 ? "" : "s"} tracked`
                  : `${summaryRows.length} of ${rows.length} projects shown`}
              </p>
            </div>
            {/* Search */}
            <div className="relative w-full sm:w-72">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 pointer-events-none" />
              <input
                value={summaryQuery}
                onChange={(e) => setSummaryQuery(e.target.value)}
                placeholder="Search projects, owners…"
                className="w-full text-[13px] rounded-md border border-border bg-background pl-9 pr-8 py-2 text-card-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-primary/40 transition-shadow"
              />
              {summaryQuery && (
                <button
                  onClick={() => setSummaryQuery("")}
                  aria-label="Clear search"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground transition-colors"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          {/* Segmented health distribution bar */}
          {summaryRows.length > 0 && (() => {
            const segs = ([
              { k: "on_track", label: "On Track" },
              { k: "off_track", label: "Off Track" },
              { k: "delayed", label: "Delayed" },
              { k: "na", label: "N/A" },
            ] as { k: DeliveryKey; label: string }[]).filter((s) => summaryHealthCounts[s.k] > 0);
            return (
              <div className="mt-4">
                <div className="flex h-2 w-full rounded-full overflow-hidden bg-muted">
                  {segs.map((s) => (
                    <div
                      key={s.k}
                      className="h-full first:rounded-l-full last:rounded-r-full transition-[width] duration-500"
                      style={{ width: `${(summaryHealthCounts[s.k] / summaryRows.length) * 100}%`, background: DELIVERY_HEALTH_COLORS[s.k] }}
                      title={`${s.label}: ${summaryHealthCounts[s.k]}`}
                    />
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mt-2.5">
                  {segs.map((s) => (
                    <span key={s.k} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className="w-2 h-2 rounded-sm" style={{ background: DELIVERY_HEALTH_COLORS[s.k] }} />
                      {s.label}
                      <span className="font-semibold num-tabular text-card-foreground">{summaryHealthCounts[s.k]}</span>
                      <span className="text-muted-foreground/60">· {Math.round((summaryHealthCounts[s.k] / summaryRows.length) * 100)}%</span>
                    </span>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <Table className="min-w-[1000px] table-fixed">
            <colgroup>
              <col style={{ width: "11%" }} />
              <col style={{ width: "19%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "14%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: "8%" }} />
              <col style={{ width: "8%" }} />
            </colgroup>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40 border-b border-border">
                {([
                  { key: "health", label: "Status", align: "left", sortable: true },
                  { key: "name", label: "Project", align: "left", sortable: true },
                  { key: null, label: "Owner", align: "left", sortable: false },
                  { key: "progress", label: "Progress", align: "left", sortable: true },
                  { key: null, label: "Timeline", align: "left", sortable: false },
                  { key: null, label: "Justification", align: "left", sortable: false },
                  { key: "budgetVar", label: "Budget", align: "right", sortable: true },
                  { key: "schedVar", label: "Schedule", align: "right", sortable: true },
                ] as { key: SummarySortKey | null; label: string; align: "left" | "right" | "center"; sortable: boolean }[]).map((c, i) => {
                  const active = c.sortable && summarySort.key === c.key;
                  const alignCls = c.align === "right" ? "justify-end text-right" : c.align === "center" ? "justify-center text-center" : "justify-start text-left";
                  return (
                    <TableHead
                      key={c.label}
                      className={`h-10 text-[10px] font-mono uppercase tracking-wider font-semibold text-muted-foreground/70 ${i === 0 ? "pl-5" : "px-3"} ${i === 7 ? "pr-5" : ""}`}
                    >
                      {c.sortable ? (
                        <button
                          onClick={() => toggleSummarySort(c.key as SummarySortKey)}
                          className={`group/sort inline-flex items-center gap-1.5 w-full ${alignCls} hover:text-foreground transition-colors ${active ? "text-foreground" : ""}`}
                        >
                          {c.label}
                          <SortIcon active={!!active} dir={summarySort.dir} />
                        </button>
                      ) : (
                        <span className={`inline-flex w-full ${alignCls}`}>{c.label}</span>
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            </TableHeader>
            <TableBody>
              {summaryRows.map((r, i) => {
                const dColor = DELIVERY_HEALTH_COLORS[r.dKey];
                const agg = taskAgg.get(r.id);
                const prog = agg && agg.total > 0 ? Math.round((agg.done / agg.total) * 100) : Math.round(r.progress);
                const endDate = r.end ? new Date(r.end) : null;
                const daysLeft = endDate ? Math.ceil((endDate.getTime() - Date.now()) / 86_400_000) : null;
                const completed = r.status === "completed";
                const overdue = !completed && daysLeft != null && daysLeft < 0;
                const dShort = (d?: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "—");
                return (
                  <TableRow
                    key={r.id}
                    onClick={() => setLocation(`/projects/${r.id}`)}
                    className={`group cursor-pointer border-b border-border/40 transition-colors hover:bg-primary/[0.06] ${i % 2 === 1 ? "bg-muted/20" : ""}`}
                  >
                    {/* Status — dot + sentence-case label */}
                    <TableCell className="py-3.5 pl-5 pr-3 align-middle">
                      <HoverHint label={DELIVERY_DESC[r.dKey]}>
                        <span className="inline-flex items-center gap-2 text-[12px] font-medium text-card-foreground whitespace-nowrap">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: dColor, boxShadow: `0 0 0 3px ${dColor}22` }} />
                          {DELIVERY_STATUS_LABEL[r.dKey]}
                        </span>
                      </HoverHint>
                    </TableCell>

                    {/* Project — name + dept · priority (calm inline text, no pill) */}
                    <TableCell className="py-3.5 px-3 align-middle">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[13px] font-medium text-card-foreground truncate group-hover:text-primary transition-colors">{r.name}</span>
                        <ArrowRight size={12} className="shrink-0 text-primary opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5 text-[10.5px] text-muted-foreground truncate">
                        <span className="truncate">{r.dept}</span>
                        {r.priority && <><span className="text-muted-foreground/40">·</span><span className="font-medium" style={{ color: PRIORITY_COLORS[r.priority] ?? C.grey }}>{PRIORITY_LABEL[r.priority] ?? r.priority}</span></>}
                      </div>
                    </TableCell>

                    {/* Owner */}
                    <TableCell className="py-3.5 px-3 align-middle">
                      <div className="flex items-center gap-2 min-w-0">
                        <Avatar name={r.owner} photoUrl={r.ownerPhoto} />
                        <span className="text-[12px] text-muted-foreground truncate">{r.owner}</span>
                      </div>
                    </TableCell>

                    {/* Progress — clean linear bar + % + task count */}
                    <TableCell className="py-3.5 px-3 align-middle">
                      <div className="flex items-center gap-2.5">
                        <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden min-w-[56px]">
                          <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${prog}%`, background: dColor }} />
                        </div>
                        <span className="text-[11px] font-semibold num-tabular w-8 text-right shrink-0 text-card-foreground">{prog}%</span>
                      </div>
                      {agg && agg.total > 0 && (
                        <div className="text-[10px] text-muted-foreground/70 mt-1 num-tabular">{agg.done}/{agg.total} tasks</div>
                      )}
                    </TableCell>

                    {/* Timeline — date range + relative status */}
                    <TableCell className="py-3.5 px-3 align-middle">
                      {(r.start || r.end) ? (
                        <div className="whitespace-nowrap">
                          <div className="text-[11.5px] text-card-foreground tabular-nums">{dShort(r.start)} – {dShort(r.end)}</div>
                          <div className="mt-0.5 text-[10px] font-medium">
                            {completed ? <span style={{ color: C.green }}>Completed</span>
                              : overdue ? <span style={{ color: C.red }}>{Math.abs(daysLeft!)}d overdue</span>
                              : daysLeft != null ? <span className="text-muted-foreground">{daysLeft}d left</span>
                              : null}
                          </div>
                        </div>
                      ) : <span className="text-[11px] text-muted-foreground/40">—</span>}
                    </TableCell>

                    {/* Justification — why the project is delayed / on hold. Shows
                        the recorded reason (hover for full text); for a delayed /
                        off-track project with none yet, a one-click request pings
                        the owner. */}
                    <TableCell className="py-3.5 px-3 align-middle" onClick={(e) => e.stopPropagation()}>
                      {(() => {
                        const j = justByProject.get(r.id);
                        if (j) {
                          return (
                            <HoverHint label={`${j.kind === "delayed" ? "Delay" : "Off-track"} justification${j.by ? ` · by ${j.by}` : ""}: ${j.justification}`}>
                              <span className="block truncate text-[11.5px] text-card-foreground cursor-help">{j.justification}</span>
                            </HoverHint>
                          );
                        }
                        if (r.dKey === "delayed" || r.dKey === "off_track") {
                          const pendingOwner = r.owner && r.owner !== "—" ? r.owner : null;
                          const isRequesting = requesting.has(r.id);
                          const isRequested = requested.has(r.id);
                          return (
                            <div className="flex items-center gap-1.5">
                              <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-600 ring-1 ring-red-200 whitespace-nowrap">
                                Pending from {pendingOwner ?? "Owner"}
                              </span>
                              <HoverHint label={isRequested ? "Reminder sent to the owner" : `Request justification from ${pendingOwner ?? "the owner"} (email + notification)`}>
                                <button
                                  type="button"
                                  aria-label="Request justification from the owner"
                                  disabled={isRequesting || isRequested}
                                  onClick={(e) => { e.stopPropagation(); void requestJustification(r.id); }}
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
                          );
                        }
                        return <span className="text-[11px] text-muted-foreground/40">—</span>;
                      })()}
                    </TableCell>

                    {/* Budget variance */}
                    <TableCell className="py-3.5 px-3 text-right tabular-nums whitespace-nowrap font-semibold text-[12px] align-middle">
                      {r.budgetVarPct == null ? <span className="text-muted-foreground/40 font-medium">—</span> : (
                        <span className="inline-flex items-center justify-end gap-0.5" style={{ color: r.budgetVarPct > 0 ? C.red : r.budgetVarPct < 0 ? C.green : undefined }}>
                          {r.budgetVarPct > 0 ? <ArrowUp size={11} /> : r.budgetVarPct < 0 ? <ArrowDown size={11} /> : null}
                          {r.budgetVarPct > 0 ? "+" : ""}{r.budgetVarPct}%
                        </span>
                      )}
                    </TableCell>

                    {/* Schedule variance */}
                    <TableCell className="py-3.5 px-3 pr-5 text-right tabular-nums whitespace-nowrap font-semibold text-[12px] align-middle">
                      {r.schedVarDays == null ? <span className="text-muted-foreground/40 font-medium">—</span> : (
                        <span className="inline-flex items-center justify-end gap-0.5" style={{ color: r.schedVarDays < 0 ? C.red : r.schedVarDays > 0 ? C.green : undefined }}>
                          {r.schedVarDays > 0 ? <ArrowUp size={11} /> : r.schedVarDays < 0 ? <ArrowDown size={11} /> : null}
                          {r.schedVarDays > 0 ? "+" : ""}{r.schedVarDays}d
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {summaryRows.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={8} className="py-12 text-center">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground/70">
                      <Search size={22} className="text-muted-foreground/40" />
                      <p className="text-sm">
                        {summaryQuery ? `No projects match “${summaryQuery}”` : "No projects match the current filters"}
                      </p>
                      {summaryQuery && (
                        <button onClick={() => setSummaryQuery("")} className="text-[12px] font-medium text-primary hover:underline">
                          Clear search
                        </button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
            {summaryRows.length > 0 && (
              <TableFooter className="bg-muted/30">
                <TableRow className="hover:bg-transparent border-t border-border">
                  <TableCell colSpan={4} className="py-3 pl-5 align-middle">
                    <span className="inline-flex items-center gap-2 text-[11px] font-normal text-muted-foreground">
                      <Users size={13} className="text-muted-foreground/70" />
                      Showing <span className="font-semibold text-card-foreground num-tabular">{summaryRows.length}</span>
                      {summaryRows.length !== rows.length && <> of <span className="font-semibold text-card-foreground num-tabular">{rows.length}</span></>} projects
                    </span>
                  </TableCell>
                  <TableCell colSpan={4} className="py-3 pr-5 align-middle">
                    <div className="flex flex-wrap items-center justify-end gap-x-5 gap-y-1 text-[11px] font-normal">
                      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                        Total Budget
                        <span className="font-bold num-tabular text-card-foreground">{formatCurrency(totalBudget)}</span>
                      </span>
                      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                        Est. Spend
                        <span className="font-bold num-tabular text-card-foreground">{formatCurrency(totalSpend)}</span>
                        <span className="text-muted-foreground/60">({usedPct}%)</span>
                      </span>
                    </div>
                  </TableCell>
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </div>
      </section>

    </div>
  );
}
