import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { db, nfasTable, projectsTable, notificationsTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { logActivity } from "./activity";
import { requireRole } from "../lib/guard";
import { matchBand, CAPEX_CATEGORY, CAPEX_KIND, signatoriesFromChain } from "../lib/doa-resolver";
import { documensoConfigured, docxToPdf, sendForSignature, signersFromSignatories, getDocumensoDocument, nextPendingSigner, type EsignEnvelope } from "../integrations/documenso";
import { notifySignerTurn } from "../lib/esign-notify";
import { enrichSignatoryEmails } from "../lib/signatory-email";

// CAPEX DOA defaults + signatory builder are shared with charters.ts via
// ../lib/doa-resolver so the project NFA and the standalone e-NFA resolve the
// identical approver chain (see CAPEX_CATEGORY / CAPEX_KIND / signatoriesFromChain).

const router: IRouter = Router();

const WRITE_ROLES = ["pm", "pmo", "hod", "initiator"];
const DECIDE_ROLES = ["pmo", "hod", "cfo", "chairman", "executive_director", "scm", "finance"];

// ─── Validation ──────────────────────────────────────────────────────────────

const RequirementItem = z.object({
  item: z.string().default(""),
  details: z.string().default(""),
});

const Signatory = z.object({
  role: z.string().default(""),
  name: z.string().default(""),
  email: z.string().optional(),
  empCode: z.string().optional(),
  designation: z.string().optional(),
  status: z.enum(["pending", "approved", "rejected"]).default("pending"),
  comment: z.string().optional(),
  decidedAt: z.string().optional(),
});

const CreateNfaBody = z.object({
  noteNo: z.string().optional(), // auto-assigned if absent
  projectId: z.number().int().optional(),
  department: z.string().optional(),
  location: z.string().optional(),
  locationRequired: z.string().optional(),
  noteDate: z.string().optional(),
  subject: z.string().optional(),
  background: z.string().optional(),
  requirementItems: z.array(RequirementItem).optional(),
  orderFormNote: z.string().optional(),
  totalUsd: z.string().optional(),
  totalInr: z.string().optional(),
  recommendation: z.string().optional(),
  // Corporate e-NFA template fields
  functionDept: z.string().optional(),
  requirements: z.string().optional(),
  justification: z.string().optional(),
  vendorDetails: z.string().optional(),
  modeOfProcurement: z.string().optional(),
  financialImplication: z.string().optional(),
  financialAmount: z.coerce.number().optional(),
  cmdRequired: z.boolean().optional(),
  signatories: z.array(Signatory).optional(),
  // User-defined extra fields (step-2 form), in author-arranged order.
  customFields: z.array(z.object({ id: z.string(), label: z.string(), value: z.string() })).optional(),
  createdById: z.number().int().optional(),
  createdByName: z.string().optional(),
  createdByCode: z.string().optional(),
});

const UpdateNfaBody = CreateNfaBody.partial();

const DecideBody = z.object({
  signatoryIndex: z.number().int().nonnegative(),
  decision: z.enum(["approve", "reject"]),
  comment: z.string().optional(),
  decidedById: z.number().int().optional(),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

// generate_nfa.py lives at apps/pmo/scripts/. This bundle runs from
// apps/pmo/artifacts/api-server/dist/index.mjs, so walk three dirs up. Resolve
// from import.meta.url (stable regardless of process cwd).
const GENERATOR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../scripts/generate_nfa.py",
);
const PYTHON = process.env.PYTHON_BIN || "python3";

// Auto-number: "01", "02", … per the Granules note convention (zero-padded,
// global running count). A small race window on concurrent creates is
// acceptable for a manual-approval artifact; the number is editable anyway.
async function nextNoteNo(): Promise<string> {
  const [row] = await db
    .select({ id: nfasTable.id })
    .from(nfasTable)
    .orderBy(desc(nfasTable.id))
    .limit(1);
  const n = (row?.id ?? 0) + 1;
  return String(n).padStart(2, "0");
}

// Roll the row's status up from the signatory grid: any reject → rejected,
// all approved → approved, otherwise it stays pending_approval.
function rollupStatus(sigs: Array<{ status: string }>): "approved" | "rejected" | "pending_approval" {
  if (sigs.some((s) => s.status === "rejected")) return "rejected";
  if (sigs.length > 0 && sigs.every((s) => s.status === "approved")) return "approved";
  return "pending_approval";
}

// ═══════════════════════════════════════════════════════════════════════════
// CRUD
// ═══════════════════════════════════════════════════════════════════════════

router.get("/nfas", async (req, res): Promise<void> => {
  const projectId = typeof req.query.projectId === "string" ? parseInt(req.query.projectId) : undefined;
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const conds = [];
  if (projectId && !isNaN(projectId)) conds.push(eq(nfasTable.projectId, projectId));
  if (status) conds.push(eq(nfasTable.status, status));
  const rows = conds.length
    ? await db.select().from(nfasTable).where(and(...conds)).orderBy(desc(nfasTable.updatedAt))
    : await db.select().from(nfasTable).orderBy(desc(nfasTable.updatedAt));
  res.json(rows);
});

router.get("/nfas/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [nfa] = await db.select().from(nfasTable).where(eq(nfasTable.id, id));
  if (!nfa) { res.status(404).json({ error: "NFA not found" }); return; }
  res.json(nfa);
});

router.post("/nfas", requireRole(...WRITE_ROLES), async (req, res): Promise<void> => {
  const parsed = CreateNfaBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const data = parsed.data;

  // Guard the optional project link — a dangling projectId would orphan the note.
  if (data.projectId != null) {
    const [proj] = await db.select({ id: projectsTable.id }).from(projectsTable).where(eq(projectsTable.id, data.projectId));
    if (!proj) { res.status(400).json({ error: `Project ${data.projectId} not found` }); return; }
  }

  const noteNo = data.noteNo?.trim() || (await nextNoteNo());
  // drizzle's pg numeric column expects a string
  const insertData: Record<string, unknown> = { ...data, noteNo };
  if (data.financialAmount != null) insertData.financialAmount = String(data.financialAmount);
  const [nfa] = await db
    .insert(nfasTable)
    .values(insertData as never)
    .returning();
  await logActivity("nfa_created", `NFA "${nfa.subject || nfa.noteNo}" created`, nfa.id, "nfa");
  res.status(201).json(nfa);
});

router.patch("/nfas/:id", requireRole(...WRITE_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = UpdateNfaBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  // Decided notes (approved / rejected) are frozen to protect the approval
  // audit trail. Clone via the UI to revise after sign-off.
  const [current] = await db.select({ status: nfasTable.status }).from(nfasTable).where(eq(nfasTable.id, id));
  if (!current) { res.status(404).json({ error: "NFA not found" }); return; }
  if (["approved", "rejected"].includes(current.status)) {
    res.status(409).json({ error: `NFA is ${current.status} and frozen. Clone it to make changes.` });
    return;
  }

  const [nfa] = await db.update(nfasTable).set(parsed.data as never).where(eq(nfasTable.id, id)).returning();
  res.json(nfa);
});

router.delete("/nfas/:id", requireRole("pmo", "pm"), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [current] = await db.select({ status: nfasTable.status }).from(nfasTable).where(eq(nfasTable.id, id));
  if (!current) { res.status(404).json({ error: "NFA not found" }); return; }
  if (current.status !== "draft") {
    res.status(409).json({ error: "Only draft NFAs can be deleted. Submitted/decided notes are kept for audit." });
    return;
  }
  await db.delete(nfasTable).where(eq(nfasTable.id, id));
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// SUBMIT — draft → pending_approval
// ═══════════════════════════════════════════════════════════════════════════

router.post("/nfas/:id/submit", requireRole(...WRITE_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [nfa] = await db.select().from(nfasTable).where(eq(nfasTable.id, id));
  if (!nfa) { res.status(404).json({ error: "NFA not found" }); return; }
  if (nfa.status !== "draft") {
    res.status(409).json({ error: `NFA is ${nfa.status}; only drafts can be submitted.` });
    return;
  }
  let sigs = (nfa.signatories as Array<{ role: string }>) ?? [];
  let doaLabel: string | null = null;

  // Auto-route via the DOA matrix when no manual signatory grid was set:
  // resolve the CAPEX approver chain from (location, amount) and use it.
  if (sigs.length === 0) {
    const amount = Number(nfa.financialAmount ?? 0) || Number(String(nfa.totalInr ?? "").replace(/[^\d.]/g, "")) || 0;
    const match = await matchBand({
      entity: nfa.location ?? "",
      category: CAPEX_CATEGORY,
      kind: CAPEX_KIND,
      amountInr: amount,
    });
    const resolved = match ? signatoriesFromChain(match.approverRoles as unknown[]) : [];
    if (resolved.length > 0) {
      sigs = resolved;
      doaLabel = match!.label;
    }
  }

  if (sigs.length === 0) {
    res.status(400).json({ error: "No DOA band matched (check the note's location & amount) and no signatory was added. Add a signatory or configure the DOA matrix." });
    return;
  }

  const [updated] = await db
    .update(nfasTable)
    .set({ status: "pending_approval", signatories: sigs } as never)
    .where(eq(nfasTable.id, id))
    .returning();
  await logActivity("nfa_submitted", `NFA "${nfa.subject || nfa.noteNo}" submitted for approval${doaLabel ? ` (DOA: ${doaLabel}, ${sigs.length} approvers)` : ""}`, nfa.id, "nfa");

  // Auto-send to Documenso as part of submit (same policy as charters):
  // best-effort — POST /nfas/:id/esign remains the manual retry path.
  let esign: EsignEnvelope | null = null;
  let esignError: string | null = null;
  if (documensoConfigured()) {
    try {
      esign = await sendNfaEsign(updated);
    } catch (e) {
      esignError = (e as Error).message;
      req.log?.warn({ err: esignError, nfaId: nfa.id }, "auto e-sign on submit failed");
    }
  }

  res.json({ ...updated, esign: esign ?? updated.esign, esignError });
});

// ═══════════════════════════════════════════════════════════════════════════
// DECIDE — a signatory approves / rejects their row in the grid
// ═══════════════════════════════════════════════════════════════════════════

router.post("/nfas/:id/decide", requireRole(...DECIDE_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = DecideBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [nfa] = await db.select().from(nfasTable).where(eq(nfasTable.id, id));
  if (!nfa) { res.status(404).json({ error: "NFA not found" }); return; }
  if (nfa.status !== "pending_approval") {
    res.status(409).json({ error: `NFA is ${nfa.status}; only pending_approval notes can be decided.` });
    return;
  }

  const sigs = [...((nfa.signatories as Array<Record<string, unknown>>) ?? [])];
  const idx = parsed.data.signatoryIndex;
  if (idx >= sigs.length) { res.status(400).json({ error: "signatoryIndex out of range" }); return; }

  sigs[idx] = {
    ...sigs[idx],
    status: parsed.data.decision === "approve" ? "approved" : "rejected",
    comment: parsed.data.comment ?? sigs[idx].comment ?? "",
    decidedAt: new Date().toISOString(),
  };
  const status = rollupStatus(sigs as Array<{ status: string }>);

  const [updated] = await db
    .update(nfasTable)
    .set({ signatories: sigs, status } as never)
    .where(eq(nfasTable.id, id))
    .returning();

  // Notify the creator on a terminal verdict.
  if ((status === "approved" || status === "rejected") && nfa.createdById) {
    await db.insert(notificationsTable).values({
      userId: nfa.createdById,
      type: status === "approved" ? "nfa_approved" : "nfa_rejected",
      title: status === "approved"
        ? `NFA approved: "${nfa.subject || nfa.noteNo}"`
        : `NFA rejected: "${nfa.subject || nfa.noteNo}"`,
      body: parsed.data.comment?.trim() || null,
      link: `/nfas/${nfa.id}`,
      relatedEntityType: "nfa",
      relatedEntityId: nfa.id,
    } as never);
  }

  await logActivity(
    `nfa_${parsed.data.decision === "approve" ? "approved" : "rejected"}_step`,
    `NFA "${nfa.subject || nfa.noteNo}" — ${sigs[idx].role || "signatory"} ${parsed.data.decision === "approve" ? "approved" : "rejected"}`,
    nfa.id,
    "nfa",
  );
  res.json(updated);
});

// ═══════════════════════════════════════════════════════════════════════════
// DOCX — render the note on demand via scripts/generate_nfa.py
// ═══════════════════════════════════════════════════════════════════════════

export async function renderNfaDocx(nfa: unknown): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), "nfa-"));
  try {
    const inPath = path.join(dir, "in.json");
    const outPath = path.join(dir, "out.docx");
    await writeFile(inPath, JSON.stringify(nfa), "utf-8");

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(PYTHON, [GENERATOR, "--in", inPath, "--out", outPath], { stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";
      proc.stderr.on("data", (d) => { stderr += d.toString(); });
      proc.on("error", reject);
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`generate_nfa.py exited ${code}: ${stderr.trim()}`));
      });
    });

    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

router.get("/nfas/:id/docx", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [nfa] = await db.select().from(nfasTable).where(eq(nfasTable.id, id));
  if (!nfa) { res.status(404).json({ error: "NFA not found" }); return; }

  try {
    const buf = await renderNfaDocx(nfa);
    const safeSubject = (nfa.subject || `NFA-${nfa.noteNo}`).replace(/[^a-z0-9\-_ ]/gi, "").trim().slice(0, 60) || `NFA-${nfa.noteNo}`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${safeSubject}.docx"`);
    res.send(buf);
  } catch (e) {
    res.status(500).json({ error: `Failed to generate NFA document: ${(e as Error).message}` });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// E-SIGN — send the pending note to Documenso; signatures come back via the
// /api/documenso/webhook and are recorded like in-app decisions.
// ═══════════════════════════════════════════════════════════════════════════

// Render → PDF → Documenso send → persist envelope → tell the first signer.
// Shared by the manual /esign route (retry path) and the auto-send on submit.
async function sendNfaEsign(nfa: { id: number; noteNo?: string | null; subject?: string | null; signatories?: unknown; esign?: unknown }): Promise<EsignEnvelope> {
  if ((nfa.esign as { documentId?: number } | null)?.documentId) {
    throw Object.assign(new Error("Already sent for e-signature."), { statusCode: 409 });
  }
  const sigs = await enrichSignatoryEmails((nfa.signatories as Array<{ role?: string; name?: string; email?: string; empCode?: string }>) ?? []);
  const { signers, missing } = signersFromSignatories(sigs);
  if (signers.length === 0 || missing.length > 0) {
    throw Object.assign(
      new Error(`Signatories without an email address: ${missing.join(", ") || "(none resolvable)"}. E-sign needs an email per approver.`),
      { statusCode: 422 },
    );
  }

  const title = `e-NFA ${nfa.noteNo}${nfa.subject ? ` — ${nfa.subject}` : ""}`;
  const pdf = await docxToPdf(await renderNfaDocx(nfa as never));
  const esign = await sendForSignature({ title, externalId: `nfa:${nfa.id}`, pdf, signers });
  await db.update(nfasTable).set({ esign } as never).where(eq(nfasTable.id, nfa.id));
  await logActivity("nfa_esign_sent", `NFA "${nfa.subject || nfa.noteNo}" sent for e-signature via Documenso (${signers.length} signers)`, nfa.id, "nfa");

  try {
    const doc = await getDocumensoDocument(esign.documentId);
    const first = nextPendingSigner(doc);
    if (first) await notifySignerTurn({ email: first.email, signingUrl: first.signingUrl, kind: "nfa", entityId: nfa.id, title });
  } catch { /* notify is auxiliary */ }

  return esign;
}

router.post("/nfas/:id/esign", requireRole(...WRITE_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (!documensoConfigured()) { res.status(501).json({ error: "E-sign is not configured (set DOCUMENSO_URL + DOCUMENSO_API_TOKEN)." }); return; }
  const [nfa] = await db.select().from(nfasTable).where(eq(nfasTable.id, id));
  if (!nfa) { res.status(404).json({ error: "NFA not found" }); return; }
  if (nfa.status !== "pending_approval") { res.status(409).json({ error: `NFA is ${nfa.status}; submit it for approval first.` }); return; }

  try {
    const esign = await sendNfaEsign(nfa);
    const [updated] = await db.select().from(nfasTable).where(eq(nfasTable.id, id));
    res.json({ ...updated, esign });
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode ?? 502;
    res.status(status).json({ error: status === 502 ? `Failed to send for e-signature: ${(e as Error).message}` : (e as Error).message, ...(status === 409 ? { esign: nfa.esign } : {}) });
  }
});

export default router;
