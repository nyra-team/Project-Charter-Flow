import { Router, type IRouter } from "express";
import { db, projectsTable, milestonesTable, tasksTable, usersTable, chartersTable, squadMembersTable, budgetLinesTable, approvalsTable, timelogsTable, scoringCriteriaTable, projectScoresTable, notificationsTable, activityTable } from "@workspace/db";
import { eq, desc, inArray, and, or, sql } from "drizzle-orm";
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
import { computeStageCriticalPath } from "../lib/critical-path";
import { computeTaskCpm, wouldCreateDependencyCycle } from "../lib/critical-path-cpm";
import { runCriticalPathAction } from "../lib/critical-path-actions";
import { generateGateMilestones, ensureUnscheduledMilestone } from "../lib/gate-milestones";
import { seedProjectTemplateDocuments } from "../lib/templateDocuments";
import { recomputeRollups } from "../lib/rollup";
import { mergeTaskWorkbook } from "../lib/import-tasks";
import { requireRole } from "../lib/guard";
import { notify } from "../lib/notify";
import { resolveRole, type Recipient } from "../lib/role-resolver";
import type { EmailBanner } from "../lib/mailer";

// Fan a task-level event out to in-app bell + email + the project's Teams
// channel. Recipients = assignee (when given) + the project manager
// (role-resolved with charter fallback). Detached: called AFTER res.json so a
// slow SMTP send can never block the API response; failures are logged only.
function notifyTaskEventDetached(o: {
  projectId: number;
  assigneeId?: number | null;
  type: string;
  title: string;
  body: string;
  relatedEntityId: number;
  banner?: EmailBanner;
}): void {
  void (async () => {
    const recipients: Recipient[] = [];
    if (o.assigneeId) {
      const [u] = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
        .from(usersTable).where(eq(usersTable.id, o.assigneeId));
      if (u) recipients.push({ userId: u.id, name: u.name, email: u.email ?? null });
    }
    recipients.push(...(await resolveRole("pm", o.projectId)));
    await notify({
      projectId: o.projectId,
      type: o.type,
      title: o.title,
      body: o.body,
      relatedEntityType: "task",
      relatedEntityId: o.relatedEntityId,
      recipients,
      email: { banner: o.banner },
    });
  })().catch((err) => console.warn(`[notify] ${o.type} failed:`, String(err)));
}

// Recompute the project's progress rollup (subtask -> task -> milestone ->
// project) after a work-item mutation. Best-effort: a rollup failure must never
// fail the user's write, which has already committed by the time we get here.
async function rollup(projectId: number): Promise<void> {
  try {
    await recomputeRollups(projectId);
  } catch (err) {
    console.error(`[rollup] recompute failed for project ${projectId}:`, err);
  }
}

// Fetch + enrich a single task (same shape as the enrichTasks list items).
// Used by the dependency add/remove endpoints to return the updated task.
async function enrichOne(taskId: number) {
  const [row] = await db.select().from(tasksTable).where(eq(tasksTable.id, taskId));
  if (!row) return null;
  const [enriched] = await enrichTasks([row as unknown as Record<string, unknown>]);
  return enriched;
}

const router: IRouter = Router();

const WRITE_ROLES = ["pm", "pmo", "hod", "initiator"];

// Projects
router.get("/projects", async (req, res): Promise<void> => {
  const programId = req.query.programId ? parseInt(req.query.programId as string) : undefined;
  const portfolioId = req.query.portfolioId ? parseInt(req.query.portfolioId as string) : undefined;
  const conditions = [];
  if (programId != null && !isNaN(programId)) conditions.push(eq(projectsTable.programId, programId));
  if (portfolioId != null && !isNaN(portfolioId)) conditions.push(eq(projectsTable.portfolioId, portfolioId));

  // Row-level visibility (server-enforced). Chairman / Executive Director /
  // Transformation team / platform admin (req.user.seeAllProjects, resolved in
  // requireAuth from the master employee DB) see EVERY project. Everyone else
  // is scoped to projects they own: they are the PM, or the charter
  // owner/sponsor/manager, or a squad member.
  if (req.user && !req.user.seeAllProjects) {
    const [me] = await db.select({ id: usersTable.id }).from(usersTable)
      .where(eq(usersTable.email, req.user.email.toLowerCase()));
    if (!me) { res.json([]); return; } // no local user row yet ⇒ owns nothing

    const ledCharters = await db.select({ id: chartersTable.id }).from(chartersTable)
      .where(or(
        eq(chartersTable.projectOwnerId, me.id),
        eq(chartersTable.projectSponsorId, me.id),
        eq(chartersTable.projectManagerId, me.id),
      ));
    const squadCharters = await db.select({ charterId: squadMembersTable.charterId }).from(squadMembersTable)
      .where(eq(squadMembersTable.userId, me.id));
    const charterIds = [...new Set(
      [...ledCharters.map((c) => c.id), ...squadCharters.map((s) => s.charterId)]
        .filter((x): x is number => x != null),
    )];

    const mine = [eq(projectsTable.projectManagerId, me.id)];
    if (charterIds.length) mine.push(inArray(projectsTable.charterId, charterIds));
    conditions.push(or(...mine)!);
  }

  const projects = conditions.length
    ? await db.select().from(projectsTable).where(and(...conditions)).orderBy(desc(projectsTable.createdAt))
    : await db.select().from(projectsTable).orderBy(desc(projectsTable.createdAt));

  // Enrich with per-project variance aggregates (additive fields):
  //  - scheduleVarianceDays: avg of the project's milestones' schedule_variance_days
  //    (negative = behind, positive = ahead — mirrors milestone semantics)
  //  - budgetVarianceAmount / Pct: from budget_lines (actual − baseline)
  const ids = projects.map((p) => p.id);
  const sched = new Map<number, { sum: number; n: number }>();
  const budg = new Map<number, { baseline: number; actual: number }>();
  if (ids.length) {
    const ms = await db.select({ projectId: milestonesTable.projectId, v: milestonesTable.scheduleVarianceDays })
      .from(milestonesTable).where(inArray(milestonesTable.projectId, ids));
    for (const m of ms) {
      if (m.projectId == null) continue;
      const e = sched.get(m.projectId) ?? { sum: 0, n: 0 };
      e.sum += m.v ?? 0; e.n += 1; sched.set(m.projectId, e);
    }
    const bl = await db.select({ projectId: budgetLinesTable.projectId, baseline: budgetLinesTable.baselineAmount, actual: budgetLinesTable.actualAmount })
      .from(budgetLinesTable).where(inArray(budgetLinesTable.projectId, ids));
    for (const b of bl) {
      if (b.projectId == null) continue;
      const e = budg.get(b.projectId) ?? { baseline: 0, actual: 0 };
      e.baseline += Number(b.baseline ?? 0); e.actual += Number(b.actual ?? 0); budg.set(b.projectId, e);
    }
  }

  res.json(projects.map((p) => {
    const s = sched.get(p.id);
    const b = budg.get(p.id);
    return {
      ...formatProject(p as unknown as Record<string, unknown>),
      scheduleVarianceDays: s && s.n ? Math.round(s.sum / s.n) : null,
      budgetVarianceAmount: b ? b.actual - b.baseline : null,
      budgetVariancePct: b && b.baseline > 0 ? Math.round(((b.actual - b.baseline) / b.baseline) * 1000) / 10 : null,
    };
  }));
});

router.post("/projects", requireRole(...WRITE_ROLES), async (req, res): Promise<void> => {
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
  // Seed the standard gate milestones (BC Approved, URS Approved, …) for new
  // projects so the lifecycle gates exist as milestones from day one.
  try { await generateGateMilestones(project.id); } catch { /* non-fatal */ }
  // Attach the universal deliverable templates so business users edit-in-place
  // instead of hunting for them. Idempotent + non-fatal.
  try {
    const [me] = req.user
      ? await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, req.user.email.toLowerCase()))
      : [];
    await seedProjectTemplateDocuments(project.id, me?.id ?? null);
  } catch { /* non-fatal */ }
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

router.patch("/projects/:id", requireRole(...WRITE_ROLES), async (req, res): Promise<void> => {
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

router.post("/projects/:id/milestones", requireRole(...WRITE_ROLES), async (req, res): Promise<void> => {
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
  // New (empty) milestone changes the project's milestone denominator.
  await rollup(params.data.id);
  res.status(201).json(milestone);
});

router.patch("/milestones/:id", requireRole(...WRITE_ROLES), async (req, res): Promise<void> => {
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

router.delete("/milestones/:id", requireRole("pmo", "pm"), async (req, res): Promise<void> => {
  const params = DeleteMilestoneParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [doomed] = await db.select({ projectId: milestonesTable.projectId }).from(milestonesTable).where(eq(milestonesTable.id, params.data.id));
  await db.delete(milestonesTable).where(eq(milestonesTable.id, params.data.id));
  if (doomed) await rollup(doomed.projectId);
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

router.post("/projects/:id/tasks", requireRole(...WRITE_ROLES), async (req, res): Promise<void> => {
  const params = CreateTaskParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [projT] = await db.select({ status: projectsTable.status, name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, params.data.id));
  if (projT?.status === "closed") { res.status(409).json({ error: "Project is closed. Tasks cannot be added." }); return; }
  const parsed = CreateTaskBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const predecessorIds = parsed.data.predecessorIds ?? [];
  const crossProjectPreds = (parsed.data as Record<string, unknown>).crossProjectPredecessors ?? [];
  const pd = parsed.data as Record<string, unknown>;
  // Resolve milestone + stage, soft-enforcing "every task belongs to a milestone":
  //  - subtask (parentTaskId set) inherits its parent's milestone + stage
  //  - a task with an explicit milestone inherits that milestone's stage
  //  - a task with neither lands in the project's "Unscheduled" milestone
  let milestoneId = parsed.data.milestoneId ?? undefined;
  let stage = pd.stage as string | undefined;
  const parentTaskId = pd.parentTaskId as number | undefined;
  if (parentTaskId != null) {
    const [parent] = await db.select({ milestoneId: tasksTable.milestoneId, stage: tasksTable.stage }).from(tasksTable).where(eq(tasksTable.id, parentTaskId));
    if (parent) { milestoneId = milestoneId ?? parent.milestoneId ?? undefined; stage = stage ?? parent.stage ?? undefined; }
  }
  if (milestoneId == null) {
    milestoneId = await ensureUnscheduledMilestone(params.data.id);
  }
  if (!stage && milestoneId != null) {
    const [ms] = await db.select({ stage: milestonesTable.stage }).from(milestonesTable).where(eq(milestonesTable.id, milestoneId));
    stage = ms?.stage ?? undefined;
  }
  const [task] = await db.insert(tasksTable).values({
    projectId: params.data.id,
    milestoneId,
    workstreamId: pd.workstreamId as number | undefined,
    parentTaskId,
    managerId: pd.managerId as number | undefined,
    name: parsed.data.name,
    description: parsed.data.description,
    assigneeId: parsed.data.assigneeId,
    cftOwner: pd.cftOwner as number | undefined,
    cftDept: pd.cftDept as string | undefined,
    priority: parsed.data.priority,
    rag: pd.rag as string | undefined,
    stage,
    progressPct: typeof pd.progressPct === "number" ? pd.progressPct : undefined,
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
  await rollup(params.data.id);
  res.status(201).json(enriched);
  notifyTaskEventDetached({
    projectId: params.data.id,
    assigneeId: parsed.data.assigneeId,
    type: "task_added",
    title: `New task "${task.name}" in "${projT?.name ?? "project"}"`,
    body: [
      parsed.data.assigneeId ? "Assigned" : "Unassigned",
      task.startDate && task.endDate ? `scheduled ${task.startDate} → ${task.endDate}` : task.endDate ? `due ${task.endDate}` : null,
      `priority ${task.priority}`,
    ].filter(Boolean).join(", ") + ".",
    relatedEntityId: task.id,
    banner: { emoji: "🆕", title: "Task added", color: "blue" },
  });
});

// Merge/upsert tasks for a project from an uploaded .xlsx (base64 in JSON).
// Matched by ID column then case-insensitive name — matches are updated (blank
// cells keep current values), new rows are inserted, others left untouched.
router.post("/projects/:id/tasks/import", requireRole(...WRITE_ROLES), async (req, res): Promise<void> => {
  const params = CreateTaskParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [projT] = await db.select({ status: projectsTable.status }).from(projectsTable).where(eq(projectsTable.id, params.data.id));
  if (!projT) { res.status(404).json({ error: "Project not found" }); return; }
  if (projT.status === "closed") { res.status(409).json({ error: "Project is closed. Tasks cannot be imported." }); return; }
  try {
    const b64 = String((req.body as Record<string, unknown>)?.fileBase64 || "");
    if (!b64) { res.status(400).json({ error: "No file provided." }); return; }
    const buffer = Buffer.from(b64, "base64");
    if (!buffer.length) { res.status(400).json({ error: "Empty file." }); return; }
    const result = await mergeTaskWorkbook(params.data.id, buffer);
    await rollup(params.data.id);
    await logActivity("tasks_imported", `Imported ${result.rowsRead} rows — ${result.inserted} added, ${result.updated} updated`, params.data.id, "project");
    res.json(result);
  } catch (e) {
    const status = (e as { status?: number })?.status;
    const code = status && [400, 403, 404, 409, 422, 502].includes(status) ? status : 500;
    if (code === 500) console.error("[tasks import] failed:", (e as Error)?.message);
    res.status(code).json({ error: (e as Error)?.message || "Import failed." });
  }
});

router.get("/tasks/:id", async (req, res): Promise<void> => {
  const params = GetTaskParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, params.data.id));
  if (!task) { res.status(404).json({ error: "Task not found" }); return; }
  const [enriched] = await enrichTasks([task as unknown as Record<string, unknown>]);
  res.json(enriched);
});

router.patch("/tasks/:id", requireRole(...WRITE_ROLES), async (req, res): Promise<void> => {
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
  const [projTask] = await db.select({ status: projectsTable.status, name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, existing.projectId));
  if (projTask?.status === "closed") { res.status(409).json({ error: "Project is closed. Tasks cannot be updated." }); return; }
  // Edge-trigger for the completion alert: only on the not-completed → completed
  // transition, so a later PATCH on other fields can't re-fire it.
  const completedNow = parsed.data.status === "completed" && existing.status !== "completed";
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
        if (derived === "completed") {
          notifyTaskEventDetached({
            projectId: parentRow.projectId,
            type: "task_completed",
            title: `Task completed: "${parentRow.name}" in "${projTask?.name ?? "project"}"`,
            body: "All subtasks are complete — the parent task auto-completed.",
            relatedEntityId: parentRow.id,
            banner: { emoji: "✅", title: "Task completed", color: "green" },
          });
        }
      }
    }
  }

  // Progress roll-up across the whole hierarchy (subtask -> task -> milestone ->
  // project). Runs on any change that can move completion: progress, status,
  // or a reparent (milestoneId / parentTaskId move via drag-and-drop). Replaces
  // the previous single-level parent-task averaging with the shared engine so
  // milestone and project progress stay correct too.
  const moved =
    parsed.data.status !== undefined ||
    (parsed.data as Record<string, unknown>).progressPct !== undefined ||
    (parsed.data as Record<string, unknown>).milestoneId !== undefined ||
    (parsed.data as Record<string, unknown>).parentTaskId !== undefined;
  if (moved) await rollup(existing.projectId);

  res.json(enriched);
  if (completedNow) {
    notifyTaskEventDetached({
      projectId: existing.projectId,
      type: "task_completed",
      title: `Task completed: "${existing.name}" in "${projTask?.name ?? "project"}"`,
      body: existing.endDate ? `Planned end date was ${existing.endDate}.` : "Marked completed.",
      relatedEntityId: existing.id,
      banner: { emoji: "✅", title: "Task completed", color: "green" },
    });
  }
});

router.delete("/tasks/:id", requireRole("pmo", "pm"), async (req, res): Promise<void> => {
  const params = DeleteTaskParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [doomed] = await db.select({ projectId: tasksTable.projectId }).from(tasksTable).where(eq(tasksTable.id, params.data.id));
  await db.delete(tasksTable).where(eq(tasksTable.id, params.data.id));
  if (doomed) await rollup(doomed.projectId);
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

router.post("/tasks/:id/timelogs", requireRole(...WRITE_ROLES), async (req, res): Promise<void> => {
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

  // Over-log warning (Task #23). Edge-triggered: alert only when THIS log crosses
  // the planned threshold, so further logging on an already-overrun task doesn't
  // re-spam email/Teams. The activity log still records every over-logged state.
  const planned = Number(task.plannedEffortHours ?? 0);
  if (planned > 0 && totalHours > planned) {
    const prevTotal = totalHours - hours;
    if (prevTotal <= planned) {
      notifyTaskEventDetached({
        projectId: task.projectId,
        assigneeId: task.assigneeId,
        type: "effort_overrun",
        title: `Task "${task.name}" exceeded planned effort`,
        body: `Logged ${totalHours.toFixed(1)}h / ${planned}h planned (${Math.round((totalHours / planned) * 100)}%)`,
        relatedEntityId: task.id,
        banner: { emoji: "⚠️", title: "Effort overrun", color: "amber" },
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

router.patch("/tasks/:taskId/timelogs/:id", requireRole(...WRITE_ROLES), async (req, res): Promise<void> => {
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

router.delete("/tasks/:taskId/timelogs/:id", requireRole("pmo", "pm"), async (req, res): Promise<void> => {
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

// Task-schedule critical path (CPM): forward + backward pass over task
// predecessors → early/late start/finish, slack/float, isCritical. Cycle-safe.
// Distinct from /critical-path-stages (lifecycle-stage governance) below.
router.get("/projects/:id/critical-path", async (req, res): Promise<void> => {
  const params = GetCriticalPathParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const cpm = await computeTaskCpm(params.data.id);

  // Cyclic dependency graph: don't fabricate a schedule or touch isCritical —
  // surface the cycle so the UI can flag it for the user to fix.
  if (cpm.hasCycle) {
    res.json({
      projectId: params.data.id,
      hasCycle: true,
      cycle: cpm.cycle,
      criticalTasks: [],
      tasks: [],
      totalDurationDays: 0,
      criticalPathLength: 0,
      warning: "Dependency cycle detected — critical path cannot be computed until it is resolved.",
    });
    return;
  }

  // Persist isCritical for ALL tasks (true for critical, false otherwise) so a
  // task that drops off the critical path doesn't keep a stale flag. Only write
  // the rows whose flag actually changes.
  const existing = await db
    .select({ id: tasksTable.id, isCritical: tasksTable.isCritical })
    .from(tasksTable)
    .where(eq(tasksTable.projectId, params.data.id));
  const criticalSet = new Set(cpm.criticalTaskIds);
  for (const row of existing) {
    const shouldBe = criticalSet.has(row.id);
    if (!!row.isCritical !== shouldBe) {
      await db.update(tasksTable).set({ isCritical: shouldBe }).where(eq(tasksTable.id, row.id));
    }
  }

  const criticalRows = await db
    .select()
    .from(tasksTable)
    .where(and(eq(tasksTable.projectId, params.data.id), eq(tasksTable.isCritical, true)))
    .orderBy(tasksTable.order);
  const enriched = await enrichTasks(criticalRows as unknown as Array<Record<string, unknown>>);

  res.json({
    projectId: params.data.id,
    hasCycle: false,
    criticalTasks: enriched,
    // Full CPM schedule (every task with slack) for Gantt / slack display.
    tasks: cpm.tasks,
    totalDurationDays: cpm.projectDurationDays,
    criticalPathLength: cpm.criticalTaskIds.length,
  });
});

// Gantt-friendly schedule: the full CPM result for every task (start/finish,
// slack, isCritical, duration) without mutating isCritical. Read-only.
router.get("/projects/:id/schedule", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const cpm = await computeTaskCpm(id);
  res.json({ projectId: id, ...cpm });
});

// Add a single task dependency (predecessor). Validates existence, same-project
// scope, and rejects edges that would create a cycle (which would otherwise
// break the CPM recursion). Dependencies don't affect progress, so no rollup.
router.post("/tasks/:id/dependencies", requireRole(...WRITE_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const predecessorId = Number((req.body ?? {}).predecessorId);
  if (!Number.isInteger(predecessorId)) { res.status(400).json({ error: "predecessorId (integer) required" }); return; }
  if (predecessorId === id) { res.status(400).json({ error: "A task cannot depend on itself." }); return; }

  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  if (!task) { res.status(404).json({ error: "Task not found" }); return; }
  const [pred] = await db.select().from(tasksTable).where(eq(tasksTable.id, predecessorId));
  if (!pred) { res.status(404).json({ error: "Predecessor task not found" }); return; }
  if (pred.projectId !== task.projectId) {
    res.status(400).json({ error: "Predecessor must be in the same project (use cross-project predecessors otherwise)." });
    return;
  }

  let preds: number[] = [];
  try { preds = JSON.parse(task.predecessorIds || "[]"); } catch {}
  if (preds.includes(predecessorId)) { res.json(await enrichOne(task.id)); return; }

  if (await wouldCreateDependencyCycle(task.projectId, id, predecessorId)) {
    res.status(409).json({ error: "That dependency would create a cycle." });
    return;
  }

  preds.push(predecessorId);
  await db.update(tasksTable).set({ predecessorIds: JSON.stringify(preds) }).where(eq(tasksTable.id, id));
  res.json(await enrichOne(id));
});

// Remove a single task dependency (predecessor).
router.delete("/tasks/:id/dependencies/:predId", requireRole("pmo", "pm"), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  const predId = parseInt(req.params.predId);
  if (isNaN(id) || isNaN(predId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  if (!task) { res.status(404).json({ error: "Task not found" }); return; }
  let preds: number[] = [];
  try { preds = JSON.parse(task.predecessorIds || "[]"); } catch {}
  const next = preds.filter((p) => p !== predId);
  if (next.length !== preds.length) {
    await db.update(tasksTable).set({ predecessorIds: JSON.stringify(next) }).where(eq(tasksTable.id, id));
  }
  res.json(await enrichOne(id));
});

// Stage-governance critical path — which lifecycle stage is blocking, who owns it,
// days overdue, and why. Distinct from the task-schedule CPM above (/critical-path).
router.get("/projects/:id/critical-path-stages", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const result = await computeStageCriticalPath(id);
  if (!result) { res.status(404).json({ error: "Project not found" }); return; }
  res.json(result);
});

// Escalate / remind on a project's blocked stage. Writes in-app notifications to
// the pending approver + owner (escalate) or owner (remind), logs an audit entry,
// and sends a best-effort email.
router.post("/projects/:id/critical-path/escalate", requireRole(...WRITE_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { stageKey, action, subGateKey } = (req.body ?? {}) as { stageKey?: string; action?: string; subGateKey?: string };
  if (!stageKey) { res.status(400).json({ error: "stageKey is required" }); return; }
  const act = action === "remind" ? "remind" : "escalate";
  const result = await runCriticalPathAction(id, stageKey, act, subGateKey);
  if (!result.ok) { res.status(422).json(result); return; }
  res.json(result);
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
router.post("/projects/:id/nfa-trigger", requireRole(...WRITE_ROLES), async (req, res): Promise<void> => {
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
