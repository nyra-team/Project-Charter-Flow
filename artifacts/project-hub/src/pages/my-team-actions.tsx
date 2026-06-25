import { useEffect, useRef, useState } from "react";
import { Users, ArrowLeft, Loader2, ChevronUp, ChevronDown, Search, X, Building2, AlertTriangle, CalendarClock, CheckCircle2 } from "lucide-react";
import { useAuth } from "../auth/context";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HoverHint, type HoverHintRow } from "@/components/ui-kit/HoverHint";

// My Team Actions — per-login reporting org chart, ported verbatim from the CXO
// Action Centre (apps/cxo PeopleDirectory). Centres on whoever is logged in
// (manager chain above, direct reports below) and lets you drill the tree by
// clicking a report. Read-only, drawn live from the master DB's l1_manager_code
// chain + the Action Centre's action-item progress — all served by the CXO
// backend. The vite proxy routes /api/org, /api/action-items and
// /api/kpi-approvers to that backend; everything else stays on PMO :3008.
// ponytail: a copy, not a shared package — only one consumer in PMO; lift to
// packages/shared if a third app ever needs it.

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

type OwnerTask = { id: number; title: string; dueDate: string | null; status: string; meeting: string | null };

// Local avatar (CXO's UserAvatar isn't in PMO) — photo if present, else a blue
// gradient initials bubble matching the CXO look.
function Avatar({ url, name, className = "", fallbackClassName = "" }: { url?: string | null; name: string; className?: string; fallbackClassName?: string }) {
  const initials =
    (name || "?").trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase() || "?";
  if (url) return <img src={url} alt={name} className={`object-cover ${className}`} />;
  return <span className={`inline-flex items-center justify-center ${className} ${fallbackClassName}`}>{initials}</span>;
}

// Compact action-item progress strip — done/total bar + a delay flag.
function TaskProgress({ t, onOverdueClick }: { t: Tasks; onOverdueClick?: () => void }) {
  if (t.total === 0) return null;
  const pct = Math.round((t.done / t.total) * 100);
  return (
    <div className="mt-1">
      <div className="flex items-center justify-between text-[10px] mb-0.5">
        <span className="text-slate-500">
          {t.done}/{t.total} done
          {t.delay > 0 && (onOverdueClick ? (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); onOverdueClick(); }}
              title="View overdue tasks"
              className="text-red-600 font-semibold ml-1.5 underline decoration-dotted underline-offset-2 cursor-pointer hover:text-red-700"
            >{t.delay} overdue</span>
          ) : (
            <span className="text-red-600 font-semibold ml-1.5">{t.delay} overdue</span>
          ))}
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
  const clickable = !!onClick;
  const tone =
    variant === "target"
      ? "border-primary/40 bg-primary/5 ring-2 ring-primary/20"
      : variant === "manager"
      ? "border-amber-200 bg-amber-50/50"
      : "border-border/50 bg-card";
  const t = showTasks ? p.tasks : null;
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
  if (!t || t.total === 0) return card;
  const pct = Math.round((t.done / t.total) * 100);
  const rows = [
    { label: "Done", value: t.done },
    { label: "In progress", value: t.inProgress },
    { label: "Not started", value: t.notStarted },
    t.onHold > 0 && { label: "On hold", value: t.onHold },
    t.delay > 0 && { label: "Overdue", value: <span className="text-red-600">{t.delay}</span> },
  ].filter(Boolean) as HoverHintRow[];
  return (
    <HoverHint
      title={`${t.total} action${t.total === 1 ? "" : "s"} · ${pct}%`}
      rows={rows}
      className="max-w-[160px]"
    >
      {card}
    </HoverHint>
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
        const res = await fetch(`/api/kpi-approvers/search?q=${encodeURIComponent(q)}`, { credentials: "include" });
        const hits = res.ok ? await res.json() : [];
        if (!cancelled) setResults(Array.isArray(hits) ? hits : []);
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

  const [deptView, setDeptView] = useState("");
  const [owners, setOwners] = useState<OwnerSummary[]>([]);
  useEffect(() => {
    fetch("/api/org/team-summary")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setOwners(Array.isArray(d) ? d : []))
      .catch(() => setOwners([]));
  }, []);

  type Quick = { ownerId: number | null; empCode: string | null; name: string; department: string | null; delay: number; total: number; canViewTeam: boolean };
  const [quick, setQuick] = useState<Quick | null>(null);
  const [quickTasks, setQuickTasks] = useState<OwnerTask[] | null>(null);
  useEffect(() => {
    if (!quick) { setQuickTasks(null); return; }
    if (quick.ownerId == null) { setQuickTasks([]); return; }
    let alive = true;
    setQuickTasks(null);
    fetch(`/api/action-items/owner-tasks?owner=${quick.ownerId}&bucket=delay`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => alive && setQuickTasks(Array.isArray(d) ? d : []))
      .catch(() => alive && setQuickTasks([]));
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

  const orgDepts = Array.from(new Set(owners.map((o) => o.department).filter(Boolean) as string[])).sort();
  const deptPeople = deptView
    ? owners.filter((o) => o.department === deptView).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
    : [];
  const deptRoll = deptPeople.reduce(
    (a, o) => ({ total: a.total + o.total, done: a.done + o.done, delay: a.delay + o.delay }),
    { total: 0, done: 0, delay: 0 }
  );
  return (
    <div className="max-w-3xl mx-auto w-full pt-3 md:pt-4">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <span className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <Users className="w-5 h-5" />
          </span>
          <div>
            <h1 className="text-[16px] font-heading font-bold text-foreground leading-tight">My Team Actions</h1>
            <p className="text-[12px] text-muted-foreground">Your reporting line and team — click anyone to explore their team.</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
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

      {deptView && (
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

      {!deptView && loading && (
        <div className="flex items-center justify-center py-20 text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      )}

      {!deptView && !loading && error && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-700 text-[13px] px-4 py-3">
          {error}
        </div>
      )}

      {!deptView && !loading && !error && org && (() => {
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
              {quickTasks === null ? (
                <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
              ) : quickTasks.length === 0 ? (
                <div className="py-12 text-center">
                  <div className="mx-auto w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center mb-2.5">
                    <CheckCircle2 className="w-6 h-6 text-emerald-500" />
                  </div>
                  <p className="text-[13px] font-semibold text-slate-700">All caught up</p>
                  <p className="text-[12px] text-slate-400">No overdue tasks.</p>
                </div>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {quickTasks.map((t) => {
                    const late = daysLate(t.dueDate);
                    return (
                    <li key={t.id} className="rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 hover:border-slate-300 hover:shadow-sm transition-all">
                      <div className="flex items-start gap-2.5">
                        <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-medium text-slate-800 leading-snug">{t.title}</p>
                          <div className="mt-1 flex items-center gap-2 flex-wrap text-[11px]">
                            {t.dueDate && (
                              <span className="inline-flex items-center gap-1 text-red-600 font-semibold">
                                <CalendarClock className="w-3 h-3" /> Due {t.dueDate}
                              </span>
                            )}
                            {late > 0 && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-red-50 text-red-600 font-semibold tabular-nums">{late}d late</span>
                            )}
                            {t.meeting && (
                              <span className="inline-flex items-center gap-1 text-slate-400">
                                <span className="w-1 h-1 rounded-full bg-slate-300" /> {t.meeting}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </li>
                  )})}
                </ul>
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
