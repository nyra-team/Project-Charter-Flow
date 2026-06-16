import { Router, type IRouter } from "express";
import { db, portfoliosTable, programsTable, projectsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireRole } from "../lib/guard";

const router: IRouter = Router();

const WRITE_ROLES = ["pm", "pmo", "hod", "initiator"];

interface PortfolioRollup {
  progress: number;
  projectCount: number;
  /** Member-project RAG counts (human-set per project; NEVER auto-derived). */
  ragDistribution: { red: number; amber: number; green: number };
  /** red + amber — quick "needs attention" count for exec rollup. */
  atRiskCount: number;
  /** Non-closed member projects whose end_date is in the past. */
  delayedCount: number;
}

// Portfolio-level rollup, computed on read (top of the chain: subtask -> task
// -> milestone -> project -> PORTFOLIO). `progress` = average of the member
// projects' (already-rolled-up) progress. RAG is aggregated by DISTRIBUTION
// only — portfolio RAG is never computed/overwritten; each project's RAG stays
// a human governance judgment. All fields are additive so existing consumers
// are unaffected.
async function withPortfolioRollup<T extends { id: number }>(rows: T[]): Promise<Array<T & PortfolioRollup>> {
  if (rows.length === 0) return [];
  const projects = await db
    .select({
      portfolioId: projectsTable.portfolioId,
      progress: projectsTable.progress,
      status: projectsTable.status,
      ragStatus: projectsTable.ragStatus,
      endDate: projectsTable.endDate,
    })
    .from(projectsTable);

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD, lexical compare ok
  const agg = new Map<number, { progress: number[]; red: number; amber: number; green: number; delayed: number }>();
  for (const p of projects) {
    if (p.portfolioId == null) continue;
    if (p.status === "closed") continue; // active portfolio health excludes closed work
    const a = agg.get(p.portfolioId) ?? { progress: [], red: 0, amber: 0, green: 0, delayed: 0 };
    a.progress.push(p.progress ?? 0);
    const rag = (p.ragStatus ?? "green").toLowerCase();
    if (rag === "red") a.red++;
    else if (rag === "amber" || rag === "yellow") a.amber++;
    else a.green++;
    if (p.endDate && p.endDate < today) a.delayed++;
    agg.set(p.portfolioId, a);
  }

  return rows.map((r) => {
    const a = agg.get(r.id) ?? { progress: [], red: 0, amber: 0, green: 0, delayed: 0 };
    const n = a.progress.length;
    return {
      ...r,
      projectCount: n,
      progress: n ? Math.round(a.progress.reduce((s, v) => s + v, 0) / n) : 0,
      ragDistribution: { red: a.red, amber: a.amber, green: a.green },
      atRiskCount: a.red + a.amber,
      delayedCount: a.delayed,
    };
  });
}

router.get("/portfolios", async (_req, res): Promise<void> => {
  const portfolios = await db.select().from(portfoliosTable).orderBy(desc(portfoliosTable.createdAt));
  res.json(await withPortfolioRollup(portfolios));
});

router.post("/portfolios", requireRole(...WRITE_ROLES), async (req, res): Promise<void> => {
  const { name, description, ownerId } = req.body as { name: string; description?: string; ownerId?: number };
  if (!name) { res.status(400).json({ error: "name is required" }); return; }
  const [portfolio] = await db.insert(portfoliosTable).values({ name, description, ownerId }).returning();
  res.status(201).json(portfolio);
});

router.get("/portfolios/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [portfolio] = await db.select().from(portfoliosTable).where(eq(portfoliosTable.id, id));
  if (!portfolio) { res.status(404).json({ error: "Portfolio not found" }); return; }
  const [enriched] = await withPortfolioRollup([portfolio]);
  res.json(enriched);
});

router.patch("/portfolios/:id", requireRole(...WRITE_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { name, description, ownerId } = req.body as { name?: string; description?: string; ownerId?: number };
  const [portfolio] = await db.update(portfoliosTable).set({ name, description, ownerId }).where(eq(portfoliosTable.id, id)).returning();
  if (!portfolio) { res.status(404).json({ error: "Portfolio not found" }); return; }
  res.json(portfolio);
});

router.delete("/portfolios/:id", requireRole("pmo", "pm"), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(portfoliosTable).where(eq(portfoliosTable.id, id));
  res.sendStatus(204);
});

router.get("/programs", async (req, res): Promise<void> => {
  const portfolioId = req.query.portfolioId ? parseInt(req.query.portfolioId as string) : undefined;
  const query = db.select().from(programsTable);
  const programs = portfolioId
    ? await query.where(eq(programsTable.portfolioId, portfolioId)).orderBy(desc(programsTable.createdAt))
    : await query.orderBy(desc(programsTable.createdAt));
  res.json(programs);
});

router.post("/programs", requireRole(...WRITE_ROLES), async (req, res): Promise<void> => {
  const { name, description, portfolioId, ownerId } = req.body as { name: string; description?: string; portfolioId?: number; ownerId?: number };
  if (!name) { res.status(400).json({ error: "name is required" }); return; }
  const [program] = await db.insert(programsTable).values({ name, description, portfolioId, ownerId }).returning();
  res.status(201).json(program);
});

router.get("/programs/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [program] = await db.select().from(programsTable).where(eq(programsTable.id, id));
  if (!program) { res.status(404).json({ error: "Program not found" }); return; }
  res.json(program);
});

router.patch("/programs/:id", requireRole(...WRITE_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { name, description, portfolioId, ownerId } = req.body as { name?: string; description?: string; portfolioId?: number; ownerId?: number };
  const [program] = await db.update(programsTable).set({ name, description, portfolioId, ownerId }).where(eq(programsTable.id, id)).returning();
  if (!program) { res.status(404).json({ error: "Program not found" }); return; }
  res.json(program);
});

router.delete("/programs/:id", requireRole("pmo", "pm"), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(programsTable).where(eq(programsTable.id, id));
  res.sendStatus(204);
});

export default router;
