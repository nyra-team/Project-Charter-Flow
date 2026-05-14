import { Router, type IRouter } from "express";
import { db, documentsTable, documentVersionsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

const router: IRouter = Router();

router.get("/projects/:id/documents", async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const docs = await db.select().from(documentsTable).where(eq(documentsTable.projectId, projectId)).orderBy(desc(documentsTable.createdAt));
  res.json(docs);
});

router.post("/projects/:id/documents", async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { name, stage, fileUrl, fileType, fileSize, uploadedBy, accessLevel, tags, description } = req.body as {
    name: string; stage?: string; fileUrl?: string; fileType?: string; fileSize?: number;
    uploadedBy?: number; accessLevel?: string; tags?: unknown[]; description?: string;
  };
  if (!name) { res.status(400).json({ error: "name is required" }); return; }
  const [doc] = await db.insert(documentsTable).values({
    projectId, name, stage, fileUrl, fileType, fileSize, uploadedBy,
    accessLevel: accessLevel ?? "team",
    tags: tags ?? [],
    description,
  }).returning();
  res.status(201).json(doc);
});

router.get("/documents/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, id));
  if (!doc) { res.status(404).json({ error: "Document not found" }); return; }
  res.json(doc);
});

router.patch("/documents/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { name, stage, fileUrl, fileType, fileSize, approvalStatus, approvedBy, accessLevel, tags, description } = req.body as Record<string, unknown>;
  const updateData: Record<string, unknown> = {};
  if (name !== undefined) updateData.name = name;
  if (stage !== undefined) updateData.stage = stage;
  if (fileUrl !== undefined) updateData.fileUrl = fileUrl;
  if (fileType !== undefined) updateData.fileType = fileType;
  if (fileSize !== undefined) updateData.fileSize = fileSize;
  if (approvalStatus !== undefined) updateData.approvalStatus = approvalStatus;
  if (approvedBy !== undefined) { updateData.approvedBy = approvedBy; updateData.approvedAt = new Date(); }
  if (accessLevel !== undefined) updateData.accessLevel = accessLevel;
  if (tags !== undefined) updateData.tags = tags;
  if (description !== undefined) updateData.description = description;
  const [doc] = await db.update(documentsTable).set(updateData).where(eq(documentsTable.id, id)).returning();
  if (!doc) { res.status(404).json({ error: "Document not found" }); return; }
  res.json(doc);
});

router.delete("/documents/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(documentsTable).where(eq(documentsTable.id, id));
  res.sendStatus(204);
});

router.get("/documents/:id/versions", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const versions = await db.select().from(documentVersionsTable).where(eq(documentVersionsTable.documentId, id)).orderBy(desc(documentVersionsTable.version));
  res.json(versions);
});

router.post("/documents/:id/versions", async (req, res): Promise<void> => {
  const documentId = parseInt(req.params.id);
  if (isNaN(documentId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { fileUrl, uploadedBy, notes } = req.body as { fileUrl?: string; uploadedBy?: number; notes?: string };
  const existing = await db.select().from(documentVersionsTable).where(eq(documentVersionsTable.documentId, documentId)).orderBy(desc(documentVersionsTable.version));
  const nextVersion = existing.length > 0 ? existing[0].version + 1 : 1;
  const [version] = await db.insert(documentVersionsTable).values({ documentId, version: nextVersion, fileUrl, uploadedBy, notes }).returning();
  await db.update(documentsTable).set({ version: nextVersion, fileUrl }).where(eq(documentsTable.id, documentId));
  res.status(201).json(version);
});

export default router;
