// Org chart + team work rollups for the "My Team Actions" page.
//
// This used to be served by the CXO/Action-Centre backend, reached through a
// dev-only vite proxy (/api/org → :5190). That was fragile in dev (the page
// dies with "Failed to fetch" the moment that separate server isn't running)
// and simply BROKEN in prod, where pmo.mygranules.com's nginx sends every
// /api/ path to PMO's own api-server on :3008 — which had no /api/org at all.
//
// So PMO now owns it: the reporting line comes from the master DB's
// l1_manager_code chain (same source the CXO version used), and the per-person
// numbers are PMO's OWN work (projects / milestones / tasks / subtasks) rather
// than Action-Centre action items — which is what this page is actually for.
import { Router, type IRouter, type Request, type Response } from "express";
import { eq, inArray } from "drizzle-orm";
import { db, projectsTable, milestonesTable, tasksTable, usersTable } from "@workspace/db";
import { getMasterDb } from "../lib/masterDb";

const router: IRouter = Router();

const ORG_COLS =
  "employee_code, first_name, middle_name, last_name, designation_text, function, unit, photo_url, office_email, l1_manager_code, employment_status";

type EmpRow = {
  employee_code: string;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  designation_text: string | null;
  function: string | null;
  unit: string | null;
  photo_url: string | null;
  office_email: string | null;
  l1_manager_code: string | null;
  employment_status: string | null;
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
  tasks: WorkCounts | null;
};

// Task counts, in the shape the page's cards already render.
type WorkCounts = { total: number; done: number; inProgress: number; delay: number; onHold: number; notStarted: number };

const fullName = (r: EmpRow) =>
  [r.first_name, r.middle_name, r.last_name].filter((s) => s && s.trim()).join(" ").trim() || r.employee_code;

const shapeP = (r: EmpRow): Omit<Person, "ownerId" | "tasks"> => ({
  employee_code: r.employee_code,
  name: fullName(r),
  designation: r.designation_text,
  function: r.function,
  unit: r.unit,
  photo_url: r.photo_url,
  email: r.office_email,
});

const isActive = (r: EmpRow) => (r.employment_status || "Active") === "Active";
const today = () => new Date().toISOString().slice(0, 10);

// An item is overdue when its date has passed and it isn't finished. Dates are
// stored as YYYY-MM-DD text, so a string compare is the right one.
const overdue = (due: string | null | undefined, status: string) =>
  !!due && status !== "completed" && due.slice(0, 10) < today();

async function getRow(code: string): Promise<EmpRow | null> {
  const masterDb = getMasterDb();
  if (!masterDb) return null;
  const { data } = await masterDb.from("employees").select(ORG_COLS).eq("employee_code", code).limit(1);
  const row = ((data as EmpRow[]) || [])[0];
  return row ?? null;
}

// PMO identity: employees are matched to pmo_users by office email — the same
// mapping /api/users/me uses to auto-provision a row on first sign-in.
async function pmoUserIdsByEmail(emails: string[]): Promise<Map<string, number>> {
  const clean = [...new Set(emails.filter(Boolean).map((e) => e.toLowerCase()))];
  if (!clean.length) return new Map();
  const rows = await db.select({ id: usersTable.id, email: usersTable.email }).from(usersTable).where(inArray(usersTable.email, clean));
  return new Map(rows.map((r) => [r.email.toLowerCase(), r.id]));
}

// Task counts per pmo_users.id, for the given people. One query for the lot.
async function taskCountsFor(userIds: number[]): Promise<Map<number, WorkCounts>> {
  const out = new Map<number, WorkCounts>();
  if (!userIds.length) return out;
  const rows = await db
    .select({ assigneeId: tasksTable.assigneeId, status: tasksTable.status, endDate: tasksTable.endDate })
    .from(tasksTable)
    .where(inArray(tasksTable.assigneeId, userIds));
  for (const r of rows) {
    if (r.assigneeId == null) continue;
    const c = out.get(r.assigneeId) ?? { total: 0, done: 0, inProgress: 0, delay: 0, onHold: 0, notStarted: 0 };
    c.total++;
    switch (r.status) {
      case "completed": c.done++; break;
      case "in_progress": c.inProgress++; break;
      case "on_hold": c.onHold++; break;
      case "delayed": break; // counted as delay below
      default: c.notStarted++; break;
    }
    if (r.status === "delayed" || overdue(r.endDate, r.status)) c.delay++;
    out.set(r.assigneeId, c);
  }
  return out;
}

// Everyone reporting (transitively) under a person, active only.
async function descendantsOf(code: string): Promise<EmpRow[]> {
  const masterDb = getMasterDb();
  if (!masterDb || !code) return [];
  const seen = new Map<string, EmpRow>();
  let frontier = [code];
  for (let depth = 0; depth < 20 && frontier.length; depth++) {
    const { data } = await masterDb.from("employees").select(ORG_COLS).in("l1_manager_code", frontier);
    const next: string[] = [];
    for (const r of ((data as EmpRow[]) || [])) {
      if (!isActive(r)) continue;
      const c = String(r.employee_code);
      if (c && !seen.has(c)) { seen.set(c, r); next.push(c); }
    }
    frontier = next;
  }
  return [...seen.values()];
}

// Attach each person's PMO identity + task counts.
async function withWork(rows: EmpRow[]): Promise<Person[]> {
  const idByEmail = await pmoUserIdsByEmail(rows.map((r) => r.office_email ?? ""));
  const ids = [...new Set([...idByEmail.values()])];
  const counts = await taskCountsFor(ids);
  return rows.map((r) => {
    const uid = r.office_email ? idByEmail.get(r.office_email.toLowerCase()) ?? null : null;
    return { ...shapeP(r), ownerId: uid, tasks: uid != null ? counts.get(uid) ?? null : null };
  });
}

// ── GET /api/org/team-summary ───────────────────────────────────────────────
// Every active descendant of the caller, with their real department + PMO task
// counts. Drives the department filter on My Team Actions. MUST be registered
// before /:code, else "team-summary" is captured as an employee code.
router.get("/org/team-summary", async (req, res): Promise<void> => {
  const code = req.user?.employeeCode ?? null;
  if (!code) { res.json([]); return; }
  const team = await descendantsOf(code);
  const people = await withWork(team);
  res.json(people.map((p) => ({
    ownerId: p.ownerId,
    empCode: p.employee_code,
    name: p.name,
    department: p.function,
    total: p.tasks?.total ?? 0,
    done: p.tasks?.done ?? 0,
    inProgress: p.tasks?.inProgress ?? 0,
    delay: p.tasks?.delay ?? 0,
    onHold: p.tasks?.onHold ?? 0,
    notStarted: p.tasks?.notStarted ?? 0,
  })));
});

// ── GET /api/org/team-work/:code ────────────────────────────────────────────
// The complete picture for one person: what they own across PMO, split into
// what's overdue and what's done — projects, milestones, tasks and subtasks —
// plus the actual overdue items so the page can list them, not just count them.
router.get("/org/team-work/:code", async (req, res): Promise<void> => {
  const code = String(req.params.code || "").trim();
  const emp = code ? await getRow(code) : null;
  if (!emp) { res.status(404).json({ error: "Employee not found" }); return; }

  const idByEmail = await pmoUserIdsByEmail([emp.office_email ?? ""]);
  const uid = emp.office_email ? idByEmail.get(emp.office_email.toLowerCase()) ?? null : null;
  const empty = { total: 0, overdue: 0, completed: 0 };
  if (uid == null) {
    res.json({ empCode: emp.employee_code, name: fullName(emp), projects: empty, milestones: empty, tasks: empty, subtasks: empty, overdueItems: [] });
    return;
  }

  // Projects they own or manage.
  const projects = await db.select().from(projectsTable);
  const mine = projects.filter((p) => p.projectOwnerId === uid || p.projectManagerId === uid);
  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  const mineIds = mine.map((p) => p.id);

  // Their tasks (leaf work), and the milestones of the projects they own.
  const myTasks = await db.select().from(tasksTable).where(eq(tasksTable.assigneeId, uid));
  const myMilestones = mineIds.length
    ? await db.select().from(milestonesTable).where(inArray(milestonesTable.projectId, mineIds))
    : [];

  // EVERY item they own, flagged rather than filtered, so the frontend can
  // show the whole workload (the modal lists all actions, not just the late
  // ones). `overdueItems` is kept as the filtered view for back-compat.
  type Item = {
    type: "project" | "milestone" | "task" | "subtask"; id: number; name: string;
    project: string | null; dueDate: string | null; status: string; overdue: boolean;
  };
  const items: Item[] = [];
  const tally = (rows: Array<{ status: string; due: string | null }>) => {
    const c = { total: rows.length, overdue: 0, completed: 0 };
    for (const r of rows) {
      if (r.status === "completed") c.completed++;
      else if (r.status === "delayed" || overdue(r.due, r.status)) c.overdue++;
    }
    return c;
  };

  const projectRows = mine.map((p) => ({ status: p.status, due: p.endDate }));
  for (const p of mine) {
    items.push({
      type: "project", id: p.id, name: p.name, project: null, dueDate: p.endDate, status: p.status,
      overdue: p.status !== "completed" && overdue(p.endDate, p.status),
    });
  }
  for (const m of myMilestones) {
    items.push({
      type: "milestone", id: m.id, name: m.name, project: projectName.get(m.projectId) ?? null,
      dueDate: m.dueDate, status: m.status,
      overdue: m.status !== "completed" && overdue(m.dueDate, m.status),
    });
  }
  const topTasks = myTasks.filter((t) => t.parentTaskId == null);
  const subTasks = myTasks.filter((t) => t.parentTaskId != null);
  for (const t of myTasks) {
    items.push({
      type: t.parentTaskId == null ? "task" : "subtask",
      id: t.id, name: t.name,
      project: t.projectId != null ? projectName.get(t.projectId) ?? null : null,
      dueDate: t.endDate, status: t.status,
      overdue: t.status !== "completed" && (t.status === "delayed" || overdue(t.endDate, t.status)),
    });
  }
  // Overdue first (longest-late leading), then open work by due date, done last.
  const rank = (i: Item) => (i.overdue ? 0 : i.status === "completed" ? 2 : 1);
  items.sort((a, b) => rank(a) - rank(b) || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
  const overdueItems = items.filter((i) => i.overdue);

  res.json({
    empCode: emp.employee_code,
    name: fullName(emp),
    department: emp.function,
    projects: tally(projectRows),
    milestones: tally(myMilestones.map((m) => ({ status: m.status, due: m.dueDate }))),
    tasks: tally(topTasks.map((t) => ({ status: t.status, due: t.endDate }))),
    subtasks: tally(subTasks.map((t) => ({ status: t.status, due: t.endDate }))),
    items,
    overdueItems,
  });
});

// ── GET /api/org  ·  GET /api/org/:code ─────────────────────────────────────
// The reporting line (managers above, direct reports below) centred on the
// caller, or on :code when drilling into someone's team.
const orgHandler = async (req: Request, res: Response): Promise<void> => {
  const masterDb = getMasterDb();
  if (!masterDb) { res.status(503).json({ error: "Employee directory is not configured" }); return; }

  const wanted = String(req.params.code || req.user?.employeeCode || "").trim();
  if (!wanted) { res.status(400).json({ error: "No employee code on your account" }); return; }
  const target = await getRow(wanted);
  if (!target) { res.status(404).json({ error: `No employee found for ${wanted}` }); return; }

  // Manager chain upward (capped, and cycle-safe).
  const managers: EmpRow[] = [];
  const seen = new Set([target.employee_code]);
  let mc = target.l1_manager_code;
  for (let i = 0; i < 12 && mc && !seen.has(mc); i++) {
    const mgr = await getRow(mc);
    if (!mgr) break;
    seen.add(mgr.employee_code);
    managers.unshift(mgr);
    mc = mgr.l1_manager_code;
  }

  const { data: repRows } = await masterDb.from("employees").select(ORG_COLS).eq("l1_manager_code", target.employee_code);
  const reports = ((repRows as EmpRow[]) || [])
    .filter(isActive)
    .sort((a, b) => (a.first_name || "").localeCompare(b.first_name || ""));

  const [t, m, r] = await Promise.all([withWork([target]), withWork(managers), withWork(reports)]);
  res.json({ target: t[0], managers: m, reports: r, isSelf: !req.params.code });
};

router.get("/org", orgHandler);
router.get("/org/:code", orgHandler);

export default router;
