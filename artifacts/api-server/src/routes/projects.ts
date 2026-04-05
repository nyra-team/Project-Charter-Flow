import { Router, type IRouter } from "express";
import { db, projectsTable, milestonesTable, tasksTable, usersTable, chartersTable } from "@workspace/db";
import { eq, desc, inArray } from "drizzle-orm";
import {
  CreateProjectBody,
  GetProjectParams,
  UpdateProjectParams,
  UpdateProjectBody,
  ListMilestonesParams,
  CreateMilestoneParams,
  CreateMilestoneBody,
  UpdateMilestoneParams,
  UpdateMilestoneBody,
  DeleteMilestoneParams,
  ListTasksParams,
  CreateTaskParams,
  CreateTaskBody,
  GetTaskParams,
  UpdateTaskParams,
  UpdateTaskBody,
  DeleteTaskParams,
  GetCriticalPathParams,
  GetBurndownParams,
} from "@workspace/api-zod";
import { logActivity } from "./activity";

const router: IRouter = Router();

// Projects
router.get("/projects", async (_req, res): Promise<void> => {
  const projects = await db.select().from(projectsTable).orderBy(desc(projectsTable.createdAt));
  res.json(projects);
});

router.post("/projects", async (req, res): Promise<void> => {
  const parsed = CreateProjectBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [project] = await db.insert(projectsTable).values(parsed.data).returning();
  await db.update(chartersTable).set({ projectId: project.id, status: "active" }).where(eq(chartersTable.id, parsed.data.charterId));
  await logActivity("project_created", `Project "${project.name}" created`, project.id, "project");
  res.status(201).json(project);
});

router.get("/projects/:id", async (req, res): Promise<void> => {
  const params = GetProjectParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, params.data.id));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }
  res.json(project);
});

router.patch("/projects/:id", async (req, res): Promise<void> => {
  const params = UpdateProjectParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateProjectBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [project] = await db.update(projectsTable).set(parsed.data).where(eq(projectsTable.id, params.data.id)).returning();
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }
  res.json(project);
});

// Milestones
router.get("/projects/:id/milestones", async (req, res): Promise<void> => {
  const params = ListMilestonesParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const milestones = await db.select().from(milestonesTable).where(eq(milestonesTable.projectId, params.data.id)).orderBy(milestonesTable.order);
  res.json(milestones);
});

router.post("/projects/:id/milestones", async (req, res): Promise<void> => {
  const params = CreateMilestoneParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = CreateMilestoneBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [milestone] = await db.insert(milestonesTable).values({ projectId: params.data.id, ...parsed.data, order: parsed.data.order ?? 0 }).returning();
  res.status(201).json(milestone);
});

router.patch("/milestones/:id", async (req, res): Promise<void> => {
  const params = UpdateMilestoneParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateMilestoneBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [milestone] = await db.update(milestonesTable).set(parsed.data).where(eq(milestonesTable.id, params.data.id)).returning();
  if (!milestone) { res.status(404).json({ error: "Milestone not found" }); return; }
  res.json(milestone);
});

router.delete("/milestones/:id", async (req, res): Promise<void> => {
  const params = DeleteMilestoneParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  await db.delete(milestonesTable).where(eq(milestonesTable.id, params.data.id));
  res.sendStatus(204);
});

// Tasks
router.get("/projects/:id/tasks", async (req, res): Promise<void> => {
  const params = ListTasksParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const tasks = await db.select().from(tasksTable).where(eq(tasksTable.projectId, params.data.id)).orderBy(tasksTable.order);
  const enriched = await enrichTasks(tasks as unknown as Array<Record<string, unknown>>);
  res.json(enriched);
});

router.post("/projects/:id/tasks", async (req, res): Promise<void> => {
  const params = CreateTaskParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = CreateTaskBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const predecessorIds = parsed.data.predecessorIds ?? [];
  const crossProjectPreds = (parsed.data as Record<string, unknown>).crossProjectPredecessors ?? [];
  const [task] = await db.insert(tasksTable).values({
    projectId: params.data.id,
    ...parsed.data,
    predecessorIds: JSON.stringify(predecessorIds),
    crossProjectPredecessors: JSON.stringify(crossProjectPreds),
    estimatedHours: parsed.data.estimatedHours != null ? String(parsed.data.estimatedHours) : null,
    order: parsed.data.order ?? 0,
  }).returning();
  const [enriched] = await enrichTasks([task as unknown as Record<string, unknown>]);
  res.status(201).json(enriched);
});

router.get("/tasks/:id", async (req, res): Promise<void> => {
  const params = GetTaskParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, params.data.id));
  if (!task) { res.status(404).json({ error: "Task not found" }); return; }
  const [enriched] = await enrichTasks([task as unknown as Record<string, unknown>]);
  res.json(enriched);
});

router.patch("/tasks/:id", async (req, res): Promise<void> => {
  const params = UpdateTaskParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateTaskBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const updateData: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.predecessorIds !== undefined) {
    updateData.predecessorIds = JSON.stringify(parsed.data.predecessorIds);
  }
  if ((parsed.data as Record<string, unknown>).crossProjectPredecessors !== undefined) {
    updateData.crossProjectPredecessors = JSON.stringify((parsed.data as Record<string, unknown>).crossProjectPredecessors);
  }
  if (parsed.data.estimatedHours !== undefined) {
    updateData.estimatedHours = parsed.data.estimatedHours != null ? String(parsed.data.estimatedHours) : null;
  }
  if (parsed.data.actualHours !== undefined) {
    updateData.actualHours = parsed.data.actualHours != null ? String(parsed.data.actualHours) : null;
  }
  const [task] = await db.update(tasksTable).set(updateData).where(eq(tasksTable.id, params.data.id)).returning();
  if (!task) { res.status(404).json({ error: "Task not found" }); return; }
  const [enriched] = await enrichTasks([task as unknown as Record<string, unknown>]);
  res.json(enriched);
});

router.delete("/tasks/:id", async (req, res): Promise<void> => {
  const params = DeleteTaskParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  await db.delete(tasksTable).where(eq(tasksTable.id, params.data.id));
  res.sendStatus(204);
});

// Critical path
router.get("/projects/:id/critical-path", async (req, res): Promise<void> => {
  const params = GetCriticalPathParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const tasks = await db.select().from(tasksTable).where(eq(tasksTable.projectId, params.data.id)).orderBy(tasksTable.order);

  const taskMap = new Map(tasks.map(t => [t.id, t]));
  const predecessorMap = new Map<number, number[]>();
  for (const t of tasks) {
    let preds: number[] = [];
    try { preds = JSON.parse(t.predecessorIds || "[]"); } catch {}
    predecessorMap.set(t.id, preds);
  }

  const earliestFinish = new Map<number, number>();
  function getEarliestFinish(taskId: number): number {
    if (earliestFinish.has(taskId)) return earliestFinish.get(taskId)!;
    const task = taskMap.get(taskId);
    if (!task) return 0;
    const duration = task.estimatedHours ? Number(task.estimatedHours) / 8 : 1;
    const preds = predecessorMap.get(taskId) ?? [];
    const maxPredFinish = preds.length ? Math.max(...preds.map(p => getEarliestFinish(p))) : 0;
    const ef = maxPredFinish + duration;
    earliestFinish.set(taskId, ef);
    return ef;
  }

  tasks.forEach(t => getEarliestFinish(t.id));
  const maxFinish = Math.max(...[...earliestFinish.values()], 0);

  const criticalTasks = tasks.filter(t => {
    const ef = earliestFinish.get(t.id) ?? 0;
    return Math.abs(ef - maxFinish) < 0.001;
  });

  for (const ct of criticalTasks) {
    await db.update(tasksTable).set({ isCritical: true }).where(eq(tasksTable.id, ct.id));
  }

  const enriched = await enrichTasks(criticalTasks as unknown as Array<Record<string, unknown>>);
  res.json({
    projectId: params.data.id,
    criticalTasks: enriched,
    totalDurationDays: maxFinish,
    criticalPathLength: criticalTasks.length,
  });
});

// Burndown
router.get("/projects/:id/burndown", async (req, res): Promise<void> => {
  const params = GetBurndownParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, params.data.id));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  const tasks = await db.select().from(tasksTable).where(eq(tasksTable.projectId, params.data.id));
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter(t => t.status === "completed").length;

  const startDate = project.startDate ? new Date(project.startDate) : new Date(project.createdAt);
  const endDate = project.endDate ? new Date(project.endDate) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const totalDays = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));

  const dataPoints = [];
  for (let d = 0; d <= Math.min(totalDays, 30); d++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + d);
    const dayRatio = d / totalDays;
    const ideal = Math.round(totalTasks * (1 - dayRatio));
    const isPast = date <= new Date();
    const daysPassed = Math.max(1, Math.ceil((new Date().getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
    const completed = isPast ? Math.min(completedTasks, Math.round(completedTasks * (d / daysPassed))) : 0;
    dataPoints.push({
      date: date.toISOString().split("T")[0],
      remaining: Math.max(0, totalTasks - (isPast ? completed : 0)),
      ideal,
      completed: isPast ? completed : 0,
    });
  }

  res.json({ projectId: params.data.id, totalTasks, completedTasks, dataPoints });
});

async function enrichTasks(tasks: Array<Record<string, unknown>>) {
  if (!tasks.length) return [];
  const assigneeIds = [...new Set(tasks.filter(t => t.assigneeId).map(t => t.assigneeId as number))];
  const users = assigneeIds.length
    ? await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable)
        .where(inArray(usersTable.id, assigneeIds))
    : [];
  const userMap = Object.fromEntries(users.map(u => [u.id, u.name]));

  // Gather cross-project predecessor task info
  const allProjects = await db.select({ id: projectsTable.id, name: projectsTable.name }).from(projectsTable);
  const projectNameMap = Object.fromEntries(allProjects.map(p => [p.id, p.name]));

  return tasks.map(t => {
    let predecessorIds: number[] = [];
    let successorIds: number[] = [];
    let crossProjectPredecessors: Array<{projectId: number; taskId: number; projectName?: string; taskName?: string}> = [];

    try { predecessorIds = JSON.parse(t.predecessorIds as string || "[]"); } catch {}
    try { crossProjectPredecessors = JSON.parse(t.crossProjectPredecessors as string || "[]"); } catch {}

    successorIds = tasks
      .filter(other => {
        try { return (JSON.parse(other.predecessorIds as string || "[]") as number[]).includes(t.id as number); } catch { return false; }
      })
      .map(other => other.id as number);

    const enrichedCrossProjectPreds = crossProjectPredecessors.map(cpp => ({
      ...cpp,
      projectName: projectNameMap[cpp.projectId] ?? `Project ${cpp.projectId}`,
    }));

    return {
      ...t,
      predecessorIds,
      successorIds,
      crossProjectPredecessors: enrichedCrossProjectPreds,
      assigneeName: t.assigneeId ? userMap[t.assigneeId as number] ?? null : null,
      estimatedHours: t.estimatedHours != null ? Number(t.estimatedHours) : null,
      actualHours: t.actualHours != null ? Number(t.actualHours) : null,
    };
  });
}

export default router;
