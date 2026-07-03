// ───────────────────────────────────────────────────────────────────────────
// Work-management layer — CROSS-PROJECT task / milestone endpoints.
//
// The Monday-style global pages (My Tasks, Tasks, Milestones) need data that
// spans projects; the existing API is per-project only. These read endpoints
// aggregate across all non-closed projects and enrich each row with its
// project / milestone names, assignee, lifecycle stage, and the DERIVED gate
// info (approver / SLA / overdue / waiting-on) pulled from the stage-governance
// critical path — so a task can show "who approves this gate" and "is it
// breaching SLA" without a per-task approval workflow.
// ───────────────────────────────────────────────────────────────────────────
import { Router, type IRouter } from "express";
import { db, projectsTable, milestonesTable, tasksTable, usersTable, messagesTable, completionDecisionsTable } from "@workspace/db";
import { eq, ne, inArray, desc, sql, and, isNotNull, isNull } from "drizzle-orm";
import { computeStageCriticalPath, type CriticalPath } from "../lib/critical-path";
import { generateGateMilestones } from "../lib/gate-milestones";
import { logActivity } from "./activity";
import { requireRole } from "../lib/guard";

const router: IRouter = Router();

const WRITE_ROLES = ["pm", "pmo", "hod", "initiator"];

const STAGE_PHASE: Record<string, string> = {
  initiation: "initiate",
  vendor_selection: "procure",
  investment_authorization: "procure",
  contract_po: "procure",
  design: "execute",
  build: "execute",
  uat: "release_close",
  go_live: "release_close",
  closure: "release_close",
};

type GateInfo = {
  approver: { id: number | null; name: string; role?: string } | null;
  waitingOn: { role: string; person: { id: number | null; name: string } | null } | null;
  slaDays: number | null;
  daysOverdue: number;
  daysPending: number;
  pendingApproval: boolean;
};

// Build stageKey → derived gate info for a project (memoized per request).
function gateMapFromCp(cp: CriticalPath | null): Map<string, GateInfo> {
  const m = new Map<string, GateInfo>();
  if (!cp || !cp.currentStageRecognized) return m;
  for (const s of cp.stages) {
    m.set(s.key, {
      approver: s.pendingApprover ?? null,
      waitingOn: s.waitingOn ?? null,
      slaDays: s.slaDays,
      daysOverdue: s.daysOverdue,
      daysPending: s.daysPending,
      pendingApproval: s.status === "blocked" || !!s.pendingApprover,
    });
  }
  return m;
}

// Resolve the current user's numeric pmo_users.id from the authed email.
async function resolveMyUserId(email?: string | null): Promise<number | null> {
  if (!email) return null;
  const [row] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email.toLowerCase())).limit(1);
  return row?.id ?? null;
}

type TaskRow = Record<string, unknown> & {
  id: number; projectId: number; milestoneId: number | null; assigneeId: number | null;
  status: string; priority: string; stage: string | null; endDate: string | null;
  predecessorIds: string; crossProjectPredecessors: string; estimatedHours: unknown; actualHours: unknown;
};

// Shared task aggregation: returns every task (optionally filtered) enriched with
// projectName, milestoneName, assigneeName, phase, and derived gate info.
async function aggregateTasks(q: Record<string, string | undefined>) {
  // Open projects only (closed projects' tasks are history).
  const projects = await db.select({ id: projectsTable.id, name: projectsTable.name })
    .from(projectsTable).where(ne(projectsTable.status, "closed"));
  const projectIds = projects.map((p) => p.id);
  if (projectIds.length === 0) return [];
  const projectName = new Map(projects.map((p) => [p.id, p.name]));

  let rows = await db.select().from(tasksTable).where(inArray(tasksTable.projectId, projectIds)) as unknown as TaskRow[];

  // Names
  const milestones = await db.select({ id: milestonesTable.id, name: milestonesTable.name, stage: milestonesTable.stage })
    .from(milestonesTable).where(inArray(milestonesTable.projectId, projectIds));
  const msName = new Map(milestones.map((m) => [m.id, m.name]));
  const msStage = new Map(milestones.map((m) => [m.id, m.stage]));
  const userIds = [...new Set(rows.filter((t) => t.assigneeId).map((t) => t.assigneeId as number))];
  const users = userIds.length ? await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(inArray(usersTable.id, userIds)) : [];
  const userName = new Map(users.map((u) => [u.id, u.name]));

  // Derived gate info per project (only compute for projects that actually have rows).
  const cpCache = new Map<number, Map<string, GateInfo>>();
  const presentProjects = [...new Set(rows.map((t) => t.projectId))];
  // ponytail: per-project critical-path is independent — run concurrently, not N sequential awaits.
  // If still slow, the next rung is a short-TTL cache on computeStageCriticalPath (SLA+users queries repeat per project).
  await Promise.all(presentProjects.map(async (pid) => {
    try { cpCache.set(pid, gateMapFromCp(await computeStageCriticalPath(pid))); }
    catch { cpCache.set(pid, new Map()); }
  }));

  let enriched = rows.map((t) => {
    const stage = (t.stage as string | null) ?? (t.milestoneId != null ? msStage.get(t.milestoneId) ?? null : null);
    const gate = stage ? cpCache.get(t.projectId)?.get(stage) ?? null : null;
    return {
      ...t,
      projectName: projectName.get(t.projectId) ?? `Project ${t.projectId}`,
      milestoneName: t.milestoneId != null ? msName.get(t.milestoneId) ?? null : null,
      assigneeName: t.assigneeId ? userName.get(t.assigneeId as number) ?? null : null,
      stage,
      phase: stage ? STAGE_PHASE[stage] ?? null : null,
      estimatedHours: t.estimatedHours != null ? Number(t.estimatedHours) : null,
      actualHours: t.actualHours != null ? Number(t.actualHours) : null,
      gate, // { approver, waitingOn, slaDays, daysOverdue, daysPending, pendingApproval } | null
    };
  });

  // Filters
  if (q.assignee) enriched = enriched.filter((t) => String(t.assigneeId) === q.assignee);
  if (q.status) enriched = enriched.filter((t) => t.status === q.status);
  if (q.priority) enriched = enriched.filter((t) => t.priority === q.priority);
  if (q.project) enriched = enriched.filter((t) => String(t.projectId) === q.project);
  if (q.milestone) enriched = enriched.filter((t) => String(t.milestoneId) === q.milestone);
  if (q.stage) enriched = enriched.filter((t) => t.stage === q.stage);
  if (q.phase) enriched = enriched.filter((t) => t.phase === q.phase);
  if (q.dueFrom) enriched = enriched.filter((t) => t.endDate != null && t.endDate >= q.dueFrom!);
  if (q.dueTo) enriched = enriched.filter((t) => t.endDate != null && t.endDate <= q.dueTo!);
  if (q.search) {
    const s = q.search.toLowerCase();
    enriched = enriched.filter((t) => String(t.name).toLowerCase().includes(s));
  }
  return enriched;
}

// GET /api/tasks — all tasks across projects, with filters.
router.get("/tasks", async (req, res): Promise<void> => {
  const q = req.query as Record<string, string | undefined>;
  res.json(await aggregateTasks(q));
});

// GET /api/task-stats — per-project status counts, computed in SQL.
// The portfolio board only needs counts per project, not full task objects.
// ponytail: replaces a 1.3MB /api/tasks fetch + client-side loop that took ~4s.
// Subtasks are excluded so portfolio health matches the Projects board rule
// ("subtasks don't count as tasks") — else a project with all top-level tasks
// done but an open subtask reads Delayed here and Completed there.
router.get("/task-stats", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      projectId: tasksTable.projectId,
      status: tasksTable.status,
      n: sql<number>`count(*)::int`,
    })
    .from(tasksTable)
    .where(isNull(tasksTable.parentTaskId))
    .groupBy(tasksTable.projectId, tasksTable.status);
  res.json(rows);
});

// GET /api/me/tasks — the current user's tasks, bucketed Monday-style.
router.get("/me/tasks", async (req, res): Promise<void> => {
  const myId = await resolveMyUserId(req.user?.email);
  if (myId == null) { res.json({ assignedToMe: [], dueToday: [], upcoming: [], overdue: [], waitingForApproval: [], completed: [], myUserId: null }); return; }
  const all = await aggregateTasks({ assignee: String(myId) });
  const today = new Date().toISOString().slice(0, 10);
  const isDone = (s: string) => s === "completed";
  const buckets = {
    myUserId: myId,
    assignedToMe: all,
    dueToday: all.filter((t) => !isDone(t.status) && t.endDate === today),
    upcoming: all.filter((t) => !isDone(t.status) && t.endDate != null && t.endDate > today),
    overdue: all.filter((t) => !isDone(t.status) && t.endDate != null && t.endDate < today),
    waitingForApproval: all.filter((t) => !isDone(t.status) && (t.gate?.pendingApproval ?? false)),
    completed: all.filter((t) => isDone(t.status)),
  };
  res.json(buckets);
});

// GET /api/me/completion-approvals — task/subtask completions awaiting THIS
// user's sign-off (they're the resolved approver and a request is pending).
router.get("/me/completion-approvals", async (req, res): Promise<void> => {
  const myId = await resolveMyUserId(req.user?.email);
  if (myId == null) { res.json([]); return; }
  const rows = await db.select().from(tasksTable)
    .where(and(eq(tasksTable.completionApproverId, myId), isNotNull(tasksTable.completionRequestedBy)))
    .orderBy(desc(tasksTable.completionRequestedAt));
  if (rows.length === 0) { res.json([]); return; }
  const projs = await db.select({ id: projectsTable.id, name: projectsTable.name })
    .from(projectsTable).where(inArray(projectsTable.id, [...new Set(rows.map((r) => r.projectId))]));
  const projName = new Map(projs.map((p) => [p.id, p.name]));
  const reqIds = [...new Set(rows.map((r) => r.completionRequestedBy).filter(Boolean) as number[])];
  const reqUsers = reqIds.length
    ? await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(inArray(usersTable.id, reqIds))
    : [];
  const reqName = new Map(reqUsers.map((u) => [u.id, u.name]));
  res.json(rows.map((t) => ({
    id: t.id,
    name: t.name,
    projectId: t.projectId,
    projectName: projName.get(t.projectId) ?? `Project ${t.projectId}`,
    parentTaskId: t.parentTaskId,
    completionRequestedBy: t.completionRequestedBy,
    completionApproverId: t.completionApproverId,
    completionReason: t.completionReason,
    completionRequestedByName: t.completionRequestedBy != null ? reqName.get(t.completionRequestedBy) ?? null : null,
    completionRequestedAt: t.completionRequestedAt,
  })));
});

// GET /api/me/completion-decisions — log of completions THIS user has signed
// off (accepted/rejected), newest first, for the Approvals history.
router.get("/me/completion-decisions", async (req, res): Promise<void> => {
  const myId = await resolveMyUserId(req.user?.email);
  if (myId == null) { res.json([]); return; }
  const rows = await db.select().from(completionDecisionsTable)
    .where(eq(completionDecisionsTable.approverId, myId))
    .orderBy(desc(completionDecisionsTable.decidedAt))
    .limit(50);
  if (rows.length === 0) { res.json([]); return; }
  const projs = await db.select({ id: projectsTable.id, name: projectsTable.name })
    .from(projectsTable).where(inArray(projectsTable.id, [...new Set(rows.map((r) => r.projectId))]));
  const projName = new Map(projs.map((p) => [p.id, p.name]));
  const reqIds = [...new Set(rows.map((r) => r.requesterId).filter(Boolean) as number[])];
  const reqUsers = reqIds.length
    ? await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(inArray(usersTable.id, reqIds))
    : [];
  const reqName = new Map(reqUsers.map((u) => [u.id, u.name]));
  res.json(rows.map((r) => ({
    id: r.id,
    taskId: r.taskId,
    taskName: r.taskName,
    projectId: r.projectId,
    projectName: projName.get(r.projectId) ?? `Project ${r.projectId}`,
    decision: r.decision,
    reason: r.reason,
    requesterName: r.requesterId != null ? reqName.get(r.requesterId) ?? null : null,
    decidedAt: r.decidedAt,
  })));
});

// GET /api/milestones — all milestones across projects, enriched.
router.get("/milestones", async (req, res): Promise<void> => {
  const q = req.query as Record<string, string | undefined>;
  const projects = await db.select({ id: projectsTable.id, name: projectsTable.name })
    .from(projectsTable).where(ne(projectsTable.status, "closed"));
  const projectIds = projects.map((p) => p.id);
  if (projectIds.length === 0) { res.json([]); return; }
  const projectName = new Map(projects.map((p) => [p.id, p.name]));

  const milestones = await db.select().from(milestonesTable).where(inArray(milestonesTable.projectId, projectIds)).orderBy(milestonesTable.order);
  // Rolled-up task completion per milestone.
  const tasks = await db.select({ milestoneId: tasksTable.milestoneId, status: tasksTable.status, progressPct: tasksTable.progressPct })
    .from(tasksTable).where(inArray(tasksTable.projectId, projectIds));
  const byMs = new Map<number, { total: number; sum: number }>();
  for (const t of tasks) {
    if (t.milestoneId == null) continue;
    const e = byMs.get(t.milestoneId) ?? { total: 0, sum: 0 };
    e.total++; e.sum += t.progressPct ?? (t.status === "completed" ? 100 : 0);
    byMs.set(t.milestoneId, e);
  }

  // Derived gate info per project for the milestone's stage.
  const cpCache = new Map<number, Map<string, GateInfo>>();
  // ponytail: same fix as aggregateTasks — independent per project, run concurrently.
  await Promise.all([...new Set(milestones.map((m) => m.projectId))].map(async (pid) => {
    try { cpCache.set(pid, gateMapFromCp(await computeStageCriticalPath(pid))); } catch { cpCache.set(pid, new Map()); }
  }));

  let enriched = milestones.map((m) => {
    const roll = byMs.get(m.id);
    return {
      ...m,
      projectName: projectName.get(m.projectId) ?? `Project ${m.projectId}`,
      phase: m.stage ? STAGE_PHASE[m.stage] ?? null : null,
      completionPct: roll && roll.total > 0 ? Math.round(roll.sum / roll.total) : 0,
      taskCount: roll?.total ?? 0,
      gate: m.stage ? cpCache.get(m.projectId)?.get(m.stage) ?? null : null,
    };
  });

  if (q.project) enriched = enriched.filter((m) => String(m.projectId) === q.project);
  if (q.stage) enriched = enriched.filter((m) => m.stage === q.stage);
  if (q.phase) enriched = enriched.filter((m) => m.phase === q.phase);
  if (q.status) enriched = enriched.filter((m) => m.status === q.status);
  if (q.gateDecision) enriched = enriched.filter((m) => m.gateDecision === q.gateDecision);
  res.json(enriched);
});

// POST /api/projects/:id/milestones/generate-gates — create the 7 standard gates.
router.post("/projects/:id/milestones/generate-gates", requireRole(...WRITE_ROLES), async (req, res): Promise<void> => {
  const projectId = Number(req.params.id);
  if (!Number.isFinite(projectId)) { res.status(400).json({ error: "Invalid project id" }); return; }
  const [proj] = await db.select({ id: projectsTable.id, name: projectsTable.name, status: projectsTable.status }).from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!proj) { res.status(404).json({ error: "Project not found" }); return; }
  if (proj.status === "closed") { res.status(409).json({ error: "Project is closed." }); return; }
  const created = await generateGateMilestones(projectId);
  if (created > 0) await logActivity("milestone_created", `Generated ${created} gate milestone(s)`, projectId, "project");
  res.json({ created });
});

// GET /api/tasks/:id/comments — task comment thread (via pmo_messages).
router.get("/tasks/:id/comments", async (req, res): Promise<void> => {
  const taskId = Number(req.params.id);
  if (!Number.isFinite(taskId)) { res.status(400).json({ error: "Invalid task id" }); return; }
  const rows = await db.select().from(messagesTable).where(eq(messagesTable.taskId, taskId)).orderBy(desc(messagesTable.createdAt));
  const senderIds = [...new Set(rows.map((r) => r.senderId))];
  const users = senderIds.length ? await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(inArray(usersTable.id, senderIds)) : [];
  const userName = new Map(users.map((u) => [u.id, u.name]));
  res.json(rows.map((r) => ({ ...r, senderName: userName.get(r.senderId) ?? null })));
});

// POST /api/tasks/:id/comments — add a task comment (optionally with attachments).
router.post("/tasks/:id/comments", requireRole(...WRITE_ROLES), async (req, res): Promise<void> => {
  const taskId = Number(req.params.id);
  if (!Number.isFinite(taskId)) { res.status(400).json({ error: "Invalid task id" }); return; }
  const body = (req.body?.body as string | undefined)?.trim();
  const attachments = Array.isArray(req.body?.attachments) ? req.body.attachments : [];
  if (!body && attachments.length === 0) { res.status(400).json({ error: "body or attachments required" }); return; }
  const [task] = await db.select({ id: tasksTable.id, projectId: tasksTable.projectId, name: tasksTable.name }).from(tasksTable).where(eq(tasksTable.id, taskId));
  if (!task) { res.status(404).json({ error: "Task not found" }); return; }
  const senderId = await resolveMyUserId(req.user?.email);
  if (senderId == null) { res.status(401).json({ error: "Not authenticated" }); return; }
  const [msg] = await db.insert(messagesTable).values({
    projectId: task.projectId,
    taskId,
    senderId,
    body: body ?? "",
    attachments,
  }).returning();
  await logActivity("task_comment", `Comment on task "${task.name}"`, taskId, "task", senderId);
  res.status(201).json(msg);
});

export default router;
