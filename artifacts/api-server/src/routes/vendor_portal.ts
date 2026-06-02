import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { and, eq } from "drizzle-orm";
import {
  db,
  vendorMasterTable,
  vendorDocumentsTable,
  vendorQualificationsTable,
  vendorQuestionnaireTemplatesTable,
  vendorQuestionnaireResponsesTable,
  rfxEventsTable,
  rfxInvitationsTable,
  rfxQuestionsTable,
  rfxEnvelopesTable,
  rfxEnvelopeFilesTable,
  rfxClarificationsTable,
} from "@workspace/db";
import { requireVendorAuth } from "../middlewares/requireVendorAuth";
import { sealEnvelopeForKind } from "./rfx";
import { logActivity } from "./activity";

// Vendor-facing routes mounted at /api/vendor/* behind requireVendorAuth.
// The vendor portal at vendors.granulesrecruit.com calls these.

const router: IRouter = Router();
// Scope the vendor guard to /vendor/* only. This router is mounted at /api
// (app.ts), so an unscoped `router.use(requireVendorAuth)` would run on EVERY
// /api request and reject internal employee traffic (projects, dashboard,
// notifications) as invalid vendor tokens. All routes below are under /vendor.
router.use("/vendor", requireVendorAuth);

function vendor(req: { vendor?: { vendorId: number; vendorName: string; authUserId: string; email: string } }) {
  return req.vendor!;
}

// ─── Profile ────────────────────────────────────────────────────────────────

router.get("/vendor/me", async (req, res) => {
  const v = vendor(req);
  const [row] = await db.select().from(vendorMasterTable).where(eq(vendorMasterTable.id, v.vendorId));
  res.json(row);
});

const ProfileBody = z.object({
  name: z.string().min(1).optional(),
  legalName: z.string().optional(),
  gst: z.string().optional(),
  pan: z.string().optional(),
  country: z.string().optional(),
  region: z.string().optional(),
  category: z.string().optional(),
  phone: z.string().optional(),
  website: z.string().optional(),
  address: z.string().optional(),
  profileExtras: z.record(z.unknown()).optional(),
});

router.patch("/vendor/me", async (req, res) => {
  const v = vendor(req);
  const parsed = ProfileBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [row] = await db.update(vendorMasterTable).set(parsed.data).where(eq(vendorMasterTable.id, v.vendorId)).returning();
  res.json(row);
});

// ─── Documents ──────────────────────────────────────────────────────────────

router.get("/vendor/documents", async (req, res) => {
  const v = vendor(req);
  const rows = await db.select().from(vendorDocumentsTable).where(eq(vendorDocumentsTable.vendorId, v.vendorId));
  res.json(rows);
});

const VendorDocBody = z.object({
  kind: z.enum(["registration", "gst", "pan", "iso", "insurance", "financial", "msme", "tax_residency", "other"]),
  fileUrl: z.string().min(1),
  originalName: z.string().optional(),
  mime: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
});

router.post("/vendor/documents", async (req, res) => {
  const v = vendor(req);
  const parsed = VendorDocBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [row] = await db.insert(vendorDocumentsTable).values({
    vendorId: v.vendorId,
    kind: parsed.data.kind,
    fileUrl: parsed.data.fileUrl,
    originalName: parsed.data.originalName ?? "",
    mime: parsed.data.mime ?? "",
    sizeBytes: parsed.data.sizeBytes ?? 0,
  }).returning();
  res.status(201).json(row);
});

// ─── Qualifications (vendor-visible read only) ──────────────────────────────

router.get("/vendor/qualifications", async (req, res) => {
  const v = vendor(req);
  const rows = await db.select().from(vendorQualificationsTable).where(eq(vendorQualificationsTable.vendorId, v.vendorId));
  res.json(rows);
});

// ─── Questionnaire ──────────────────────────────────────────────────────────

router.get("/vendor/questionnaire-templates", async (_req, res) => {
  const rows = await db.select().from(vendorQuestionnaireTemplatesTable).where(eq(vendorQuestionnaireTemplatesTable.isActive, 1));
  res.json(rows);
});

const QuestionnaireSubmitBody = z.object({
  templateId: z.number().int(),
  answers: z.record(z.unknown()),
});

router.post("/vendor/questionnaire-responses", async (req, res) => {
  const v = vendor(req);
  const parsed = QuestionnaireSubmitBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [row] = await db.insert(vendorQuestionnaireResponsesTable).values({
    vendorId: v.vendorId,
    templateId: parsed.data.templateId,
    answers: parsed.data.answers,
  }).returning();
  await logActivity("vendor_questionnaire_submitted",
    `${v.vendorName} submitted questionnaire template ${parsed.data.templateId}`,
    v.vendorId, "vendor", null);
  res.status(201).json(row);
});

// ─── RFx invitations ────────────────────────────────────────────────────────

router.get("/vendor/rfx", async (req, res) => {
  const v = vendor(req);
  const invitations = await db.select().from(rfxInvitationsTable).where(eq(rfxInvitationsTable.vendorId, v.vendorId));
  if (invitations.length === 0) { res.json([]); return; }
  const evtIds = invitations.map(i => i.rfxId);
  const events = await db.select().from(rfxEventsTable);
  const evtMap = new Map(events.map(e => [e.id, e]));
  const out = invitations
    .map(inv => ({ invitation: inv, event: evtMap.get(inv.rfxId) }))
    .filter(o => o.event && o.event.status !== "draft" && o.event.status !== "cancelled");
  res.json(out);
});

router.get("/vendor/rfx/:invitationId", async (req, res) => {
  const v = vendor(req);
  const invitationId = Number(req.params.invitationId);
  const [inv] = await db.select().from(rfxInvitationsTable).where(and(
    eq(rfxInvitationsTable.id, invitationId), eq(rfxInvitationsTable.vendorId, v.vendorId),
  ));
  if (!inv) { res.status(404).json({ error: "Invitation not found" }); return; }
  const [evt] = await db.select().from(rfxEventsTable).where(eq(rfxEventsTable.id, inv.rfxId));
  if (!evt || evt.status === "draft") { res.status(404).json({ error: "RFx not open" }); return; }
  const [questions, envelopes, files, clarifications] = await Promise.all([
    db.select().from(rfxQuestionsTable).where(eq(rfxQuestionsTable.rfxId, inv.rfxId)),
    db.select().from(rfxEnvelopesTable).where(eq(rfxEnvelopesTable.invitationId, inv.id)),
    db.select().from(rfxEnvelopeFilesTable),
    db.select().from(rfxClarificationsTable).where(eq(rfxClarificationsTable.rfxId, inv.rfxId)),
  ]);
  const envIds = new Set(envelopes.map(e => e.id));
  const myFiles = files.filter(f => envIds.has(f.envelopeId));
  const safeEnvelopes = envelopes.map(e => ({
    id: e.id, kind: e.kind, status: e.status, submittedAt: e.submittedAt,
  }));
  // Vendor sees only public clarifications + their own
  const visibleClars = clarifications.filter(c => c.isPublic || c.invitationId === inv.id);
  res.json({ event: evt, invitation: inv, questions, envelopes: safeEnvelopes, files: myFiles, clarifications: visibleClars });
});

// ─── Submit envelope (seal) ─────────────────────────────────────────────────

const SubmitEnvelopeBody = z.object({
  kind: z.enum(["technical", "commercial", "alternative"]),
  answers: z.record(z.unknown()),
  files: z.array(z.object({
    questionId: z.number().int().optional(),
    fileUrl: z.string(), originalName: z.string().optional(),
    mime: z.string().optional(), sizeBytes: z.number().int().optional(),
  })).optional(),
});

router.post("/vendor/rfx/:invitationId/envelopes", async (req, res) => {
  const v = vendor(req);
  const invitationId = Number(req.params.invitationId);
  const parsed = SubmitEnvelopeBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [inv] = await db.select().from(rfxInvitationsTable).where(and(
    eq(rfxInvitationsTable.id, invitationId), eq(rfxInvitationsTable.vendorId, v.vendorId),
  ));
  if (!inv) { res.status(404).json({ error: "Invitation not found" }); return; }
  const [evt] = await db.select().from(rfxEventsTable).where(eq(rfxEventsTable.id, inv.rfxId));
  if (!evt) { res.status(404).json({ error: "RFx not found" }); return; }
  if (evt.status !== "open") { res.status(409).json({ error: `Event is ${evt.status}, not accepting bids` }); return; }
  if (evt.closesAt && new Date() >= new Date(evt.closesAt)) {
    res.status(409).json({ error: "Submission window closed" });
    return;
  }
  if (parsed.data.kind === "alternative" && !evt.alternativeBidsAllowed) {
    res.status(409).json({ error: "Alternative bids not allowed for this RFx" });
    return;
  }
  // Idempotency: replace any existing draft/sealed envelope of the same kind
  // for this invitation. Vendor can re-submit until the deadline.
  await db.delete(rfxEnvelopesTable).where(and(
    eq(rfxEnvelopesTable.invitationId, invitationId),
    eq(rfxEnvelopesTable.kind, parsed.data.kind),
  ));
  const sealed = await sealEnvelopeForKind(inv.rfxId, parsed.data.kind, {
    answers: parsed.data.answers,
    meta: { vendorId: v.vendorId, submittedAt: new Date().toISOString() },
  });
  const [envelope] = await db.insert(rfxEnvelopesTable).values({
    invitationId: inv.id,
    rfxId: inv.rfxId,
    kind: parsed.data.kind,
    status: "sealed",
    sealedPayload: sealed.ciphertext,
    iv: sealed.iv,
    authTag: sealed.authTag,
    wrappedKeyId: sealed.keyRowId,
    submittedAt: new Date(),
  }).returning();
  if ((parsed.data.files ?? []).length > 0) {
    await db.insert(rfxEnvelopeFilesTable).values(parsed.data.files!.map(f => ({
      envelopeId: envelope.id,
      questionId: f.questionId ?? null,
      fileUrl: f.fileUrl,
      originalName: f.originalName ?? "",
      mime: f.mime ?? "",
      sizeBytes: f.sizeBytes ?? 0,
    })));
  }
  // Bump invitation to submitted once any envelope of any kind exists.
  await db.update(rfxInvitationsTable).set({ status: "submitted", submittedAt: new Date() })
    .where(eq(rfxInvitationsTable.id, inv.id));
  res.status(201).json({ id: envelope.id, kind: envelope.kind, status: envelope.status });
});

// ─── Vendor clarifications ──────────────────────────────────────────────────

const AskClarBody = z.object({ question: z.string().min(1) });

router.post("/vendor/rfx/:invitationId/clarifications", async (req, res) => {
  const v = vendor(req);
  const invitationId = Number(req.params.invitationId);
  const parsed = AskClarBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [inv] = await db.select().from(rfxInvitationsTable).where(and(
    eq(rfxInvitationsTable.id, invitationId), eq(rfxInvitationsTable.vendorId, v.vendorId),
  ));
  if (!inv) { res.status(404).json({ error: "Invitation not found" }); return; }
  const [row] = await db.insert(rfxClarificationsTable).values({
    rfxId: inv.rfxId,
    invitationId: inv.id,
    fromRole: "vendor",
    question: parsed.data.question,
    askedBy: `vendor:${v.vendorId}`,
  }).returning();
  res.status(201).json(row);
});

export default router;
