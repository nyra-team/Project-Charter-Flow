import { Router, type IRouter } from "express";
import { db, projectsTable, milestonesTable, tasksTable, usersTable, chartersTable, approvalsTable } from "@workspace/db";
import { eq, desc, inArray, and } from "drizzle-orm";
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
  await db.update(chartersTable).set({ projectId: project.id, status: "active" }).where(eq(chartersTable.id, parsed.data.charterId));
  await logActivity("project_created", `Project "${project.name}" created`, project.id, "project");
  res.status(201).json(formatProject(project as unknown as Record<string, unknown>));
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
