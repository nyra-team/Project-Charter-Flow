import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { db, projectsTable, tasksTable, mcpIntegrationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  type JiraConfig,
  jiraListProjects,
  jiraListComponents,
  jiraSearchIssues,
  jiraCreateIssue,
  jiraUpdateIssue,
  jiraTransitionToCategory,
  jiraStatusToPmo,
  pmoStatusToJiraCategory,
  jiraPriorityToPmo,
} from "../../lib/integrations/jira";

// Jira ⇄ PMO two-way sync. Mounted at /api/integrations/jira behind the
// standard requireAuth chain (app-level), so any access_pmo user can run it.
//
//   import  : Jira project's issues  → pmo_projects (1) + pmo_tasks (n)
//   export  : pmo_project + its tasks → Jira issues
//
// Idempotent via the jira_key columns on pmo_projects / pmo_tasks.

const router: IRouter = Router();

/** Read the saved, enabled Jira connector from pmo_mcp_integrations. */
async function loadJiraConfig(): Promise<JiraConfig> {
  const [row] = await db.select().from(mcpIntegrationsTable).where(eq(mcpIntegrationsTable.kind, "jira"));
  if (!row) throw new Error("No Jira connector configured. Add one in Admin → Integrations.");
  if (!row.enabled) throw new Error("Jira connector is disabled. Enable it in Admin → Integrations.");
  const cfg = (row.config ?? {}) as Partial<JiraConfig>;
  if (!cfg.baseUrl || !cfg.email || !cfg.apiToken) {
    throw new Error("Jira connector is missing baseUrl/email/apiToken.");
  }
  return cfg as JiraConfig;
}

// ─── GET /api/integrations/jira/projects ──────────────────────────────────
// Lists Jira projects for the import picker.
router.get("/integrations/jira/projects", async (req, res): Promise<void> => {
  let cfg: JiraConfig;
  try { cfg = await loadJiraConfig(); } catch (e) { res.status(400).json({ error: (e as Error).message }); return; }
  try {
    res.json(await jiraListProjects(cfg));
  } catch (e) {
    res.status(502).json({ error: `Jira project list failed: ${(e as Error).message}` });
  }
});

// ─── GET /api/integrations/jira/projects/:key/components ──────────────────
// Lists a Jira project's components (modules) for the import filter.
router.get("/integrations/jira/projects/:key/components", async (req, res): Promise<void> => {
  let cfg: JiraConfig;
  try { cfg = await loadJiraConfig(); } catch (e) { res.status(400).json({ error: (e as Error).message }); return; }
  try {
    res.json(await jiraListComponents(cfg, req.params.key));
  } catch (e) {
    res.status(502).json({ error: `Jira components failed: ${(e as Error).message}` });
  }
});

// ─── POST /api/integrations/jira/import ───────────────────────────────────
const ImportBody = z.object({
  jiraProjectKey: z.string().min(1),
  pmoProjectId: z.number().int().optional(),
  component: z.string().min(1).optional(), // filter: import only this Jira component
});

router.post("/integrations/jira/import", async (req, res): Promise<void> => {
  const parsed = ImportBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  let cfg: JiraConfig;
  try { cfg = await loadJiraConfig(); } catch (e) { res.status(400).json({ error: (e as Error).message }); return; }
  const { jiraProjectKey } = parsed.data;

  // Resolve the Jira project (name + existence).
  let jiraProjects;
  try { jiraProjects = await jiraListProjects(cfg); }
  catch (e) { res.status(502).json({ error: `Jira project list failed: ${(e as Error).message}` }); return; }
  const jp = jiraProjects.find((p) => p.key === jiraProjectKey);
  if (!jp) { res.status(404).json({ error: `Jira project ${jiraProjectKey} not found or not accessible` }); return; }

  // Resolve / create the mapped PMO project.
  let project;
  if (parsed.data.pmoProjectId != null) {
    [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, parsed.data.pmoProjectId));
    if (!project) { res.status(404).json({ error: "PMO project not found" }); return; }
    await db.update(projectsTable).set({ jiraKey: jiraProjectKey, jiraSyncedAt: new Date() }).where(eq(projectsTable.id, project.id));
  } else {
    [project] = await db.select().from(projectsTable).where(eq(projectsTable.jiraKey, jiraProjectKey));
    if (!project) {
      [project] = await db.insert(projectsTable).values({
        name: jp.name || jiraProjectKey,
        description: `Imported from Jira project ${jiraProjectKey}`,
        jiraKey: jiraProjectKey,
        jiraSyncedAt: new Date(),
      }).returning();
    } else {
      await db.update(projectsTable).set({ jiraSyncedAt: new Date() }).where(eq(projectsTable.id, project.id));
    }
  }
  const projectId = project.id;

  // Fetch + upsert issues as tasks. Optional component filter.
  const compFilter = parsed.data.component ? ` AND component = "${parsed.data.component.replace(/"/g, '\\"')}"` : "";
  let issues;
  try { issues = await jiraSearchIssues(cfg, `project = "${jiraProjectKey}"${compFilter} ORDER BY created ASC`); }
  catch (e) { res.status(502).json({ error: `Jira search failed: ${(e as Error).message}` }); return; }

  let created = 0, updated = 0;
  for (const it of issues) {
    const status = jiraStatusToPmo(it.statusCategory);
    const priority = jiraPriorityToPmo(it.priority);
    const name = it.summary || it.key;
    // Store the clean Jira description (issue key/type live in jira_key /
    // the issue itself) so a later export doesn't write a "[KEY] type"
    // prefix back into Jira.
    const description = it.description ?? "";
    const [existing] = await db.select({ id: tasksTable.id }).from(tasksTable).where(eq(tasksTable.jiraKey, it.key));
    if (existing) {
      await db.update(tasksTable)
        .set({ name, description, status, priority, endDate: it.dueDate ?? undefined, jiraComponent: it.component ?? null, jiraSyncedAt: new Date() })
        .where(eq(tasksTable.id, existing.id));
      updated++;
    } else {
      await db.insert(tasksTable).values({
        projectId, name, description, status, priority,
        endDate: it.dueDate ?? undefined,
        jiraKey: it.key, jiraComponent: it.component ?? null, jiraSyncedAt: new Date(),
      });
      created++;
    }
  }

  res.json({ projectId, jiraProjectKey, total: issues.length, created, updated });
});

// ─── POST /api/integrations/jira/export ───────────────────────────────────
const ExportBody = z.object({
  pmoProjectId: z.number().int(),
  jiraProjectKey: z.string().min(1).optional(),
  syncStatus: z.boolean().optional().default(true),
  // Safety: by default export only CREATES Jira issues for unlinked tasks.
  // Updating already-linked Jira issues (overwriting their summary/
  // description) requires opting in, so clicking Export on an imported
  // project can never silently clobber the live board.
  updateExisting: z.boolean().optional().default(false),
});

// Strip a legacy "[KEY] IssueType\n\n" prefix that older imports wrote into
// the description, so exports send clean text.
function cleanDescription(d: string | null | undefined): string {
  return (d ?? "").replace(/^\[[A-Z][A-Z0-9]+-\d+\]\s+[^\n]+\n\n/, "");
}

router.post("/integrations/jira/export", async (req, res): Promise<void> => {
  const parsed = ExportBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  let cfg: JiraConfig;
  try { cfg = await loadJiraConfig(); } catch (e) { res.status(400).json({ error: (e as Error).message }); return; }

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, parsed.data.pmoProjectId));
  if (!project) { res.status(404).json({ error: "PMO project not found" }); return; }

  const jiraProjectKey = parsed.data.jiraProjectKey || project.jiraKey || cfg.projectKey;
  if (!jiraProjectKey) {
    res.status(400).json({ error: "No target Jira project. Pass jiraProjectKey, link the project first, or set a default projectKey on the connector." });
    return;
  }

  const tasks = await db.select().from(tasksTable).where(eq(tasksTable.projectId, project.id));
  let created = 0, updated = 0, skipped = 0;
  const errors: Array<{ taskId: number; name: string; error: string }> = [];

  for (const t of tasks) {
    const summary = t.name;
    const description = cleanDescription(t.description);
    try {
      let key = t.jiraKey;
      if (key) {
        if (!parsed.data.updateExisting) { skipped++; continue; } // safe default: don't overwrite linked issues
        await jiraUpdateIssue(cfg, key, { summary, description });
        updated++;
      } else {
        ({ key } = await jiraCreateIssue(cfg, { projectKey: jiraProjectKey, summary, description }));
        await db.update(tasksTable).set({ jiraKey: key, jiraSyncedAt: new Date() }).where(eq(tasksTable.id, t.id));
        created++;
      }
      if (parsed.data.syncStatus && key) {
        try { await jiraTransitionToCategory(cfg, key, pmoStatusToJiraCategory(t.status)); } catch { /* best-effort */ }
      }
    } catch (e) {
      errors.push({ taskId: t.id, name: t.name, error: (e as Error).message });
    }
  }

  if (!project.jiraKey) {
    await db.update(projectsTable).set({ jiraKey: jiraProjectKey, jiraSyncedAt: new Date() }).where(eq(projectsTable.id, project.id));
  }

  res.json({ pmoProjectId: project.id, jiraProjectKey, created, updated, skipped, errors });
});

export default router;
