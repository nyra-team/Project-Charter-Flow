/**
 * Local-filesystem upload PUT endpoint.
 *
 * Mounted BEFORE requireAuth (mirroring template-files / vendor routers) so
 * the XHR PUT from the frontend dropzone can deliver the file body. The
 * one-time random objectId acts as the access token (it's never exposed —
 * generated server-side and only sent over the authed request-url channel).
 *
 * Dev / non-Replit deploys only. Replit deployments use the GCS presigned
 * URL flow in routes/storage.ts.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { writeLocalUpload } from "../lib/localStorage";

const router: IRouter = Router();

router.put("/storage/local-uploads/:objectId", async (req: Request, res: Response) => {
  const raw = req.params.objectId;
  const objectId = Array.isArray(raw) ? raw[0] : raw;
  if (!objectId || !/^local-[a-zA-Z0-9_-]{1,128}$/.test(objectId)) {
    res.status(400).json({ error: "Invalid object id" });
    return;
  }
  try {
    const contentType = req.get("content-type") || "application/octet-stream";
    const rawName = req.get("x-original-name");
    const originalName = Array.isArray(rawName) ? rawName[0] : (rawName || objectId);
    const { size } = await writeLocalUpload(objectId, req, contentType, originalName);
    req.log?.info({ objectId, size, contentType }, "Local upload received");
    res.status(200).json({ ok: true, size });
  } catch (error) {
    req.log?.error({ err: error }, "Local upload failed");
    res.status(500).json({ error: "Local upload failed" });
  }
});

export default router;
