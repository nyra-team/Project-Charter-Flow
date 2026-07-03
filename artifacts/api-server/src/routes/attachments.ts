import { Router, type IRouter } from "express";
import { db, attachmentsTable } from "@workspace/db";
import { eq, desc, isNull, sql } from "drizzle-orm";

const router: IRouter = Router();

// GET /api/attachments/counts — project-level attachment count per project
// (task_id IS NULL). One query powers the paperclip badge on the projects table.
router.get("/attachments/counts", async (_req, res): Promise<void> => {
  const rows = await db
    .select({ projectId: attachmentsTable.projectId, count: sql<number>`count(*)::int` })
    .from(attachmentsTable)
    .where(isNull(attachmentsTable.taskId))
    .groupBy(attachmentsTable.projectId);
  res.json(rows);
});

// GET /api/projects/:id/attachments — every attachment for a project (project,
// task and subtask level). The frontend groups them milestone → task → subtask.
router.get("/projects/:id/attachments", async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const rows = await db.select().from(attachmentsTable)
    .where(eq(attachmentsTable.projectId, projectId))
    .orderBy(desc(attachmentsTable.createdAt));
  res.json(rows);
});

// POST /api/projects/:id/attachments — clip an uploaded file onto a project,
// task or subtask. taskId null = project-level; milestoneId carried for grouping.
router.post("/projects/:id/attachments", async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { milestoneId, taskId, fileUrl, fileName, fileType, fileSize, uploadedBy } = req.body as {
    milestoneId?: number | null; taskId?: number | null; fileUrl?: string; fileName?: string;
    fileType?: string | null; fileSize?: number | null; uploadedBy?: number | null;
  };
  if (!fileUrl || !fileName) { res.status(400).json({ error: "fileUrl and fileName are required" }); return; }
  const [row] = await db.insert(attachmentsTable).values({
    projectId, milestoneId: milestoneId ?? null, taskId: taskId ?? null,
    fileUrl, fileName, fileType: fileType ?? null, fileSize: fileSize ?? null, uploadedBy: uploadedBy ?? null,
  }).returning();
  res.status(201).json(row);
});

// DELETE /api/attachments/:id
router.delete("/attachments/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(attachmentsTable).where(eq(attachmentsTable.id, id));
  res.sendStatus(204);
});

export default router;
