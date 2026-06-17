// One-off: split the clubbed myGranules project (40) into one PMO project per
// application, using each task's jira_component as the app. Recruit + SOP get
// new projects; OHC reuses the existing empty project 12. Each target gets its
// own "Unscheduled" milestone (482 belongs to project 40 and can't follow the
// tasks). Reversible via /home/nyra/pmo_myg_split_backup.csv.
//   DATABASE_URL=... tsx src/split-myg.ts
import { db, projectsTable, tasksTable, milestonesTable } from "@workspace/db";
import { eq, and, or, inArray, sql } from "drizzle-orm";
import { recomputeRollups } from "./lib/rollup";

const SRC = 40;
const OHC_PROJECT = 12; // existing, empty — reuse

// untagged tasks that clearly belong to an app (from manual inspection)
const RECRUIT_STRAGGLERS = [167, 168, 169, 170, 271]; // proctoring/webcam/exam/onboarding
const SOP_STRAGGLERS = [409, 410, 411]; // "Testing" / "SOP" / "Review PMO" placeholders

async function ensureProject(name: string): Promise<number> {
  const [existing] = await db.select({ id: projectsTable.id }).from(projectsTable).where(eq(projectsTable.name, name));
  if (existing) { console.log(`project "${name}" exists → ${existing.id}`); return existing.id; }
  // mirror project 40's stage/type so the new projects look consistent
  const [src] = await db.select().from(projectsTable).where(eq(projectsTable.id, SRC));
  const [row] = await db.insert(projectsTable).values({
    name, status: src?.status ?? "new", stage: src?.stage ?? "project_case",
    projectType: src?.projectType ?? "vendor", portfolioId: src?.portfolioId ?? null,
  }).returning({ id: projectsTable.id });
  console.log(`created project "${name}" → ${row.id}`);
  return row.id;
}

async function ensureUnscheduled(projectId: number): Promise<number> {
  const [existing] = await db.select({ id: milestonesTable.id }).from(milestonesTable)
    .where(and(eq(milestonesTable.projectId, projectId), eq(milestonesTable.name, "Unscheduled")));
  if (existing) return existing.id;
  const [row] = await db.insert(milestonesTable).values({ projectId, name: "Unscheduled", order: 9999 }).returning({ id: milestonesTable.id });
  return row.id;
}

async function move(label: string, projectId: number, where: ReturnType<typeof and> | ReturnType<typeof eq>): Promise<void> {
  const milestoneId = await ensureUnscheduled(projectId);
  const moved = await db.update(tasksTable).set({ projectId, milestoneId }).where(where!).returning({ id: tasksTable.id });
  console.log(`${label}: moved ${moved.length} tasks → project ${projectId}, milestone ${milestoneId}`);
}

async function main() {
  const recruitId = await ensureProject("Recruit");
  const sopId = await ensureProject("SOP Harmonization");

  // OHC: component='OHC'
  await move("OHC", OHC_PROJECT, and(eq(tasksTable.projectId, SRC), eq(tasksTable.jiraComponent, "OHC")));
  // Recruit: component='Recruit' OR the 5 untagged stragglers
  await move("Recruit", recruitId, and(eq(tasksTable.projectId, SRC),
    or(eq(tasksTable.jiraComponent, "Recruit"), inArray(tasksTable.id, RECRUIT_STRAGGLERS))));
  // SOP: component='SOP' OR the 3 junk stragglers
  await move("SOP", sopId, and(eq(tasksTable.projectId, SRC),
    or(eq(tasksTable.jiraComponent, "SOP"), inArray(tasksTable.id, SOP_STRAGGLERS))));

  const [{ left }] = await db.select({ left: sql<number>`count(*)::int` }).from(tasksTable).where(eq(tasksTable.projectId, SRC));
  console.log(`tasks still under myGranules(${SRC}): ${left}`);

  for (const pid of [OHC_PROJECT, recruitId, sopId, SRC]) {
    try { await recomputeRollups(pid); console.log(`rollups recomputed for ${pid}`); }
    catch (e) { console.warn(`rollup ${pid} failed (non-fatal):`, (e as Error).message); }
  }
  console.log("done.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
