// One-off: import Jira project MYG into PMO project 40 (myGranules), turning
// Jira Epics into pmo_milestones and nesting stories/sub-tasks underneath, so
// the Timeline shows an Epic → Task Gantt hierarchy.
//
// Faithfully mirrors the committed POST /api/integrations/jira/import handler
// (routes/integrations/jira.ts) so behaviour matches the in-app sync exactly.
// Idempotent by jira_key. Run:
//   DATABASE_URL=... tsx src/import-myg.ts
import { db, projectsTable, tasksTable, milestonesTable, mcpIntegrationsTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import {
  type JiraConfig,
  jiraSearchIssues,
  jiraStatusToPmo,
  jiraPriorityToPmo,
} from "./lib/integrations/jira";
import { recomputeRollups } from "./lib/rollup";

const JIRA_PROJECT_KEY = "MYG";
const PMO_PROJECT_ID = 40;

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
  await db.update(projectsTable).set({ jiraKey: JIRA_PROJECT_KEY, jiraSyncedAt: new Date() }).where(eq(projectsTable.id, project.id));
  const projectId = project.id;

  const issues = await jiraSearchIssues(cfg, `project = "${JIRA_PROJECT_KEY}" ORDER BY created ASC`);
  console.log(`fetched ${issues.length} Jira issues`);

  const isEpic = (it: Issue) => /epic/i.test(it.issueType);
  const epicKeyList = issues.filter(isEpic).map((it) => it.key);
  const epicKeys = new Set(epicKeyList);
  console.log(`epics: ${epicKeyList.length}`);

  // Drop leftover epic-tasks from the pre-epics-as-milestones import.
  if (epicKeyList.length) {
    await db.delete(tasksTable).where(and(eq(tasksTable.projectId, projectId), inArray(tasksTable.jiraKey, epicKeyList)));
    console.log(`removed flat epic-tasks for ${epicKeyList.length} epic keys`);
  }

  // Pass 1: Epics → milestones.
  const milestoneIdByEpic = new Map<string, number>();
  let milestonesCreated = 0, milestonesUpdated = 0;
  for (const it of issues.filter(isEpic)) {
    const status = jiraStatusToPmo(it.statusCategory, it.statusName);
    const priority = jiraPriorityToPmo(it.priority);
    const name = it.summary || it.key;
    const description = it.description ?? "";
    const [existing] = await db.select({ id: milestonesTable.id }).from(milestonesTable).where(eq(milestonesTable.jiraKey, it.key));
    if (existing) {
      await db.update(milestonesTable).set({ name, description, status, priority, startDate: it.startDate ?? undefined, dueDate: it.dueDate ?? undefined, jiraSyncedAt: new Date() }).where(eq(milestonesTable.id, existing.id));
      milestoneIdByEpic.set(it.key, existing.id); milestonesUpdated++;
    } else {
      const [row] = await db.insert(milestonesTable).values({ projectId, name, description, status, priority, startDate: it.startDate ?? undefined, dueDate: it.dueDate ?? undefined, jiraKey: it.key, jiraSyncedAt: new Date() }).returning({ id: milestonesTable.id });
      milestoneIdByEpic.set(it.key, row.id); milestonesCreated++;
    }
  }

  // Pass 2 (stories) then Pass 3 (sub-tasks).
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

  try { await recomputeRollups(projectId); } catch (e) { console.warn("rollup failed (non-fatal):", (e as Error).message); }

  const linked = stories.filter((it) => it.parentKey && epicKeys.has(it.parentKey)).length;
  console.log(JSON.stringify({ projectId, total: issues.length, milestonesCreated, milestonesUpdated, stories: stories.length, storiesLinkedToEpic: linked, subtasks: subtasks.length, tasksCreated: created, tasksUpdated: updated }, null, 2));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
