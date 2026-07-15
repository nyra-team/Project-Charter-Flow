// Team Overview rollup — one row per person who OWNS a project or HOLDS a task,
// each carrying the projects "under them" with a per-project done / in-progress /
// overdue breakdown. Built purely from PMO's own projects + users + tasks (the
// same data Resource Management uses), so it works for anyone regardless of the
// master-DB reporting chain — a PM/admin with no direct reports still sees the
// whole working team here.

export type OverviewItem = {
  type: "task" | "subtask";
  id: number;
  name: string;
  status: string;
  overdue: boolean;
  dueDate: string | null;
};

export type OverviewProject = {
  projectId: number;
  project: string;
  owns: boolean;                 // the person is the project owner/manager
  total: number;                 // their task count in this project
  done: number;
  ongoing: number;
  overdue: number;
  items: OverviewItem[];
};

export type OverviewPerson = {
  id: number;
  name: string;
  department: string | null;
  photoUrl: string | null;
  total: number;
  done: number;
  overdue: number;
  projects: OverviewProject[];
};

type P = { id: number; name: string; charterId?: number | null; projectOwnerId?: number | null; projectManagerId?: number | null };
type U = { id: number; name: string; department?: string | null; function?: string | null; photoUrl?: string | null };
type T = { id: number; name?: string | null; projectId?: number | null; assigneeId?: number | null; status?: string | null; endDate?: string | null; parentTaskId?: number | null };
type C = { id: number; projectOwnerId?: number | null };

const todayIso = () => new Date().toISOString().slice(0, 10);
const isOverdue = (status: string | null | undefined, endDate: string | null | undefined, today: string) =>
  status !== "completed" && (status === "delayed" || (!!endDate && endDate.slice(0, 10) < today));

export function buildTeamOverview(projects: P[], users: U[], tasks: T[], charters: C[]): OverviewPerson[] {
  const today = todayIso();
  const userById = new Map(users.map((u) => [u.id, u]));
  const projectName = new Map(projects.map((p) => [p.id, p.name]));

  // charterId → owner, so a charter-backed project still resolves an owner.
  const ownerByCharter = new Map<number, number | null>();
  for (const c of charters) ownerByCharter.set(c.id, c.projectOwnerId ?? null);
  const ownerIdOf = (p: P) => p.projectOwnerId ?? (p.charterId != null ? ownerByCharter.get(p.charterId) ?? null : null);

  type Acc = { projects: Map<number, OverviewProject> };
  const byPerson = new Map<number, Acc>();
  const acc = (id: number) => {
    let a = byPerson.get(id);
    if (!a) { a = { projects: new Map() }; byPerson.set(id, a); }
    return a;
  };
  const ensureProject = (personId: number, projectId: number): OverviewProject => {
    const a = acc(personId);
    let pr = a.projects.get(projectId);
    if (!pr) {
      pr = { projectId, project: projectName.get(projectId) ?? `Project #${projectId}`, owns: false, total: 0, done: 0, ongoing: 0, overdue: 0, items: [] };
      a.projects.set(projectId, pr);
    }
    return pr;
  };

  // Ownership — every project the person is accountable for shows up, even with
  // no personal tasks in it.
  for (const p of projects) {
    const oid = ownerIdOf(p) ?? (p.projectManagerId ?? null);
    if (oid != null) ensureProject(oid, p.id).owns = true;
  }

  // Tasks — who is working in which project, and how that work is faring.
  for (const t of tasks) {
    if (t.assigneeId == null || t.projectId == null) continue;
    const pr = ensureProject(t.assigneeId, t.projectId);
    const status = t.status ?? "";
    const late = isOverdue(status, t.endDate, today);
    const done = status === "completed";
    pr.total++;
    if (done) pr.done++;
    else if (late) pr.overdue++;
    else pr.ongoing++;
    pr.items.push({
      type: t.parentTaskId != null ? "subtask" : "task",
      id: t.id,
      name: t.name ?? `Task #${t.id}`,
      status,
      overdue: late,
      dueDate: t.endDate ?? null,
    });
  }

  const people: OverviewPerson[] = [];
  for (const [id, a] of byPerson) {
    const u = userById.get(id);
    const projectsArr = [...a.projects.values()].sort(
      (x, y) => y.overdue - x.overdue || y.total - x.total || x.project.localeCompare(y.project),
    );
    for (const pr of projectsArr) {
      pr.items.sort((x, y) => Number(y.overdue) - Number(x.overdue) || x.name.localeCompare(y.name));
    }
    const total = projectsArr.reduce((s, p) => s + p.total, 0);
    const done = projectsArr.reduce((s, p) => s + p.done, 0);
    const overdue = projectsArr.reduce((s, p) => s + p.overdue, 0);
    people.push({
      id,
      name: u?.name ?? `User #${id}`,
      department: (u?.function || u?.department || "").trim() || null,
      photoUrl: u?.photoUrl ?? null,
      total,
      done,
      overdue,
      projects: projectsArr,
    });
  }

  // Busiest first — most open work, then most overdue, then name.
  return people.sort(
    (a, b) => (b.total - b.done) - (a.total - a.done) || b.overdue - a.overdue || a.name.localeCompare(b.name),
  );
}
