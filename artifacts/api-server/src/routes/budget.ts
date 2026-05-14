import { Router, type IRouter } from "express";
import { db, budgetLinesTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

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

  // Recompute variance if baseline or actual changed
  const [existing] = await db.select().from(budgetLinesTable).where(eq(budgetLinesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Budget line not found" }); return; }
  const baseline = req.body.baselineAmount != null ? Number(req.body.baselineAmount) : Number(existing.baselineAmount);
  const actual = req.body.actualAmount != null ? Number(req.body.actualAmount) : Number(existing.actualAmount);
  const { varianceAmount, variancePct } = computeVariance(baseline, actual);
  updateData.varianceAmount = String(varianceAmount);
  updateData.variancePct = String(variancePct);

  const [line] = await db.update(budgetLinesTable).set(updateData).where(eq(budgetLinesTable.id, id)).returning();
  res.json(serializeLine(line));
});

router.delete("/budget-lines/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(budgetLinesTable).where(eq(budgetLinesTable.id, id));
  res.sendStatus(204);
});

export default router;
