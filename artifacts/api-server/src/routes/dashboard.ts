import { Router, type IRouter } from "express";
import { db, chartersTable, approvalsTable, projectsTable, tasksTable, usersTable } from "@workspace/db";
import { eq, ne } from "drizzle-orm";
import { getRecentActivityWithUsers } from "./activity";

const router: IRouter = Router();

router.get("/dashboard/summary", async (_req, res): Promise<void> => {
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

  res.json({
    totalCharters: charters.length,
    pendingApprovals: pendingApprovals.length,
    activeProjects: projects.filter(p => p.status === "active").length,
    completedProjects: projects.filter(p => p.status === "completed").length,
    chartersByStatus: Object.entries(chartersByStatus).map(([status, count]) => ({ status, count })),
    totalBudgetApproved,
    projectHealth,
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

export default router;
