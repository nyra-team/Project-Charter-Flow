import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { db, nudgesTable, notificationsTable } from "@workspace/db";
import { and, eq, desc, inArray } from "drizzle-orm";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ─── Validation ─────────────────────────────────────────────────────────────

const ListQuery = z.object({
  userId: z.coerce.number().int(),
  status: z.enum(["active", "dismissed", "acted_on", "expired"]).optional(),
});

// ─── GET /api/nudges?userId=…&status=active ─────────────────────────────────

router.get("/nudges", async (req, res): Promise<void> => {
  const parsed = ListQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { userId, status } = parsed.data;
  const conds = [eq(nudgesTable.userId, userId)];
  if (status) conds.push(eq(nudgesTable.status, status));
  const rows = await db
    .select()
    .from(nudgesTable)
    .where(and(...conds))
    .orderBy(desc(nudgesTable.createdAt));
  res.json(rows);
});

// ─── POST /api/nudges/:id/dismiss ───────────────────────────────────────────
// Flips status → 'dismissed' and stamps the timestamp. Also marks the
// mirrored notification as read so the bell badge clears in step.

router.post("/nudges/:id/dismiss", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [nudge] = await db.select().from(nudgesTable).where(eq(nudgesTable.id, id));
  if (!nudge) {
    res.status(404).json({ error: "Nudge not found" });
    return;
  }
  if (nudge.status !== "active") {
    res.status(409).json({ error: `Nudge is ${nudge.status}; only active nudges can be dismissed.` });
    return;
  }
  const [updated] = await db
    .update(nudgesTable)
    .set({ status: "dismissed", dismissedAt: new Date() } as never)
    .where(eq(nudgesTable.id, id))
    .returning();

  // Clear the mirror notification too — same user, same link, type prefix
  // 'nudge_'. Idempotent: if there's no match (manually deleted), no-op.
  await db
    .update(notificationsTable)
    .set({ isRead: true })
    .where(
      and(
        eq(notificationsTable.userId, nudge.userId),
        eq(notificationsTable.type, `nudge_${nudge.kind}`),
        eq(notificationsTable.relatedEntityType, nudge.sourceEntityType ?? ""),
        eq(notificationsTable.relatedEntityId, nudge.sourceEntityId ?? -1),
      ),
    );

  res.json(updated);
});

// ─── POST /api/nudges/:id/acted-on ──────────────────────────────────────────
// Same as dismiss but records that the user actually did the thing.
// Useful signal for future "this kind drives action" tuning.

router.post("/nudges/:id/acted-on", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [nudge] = await db.select().from(nudgesTable).where(eq(nudgesTable.id, id));
  if (!nudge) {
    res.status(404).json({ error: "Nudge not found" });
    return;
  }
  if (nudge.status !== "active") {
    res.status(409).json({ error: `Nudge is ${nudge.status}; only active nudges can be acted on.` });
    return;
  }
  const [updated] = await db
    .update(nudgesTable)
    .set({ status: "acted_on", actedOnAt: new Date() } as never)
    .where(eq(nudgesTable.id, id))
    .returning();

  await db
    .update(notificationsTable)
    .set({ isRead: true })
    .where(
      and(
        eq(notificationsTable.userId, nudge.userId),
        eq(notificationsTable.type, `nudge_${nudge.kind}`),
        eq(notificationsTable.relatedEntityType, nudge.sourceEntityType ?? ""),
        eq(notificationsTable.relatedEntityId, nudge.sourceEntityId ?? -1),
      ),
    );

  res.json(updated);
});

// ─── POST /api/nudges/bulk-dismiss ──────────────────────────────────────────
// Used by the "✨ Nudges" segment's "Dismiss all" affordance.

const BulkDismissBody = z.object({
  ids: z.array(z.number().int()).min(1).max(200),
});

router.post("/nudges/bulk-dismiss", async (req, res): Promise<void> => {
  const parsed = BulkDismissBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  await db
    .update(nudgesTable)
    .set({ status: "dismissed", dismissedAt: new Date() } as never)
    .where(and(inArray(nudgesTable.id, parsed.data.ids), eq(nudgesTable.status, "active")));
  res.json({ success: true, dismissed: parsed.data.ids.length });
});

export default router;

// ════════════════════════════════════════════════════════════════════════════
// JOBS DEBUG ROUTER — separate export so it can be mounted only when the
// scheduler is enabled. Lets QA fire a job on demand without waiting for the
// next cron tick.
// ════════════════════════════════════════════════════════════════════════════

import { listJobs, runJobNow } from "../lib/scheduler";

export const jobsRouter: IRouter = Router();

jobsRouter.get("/jobs", (req, res) => {
  // Only super-admins should see the job dashboard.
  if (!req.user?.isSuperAdmin) {
    res.status(403).json({ error: "Super-admin only" });
    return;
  }
  res.json(listJobs());
});

jobsRouter.post("/jobs/run/:name", async (req, res): Promise<void> => {
  if (!req.user?.isSuperAdmin) {
    res.status(403).json({ error: "Super-admin only" });
    return;
  }
  const name = req.params.name;
  logger.info({ name, actor: req.user.email }, "jobs.run: manual trigger");
  const result = await runJobNow(name);
  if (!result.ok) {
    res.status(400).json(result);
    return;
  }
  res.json(result);
});
