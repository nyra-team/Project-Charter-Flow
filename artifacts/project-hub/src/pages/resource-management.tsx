import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useListProjects, useListUsers, useListCharters } from "@workspace/api-client-react";
import { useAuth } from "../auth/context";
import { StatusChip } from "@/components/ui-kit";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Search, Users, Layers, UserCheck, AlertCircle, ChevronDown, Building2, Briefcase, ListChecks, Globe2,
} from "lucide-react";
import { projectCode } from "./projects";
import { TaskStatusBar, type StatusCounts } from "../components/task-status-bar";

// Resource Management — who is working on what.
//
// One row per person, rolled up from PMO's own data: the projects they OWN (or
// manage) and the projects they're actually working IN (they hold tasks there),
// with their task load, what's overdue, and what's done. Expand a person to see
// the projects behind the numbers.
//
// Two scopes: "My team" (everyone reporting under you, from the master-DB
// reporting line via /api/org/team-summary) and "Organisation" (everyone) — the
// org-wide view is for CXOs / admins. Both filter by department.

type ProjectRow = {
  id: number; name: string; status: string; charterId?: number | null; jiraKey?: string | null;
  projectOwnerId?: number | null; projectManagerId?: number | null;
};
type TaskRow = { id: number; projectId?: number | null; assigneeId?: number | null; status?: string | null; endDate?: string | null; parentTaskId?: number | null };
type UserRow = { id: number; name: string; email?: string | null; department?: string | null; function?: string | null; designation?: string | null; photoUrl?: string | null };
type TeamMember = { empCode: string | null; ownerId: number | null; name: string; department: string | null };

// A person's whole footprint across the portfolio.
type Resource = {
  id: number;
  name: string;
  department: string;
  designation: string | null;
  photoUrl: string | null;
  owns: ProjectRow[];                                  // accountable for
  worksOn: { project: ProjectRow; tasks: number; overdue: number }[];  // holds tasks in
  counts: StatusCounts;                                // their tasks, by status
  overdue: number;
};

const todayIso = () => new Date().toISOString().slice(0, 10);
const isOverdue = (t: TaskRow, today: string) =>
  t.status !== "completed" && (t.status === "delayed" || (!!t.endDate && t.endDate.slice(0, 10) < today));

// Which tile is driving the list. "all" = no narrowing (the People tile).
type Focus = "all" | "projects" | "open" | "overdue" | "unowned";

// Every tile is a toggle: click it to narrow the list below to just that slice,
// click it again (or People) to go back to everyone. The active tile fills light
// blue, so which one is driving the list reads at a glance.
function StatTile({ icon: Icon, label, value, accent, active, onClick, title }: {
  icon: typeof Users;
  label: string;
  value: number;
  accent: string;
  active: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-all hover:shadow-sm ${
        active
          ? "border-primary bg-primary/10 ring-1 ring-primary/30"
          : "border-border bg-card hover:border-primary/40 hover:bg-primary/[0.04]"
      }`}
    >
      <div className={`h-7 w-7 rounded-md grid place-items-center ${accent}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="text-lg font-bold leading-none text-foreground">{value}</div>
        <div className={`text-[11px] mt-0.5 truncate ${active ? "font-medium text-primary" : "text-muted-foreground"}`}>{label}</div>
      </div>
    </button>
  );
}

export default function ResourceManagement() {
  const { profile } = useAuth();
  // CXOs / admins get the whole organisation; everyone else sees their own team.
  const canSeeOrg = !!(profile?.is_super_admin || profile?.pmo_role === "admin");

  const { data: projects, isLoading } = useListProjects();
  const { data: users = [] } = useListUsers();
  const { data: charters = [] } = useListCharters();
  const { data: tasks = [] } = useQuery({
    queryKey: ["/api/tasks", "all"],
    queryFn: async () => {
      const r = await fetch("/api/tasks", { credentials: "include" });
      return r.ok ? ((await r.json()) as TaskRow[]) : [];
    },
  });
  // The caller's downward team (master-DB reporting line). Empty for someone
  // with no reports — the scope switch then just offers the organisation.
  const { data: team = [] } = useQuery({
    queryKey: ["/api/org/team-summary"],
    queryFn: async () => {
      const r = await fetch("/api/org/team-summary", { credentials: "include" });
      return r.ok ? ((await r.json()) as TeamMember[]) : [];
    },
  });

  const [scope, setScope] = useState<"team" | "org">(canSeeOrg ? "org" : "team");
  const [dept, setDept] = useState("");
  const [q, setQ] = useState("");

  const usersArr = users as UserRow[];
  const projectsArr = (projects ?? []) as ProjectRow[];
  const deptOf = (u: UserRow) => (u.function || u.department || "").trim();

  // charterId → projectOwnerId, so a charter-backed project still resolves an owner.
  const ownerByCharter = useMemo(() => {
    const m = new Map<number, number | null>();
    for (const c of charters as Array<{ id: number; projectOwnerId?: number | null }>) m.set(c.id, c.projectOwnerId ?? null);
    return m;
  }, [charters]);
  const ownerIdOf = (p: ProjectRow) =>
    p.projectOwnerId ?? (p.charterId != null ? ownerByCharter.get(p.charterId) ?? null : null);

  // ── The rollup: one Resource per person who owns a project or holds a task ──
  const resources = useMemo<Resource[]>(() => {
    const today = todayIso();
    const byId = new Map<number, Resource>();
    const projectById = new Map(projectsArr.map((p) => [p.id, p]));

    const seed = (id: number): Resource => {
      const u = usersArr.find((x) => x.id === id);
      const r: Resource = {
        id,
        name: u?.name ?? `User #${id}`,
        department: u ? deptOf(u) : "",
        designation: u?.designation ?? null,
        photoUrl: u?.photoUrl ?? null,
        owns: [],
        worksOn: [],
        counts: { total: 0, done: 0, in_progress: 0, delayed: 0, on_hold: 0, not_started: 0 },
        overdue: 0,
      };
      byId.set(id, r);
      return r;
    };
    const get = (id: number) => byId.get(id) ?? seed(id);

    for (const p of projectsArr) {
      const oid = ownerIdOf(p);
      if (oid != null) get(oid).owns.push(p);
    }

    // Tasks → who is working IN which project, and their load.
    const perPersonProject = new Map<string, { tasks: number; overdue: number }>();
    for (const t of tasks) {
      if (t.assigneeId == null) continue;
      const r = get(t.assigneeId);
      r.counts.total++;
      switch (t.status) {
        case "completed": r.counts.done++; break;
        case "in_progress": r.counts.in_progress++; break;
        case "delayed": r.counts.delayed++; break;
        case "on_hold": r.counts.on_hold++; break;
        default: r.counts.not_started++; break;
      }
      const late = isOverdue(t, today);
      if (late) r.overdue++;
      if (t.projectId != null) {
        const k = `${t.assigneeId}:${t.projectId}`;
        const e = perPersonProject.get(k) ?? { tasks: 0, overdue: 0 };
        e.tasks++;
        if (late) e.overdue++;
        perPersonProject.set(k, e);
      }
    }
    for (const [k, v] of perPersonProject) {
      const [uid, pid] = k.split(":").map(Number);
      const p = projectById.get(pid!);
      const r = byId.get(uid!);
      if (p && r) r.worksOn.push({ project: p, tasks: v.tasks, overdue: v.overdue });
    }
    for (const r of byId.values()) {
      r.worksOn.sort((a, b) => b.tasks - a.tasks || a.project.name.localeCompare(b.project.name));
      r.owns.sort((a, b) => a.name.localeCompare(b.name));
    }
    // Busiest first — most open work, then most overdue.
    return [...byId.values()].sort(
      (a, b) =>
        (b.counts.total - b.counts.done) - (a.counts.total - a.counts.done) ||
        b.overdue - a.overdue ||
        a.name.localeCompare(b.name),
    );
  }, [projectsArr, usersArr, tasks, ownerByCharter]);

  // Scope → which people are in view.
  const teamIds = useMemo(() => new Set(team.map((m) => m.ownerId).filter((id): id is number => id != null)), [team]);
  const scoped = useMemo(
    () => (scope === "org" ? resources : resources.filter((r) => teamIds.has(r.id))),
    [resources, scope, teamIds],
  );

  const departments = useMemo(
    () => [...new Set(scoped.map((r) => r.department).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [scoped],
  );

  // Everyone the scope + department + search allow. The tiles count THIS set, so
  // their numbers stay put while a tile narrows the list below them.
  const matched = useMemo(() => {
    const t = q.trim().toLowerCase();
    return scoped.filter((r) => {
      if (dept && r.department !== dept) return false;
      if (!t) return true;
      return (
        r.name.toLowerCase().includes(t) ||
        r.owns.some((p) => p.name.toLowerCase().includes(t)) ||
        r.worksOn.some((w) => w.project.name.toLowerCase().includes(t))
      );
    });
  }, [scoped, dept, q]);

  const stats = useMemo(() => {
    const projectIds = new Set<number>();
    let open = 0, overdue = 0;
    for (const r of matched) {
      r.owns.forEach((p) => projectIds.add(p.id));
      r.worksOn.forEach((w) => projectIds.add(w.project.id));
      open += r.counts.total - r.counts.done;
      overdue += r.overdue;
    }
    return { people: matched.length, projects: projectIds.size, open, overdue };
  }, [matched]);

  // Projects nobody is accountable for — portfolio-wide, so they're independent
  // of the scope/department filters (nobody to attribute them to).
  const unowned = useMemo(() => projectsArr.filter((p) => ownerIdOf(p) == null), [projectsArr, ownerByCharter]);

  // ── The tiles are toggles: each one narrows the list to its own slice ───────
  const [focus, setFocus] = useState<Focus>("all");
  const toggle = (f: Focus) => setFocus((cur) => (cur === f ? "all" : f));
  // The Unowned tile hides when every project has an owner — drop the filter too
  // so we never sit on a stranded empty "unowned" view after the tile vanishes.
  useEffect(() => {
    if (focus === "unowned" && unowned.length === 0) setFocus("all");
  }, [focus, unowned.length]);

  const filtered = useMemo(() => {
    switch (focus) {
      case "projects": return matched.filter((r) => r.owns.length + r.worksOn.length > 0);
      case "open": return matched.filter((r) => r.counts.total - r.counts.done > 0);
      case "overdue": return matched.filter((r) => r.overdue > 0);
      default: return matched;
    }
  }, [matched, focus]);

  return (
    <div className="-mx-4 sm:-mx-6 lg:-mx-8 -mt-3 -mb-6 lg:-mb-8 min-h-full bg-muted/30">
      {/* Header band */}
      <div className="border-b border-border bg-card/40">
        <div className="px-6 lg:px-10 py-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                <Users className="h-3 w-3" /> Resource Management
              </div>
              <h1 data-tour="res-title" className="text-xl font-bold text-foreground mt-0.5">Who is working on what</h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Every person's projects, task load and overdue work — {scope === "org" ? "across the organisation" : "across your team"}.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Scope — organisation is the CXO / admin view */}
              <div className="flex items-center rounded-lg border border-border bg-card p-0.5">
                {([
                  { key: "team", label: "My team", Icon: Users, enabled: true },
                  { key: "org", label: "Organisation", Icon: Globe2, enabled: canSeeOrg },
                ] as const).map(({ key, label, Icon, enabled }) => (
                  <button
                    key={key}
                    type="button"
                    disabled={!enabled}
                    onClick={() => { setScope(key); setDept(""); }}
                    title={enabled ? `${label} view` : "Organisation-wide view is for CXOs and admins"}
                    className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11px] font-medium transition-colors ${
                      scope === key ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:hover:text-muted-foreground"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" /> {label}
                  </button>
                ))}
              </div>

              <Select value={dept || "__all"} onValueChange={(v) => setDept(v === "__all" ? "" : v)}>
                <SelectTrigger className="w-[190px] h-8 text-[12px]">
                  <Building2 className={`h-3.5 w-3.5 shrink-0 mr-1 ${dept ? "text-primary" : "text-muted-foreground"}`} />
                  <SelectValue placeholder="All departments" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="__all">All departments</SelectItem>
                  {departments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>

              <div className="relative w-56">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input className="pl-8 h-8 text-sm bg-card" placeholder="Search person or project…" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
            </div>
          </div>

          <div data-tour="res-stats" className="grid grid-cols-2 lg:grid-cols-5 gap-2 mt-4">
            <StatTile
              icon={UserCheck} label="People" value={stats.people} accent="bg-primary/10 text-primary"
              active={focus === "all"} onClick={() => setFocus("all")}
              title="Show everyone — clears any tile filter"
            />
            <StatTile
              icon={Layers} label="Projects covered" value={stats.projects} accent="bg-blue-500/10 text-blue-600"
              active={focus === "projects"} onClick={() => toggle("projects")}
              title="Show only people who own or work on at least one project"
            />
            <StatTile
              icon={ListChecks} label="Open tasks" value={stats.open} accent="bg-indigo-500/10 text-indigo-600"
              active={focus === "open"} onClick={() => toggle("open")}
              title="Show only people with tasks still open"
            />
            <StatTile
              icon={AlertCircle} label="Overdue" value={stats.overdue} accent="bg-red-500/10 text-red-600"
              active={focus === "overdue"} onClick={() => toggle("overdue")}
              title="Show only people with overdue work"
            />
            {unowned.length > 0 && (
              <StatTile
                icon={Briefcase} label="Unowned projects" value={unowned.length} accent="bg-amber-500/10 text-amber-600"
                active={focus === "unowned"} onClick={() => toggle("unowned")}
                title="List the projects nobody is accountable for"
              />
            )}
          </div>

          {focus !== "all" && (
            <div className="mt-2 flex items-center gap-2 text-[11px]">
              <span className="text-muted-foreground">
                {focus === "unowned"
                  ? `Showing ${unowned.length} project${unowned.length === 1 ? "" : "s"} with no owner`
                  : `Showing ${filtered.length} of ${matched.length} ${matched.length === 1 ? "person" : "people"}`}
              </span>
              <button type="button" onClick={() => setFocus("all")} className="font-medium text-primary hover:underline">
                Clear
              </button>
            </div>
          )}
        </div>
      </div>

      {/* People — one accordion row each */}
      <div className="px-6 lg:px-10 py-6">
        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
          </div>
        ) : focus === "unowned" ? (
          // The Unowned tile is about projects, not people — so it swaps the body
          // for the projects that have nobody accountable for them.
          unowned.length === 0 ? (
            <div className="text-center text-muted-foreground py-24 text-sm">Every project has an owner.</div>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border bg-card overflow-hidden">
              {unowned.map((p) => (
                <li key={p.id}>
                  <Link href={`/projects/${p.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent/30 transition-colors group/row">
                    <span className="h-8 w-8 rounded-full grid place-items-center shrink-0 bg-amber-500/10 text-amber-600">
                      <Briefcase className="h-4 w-4" />
                    </span>
                    <span className="text-[10px] font-mono text-muted-foreground shrink-0 w-16 truncate">{projectCode(p)}</span>
                    <span className="text-sm text-foreground truncate flex-1 group-hover/row:text-primary">{p.name}</span>
                    <StatusChip status={p.status} size="sm" />
                  </Link>
                </li>
              ))}
            </ul>
          )
        ) : filtered.length === 0 ? (
          <div className="text-center text-muted-foreground py-24 text-sm">
            {scope === "team" && teamIds.size === 0
              ? "You have no reportees in the directory. Switch to the organisation view."
              : "Nobody matches these filters."}
          </div>
        ) : (
          <div className="divide-y divide-border rounded-xl border border-border bg-card overflow-hidden">
            {filtered.map((r) => {
              const open = r.counts.total - r.counts.done;
              return (
                <details key={r.id} className="group">
                  <summary className="flex items-center gap-3 px-4 py-3 cursor-pointer list-none select-none hover:bg-accent/30 transition-colors">
                    <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0 transition-transform group-open:rotate-180" />
                    {r.photoUrl ? (
                      <img src={r.photoUrl} alt="" className="h-8 w-8 rounded-full object-cover ring-2 ring-card shrink-0" />
                    ) : (
                      <div className="h-8 w-8 rounded-full grid place-items-center text-sm font-semibold shrink-0 bg-primary/10 text-primary">
                        {r.name.slice(0, 1).toUpperCase()}
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-foreground truncate">{r.name}</p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {[r.designation, r.department].filter(Boolean).join(" · ") || "—"}
                      </p>
                    </div>

                    <span className="hidden md:flex items-center gap-1.5 shrink-0 text-[11px] text-muted-foreground tabular-nums w-28">
                      <Briefcase className="h-3.5 w-3.5 opacity-60" />
                      {r.owns.length} owned
                    </span>
                    <span className="hidden lg:flex items-center gap-1.5 shrink-0 text-[11px] text-muted-foreground tabular-nums w-32">
                      <Layers className="h-3.5 w-3.5 opacity-60" />
                      {r.worksOn.length} project{r.worksOn.length === 1 ? "" : "s"}
                    </span>
                    <span className="hidden sm:block w-40 shrink-0">
                      <TaskStatusBar counts={r.counts} />
                    </span>
                    <span className="shrink-0 w-24 text-right text-[11px] tabular-nums">
                      {r.overdue > 0
                        ? <span className="font-semibold text-red-600">{r.overdue} overdue</span>
                        : <span className="text-muted-foreground/50">{open} open</span>}
                    </span>
                  </summary>

                  {/* Behind the numbers — what they own, and what they're working in */}
                  <div className="px-4 pb-4 pt-1 border-t border-border grid gap-4 md:grid-cols-2">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                        Owns ({r.owns.length})
                      </p>
                      {r.owns.length === 0 ? (
                        <p className="text-[12px] text-muted-foreground/60 py-2">Owns no projects.</p>
                      ) : (
                        <ul className="space-y-0.5">
                          {r.owns.map((p) => (
                            <li key={p.id}>
                              <Link href={`/projects/${p.id}`} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/50 transition-colors group/row">
                                <span className="text-[10px] font-mono text-muted-foreground shrink-0 w-16 truncate">{projectCode(p)}</span>
                                <span className="text-[13px] text-foreground truncate flex-1 group-hover/row:text-primary">{p.name}</span>
                                <StatusChip status={p.status} size="sm" />
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                        Working on ({r.worksOn.length})
                      </p>
                      {r.worksOn.length === 0 ? (
                        <p className="text-[12px] text-muted-foreground/60 py-2">Holds no tasks.</p>
                      ) : (
                        <ul className="space-y-0.5">
                          {r.worksOn.map((w) => (
                            <li key={w.project.id}>
                              <Link href={`/projects/${w.project.id}`} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/50 transition-colors group/row">
                                <span className="text-[10px] font-mono text-muted-foreground shrink-0 w-16 truncate">{projectCode(w.project)}</span>
                                <span className="text-[13px] text-foreground truncate flex-1 group-hover/row:text-primary">{w.project.name}</span>
                                <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{w.tasks} task{w.tasks === 1 ? "" : "s"}</span>
                                {w.overdue > 0 && (
                                  <span className="shrink-0 text-[10px] font-semibold text-red-600 tabular-nums">{w.overdue} late</span>
                                )}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
