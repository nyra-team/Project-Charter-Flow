// ───────────────────────────────────────────────────────────────────────────
// Turn a charter/NFA milestone list into a scheduled project plan.
//
// On project creation we already seed the 7 governance gate-milestones. This
// adds the *delivery* schedule the NFA describes: one milestone per NFA
// milestone (with a resolved deadline) plus an appropriate set of tasks per
// milestone (sized by the LLM), so the work + timeline show on the board/Gantt
// from day one.
//
// NFA targetDate is FREE TEXT in real data — "Month 1", "Month 18 (approx.
// Jun-2026)", "Q2 FY26 (Jun 2026)", "Completed (30-Oct-2025)", "30-Oct-2025".
// resolveTargetDate() turns those into an absolute date relative to the project
// base date (charter start, else charter created). Milestones with no parseable
// target are spread evenly to the project end date.
//
// Idempotent on milestone name (reuses a same-named gate). Caller treats
// failures as non-fatal.
// ───────────────────────────────────────────────────────────────────────────
import { db, chartersTable, milestonesTable, tasksTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { llm, isLLMConfigured } from "@workspace/llm";
import { gateStageForName } from "./gate-milestones.js";
import { chainProjectMilestones } from "./milestone-chain.js";
import { recomputeRollups } from "./rollup.js";

type CharterMilestone = { milestone?: string; responsible?: string; targetDate?: string; status?: string };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86_400_000;
const MONTHS3: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

const mkUTC = (y: number, m: number, d: number): Date => new Date(Date.UTC(y, m, d));
const fmt = (d: Date): string => d.toISOString().slice(0, 10);
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; }
function addMonths(d: Date, n: number): Date { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + n); return x; }

// Strict YYYY-MM-DD (used for the date-input values like project end date).
function parseDate(s?: string | null): Date | null {
  if (!s || !ISO.test(String(s).trim())) return null;
  const d = new Date(String(s).trim() + "T00:00:00Z");
  return isNaN(d.getTime()) ? null : d;
}

// Pull an absolute date out of free text: ISO, "30-Oct-2025", "Jun-2026"/"Jun 2026".
function parseAbsolute(s: string): Date | null {
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return mkUTC(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/(\d{1,2})[-/\s]([A-Za-z]{3})[A-Za-z]*[-/\s](\d{4})/);
  if (m && MONTHS3[m[2].toLowerCase()] !== undefined) return mkUTC(+m[3], MONTHS3[m[2].toLowerCase()], +m[1]);
  m = s.match(/\b([A-Za-z]{3})[A-Za-z]*[-/\s](\d{4})/);
  if (m && MONTHS3[m[1].toLowerCase()] !== undefined) return mkUTC(+m[2], MONTHS3[m[1].toLowerCase()], 1);
  return null;
}

// Coerce a timestamp/Date/ISO-ish value to a Date (for charter.createdAt).
function coerceDate(v: unknown): Date | null {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === "string") { const d = new Date(v); return isNaN(d.getTime()) ? parseAbsolute(v) : d; }
  return null;
}

// Indian fiscal year (Apr–Mar). Q1→Jun, Q2→Sep, Q3→Dec, Q4→Mar(next cal yr).
// FY label "26" ⇒ Apr-2025 … Mar-2026.
function quarterEnd(q: number, fy: number): Date {
  const fyEnd = fy < 100 ? 2000 + fy : fy; // FY26 → 2026 (the Mar-end year)
  const map: Record<number, [number, number]> = { 1: [fyEnd - 1, 5], 2: [fyEnd - 1, 8], 3: [fyEnd - 1, 11], 4: [fyEnd, 2] };
  const [y, mo] = map[q] ?? [fyEnd, 2];
  return mkUTC(y, mo + 1, 0); // last day of the quarter's end month
}

/**
 * Resolve a free-text NFA targetDate to an absolute deadline, relative to the
 * project `base` date for relative forms. Returns null when there's no future
 * deadline to enforce (e.g. "Completed", or unparseable text).
 */
export function resolveTargetDate(raw: string | undefined | null, base: Date): Date | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  // An explicit / parenthetical date always wins ("Month 18 (approx. Jun-2026)").
  const abs = parseAbsolute(s);
  if (abs) return abs;
  const lower = s.toLowerCase();
  let m = lower.match(/month\s*(\d+)/);          // "Month 1" → base + N months
  if (m) return addMonths(base, +m[1]);
  m = lower.match(/week\s*(\d+)/);                // "Week 3" → base + N weeks
  if (m) return addDays(base, +m[1] * 7);
  m = lower.match(/\bq([1-4])\s*fy\s*'?(\d{2,4})/); // "Q2 FY26"
  if (m) return quarterEnd(+m[1], +m[2]);
  m = lower.match(/(\d+(?:\.\d+)?)\s*(year|yr|month|mo|week|wk|day)s?\b/); // "2 months", "30 days"
  if (m) {
    const n = parseFloat(m[1]);
    if (/^y/.test(m[2])) return addMonths(base, Math.round(n * 12));
    if (/^mo|^month|^m/.test(m[2])) return addMonths(base, Math.round(n));
    if (/^w/.test(m[2])) return addDays(base, Math.round(n * 7));
    return addDays(base, Math.round(n));
  }
  return null; // "Completed", "TBD", anything else → no enforceable deadline
}

// NFA milestone status text → our task/milestone status enum.
const STATUS_MAP: Record<string, string> = {
  completed: "completed", done: "completed", closed: "completed",
  "in progress": "in_progress", in_progress: "in_progress", ongoing: "in_progress",
};
const mapStatus = (s?: string): string => STATUS_MAP[(s ?? "").trim().toLowerCase()] ?? "not_started";

// ── LLM task breakdown ──────────────────────────────────────────────────────
// Tasks are returned per milestone INDEX (1-based) — matching by name is
// fragile because the model echoes back decorated names.
const PlanSchema = z.object({
  milestones: z.array(z.object({ index: z.number(), tasks: z.array(z.string()) })),
});

// Safety net when the LLM is unavailable — never just one task, never empty.
const fallbackTasks = (name: string): string[] => [`Plan & prepare: ${name}`, `Execute: ${name}`, `Review & sign-off: ${name}`];

/**
 * Ask the LLM to break each milestone into an appropriate number of concrete
 * tasks (decided per milestone, not a fixed count). Returns an index→tasks map
 * (1-based, matching the input order); milestones the model omits fall back to
 * a basic breakdown at the call site.
 */
async function taskBreakdowns(
  project: { name: string; description?: string | null },
  windows: { name: string; start: string; due: string | null }[],
): Promise<Map<number, string[]>> {
  const out = new Map<number, string[]>();
  if (!isLLMConfigured() || !windows.length) return out;
  try {
    const res = await llm<{ milestones: { index: number; tasks: string[] }[] }>({
      task: "plan_milestone_tasks",
      system:
        "You are a PMO delivery planner. For EACH project milestone, break it into the appropriate number of concrete, actionable execution tasks — sized to the milestone's complexity: a simple gate check might need 2, a large delivery milestone 6-8. Vary the count per milestone; do NOT use a fixed number. Each task is a short imperative phrase specific to that milestone. Do not pad with filler and do not invent dates.",
      prompt:
        `Project: ${project.name}\n${project.description ? `Description: ${project.description}\n` : ""}` +
        `\nMilestones:\n${windows.map((w, i) => `${i + 1}. "${w.name}" — planned window ${w.start} to ${w.due ?? "no deadline"}`).join("\n")}\n\n` +
        `For EACH milestone (referenced by its number above) list its tasks.`,
      jsonSchema: PlanSchema,
      jsonSchemaHint: `{"milestones":[{"index":1,"tasks":["task 1","task 2"]},{"index":2,"tasks":["task 1","task 2","task 3","task 4"]}]}`,
      maxTokens: 4000,
    });
    if (res.ok && res.data?.milestones) {
      for (const m of res.data.milestones) {
        const tasks = (m.tasks ?? []).map((t) => String(t).trim()).filter(Boolean);
        if (Number.isInteger(m.index) && tasks.length) out.set(m.index, tasks);
      }
    }
  } catch { /* fall back to basic breakdown */ }
  return out;
}

/**
 * Guard the chosen project end date against the NFA milestone schedule: a
 * project can't end before its last milestone is due (or before its start).
 * Returns an error message when the end date misaligns, else null.
 */
export async function validateEndDateAgainstCharter(
  charterId: number | null | undefined,
  projectEndDate?: string | null,
): Promise<string | null> {
  const end = parseDate(projectEndDate);
  if (!charterId || !end) return null;

  const [charter] = await db
    .select({ milestones: chartersTable.milestones, startDate: chartersTable.startDate, createdAt: chartersTable.createdAt })
    .from(chartersTable)
    .where(eq(chartersTable.id, charterId));

  const base = parseDate(charter?.startDate) ?? coerceDate(charter?.createdAt) ?? new Date();
  const dated = ((charter?.milestones as CharterMilestone[] | null) ?? [])
    .map((m) => ({ name: (m?.milestone ?? "").trim(), d: resolveTargetDate(m?.targetDate, base) }))
    .filter((x): x is { name: string; d: Date } => Boolean(x.name && x.d));

  const latest = dated.reduce<{ name: string; d: Date } | null>((acc, x) => (!acc || x.d > acc.d ? x : acc), null);
  if (latest && end < latest.d) {
    const label = latest.name.length > 80 ? latest.name.slice(0, 77) + "…" : latest.name;
    return `Project end date (${fmt(end)}) is before the NFA milestone "${label}" deadline (${fmt(latest.d)}). Per the NFA timeline the project can't finish before ${fmt(latest.d)} — set the end date on or after that.`;
  }
  const start = parseDate(charter?.startDate);
  if (start && end < start) {
    return `Project end date (${fmt(end)}) is before the charter start date (${fmt(start)}).`;
  }
  return null;
}

export async function generateMilestonesAndTasksFromCharter(
  projectId: number,
  charterId: number | null | undefined,
  projectEndDate?: string | null,
): Promise<{ milestones: number; tasks: number }> {
  if (!charterId) return { milestones: 0, tasks: 0 };

  const [charter] = await db
    .select({
      milestones: chartersTable.milestones, startDate: chartersTable.startDate,
      endDate: chartersTable.endDate, createdAt: chartersTable.createdAt,
      title: chartersTable.title, description: chartersTable.description,
    })
    .from(chartersTable)
    .where(eq(chartersTable.id, charterId));

  const list = ((charter?.milestones as CharterMilestone[] | null) ?? []).filter((m) => (m?.milestone ?? "").trim());
  return scheduleMilestonesAndTasks(projectId, list, {
    name: charter?.title ?? "Project",
    description: charter?.description,
    startDate: charter?.startDate,
    endDate: projectEndDate ?? charter?.endDate,
    baseDate: coerceDate(charter?.createdAt),
  });
}

/**
 * Core scheduler — shared by charter-create and project-import. Given a project
 * and a milestone list, resolve each deadline (relative or absolute), size a
 * task set per milestone (LLM), and write milestones + tasks. Reuses same-named
 * gate milestones instead of duplicating them.
 */
export async function scheduleMilestonesAndTasks(
  projectId: number,
  rawList: CharterMilestone[],
  ctx: { name: string; description?: string | null; startDate?: string | null; endDate?: string | null; baseDate?: Date | null },
): Promise<{ milestones: number; tasks: number }> {
  const list = (rawList ?? []).filter((m) => (m?.milestone ?? "").trim());
  if (!list.length) return { milestones: 0, tasks: 0 };

  const base = parseDate(ctx.startDate) ?? ctx.baseDate ?? new Date();
  const end = parseDate(ctx.endDate);
  const spanDays = end ? Math.max(0, (end.getTime() - base.getTime()) / DAY) : 0;

  // Schedule: resolve each milestone's deadline; un-dated ones spread to the end.
  type Sched = { m: CharterMilestone; name: string; start: Date; due: Date | null };
  const schedule: Sched[] = [];
  let prevDue = base;
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    const name = m.milestone!.trim();
    let due = resolveTargetDate(m.targetDate, base);
    if (!due && spanDays > 0) due = addDays(base, Math.round(((i + 1) / list.length) * spanDays));
    schedule.push({ m, name, start: prevDue, due });
    if (due && due > prevDue) prevDue = due;
  }

  const breakdowns = await taskBreakdowns(
    { name: ctx.name, description: ctx.description },
    schedule.map((s) => ({ name: s.name, start: fmt(s.start), due: s.due ? fmt(s.due) : null })),
  );

  // Existing milestones (gates seeded just before) — reuse by name, don't dup.
  const existing = await db
    .select({ id: milestonesTable.id, name: milestonesTable.name, dueDate: milestonesTable.dueDate })
    .from(milestonesTable)
    .where(eq(milestonesTable.projectId, projectId));
  const byName = new Map(existing.map((m) => [m.name.trim().toLowerCase(), m]));

  let mCount = 0, tCount = 0;
  for (let i = 0; i < schedule.length; i++) {
    const s = schedule[i];
    const dueStr = s.due ? fmt(s.due) : null;
    const stage = gateStageForName(s.name);
    const status = mapStatus(s.m.status);

    let milestoneId: number;
    const hit = byName.get(s.name.toLowerCase());
    if (hit) {
      milestoneId = hit.id;
      if (!hit.dueDate && dueStr) await db.update(milestonesTable).set({ dueDate: dueStr }).where(eq(milestonesTable.id, hit.id));
    } else {
      const [created] = await db
        .insert(milestonesTable)
        .values({ projectId, name: s.name, dueDate: dueStr, startDate: fmt(s.start), stage: stage ?? null, status, order: 7 + i })
        .returning({ id: milestonesTable.id });
      milestoneId = created.id;
      mCount++;
    }

    // Appropriate-sized task set per milestone (by 1-based index), scheduled
    // within its window.
    const tasks = breakdowns.get(i + 1) ?? fallbackTasks(s.name);
    const winSpan = s.due ? Math.max(0, (s.due.getTime() - s.start.getTime()) / DAY) : 0;
    for (let j = 0; j < tasks.length; j++) {
      const tStart = winSpan > 0 ? addDays(s.start, Math.round((j / tasks.length) * winSpan)) : s.start;
      const tEnd = winSpan > 0 ? addDays(s.start, Math.round(((j + 1) / tasks.length) * winSpan)) : s.due;
      await db.insert(tasksTable).values({
        projectId, milestoneId, name: tasks[j],
        startDate: fmt(tStart), endDate: tEnd ? fmt(tEnd) : null, stage: stage ?? null, status: "not_started", order: j,
      });
      tCount++;
    }
  }
  // Link the project's milestones into a finish-to-start chain so the Gantt
  // shows each milestone as the predecessor of the next.
  await chainProjectMilestones(projectId);
  return { milestones: mCount, tasks: tCount };
}

// ── Full-fidelity import ─────────────────────────────────────────────────────
// Persist milestones, tasks AND subtasks EXACTLY as the file described them.
// Nothing is generated — a milestone with no tasks in the file stays empty.
// Every captured field (dates, status, priority, assignee, department, progress)
// is written; subtasks nest via parentTaskId to any depth.
export type ImportedTaskNode = {
  name?: string;
  startDate?: string | null;
  endDate?: string | null;
  status?: string | null;
  priority?: string | null;
  assignee?: string | null;
  department?: string | null;
  progress?: number | null;
  subtasks?: ImportedTaskNode[];
};
export type ImportedMilestoneNode = {
  milestone?: string;
  targetDate?: string | null;
  startDate?: string | null;
  status?: string | null;
  responsible?: string | null;
  tasks?: ImportedTaskNode[];
};

// True if the parsed data carries any task anywhere (so the caller knows to use
// the faithful importer rather than treating the file as milestone-only).
export function hasImportedTasks(list: ImportedMilestoneNode[] | undefined): boolean {
  return (list ?? []).some((m) => (m?.tasks?.length ?? 0) > 0);
}

const mapImportPriority = (raw?: string | null): string => {
  const k = (raw ?? "").trim().toUpperCase();
  if (!k) return "P2";
  if (/\bP0\b|CRITICAL|URGENT|HIGHEST/.test(k)) return "P0";
  if (/\bP1\b|HIGH/.test(k)) return "P1";
  if (/\bP3\b|\bLOW\b/.test(k)) return "P3";
  return "P2";
};
const clampPct = (v?: number | null): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;
};
// Task/milestone dates in files come as ISO, "30-Oct-2025", "Jun-2026", or a
// relative form ("Month 1"); try each in order against the project base date.
const resolveAnyDate = (raw: string | null | undefined, base: Date): Date | null =>
  parseDate(raw) ?? (raw ? parseAbsolute(String(raw).trim()) : null) ?? resolveTargetDate(raw, base);

export async function scheduleImportedProject(
  projectId: number,
  rawList: ImportedMilestoneNode[],
  ctx: { name: string; description?: string | null; startDate?: string | null; endDate?: string | null; baseDate?: Date | null },
): Promise<{ milestones: number; tasks: number }> {
  const list = (rawList ?? []).filter((m) => (m?.milestone ?? "").trim());
  if (!list.length) return { milestones: 0, tasks: 0 };

  const base = parseDate(ctx.startDate) ?? ctx.baseDate ?? new Date();
  const end = parseDate(ctx.endDate);
  const spanDays = end ? Math.max(0, (end.getTime() - base.getTime()) / DAY) : 0;

  // Milestone schedule — use the file's dates; only un-dated ones get spread.
  type Sched = { m: ImportedMilestoneNode; name: string; start: Date; due: Date | null };
  const schedule: Sched[] = [];
  let prevDue = base;
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    const name = m.milestone!.trim();
    const start = resolveAnyDate(m.startDate, base) ?? prevDue;
    let due = resolveAnyDate(m.targetDate, base);
    if (!due && spanDays > 0) due = addDays(base, Math.round(((i + 1) / list.length) * spanDays));
    schedule.push({ m, name, start, due });
    if (due && due > prevDue) prevDue = due;
  }

  // Assignees are resolved against existing users (never created).
  const users = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email }).from(usersTable);
  const userByKey = new Map<string, number>();
  for (const u of users) {
    if (u.name) userByKey.set(u.name.trim().toLowerCase(), u.id);
    if (u.email) userByKey.set(u.email.trim().toLowerCase(), u.id);
  }
  const resolveAssignee = (raw?: string | null): number | null => {
    const k = (raw ?? "").trim().toLowerCase();
    return k ? userByKey.get(k) ?? null : null;
  };

  // Reuse gate milestones seeded just before (match by name, don't duplicate).
  const existing = await db
    .select({ id: milestonesTable.id, name: milestonesTable.name, dueDate: milestonesTable.dueDate })
    .from(milestonesTable).where(eq(milestonesTable.projectId, projectId));
  const byName = new Map(existing.map((m) => [m.name.trim().toLowerCase(), m]));

  let mCount = 0, tCount = 0;

  const insertTask = async (t: ImportedTaskNode, milestoneId: number, stage: string | null, parentTaskId: number | null, order: number): Promise<void> => {
    const s = resolveAnyDate(t.startDate, base);
    const e = resolveAnyDate(t.endDate, base);
    const [row] = await db.insert(tasksTable).values({
      projectId, milestoneId, parentTaskId,
      name: (t.name ?? "").trim().slice(0, 300) || "Untitled task",
      status: mapStatus(t.status ?? undefined),
      priority: mapImportPriority(t.priority),
      progressPct: clampPct(t.progress),
      assigneeId: resolveAssignee(t.assignee),
      cftDept: (t.department ?? "").trim() || null,
      startDate: s ? fmt(s) : null,
      endDate: e ? fmt(e) : null,
      stage: stage ?? null,
      order,
    }).returning({ id: tasksTable.id });
    tCount++;
    const subs = (t.subtasks ?? []).filter((x) => (x?.name ?? "").trim());
    for (let k = 0; k < subs.length; k++) await insertTask(subs[k], milestoneId, stage, row.id, k);
  };

  for (let i = 0; i < schedule.length; i++) {
    const s = schedule[i];
    const dueStr = s.due ? fmt(s.due) : null;
    const stage = gateStageForName(s.name);
    const status = mapStatus(s.m.status ?? undefined);

    let milestoneId: number;
    const hit = byName.get(s.name.toLowerCase());
    if (hit) {
      milestoneId = hit.id;
      if (!hit.dueDate && dueStr) await db.update(milestonesTable).set({ dueDate: dueStr }).where(eq(milestonesTable.id, hit.id));
    } else {
      const [created] = await db.insert(milestonesTable)
        .values({ projectId, name: s.name, dueDate: dueStr, startDate: fmt(s.start), stage: stage ?? null, status, order: 7 + i })
        .returning({ id: milestonesTable.id });
      milestoneId = created.id;
      mCount++;
    }

    // Only what's in the file — no generation, no fallback tasks.
    const tasks = (s.m.tasks ?? []).filter((t) => (t?.name ?? "").trim());
    for (let j = 0; j < tasks.length; j++) await insertTask(tasks[j], milestoneId, stage, null, j);
  }

  await chainProjectMilestones(projectId);
  try { await recomputeRollups(projectId); } catch { /* non-fatal */ }
  return { milestones: mCount, tasks: tCount };
}
