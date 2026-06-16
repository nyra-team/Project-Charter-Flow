import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import {
  db,
  projectTemplatesTable,
  templateTasksTable,
  templateMilestonesTable,
  projectsTable,
  tasksTable,
  milestonesTable,
} from "@workspace/db";
import { eq, desc, asc } from "drizzle-orm";
import { logActivity } from "./activity";
import { seedProjectTemplateDocuments } from "../lib/templateDocuments";
import { requireRole } from "../lib/guard";

const router: IRouter = Router();

// ─── Inline validation schemas ──────────────────────────────────────────────
// Kept inline (matching the style of routes/notifications.ts) so this stage
// stays self-contained. Once the openapi.yaml regen cycle runs across all of
// the new stages, these can be lifted into @workspace/api-zod in one pass.

const CreateTemplateBody = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  category: z.string().optional(),
  sourceProjectId: z.number().int().optional(),
  createdById: z.number().int().optional(),
});

// Upload/import a populated template from a JSON file. Tasks reference their
// parent + predecessors BY NAME (not DB id) so the file is hand-authorable;
// the importer resolves names within the upload in a second pass.
const ImportTemplateBody = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  category: z.string().optional(),
  createdById: z.number().int().optional(),
  milestones: z.array(z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    defaultDayOffset: z.number().int().optional(),
    gateDecision: z.string().optional(),
    readinessChecklist: z.array(z.unknown()).optional(),
  })).optional(),
  tasks: z.array(z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    defaultDurationDays: z.number().int().positive().optional(),
    defaultDayOffset: z.number().int().optional(),
    defaultPriority: z.string().optional(),
    defaultOwnerRole: z.string().optional(),
    defaultEffortHours: z.number().optional(),
    parent: z.string().optional(),                  // parent task NAME (subtasks)
    predecessors: z.array(z.string()).optional(),   // predecessor task NAMES
  })).optional(),
});

const UpdateTemplateBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  isActive: z.boolean().optional(),
});

const PredecessorOffsetSchema = z.object({
  templateTaskId: z.number().int(),
  lagDays: z.number().int(),
});

const TemplateTaskBody = z.object({
  parentTaskId: z.number().int().nullable().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  defaultDurationDays: z.number().int().positive().optional(),
  defaultDayOffset: z.number().int().min(0).optional(),
  defaultPriority: z.string().optional(),
  defaultOwnerRole: z.string().nullable().optional(),
  defaultEffortHours: z.number().optional(),
  predecessorOffsets: z.array(PredecessorOffsetSchema).optional(),
  sortOrder: z.number().int().optional(),
});

const TemplateMilestoneBody = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  defaultDayOffset: z.number().int().min(0).optional(),
  gateDecision: z.string().nullable().optional(),
  readinessChecklist: z.array(z.unknown()).optional(),
  sortOrder: z.number().int().optional(),
});

const FromProjectBody = z.object({
  name: z.string().min(1),
  category: z.string().optional(),
  description: z.string().optional(),
  createdById: z.number().int().optional(),
});

const FromTemplateBody = z.object({
  templateId: z.number().int(),
  projectName: z.string().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "startDate must be YYYY-MM-DD"),
  projectManagerId: z.number().int().optional(),
  charterId: z.number().int().optional(),
  portfolioId: z.number().int().optional(),
  programId: z.number().int().optional(),
});

// ─── Date helpers ───────────────────────────────────────────────────────────

function addDays(yyyyMmDd: string, days: number): string {
  const d = new Date(yyyyMmDd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dayOffsetBetween(start: string, end: string | null): number {
  if (!end) return 0;
  const ms = new Date(end + "T00:00:00Z").getTime() - new Date(start + "T00:00:00Z").getTime();
  return Math.max(0, Math.round(ms / 86400000));
}

// ═══════════════════════════════════════════════════════════════════════════
// TEMPLATES — CRUD
// ═══════════════════════════════════════════════════════════════════════════

router.get("/templates", async (req, res): Promise<void> => {
  const includeInactive = req.query.includeInactive === "true";
  const rows = includeInactive
    ? await db.select().from(projectTemplatesTable).orderBy(desc(projectTemplatesTable.createdAt))
    : await db
        .select()
        .from(projectTemplatesTable)
        .where(eq(projectTemplatesTable.isActive, true))
        .orderBy(desc(projectTemplatesTable.createdAt));
  res.json(rows);
});

router.get("/templates/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [tpl] = await db.select().from(projectTemplatesTable).where(eq(projectTemplatesTable.id, id));
  if (!tpl) {
    res.status(404).json({ error: "Template not found" });
    return;
  }
  const tasks = await db
    .select()
    .from(templateTasksTable)
    .where(eq(templateTasksTable.templateId, id))
    .orderBy(asc(templateTasksTable.sortOrder));
  const milestones = await db
    .select()
    .from(templateMilestonesTable)
    .where(eq(templateMilestonesTable.templateId, id))
    .orderBy(asc(templateMilestonesTable.sortOrder));
  res.json({ ...tpl, tasks, milestones });
});

router.post("/templates", requireRole("pmo"), async (req, res): Promise<void> => {
  const parsed = CreateTemplateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [tpl] = await db.insert(projectTemplatesTable).values(parsed.data).returning();
  await logActivity("template_created", `Template "${tpl.name}" created`, tpl.id, "template");
  res.status(201).json(tpl);
});

router.patch("/templates/:id", requireRole("pmo"), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = UpdateTemplateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [tpl] = await db
    .update(projectTemplatesTable)
    .set(parsed.data)
    .where(eq(projectTemplatesTable.id, id))
    .returning();
  if (!tpl) {
    res.status(404).json({ error: "Template not found" });
    return;
  }
  res.json(tpl);
});

// Soft-delete only — flipping isActive=false hides the template without
// orphaning its template_tasks / template_milestones children.
router.delete("/templates/:id", requireRole("pmo"), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [tpl] = await db
    .update(projectTemplatesTable)
    .set({ isActive: false })
    .where(eq(projectTemplatesTable.id, id))
    .returning();
  if (!tpl) {
    res.status(404).json({ error: "Template not found" });
    return;
  }
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// TEMPLATE TASKS — nested CRUD
// ═══════════════════════════════════════════════════════════════════════════

router.post("/templates/:id/tasks", requireRole("pmo"), async (req, res): Promise<void> => {
  const templateId = parseInt(req.params.id);
  if (isNaN(templateId)) {
    res.status(400).json({ error: "Invalid template id" });
    return;
  }
  const parsed = TemplateTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { defaultEffortHours, ...rest } = parsed.data;
  const [row] = await db
    .insert(templateTasksTable)
    .values({
      templateId,
      ...rest,
      defaultEffortHours: defaultEffortHours != null ? String(defaultEffortHours) : undefined,
    } as never)
    .returning();
  res.status(201).json(row);
});

router.patch("/template-tasks/:id", requireRole("pmo"), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = TemplateTaskBody.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { defaultEffortHours, ...rest } = parsed.data;
  const update: Record<string, unknown> = { ...rest };
  if (defaultEffortHours != null) update.defaultEffortHours = String(defaultEffortHours);
  const [row] = await db.update(templateTasksTable).set(update).where(eq(templateTasksTable.id, id)).returning();
  if (!row) {
    res.status(404).json({ error: "Template task not found" });
    return;
  }
  res.json(row);
});

router.delete("/template-tasks/:id", requireRole("pmo"), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await db.delete(templateTasksTable).where(eq(templateTasksTable.id, id));
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// TEMPLATE MILESTONES
// ═══════════════════════════════════════════════════════════════════════════

router.post("/templates/:id/milestones", requireRole("pmo"), async (req, res): Promise<void> => {
  const templateId = parseInt(req.params.id);
  if (isNaN(templateId)) {
    res.status(400).json({ error: "Invalid template id" });
    return;
  }
  const parsed = TemplateMilestoneBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db
    .insert(templateMilestonesTable)
    .values({ templateId, ...parsed.data } as never)
    .returning();
  res.status(201).json(row);
});

router.patch("/template-milestones/:id", requireRole("pmo"), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = TemplateMilestoneBody.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db
    .update(templateMilestonesTable)
    .set(parsed.data)
    .where(eq(templateMilestonesTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Template milestone not found" });
    return;
  }
  res.json(row);
});

router.delete("/template-milestones/:id", requireRole("pmo"), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await db.delete(templateMilestonesTable).where(eq(templateMilestonesTable.id, id));
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// SAVE AS TEMPLATE — clone structure from an existing project
//
// Captures the project's tasks (incl. parent/child + predecessors) and
// milestones into a new template. Schedule data becomes offsets from the
// project's start date so the template is portable.  Actuals (status, RAG,
// progress, actual hours, assignees) are intentionally NOT cloned — a
// template carries structure only.
// ═══════════════════════════════════════════════════════════════════════════

router.post("/templates/from-project/:projectId", requireRole("pmo"), async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.projectId);
  if (isNaN(projectId)) {
    res.status(400).json({ error: "Invalid project id" });
    return;
  }
  const parsed = FromProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  // 1. Create the template shell.
  const [tpl] = await db
    .insert(projectTemplatesTable)
    .values({
      name: parsed.data.name,
      description: parsed.data.description ?? `Cloned from project: ${project.name}`,
      category: parsed.data.category ?? "general",
      sourceProjectId: projectId,
      createdById: parsed.data.createdById,
    })
    .returning();

  // Anchor for offset calculations. Fall back to today if the source project
  // somehow lacks a startDate (shouldn't happen, but defensive).
  const projectStart = project.startDate || new Date().toISOString().slice(0, 10);

  // 2. Clone milestones (no graph relationships between milestones, so single pass).
  const projectMilestones = await db
    .select()
    .from(milestonesTable)
    .where(eq(milestonesTable.projectId, projectId))
    .orderBy(asc(milestonesTable.order));
  for (const m of projectMilestones) {
    await db.insert(templateMilestonesTable).values({
      templateId: tpl.id,
      name: m.name,
      description: m.description ?? "",
      defaultDayOffset: dayOffsetBetween(projectStart, m.dueDate),
      gateDecision: m.gateDecision,
      readinessChecklist: (m.readinessChecklist as unknown[]) ?? [],
      sortOrder: m.order,
    } as never);
  }

  // 3. Clone tasks — two passes so the parent-task and predecessor IDs get
  //    remapped from old project task IDs to new template task IDs. Without
  //    the second pass the dependency graph would point at stale rows.
  const projectTasks = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.projectId, projectId))
    .orderBy(asc(tasksTable.order));
  const idMap = new Map<number, number>();

  for (const t of projectTasks) {
    const duration = t.startDate && t.endDate ? dayOffsetBetween(t.startDate, t.endDate) || 1 : 1;
    const [row] = await db
      .insert(templateTasksTable)
      .values({
        templateId: tpl.id,
        parentTaskId: null, // rewritten in second pass
        name: t.name,
        description: t.description ?? "",
        defaultDurationDays: duration,
        defaultDayOffset: dayOffsetBetween(projectStart, t.startDate),
        defaultPriority: t.priority,
        defaultEffortHours: t.plannedEffortHours ?? undefined,
        predecessorOffsets: [], // rewritten in second pass
        sortOrder: t.order,
      } as never)
      .returning();
    idMap.set(t.id, row.id);
  }

  for (const t of projectTasks) {
    const newId = idMap.get(t.id);
    if (!newId) continue;
    const updates: Record<string, unknown> = {};
    if (t.parentTaskId && idMap.has(t.parentTaskId)) {
      updates.parentTaskId = idMap.get(t.parentTaskId);
    }
    let predecessorIds: number[] = [];
    try {
      predecessorIds = JSON.parse(t.predecessorIds || "[]");
    } catch {
      /* malformed JSON → treat as no predecessors */
    }
    const remapped = predecessorIds
      .map((pid) => idMap.get(pid))
      .filter((x): x is number => x != null)
      .map((templateTaskId) => ({ templateTaskId, lagDays: 0 }));
    if (remapped.length) updates.predecessorOffsets = remapped;
    if (Object.keys(updates).length) {
      await db.update(templateTasksTable).set(updates).where(eq(templateTasksTable.id, newId));
    }
  }

  await logActivity(
    "template_from_project",
    `Template "${tpl.name}" cloned from project ${projectId}`,
    tpl.id,
    "template",
  );
  res.status(201).json(tpl);
});

// ═══════════════════════════════════════════════════════════════════════════
// IMPORT (UPLOAD) A POPULATED TEMPLATE FROM JSON
//
// Creates the template shell + its milestones + tasks in one call. Tasks
// reference parent/predecessors by NAME; resolved in a second pass (same
// shape the /from-project clone produces, so export→edit→import round-trips).
router.post("/templates/import", requireRole("pmo"), async (req, res): Promise<void> => {
  const parsed = ImportTemplateBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { name, description, category, createdById, milestones = [], tasks = [] } = parsed.data;

  // 1. Template shell.
  const [tpl] = await db
    .insert(projectTemplatesTable)
    .values({
      name,
      description: description ?? "",
      category: category ?? "general",
      createdById,
    } as never)
    .returning();

  // 2. Milestones (no inter-milestone graph → single pass).
  for (let i = 0; i < milestones.length; i++) {
    const m = milestones[i]!;
    await db.insert(templateMilestonesTable).values({
      templateId: tpl.id,
      name: m.name,
      description: m.description ?? "",
      defaultDayOffset: m.defaultDayOffset ?? 0,
      gateDecision: m.gateDecision,
      readinessChecklist: m.readinessChecklist ?? [],
      sortOrder: i,
    } as never);
  }

  // 3. Tasks — pass 1 inserts every task and records name→id; pass 2 resolves
  //    parent + predecessor names into ids. Duplicate names: last write wins.
  const byName = new Map<string, number>();
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i]!;
    const [row] = await db
      .insert(templateTasksTable)
      .values({
        templateId: tpl.id,
        parentTaskId: null,
        name: t.name,
        description: t.description ?? "",
        defaultDurationDays: t.defaultDurationDays ?? 1,
        defaultDayOffset: t.defaultDayOffset ?? 0,
        defaultPriority: t.defaultPriority ?? "P2",
        defaultOwnerRole: t.defaultOwnerRole ?? null,
        defaultEffortHours: t.defaultEffortHours ?? undefined,
        predecessorOffsets: [],
        sortOrder: i,
      } as never)
      .returning();
    byName.set(t.name, row.id);
  }
  for (const t of tasks) {
    const id = byName.get(t.name);
    if (!id) continue;
    const updates: Record<string, unknown> = {};
    if (t.parent && byName.has(t.parent) && byName.get(t.parent) !== id) {
      updates.parentTaskId = byName.get(t.parent);
    }
    if (t.predecessors?.length) {
      const offs = t.predecessors
        .map((n) => byName.get(n))
        .filter((x): x is number => x != null && x !== id)
        .map((templateTaskId) => ({ templateTaskId, lagDays: 0 }));
      if (offs.length) updates.predecessorOffsets = offs;
    }
    if (Object.keys(updates).length) {
      await db.update(templateTasksTable).set(updates).where(eq(templateTasksTable.id, id));
    }
  }

  await logActivity(
    "template_imported",
    `Template "${tpl.name}" imported (${milestones.length} milestone(s), ${tasks.length} task(s))`,
    tpl.id,
    "template",
  );
  res.status(201).json({ ...tpl, milestoneCount: milestones.length, taskCount: tasks.length });
});

// ═══════════════════════════════════════════════════════════════════════════
// CREATE PROJECT FROM TEMPLATE
//
// Spawns a real pmo_projects row + clones the template's tasks/milestones,
// resolving offsets against the supplied startDate. Same two-pass approach
// to remap parent + predecessor refs so the dependency graph survives.
// ═══════════════════════════════════════════════════════════════════════════

router.post("/projects/from-template", requireRole("pmo"), async (req, res): Promise<void> => {
  const parsed = FromTemplateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [tpl] = await db
    .select()
    .from(projectTemplatesTable)
    .where(eq(projectTemplatesTable.id, parsed.data.templateId));
  if (!tpl) {
    res.status(404).json({ error: "Template not found" });
    return;
  }

  const tasksRows = await db
    .select()
    .from(templateTasksTable)
    .where(eq(templateTasksTable.templateId, tpl.id))
    .orderBy(asc(templateTasksTable.sortOrder));
  const milestonesRows = await db
    .select()
    .from(templateMilestonesTable)
    .where(eq(templateMilestonesTable.templateId, tpl.id))
    .orderBy(asc(templateMilestonesTable.sortOrder));

  // 1. Create the project.
  const [project] = await db
    .insert(projectsTable)
    .values({
      charterId: parsed.data.charterId,
      portfolioId: parsed.data.portfolioId,
      programId: parsed.data.programId,
      name: parsed.data.projectName,
      description: tpl.description || "",
      projectManagerId: parsed.data.projectManagerId,
      startDate: parsed.data.startDate,
    } as never)
    .returning();

  // Attach the universal deliverable templates (idempotent, non-fatal).
  try { await seedProjectTemplateDocuments(project.id, null); } catch { /* non-fatal */ }

  // 2. Clone milestones.
  for (const m of milestonesRows) {
    await db.insert(milestonesTable).values({
      projectId: project.id,
      name: m.name,
      description: m.description ?? "",
      dueDate: addDays(parsed.data.startDate, m.defaultDayOffset),
      gateDecision: m.gateDecision,
      readinessChecklist: (m.readinessChecklist as unknown[]) ?? [],
      order: m.sortOrder,
    } as never);
  }

  // 3. Clone tasks — two-pass remap for parent + predecessors.
  const idMap = new Map<number, number>();
  for (const t of tasksRows) {
    const start = addDays(parsed.data.startDate, t.defaultDayOffset);
    const end = addDays(start, t.defaultDurationDays);
    const [row] = await db
      .insert(tasksTable)
      .values({
        projectId: project.id,
        name: t.name,
        description: t.description ?? "",
        startDate: start,
        endDate: end,
        priority: t.defaultPriority,
        plannedEffortHours: t.defaultEffortHours ?? undefined,
        order: t.sortOrder,
      } as never)
      .returning();
    idMap.set(t.id, row.id);
  }
  for (const t of tasksRows) {
    const newId = idMap.get(t.id);
    if (!newId) continue;
    const updates: Record<string, unknown> = {};
    if (t.parentTaskId && idMap.has(t.parentTaskId)) {
      updates.parentTaskId = idMap.get(t.parentTaskId);
    }
    const preds = (t.predecessorOffsets as Array<{ templateTaskId: number; lagDays: number }>) || [];
    const newPreds = preds.map((p) => idMap.get(p.templateTaskId)).filter((x): x is number => x != null);
    if (newPreds.length) updates.predecessorIds = JSON.stringify(newPreds);
    if (Object.keys(updates).length) {
      await db.update(tasksTable).set(updates).where(eq(tasksTable.id, newId));
    }
  }

  await logActivity(
    "project_from_template",
    `Project "${project.name}" created from template ${tpl.id}`,
    project.id,
    "project",
  );
  res.status(201).json(project);
});

export default router;
