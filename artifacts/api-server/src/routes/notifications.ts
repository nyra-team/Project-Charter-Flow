import { Router, type IRouter } from "express";
import { db, notificationsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";

const router: IRouter = Router();

router.get("/notifications", async (req, res): Promise<void> => {
  const userId = req.query.userId ? parseInt(req.query.userId as string) : undefined;
  const query = db.select().from(notificationsTable);
  const notifications = userId
    ? await query.where(eq(notificationsTable.userId, userId)).orderBy(desc(notificationsTable.createdAt))
    : await query.orderBy(desc(notificationsTable.createdAt));
  res.json(notifications);
});

router.patch("/notifications/:id/read", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [notification] = await db.update(notificationsTable).set({ isRead: true }).where(eq(notificationsTable.id, id)).returning();
  if (!notification) { res.status(404).json({ error: "Notification not found" }); return; }
  res.json(notification);
});

router.post("/notifications/mark-all-read", async (req, res): Promise<void> => {
  const { userId } = req.body as { userId: number };
  if (!userId) { res.status(400).json({ error: "userId is required" }); return; }
  await db.update(notificationsTable).set({ isRead: true }).where(and(eq(notificationsTable.userId, userId), eq(notificationsTable.isRead, false)));
  res.json({ success: true });
});

router.post("/notifications", async (req, res): Promise<void> => {
  const { userId, type, title, body, link, relatedEntityType, relatedEntityId } = req.body as {
    userId: number; type: string; title: string; body?: string; link?: string; relatedEntityType?: string; relatedEntityId?: number;
  };
  if (!userId || !type || !title) { res.status(400).json({ error: "userId, type, and title are required" }); return; }
  const [notification] = await db.insert(notificationsTable).values({ userId, type, title, body, link, relatedEntityType, relatedEntityId }).returning();
  res.status(201).json(notification);
});

export default router;
