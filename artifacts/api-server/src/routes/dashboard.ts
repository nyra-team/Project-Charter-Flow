import { Router, type IRouter } from "express";
import { db, chartersTable, approvalsTable, projectsTable, projectStagesTable, tasksTable, milestonesTable, usersTable, risksTable, scoringCriteriaTable, projectScoresTable, resourceAllocationsTable, stageEscalationPolicyTable, escalationLogTable } from "@workspace/db";
import { eq, ne, and, gte } from "drizzle-orm";
import { getRecentActivityWithUsers } from "./activity";
import { computeStageCriticalPath, type CriticalPathStage } from "../lib/critical-path";
import { resolveRole } from "../lib/role-resolver";

const router: IRouter = Router();

// Map each role to which charter stages count as "their" pending action
const ROLE_STAGE_MAP: Record<string, string[]> = {
  hod: ["parallel_review"],
  executive_director: ["parallel_review"],
  cfo: ["parallel_review"],
  scm: ["scm_review"],
  chairman: ["chairman_review"],
  finance: ["finance_review"],
  pmo: ["pmo_review"],
  // pm and team_member have no charter approval responsibilities — pending count is 0
  pm: [],
  team_member: [],
  initiator: [],
};

router.get("/dashboard/summary", async (req, res): Promise<void> => {
  const charters = await db.select().from(chartersTable);
  const projects = await db.select().from(projectsTable);
  const allTasks = await db.select().from(tasksTable);
  const pendingApprovals = await db.select().from(approvalsTable).where(eq(approvalsTable.status, "pending"));

  const chartersByStatus: Record<string, number> = {};
  for (const c of charters) {
    chartersByStatus[c.status] = (chartersByStatus[c.status] ?? 0) + 1;
  }

  const approvedCharters = charters.filter(c => ["approved", "active"].includes(c.status));
  const totalBudgetApproved = approvedCharters.reduce((sum, c) => {
    const budget = c.finalNegotiatedBudget ?? c.tentativeBudget;
    return sum + Number(budget ?? 0);
  }, 0);

  const now = new Date();

  // Project health analysis
  type DelayedProject = { id: number; name: string; reason: string; daysOverdue: number };
  type OffTrackProject = { id: number; name: string; reason: string; behindBy: number };

  const projectHealth = {
    total: projects.length,
    active: 0,
    onTrack: 0,
    offTrack: 0,
    delayed: 0,
    completed: 0,
    delayedProjects: [] as DelayedProject[],
    offTrackProjects: [] as OffTrackProject[],
  };

  for (const p of projects) {
    if (p.status === "completed") { projectHealth.completed++; continue; }
    if (p.status !== "active") continue;
    projectHealth.active++;

    const projectTasks = allTasks.filter(t => t.projectId === p.id);
    const completedTaskCount = projectTasks.filter(t => t.status === "completed").length;
    const blockedTasks = projectTasks.filter(t => t.status === "blocked").length;
    const totalTaskCount = projectTasks.length;
    const actualProgress = totalTaskCount > 0 ? (completedTaskCount / totalTaskCount) * 100 : 0;

    const endDate = p.endDate ? new Date(p.endDate) : null;
    const startDate = p.startDate ? new Date(p.startDate) : new Date(p.createdAt);

    if (endDate && endDate < now) {
      projectHealth.delayed++;
      const daysOverdue = Math.ceil((now.getTime() - endDate.getTime()) / (1000 * 60 * 60 * 24));
      const reason = blockedTasks > 0
        ? `${blockedTasks} blocked task${blockedTasks > 1 ? "s" : ""}, completion overdue`
        : `${Math.round(actualProgress)}% complete — past due date`;
      projectHealth.delayedProjects.push({ id: p.id, name: p.name, reason, daysOverdue });
    } else {
      const totalDuration = endDate
        ? Math.max(1, endDate.getTime() - startDate.getTime())
        : 90 * 24 * 60 * 60 * 1000;
      const elapsed = Math.max(0, now.getTime() - startDate.getTime());
      const expectedProgress = Math.min(100, (elapsed / totalDuration) * 100);
      const behindBy = expectedProgress - actualProgress;

      if (behindBy > 15) {
        projectHealth.offTrack++;
        const reason = blockedTasks > 0
          ? `${blockedTasks} blocked task${blockedTasks > 1 ? "s" : ""}`
          : `Behind schedule by ${Math.round(behindBy)}%`;
        projectHealth.offTrackProjects.push({ id: p.id, name: p.name, reason, behindBy: Math.round(behindBy) });
      } else {
        projectHealth.onTrack++;
      }
    }
  }

  // Role-scoped pending count: each role only sees stages relevant to them.
  // Real role from the master employee DB (requireAuth → derivePmoRole).
  const sessionRole = req.user?.pmoRole ?? "initiator";
  const relevantStages = ROLE_STAGE_MAP[sessionRole];
  const rolePendingCount = relevantStages
    ? charters.filter(c => relevantStages.includes(c.status)).length
    : pendingApprovals.length;

  // Intake cycle time: average days from submission to approval for completed charters
  const approvedCharter2 = charters.filter(c => c.status === "approved" || c.status === "active");
  const avgCycleTimeDays = approvedCharter2.length > 0
    ? Math.round(approvedCharter2.reduce((sum, c) => {
        const created = new Date(c.createdAt).getTime();
        const updated = new Date(c.updatedAt).getTime();
        return sum + (updated - created) / 86400000;
      }, 0) / approvedCharter2.length)
    : null;

  // Stage-gate funnel: count of charters per stage
  const stageGateFunnel = [
    "submitted", "parallel_review", "scm_review", "chairman_review",
    "finance_review", "pmo_review", "approved",
  ].map(stage => ({
    stage,
    count: charters.filter(c => c.status === stage).length,
  }));

  res.json({
    totalCharters: charters.length,
    pendingApprovals: rolePendingCount,
    totalPendingApprovals: pendingApprovals.length,
    activeProjects: projects.filter(p => p.status === "active").length,
    completedProjects: projects.filter(p => p.status === "completed").length,
    chartersByStatus: Object.entries(chartersByStatus).map(([status, count]) => ({ status, count })),
    totalBudgetApproved,
    projectHealth,
    roleContext: sessionRole,
    avgCycleTimeDays,
    stageGateFunnel,
  });
});

router.get("/dashboard/activity", async (_req, res): Promise<void> => {
  const items = await getRecentActivityWithUsers(20);
  res.json(items.map(i => ({
    id: i.id,
    type: i.type,
    message: i.message,
    entityId: i.entityId,
    entityType: i.entityType,
    userId: i.userId ?? null,
    userName: (i as Record<string, unknown>).userName as string ?? null,
    createdAt: i.createdAt,
  })));
});

router.get("/dashboard/gamification", async (_req, res): Promise<void> => {
  const decidedApprovals = await db.select().from(approvalsTable)
    .where(ne(approvalsTable.status, "pending"));

  const users = await db.select().from(usersTable);
  const userMap = Object.fromEntries(users.map(u => [u.id, u]));

  const scoresByUser: Record<number, { totalMs: number; count: number; approved: number; rejected: number }> = {};

  for (const approval of decidedApprovals) {
    if (!approval.approverId) continue;
    const createdAt = approval.createdAt instanceof Date ? approval.createdAt : new Date(approval.createdAt);
    const decidedAt = approval.decidedAt instanceof Date ? approval.decidedAt : (approval.decidedAt ? new Date(approval.decidedAt) : new Date());
    const responseMs = Math.max(0, decidedAt.getTime() - createdAt.getTime());

    if (!scoresByUser[approval.approverId]) {
      scoresByUser[approval.approverId] = { totalMs: 0, count: 0, approved: 0, rejected: 0 };
    }
    scoresByUser[approval.approverId].totalMs += responseMs;
    scoresByUser[approval.approverId].count++;
    if (approval.status === "approved") scoresByUser[approval.approverId].approved++;
    else scoresByUser[approval.approverId].rejected++;
  }

  const leaderboard = Object.entries(scoresByUser).map(([userId, data]) => {
    const user = userMap[Number(userId)];
    const avgResponseMs = data.count > 0 ? data.totalMs / data.count : Infinity;
    const avgResponseHours = avgResponseMs / (1000 * 60 * 60);
    const speedScore = Math.max(0, 100 - Math.min(100, avgResponseHours * 2));
    const volumeBonus = Math.min(30, data.count * 5);
    const approvalRatioBonus = data.count > 0 ? (data.approved / data.count) * 20 : 0;
    const totalScore = Math.round(speedScore + volumeBonus + approvalRatioBonus);

    return {
      userId: Number(userId),
      name: user?.name ?? `User ${userId}`,
      role: user?.role ?? "unknown",
      totalScore,
      decisionsCount: data.count,
      approvedCount: data.approved,
      avgResponseHours: Math.round(avgResponseHours * 10) / 10,
      rank: 0,
    };
  })
    .sort((a, b) => b.totalScore - a.totalScore)
    .map((item, idx) => ({ ...item, rank: idx + 1 }))
    .slice(0, 10);

  res.json({ leaderboard });
});

// Portfolio health — 12-week RAG trend derived from current project rag_status
router.get("/dashboard/portfolio-health", async (_req, res): Promise<void> => {
  const projects = await db.select({
    id: projectsTable.id,
    ragStatus: projectsTable.ragStatus,
    status: projectsTable.status,
    createdAt: projectsTable.createdAt,
  }).from(projectsTable);

  const now = new Date();
  const weeks = Array.from({ length: 12 }, (_, i) => {
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - (11 - i) * 7);
    return { week: `W${i + 1}`, date: weekStart.toISOString().split("T")[0] };
  });

  // For each week, count projects that existed and their rag status
  // Simplification: use current rag_status for all weeks a project was active
  const trend = weeks.map(w => {
    const weekDate = new Date(w.date);
    const activeProjects = projects.filter(p =>
      p.status === "active" && new Date(p.createdAt) <= weekDate
    );
    const green = activeProjects.filter(p => (p.ragStatus ?? "green") === "green").length;
    const amber = activeProjects.filter(p => p.ragStatus === "amber").length;
    const red = activeProjects.filter(p => p.ragStatus === "red").length;
    return { week: w.week, date: w.date, green, amber, red, total: activeProjects.length };
  });

  res.json({ trend });
});

// Capacity vs demand heatmap — resource_allocations aggregated by function/month
router.get("/dashboard/capacity-demand", async (_req, res): Promise<void> => {
  const allocations = await db.select().from(resourceAllocationsTable);
  const users = await db.select().from(usersTable);
  const userMap = Object.fromEntries(users.map(u => [u.id, u]));

  const now = new Date();
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    return { key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: d.toLocaleString("default", { month: "short", year: "2-digit" }) };
  });

  const functions = [...new Set(users.map(u => u.department || "General"))].sort();

  const cells = functions.flatMap(fn => {
    const fnUsers = users.filter(u => (u.department || "General") === fn);
    return months.map(m => {
      const fnAllocs = allocations.filter(a => {
        const u = userMap[a.userId ?? 0];
        return u && (u.department || "General") === fn && a.startDate && a.endDate &&
          a.startDate.substring(0, 7) <= m.key && a.endDate.substring(0, 7) >= m.key;
      });
      const demand = fnAllocs.reduce((sum, a) => sum + Number(a.allocationPct ?? 0), 0);
      const capacity = fnUsers.length * 100;
      return { function: fn, month: m.label, monthKey: m.key, demand, capacity, utilization: capacity > 0 ? Math.round(demand / capacity * 100) : 0 };
    });
  });

  res.json({ functions, months: months.map(m => m.label), cells });
});

// ---------------------------------------------------------------------------
// GET /api/dashboard/milestone-achievers
// Top assignees by on-time task completions in the last 90 days.
// Tasks are the unit of ownership in this schema (assigneeId), not milestones.
// ---------------------------------------------------------------------------
router.get("/dashboard/milestone-achievers", async (_req, res): Promise<void> => {
  const tasks = await db.select().from(tasksTable).where(eq(tasksTable.status, "completed"));
  const users = await db.select().from(usersTable);
  const userMap = Object.fromEntries(users.map(u => [u.id, u]));

  const cutoff = Date.now() - 90 * 86400000;
  const byOwner: Record<number, { name: string; role: string; dept: string; total: number; onTime: number; early: number; late: number; _sumDelta: number }> = {};

  for (const t of tasks) {
    const assigneeId = t.assigneeId;
    if (!assigneeId) continue;
    const completedAtRaw = t.actualEnd ?? null;
    if (!completedAtRaw) continue;
    const completedAt = new Date(completedAtRaw).getTime();
    if (!Number.isFinite(completedAt) || completedAt < cutoff) continue;
    const plannedRaw = t.endDate;
    if (!plannedRaw) continue;
    const planned = new Date(plannedRaw).getTime();
    if (!Number.isFinite(planned)) continue;

    const u = userMap[assigneeId];
    if (!byOwner[assigneeId]) {
      byOwner[assigneeId] = { name: u?.name ?? `User ${assigneeId}`, role: u?.role ?? "", dept: u?.department ?? "—", total: 0, onTime: 0, early: 0, late: 0, _sumDelta: 0 };
    }
    const entry = byOwner[assigneeId];
    entry.total++;
    const deltaDays = Math.round((completedAt - planned) / 86400000);
    entry._sumDelta += deltaDays;
    if (deltaDays < 0) entry.early++;
    else if (deltaDays === 0) entry.onTime++;
    else entry.late++;
  }

  const board = Object.entries(byOwner).map(([userId, e]) => ({
    userId: Number(userId),
    name: e.name,
    role: e.role,
    department: e.dept,
    completed: e.total,
    onTimeOrEarly: e.early + e.onTime,
    late: e.late,
    onTimePct: e.total > 0 ? Math.round(((e.early + e.onTime) / e.total) * 100) : 0,
    avgDaysVsPlan: e.total > 0 ? Math.round(e._sumDelta / e.total) : 0,
  }))
    .sort((a, b) => (b.onTimeOrEarly - a.onTimeOrEarly) || (a.avgDaysVsPlan - b.avgDaysVsPlan))
    .slice(0, 10);

  res.json({ window: "last 90 days", leaderboard: board });
});

// ---------------------------------------------------------------------------
// GET /api/dashboard/stuck-approvals
// Pending approvals sorted by days waiting (oldest first) — accountability view.
// ---------------------------------------------------------------------------
router.get("/dashboard/stuck-approvals", async (_req, res): Promise<void> => {
  const pending = await db.select().from(approvalsTable).where(eq(approvalsTable.status, "pending"));
  const users = await db.select().from(usersTable);
  const charters = await db.select().from(chartersTable);
  const userMap = Object.fromEntries(users.map(u => [u.id, u]));
  const charterMap = Object.fromEntries(charters.map(c => [c.id, c]));

  const now = Date.now();
  const items = pending.map(a => {
    const createdAt = new Date(a.createdAt).getTime();
    const daysWaiting = Math.floor((now - createdAt) / 86400000);
    const approver = a.approverId ? userMap[a.approverId] : null;
    const charter = a.charterId ? charterMap[a.charterId] : null;
    return {
      id: a.id,
      charterId: a.charterId,
      charterTitle: charter?.title ?? `Charter #${a.charterId}`,
      stage: a.stage,
      approverId: a.approverId,
      approverName: approver?.name ?? "Unassigned",
      approverRole: approver?.role ?? "",
      daysWaiting,
      severity: daysWaiting >= 7 ? "red" : daysWaiting >= 3 ? "amber" : "green",
      createdAt: a.createdAt,
    };
  })
    .sort((a, b) => b.daysWaiting - a.daysWaiting)
    .slice(0, 15);

  res.json({ items, totalPending: pending.length });
});

// ---------------------------------------------------------------------------
// GET /api/dashboard/delivery-stats
// Aggregate on-time delivery rate (tasks + milestones, last 90 days),
// plus open-risk burden as a portfolio risk-management signal.
// ---------------------------------------------------------------------------
router.get("/dashboard/delivery-stats", async (_req, res): Promise<void> => {
  const ms = await db.select().from(milestonesTable);
  const tasks = await db.select().from(tasksTable);
  const risks = await db.select().from(risksTable);

  const cutoff = Date.now() - 90 * 86400000;

  function rate(items: Array<{ status: string; planned: string | null; actual: string | null }>) {
    const completed = items.filter(i => i.status === "completed" && i.planned && i.actual);
    const window = completed.filter(i => new Date(i.actual as string).getTime() >= cutoff);
    const onTime = window.filter(i => {
      const c = new Date(i.actual as string).getTime();
      const p = new Date(i.planned as string).getTime();
      return c <= p;
    }).length;
    return { total: window.length, onTime, pct: window.length > 0 ? Math.round((onTime / window.length) * 100) : 0 };
  }

  const taskRate = rate(tasks.map(t => ({ status: t.status, planned: t.endDate, actual: t.actualEnd })));
  const msRate = rate(ms.map(m => ({ status: m.status, planned: m.dueDate, actual: m.actualEnd })));

  // Open risk pressure: high/critical risks still open
  const openRisks = risks.filter(r => r.status === "open" || r.status === "in_progress");
  const highSeverity = openRisks.filter(r => r.priority === "high" || r.priority === "critical" || r.rag === "red").length;
  const unowned = openRisks.filter(r => !r.owner || r.owner.trim() === "").length;

  res.json({
    window: "last 90 days",
    tasks: taskRate,
    milestones: msRate,
    overall: {
      total: taskRate.total + msRate.total,
      onTime: taskRate.onTime + msRate.onTime,
      pct: (taskRate.total + msRate.total) > 0
        ? Math.round(((taskRate.onTime + msRate.onTime) / (taskRate.total + msRate.total)) * 100)
        : 0,
    },
    risks: {
      totalOpen: openRisks.length,
      highSeverity,
      unowned,
    },
  });
});

// Portfolio-level stage-governance critical path: how many projects are on track /
// at risk / blocked, the most common bottleneck stages, and the blocked-project list.
router.get("/dashboard/critical-path-portfolio", async (_req, res): Promise<void> => {
  const projects = await db.select({ id: projectsTable.id, status: projectsTable.status })
    .from(projectsTable).where(ne(projectsTable.status, "closed"));

  let onTrack = 0, atRisk = 0, blocked = 0, unmapped = 0;
  const bottleneckCounts = new Map<string, { label: string; count: number }>();
  const blockedProjects: Array<{ id: number; name: string; blockedStageKey: string; stageLabel: string; daysOverdue: number; owner: { id: number; name: string } | null }> = [];

  // Per-phase rollup for the Pipeline page (4 phase lanes). Seed all four so the
  // UI always renders every lane even when a phase is empty.
  const PHASE_ORDER = ["initiate", "procure", "execute", "release_close"];
  const byPhaseMap = new Map<string, { phaseKey: string; projects: number; blocked: number; overdue: number; activeApprovals: number }>();
  for (const k of PHASE_ORDER) byPhaseMap.set(k, { phaseKey: k, projects: 0, blocked: 0, overdue: 0, activeApprovals: 0 });

  for (const p of projects) {
    const cp = await computeStageCriticalPath(p.id);
    if (!cp) continue;
    // Projects on legacy stage keys (pre-Option-B data) can't be placed on the
    // critical path — count them separately rather than inflating "on track".
    if (!cp.currentStageRecognized) { unmapped++; continue; }
    if (cp.health === "blocked") blocked++;
    else if (cp.health === "at_risk") atRisk++;
    else onTrack++;

    // Phase placement = phase of the project's current stage. The focus stage
    // (blocked, else active) drives the per-phase overdue / active-approval tallies.
    const currentStage = cp.stages.find((s) => s.key === cp.currentStageKey);
    const focus = cp.stages.find((s) => s.status === "blocked") ?? cp.stages.find((s) => s.status === "active");
    const phaseKey = currentStage?.phaseKey ?? focus?.phaseKey;
    if (phaseKey) {
      const ph = byPhaseMap.get(phaseKey) ?? { phaseKey, projects: 0, blocked: 0, overdue: 0, activeApprovals: 0 };
      ph.projects++;
      if (cp.health === "blocked") ph.blocked++;
      if ((focus?.daysOverdue ?? 0) > 0) ph.overdue++;
      if (focus?.pendingApprover) ph.activeApprovals++;
      byPhaseMap.set(phaseKey, ph);
    }

    // Bottleneck = the stage that is blocked, or the at-risk active stage.
    const pinch = cp.stages.find((s) => s.status === "blocked") ?? cp.stages.find((s) => s.status === "active" && (s.daysOverdue > 0 || s.blockingReasons.length > 0));
    if (pinch && cp.health !== "on_track") {
      const e = bottleneckCounts.get(pinch.key) ?? { label: pinch.label, count: 0 };
      e.count++;
      bottleneckCounts.set(pinch.key, e);
    }

    if (cp.blockedStageKey) {
      const bs = cp.stages.find((s) => s.key === cp.blockedStageKey)!;
      blockedProjects.push({
        id: cp.projectId, name: cp.projectName,
        blockedStageKey: cp.blockedStageKey, stageLabel: bs.label,
        daysOverdue: bs.daysOverdue, owner: bs.owner,
      });
    }
  }

  const bottlenecks = [...bottleneckCounts.entries()]
    .map(([stageKey, v]) => ({ stageKey, label: v.label, count: v.count }))
    .sort((a, b) => b.count - a.count);
  blockedProjects.sort((a, b) => b.daysOverdue - a.daysOverdue);

  const byPhase = PHASE_ORDER.map((k) => byPhaseMap.get(k)!);

  res.json({ onTrack, atRisk, blocked, unmapped, total: projects.length, bottlenecks, blockedProjects, byPhase });
});

// Org-wide Initiation sub-gate aggregate — how many projects currently in the
// Initiation stage have their Business Case / URS gate approved. Lets the shared
// lifecycle card show "BC x/n · URS y/n" under INIT in counts (org-wide) mode,
// matching the per-project view.
router.get("/dashboard/initiation-subgates", async (_req, res): Promise<void> => {
  const projs = await db.select({ id: projectsTable.id })
    .from(projectsTable).where(and(eq(projectsTable.stage, "initiation"), ne(projectsTable.status, "closed")));
  let bcDone = 0, ursDone = 0;
  for (const p of projs) {
    const [st] = await db.select({ notes: projectStagesTable.notes }).from(projectStagesTable)
      .where(and(eq(projectStagesTable.projectId, p.id), eq(projectStagesTable.stage, "initiation")));
    let n: Record<string, unknown> = {};
    try { n = JSON.parse(st?.notes ?? "{}"); } catch { n = {}; }
    if (n.__bc_approved === true) bcDone++;
    if (n.__urs_biz_approved === true && n.__urs_it_approved === true) ursDone++;
  }
  res.json({ inInitiation: projs.length, bcDone, ursDone });
});

// ---------------------------------------------------------------------------
// BOTTLENECKS BY PERSON — make the blockage visible by who owns it, not just
// by stage. All four widgets below derive from the live critical path (no
// dependency on legacy pmo_approvals being populated).
// ---------------------------------------------------------------------------

type FocusStage = {
  projectId: number;
  projectName: string;
  stage: CriticalPathStage;
};

// Walk every active, recognized project once and return its single active/blocked
// stage. Shared by the by-person widgets.
async function collectFocusStages(): Promise<FocusStage[]> {
  const projects = await db.select({ id: projectsTable.id })
    .from(projectsTable).where(ne(projectsTable.status, "closed"));
  const out: FocusStage[] = [];
  for (const p of projects) {
    const cp = await computeStageCriticalPath(p.id);
    if (!cp || !cp.currentStageRecognized) continue;
    const stage = cp.stages.find((s) => s.status === "blocked") ?? cp.stages.find((s) => s.status === "active");
    if (!stage) continue;
    out.push({ projectId: cp.projectId, projectName: cp.projectName, stage });
  }
  return out;
}

// Group key for a (possibly unassigned) waiting-on person.
function personKey(w: CriticalPathStage["waitingOn"]): string {
  if (w?.person?.id != null) return `u${w.person.id}`;
  if (w?.person?.name) return `n${w.person.name}`;
  return `role:${w?.role ?? "unknown"}`;
}

// GET /api/dashboard/pending-approvals-by-person
// Everyone currently being waited on, with the projects/stages stalled on them.
router.get("/dashboard/pending-approvals-by-person", async (_req, res): Promise<void> => {
  const focus = await collectFocusStages();
  const byPerson = new Map<string, { person: { id: number | null; name: string } | null; role: string; count: number; projects: Array<{ id: number; name: string; stage: string; daysPending: number; daysOverdue: number }> }>();
  for (const f of focus) {
    const w = f.stage.waitingOn;
    if (!w) continue;
    const key = personKey(w);
    const e = byPerson.get(key) ?? { person: w.person, role: w.role, count: 0, projects: [] };
    e.count++;
    e.projects.push({ id: f.projectId, name: f.projectName, stage: f.stage.label, daysPending: f.stage.daysPending, daysOverdue: f.stage.daysOverdue });
    byPerson.set(key, e);
  }
  const rows = [...byPerson.values()].sort((a, b) => b.count - a.count);
  res.json(rows);
});

// GET /api/dashboard/overdue-actions-by-person
// Same, but only stages past their SLA, ranked by total overdue days.
router.get("/dashboard/overdue-actions-by-person", async (_req, res): Promise<void> => {
  const focus = await collectFocusStages();
  const byPerson = new Map<string, { person: { id: number | null; name: string } | null; role: string; count: number; totalOverdueDays: number; projects: Array<{ id: number; name: string; stage: string; daysOverdue: number }> }>();
  for (const f of focus) {
    if (f.stage.daysOverdue <= 0) continue;
    const w = f.stage.waitingOn;
    if (!w) continue;
    const key = personKey(w);
    const e = byPerson.get(key) ?? { person: w.person, role: w.role, count: 0, totalOverdueDays: 0, projects: [] };
    e.count++;
    e.totalOverdueDays += f.stage.daysOverdue;
    e.projects.push({ id: f.projectId, name: f.projectName, stage: f.stage.label, daysOverdue: f.stage.daysOverdue });
    byPerson.set(key, e);
  }
  const rows = [...byPerson.values()].sort((a, b) => b.totalOverdueDays - a.totalOverdueDays);
  res.json(rows);
});

// GET /api/dashboard/escalations-required
// Policy tiers that are DUE (threshold crossed, work still pending) but not yet fired
// today — i.e. what the next ladder tick (or a human) should action, grouped by target.
router.get("/dashboard/escalations-required", async (_req, res): Promise<void> => {
  const policy = await db.select().from(stageEscalationPolicyTable).where(eq(stageEscalationPolicyTable.isActive, true));
  const byStage = new Map<string, typeof policy>();
  for (const p of policy) { const l = byStage.get(p.stage) ?? []; l.push(p); byStage.set(p.stage, l as typeof policy); }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const focus = await collectFocusStages();
  const items: Array<{ projectId: number; projectName: string; stage: string; stageLabel: string; tier: number; action: string; targetRole: string; person: { id: number | null; name: string } | null; daysPending: number; daysOverdue: number }> = [];

  for (const f of focus) {
    const tiers = byStage.get(f.stage.key);
    if (!tiers) continue;
    const hasPendingWork = f.stage.blockingReasons.length > 0 || f.stage.daysOverdue > 0;
    if (!hasPendingWork) continue;
    for (const t of tiers) {
      if (f.stage.daysPending < t.afterDays) continue;
      if (t.subGateKey) { const sg = f.stage.subGates?.find((g) => g.key === t.subGateKey); if (!sg || sg.satisfied) continue; }
      const fired = await db.select({ id: escalationLogTable.id }).from(escalationLogTable)
        .where(and(eq(escalationLogTable.projectId, f.projectId), eq(escalationLogTable.stage, f.stage.key), eq(escalationLogTable.tier, t.tier), gte(escalationLogTable.sentAt, since))).limit(1);
      if (fired.length) continue;
      const [r] = await resolveRole(t.targetRole, f.projectId);
      items.push({
        projectId: f.projectId, projectName: f.projectName, stage: f.stage.key, stageLabel: f.stage.label,
        tier: t.tier, action: t.action, targetRole: t.targetRole,
        person: r ? { id: r.userId, name: r.name } : null,
        daysPending: f.stage.daysPending, daysOverdue: f.stage.daysOverdue,
      });
    }
  }
  items.sort((a, b) => b.daysOverdue - a.daysOverdue || b.daysPending - a.daysPending);
  res.json(items);
});

// GET /api/dashboard/approval-sla-performance
// Per person owing approvals: how many of their current waits are within vs past SLA,
// plus how often they've been reminded/escalated in the last 30 days (from the log).
router.get("/dashboard/approval-sla-performance", async (_req, res): Promise<void> => {
  const focus = await collectFocusStages();
  const byPerson = new Map<string, { person: { id: number | null; name: string } | null; role: string; totalWaiting: number; overdueWaiting: number; remindersReceived: number; escalationsReceived: number }>();
  for (const f of focus) {
    const w = f.stage.waitingOn;
    if (!w) continue;
    const key = personKey(w);
    const e = byPerson.get(key) ?? { person: w.person, role: w.role, totalWaiting: 0, overdueWaiting: 0, remindersReceived: 0, escalationsReceived: 0 };
    e.totalWaiting++;
    if (f.stage.daysOverdue > 0) e.overdueWaiting++;
    byPerson.set(key, e);
  }

  // Fold in the last 30 days of fired escalations, attributed by recipient user id.
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const logs = await db.select().from(escalationLogTable).where(gte(escalationLogTable.sentAt, since));
  for (const log of logs) {
    const ids = Array.isArray(log.recipientIds) ? (log.recipientIds as unknown[]).filter((x): x is number => typeof x === "number") : [];
    for (const id of ids) {
      const key = `u${id}`;
      const e = byPerson.get(key);
      if (!e) continue; // only attribute to people who are currently a bottleneck
      if (log.action === "escalate") e.escalationsReceived++; else e.remindersReceived++;
    }
  }

  const rows = [...byPerson.values()]
    .map((e) => ({ ...e, onTimePct: e.totalWaiting > 0 ? Math.round(((e.totalWaiting - e.overdueWaiting) / e.totalWaiting) * 100) : 100 }))
    .sort((a, b) => a.onTimePct - b.onTimePct || b.overdueWaiting - a.overdueWaiting);
  res.json(rows);
});

export default router;
