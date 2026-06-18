import { Router, type IRouter } from "express";
import { db, messagesTable, usersTable } from "@workspace/db";
import { eq, desc, inArray } from "drizzle-orm";
import { notifyDetached } from "../lib/notify";

const router: IRouter = Router();

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
