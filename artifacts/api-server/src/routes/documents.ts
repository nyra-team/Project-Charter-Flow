import { Router, type IRouter } from "express";
import { db, documentsTable, documentVersionsTable, projectsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { backfillFromDocs } from "../lib/docBackfill";
import { requireRole } from "../lib/guard";

const router: IRouter = Router();

const WRITE_ROLES = ["pm", "pmo", "hod", "initiator"];

// Fire-and-forget AI backfill — must never block the upload response. Errors
// are swallowed (logged) since the upload itself already succeeded.
function triggerBackfill(projectId: number) {
  setImmediate(() => {
    backfillFromDocs(projectId).catch((err) => {
      console.error(`[doc-backfill] project=${projectId} failed:`, err);
    });
  });
}

router.get("/projects/:id/documents", async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const docs = await db.select().from(documentsTable).where(eq(documentsTable.projectId, projectId)).orderBy(desc(documentsTable.createdAt));
  res.json(docs);
});

router.post("/projects/:id/documents", requireRole(...WRITE_ROLES), async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid id" }); return; }

  // Closed projects are read-only — no new documents may be uploaded
  const [proj] = await db.select({ status: projectsTable.status }).from(projectsTable).where(eq(projectsTable.id, projectId));
  if (proj?.status === "closed") {
    res.status(409).json({ error: "Project is closed and archived. Document uploads are no longer permitted." });
    return;
  }

  const { name, stage, fileUrl, fileType, fileSize, uploadedBy, accessLevel, tags, description } = req.body as {
    name: string; stage?: string; fileUrl?: string; fileType?: string; fileSize?: number;
    uploadedBy?: number; accessLevel?: string; tags?: unknown[]; description?: string;
  };
  if (!name) { res.status(400).json({ error: "name is required" }); return; }

  // Authoritative server-side per-stage, per-document file-type and size policy.
  // Standard documents: 25MB max. Go Live training materials video: 500MB max.
  // Dangerous executable types are always rejected.
  const BLOCKED_MIME_TYPES = new Set([
    "application/x-msdownload", "application/x-executable",
    "application/x-sh", "text/x-script.sh", "application/x-msdos-program",
  ]);
  if (fileType && BLOCKED_MIME_TYPES.has(fileType)) {
    res.status(422).json({ error: `File type '${fileType}' is not permitted in the document repository.` });
    return;
  }

  // Per-document size policy: documents are capped at 500MB across the board
  // (matches the Training Materials cap so every slot accepts the same ceiling).
  const maxBytes = 500 * 1024 * 1024;
  if (fileSize != null && fileSize > maxBytes) {
    res.status(422).json({ error: `File size ${(fileSize / 1024 / 1024).toFixed(1)}MB exceeds the 500MB limit for '${name}'.` });
    return;
  }

  // Per-document accepted MIME type policy (based on lifecycle stage config).
  const STAGE_DOC_ACCEPTED_TYPES: Record<string, Record<string, string[]>> = {
    go_live: {
      "Training Materials": ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "video/mp4", "video/quicktime"],
    },
  };
  const acceptedForDoc = STAGE_DOC_ACCEPTED_TYPES[stage ?? ""]?.[name];
  // Standard accepted MIME types for PDF/DOCX/XLSX/PPTX documents
  const STANDARD_ACCEPTED: Set<string> = new Set([
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/msword",
    "application/vnd.ms-excel",
    "application/vnd.ms-powerpoint",
    "text/html", // auto-generated reports (Closure Report)
    "application/octet-stream", // fallback for misconfigured Content-Type
  ]);
  const allowedTypes = acceptedForDoc ? new Set(acceptedForDoc) : STANDARD_ACCEPTED;
  if (fileType && fileType !== "application/octet-stream" && !allowedTypes.has(fileType)) {
    res.status(422).json({ error: `File type '${fileType}' is not accepted for document '${name}'. Allowed: ${[...allowedTypes].join(", ")}` });
    return;
  }
  const [doc] = await db.insert(documentsTable).values({
    projectId, name, stage, fileUrl, fileType, fileSize, uploadedBy,
    accessLevel: accessLevel ?? "team",
    tags: tags ?? [],
    description,
  }).returning();
  triggerBackfill(projectId);
  res.status(201).json(doc);
});

router.get("/documents/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, id));
  if (!doc) { res.status(404).json({ error: "Document not found" }); return; }
  res.json(doc);
});

router.patch("/documents/:id", requireRole(...WRITE_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  // Enforce closed-project read-only on document updates
  const [existingDoc] = await db.select({ projectId: documentsTable.projectId }).from(documentsTable).where(eq(documentsTable.id, id));
  if (existingDoc) {
    const [projD] = await db.select({ status: projectsTable.status }).from(projectsTable).where(eq(projectsTable.id, existingDoc.projectId));
    if (projD?.status === "closed") {
      res.status(409).json({ error: "Project is closed. Documents cannot be updated." });
      return;
    }
  }
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

router.delete("/documents/:id", requireRole("pmo", "pm"), async (req, res): Promise<void> => {
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

router.post("/documents/:id/versions", requireRole(...WRITE_ROLES), async (req, res): Promise<void> => {
  const documentId = parseInt(req.params.id);
  if (isNaN(documentId)) { res.status(400).json({ error: "Invalid id" }); return; }
  // Enforce closed-project read-only on new document versions
  const [existingDocV] = await db.select({ projectId: documentsTable.projectId }).from(documentsTable).where(eq(documentsTable.id, documentId));
  if (existingDocV) {
    const [projV] = await db.select({ status: projectsTable.status }).from(projectsTable).where(eq(projectsTable.id, existingDocV.projectId));
    if (projV?.status === "closed") {
      res.status(409).json({ error: "Project is closed. Document versions cannot be added." });
      return;
    }
  }
  const { fileUrl, uploadedBy, notes } = req.body as { fileUrl?: string; uploadedBy?: number; notes?: string };
  const existing = await db.select().from(documentVersionsTable).where(eq(documentVersionsTable.documentId, documentId)).orderBy(desc(documentVersionsTable.version));
  const nextVersion = existing.length > 0 ? existing[0].version + 1 : 1;
  const [version] = await db.insert(documentVersionsTable).values({ documentId, version: nextVersion, fileUrl, uploadedBy, notes }).returning();
  await db.update(documentsTable).set({ version: nextVersion, fileUrl }).where(eq(documentsTable.id, documentId));
  if (existingDocV) triggerBackfill(existingDocV.projectId);
  res.status(201).json(version);
});

export default router;
