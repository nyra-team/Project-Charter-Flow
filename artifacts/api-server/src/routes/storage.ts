import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { Readable } from "stream";
import { like } from "drizzle-orm";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { db, documentsTable } from "@workspace/db";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { localFileExists, openLocalFileStream, readLocalMeta } from "../lib/localStorage";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

/**
 * POST /storage/uploads/request-url
 *
 * Request a presigned URL for file upload.
 * The client sends JSON metadata (name, size, contentType) — NOT the file.
 * Then uploads the file directly to the returned presigned URL.
 */
router.post("/storage/uploads/request-url", async (req: Request, res: Response) => {
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }

  const { name, size, contentType } = parsed.data;

  // Try Replit Object Storage first; on any failure (e.g. running off-Replit,
  // sidecar unreachable, signing endpoint down) fall back to the local-FS
  // upload route. The client's XHR PUT flow doesn't care which backend
  // returned the URL — it just PUTs the body and the path is normalised to
  // /objects/<id> either way.
  try {
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

    res.json(
      RequestUploadUrlResponse.parse({
        uploadURL,
        objectPath,
        metadata: { name, size, contentType },
      }),
    );
    return;
  } catch (error) {
    req.log.warn({ err: error }, "Replit Object Storage unavailable; falling back to local-FS uploads");
  }

  // Local-FS fallback path. The objectId is prefixed "local-" so the GET
  // /storage/objects/* handler can detect and serve from disk.
  const objectId = `local-${randomUUID()}`;
  const origin = req.get("origin") || `${req.protocol}://${req.get("host")}`;
  const uploadURL = `${origin}/api/storage/local-uploads/${objectId}`;
  const objectPath = `/objects/${objectId}`;
  res.json({
    uploadURL,
    objectPath,
    metadata: { name, size, contentType },
  });
});

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS.
 * These are unconditionally public — no authentication or ACL checks.
 * IMPORTANT: Always provide this endpoint when object storage is set up.
 */
router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const response = await objectStorageService.downloadObject(file);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    req.log.error({ err: error }, "Error serving public object");
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

/**
 * GET /storage/objects/*
 *
 * Serve object entities from PRIVATE_OBJECT_DIR.
 * These are served from a separate path from /public-objects and can optionally
 * be protected with authentication or ACL checks based on the use case.
 */
router.get("/storage/objects/*path", async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;

    // Authorization layer 1: the requester must be authenticated. requireAuth
    // already enforces a valid master-DB session (JWT + access_pmo) for every
    // /api route, so req.user is the authentication token here.
    if (!req.user) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }

    // Authorization layer 2: the requested path must be registered as a document
    // fileUrl in the project repository. This prevents enumeration of arbitrary
    // private storage paths and ties object access to project document ownership.
    const [linkedDoc] = await db
      .select({ id: documentsTable.id, projectId: documentsTable.projectId })
      .from(documentsTable)
      .where(like(documentsTable.fileUrl, `%${objectPath}`))
      .limit(1);
    if (!linkedDoc) {
      res.status(403).json({ error: "Access denied: no project document is registered for this path." });
      return;
    }

    // Local-FS path (off-Replit fallback): objectId starts with "local-".
    if (wildcardPath.startsWith("local-")) {
      const objectId = wildcardPath;
      if (!(await localFileExists(objectId))) {
        res.status(404).json({ error: "Object not found" });
        return;
      }
      const meta = await readLocalMeta(objectId);
      res.setHeader("Content-Type", meta?.contentType || "application/octet-stream");
      if (meta?.size) res.setHeader("Content-Length", String(meta.size));
      res.setHeader("Cache-Control", "private, max-age=3600");
      openLocalFileStream(objectId).pipe(res);
      return;
    }

    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
    const response = await objectStorageService.downloadObject(objectFile);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      req.log.warn({ err: error }, "Object not found");
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

export default router;
