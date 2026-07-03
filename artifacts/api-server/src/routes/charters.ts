import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { db, chartersTable, vendorsTable, risksTable, squadMembersTable, approvalsTable, usersTable, activityTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { matchBand, CAPEX_CATEGORY, CAPEX_KIND, signatoriesFromChain } from "../lib/doa-resolver";

// generate_charter_nfa.py lives at apps/pmo/scripts/. This bundle runs from
// apps/pmo/artifacts/api-server/dist/index.mjs, so walk three dirs up.
const CHARTER_NFA_GENERATOR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../scripts/generate_charter_nfa.py",
);
const PYTHON_BIN = process.env.PYTHON_BIN || "python3";
import {
  CreateCharterBody,
  UpdateCharterBody,
  UpdateCharterParams,
  GetCharterParams,
  SubmitCharterParams,
  ListCharterVendorsParams,
  AddCharterVendorParams,
  AddCharterVendorBody,
  ListCharterRisksParams,
  AddCharterRiskParams,
  AddCharterRiskBody,
  ListCharterSquadParams,
  AddSquadMemberParams,
  AddSquadMemberBody,
  ScmNegotiateParams,
  ScmNegotiateBody,
  EnterFinanceOrderParams,
  EnterFinanceOrderBody,
  ListChartersQueryParams,
} from "@workspace/api-zod";
import { logActivity } from "./activity";
import { requireRole } from "../lib/guard";
import { documensoConfigured, docxToPdf, sendForSignature, signersFromSignatories, getDocumensoDocument, nextPendingSigner, type EsignEnvelope } from "../integrations/documenso";
import { notifySignerTurn } from "../lib/esign-notify";
import { enrichSignatoryEmails } from "../lib/signatory-email";

const router: IRouter = Router();

const WRITE_ROLES = ["pm", "pmo", "hod", "initiator"];

// Extended PATCH body — accepts all Charter+NFA merged columns.
// Lives inline until lib/api-zod is regenerated from the updated OpenAPI spec.
const ExtendedCharterPatch = z.object({
  // Workflow status — lets the Charters Kanban board persist a drag-to-move
  // between status columns. (PMO has no functional roles, so any user can.)
  status: z.enum([
    "draft", "submitted", "parallel_review", "scm_review",
    "chairman_review", "finance_review", "pmo_review", "approved", "active", "rejected",
  ]).optional(),
  // Narrative
  executiveSummary: z.string().optional(),
  currentState: z.string().optional(),
  businessDrivers: z.string().optional(),
  outOfScope: z.string().optional(),
  constraints: z.string().optional(),
  assumptions: z.string().optional(),
  potentialAdditionalBudget: z.string().optional(),
  // Metadata
  category: z.string().optional(),
  entity: z.string().optional(),
  revision: z.number().int().optional(),
  // Project Charter template fields
  projectSponsor: z.string().optional(),
  pmType: z.string().optional(),
  pmName: z.string().optional(),
  projectApprovalDate: z.string().optional(),
  lastRevisionDate: z.string().optional(),
  businessOutcome: z.string().optional(),
  scopeLimitations: z.string().optional(),
  risks: z.string().optional(),
  vendorMatrix: z.object({ columns: z.array(z.string()), rows: z.array(z.array(z.string())) }).optional(),
  // User-defined extra fields (step-2 form), in author-arranged order.
  customFields: z.array(z.object({ id: z.string(), label: z.string(), value: z.string() })).optional(),
  // Author-arranged order of the narrative sections (drag-to-reorder on the
  // e-NFA form). Stashed in the scoringWeights jsonb to avoid a DB migration;
  // the DOCX generator reads it to order sections 2…N.
  sectionOrder: z.array(z.string()).optional(),
  // DOA (Delegation of Authority) the raiser is acting under. No column of its
  // own — stashed in the scoringWeights jsonb alongside sectionOrder.
  doa: z.string().optional(),
  // Investment summary
  kind: z.enum(["capex", "opex", "mixed"]).optional(),
  capexAmount: z.coerce.number().optional(),
  opexAmount: z.coerce.number().optional(),
  fyRecurring: z.array(z.object({ fyLabel: z.string(), amountInr: z.coerce.number() })).optional(),
  roiPerAnnum: z.coerce.number().optional(),
  paybackMonths: z.number().int().optional(),
  previousNfaAmount: z.coerce.number().optional(),
  leAmount: z.coerce.number().optional(),
  // Absorbed NFA fields
  noteNo: z.string().optional(),
  department: z.string().optional(),
  location: z.string().optional(),
  locationRequired: z.string().optional(),
  noteDate: z.string().optional(),
  subject: z.string().optional(),
  background: z.string().optional(),
  requirementItems: z.array(z.object({ item: z.string(), details: z.string() })).optional(),
  orderFormNote: z.string().optional(),
  totalUsd: z.string().optional(),
  totalInr: z.string().optional(),
  recommendation: z.string().optional(),
  // Roadmap / governance / attachments
  milestones: z.array(z.object({ milestone: z.string(), responsible: z.string().optional(), targetDate: z.string().optional(), status: z.string().optional() })).optional(),
  kpis: z.array(z.object({ kpi: z.string(), baseline: z.string().optional(), goal: z.string().optional() })).optional(),
  steeringCommittee: z.array(z.object({ role: z.string(), name: z.string(), empCode: z.string().optional() })).optional(),
  keyProjectMembers: z.array(z.object({ role: z.string(), name: z.string(), empCode: z.string().optional() })).optional(),
  // Manual approval signatory chain (drives the approval order on submit).
  signatories: z.array(z.object({ role: z.string(), name: z.string().optional(), email: z.string().optional(), empCode: z.string().optional(), designation: z.string().optional(), status: z.string().optional() })).optional(),
  attachments: z.array(z.object({ name: z.string(), url: z.string(), size: z.number().optional(), mimeType: z.string().optional() })).optional(),
});

// Columns that hold numerics in Postgres but arrive as numbers from the client.
// We stringify before insert/update because drizzle's pg numeric column type expects strings.
const NUMERIC_FIELDS = new Set([
  "capexAmount", "opexAmount", "roiPerAnnum", "previousNfaAmount", "leAmount",
]);

async function getCharterWithRelations(id: number) {
  const [charter] = await db.select().from(chartersTable).where(eq(chartersTable.id, id));
  return charter;
}

// List charters
router.get("/charters", async (req, res): Promise<void> => {
  const qp = ListChartersQueryParams.safeParse(req.query);
  let query = db.select().from(chartersTable);
  const charters = await db.select().from(chartersTable).orderBy(desc(chartersTable.createdAt));
  let filtered = charters;
  if (qp.success && qp.data.status) {
    filtered = filtered.filter(c => c.status === qp.data.status);
  }
  if (qp.success && qp.data.submittedBy) {
    filtered = filtered.filter(c => c.submittedById === Number(qp.data.submittedBy));
  }
  res.json(filtered);
});

// Create charter
router.post("/charters", requireRole(...WRITE_ROLES), async (req, res): Promise<void> => {
  const parsed = CreateCharterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Server-side business-case validation:
  // description = Business Justification (≥100 characters)
  // scope       = Scope Summary (≥50 characters)
  const descLen = (parsed.data.description ?? "").trim().length;
  if (descLen < 100) {
    res.status(422).json({
      error: `Business Justification must be at least 100 characters (currently ${descLen}).`,
      field: "description",
      charCount: descLen,
      required: 100,
    });
    return;
  }
  const scopeLen = (parsed.data.scope ?? "").trim().length;
  if (scopeLen < 50) {
    res.status(422).json({
      error: `Scope Summary must be at least 50 characters (currently ${scopeLen}).`,
      field: "scope",
      charCount: scopeLen,
      required: 50,
    });
    return;
  }

  const [charter] = await db.insert(chartersTable).values({
    ...parsed.data,
    tentativeBudget: String(parsed.data.tentativeBudget),
    nfaThreshold: parsed.data.nfaThreshold != null ? String(parsed.data.nfaThreshold) : null,
  }).returning();

  // Generate server-side PC reference ID: PC-YYYY-XXXXX (padded charter DB id)
  // This guarantees uniqueness because it is derived from the auto-increment PK.
  const pcYear = new Date().getFullYear();
  const pcId = `PC-${pcYear}-${String(charter.id).padStart(5, "0")}`;

  // Embed the server-generated pcId in strategicAlignmentTags.
  // Strip any client-submitted PC_ID: tag (cannot be trusted) and prepend the canonical one.
  const clientTags = (charter.strategicAlignmentTags as string[] | null) ?? [];
  const tagsWithPcId = [`PC_ID:${pcId}`, ...clientTags.filter(t => !t.startsWith("PC_ID:"))];
  const [updatedCharter] = await db.update(chartersTable)
    .set({ strategicAlignmentTags: tagsWithPcId })
    .where(eq(chartersTable.id, charter.id))
    .returning();

  await logActivity("charter_created", `Charter "${charter.title}" created (ref: ${pcId})`, charter.id, "charter", charter.submittedById);
  res.status(201).json({ ...formatCharter(updatedCharter ?? charter), pcId });
});

// Get charter
router.get("/charters/:id", async (req, res): Promise<void> => {
  const params = GetCharterParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const charter = await getCharterWithRelations(params.data.id);
  if (!charter) {
    res.status(404).json({ error: "Charter not found" });
    return;
  }
  res.json(formatCharter(charter));
});

// Human labels for the edit-history log (falls back to the raw key otherwise).
const CHARTER_FIELD_LABELS: Record<string, string> = {
  title: "Title", description: "Description", scope: "Scope", deliverables: "Deliverables",
  solutionComparison: "Solution comparison", tentativeBudget: "Tentative budget",
  startDate: "Start date", endDate: "End date", durationDays: "Duration (days)",
  toplineImprovement: "Topline improvement", bottomLineOptimization: "Bottom-line optimization",
  complianceBenefits: "Compliance benefits", productivityImprovement: "Productivity improvement",
  subject: "Subject", background: "Background", recommendation: "Recommendation",
  modeOfProcurement: "Mode of procurement", vendorDetails: "Vendor details", status: "Status",
};

// Update charter
router.patch("/charters/:id", requireRole(...WRITE_ROLES), async (req, res): Promise<void> => {
  const params = UpdateCharterParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  // First pass: validate against the legacy orval schema (silently drops unknown keys).
  const legacy = UpdateCharterBody.safeParse(req.body);
  if (!legacy.success) {
    res.status(400).json({ error: legacy.error.message });
    return;
  }
  // Second pass: catch the Charter+NFA merged columns the legacy schema doesn't know about.
  const extended = ExtendedCharterPatch.safeParse(req.body);
  if (!extended.success) {
    res.status(400).json({ error: extended.error.message });
    return;
  }
  const { sectionOrder, doa, ...extData } = extended.data;
  const updateData: Record<string, unknown> = { ...legacy.data, ...extData };
  // Snapshot the pre-edit row so we can log exactly which fields changed.
  const [existing] = await db.select().from(chartersTable).where(eq(chartersTable.id, params.data.id));
  // sectionOrder + doa have no columns of their own — merge into the scoringWeights jsonb.
  if (sectionOrder !== undefined || doa !== undefined) {
    updateData.scoringWeights = {
      ...((existing?.scoringWeights as Record<string, unknown>) ?? {}),
      ...(sectionOrder !== undefined ? { sectionOrder } : {}),
      ...(doa !== undefined ? { doa } : {}),
    };
  }
  if (legacy.data.tentativeBudget !== undefined) {
    updateData.tentativeBudget = String(legacy.data.tentativeBudget);
  }
  if ((legacy.data as Record<string, unknown>).nfaThreshold != null) {
    updateData.nfaThreshold = String((legacy.data as Record<string, unknown>).nfaThreshold);
  }
  // numeric columns must arrive as strings for drizzle's pg numeric type
  for (const k of NUMERIC_FIELDS) {
    if (updateData[k] != null) updateData[k] = String(updateData[k]);
  }
  const [charter] = await db.update(chartersTable).set(updateData).where(eq(chartersTable.id, params.data.id)).returning();
  if (!charter) {
    res.status(404).json({ error: "Charter not found" });
    return;
  }
  // Edit-history trail: record the fields that actually changed so the e-NFA
  // detail view can show an audit log. The editor's name is embedded in the
  // message (activity.userId maps to the pmo users table, which req.user isn't).
  const changed = Object.keys(updateData).filter((k) => String((existing as Record<string, unknown>)?.[k] ?? "") !== String(updateData[k] ?? ""));
  if (changed.length > 0) {
    const labels = changed.map((k) => CHARTER_FIELD_LABELS[k] ?? k).join(", ");
    const who = req.user?.fullName || req.user?.email || "Someone";
    await logActivity("nfa_edited", `${who} edited the e-NFA — changed: ${labels}`, charter.id, "charter");
  }
  res.json(formatCharter(charter));
});

// Edit history for a charter / e-NFA (the audit trail shown beside Vendors).
router.get("/charters/:id/activity", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const rows = await db.select().from(activityTable)
    .where(and(eq(activityTable.entityType, "charter"), eq(activityTable.entityId, id)))
    .orderBy(desc(activityTable.createdAt));
  res.json(rows);
});

// DOA matrix for a charter / e-NFA — the approver chain. Post-submit returns the
// stored signatories (with their decision status); in draft it returns a LIVE
// preview resolved from the same CAPEX matrix the standalone e-NFA uses, so the
// project NFA shows its DOA before submission too.
router.get("/charters/:id/doa", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [charter] = await db.select().from(chartersTable).where(eq(chartersTable.id, id));
  if (!charter) { res.status(404).json({ error: "Charter not found" }); return; }
  const location = (charter as Record<string, unknown>).location as string ?? "";
  const amountInr = Number(charter.finalNegotiatedBudget ?? charter.tentativeBudget ?? 0);
  const stored = (charter.signatories as Array<{ role: string; name: string; status?: string }> | null) ?? [];
  if (stored.length > 0) {
    res.json({ source: "stored", location, amountInr, label: null, signatories: stored });
    return;
  }
  const match = await matchBand({ entity: location, category: CAPEX_CATEGORY, kind: CAPEX_KIND, amountInr });
  const signatories = match ? signatoriesFromChain(match.approverRoles as unknown[]) : [];
  res.json({ source: "preview", location, amountInr, label: match?.label ?? null, signatories });
});

// Resolve the DOA chain for an arbitrary (location, amount) — used by the
// charter CREATE form to show the live DOA matrix before the charter exists.
router.get("/doa/resolve", async (req, res): Promise<void> => {
  const location = String(req.query.location ?? "");
  const amountInr = Number(String(req.query.amount ?? "").replace(/[^\d.]/g, "")) || 0;
  const match = await matchBand({ entity: location, category: CAPEX_CATEGORY, kind: CAPEX_KIND, amountInr });
  const signatories = match ? signatoriesFromChain(match.approverRoles as unknown[]) : [];
  res.json({ location, amountInr, label: match?.label ?? null, signatories });
});

// Submit charter
router.post("/charters/:id/submit", requireRole(...WRITE_ROLES), async (req, res): Promise<void> => {
  const params = SubmitCharterParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const charter = await getCharterWithRelations(params.data.id);
  if (!charter) {
    res.status(404).json({ error: "Charter not found" });
    return;
  }
  if (charter.status !== "draft") {
    res.status(400).json({ error: "Charter already submitted" });
    return;
  }

  // The manual approval signatory chain wins: if the charter carries a stored
  // chain with at least one real approver, route the approval to exactly those
  // people. Otherwise fall back to resolving the chain from the CAPEX DOA matrix
  // (location + amount) — same matrix the standalone e-NFA uses.
  const stored = (charter.signatories as Array<{ role?: string; name?: string; email?: string; empCode?: string; designation?: string }> | null) ?? [];
  // A row with a resolvable person counts even if Role was left blank — default
  // it, don't silently drop the approver and 422 on "no chain".
  const manual = stored.filter((s) => s?.name?.trim() || s?.email?.trim() || s?.empCode?.trim());

  let signatories: Array<{ role: string; name: string; status: string }>;
  let bandLabel: string | null = null;
  let bandId: number | null = null;

  if (manual.length > 0) {
    // Keep email/empCode — sendCharterEsign needs them to route Documenso signing mail.
    signatories = manual.map((s) => ({ role: s.role?.trim() || s.designation?.trim() || "Approver", name: (s.name ?? "").trim(), email: s.email?.trim() || undefined, empCode: s.empCode?.trim() || undefined, designation: s.designation?.trim() || undefined, status: "pending" }));
  } else {
    const amountInr = Number(charter.finalNegotiatedBudget ?? charter.tentativeBudget ?? 0);
    const match = await matchBand({ entity: charter.location ?? "", category: CAPEX_CATEGORY, kind: CAPEX_KIND, amountInr });
    const chain = (match?.approverRoles as unknown[]) ?? [];
    if (!match || chain.length === 0) {
      res.status(422).json({
        error: "No approval signatory chain set, and no active DOA band covers this NFA — add approvers to the signatory chain, or configure a band at /admin/doa-matrix.",
        context: { location: charter.location, amountInr },
      });
      return;
    }
    signatories = signatoriesFromChain(chain);
    bandLabel = match.label; bandId = match.bandId;
  }

  // One parallel approval per step. Resolve approverId to the PMO user with the
  // step's email (so the email-gated decide endpoint recognises the assignee).
  // ponytail: a non-PMO-user approver leaves approverId null → approvable by any
  // decider/admin; add them to pmo_users to gate it to that one person.
  for (let i = 0; i < signatories.length; i++) {
    const sig = signatories[i]!;
    const email = (manual[i]?.email || (sig.name.includes("@") ? sig.name : "")).toLowerCase();
    const [user] = email ? await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1) : [];
    await db.insert(approvalsTable).values({
      charterId: charter.id,
      approverId: user?.id ?? null,
      approverRole: sig.role,
      stage: "parallel_review",
      status: "pending",
    });
  }

  const [updated] = await db.update(chartersTable)
    .set({ status: "parallel_review", signatories })
    .where(eq(chartersTable.id, params.data.id))
    .returning();
  const approverList = signatories.map((s) => s.name || s.role).join(", ") || "(empty)";
  await logActivity(
    "charter_submitted",
    `Charter "${charter.title}" submitted — ${manual.length ? "manual signatory chain" : `DOA band "${bandLabel}"`} → ${approverList}`,
    charter.id,
    "charter",
    charter.submittedById,
  );

  // Auto-send the DOA chain to Documenso as part of Submit for Approval.
  // Best-effort: a Documenso outage must not block the submission — the
  // manual "Send for e-Signature" button on the charter is the retry path.
  let esign: EsignEnvelope | null = null;
  let esignError: string | null = null;
  if (documensoConfigured()) {
    try {
      esign = await sendCharterEsign(updated);
    } catch (e) {
      esignError = (e as Error).message;
      req.log?.warn({ err: esignError, charterId: charter.id }, "auto e-sign on submit failed");
    }
  }

  res.json({ ...formatCharter(updated), doaBand: { id: bandId, label: manual.length ? "Manual signatory chain" : bandLabel, approverRoles: signatories.map((s) => s.role) }, esign, esignError });
});

// SCM negotiate
router.post("/charters/:id/scm-negotiate", requireRole(...WRITE_ROLES), async (req, res): Promise<void> => {
  const params = ScmNegotiateParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = ScmNegotiateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const charter = await getCharterWithRelations(params.data.id);
  if (!charter) {
    res.status(404).json({ error: "Charter not found" });
    return;
  }

  // Find chairman
  const [chairman] = await db.select().from(usersTable).where(eq(usersTable.role, "chairman")).limit(1);

  // Update scm approval and move to chairman stage
  const [scmApproval] = await db.select().from(approvalsTable)
    .where(and(eq(approvalsTable.charterId, params.data.id), eq(approvalsTable.approverRole, "scm")));

  if (scmApproval) {
    await db.update(approvalsTable).set({
      status: "approved",
      comments: parsed.data.comments ?? null,
      decidedAt: new Date(),
    }).where(eq(approvalsTable.id, scmApproval.id));
  } else {
    await db.insert(approvalsTable).values({
      charterId: params.data.id,
      approverId: parsed.data.approverId ?? null,
      approverRole: "scm",
      stage: "scm_review",
      status: "approved",
      comments: parsed.data.comments ?? null,
      decidedAt: new Date(),
    });
  }

  let nextStatus = "chairman_review";
  if (chairman) {
    await db.insert(approvalsTable).values({
      charterId: params.data.id,
      approverId: chairman.id,
      approverRole: "chairman",
      stage: "chairman_review",
      status: "pending",
    });
  }

  const [updated] = await db.update(chartersTable).set({
    finalNegotiatedBudget: String(parsed.data.finalNegotiatedBudget),
    status: nextStatus,
  }).where(eq(chartersTable.id, params.data.id)).returning();

  await logActivity("scm_negotiated", `SCM completed negotiation for "${charter.title}". Final budget: ${parsed.data.finalNegotiatedBudget}`, charter.id, "charter", parsed.data.approverId);
  res.json(formatCharter(updated));
});

// Finance order
router.post("/charters/:id/finance-order", requireRole(...WRITE_ROLES), async (req, res): Promise<void> => {
  const params = EnterFinanceOrderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = EnterFinanceOrderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const charter = await getCharterWithRelations(params.data.id);
  if (!charter) {
    res.status(404).json({ error: "Charter not found" });
    return;
  }

  // Mark finance approval done
  const [finApproval] = await db.select().from(approvalsTable)
    .where(and(eq(approvalsTable.charterId, params.data.id), eq(approvalsTable.approverRole, "finance")));
  if (finApproval) {
    await db.update(approvalsTable).set({
      status: "approved",
      comments: parsed.data.comments ?? null,
      decidedAt: new Date(),
    }).where(eq(approvalsTable.id, finApproval.id));
  } else {
    await db.insert(approvalsTable).values({
      charterId: params.data.id,
      approverId: parsed.data.approverId ?? null,
      approverRole: "finance",
      stage: "finance_review",
      status: "approved",
      comments: parsed.data.comments ?? null,
      decidedAt: new Date(),
    });
  }

  // Create PMO approval
  const [pmoUser] = await db.select().from(usersTable).where(eq(usersTable.role, "pmo")).limit(1);
  if (pmoUser) {
    await db.insert(approvalsTable).values({
      charterId: params.data.id,
      approverId: pmoUser.id,
      approverRole: "pmo",
      stage: "pmo_review",
      status: "pending",
    });
  }

  const [updated] = await db.update(chartersTable).set({
    internalOrderNumber: parsed.data.internalOrderNumber,
    status: "pmo_review",
  }).where(eq(chartersTable.id, params.data.id)).returning();

  await logActivity("finance_order_entered", `Finance entered SAP order ${parsed.data.internalOrderNumber} for "${charter.title}"`, charter.id, "charter", parsed.data.approverId);
  res.json(formatCharter(updated));
});

// Vendors
router.get("/charters/:id/vendors", async (req, res): Promise<void> => {
  const params = ListCharterVendorsParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const vendors = await db.select().from(vendorsTable).where(eq(vendorsTable.charterId, params.data.id)).orderBy(vendorsTable.createdAt);
  res.json(vendors.map(v => ({
    ...v,
    proposedPrice: Number(v.proposedPrice),
    isSelected: v.isSelected,
  })));
});

router.post("/charters/:id/vendors", requireRole(...WRITE_ROLES), async (req, res): Promise<void> => {
  const params = AddCharterVendorParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = AddCharterVendorBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [vendor] = await db.insert(vendorsTable).values({
    charterId: params.data.id,
    vendorName: parsed.data.vendorName,
    proposedPrice: String(parsed.data.proposedPrice),
    description: parsed.data.description ?? "",
    isSelected: parsed.data.isSelected ?? false,
  }).returning();
  res.status(201).json({ ...vendor, proposedPrice: Number(vendor.proposedPrice) });
});

// Risks
router.get("/charters/:id/risks", async (req, res): Promise<void> => {
  const params = ListCharterRisksParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const risks = await db.select().from(risksTable).where(eq(risksTable.charterId, params.data.id)).orderBy(risksTable.createdAt);
  res.json(risks);
});

router.post("/charters/:id/risks", requireRole(...WRITE_ROLES), async (req, res): Promise<void> => {
  const params = AddCharterRiskParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = AddCharterRiskBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [risk] = await db.insert(risksTable).values({
    charterId: params.data.id,
    ...parsed.data,
    mitigation: parsed.data.mitigation ?? "",
  }).returning();
  res.status(201).json(risk);
});

// Squad
router.get("/charters/:id/squad", async (req, res): Promise<void> => {
  const params = ListCharterSquadParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const members = await db.select().from(squadMembersTable).where(eq(squadMembersTable.charterId, params.data.id)).orderBy(squadMembersTable.createdAt);
  res.json(members);
});

router.post("/charters/:id/squad", requireRole(...WRITE_ROLES), async (req, res): Promise<void> => {
  const params = AddSquadMemberParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = AddSquadMemberBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [member] = await db.insert(squadMembersTable).values({
    charterId: params.data.id,
    ...parsed.data,
  }).returning();
  res.status(201).json(member);
});

function formatCharter(c: Record<string, unknown>) {
  const num = (v: unknown) => (v != null ? Number(v) : null);
  return {
    ...c,
    tentativeBudget: c.tentativeBudget != null ? Number(c.tentativeBudget) : 0,
    finalNegotiatedBudget: num(c.finalNegotiatedBudget),
    nfaThreshold: num(c.nfaThreshold),
    capexAmount: c.capexAmount != null ? Number(c.capexAmount) : 0,
    opexAmount: c.opexAmount != null ? Number(c.opexAmount) : 0,
    roiPerAnnum: num(c.roiPerAnnum),
    previousNfaAmount: num(c.previousNfaAmount),
    leAmount: num(c.leAmount),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// DOCX — render the consolidated Charter+NFA on demand
// ═══════════════════════════════════════════════════════════════════════════
export async function renderCharterDocx(charter: Record<string, unknown> & { id: number; scoringWeights?: unknown }): Promise<Buffer> {
  const risks = await db.select().from(risksTable).where(eq(risksTable.charterId, charter.id));
  const dir = await mkdtemp(path.join(tmpdir(), "charter-nfa-"));
  try {
    const inPath = path.join(dir, "in.json");
    const outPath = path.join(dir, "out.docx");
    const sectionOrder = (charter.scoringWeights as { sectionOrder?: string[] } | null)?.sectionOrder;
    const payload = { ...formatCharter(charter), structuredRisks: risks, sectionOrder };
    await writeFile(inPath, JSON.stringify(payload), "utf-8");

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(PYTHON_BIN, [CHARTER_NFA_GENERATOR, "--in", inPath, "--out", outPath], { stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";
      proc.stderr.on("data", (d) => { stderr += d.toString(); });
      proc.on("error", reject);
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`generate_charter_nfa.py exited ${code}: ${stderr.trim()}`));
      });
    });

    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

router.get("/charters/:id/docx", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [charter] = await db.select().from(chartersTable).where(eq(chartersTable.id, id));
  if (!charter) {
    res.status(404).json({ error: "Charter not found" });
    return;
  }

  try {
    const buf = await renderCharterDocx(charter as never);
    const safeTitle = (charter.title || `Charter-${id}`).replace(/[^a-z0-9\-_ ]/gi, "").trim().slice(0, 60) || `Charter-${id}`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}.docx"`);
    res.send(buf);
  } catch (e) {
    res.status(500).json({ error: `Failed to generate Charter+NFA document: ${(e as Error).message}` });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// E-SIGN — send the charter's DOA chain to Documenso. Signatures land back via
// /api/documenso/webhook and are recorded exactly like in-app approvals.
// ═══════════════════════════════════════════════════════════════════════════

// Render → PDF → Documenso send → persist envelope → tell the first signer.
// Shared by the manual /esign route (retry path) and the auto-send on submit.
// Throws Error (optionally with .statusCode) when the charter can't be sent.
async function sendCharterEsign(charter: { id: number; title?: string | null; signatories?: unknown; esign?: unknown }): Promise<EsignEnvelope> {
  if ((charter.esign as { documentId?: number } | null)?.documentId) {
    throw Object.assign(new Error("Already sent for e-signature."), { statusCode: 409 });
  }
  const sigs = await enrichSignatoryEmails((charter.signatories as Array<{ role?: string; name?: string; email?: string; empCode?: string }>) ?? []);
  const { signers, missing } = signersFromSignatories(sigs);
  if (signers.length === 0 || missing.length > 0) {
    throw Object.assign(
      new Error(`Signatories without an email address: ${missing.join(", ") || "(none resolvable)"}. E-sign needs an email per approver.`),
      { statusCode: 422 },
    );
  }

  const pdf = await docxToPdf(await renderCharterDocx(charter as never));
  const esign = await sendForSignature({
    title: `Charter+NFA — ${charter.title || `Charter ${charter.id}`}`,
    externalId: `charter:${charter.id}`,
    pdf,
    signers,
  });
  await db.update(chartersTable).set({ esign } as never).where(eq(chartersTable.id, charter.id));
  await logActivity("charter_esign_sent", `Charter "${charter.title}" sent for e-signature via Documenso (${signers.length} signers)`, charter.id, "charter");

  // PMO-branded "your turn" bell+email for the first signer (Documenso mails
  // its own link too). Best-effort — the envelope is already out.
  try {
    const doc = await getDocumensoDocument(esign.documentId);
    const first = nextPendingSigner(doc);
    if (first) await notifySignerTurn({ email: first.email, signingUrl: first.signingUrl, kind: "charter", entityId: charter.id, title: charter.title || `Charter ${charter.id}` });
  } catch { /* notify is auxiliary */ }

  return esign;
}

router.post("/charters/:id/esign", requireRole(...WRITE_ROLES), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (!documensoConfigured()) { res.status(501).json({ error: "E-sign is not configured (set DOCUMENSO_URL + DOCUMENSO_API_TOKEN)." }); return; }
  const [charter] = await db.select().from(chartersTable).where(eq(chartersTable.id, id));
  if (!charter) { res.status(404).json({ error: "Charter not found" }); return; }
  if (charter.status !== "parallel_review") { res.status(409).json({ error: `Charter is ${charter.status}; e-sign covers the DOA parallel-review stage — submit the charter first.` }); return; }

  try {
    const esign = await sendCharterEsign(charter);
    const [updated] = await db.select().from(chartersTable).where(eq(chartersTable.id, id));
    res.json({ ...formatCharter(updated), esign });
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode ?? 502;
    res.status(status).json({ error: status === 502 ? `Failed to send for e-signature: ${(e as Error).message}` : (e as Error).message, ...(status === 409 ? { esign: charter.esign } : {}) });
  }
});

export default router;
