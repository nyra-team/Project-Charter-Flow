import { Router, type IRouter } from "express";
import { db, chartersTable, approvalsTable, projectsTable, tasksTable, milestonesTable, usersTable, risksTable, scoringCriteriaTable, projectScoresTable, resourceAllocationsTable } from "@workspace/db";
import { eq, ne } from "drizzle-orm";
import { getRecentActivityWithUsers } from "./activity";

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

  // Role-scoped pending count: each role only sees stages relevant to them
  const sessionRole = req.session?.simulatedRole ?? "initiator";
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

export default router;
