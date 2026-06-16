import { Router, type IRouter } from "express";
import {
  db,
  vendorMasterTable,
  vendorDocumentsTable,
  vendorQualificationsTable,
  vendorKpisTable,
  vendorRiskEventsTable,
  vendorQuestionnaireTemplatesTable,
  vendorQuestionnaireResponsesTable,
  purchaseOrdersTable,
  purchaseRequisitionsTable,
  rfxInvitationsTable,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod/v4";
import { logActivity } from "./activity";
import { requireRole } from "../lib/guard";

// Internal-facing vendor master CRUD. All endpoints mounted behind the
// global `requireAuth` chain in app.ts, so `req.user` is always populated
// and gated on access_pmo or is_super_admin.

const router: IRouter = Router();

const WRITE_ROLES = ["pm", "pmo", "hod", "scm", "initiator"];

// ─── Helpers ────────────────────────────────────────────────────────────────

function actorRef(req: { user?: { employeeId: string | null; fullName: string | null; email: string } }): string {
  return req.user?.employeeId ?? req.user?.email ?? "unknown";
}

// Segments rank in this order; segment_changed audit messages render the
// promote/demote direction so the activity feed is readable.
const SEGMENT_RANK: Record<string, number> = {
  blocked: 0, provisional: 1, approved: 2, preferred: 3, strategic: 4,
};

// ─── Vendor master CRUD ─────────────────────────────────────────────────────

const ListVendorsQuery = z.object({
  segment: z.enum(["strategic", "preferred", "approved", "provisional", "blocked"]).optional(),
  category: z.string().optional(),
  region: z.string().optional(),
  risk: z.enum(["green", "amber", "red", "unknown"]).optional(),
  q: z.string().optional(),
});

router.get("/vendors", async (req, res) => {
  const qp = ListVendorsQuery.safeParse(req.query);
  const rows = await db.select().from(vendorMasterTable).orderBy(desc(vendorMasterTable.updatedAt));
  let out = rows;
  if (qp.success) {
    const { segment, category, region, risk, q } = qp.data;
    if (segment) out = out.filter(v => v.segment === segment);
    if (category) out = out.filter(v => v.category?.toLowerCase().includes(category.toLowerCase()));
    if (region) out = out.filter(v => v.region?.toLowerCase().includes(region.toLowerCase()));
    if (risk) out = out.filter(v => v.riskStatus === risk);
    if (q) {
      const needle = q.toLowerCase();
      out = out.filter(v =>
        v.name.toLowerCase().includes(needle) ||
        (v.legalName ?? "").toLowerCase().includes(needle) ||
        (v.email ?? "").toLowerCase().includes(needle) ||
        (v.sapVendorCode ?? "").toLowerCase().includes(needle)
      );
    }
  }
  res.json(out);
});

const CreateVendorBody = z.object({
  name: z.string().min(1),
  legalName: z.string().optional(),
  gst: z.string().optional(),
  pan: z.string().optional(),
  country: z.string().optional(),
  region: z.string().optional(),
  category: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  website: z.string().optional(),
  address: z.string().optional(),
  sapVendorCode: z.string().optional(),
  segment: z.enum(["strategic", "preferred", "approved", "provisional", "blocked"]).optional(),
  authUserId: z.string().uuid().optional(),
  profileExtras: z.record(z.unknown()).optional(),
});

router.post("/vendors", requireRole(...WRITE_ROLES), async (req, res) => {
  const parsed = CreateVendorBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const data = parsed.data;
  try {
    const [row] = await db.insert(vendorMasterTable).values({
      name: data.name,
      legalName: data.legalName ?? "",
      gst: data.gst ?? "",
      pan: data.pan ?? "",
      country: data.country ?? "IN",
      region: data.region ?? "",
      category: data.category ?? "",
      email: data.email ?? "",
      phone: data.phone ?? "",
      website: data.website ?? "",
      address: data.address ?? "",
      sapVendorCode: data.sapVendorCode || null,
      segment: data.segment ?? "provisional",
      authUserId: data.authUserId,
      profileExtras: data.profileExtras ?? {},
    }).returning();
    await logActivity("vendor_registered", `${row.name} registered by ${actorRef(req)}`, row.id, "vendor", null);
    res.status(201).json(row);
  } catch (err: unknown) {
    // unique violation on sap_vendor_code
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("pmo_vendor_master_sap_vendor_code_unique")) {
      res.status(409).json({ error: "SAP vendor code already exists" });
      return;
    }
    throw err;
  }
});

router.get("/vendors/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [vendor] = await db.select().from(vendorMasterTable).where(eq(vendorMasterTable.id, id));
  if (!vendor) { res.status(404).json({ error: "Vendor not found" }); return; }
  const [docs, quals, kpis, risks, responses] = await Promise.all([
    db.select().from(vendorDocumentsTable).where(eq(vendorDocumentsTable.vendorId, id)).orderBy(desc(vendorDocumentsTable.createdAt)),
    db.select().from(vendorQualificationsTable).where(eq(vendorQualificationsTable.vendorId, id)).orderBy(desc(vendorQualificationsTable.createdAt)),
    db.select().from(vendorKpisTable).where(eq(vendorKpisTable.vendorId, id)).orderBy(desc(vendorKpisTable.period)),
    db.select().from(vendorRiskEventsTable).where(eq(vendorRiskEventsTable.vendorId, id)).orderBy(desc(vendorRiskEventsTable.createdAt)),
    db.select().from(vendorQuestionnaireResponsesTable).where(eq(vendorQuestionnaireResponsesTable.vendorId, id)).orderBy(desc(vendorQuestionnaireResponsesTable.submittedAt)),
  ]);
  res.json({ vendor, documents: docs, qualifications: quals, kpis, riskEvents: risks, questionnaireResponses: responses });
});

const UpdateVendorBody = CreateVendorBody.partial();

router.patch("/vendors/:id", requireRole(...WRITE_ROLES), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = UpdateVendorBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const patch: Record<string, unknown> = { ...parsed.data };
  if (patch.sapVendorCode === "") patch.sapVendorCode = null;
  const [row] = await db.update(vendorMasterTable).set(patch).where(eq(vendorMasterTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Vendor not found" }); return; }
  await logActivity("vendor_updated", `${row.name} updated by ${actorRef(req)}`, row.id, "vendor", null);
  res.json(row);
});

// ─── Segment change with audit ──────────────────────────────────────────────

const SegmentChangeBody = z.object({
  segment: z.enum(["strategic", "preferred", "approved", "provisional", "blocked"]),
  reason: z.string().optional(),
});

router.post("/vendors/:id/segment", requireRole(...WRITE_ROLES), async (req, res) => {
  const id = Number(req.params.id);
  const parsed = SegmentChangeBody.safeParse(req.body);
  if (!Number.isFinite(id) || !parsed.success) {
    res.status(400).json({ error: parsed.success ? "Invalid id" : parsed.error.message });
    return;
  }
  const [current] = await db.select().from(vendorMasterTable).where(eq(vendorMasterTable.id, id));
  if (!current) { res.status(404).json({ error: "Vendor not found" }); return; }
  if (current.segment === parsed.data.segment) { res.json(current); return; }
  const [updated] = await db.update(vendorMasterTable).set({ segment: parsed.data.segment }).where(eq(vendorMasterTable.id, id)).returning();
  const dir = (SEGMENT_RANK[parsed.data.segment] ?? 0) > (SEGMENT_RANK[current.segment] ?? 0) ? "promoted" : "demoted";
  await logActivity(
    "vendor_segment_changed",
    `${current.name} ${dir} ${current.segment} → ${parsed.data.segment} by ${actorRef(req)}${parsed.data.reason ? ` (${parsed.data.reason})` : ""}`,
    id, "vendor", null,
  );
  res.json(updated);
});

// ─── Risk status override ───────────────────────────────────────────────────

const RiskStatusBody = z.object({
  riskStatus: z.enum(["green", "amber", "red", "unknown"]),
  reason: z.string().optional(),
});

router.post("/vendors/:id/risk-status", requireRole(...WRITE_ROLES), async (req, res) => {
  const id = Number(req.params.id);
  const parsed = RiskStatusBody.safeParse(req.body);
  if (!Number.isFinite(id) || !parsed.success) {
    res.status(400).json({ error: parsed.success ? "Invalid id" : parsed.error.message });
    return;
  }
  const [updated] = await db.update(vendorMasterTable).set({ riskStatus: parsed.data.riskStatus }).where(eq(vendorMasterTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Vendor not found" }); return; }
  await logActivity("vendor_risk_set", `${updated.name} → ${parsed.data.riskStatus} by ${actorRef(req)}`, id, "vendor", null);
  res.json(updated);
});

// ─── Documents ──────────────────────────────────────────────────────────────

const RegisterDocBody = z.object({
  kind: z.enum(["registration", "gst", "pan", "iso", "insurance", "financial", "msme", "tax_residency", "other"]),
  fileUrl: z.string().min(1),
  originalName: z.string().optional(),
  mime: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  notes: z.string().optional(),
  expiresAt: z.string().datetime().optional(),
});

router.post("/vendors/:id/documents", requireRole(...WRITE_ROLES), async (req, res) => {
  const id = Number(req.params.id);
  const parsed = RegisterDocBody.safeParse(req.body);
  if (!Number.isFinite(id) || !parsed.success) {
    res.status(400).json({ error: parsed.success ? "Invalid id" : parsed.error.message });
    return;
  }
  const [doc] = await db.insert(vendorDocumentsTable).values({
    vendorId: id,
    kind: parsed.data.kind,
    fileUrl: parsed.data.fileUrl,
    originalName: parsed.data.originalName ?? "",
    mime: parsed.data.mime ?? "",
    sizeBytes: parsed.data.sizeBytes ?? 0,
    notes: parsed.data.notes ?? "",
    expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
  }).returning();
  res.status(201).json(doc);
});

router.post("/vendors/:id/documents/:docId/verify", requireRole(...WRITE_ROLES), async (req, res) => {
  const docId = Number(req.params.docId);
  const id = Number(req.params.id);
  if (!Number.isFinite(docId) || !Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [doc] = await db.update(vendorDocumentsTable)
    .set({ verifiedBy: actorRef(req), verifiedAt: new Date() })
    .where(and(eq(vendorDocumentsTable.id, docId), eq(vendorDocumentsTable.vendorId, id)))
    .returning();
  if (!doc) { res.status(404).json({ error: "Document not found" }); return; }
  await logActivity("vendor_doc_verified", `${doc.kind} verified by ${actorRef(req)}`, id, "vendor", null);
  res.json(doc);
});

router.delete("/vendors/:id/documents/:docId", requireRole("pmo", "pm", "scm"), async (req, res) => {
  const docId = Number(req.params.docId);
  const id = Number(req.params.id);
  if (!Number.isFinite(docId) || !Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(vendorDocumentsTable).where(and(eq(vendorDocumentsTable.id, docId), eq(vendorDocumentsTable.vendorId, id)));
  res.status(204).send();
});

// ─── Qualifications ─────────────────────────────────────────────────────────

const DecideQualBody = z.object({
  category: z.string().min(1),
  region: z.string().optional(),
  businessUnit: z.string().optional(),
  status: z.enum(["pending", "qualified", "disqualified", "expired"]),
  notes: z.string().optional(),
  expiresAt: z.string().datetime().optional(),
});

router.post("/vendors/:id/qualifications", requireRole(...WRITE_ROLES), async (req, res) => {
  const id = Number(req.params.id);
  const parsed = DecideQualBody.safeParse(req.body);
  if (!Number.isFinite(id) || !parsed.success) {
    res.status(400).json({ error: parsed.success ? "Invalid id" : parsed.error.message });
    return;
  }
  const { category, region = "", businessUnit = "", status, notes = "", expiresAt } = parsed.data;
  // upsert on (vendor, category, region, BU)
  const [existing] = await db.select().from(vendorQualificationsTable).where(and(
    eq(vendorQualificationsTable.vendorId, id),
    eq(vendorQualificationsTable.category, category),
    eq(vendorQualificationsTable.region, region),
    eq(vendorQualificationsTable.businessUnit, businessUnit),
  ));
  let row;
  if (existing) {
    [row] = await db.update(vendorQualificationsTable).set({
      status, notes, decidedBy: actorRef(req), decidedAt: new Date(),
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    }).where(eq(vendorQualificationsTable.id, existing.id)).returning();
  } else {
    [row] = await db.insert(vendorQualificationsTable).values({
      vendorId: id, category, region, businessUnit, status, notes,
      decidedBy: actorRef(req), decidedAt: new Date(),
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    }).returning();
  }
  // Auto-promote provisional → approved when first qualification lands
  if (status === "qualified") {
    const [vendor] = await db.select().from(vendorMasterTable).where(eq(vendorMasterTable.id, id));
    if (vendor?.segment === "provisional") {
      await db.update(vendorMasterTable).set({ segment: "approved" }).where(eq(vendorMasterTable.id, id));
      await logActivity("vendor_segment_changed", `${vendor.name} auto-promoted provisional → approved on qualification`, id, "vendor", null);
    }
  }
  await logActivity("vendor_qualification_decided",
    `${category}/${region}/${businessUnit} → ${status} by ${actorRef(req)}`,
    id, "vendor", null);
  res.json(row);
});

// ─── KPIs ───────────────────────────────────────────────────────────────────

const IngestKpiBody = z.object({
  period: z.string().min(1),
  onTimeDeliveryPct: z.number().int().min(0).max(100).optional(),
  invoiceAccuracyPct: z.number().int().min(0).max(100).optional(),
  qualityPct: z.number().int().min(0).max(100).optional(),
  responsivenessPct: z.number().int().min(0).max(100).optional(),
  source: z.enum(["auto", "manual", "sap"]).optional(),
  notes: z.string().optional(),
});

router.post("/vendors/:id/kpis", requireRole(...WRITE_ROLES), async (req, res) => {
  const id = Number(req.params.id);
  const parsed = IngestKpiBody.safeParse(req.body);
  if (!Number.isFinite(id) || !parsed.success) {
    res.status(400).json({ error: parsed.success ? "Invalid id" : parsed.error.message });
    return;
  }
  const d = parsed.data;
  const dims = [d.onTimeDeliveryPct, d.invoiceAccuracyPct, d.qualityPct, d.responsivenessPct].filter((v): v is number => typeof v === "number");
  const composite = dims.length > 0 ? Math.round(dims.reduce((s, v) => s + v, 0) / dims.length) : null;
  const [row] = await db.insert(vendorKpisTable).values({
    vendorId: id,
    period: d.period,
    onTimeDeliveryPct: d.onTimeDeliveryPct ?? null,
    invoiceAccuracyPct: d.invoiceAccuracyPct ?? null,
    qualityPct: d.qualityPct ?? null,
    responsivenessPct: d.responsivenessPct ?? null,
    compositeScore: composite,
    source: d.source ?? "manual",
    notes: d.notes ?? "",
  }).returning();
  await logActivity("vendor_kpi_ingested", `${d.period} composite ${composite ?? "n/a"} by ${actorRef(req)}`, id, "vendor", null);
  res.json(row);
});

// ─── Risk events ────────────────────────────────────────────────────────────

const RaiseRiskBody = z.object({
  source: z.enum(["internal", "legal", "esg", "financial", "sanctions", "news", "other"]),
  severity: z.enum(["green", "amber", "red"]),
  summary: z.string().min(1),
  link: z.string().optional(),
});

router.post("/vendors/:id/risk-events", requireRole(...WRITE_ROLES), async (req, res) => {
  const id = Number(req.params.id);
  const parsed = RaiseRiskBody.safeParse(req.body);
  if (!Number.isFinite(id) || !parsed.success) {
    res.status(400).json({ error: parsed.success ? "Invalid id" : parsed.error.message });
    return;
  }
  const [row] = await db.insert(vendorRiskEventsTable).values({
    vendorId: id, ...parsed.data,
  }).returning();
  // Bump vendor risk status if this is the most severe unresolved event.
  if (parsed.data.severity === "red") {
    await db.update(vendorMasterTable).set({ riskStatus: "red" }).where(eq(vendorMasterTable.id, id));
  } else if (parsed.data.severity === "amber") {
    const [v] = await db.select().from(vendorMasterTable).where(eq(vendorMasterTable.id, id));
    if (v && v.riskStatus !== "red") {
      await db.update(vendorMasterTable).set({ riskStatus: "amber" }).where(eq(vendorMasterTable.id, id));
    }
  }
  await logActivity("vendor_risk_flagged", `${parsed.data.severity.toUpperCase()} • ${parsed.data.summary} by ${actorRef(req)}`, id, "vendor", null);
  res.status(201).json(row);
});

router.post("/vendors/:id/risk-events/:eventId/resolve", requireRole(...WRITE_ROLES), async (req, res) => {
  const id = Number(req.params.id);
  const eventId = Number(req.params.eventId);
  if (!Number.isFinite(id) || !Number.isFinite(eventId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db.update(vendorRiskEventsTable)
    .set({ resolvedAt: new Date(), resolvedBy: actorRef(req) })
    .where(and(eq(vendorRiskEventsTable.id, eventId), eq(vendorRiskEventsTable.vendorId, id)))
    .returning();
  if (!row) { res.status(404).json({ error: "Risk event not found" }); return; }
  // Recompute rolled-up vendor risk_status from remaining unresolved events.
  const open = await db.select().from(vendorRiskEventsTable).where(eq(vendorRiskEventsTable.vendorId, id));
  const unresolved = open.filter(e => !e.resolvedAt);
  const next = unresolved.some(e => e.severity === "red") ? "red"
    : unresolved.some(e => e.severity === "amber") ? "amber"
    : "green";
  await db.update(vendorMasterTable).set({ riskStatus: next }).where(eq(vendorMasterTable.id, id));
  res.json(row);
});

// ─── Questionnaire templates (admin-managed) ────────────────────────────────

router.get("/vendor-questionnaire-templates", async (_req, res) => {
  const rows = await db.select().from(vendorQuestionnaireTemplatesTable).orderBy(desc(vendorQuestionnaireTemplatesTable.updatedAt));
  res.json(rows);
});

const TemplateBody = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  version: z.number().int().positive().optional(),
  isActive: z.number().int().optional(),
  questions: z.array(z.object({
    id: z.string(),
    label: z.string(),
    description: z.string().optional(),
    kind: z.enum(["text", "number", "select", "multi", "file", "bool"]),
    options: z.array(z.string()).optional(),
    required: z.boolean().optional(),
    section: z.string().optional(),
  })),
});

router.post("/vendor-questionnaire-templates", requireRole(...WRITE_ROLES), async (req, res) => {
  const parsed = TemplateBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [row] = await db.insert(vendorQuestionnaireTemplatesTable).values({
    name: parsed.data.name,
    description: parsed.data.description ?? "",
    version: parsed.data.version ?? 1,
    isActive: parsed.data.isActive ?? 1,
    questions: parsed.data.questions,
  }).returning();
  res.status(201).json(row);
});

router.patch("/vendor-questionnaire-templates/:id", requireRole(...WRITE_ROLES), async (req, res) => {
  const id = Number(req.params.id);
  const parsed = TemplateBody.partial().safeParse(req.body);
  if (!Number.isFinite(id) || !parsed.success) {
    res.status(400).json({ error: parsed.success ? "Invalid id" : parsed.error.message });
    return;
  }
  const [row] = await db.update(vendorQuestionnaireTemplatesTable).set(parsed.data).where(eq(vendorQuestionnaireTemplatesTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Template not found" }); return; }
  res.json(row);
});

// Delete a vendor (master) + its owned detail rows (documents / qualifications
// / KPIs / risk events / questionnaire responses). BLOCKED when the vendor is
// referenced by procurement (PR/PO) or a sourcing invitation — those carry
// governance + audit weight and must be removed first.
router.delete("/vendors/:id", requireRole("pmo", "pm", "scm"), async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [vendor] = await db.select().from(vendorMasterTable).where(eq(vendorMasterTable.id, id));
  if (!vendor) { res.status(404).json({ error: "Vendor not found" }); return; }

  const pos = await db.select({ id: purchaseOrdersTable.id }).from(purchaseOrdersTable).where(eq(purchaseOrdersTable.vendorId, id));
  const prs = await db.select({ id: purchaseRequisitionsTable.id }).from(purchaseRequisitionsTable).where(eq(purchaseRequisitionsTable.vendorId, id));
  const invs = await db.select({ id: rfxInvitationsTable.id }).from(rfxInvitationsTable).where(eq(rfxInvitationsTable.vendorId, id));
  const refs: string[] = [];
  if (pos.length) refs.push(`${pos.length} purchase order(s)`);
  if (prs.length) refs.push(`${prs.length} purchase requisition(s)`);
  if (invs.length) refs.push(`${invs.length} sourcing invitation(s)`);
  if (refs.length) {
    res.status(409).json({ error: `Vendor is referenced by ${refs.join(", ")}. Remove those first.` });
    return;
  }

  await db.delete(vendorDocumentsTable).where(eq(vendorDocumentsTable.vendorId, id));
  await db.delete(vendorQualificationsTable).where(eq(vendorQualificationsTable.vendorId, id));
  await db.delete(vendorKpisTable).where(eq(vendorKpisTable.vendorId, id));
  await db.delete(vendorRiskEventsTable).where(eq(vendorRiskEventsTable.vendorId, id));
  await db.delete(vendorQuestionnaireResponsesTable).where(eq(vendorQuestionnaireResponsesTable.vendorId, id));
  await db.delete(vendorMasterTable).where(eq(vendorMasterTable.id, id));
  await logActivity("vendor_deleted", `Vendor "${vendor.name}" deleted`, id, "vendor");
  res.sendStatus(204);
});

export default router;
