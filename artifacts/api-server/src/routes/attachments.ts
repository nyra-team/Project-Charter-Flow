import { Router, type IRouter } from "express";
import { db, attachmentsTable, documentsTable } from "@workspace/db";
import { and, eq, desc, isNull, isNotNull, sql } from "drizzle-orm";

const router: IRouter = Router();

// GET /api/attachments/counts — per-project file count for the projects-table
// paperclip badge: project-general attachments (task_id AND milestone_id both
// NULL — milestone-general files carry their own badge on the milestone
// header) + uploaded repository documents that have a file, since the
// project-level popover lists both.
router.get("/attachments/counts", async (_req, res): Promise<void> => {
  const attRows = await db
    .select({ projectId: attachmentsTable.projectId, count: sql<number>`count(*)::int` })
    .from(attachmentsTable)
    .where(and(isNull(attachmentsTable.taskId), isNull(attachmentsTable.milestoneId)))
    .groupBy(attachmentsTable.projectId);
  const docRows = await db
    .select({ projectId: documentsTable.projectId, count: sql<number>`count(*)::int` })
    .from(documentsTable)
    .where(isNotNull(documentsTable.fileUrl))
    .groupBy(documentsTable.projectId);
  const total = new Map<number, number>();
  for (const r of [...attRows, ...docRows]) total.set(r.projectId, (total.get(r.projectId) ?? 0) + r.count);
  res.json([...total.entries()].map(([projectId, count]) => ({ projectId, count })));
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
