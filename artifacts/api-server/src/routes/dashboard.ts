import { Router, type IRouter } from "express";
import { db, chartersTable, approvalsTable, projectsTable, activityTable, usersTable } from "@workspace/db";
import { eq, count } from "drizzle-orm";
import { getRecentActivityWithUsers } from "./activity";

const router: IRouter = Router();

router.get("/dashboard/summary", async (_req, res): Promise<void> => {
  const charters = await db.select().from(chartersTable);
  const projects = await db.select().from(projectsTable);
  const pendingApprovals = await db.select().from(approvalsTable).where(eq(approvalsTable.status, "pending"));

  const chartersByStatus: Record<string, number> = {};
  for (const c of charters) {
    chartersByStatus[c.status] = (chartersByStatus[c.status] ?? 0) + 1;
  }

  const projectsByStatus: Record<string, number> = {};
  for (const p of projects) {
    projectsByStatus[p.status] = (projectsByStatus[p.status] ?? 0) + 1;
  }

  const approvedCharters = charters.filter(c => ["approved", "active"].includes(c.status));
  const totalBudgetApproved = approvedCharters.reduce((sum, c) => {
    const budget = c.finalNegotiatedBudget ?? c.tentativeBudget;
    return sum + Number(budget ?? 0);
  }, 0);

  res.json({
    totalCharters: charters.length,
    pendingApprovals: pendingApprovals.length,
    activeProjects: projects.filter(p => p.status === "active").length,
    completedProjects: projects.filter(p => p.status === "completed").length,
    chartersByStatus: Object.entries(chartersByStatus).map(([status, count]) => ({ status, count })),
    projectsByStatus: Object.entries(projectsByStatus).map(([status, count]) => ({ status, count })),
    totalBudgetApproved,
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

export default router;
