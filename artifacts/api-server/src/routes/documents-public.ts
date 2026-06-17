import { Router, type IRouter, type Request, type Response } from "express";
import path from "node:path";
import { createReadStream, existsSync } from "node:fs";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import { eq, desc } from "drizzle-orm";
import { db, documentsTable, documentVersionsTable } from "@workspace/db";
import { ObjectStorageService } from "../lib/objectStorage";
import {
  writeLocalUpload, openLocalFileStream, localFileExists, readLocalMeta,
} from "../lib/localStorage";
import {
  resolveTemplateDir, TEMPLATE_PHASES, TEMPLATE_FILE_ALLOWLIST, mimeForFile,
} from "../lib/templateDocuments";
import { isValidShareToken } from "../lib/docShare";
import { scheduleLiveCharterRefresh } from "./ai";

// ---------------------------------------------------------------------------
// Public per-document RAW access — the "wget / curl" sync path for the tech
// team (whiteboard right-hand side: pull docs into DEV / UAT / PMO). Mounted
// BEFORE requireAuth (see app.ts) so plain wget/curl work without a Bearer.
//
//   GET  /api/documents/:id/raw  -> stream the latest version's file. Public,
//                                   tokenless read: `wget <base>/api/documents/<id>/raw`.
//   PUT  /api/documents/:id/raw  -> store the uploaded body as a NEW version:
//                                   `curl -T file -H "X-Internal-Token: …" <url>`.
//
// ponytail: shared-secret on WRITE only (PMO_DOC_PUSH_TOKEN); reads are public
// by design. Drop the guard for open writes, or upgrade to per-doc tokens if
// reads ever need gating.
// ---------------------------------------------------------------------------

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();

/** Stream whatever a document.fileUrl points at (template-on-disk / local-FS / GCS). */
async function streamFileUrl(fileUrl: string, res: Response): Promise<boolean> {
  const tpl = fileUrl.match(/\/storage\/templates\/([^/]+)\/([^/?]+)/);
  if (tpl) {
    const phase = decodeURIComponent(tpl[1]);
    const file = path.basename(decodeURIComponent(tpl[2]));
    if (!TEMPLATE_PHASES.has(phase) || !TEMPLATE_FILE_ALLOWLIST.has(file)) return false;
    const abs = path.join(resolveTemplateDir(), phase, file);
    if (!existsSync(abs)) return false;
    res.setHeader("Content-Type", mimeForFile(file));
    res.setHeader("Content-Disposition", `attachment; filename="${file}"`);
    createReadStream(abs).pipe(res);
    return true;
  }

  const m = fileUrl.match(/\/objects\/([^/?]+)/);
  if (!m) return false;
  const objectId = m[1];

  if (objectId.startsWith("local-")) {
    if (!(await localFileExists(objectId))) return false;
    const meta = await readLocalMeta(objectId);
    res.setHeader("Content-Type", meta?.contentType || "application/octet-stream");
    if (meta?.size) res.setHeader("Content-Length", String(meta.size));
    openLocalFileStream(objectId).pipe(res);
    return true;
  }

  const objectFile = await objectStorage.getObjectEntityFile(`/objects/${objectId}`);
  const response = await objectStorage.downloadObject(objectFile);
  res.status(response.status);
  response.headers.forEach((v, k) => res.setHeader(k, v));
  if (response.body) {
    Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
  } else {
    res.end();
  }
  return true;
}

router.get("/documents/:id/raw", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, id));
  if (!doc || !doc.fileUrl) { res.status(404).json({ error: "Document or file not found" }); return; }
  try {
    const ok = await streamFileUrl(doc.fileUrl, res);
    if (!ok && !res.headersSent) res.status(404).json({ error: "File not found" });
  } catch (err) {
    req.log?.error({ err }, "raw doc stream failed");
    if (!res.headersSent) res.status(500).json({ error: "Failed to serve document" });
  }
});

router.put("/documents/:id/raw", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  // Write is authorized by EITHER the global tech-team header OR the per-document
  // editor token in the share link (?t=…) — the Drive "anyone with link can edit".
  const expected = process.env.PMO_DOC_PUSH_TOKEN;
  if (!expected) {
    res.status(501).json({ error: "Document push is not configured. Set PMO_DOC_PUSH_TOKEN." });
    return;
  }
  const presentedToken = String((req.query.t as string) || "");
  const authorized = req.get("x-internal-token") === expected || isValidShareToken(id, presentedToken);
  if (!authorized) {
    res.status(403).json({ error: "Invalid or missing editor token." });
    return;
  }
  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, id));
  if (!doc) { res.status(404).json({ error: "Document not found" }); return; }

  // Stream the raw request body to local-FS storage (express.json/urlencoded
  // skip binary content-types, so `req` is still an unread stream here).
  const objectId = `local-${randomUUID()}`;
  const contentType = req.get("content-type") || doc.fileType || "application/octet-stream";
  const originalName = req.get("x-original-name") || doc.name;
  let size: number;
  try {
    ({ size } = await writeLocalUpload(objectId, req, contentType, originalName));
  } catch (err) {
    req.log?.error({ err }, "raw doc push write failed");
    res.status(500).json({ error: "Failed to store document" });
    return;
  }

  const fileUrl = `/api/storage/objects/${objectId}`;
  const existing = await db.select().from(documentVersionsTable)
    .where(eq(documentVersionsTable.documentId, id)).orderBy(desc(documentVersionsTable.version));
  const nextVersion = existing.length > 0 ? existing[0].version + 1 : (doc.version ?? 1) + 1;
  await db.insert(documentVersionsTable).values({
    documentId: id, version: nextVersion, fileUrl,
    uploadedBy: doc.uploadedBy ?? undefined,
    notes: `Pushed via wget/curl sync (${Math.round(size / 1024)} KB)`,
  });
  await db.update(documentsTable)
    .set({ version: nextVersion, fileUrl, fileType: contentType, fileSize: size })
    .where(eq(documentsTable.id, id));
  scheduleLiveCharterRefresh(doc.projectId);
  res.json({ ok: true, id, version: nextVersion, fileUrl });
});

export default router;
