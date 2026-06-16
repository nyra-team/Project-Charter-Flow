import { Router, type IRouter } from "express";
import { db, stageSlasTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { STAGE_META } from "../lib/stage-gates";
import { requireRole } from "../lib/guard";

const router: IRouter = Router();

// Sub-gate keys are "<stage>.<subgate>" (e.g. initiation.business_case).
const SUBGATE_LABELS: Record<string, string> = {
  business_case: "Business Case",
  urs: "URS",
};
function slaLabel(stageKey: string): string {
  if (stageKey.includes(".")) {
    const [parent, sub] = stageKey.split(".");
    return `${STAGE_META[parent]?.label ?? parent} · ${SUBGATE_LABELS[sub] ?? sub}`;
  }
  return STAGE_META[stageKey]?.label ?? stageKey;
}

// List all stage SLAs (admin-editable target durations driving "days overdue").
router.get("/stage-slas", async (_req, res): Promise<void> => {
  const rows = await db.select().from(stageSlasTable);
  // Return in canonical lifecycle order; sub-gate rows sort right after their parent stage.
  const order = Object.keys(STAGE_META);
  const rank = (k: string) => {
    const parent = k.split(".")[0];
    return order.indexOf(parent) * 10 + (k.includes(".") ? 1 : 0);
  };
  const sorted = rows
    .map((r) => ({ ...r, label: slaLabel(r.stage) }))
    .sort((a, b) => rank(a.stage) - rank(b.stage));
  res.json(sorted);
});

// Update a stage SLA's target days / active flag.
router.patch("/stage-slas/:stage", requireRole("pmo"), async (req, res): Promise<void> => {
  const { stage } = req.params;
  const { targetDays, isActive } = (req.body ?? {}) as { targetDays?: number; isActive?: boolean };
  const update: Record<string, unknown> = {};
  if (targetDays != null) {
    if (!Number.isFinite(targetDays) || targetDays < 0) { res.status(400).json({ error: "targetDays must be a non-negative number" }); return; }
    update.targetDays = Math.round(targetDays);
  }
  if (isActive != null) update.isActive = !!isActive;
  if (Object.keys(update).length === 0) { res.status(400).json({ error: "Nothing to update" }); return; }
  const [row] = await db.update(stageSlasTable).set(update).where(eq(stageSlasTable.stage, stage)).returning();
  if (!row) { res.status(404).json({ error: `Unknown stage: ${stage}` }); return; }
  res.json(row);
});

export default router;
