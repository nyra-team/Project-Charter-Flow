import { Router, type IRouter } from "express";
import { db, messagesTable, usersTable } from "@workspace/db";
import { eq, desc, inArray, isNull, sql } from "drizzle-orm";
import { notifyDetached } from "../lib/notify";

const router: IRouter = Router();

// GET /api/messages/counts — per-project count of project-level comments
// (task_id IS NULL, matching what the project comms drawer shows) for the
// projects-table Comments column badge. One bulk call, mirrors
// /api/attachments/counts. Registered before /messages/:id (different verb, so
// no shadowing) — keep it a GET.
router.get("/messages/counts", async (_req, res): Promise<void> => {
  const rows = await db
    .select({ projectId: messagesTable.projectId, count: sql<number>`count(*)::int` })
    .from(messagesTable)
    .where(isNull(messagesTable.taskId))
    .groupBy(messagesTable.projectId);
  res.json(rows.map((r) => ({ projectId: r.projectId, count: r.count })));
});

// GET /api/messages/latest?taskIds=1,2,3 — the single newest task-level comment
// (update) per task, for the portfolio "this / next week" Gantt that shows each
// task's latest update inline. Bulk (one call for many tasks); mirrors
// /messages/counts. DISTINCT ON (task_id) ORDER BY created_at DESC = latest row.
router.get("/messages/latest", async (req, res): Promise<void> => {
  const raw = String(req.query.taskIds ?? "").trim();
  const taskIds = raw ? raw.split(",").map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n)) : [];
  if (taskIds.length === 0) { res.json([]); return; }
  const rows = await db
    .selectDistinctOn([messagesTable.taskId], {
      taskId: messagesTable.taskId,
      body: messagesTable.body,
      senderId: messagesTable.senderId,
      senderName: usersTable.name,
      createdAt: messagesTable.createdAt,
    })
    .from(messagesTable)
    .leftJoin(usersTable, eq(usersTable.id, messagesTable.senderId))
    .where(inArray(messagesTable.taskId, taskIds))
    .orderBy(messagesTable.taskId, desc(messagesTable.createdAt));
  res.json(rows);
});

router.get("/projects/:id/messages", async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const messages = await db.select().from(messagesTable).where(eq(messagesTable.projectId, projectId)).orderBy(desc(messagesTable.createdAt));
  res.json(messages);
});

router.post("/projects/:id/messages", async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { senderId, body, taskId, milestoneId, attachments, taggedUserIds, threadParentId } = req.body as {
    senderId: number; body: string; taskId?: number; milestoneId?: number;
    attachments?: unknown[]; taggedUserIds?: unknown[]; threadParentId?: number;
  };
  if (!senderId || !body) { res.status(400).json({ error: "senderId and body are required" }); return; }
  const tagged = (taggedUserIds ?? []).map(Number).filter((n) => Number.isFinite(n) && n !== senderId);
  const [message] = await db.insert(messagesTable).values({
    projectId, senderId, body, taskId, milestoneId,
    attachments: attachments ?? [],
    taggedUserIds: tagged,
    threadParentId,
  }).returning();
  res.status(201).json(message);

  // Notify mentioned people — in-app bell + branded email (best-effort, after response).
  if (tagged.length) {
    void (async () => {
      const [sender] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, senderId));
      const recipients = await db
        .select({ userId: usersTable.id, name: usersTable.name, email: usersTable.email })
        .from(usersTable).where(inArray(usersTable.id, tagged));
      const who = sender?.name ?? "Someone";
      const snippet = body.length > 140 ? `${body.slice(0, 140)}…` : body;
      notifyDetached({
        projectId,
        type: "mention",
        title: `${who} mentioned you in a comment`,
        body: snippet,
        link: `/projects/${projectId}`,
        relatedEntityType: taskId ? "task" : "project",
        relatedEntityId: taskId ?? projectId,
        recipients,
      });
    })().catch(() => {});
  }
});

router.patch("/messages/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { body, attachments, taggedUserIds } = req.body as { body?: string; attachments?: unknown[]; taggedUserIds?: unknown[] };
  const updateData: Record<string, unknown> = {};
  if (body !== undefined) updateData.body = body;
  if (attachments !== undefined) updateData.attachments = attachments;
  if (taggedUserIds !== undefined) updateData.taggedUserIds = taggedUserIds;
  const [message] = await db.update(messagesTable).set(updateData).where(eq(messagesTable.id, id)).returning();
  if (!message) { res.status(404).json({ error: "Message not found" }); return; }
  res.json(message);
});

router.delete("/messages/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(messagesTable).where(eq(messagesTable.id, id));
  res.sendStatus(204);
});

export default router;
