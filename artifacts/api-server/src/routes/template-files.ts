import { Router, type IRouter, type Request, type Response } from "express";
import path from "node:path";
import { createReadStream, existsSync } from "node:fs";
import {
  TEMPLATE_PHASES,
  TEMPLATE_FILE_ALLOWLIST,
  resolveTemplateDir,
  mimeForFile,
} from "../lib/templateDocuments";

// ---------------------------------------------------------------------------
// Public serving of BLANK deliverable templates from disk.
//
// Mounted BEFORE requireAuth (see app.ts) so a plain <a href download> works —
// requireAuth is Bearer-only and an anchor download can't carry that header.
// These are non-sensitive blank templates (already public in the Templates
// browser), so no auth/ACL is needed. Path traversal is prevented by an exact
// phase + filename allowlist.
// ---------------------------------------------------------------------------

const router: IRouter = Router();

router.get("/storage/templates/:phase/:file", (req: Request, res: Response): void => {
  const phase = String(req.params.phase);
  const file = path.basename(String(req.params.file)); // strip any path segments

  if (!TEMPLATE_PHASES.has(phase) || !TEMPLATE_FILE_ALLOWLIST.has(file)) {
    res.status(404).json({ error: "Template not found" });
    return;
  }

  let abs: string;
  try {
    abs = path.join(resolveTemplateDir(), phase, file);
  } catch (err) {
    req.log?.error({ err }, "template dir unresolved");
    res.status(500).json({ error: "Template storage unavailable" });
    return;
  }
  if (!existsSync(abs)) {
    res.status(404).json({ error: "Template not found" });
    return;
  }

  res.setHeader("Content-Type", mimeForFile(file));
  res.setHeader("Content-Disposition", `attachment; filename="${file}"`);
  res.setHeader("Cache-Control", "public, max-age=3600");
  createReadStream(abs)
    .on("error", (err) => {
      req.log?.error({ err }, "template stream failed");
      if (!res.headersSent) res.status(500).end();
    })
    .pipe(res);
});

export default router;
