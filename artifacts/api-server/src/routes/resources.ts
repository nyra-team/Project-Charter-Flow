import { Router, type IRouter } from "express";
import { db, resourceAllocationsTable, raciMatrixTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

function formatAllocation(a: typeof resourceAllocationsTable.$inferSelect) {
  return { ...a, allocationPct: a.allocationPct != null ? Number(a.allocationPct) : 100 };
}

router.get("/projects/:id/resource-allocations", async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const allocations = await db.select().from(resourceAllocationsTable).where(eq(resourceAllocationsTable.projectId, projectId));
  res.json(allocations.map(formatAllocation));
});

router.post("/projects/:id/resource-allocations", async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { userId, workstreamId, role, skill, allocationPct, startDate, endDate } = req.body as {
    userId: number; workstreamId?: number; role?: string; skill?: string;
    allocationPct?: number; startDate?: string; endDate?: string;
  };
  if (!userId) { res.status(400).json({ error: "userId is required" }); return; }
  const [allocation] = await db.insert(resourceAllocationsTable).values({
    projectId, userId, workstreamId, role, skill,
    allocationPct: allocationPct != null ? String(allocationPct) : "100",
    startDate, endDate,
  }).returning();
  res.status(201).json(formatAllocation(allocation));
});

router.patch("/resource-allocations/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const updateData: Record<string, unknown> = {};
  const fields = ["workstreamId", "role", "skill", "startDate", "endDate"];
  for (const f of fields) {
    if (req.body[f] !== undefined) updateData[f] = req.body[f];
  }
  if (req.body.allocationPct !== undefined) updateData.allocationPct = String(req.body.allocationPct);
  const [allocation] = await db.update(resourceAllocationsTable).set(updateData).where(eq(resourceAllocationsTable.id, id)).returning();
  if (!allocation) { res.status(404).json({ error: "Resource allocation not found" }); return; }
  res.json(formatAllocation(allocation));
});

router.delete("/resource-allocations/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(resourceAllocationsTable).where(eq(resourceAllocationsTable.id, id));
  res.sendStatus(204);
});

router.get("/projects/:id/raci", async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const raci = await db.select().from(raciMatrixTable).where(eq(raciMatrixTable.projectId, projectId));
  res.json(raci);
});

router.post("/projects/:id/raci", async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { userId, taskId, workstreamId, raciType } = req.body as { userId: number; taskId?: number; workstreamId?: number; raciType: string };
  if (!userId || !raciType) { res.status(400).json({ error: "userId and raciType are required" }); return; }
  // RASCI allowlist: Responsible, Accountable, Support, Consulted, Informed.
  const RACI_TYPES = ["R", "A", "S", "C", "I"];
  if (!RACI_TYPES.includes(raciType)) {
    res.status(400).json({ error: `Invalid raciType '${raciType}'. Allowed: ${RACI_TYPES.join(", ")}.` });
    return;
  }
  const [entry] = await db.insert(raciMatrixTable).values({ projectId, userId, taskId, workstreamId, raciType }).returning();
  res.status(201).json(entry);
});

router.delete("/raci/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(raciMatrixTable).where(eq(raciMatrixTable.id, id));
  res.sendStatus(204);
});

export default router;
