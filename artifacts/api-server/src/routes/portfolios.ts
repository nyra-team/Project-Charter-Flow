import { Router, type IRouter } from "express";
import { db, portfoliosTable, programsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

const router: IRouter = Router();

router.get("/portfolios", async (_req, res): Promise<void> => {
  const portfolios = await db.select().from(portfoliosTable).orderBy(desc(portfoliosTable.createdAt));
  res.json(portfolios);
});

router.post("/portfolios", async (req, res): Promise<void> => {
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
  res.json(portfolio);
});

router.patch("/portfolios/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { name, description, ownerId } = req.body as { name?: string; description?: string; ownerId?: number };
  const [portfolio] = await db.update(portfoliosTable).set({ name, description, ownerId }).where(eq(portfoliosTable.id, id)).returning();
  if (!portfolio) { res.status(404).json({ error: "Portfolio not found" }); return; }
  res.json(portfolio);
});

router.delete("/portfolios/:id", async (req, res): Promise<void> => {
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

router.post("/programs", async (req, res): Promise<void> => {
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

router.patch("/programs/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { name, description, portfolioId, ownerId } = req.body as { name?: string; description?: string; portfolioId?: number; ownerId?: number };
  const [program] = await db.update(programsTable).set({ name, description, portfolioId, ownerId }).where(eq(programsTable.id, id)).returning();
  if (!program) { res.status(404).json({ error: "Program not found" }); return; }
  res.json(program);
});

router.delete("/programs/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(programsTable).where(eq(programsTable.id, id));
  res.sendStatus(204);
});

export default router;
