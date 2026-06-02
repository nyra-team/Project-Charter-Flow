import { Router, type IRouter } from "express";
import { db, stageEscalationPolicyTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { STAGE_META } from "../lib/stage-gates";

const router: IRouter = Router();

const ACTIONS = new Set(["remind", "escalate"]);

// List the global escalation ladder, sorted by lifecycle stage order then tier.
router.get("/stage-escalation-policy", async (_req, res): Promise<void> => {
  const rows = await db.select().from(stageEscalationPolicyTable)
    .orderBy(asc(stageEscalationPolicyTable.tier));
  const order = Object.keys(STAGE_META);
  const sorted = rows
    .map((r) => ({ ...r, stageLabel: STAGE_META[r.stage]?.label ?? r.stage }))
    .sort((a, b) => (order.indexOf(a.stage) - order.indexOf(b.stage)) || (a.tier - b.tier) || (a.afterDays - b.afterDays));
  res.json(sorted);
});

function validate(body: Record<string, unknown>): string | null {
  if (body.action != null && !ACTIONS.has(String(body.action))) return "action must be 'remind' or 'escalate'";
  if (body.afterDays != null && (!Number.isFinite(Number(body.afterDays)) || Number(body.afterDays) < 0)) return "afterDays must be a non-negative number";
  if (body.tier != null && (!Number.isFinite(Number(body.tier)) || Number(body.tier) < 1)) return "tier must be >= 1";
  return null;
}

router.post("/stage-escalation-policy", async (req, res): Promise<void> => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (!body.stage) { res.status(400).json({ error: "stage is required" }); return; }
  if (!body.targetRole) { res.status(400).json({ error: "targetRole is required" }); return; }
  const err = validate(body);
  if (err) { res.status(400).json({ error: err }); return; }
  const [row] = await db.insert(stageEscalationPolicyTable).values({
    stage: String(body.stage),
    subGateKey: body.subGateKey ? String(body.subGateKey) : null,
    tier: body.tier != null ? Math.round(Number(body.tier)) : 1,
    afterDays: body.afterDays != null ? Math.round(Number(body.afterDays)) : 0,
    action: body.action ? String(body.action) : "remind",
    targetRole: String(body.targetRole).trim().toLowerCase(),
    isActive: body.isActive != null ? !!body.isActive : true,
  }).returning();
  res.status(201).json(row);
});

router.patch("/stage-escalation-policy/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const err = validate(body);
  if (err) { res.status(400).json({ error: err }); return; }
  const update: Record<string, unknown> = {};
  if (body.tier != null) update.tier = Math.round(Number(body.tier));
  if (body.afterDays != null) update.afterDays = Math.round(Number(body.afterDays));
  if (body.action != null) update.action = String(body.action);
  if (body.targetRole != null) update.targetRole = String(body.targetRole).trim().toLowerCase();
  if (body.subGateKey !== undefined) update.subGateKey = body.subGateKey ? String(body.subGateKey) : null;
  if (body.isActive != null) update.isActive = !!body.isActive;
  if (Object.keys(update).length === 0) { res.status(400).json({ error: "Nothing to update" }); return; }
  const [row] = await db.update(stageEscalationPolicyTable).set(update).where(eq(stageEscalationPolicyTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Policy tier not found" }); return; }
  res.json(row);
});

router.delete("/stage-escalation-policy/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(stageEscalationPolicyTable).where(eq(stageEscalationPolicyTable.id, id));
  res.sendStatus(204);
});

export default router;
