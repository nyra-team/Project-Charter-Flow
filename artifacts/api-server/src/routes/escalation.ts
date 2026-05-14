import { Router, type IRouter } from "express";
import { db, escalationRulesTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

const router: IRouter = Router();

router.get("/escalation-rules", async (req, res): Promise<void> => {
  const projectId = req.query.projectId ? parseInt(req.query.projectId as string) : undefined;
  const query = db.select().from(escalationRulesTable);
  const rules = projectId
    ? await query.where(eq(escalationRulesTable.projectId, projectId)).orderBy(desc(escalationRulesTable.createdAt))
    : await query.orderBy(desc(escalationRulesTable.createdAt));
  res.json(rules);
});

router.post("/escalation-rules", async (req, res): Promise<void> => {
  const { projectId, triggerType, thresholdValue, notifyUserIds, isActive } = req.body as {
    projectId?: number; triggerType: string; thresholdValue?: number; notifyUserIds?: unknown[]; isActive?: boolean;
  };
  if (!triggerType) { res.status(400).json({ error: "triggerType is required" }); return; }
  const [rule] = await db.insert(escalationRulesTable).values({
    projectId,
    triggerType,
    thresholdValue: thresholdValue != null ? String(thresholdValue) : "0",
    notifyUserIds: notifyUserIds ?? [],
    isActive: isActive ?? true,
  }).returning();
  res.status(201).json(rule);
});

router.patch("/escalation-rules/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const updateData: Record<string, unknown> = {};
  if (req.body.triggerType !== undefined) updateData.triggerType = req.body.triggerType;
  if (req.body.thresholdValue !== undefined) updateData.thresholdValue = String(req.body.thresholdValue);
  if (req.body.notifyUserIds !== undefined) updateData.notifyUserIds = req.body.notifyUserIds;
  if (req.body.isActive !== undefined) updateData.isActive = req.body.isActive;
  const [rule] = await db.update(escalationRulesTable).set(updateData).where(eq(escalationRulesTable.id, id)).returning();
  if (!rule) { res.status(404).json({ error: "Escalation rule not found" }); return; }
  res.json(rule);
});

router.delete("/escalation-rules/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(escalationRulesTable).where(eq(escalationRulesTable.id, id));
  res.sendStatus(204);
});

export default router;
