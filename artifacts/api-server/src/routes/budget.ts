import { Router, type IRouter } from "express";
import { db, budgetLinesTable, projectsTable, approvalsTable, usersTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { logActivity } from "./activity";

const router: IRouter = Router();

function computeVariance(baselineAmount: number, actualAmount: number) {
  const variance = actualAmount - baselineAmount;
  const variancePct = baselineAmount !== 0 ? (variance / baselineAmount) * 100 : 0;
  return { varianceAmount: Math.round(variance * 100) / 100, variancePct: Math.round(variancePct * 100) / 100 };
}

function serializeLine(l: typeof budgetLinesTable.$inferSelect) {
  const baseline = Number(l.baselineAmount);
  const actual = Number(l.actualAmount);
  const { varianceAmount, variancePct } = computeVariance(baseline, actual);
  return {
    ...l,
    baselineAmount: baseline,
    forecastAmount: Number(l.forecastAmount),
    actualAmount: actual,
    varianceAmount,
    variancePct,
  };
}

/**
 * Backend-automatic NFA overrun detection.
 * Called after every budget line write. If actual spend exceeds the project's
 * configured threshold and no approval chain exists yet, one is created
 * automatically in the correct order: hod → scm → cfo → chairman.
 * This is idempotent — will not create duplicate chains.
 */
async function checkAndCreateNFAChainIfTriggered(projectId: number): Promise<void> {
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project?.charterId) return;

  const lines = await db.select().from(budgetLinesTable).where(eq(budgetLinesTable.projectId, projectId));
  const totalBaseline = lines.reduce((sum, l) => sum + Number(l.baselineAmount ?? 0), 0);
  const totalActual = lines.reduce((sum, l) => sum + Number(l.actualAmount ?? 0), 0);
  const thresholdPct = Number(project.budgetThresholdPct ?? 10);

  if (totalBaseline <= 0) return;
  const overrunPct = ((totalActual - totalBaseline) / totalBaseline) * 100;
  if (overrunPct <= thresholdPct) return;

  // Idempotency: do not recreate chain if it already exists
  const existing = await db.select()
    .from(approvalsTable)
    .where(and(
      eq(approvalsTable.charterId, project.charterId),
      eq(approvalsTable.stage, "nfa_overrun"),
    ));
  if (existing.length > 0) return;

  // Create chain in mandatory order: Functional Head → SCM Head → CFO → Management
  const nfaRoles = ["hod", "scm", "cfo", "chairman"] as const;
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
        comments: `NFA budget overrun automatically detected: actual exceeds baseline by ${overrunPct.toFixed(1)}% (threshold ${thresholdPct}%). Approval required from ${roleKey}.`,
      });
    }
  }

  await logActivity(
    "nfa_overrun_triggered",
    `NFA budget overrun auto-triggered for project ${projectId}: ${overrunPct.toFixed(1)}% over baseline (threshold ${thresholdPct}%). Approval chain (${nfaRoles.join(" → ")}) created automatically.`,
    projectId,
    "project",
  );
}

router.get("/projects/:id/budget-lines", async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const lines = await db.select().from(budgetLinesTable).where(eq(budgetLinesTable.projectId, projectId)).orderBy(desc(budgetLinesTable.createdAt));
  res.json(lines.map(serializeLine));
});

router.post("/projects/:id/budget-lines", async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { category, description, baselineAmount, forecastAmount, actualAmount, period } = req.body as {
    category?: string; description?: string; baselineAmount?: number; forecastAmount?: number; actualAmount?: number; period?: string;
  };
  const baseline = baselineAmount ?? 0;
  const actual = actualAmount ?? 0;
  const { varianceAmount, variancePct } = computeVariance(baseline, actual);
  const [line] = await db.insert(budgetLinesTable).values({
    projectId,
    category: category ?? "OpEx",
    description,
    baselineAmount: String(baseline),
    forecastAmount: String(forecastAmount ?? 0),
    actualAmount: String(actual),
    varianceAmount: String(varianceAmount),
    variancePct: String(variancePct),
    period,
  }).returning();
  // Auto-trigger NFA chain creation if budget overrun threshold is breached
  await checkAndCreateNFAChainIfTriggered(projectId);
  res.status(201).json(serializeLine(line));
});

router.patch("/budget-lines/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const updateData: Record<string, unknown> = {};
  if (req.body.category !== undefined) updateData.category = req.body.category;
  if (req.body.description !== undefined) updateData.description = req.body.description;
  if (req.body.baselineAmount !== undefined) updateData.baselineAmount = String(req.body.baselineAmount);
  if (req.body.forecastAmount !== undefined) updateData.forecastAmount = String(req.body.forecastAmount);
  if (req.body.actualAmount !== undefined) updateData.actualAmount = String(req.body.actualAmount);
  if (req.body.period !== undefined) updateData.period = req.body.period;

  const [existing] = await db.select().from(budgetLinesTable).where(eq(budgetLinesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Budget line not found" }); return; }
  const baseline = req.body.baselineAmount != null ? Number(req.body.baselineAmount) : Number(existing.baselineAmount);
  const actual = req.body.actualAmount != null ? Number(req.body.actualAmount) : Number(existing.actualAmount);
  const { varianceAmount, variancePct } = computeVariance(baseline, actual);
  updateData.varianceAmount = String(varianceAmount);
  updateData.variancePct = String(variancePct);

  const [line] = await db.update(budgetLinesTable).set(updateData).where(eq(budgetLinesTable.id, id)).returning();
  // Auto-trigger NFA chain creation if budget overrun threshold is now breached
  await checkAndCreateNFAChainIfTriggered(existing.projectId);
  res.json(serializeLine(line));
});

router.delete("/budget-lines/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(budgetLinesTable).where(eq(budgetLinesTable.id, id));
  res.sendStatus(204);
});

export default router;
