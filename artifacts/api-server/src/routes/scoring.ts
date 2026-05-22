import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db, scoringCriteriaTable, projectScoresTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

const router: IRouter = Router();

const PMO_ROLES = new Set(["pmo", "executive_director", "chairman"]);

function requirePMORole(req: Request, res: Response, next: NextFunction): void {
  const role = req.session?.simulatedRole;
  if (!role || !PMO_ROLES.has(role)) {
    res.status(403).json({ error: "Forbidden: PMO, Executive Director, or Chairman role required" });
    return;
  }
  next();
}

async function computeWeightedScore(criterionId: number, score: number): Promise<number> {
  const [criterion] = await db.select().from(scoringCriteriaTable).where(eq(scoringCriteriaTable.id, criterionId));
  if (!criterion) return 0;
  return Math.round(score * Number(criterion.weightPct) / 100 * 10000) / 10000;
}

// Scoring criteria
router.get("/scoring-criteria", async (_req, res): Promise<void> => {
  const criteria = await db.select().from(scoringCriteriaTable).where(eq(scoringCriteriaTable.isActive, true)).orderBy(desc(scoringCriteriaTable.createdAt));
  res.json(criteria.map(c => ({ ...c, weightPct: Number(c.weightPct) })));
});

router.post("/scoring-criteria", requirePMORole, async (req, res): Promise<void> => {
  const { name, weightPct, description, isActive } = req.body as { name: string; weightPct?: number; description?: string; isActive?: boolean };
  if (!name) { res.status(400).json({ error: "name is required" }); return; }
  const newWeight = weightPct ?? 0;
  if (newWeight < 0 || newWeight > 100) { res.status(400).json({ error: "weightPct must be between 0 and 100" }); return; }
  const existing = await db.select().from(scoringCriteriaTable).where(eq(scoringCriteriaTable.isActive, true));
  const currentTotal = existing.reduce((s, c) => s + Number(c.weightPct), 0);
  if (currentTotal + newWeight > 100) {
    res.status(400).json({ error: `Adding this criterion would exceed 100% total weight (current: ${currentTotal.toFixed(0)}%, adding: ${newWeight}%)` });
    return;
  }
  const [criterion] = await db.insert(scoringCriteriaTable).values({
    name,
    weightPct: String(newWeight),
    description,
    isActive: isActive ?? true,
  }).returning();
  res.status(201).json({ ...criterion, weightPct: Number(criterion.weightPct) });
});

router.get("/scoring-criteria/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [criterion] = await db.select().from(scoringCriteriaTable).where(eq(scoringCriteriaTable.id, id));
  if (!criterion) { res.status(404).json({ error: "Scoring criterion not found" }); return; }
  res.json({ ...criterion, weightPct: Number(criterion.weightPct) });
});

router.patch("/scoring-criteria/:id", requirePMORole, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (req.body.weightPct !== undefined) {
    const newWeight = Number(req.body.weightPct);
    if (newWeight < 0 || newWeight > 100) { res.status(400).json({ error: "weightPct must be between 0 and 100" }); return; }
    const existing = await db.select().from(scoringCriteriaTable).where(eq(scoringCriteriaTable.isActive, true));
    const otherTotal = existing.filter(c => c.id !== id).reduce((s, c) => s + Number(c.weightPct), 0);
    if (otherTotal + newWeight > 100) {
      res.status(400).json({ error: `Weight would exceed 100% total (others: ${otherTotal.toFixed(0)}%, this: ${newWeight}%)` });
      return;
    }
  }
  const updateData: Record<string, unknown> = {};
  if (req.body.name !== undefined) updateData.name = req.body.name;
  if (req.body.weightPct !== undefined) updateData.weightPct = String(req.body.weightPct);
  if (req.body.description !== undefined) updateData.description = req.body.description;
  if (req.body.isActive !== undefined) updateData.isActive = req.body.isActive;
  const [criterion] = await db.update(scoringCriteriaTable).set(updateData).where(eq(scoringCriteriaTable.id, id)).returning();
  if (!criterion) { res.status(404).json({ error: "Scoring criterion not found" }); return; }
  res.json({ ...criterion, weightPct: Number(criterion.weightPct) });
});

router.delete("/scoring-criteria/:id", requirePMORole, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(scoringCriteriaTable).where(eq(scoringCriteriaTable.id, id));
  res.sendStatus(204);
});

// Project scores
router.get("/projects/:id/scores", async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const scores = await db.select().from(projectScoresTable).where(eq(projectScoresTable.projectId, projectId));
  const criteria = await db.select().from(scoringCriteriaTable);
  const criteriaMap = Object.fromEntries(criteria.map(c => [c.id, c]));
  const enriched = scores.map(s => {
    const criterion = criteriaMap[s.criterionId];
    return { ...s, weightedScore: Number(s.weightedScore), criterionName: criterion?.name ?? null, criterionWeightPct: criterion ? Number(criterion.weightPct) : null };
  });
  res.json(enriched);
});

router.post("/projects/:id/scores", requirePMORole, async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.id as string);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { criterionId, score, notes } = req.body as { criterionId: number; score: number; notes?: string };
  if (!criterionId || score == null) { res.status(400).json({ error: "criterionId and score are required" }); return; }
  const weightedScore = await computeWeightedScore(criterionId, score);
  const [projectScore] = await db.insert(projectScoresTable).values({
    projectId, criterionId, score, notes, weightedScore: String(weightedScore),
  }).returning();
  res.status(201).json({ ...projectScore, weightedScore: Number(projectScore.weightedScore) });
});

router.patch("/project-scores/:id", requirePMORole, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [existing] = await db.select().from(projectScoresTable).where(eq(projectScoresTable.id, id));
  if (!existing) { res.status(404).json({ error: "Project score not found" }); return; }
  const score = req.body.score != null ? Number(req.body.score) : existing.score;
  const criterionId = req.body.criterionId != null ? Number(req.body.criterionId) : existing.criterionId;
  const weightedScore = await computeWeightedScore(criterionId, score);
  const updateData: Record<string, unknown> = { score, criterionId, weightedScore: String(weightedScore) };
  if (req.body.notes !== undefined) updateData.notes = req.body.notes;
  const [projectScore] = await db.update(projectScoresTable).set(updateData).where(eq(projectScoresTable.id, id)).returning();
  res.json({ ...projectScore, weightedScore: Number(projectScore.weightedScore) });
});

router.delete("/project-scores/:id", requirePMORole, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(projectScoresTable).where(eq(projectScoresTable.id, id));
  res.sendStatus(204);
});

export default router;
