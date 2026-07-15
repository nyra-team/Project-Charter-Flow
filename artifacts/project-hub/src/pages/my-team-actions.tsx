import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Users, ArrowLeft, Loader2, ChevronUp, ChevronDown, Search, X, Building2, AlertTriangle, CalendarClock, CheckCircle2, Network, LayoutList, ArrowUpRight } from "lucide-react";
import { useAuth } from "../auth/context";
import { useListProjects, useListUsers, useListCharters } from "@workspace/api-client-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TeamOverview } from "@/components/TeamOverview";
import { buildTeamOverview } from "@/lib/teamOverviewData";

// My Team Actions — per-login reporting org chart. Centres on whoever is logged
// in (manager chain above, direct reports below) and lets you drill the tree by
// clicking a report; clicking a person opens their complete PMO workload —
// projects, milestones, tasks and subtasks, each split total / overdue / done,
// with the overdue items listed.
//
// The reporting line comes from the master DB's l1_manager_code chain, and every
// number is PMO's OWN work. All of it is served by PMO's api-server (routes/org.ts).
// It used to call the CXO/Action-Centre backend through a dev-only vite proxy,
// which is why the page died with "Failed to fetch" whenever that separate server
// wasn't running — and why it never worked in prod at all.

type Tasks = {
  total: number;
  done: number;
  inProgress: number;
  delay: number;
  onHold: number;
  notStarted: number;
};

type Person = {
  employee_code: string;
  name: string;
  designation: string | null;
  function: string | null;
  unit: string | null;
  photo_url: string | null;
  email: string | null;
  ownerId: number | null;
  tasks: Tasks | null;
};

type Org = { target: Person; managers: Person[]; reports: Person[]; isSelf: boolean };

type OwnerSummary = {
  ownerId: number;
  empCode: string | null;
  name: string;
  department: string | null;
  total: number;
  done: number;
  inProgress: number;
  delay: number;
  onHold: number;
  notStarted: number;
};

// Colour per work level, so the overdue list reads at a glance.
const ITEM_TONE: Record<string, string> = {
  project: "bg-violet-50 text-violet-700",
  milestone: "bg-blue-50 text-blue-700",
  task: "bg-slate-100 text-slate-600",
  subtask: "bg-slate-50 text-slate-500",
};

// One person's whole PMO workload (GET /api/org/team-work/:code).
type WorkTally = { total: number; overdue: number; completed: number };
type OverdueItem = {
  type: "project" | "milestone" | "task" | "subtask";
  id: number;
  name: string;
  project: string | null;
  dueDate: string | null;
};
type WorkItem = OverdueItem & { status: string; overdue: boolean };
type TeamWork = {
  empCode: string;
  name: string;
  department?: string | null;
  projects: WorkTally;
  milestones: WorkTally;
  tasks: WorkTally;
  subtasks: WorkTally;
  /** Every item they own (overdue-first); absent on an older API build. */
  items?: WorkItem[];
  overdueItems: OverdueItem[];
};

// Local avatar (CXO's UserAvatar isn't in PMO) — photo if present, else a blue
// gradient initials bubble matching the CXO look.
function Avatar({ url, name, className = "", fallbackClassName = "" }: { url?: string | null; name: string; className?: string; fallbackClassName?: string }) {
  const initials =
    (name || "?").trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase() || "?";
  if (url) return <img src={url} alt={name} className={`object-cover ${className}`} />;
  return <span className={`inline-flex items-center justify-center ${className} ${fallbackClassName}`}>{initials}</span>;
}

// Compact action-item progress strip — done/total bar + a delay flag.
// Clicking anywhere on the strip opens the person's full action list.
function TaskProgress({ t, onOverdueClick }: { t: Tasks; onOverdueClick?: () => void }) {
  if (t.total === 0) return null;
  const pct = Math.round((t.done / t.total) * 100);
  return (
    <div
      className={`mt-1 ${onOverdueClick ? "cursor-pointer rounded-sm hover:bg-slate-100/70" : ""}`}
      {...(onOverdueClick ? {
        role: "button" as const,
        tabIndex: 0,
        title: "View all actions",
        onClick: (e: React.MouseEvent) => { e.stopPropagation(); onOverdueClick(); },
      } : {})}
    >
      <div className="flex items-center justify-between text-[10px] mb-0.5">
        <span className="text-slate-500">
          {t.done}/{t.total} done
          {t.delay > 0 && <span className="text-red-600 font-semibold ml-1.5">{t.delay} overdue</span>}
        </span>
        <span className="text-slate-400 tabular-nums">{pct}%</span>
      </div>
      <div className="h-1 w-full rounded-full bg-slate-100 overflow-hidden">
        <div className="h-full rounded-full bg-green-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Connector({ height = 32 }: { height?: number }) {
  return (
    <div className="flex justify-center" style={{ height }}>
      <div className="w-px bg-border" style={{ height: "100%" }} />
    </div>
  );
}

function PersonCard({
  p,
  variant,
  onClick,
  onOverdue,
  showTasks,
}: {
  p: Person;
  variant: "manager" | "target" | "report";
  onClick?: () => void;
  onOverdue?: () => void;
  showTasks?: boolean;
}) {
  const [, navigate] = useLocation();
  const clickable = !!onClick;
  const tone =
    variant === "target"
      ? "border-primary/40 bg-primary/5 ring-2 ring-primary/20"
      : variant === "manager"
      ? "border-amber-200 bg-amber-50/50"
      : "border-border/50 bg-card";
  const card = (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick && !onOverdue}
      title={clickable && !(showTasks && p.tasks && p.tasks.total > 0) ? `View ${p.name}'s team` : undefined}
      className={[
        "group flex items-center gap-2.5 text-left rounded-xl border px-3 py-2 transition-all w-full h-[84px] overflow-hidden",
        tone,
        clickable ? "cursor-pointer hover:border-primary/30 hover:shadow-md" : "cursor-default",
      ].join(" ")}
    >
      <Avatar
        url={p.photo_url}
        name={p.name}
        className="w-8 h-8 rounded-full text-[10px] shrink-0 border border-border"
        fallbackClassName="bg-gradient-to-br from-blue-500 to-blue-700 text-white font-bold"
      />
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-heading font-semibold text-foreground truncate group-hover:text-primary transition-colors">
          {p.name}
        </p>
        {p.designation && <p className="text-[10px] text-muted-foreground truncate">{p.designation}</p>}
        {(p.function || p.unit) && (
          <p className="text-[9px] text-muted-foreground/50 truncate mt-0.5">
            {[p.function, p.unit].filter(Boolean).join(" · ")}
          </p>
        )}
        {showTasks && p.tasks && <TaskProgress t={p.tasks} onOverdueClick={onOverdue} />}
      </div>
    </button>
  );
  // No hover card here — it used to float above the quick-view modal's overlay
  // as a dark box; the modal itself now shows the full breakdown on click.
  // The top-right redirect opens a dedicated page of every project under this
  // person (shown only when they resolve to a PMO user, i.e. can have projects).
  return (
    <div className="relative group">
      {card}
      {p.ownerId != null && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); navigate(`/people/${p.ownerId}`); }}
          title={`Open all projects under ${p.name}`}
          aria-label={`Open all projects under ${p.name}`}
          className="absolute top-1.5 right-1.5 z-10 inline-flex items-center justify-center w-6 h-6 rounded-md bg-white/90 border border-border/60 text-muted-foreground opacity-70 group-hover:opacity-100 hover:text-primary hover:border-primary/40 shadow-sm transition-all"
        >
          <ArrowUpRight className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

type DirHit = { empCode: string; name: string; designation?: string | null; unit?: string | null; email?: string | null };
function JumpToTeam({ onPick }: { onPick: (code: string) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DirHit[]>([]);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); return; }
    let cancelled = false;
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        // PMO's own directory search (was the CXO backend's /api/kpi-approvers).
        const res = await fetch(`/api/employees/search?q=${encodeURIComponent(q)}&limit=8`, { credentials: "include" });
        const hits = res.ok ? await res.json() : [];
        const mapped: DirHit[] = (Array.isArray(hits) ? hits : [])
          .filter((h: { employeeCode?: string | null }) => !!h.employeeCode)
          .map((h: { employeeCode: string; fullName: string; designation?: string | null; officeEmail?: string | null }) => ({
            empCode: h.employeeCode, name: h.fullName, designation: h.designation ?? null, unit: null, email: h.officeEmail ?? null,
          }));
        if (!cancelled) setResults(mapped);
      } catch { if (!cancelled) setResults([]); }
      finally { if (!cancelled) setBusy(false); }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setResults([]); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div ref={boxRef} className="relative shrink-0">
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-primary/20 bg-card w-56">
        <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="View anyone's team…"
          className="flex-1 text-[12px] bg-transparent outline-none text-foreground placeholder:text-muted-foreground" />
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
          : query && <button type="button" onClick={() => { setQuery(""); setResults([]); }} className="text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5" /></button>}
      </div>
      {results.length > 0 && (
        <div className="absolute right-0 z-30 mt-1 w-64 max-h-60 overflow-auto rounded-xl border border-border bg-card shadow-lg">
          {results.map((h) => (
            <button key={h.empCode} type="button" onClick={() => { onPick(h.empCode); setQuery(""); setResults([]); }}
              className="w-full text-left px-3 py-2 hover:bg-primary/5 border-b border-border/50 last:border-0">
              <div className="text-[12px] font-medium text-foreground">{h.name} <span className="text-[11px] text-muted-foreground">· {h.empCode}</span></div>
              <div className="text-[11px] text-muted-foreground">{[h.designation, h.unit].filter(Boolean).join(" · ") || h.email}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function MyTeamActions() {
  const { profile } = useAuth();
  const employeeCode = profile?.employee_code ?? null;
  const isSuperAdmin = !!profile?.is_super_admin;
  const [code, setCode] = useState<string | null>(null);
  const [org, setOrg] = useState<Org | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  // Top-level view: the reporting Org chart (default) or the flat, chart-able
  // Team Overview (people as accordions → their projects).
  const [topTab, setTopTab] = useState<"org" | "overview">("org");
  const [deptView, setDeptView] = useState("");
  const [owners, setOwners] = useState<OwnerSummary[]>([]);
  useEffect(() => {
    fetch("/api/org/team-summary")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setOwners(Array.isArray(d) ? d : []))
      .catch(() => setOwners([]));
  }, []);

  // Team Overview data — every person who owns a project or holds a task, rolled
  // up from PMO's own projects + users + tasks (not the reporting chain), so it's
  // populated for everyone, including PMs/admins with no direct reports.
  const { data: allProjects = [] } = useListProjects();
  const { data: allUsers = [] } = useListUsers();
  const { data: allCharters = [] } = useListCharters();
  const { data: allTasks = [] } = useQuery({
    queryKey: ["/api/tasks", "all"],
    queryFn: async () => {
      const r = await fetch("/api/tasks", { credentials: "include" });
      return r.ok ? await r.json() : [];
    },
  });
  const overviewAll = useMemo(
    () => buildTeamOverview(allProjects as never[], allUsers as never[], allTasks as never[], allCharters as never[]),
    [allProjects, allUsers, allTasks, allCharters],
  );

  // The reporting team the Overview is scoped to: the caller's immediate manager,
  // themselves, and their WHOLE downward subtree (direct reports + reports of
  // reports, transitively). Descendants come from team-summary (`owners`), the
  // manager + self from the org chain. Matched to the rollup by pmo_user id.
  const teamMemberIds = useMemo(() => {
    const s = new Set<number>();
    const add = (id?: number | null) => { if (id != null) s.add(id); };
    if (org) {
      add(org.target.ownerId);
      add(org.managers[org.managers.length - 1]?.ownerId); // immediate manager
      org.reports.forEach((r) => add(r.ownerId));
    }
    owners.forEach((o) => add(o.ownerId));
    return s;
  }, [org, owners]);
  const overviewScoped = useMemo(() => overviewAll.filter((p) => teamMemberIds.has(p.id)), [overviewAll, teamMemberIds]);

  type Quick = { ownerId: number | null; empCode: string | null; name: string; department: string | null; delay: number; total: number; canViewTeam: boolean };
  const [quick, setQuick] = useState<Quick | null>(null);
  // The person's complete PMO picture — projects, milestones, tasks and subtasks,
  // each split total / overdue / completed, plus the overdue items themselves.
  const [work, setWork] = useState<TeamWork | null>(null);
  useEffect(() => {
    if (!quick?.empCode) { setWork(null); return; }
    let alive = true;
    setWork(null);
    fetch(`/api/org/team-work/${encodeURIComponent(quick.empCode)}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: TeamWork | null) => alive && setWork(d))
      .catch(() => alive && setWork(null));
    return () => { alive = false; };
  }, [quick]);

  const openPerson = (p: Person, canViewTeam = true) => {
    const owner = owners.find((o) => o.empCode && p.employee_code && o.empCode === p.employee_code);
    setQuick({
      ownerId: p.ownerId ?? owner?.ownerId ?? null,
      empCode: p.employee_code || null,
      name: p.name,
      department: p.function ?? owner?.department ?? null,
      delay: p.tasks?.delay ?? owner?.delay ?? 0,
      total: p.tasks?.total ?? owner?.total ?? 0,
      canViewTeam,
    });
  };

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setShowAll(false);
    fetch(`/api/org${code ? `/${encodeURIComponent(code)}` : ""}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || "Failed to load");
        return r.json();
      })
      .then((data: Org) => alive && setOrg(data))
      .catch((e) => alive && setError(e.message || "Failed to load the org chart"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [code]);

  const orgDepts = Array.from(
    new Set([...owners.map((o) => o.department), ...overviewScoped.map((o) => o.department)].filter(Boolean) as string[]),
  ).sort();
  const deptPeople = deptView
    ? owners.filter((o) => o.department === deptView).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
    : [];
  const deptRoll = deptPeople.reduce(
    (a, o) => ({ total: a.total + o.total, done: a.done + o.done, delay: a.delay + o.delay }),
    { total: 0, done: 0, delay: 0 }
  );

  // People shown in the Team Overview, narrowed to one department when that
  // filter is set.
  const overviewPeople = deptView ? overviewScoped.filter((p) => p.department === deptView) : overviewScoped;
  return (
    <div className="w-full pt-3 md:pt-4">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <span className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <Users className="w-5 h-5" />
          </span>
          <div>
            <h1 data-tour="mta-title" className="text-[16px] font-heading font-bold text-foreground leading-tight">My Team Actions</h1>
            <p className="text-[12px] text-muted-foreground">Your reporting line and team — click anyone to explore their team.</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="inline-flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5">
            <button
              type="button"
              onClick={() => setTopTab("org")}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] font-semibold transition-colors ${topTab === "org" ? "bg-white text-primary shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
            >
              <Network className="w-3.5 h-3.5" /> Org
            </button>
            <button
              type="button"
              onClick={() => setTopTab("overview")}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] font-semibold transition-colors ${topTab === "overview" ? "bg-white text-primary shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
            >
              <LayoutList className="w-3.5 h-3.5" /> Overview
            </button>
          </div>
          {orgDepts.length > 0 && (
            <Select value={deptView || "__all"} onValueChange={(v) => setDeptView(v === "__all" ? "" : v)}>
              <SelectTrigger className="w-[200px] h-9 text-[12px]">
                <Building2 className={`w-3.5 h-3.5 shrink-0 mr-1 ${deptView ? "text-blue-600" : "text-slate-400"}`} />
                <SelectValue placeholder="All departments" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All departments</SelectItem>
                {orgDepts.map((d) => (
                  <SelectItem key={d} value={d}>{d}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {isSuperAdmin && <JumpToTeam onPick={setCode} />}
          {org && !org.isSelf && (
            <button
              onClick={() => setCode(null)}
              className="inline-flex items-center gap-1.5 text-[12px] font-medium text-primary hover:text-primary/80 px-3 py-1.5 rounded-lg hover:bg-primary/10 border border-primary/20 shrink-0"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back to me
            </button>
          )}
        </div>
      </div>

      {topTab === "overview" && <TeamOverview people={overviewPeople} />}

      {topTab === "org" && deptView && (
        <div className="rounded-xl border border-border/40 bg-muted/40 p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <p className="text-[11px] font-heading font-bold uppercase tracking-wider text-muted-foreground/60">
              {deptPeople.length} in {deptView}
            </p>
            {deptRoll.total > 0 && (
              <span className="text-[11px] text-slate-500">
                {deptRoll.done}/{deptRoll.total} done
                {deptRoll.delay > 0 && <span className="text-red-600 font-semibold ml-1.5">{deptRoll.delay} overdue</span>}
              </span>
            )}
          </div>
          {deptPeople.length === 0 ? (
            <p className="text-[12px] text-slate-400 text-center py-6">No reportees in this department.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
              {deptPeople.map((o) => (
                <PersonCard
                  key={o.empCode || o.name}
                  p={{
                    employee_code: o.empCode || "",
                    name: o.name,
                    designation: null,
                    function: o.department,
                    unit: null,
                    photo_url: null,
                    email: null,
                    ownerId: o.ownerId,
                    tasks: { total: o.total, done: o.done, inProgress: o.inProgress, delay: o.delay, onHold: o.onHold, notStarted: o.notStarted },
                  }}
                  variant="report"
                  showTasks
                  onClick={o.empCode ? () => setCode(o.empCode!) : undefined}
                  onOverdue={() => setQuick({ ownerId: o.ownerId, empCode: o.empCode, name: o.name, department: o.department, delay: o.delay, total: o.total, canViewTeam: true })}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {topTab === "org" && !deptView && loading && (
        <div className="flex items-center justify-center py-20 text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      )}

      {topTab === "org" && !deptView && !loading && error && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-700 text-[13px] px-4 py-3">
          {error}
        </div>
      )}

      {topTab === "org" && !deptView && !loading && !error && org && (() => {
        const visible = showAll ? org.reports : org.reports.slice(0, 8);
        const left = visible.filter((_, i) => i % 2 === 0);
        const right = visible.filter((_, i) => i % 2 === 1);
        const card = (r: Person) => (
          <div key={r.employee_code} className="w-full sm:w-[260px]">
            <PersonCard p={r} variant="report" onClick={() => setCode(r.employee_code)} onOverdue={() => openPerson(r)} showTasks />
          </div>
        );
        const callerIdx = org.managers.findIndex((m) => m.employee_code === employeeCode);
        const mgrClickable = (idx: number) => isSuperAdmin || (callerIdx !== -1 && idx >= callerIdx);
        return (
          <div className="flex flex-col items-center">
            {org.managers.map((m, idx) => (
              <div key={m.employee_code} className="w-full sm:w-[260px] flex flex-col items-center">
                <div className="w-full">
                  <PersonCard
                    p={m}
                    variant="manager"
                    showTasks
                    onClick={mgrClickable(idx) ? () => setCode(m.employee_code) : undefined}
                    onOverdue={() => openPerson(m, mgrClickable(idx))}
                  />
                </div>
                <Connector height={16} />
              </div>
            ))}

            <div className="w-full sm:w-[260px]">
              <PersonCard p={org.target} variant="target" showTasks={!org.isSelf} onOverdue={() => openPerson(org.target, false)} />
            </div>

            {org.reports.length > 0 ? (
              <>
                <Connector height={16} />
                <div className="w-full sm:w-fit mx-auto rounded-xl border border-border/40 bg-muted/40 p-3 sm:p-4">
                  <p className="text-[10px] font-heading font-bold uppercase tracking-wider text-muted-foreground/50 mb-2 text-center">
                    {org.reports.length} Direct Report{org.reports.length === 1 ? "" : "s"}
                  </p>
                  <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 justify-center items-start">
                    <div className="flex flex-col gap-2 w-full sm:hidden">{visible.map(card)}</div>
                    <div className="hidden sm:flex flex-col gap-2">{left.map(card)}</div>
                    {right.length > 0 && <div className="hidden sm:flex flex-col gap-2">{right.map(card)}</div>}
                  </div>
                  {org.reports.length > 8 && (
                    <div className="flex justify-center mt-3">
                      <button
                        onClick={() => setShowAll((v) => !v)}
                        className="inline-flex items-center gap-1 text-xs font-heading font-semibold text-primary hover:text-primary/80 transition-colors"
                      >
                        {showAll ? <><ChevronUp className="w-3.5 h-3.5" /> Show less</> : <><ChevronDown className="w-3.5 h-3.5" /> Show all {org.reports.length}</>}
                      </button>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <Connector height={20} />
                <p className="text-[11px] text-slate-400">No direct reports</p>
              </>
            )}
          </div>
        );
      })()}

      {quick && (() => {
        const todayStr = new Date().toISOString().slice(0, 10);
        const daysLate = (due: string | null) => {
          if (!due) return 0;
          const d = Math.floor((Date.parse(todayStr) - Date.parse(due)) / 86400000);
          return d > 0 ? d : 0;
        };
        return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 animate-[fadeIn_120ms_ease-out]" onClick={() => setQuick(null)}>
          <div className="relative w-full max-w-lg rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/5 overflow-hidden flex flex-col max-h-[85vh]" onClick={(e) => e.stopPropagation()}>
            <div className="h-1 bg-gradient-to-r from-red-500 via-rose-500 to-red-500" />

            <div className="flex items-start gap-3 px-5 py-4 border-b border-slate-100">
              <Avatar
                url={null}
                name={quick.name}
                className="w-11 h-11 rounded-xl text-[13px] shrink-0 border border-slate-200"
                fallbackClassName="bg-gradient-to-br from-slate-800 to-slate-600 text-white font-bold"
              />
              <div className="min-w-0 flex-1">
                <h3 className="text-[15px] font-heading font-bold text-slate-900 truncate leading-tight">{quick.name}</h3>
                <p className="text-[12px] text-slate-500 truncate">{quick.department || "—"}</p>
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 text-red-600 text-[11px] font-semibold">
                    <AlertTriangle className="w-3 h-3" /> {quick.delay} overdue
                  </span>
                  <span className="text-[11px] text-slate-400">of {quick.total} total</span>
                </div>
              </div>
              <button onClick={() => setQuick(null)} aria-label="Close" className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-auto px-3 py-3 bg-slate-50/50">
              {work === null ? (
                <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
              ) : (
                <>
                  {/* The whole workload at a glance — every level, total vs
                      overdue vs completed. */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 mb-3">
                    {([
                      { label: "Projects", t: work.projects },
                      { label: "Milestones", t: work.milestones },
                      { label: "Tasks", t: work.tasks },
                      { label: "Subtasks", t: work.subtasks },
                    ] as const).map(({ label, t }) => (
                      <div key={label} className="rounded-xl border border-slate-200 bg-white px-2.5 py-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
                        <p className="text-[18px] font-bold leading-tight text-slate-800 tabular-nums">{t.total}</p>
                        <div className="mt-0.5 flex items-center gap-2 text-[11px] tabular-nums">
                          <span className={t.overdue > 0 ? "font-semibold text-red-600" : "text-slate-300"}>{t.overdue} overdue</span>
                          <span className={t.completed > 0 ? "font-semibold text-emerald-600" : "text-slate-300"}>{t.completed} done</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {(() => {
                    // Full workload, overdue-first. Older API builds only send
                    // overdueItems — degrade to that rather than an empty list.
                    const items: WorkItem[] = work.items ?? work.overdueItems.map((it) => ({ ...it, status: "", overdue: true }));
                    const statusLabel = (s: string) =>
                      s === "in_progress" ? "In progress" : s === "on_hold" ? "On hold" : s === "not_started" ? "Not started" : s.replace(/_/g, " ");
                    return (
                      <>
                        <p className="px-0.5 mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                          All actions ({items.length})
                        </p>
                        {items.length === 0 ? (
                          <div className="py-10 text-center">
                            <div className="mx-auto w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center mb-2.5">
                              <CheckCircle2 className="w-6 h-6 text-emerald-500" />
                            </div>
                            <p className="text-[13px] font-semibold text-slate-700">Nothing assigned</p>
                            <p className="text-[12px] text-slate-400">No projects, milestones or tasks on their plate.</p>
                          </div>
                        ) : (
                          <ul className="flex flex-col gap-1.5">
                            {items.map((it) => {
                              const done = it.status === "completed";
                              const late = it.overdue ? daysLate(it.dueDate) : 0;
                              return (
                                <li key={`${it.type}-${it.id}`} className="rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 hover:border-slate-300 hover:shadow-sm transition-all">
                                  <div className="flex items-start gap-2.5">
                                    <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${it.overdue ? "bg-red-500" : done ? "bg-emerald-500" : "bg-slate-300"}`} />
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-1.5 flex-wrap">
                                        <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${ITEM_TONE[it.type]}`}>{it.type}</span>
                                        <p className={`text-[13px] font-medium leading-snug ${done ? "text-slate-400 line-through decoration-slate-300" : "text-slate-800"}`}>{it.name}</p>
                                      </div>
                                      <div className="mt-1 flex items-center gap-2 flex-wrap text-[11px]">
                                        {done ? (
                                          <span className="inline-flex items-center gap-1 text-emerald-600 font-semibold">
                                            <CheckCircle2 className="w-3 h-3" /> Done
                                          </span>
                                        ) : it.overdue ? (
                                          <>
                                            {it.dueDate && (
                                              <span className="inline-flex items-center gap-1 text-red-600 font-semibold">
                                                <CalendarClock className="w-3 h-3" /> Due {it.dueDate}
                                              </span>
                                            )}
                                            {late > 0 && (
                                              <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-red-50 text-red-600 font-semibold tabular-nums">{late}d late</span>
                                            )}
                                          </>
                                        ) : (
                                          <>
                                            {it.status && <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-500 font-medium">{statusLabel(it.status)}</span>}
                                            {it.dueDate && (
                                              <span className="inline-flex items-center gap-1 text-slate-500">
                                                <CalendarClock className="w-3 h-3" /> Due {it.dueDate}
                                              </span>
                                            )}
                                          </>
                                        )}
                                        {it.project && (
                                          <span className="inline-flex items-center gap-1 text-slate-400 truncate">
                                            <span className="w-1 h-1 rounded-full bg-slate-300" /> {it.project}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </>
                    );
                  })()}
                </>
              )}
            </div>

            {quick.empCode && quick.canViewTeam && (
              <div className="px-5 py-3 border-t border-slate-100 flex justify-end bg-white">
                <button
                  onClick={() => { const c = quick.empCode!; setQuick(null); setDeptView(""); setCode(c); }}
                  className="inline-flex items-center gap-1.5 text-[12px] font-medium text-primary hover:text-primary/80 px-3 py-1.5 rounded-lg hover:bg-primary/10 border border-primary/20 transition-colors"
                >
                  <Users className="w-3.5 h-3.5" /> View team
                </button>
              </div>
            )}
          </div>
        </div>
        );
      })()}
    </div>
  );
}
