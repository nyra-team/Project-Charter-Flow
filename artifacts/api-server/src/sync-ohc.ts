// One-off: re-sync PMO project 12 (OHC) from Jira MYG component=OHC, following
// the committed POST /api/integrations/jira/import handler exactly, plus the
// project-12-specific cleanup the generic import can't do:
//   1. adopt the 9 hand-made milestones (created 17 Jun, jira_key NULL) by
//      linking them to their Jira epics BEFORE the import, so pass 1 updates
//      them in place instead of creating duplicates;
//   2. delete the 3 ghost tasks whose Jira issues were retired ([WONT DO])
//      and then deleted from Jira (MYG-161 / MYG-165 / MYG-190);
//   3. drop the extra "Admin, Approvals & Configuration" milestone if the
//      import leaves it empty (it never corresponded to a Jira epic);
//   4. link the project to MYG (jira_key) so the in-app "Import from Jira"
//      button targets project 12 from now on.
// Backup of every touched row is written to /home/nyra/pmo_ohc_sync_backup.json.
// Run from artifacts/api-server:
//   DATABASE_URL=... npx tsx src/sync-ohc.ts
import { writeFileSync } from "node:fs";
import { db, projectsTable, tasksTable, milestonesTable, mcpIntegrationsTable } from "@workspace/db";
import { eq, and, inArray, isNull } from "drizzle-orm";
import {
  type JiraConfig,
  jiraSearchIssues,
  jiraStatusToPmo,
  jiraPriorityToPmo,
} from "./lib/integrations/jira";
import { recomputeRollups } from "./lib/rollup";

const JIRA_PROJECT_KEY = "MYG";
const JIRA_COMPONENT = "OHC";
const PMO_PROJECT_ID = 12;
const BACKUP_PATH = "/home/nyra/pmo_ohc_sync_backup.json";

// Jira issues that no longer exist (retired via [WONT DO], then deleted).
const GHOST_KEYS = ["MYG-161", "MYG-165", "MYG-190"];

// Hand-made milestone name → the Jira epic it represents.
const MILESTONE_ADOPT: Record<string, string> = {
  "OPD & Appointments": "MYG-5",
  "Periodic Health Check-ups": "MYG-6",
  "My Health (Employee Self-Service)": "MYG-13",
  "Medicine Inventory": "MYG-14",
  "Health Champion (Wellness Rewards)": "MYG-15",
  "Insurance & Employee Benefits": "MYG-21",
  "Facility Compliance Checklists": "MYG-216",
  "UI Upgrade & Testing": "MYG-287",
};
const DROP_IF_EMPTY = "Admin, Approvals & Configuration";

async function loadJiraConfig(): Promise<JiraConfig> {
  const [row] = await db.select().from(mcpIntegrationsTable).where(eq(mcpIntegrationsTable.kind, "jira"));
  if (!row) throw new Error("No Jira connector configured.");
  if (!row.enabled) throw new Error("Jira connector is disabled.");
  const cfg = (row.config ?? {}) as Partial<JiraConfig>;
  if (!cfg.baseUrl || !cfg.email || !cfg.apiToken) throw new Error("Jira connector missing baseUrl/email/apiToken.");
  return cfg as JiraConfig;
}

type Issue = Awaited<ReturnType<typeof jiraSearchIssues>>[number];

async function upsertTask(
  it: Issue,
  projectId: number,
  rels: { milestoneId?: number | null; parentTaskId?: number | null },
): Promise<{ id: number; created: boolean }> {
  const status = jiraStatusToPmo(it.statusCategory, it.statusName);
  const priority = jiraPriorityToPmo(it.priority);
  const name = it.summary || it.key;
  const description = it.description ?? "";
  const [existing] = await db.select({ id: tasksTable.id }).from(tasksTable).where(eq(tasksTable.jiraKey, it.key));
  if (existing) {
    await db.update(tasksTable).set({
      name, description, status, priority,
      endDate: it.dueDate ?? undefined,
      milestoneId: rels.milestoneId ?? null,
      parentTaskId: rels.parentTaskId ?? null,
      jiraComponent: it.component ?? null, jiraSyncedAt: new Date(),
    }).where(eq(tasksTable.id, existing.id));
    return { id: existing.id, created: false };
  }
  const [row] = await db.insert(tasksTable).values({
    projectId, name, description, status, priority,
    endDate: it.dueDate ?? undefined,
    milestoneId: rels.milestoneId ?? null,
    parentTaskId: rels.parentTaskId ?? null,
    jiraKey: it.key, jiraComponent: it.component ?? null, jiraSyncedAt: new Date(),
  }).returning({ id: tasksTable.id });
  return { id: row.id, created: true };
}

async function main() {
  const cfg = await loadJiraConfig();

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, PMO_PROJECT_ID));
  if (!project) throw new Error(`PMO project ${PMO_PROJECT_ID} not found`);
  const projectId = project.id;

  // ── Backup everything we may touch ────────────────────────────────────────
  const tasksBefore = await db.select().from(tasksTable).where(eq(tasksTable.projectId, projectId));
  const milestonesBefore = await db.select().from(milestonesTable).where(eq(milestonesTable.projectId, projectId));
  writeFileSync(BACKUP_PATH, JSON.stringify({ project, tasks: tasksBefore, milestones: milestonesBefore }, null, 2));
  console.log(`backup: ${tasksBefore.length} tasks + ${milestonesBefore.length} milestones → ${BACKUP_PATH}`);

  // ── 1. Adopt hand-made milestones as their Jira epics ─────────────────────
  for (const [name, epicKey] of Object.entries(MILESTONE_ADOPT)) {
    const r = await db.update(milestonesTable)
      .set({ jiraKey: epicKey })
      .where(and(
        eq(milestonesTable.projectId, projectId),
        eq(milestonesTable.name, name),
        isNull(milestonesTable.jiraKey),
      ))
      .returning({ id: milestonesTable.id });
    if (r.length) console.log(`adopted milestone "${name}" → ${epicKey} (id ${r[0].id})`);
  }

  // ── Fetch the OHC slice of MYG ────────────────────────────────────────────
  const issues = await jiraSearchIssues(
    cfg,
    `project = "${JIRA_PROJECT_KEY}" AND component = "${JIRA_COMPONENT}" ORDER BY created ASC`,
  );
  console.log(`fetched ${issues.length} Jira issues (component ${JIRA_COMPONENT})`);
  if (!issues.length) throw new Error("Jira returned no issues — aborting before touching tasks.");

  const isEpic = (it: Issue) => /epic/i.test(it.issueType);
  const epicKeyList = issues.filter(isEpic).map((it) => it.key);
  const epicKeys = new Set(epicKeyList);
  console.log(`epics: ${epicKeyList.length}`);

  // Drop leftover flat epic-task rows (epics live as milestones, not tasks).
  if (epicKeyList.length) {
    const dropped = await db.delete(tasksTable)
      .where(and(eq(tasksTable.projectId, projectId), inArray(tasksTable.jiraKey, epicKeyList)))
      .returning({ jiraKey: tasksTable.jiraKey });
    if (dropped.length) console.log(`removed flat epic-tasks: ${dropped.map((d) => d.jiraKey).join(", ")}`);
  }

  // ── Pass 1: Epics → milestones (upsert by jira_key) ───────────────────────
  const milestoneIdByEpic = new Map<string, number>();
  let milestonesCreated = 0, milestonesUpdated = 0;
  for (const it of issues.filter(isEpic)) {
    const status = jiraStatusToPmo(it.statusCategory, it.statusName);
    const priority = jiraPriorityToPmo(it.priority);
    const name = it.summary || it.key;
    const description = it.description ?? "";
    const [existing] = await db.select({ id: milestonesTable.id }).from(milestonesTable).where(eq(milestonesTable.jiraKey, it.key));
    if (existing) {
      await db.update(milestonesTable)
        .set({ name, description, status, priority, startDate: it.startDate ?? undefined, dueDate: it.dueDate ?? undefined, jiraSyncedAt: new Date() })
        .where(eq(milestonesTable.id, existing.id));
      milestoneIdByEpic.set(it.key, existing.id); milestonesUpdated++;
    } else {
      const [row] = await db.insert(milestonesTable).values({
        projectId, name, description, status, priority,
        startDate: it.startDate ?? undefined, dueDate: it.dueDate ?? undefined,
        jiraKey: it.key, jiraSyncedAt: new Date(),
      }).returning({ id: milestonesTable.id });
      milestoneIdByEpic.set(it.key, row.id); milestonesCreated++;
    }
  }

  // ── Pass 2 (stories) then Pass 3 (sub-tasks) → tasks ──────────────────────
  const taskIdByKey = new Map<string, number>();
  const milestoneIdByTaskKey = new Map<string, number | null>();
  let created = 0, updated = 0;
  const nonEpics = issues.filter((it) => !isEpic(it));
  const stories = nonEpics.filter((it) => !it.parentKey || epicKeys.has(it.parentKey));
  const subtasks = nonEpics.filter((it) => it.parentKey && !epicKeys.has(it.parentKey));

  for (const it of stories) {
    const milestoneId = it.parentKey ? milestoneIdByEpic.get(it.parentKey) ?? null : null;
    const r = await upsertTask(it, projectId, { milestoneId });
    taskIdByKey.set(it.key, r.id); milestoneIdByTaskKey.set(it.key, milestoneId);
    if (r.created) created++; else updated++;
  }
  for (const it of subtasks) {
    const parentTaskId = it.parentKey ? taskIdByKey.get(it.parentKey) ?? null : null;
    const milestoneId = it.parentKey ? milestoneIdByTaskKey.get(it.parentKey) ?? null : null;
    const r = await upsertTask(it, projectId, { milestoneId, parentTaskId });
    if (r.created) created++; else updated++;
  }

  // ── 2. Delete ghost tasks (issues deleted from Jira) ──────────────────────
  const ghosts = await db.delete(tasksTable)
    .where(and(eq(tasksTable.projectId, projectId), inArray(tasksTable.jiraKey, GHOST_KEYS)))
    .returning({ jiraKey: tasksTable.jiraKey, name: tasksTable.name });
  console.log(`ghost tasks deleted: ${ghosts.map((g) => g.jiraKey).join(", ") || "none"}`);

  // ── 3. Drop the extra milestone if the re-parenting emptied it ────────────
  const [extra] = await db.select({ id: milestonesTable.id }).from(milestonesTable)
    .where(and(eq(milestonesTable.projectId, projectId), eq(milestonesTable.name, DROP_IF_EMPTY)));
  if (extra) {
    const stillThere = await db.select({ id: tasksTable.id }).from(tasksTable).where(eq(tasksTable.milestoneId, extra.id));
    if (stillThere.length === 0) {
      await db.delete(milestonesTable).where(eq(milestonesTable.id, extra.id));
      console.log(`dropped empty milestone "${DROP_IF_EMPTY}" (id ${extra.id})`);
    } else {
      console.log(`kept milestone "${DROP_IF_EMPTY}" — still has ${stillThere.length} task(s)`);
    }
  }

  // ── 4. Link the project so the in-app import targets it from now on ───────
  await db.update(projectsTable).set({ jiraKey: JIRA_PROJECT_KEY, jiraSyncedAt: new Date() }).where(eq(projectsTable.id, projectId));

  try { await recomputeRollups(projectId); } catch (e) { console.warn("rollup failed (non-fatal):", (e as Error).message); }

  const linked = stories.filter((it) => it.parentKey && epicKeys.has(it.parentKey)).length;
  console.log(JSON.stringify({
    projectId, total: issues.length,
    milestonesCreated, milestonesUpdated,
    stories: stories.length, storiesLinkedToEpic: linked, subtasks: subtasks.length,
    tasksCreated: created, tasksUpdated: updated,
    ghostsDeleted: ghosts.length,
  }, null, 2));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
