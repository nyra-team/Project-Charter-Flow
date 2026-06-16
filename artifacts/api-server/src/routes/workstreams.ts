import { Router, type IRouter } from "express";
import { db, workstreamsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireRole } from "../lib/guard";

const router: IRouter = Router();

const WRITE_ROLES = ["pm", "pmo", "hod", "initiator"];

router.get("/projects/:id/workstreams", async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const workstreams = await db.select().from(workstreamsTable).where(eq(workstreamsTable.projectId, projectId)).orderBy(workstreamsTable.order);
  res.json(workstreams);
});

router.post("/projects/:id/workstreams", requireRole(...WRITE_ROLES), async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { name, description, order, parentWorkstreamId } = req.body as { name: string; description?: string; order?: number; parentWorkstreamId?: number };
  if (!name) { res.status(400).json({ error: "name is required" }); return; }
  const [workstream] = await db.insert(workstreamsTable).values({ projectId, name, description, order: order ?? 0, parentWorkstreamId }).returning();
  res.status(201).json(workstream);
});

router.patch("/workstreams/:id", requireRole(...WRITE_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { name, description, order, parentWorkstreamId } = req.body as { name?: string; description?: string; order?: number; parentWorkstreamId?: number };
  const [workstream] = await db.update(workstreamsTable).set({ name, description, order, parentWorkstreamId }).where(eq(workstreamsTable.id, id)).returning();
  if (!workstream) { res.status(404).json({ error: "Workstream not found" }); return; }
  res.json(workstream);
});

router.delete("/workstreams/:id", requireRole("pmo", "pm"), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(workstreamsTable).where(eq(workstreamsTable.id, id));
  res.sendStatus(204);
});

export default router;
