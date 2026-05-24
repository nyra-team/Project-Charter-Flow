import { Router, type IRouter } from "express";
import { db, projectsTable, milestonesTable, tasksTable, usersTable, chartersTable, approvalsTable, timelogsTable, scoringCriteriaTable, projectScoresTable, notificationsTable, activityTable } from "@workspace/db";
import { eq, desc, inArray, and, sql } from "drizzle-orm";
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
router.get("/projects", async (req, res): Promise<void> => {
  const programId = req.query.programId ? parseInt(req.query.programId as string) : undefined;
  const portfolioId = req.query.portfolioId ? parseInt(req.query.portfolioId as string) : undefined;
  const conditions = [];
  if (programId != null && !isNaN(programId)) conditions.push(eq(projectsTable.programId, programId));
  if (portfolioId != null && !isNaN(portfolioId)) conditions.push(eq(projectsTable.portfolioId, portfolioId));
  const projects = conditions.length
    ? await db.select().from(projectsTable).where(and(...conditions)).orderBy(desc(projectsTable.createdAt))
    : await db.select().from(projectsTable).orderBy(desc(projectsTable.createdAt));
  res.json(projects.map(p => formatProject(p as unknown as Record<string, unknown>)));
});

router.post("/projects", async (req, res): Promise<void> => {
  const parsed = CreateProjectBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const d = parsed.data as Record<string, unknown>;
  const [project] = await db.insert(projectsTable).values({
    charterId: parsed.data.charterId,
    name: parsed.data.name,
    description: parsed.data.description,
    projectManagerId: parsed.data.projectManagerId,
    startDate: parsed.data.startDate,
    endDate: parsed.data.endDate,
    portfolioId: d.portfolioId as number | undefined,
    programId: d.programId as number | undefined,
    priority: d.priority as string | undefined,
    stage: d.stage as string | undefined,
    strategicTheme: d.strategicTheme as string | undefined,
    ragStatus: d.ragStatus as string | undefined,
    capexBudget: parsed.data.capexBudget != null ? String(parsed.data.capexBudget) : undefined,
    opexBudget: parsed.data.opexBudget != null ? String(parsed.data.opexBudget) : undefined,
    siteRegion: d.siteRegion as string | undefined,
    function: d.function as string | undefined,
  }).returning();
  if (parsed.data.charterId) {
    await db.update(chartersTable).set({ projectId: project.id, status: "active" }).where(eq(chartersTable.id, parsed.data.charterId));
  }
  await logActivity("project_created", `Project "${project.name}" created`, project.id, "project");
  res.status(201).json(formatProject(project as unknown as Record<string, unknown>));
});

// IMPORTANT: This route must appear before /projects/:id to avoid being shadowed by the wildcard
router.get("/projects/scoring-rank", async (_req, res): Promise<void> => {
  const projects = await db.select().from(projectsTable);
  const allScores = await db.select().from(projectScoresTable);
  const criteria = await db.select().from(scoringCriteriaTable);

  const criterionScoresByProject: Record<number, Array<{ criterionId: number; rawScore: number }>> = {};
  const weightedTotalByProject: Record<number, number> = {};
  for (const s of allScores) {
    if (!criterionScoresByProject[s.projectId]) criterionScoresByProject[s.projectId] = [];
    criterionScoresByProject[s.projectId].push({ criterionId: s.criterionId, rawScore: Number(s.score) });
    weightedTotalByProject[s.projectId] = (weightedTotalByProject[s.projectId] ?? 0) + Number(s.weightedScore ?? 0);
  }

  const ranked = projects
    .map(p => ({
      id: p.id,
      name: p.name,
      scoringTotal: weightedTotalByProject[p.id] != null ? weightedTotalByProject[p.id] : (p.scoringTotal != null ? Number(p.scoringTotal) : null),
      criterionScores: criterionScoresByProject[p.id] ?? [],
      ragStatus: p.ragStatus,
      strategicTheme: p.strategicTheme,
      priority: p.priority,
      status: p.status,
      function: p.function,
      projectManagerId: p.projectManagerId ?? null,
    }))
    .filter(p => p.scoringTotal != null)
    .sort((a, b) => (b.scoringTotal ?? 0) - (a.scoringTotal ?? 0))
    .map((p, idx) => ({ ...p, rank: idx + 1 }));

  res.json({ ranked, criteriaCount: criteria.length });
});

router.get("/projects/:id", async (req, res): Promise<void> => {
  const params = GetProjectParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, params.data.id));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }
  res.json(formatProject(project as unknown as Record<string, unknown>));
});

router.patch("/projects/:id", async (req, res): Promise<void> => {
  const params = UpdateProjectParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  // Closed projects are archived and read-only (allow only explicit status re-opens if needed)
  const [current] = await db.select({ status: projectsTable.status }).from(projectsTable).where(eq(projectsTable.id, params.data.id));
  if (current?.status === "closed") {
    res.status(409).json({ error: "Project is closed and archived. Metadata updates are not permitted." });
    return;
  }
  const parsed = UpdateProjectBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const updateData: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.capexBudget !== undefined) updateData.capexBudget = String(parsed.data.capexBudget);
  if (parsed.data.opexBudget !== undefined) updateData.opexBudget = String(parsed.data.opexBudget);
  if (parsed.data.budgetThresholdPct !== undefined) updateData.budgetThresholdPct = String(parsed.data.budgetThresholdPct);
  if (parsed.data.scoringTotal !== undefined) updateData.scoringTotal = String(parsed.data.scoringTotal);
  const [project] = await db.update(projectsTable).set(updateData).where(eq(projectsTable.id, params.data.id)).returning();
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }
  res.json(formatProject(project as unknown as Record<string, unknown>));
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
  const [proj] = await db.select({ status: projectsTable.status }).from(projectsTable).where(eq(projectsTable.id, params.data.id));
  if (proj?.status === "closed") { res.status(409).json({ error: "Project is closed. Milestones cannot be added." }); return; }
  const parsed = CreateMilestoneBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const md = parsed.data as Record<string, unknown>;
  const [milestone] = await db.insert(milestonesTable).values({
    projectId: params.data.id,
    ...parsed.data,
    order: parsed.data.order ?? 0,
    scheduleVarianceDays: computeScheduleVarianceDays(parsed.data.dueDate, md.actualEnd as string | undefined),
  }).returning();
  res.status(201).json(milestone);
});

router.patch("/milestones/:id", async (req, res): Promise<void> => {
  const params = UpdateMilestoneParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateMilestoneBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const updateData = { ...parsed.data } as Record<string, unknown>;
  const [existingM] = await db.select().from(milestonesTable).where(eq(milestonesTable.id, params.data.id));
  if (existingM) {
    const [proj] = await db.select({ status: projectsTable.status }).from(projectsTable).where(eq(projectsTable.id, existingM.projectId));
    if (proj?.status === "closed") { res.status(409).json({ error: "Project is closed. Milestones cannot be updated." }); return; }
  }
  if (!existingM) { res.status(404).json({ error: "Milestone not found" }); return; }
  const newDueDate = (updateData.dueDate as string | undefined) ?? existingM.dueDate;
  const newActualEndM = (updateData.actualEnd as string | undefined) ?? existingM.actualEnd;
  updateData.scheduleVarianceDays = computeScheduleVarianceDays(newDueDate, newActualEndM);
  const [milestone] = await db.update(milestonesTable).set(updateData).where(eq(milestonesTable.id, params.data.id)).returning();
  if (!milestone) { res.status(404).json({ error: "Milestone not found" }); return; }

  // Audit trail: log what changed
  const msChangedFields = Object.keys(parsed.data).filter(k => k !== "scheduleVarianceDays");
  if (msChangedFields.length > 0) {
    const fieldSummary = msChangedFields.map(k => {
      const newVal = (parsed.data as Record<string, unknown>)[k];
      return `${k}: ${newVal}`;
    }).join(", ");
    await logActivity(
      "milestone_updated",
      `Milestone "${existingM.name}" updated — ${fieldSummary}`,
      existingM.projectId,
      "milestone",
      existingM.id
    );
  }

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
  const [projT] = await db.select({ status: projectsTable.status }).from(projectsTable).where(eq(projectsTable.id, params.data.id));
  if (projT?.status === "closed") { res.status(409).json({ error: "Project is closed. Tasks cannot be added." }); return; }
  const parsed = CreateTaskBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const predecessorIds = parsed.data.predecessorIds ?? [];
  const crossProjectPreds = (parsed.data as Record<string, unknown>).crossProjectPredecessors ?? [];
  const pd = parsed.data as Record<string, unknown>;
  const [task] = await db.insert(tasksTable).values({
    projectId: params.data.id,
    milestoneId: parsed.data.milestoneId,
    workstreamId: pd.workstreamId as number | undefined,
    parentTaskId: pd.parentTaskId as number | undefined,
    managerId: pd.managerId as number | undefined,
    name: parsed.data.name,
    description: parsed.data.description,
    assigneeId: parsed.data.assigneeId,
    cftOwner: pd.cftOwner as number | undefined,
    cftDept: pd.cftDept as string | undefined,
    priority: parsed.data.priority,
    rag: pd.rag as string | undefined,
    startDate: parsed.data.startDate,
    endDate: parsed.data.endDate,
    predecessorIds: JSON.stringify(predecessorIds),
    crossProjectPredecessors: JSON.stringify(crossProjectPreds),
    estimatedHours: parsed.data.estimatedHours != null ? String(parsed.data.estimatedHours) : null,
    plannedEffortHours: pd.plannedEffortHours != null ? String(pd.plannedEffortHours) : null,
    scheduleVarianceDays: computeScheduleVarianceDays(parsed.data.endDate, pd.actualEnd as string | undefined),
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
  // Recompute scheduleVarianceDays whenever endDate or actualEnd changes
  const [existing] = await db.select().from(tasksTable).where(eq(tasksTable.id, params.data.id));
  if (!existing) { res.status(404).json({ error: "Task not found" }); return; }
  const [projTask] = await db.select({ status: projectsTable.status }).from(projectsTable).where(eq(projectsTable.id, existing.projectId));
  if (projTask?.status === "closed") { res.status(409).json({ error: "Project is closed. Tasks cannot be updated." }); return; }
  const newEndDate = (updateData.endDate as string | undefined) ?? existing.endDate;
  const newActualEnd = (updateData.actualEnd as string | undefined) ?? existing.actualEnd;
  updateData.scheduleVarianceDays = computeScheduleVarianceDays(newEndDate, newActualEnd);
  const [task] = await db.update(tasksTable).set(updateData).where(eq(tasksTable.id, params.data.id)).returning();
  if (!task) { res.status(404).json({ error: "Task not found" }); return; }
  const [enriched] = await enrichTasks([task as unknown as Record<string, unknown>]);

  // Audit trail: log what changed
  const changedFields = Object.keys(parsed.data).filter(k => k !== "scheduleVarianceDays");
  if (changedFields.length > 0) {
    const fieldSummary = changedFields.map(k => {
      const newVal = (parsed.data as Record<string, unknown>)[k];
      return `${k}: ${Array.isArray(newVal) ? JSON.stringify(newVal) : newVal}`;
    }).join(", ");
    await logActivity(
      "task_updated",
      `Task "${existing.name}" updated — ${fieldSummary}`,
      existing.projectId,
      "task",
      existing.id
    );
  }

  // Parent status auto-aggregation (worst-case among children).
  // Triggered when a child's status changes; deterministic precedence.
  if (parsed.data.status !== undefined && existing.parentTaskId != null) {
    // Precedence: higher number = worse (wins).
    const STATUS_RANK: Record<string, number> = {
      completed: 0,
      not_started: 1,
      on_hold: 2,
      in_progress: 3,
      at_risk: 4,
      delayed: 5,
    };
    const siblings = await db.select({ status: tasksTable.status })
      .from(tasksTable)
      .where(eq(tasksTable.parentTaskId, existing.parentTaskId));
    if (siblings.length > 0) {
      const allCompleted = siblings.every(s => s.status === "completed");
      let derived: string;
      if (allCompleted) {
        derived = "completed";
      } else {
        derived = siblings.reduce((worst, s) => {
          const r = STATUS_RANK[s.status as string] ?? 1;
          const wr = STATUS_RANK[worst] ?? 1;
          return r > wr ? (s.status as string) : worst;
        }, "not_started");
      }
      const [parentRow] = await db.select().from(tasksTable).where(eq(tasksTable.id, existing.parentTaskId));
      if (parentRow && parentRow.status !== derived) {
        await db.update(tasksTable).set({ status: derived as typeof parentRow.status })
          .where(eq(tasksTable.id, existing.parentTaskId));
        await logActivity(
          "task_updated",
          `Parent task "${parentRow.name}" auto-aggregated to ${derived} from subtasks`,
          parentRow.projectId,
          "task",
          parentRow.id,
        );
      }
    }
  }

  res.json(enriched);
});

router.delete("/tasks/:id", async (req, res): Promise<void> => {
  const params = DeleteTaskParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  await db.delete(tasksTable).where(eq(tasksTable.id, params.data.id));
  res.sendStatus(204);
});

// Timelogs
router.get("/tasks/:id/timelogs", async (req, res): Promise<void> => {
  const taskId = parseInt(req.params.id);
  if (isNaN(taskId)) { res.status(400).json({ error: "Invalid task id" }); return; }
  const rows = await db.select().from(timelogsTable).where(eq(timelogsTable.taskId, taskId)).orderBy(desc(timelogsTable.date));
  const userIds = [...new Set(rows.filter(r => r.userId).map(r => r.userId as number))];
  const users = userIds.length
    ? await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(inArray(usersTable.id, userIds))
    : [];
  const userMap = Object.fromEntries(users.map(u => [u.id, u.name]));
  res.json(rows.map(r => ({
    ...r,
    hours: Number(r.hours),
    userName: r.userId ? (userMap[r.userId] ?? null) : null,
  })));
});

router.post("/tasks/:id/timelogs", async (req, res): Promise<void> => {
  const taskId = parseInt(req.params.id);
  if (isNaN(taskId)) { res.status(400).json({ error: "Invalid task id" }); return; }
  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, taskId)).limit(1);
  if (!task) { res.status(404).json({ error: "Task not found" }); return; }
  const { date, hours, note, userId } = req.body as { date?: string; hours?: number; note?: string; userId?: number };
  if (!date || !hours || hours < 0.25) { res.status(400).json({ error: "date and hours (≥ 0.25) are required" }); return; }
  const [row] = await db.insert(timelogsTable).values({
    taskId,
    userId: userId ?? null,
    date,
    hours: String(hours),
    note: note ?? "",
  }).returning();

  const allLogs = await db.select({ hours: timelogsTable.hours }).from(timelogsTable).where(eq(timelogsTable.taskId, taskId));
  const totalHours = allLogs.reduce((s, l) => s + Number(l.hours), 0);
  await db.update(tasksTable).set({ actualHours: sql`${totalHours}` }).where(eq(tasksTable.id, taskId));

  // Over-log warning notification (Task #23)
  const planned = Number(task.plannedEffortHours ?? 0);
  if (planned > 0 && totalHours > planned) {
    const notifyUserIds = new Set<number>();
    if (task.assigneeId) notifyUserIds.add(task.assigneeId);
    const [proj] = await db.select({ pmId: projectsTable.projectManagerId }).from(projectsTable).where(eq(projectsTable.id, task.projectId)).limit(1);
    if (proj?.pmId) notifyUserIds.add(proj.pmId);
    for (const uid of notifyUserIds) {
      await db.insert(notificationsTable).values({
        userId: uid,
        type: "effort_overrun",
        title: `Task "${task.name}" exceeded planned effort`,
        body: `Logged ${totalHours.toFixed(1)}h / ${planned}h planned (${Math.round((totalHours / planned) * 100)}%)`,
        link: `/projects/${task.projectId}`,
        relatedEntityType: "task",
        relatedEntityId: task.id,
      });
    }
    await logActivity("task_overrun", `Task "${task.name}" over-logged: ${totalHours.toFixed(1)}h / ${planned}h`, task.id, "task", userId);
  }

  await logActivity("timelog_added", `Logged ${hours}h on "${task.name}"`, task.id, "task", userId);

  const userName = userId
    ? (await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId)).limit(1))[0]?.name ?? null
    : null;
  res.status(201).json({ ...row, hours: Number(row.hours), userName });
});

router.patch("/tasks/:taskId/timelogs/:id", async (req, res): Promise<void> => {
  const taskId = parseInt(req.params.taskId);
  const id = parseInt(req.params.id);
  if (isNaN(taskId) || isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { date, hours, note, userId } = req.body as { date?: string; hours?: number; note?: string; userId?: number | null };
  const update: Record<string, unknown> = {};
  if (date !== undefined) update.date = date;
  if (hours !== undefined) {
    if (hours < 0.25) { res.status(400).json({ error: "hours must be ≥ 0.25" }); return; }
    update.hours = String(hours);
  }
  if (note !== undefined) update.note = note;
  if (userId !== undefined) update.userId = userId;
  const [row] = await db.update(timelogsTable).set(update).where(eq(timelogsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Timelog not found" }); return; }
  const allLogs = await db.select({ hours: timelogsTable.hours }).from(timelogsTable).where(eq(timelogsTable.taskId, taskId));
  const totalHours = allLogs.reduce((s, l) => s + Number(l.hours), 0);
  await db.update(tasksTable).set({ actualHours: sql`${totalHours}` }).where(eq(tasksTable.id, taskId));
  res.json({ ...row, hours: Number(row.hours) });
});

router.delete("/tasks/:taskId/timelogs/:id", async (req, res): Promise<void> => {
  const taskId = parseInt(req.params.taskId);
  const id = parseInt(req.params.id);
  if (isNaN(taskId) || isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(timelogsTable).where(eq(timelogsTable.id, id));
  const allLogs = await db.select({ hours: timelogsTable.hours }).from(timelogsTable).where(eq(timelogsTable.taskId, taskId));
  const totalHours = allLogs.reduce((s, l) => s + Number(l.hours), 0);
  await db.update(tasksTable).set({ actualHours: sql`${totalHours}` }).where(eq(tasksTable.id, taskId));
  res.sendStatus(204);
});

// Project audit trail (uses activity table, scoped to project + its tasks + milestones)
router.get("/projects/:id/audit", async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const taskRows = await db.select({ id: tasksTable.id }).from(tasksTable).where(eq(tasksTable.projectId, projectId));
  const msRows = await db.select({ id: milestonesTable.id }).from(milestonesTable).where(eq(milestonesTable.projectId, projectId));
  const taskIds = taskRows.map(t => t.id);
  const msIds = msRows.map(m => m.id);
  const conditions = [and(eq(activityTable.entityType, "project"), eq(activityTable.entityId, projectId))!];
  if (taskIds.length) conditions.push(and(eq(activityTable.entityType, "task"), inArray(activityTable.entityId, taskIds))!);
  if (msIds.length) conditions.push(and(eq(activityTable.entityType, "milestone"), inArray(activityTable.entityId, msIds))!);
  const filtered = await db.select().from(activityTable)
    .where(sql.join(conditions.map(c => sql`(${c})`), sql` OR `))
    .orderBy(desc(activityTable.createdAt))
    .limit(500);
  const userIds = [...new Set(filtered.filter(a => a.userId).map(a => a.userId!))];
  const users = userIds.length
    ? await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(inArray(usersTable.id, userIds))
    : [];
  const userMap = Object.fromEntries(users.map(u => [u.id, u.name]));
  res.json(filtered.map(a => ({ ...a, userName: a.userId ? userMap[a.userId] ?? null : null })));
});

// Effort burn aggregate (Task #21): weekly cumulative planned vs actual across project tasks
router.get("/projects/:id/effort-burn", async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const tasks = await db.select().from(tasksTable).where(eq(tasksTable.projectId, projectId));
  const taskIds = tasks.map(t => t.id);
  if (!taskIds.length) { res.json({ weeks: [], totalPlanned: 0, totalActual: 0 }); return; }
  const logs = await db.select().from(timelogsTable).where(inArray(timelogsTable.taskId, taskIds));
  const totalPlanned = tasks.reduce((s, t) => s + Number(t.plannedEffortHours ?? 0), 0);

  // Bucket by ISO week (yyyy-Www)
  const weekOf = (d: string | Date) => {
    const date = new Date(d);
    const tmp = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = (tmp.getUTCDay() + 6) % 7;
    tmp.setUTCDate(tmp.getUTCDate() - dayNum + 3);
    const firstThursday = tmp.valueOf();
    tmp.setUTCMonth(0, 1);
    if (tmp.getUTCDay() !== 4) tmp.setUTCMonth(0, 1 + ((4 - tmp.getUTCDay()) + 7) % 7);
    const week = 1 + Math.ceil((firstThursday - tmp.valueOf()) / (7 * 86400000));
    return `${new Date(d).getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
  };
  const buckets: Record<string, number> = {};
  for (const l of logs) {
    const k = weekOf(l.date as unknown as string);
    buckets[k] = (buckets[k] ?? 0) + Number(l.hours);
  }
  const sortedWeeks = Object.keys(buckets).sort();
  let cumActual = 0;
  const weeks = sortedWeeks.map(w => {
    cumActual += buckets[w];
    return { week: w, actual: buckets[w], cumulativeActual: cumActual, planned: totalPlanned };
  });
  const totalActual = logs.reduce((s, l) => s + Number(l.hours), 0);
  res.json({ weeks, totalPlanned, totalActual });
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

// NFA budget overrun status — READ-ONLY, no side effects
router.get("/projects/:id/nfa-status", async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  const { budgetLinesTable } = await import("@workspace/db");
  const lines = await db.select().from(budgetLinesTable).where(eq(budgetLinesTable.projectId, projectId));

  const totalBaseline = lines.reduce((sum, l) => sum + Number(l.baselineAmount ?? 0), 0);
  const totalActual = lines.reduce((sum, l) => sum + Number(l.actualAmount ?? 0), 0);
  const thresholdPct = Number(project.budgetThresholdPct ?? 10);

  let overrunPct = 0;
  if (totalBaseline > 0) {
    overrunPct = ((totalActual - totalBaseline) / totalBaseline) * 100;
  }

  const triggered = overrunPct > thresholdPct;

  // Check if an approval chain already exists for this overrun (read-only)
  let nfaChainExists = false;
  if (project.charterId) {
    const existing = await db.select()
      .from(approvalsTable)
      .where(and(
        eq(approvalsTable.charterId, project.charterId),
        eq(approvalsTable.stage, "nfa_overrun"),
      ));
    nfaChainExists = existing.length > 0;
  }

  res.json({
    projectId,
    triggered,
    overrunPct: Math.round(overrunPct * 100) / 100,
    threshold: thresholdPct,
    totalBaseline,
    totalActual,
    nfaChainExists,
    // Correct chain order: Functional Head → SCM Head → CFO → Management
    nfaChain: triggered ? ["hod", "scm", "cfo", "chairman"] : [],
  });
});

// NFA overrun approval chain creation — explicit POST action, idempotent
// Chain order: Functional Head (hod) → SCM Head (scm) → CFO (cfo) → Management (chairman)
router.post("/projects/:id/nfa-trigger", async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }
  if (!project.charterId) { res.status(422).json({ error: "Project has no associated charter; cannot create NFA chain." }); return; }

  // Verify overrun is actually triggered before creating chain
  const { budgetLinesTable } = await import("@workspace/db");
  const lines = await db.select().from(budgetLinesTable).where(eq(budgetLinesTable.projectId, projectId));
  const totalBaseline = lines.reduce((sum, l) => sum + Number(l.baselineAmount ?? 0), 0);
  const totalActual = lines.reduce((sum, l) => sum + Number(l.actualAmount ?? 0), 0);
  const thresholdPct = Number(project.budgetThresholdPct ?? 10);
  const overrunPct = totalBaseline > 0 ? ((totalActual - totalBaseline) / totalBaseline) * 100 : 0;

  if (overrunPct <= thresholdPct) {
    res.status(422).json({ error: `No budget overrun detected (${overrunPct.toFixed(1)}% ≤ threshold ${thresholdPct}%).` });
    return;
  }

  // Idempotency: do not create duplicate chain
  const existing = await db.select()
    .from(approvalsTable)
    .where(and(
      eq(approvalsTable.charterId, project.charterId),
      eq(approvalsTable.stage, "nfa_overrun"),
    ));

  if (existing.length > 0) {
    res.json({ projectId, created: false, message: "NFA approval chain already exists.", chainLength: existing.length });
    return;
  }

  // Create chain in the correct order: Functional Head → SCM Head → CFO → Management
  const nfaRoles = ["hod", "scm", "cfo", "chairman"] as const;
  let created = 0;
  for (const roleKey of nfaRoles) {
    const [approver] = await db.select().from(usersTable)
      .where(eq(usersTable.role, roleKey))
      .limit(1);
    if (approver) {
      await db.insert(approvalsTable).values({
        charterId: project.charterId,
        approverId: approver.id,
        approverRole: roleKey,
        stage: "nfa_overrun",
        status: "pending",
        comments: `NFA budget overrun triggered: actual exceeds baseline by ${overrunPct.toFixed(1)}% (threshold ${thresholdPct}%). Approval required from ${roleKey}.`,
      });
      created++;
    }
  }

  await logActivity(
    "nfa_overrun_triggered",
    `NFA budget overrun triggered for project ${projectId}: ${overrunPct.toFixed(1)}% over baseline. Approval chain (${nfaRoles.join(" → ")}) created.`,
    projectId,
    "project",
  );

  res.status(201).json({ projectId, created: true, chainLength: created, overrunPct: Math.round(overrunPct * 100) / 100 });
});

function formatProject(p: Record<string, unknown>) {
  return {
    ...p,
    capexBudget: p.capexBudget != null ? Number(p.capexBudget) : 0,
    opexBudget: p.opexBudget != null ? Number(p.opexBudget) : 0,
    budgetThresholdPct: p.budgetThresholdPct != null ? Number(p.budgetThresholdPct) : 10,
    scoringTotal: p.scoringTotal != null ? Number(p.scoringTotal) : null,
  };
}

function computeScheduleVarianceDays(plannedEnd: string | null | undefined, actualEnd: string | null | undefined): number {
  if (!plannedEnd) return 0;
  const planned = new Date(plannedEnd).getTime();
  const actual = actualEnd ? new Date(actualEnd).getTime() : Date.now();
  // Only compute if actually ended or overdue
  if (!actualEnd && actual < planned) return 0;
  return Math.round((actual - planned) / (1000 * 60 * 60 * 24));
}

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
