import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { db, chartersTable, vendorsTable, risksTable, squadMembersTable, approvalsTable, usersTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { matchBand } from "../lib/doa-resolver";

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

const router: IRouter = Router();

const WRITE_ROLES = ["pm", "pmo", "hod", "initiator"];

// Extended PATCH body — accepts all Charter+NFA merged columns.
// Lives inline until lib/api-zod is regenerated from the updated OpenAPI spec.
const ExtendedCharterPatch = z.object({
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
  const { sectionOrder, ...extData } = extended.data;
  const updateData: Record<string, unknown> = { ...legacy.data, ...extData };
  // sectionOrder has no column of its own — merge it into the scoringWeights jsonb.
  if (sectionOrder) {
    const [cur] = await db.select({ sw: chartersTable.scoringWeights }).from(chartersTable).where(eq(chartersTable.id, params.data.id));
    updateData.scoringWeights = { ...((cur?.sw as Record<string, unknown>) ?? {}), sectionOrder };
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
  res.json(formatCharter(charter));
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

  // Resolve approver chain via the DOA matrix.
  // amountInr = finalNegotiatedBudget if available, else tentativeBudget.
  const amountInr = Number(charter.finalNegotiatedBudget ?? charter.tentativeBudget ?? 0);
  const match = await matchBand({
    entity: charter.entity ?? "",
    category: charter.category ?? "",
    kind: charter.kind ?? "capex",
    amountInr,
  });
  if (!match) {
    res.status(422).json({
      error: "No active DOA band covers this charter — configure one at /admin/doa-matrix and retry.",
      context: { entity: charter.entity, category: charter.category, kind: charter.kind, amountInr },
    });
    return;
  }

  // Insert one parallel approval per resolved role; mirror into charter.signatories
  // jsonb so the DOCX renderer / detail UI can show the full sign-off block.
  const signatories: Array<{ role: string; name: string; status: string }> = [];
  for (const role of match.approverRoles) {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.role, role)).limit(1);
    await db.insert(approvalsTable).values({
      charterId: charter.id,
      approverId: user?.id ?? null,
      approverRole: role,
      stage: "parallel_review",
      status: "pending",
    });
    signatories.push({
      role,
      name: user?.name ?? "",
      status: "pending",
    });
  }

  const [updated] = await db.update(chartersTable)
    .set({ status: "parallel_review", signatories })
    .where(eq(chartersTable.id, params.data.id))
    .returning();
  await logActivity(
    "charter_submitted",
    `Charter "${charter.title}" submitted — DOA band "${match.label}" → ${match.approverRoles.join(", ") || "(empty)"}`,
    charter.id,
    "charter",
    charter.submittedById,
  );
  res.json({ ...formatCharter(updated), doaBand: { id: match.bandId, label: match.label, approverRoles: match.approverRoles } });
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
  const risks = await db.select().from(risksTable).where(eq(risksTable.charterId, id));

  let dir: string | undefined;
  try {
    dir = await mkdtemp(path.join(tmpdir(), "charter-nfa-"));
    const inPath = path.join(dir, "in.json");
    const outPath = path.join(dir, "out.docx");
    const sectionOrder = (charter.scoringWeights as { sectionOrder?: string[] } | null)?.sectionOrder;
    const payload = { ...formatCharter(charter as Record<string, unknown>), structuredRisks: risks, sectionOrder };
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

    const buf = await readFile(outPath);
    const safeTitle = (charter.title || `Charter-${id}`).replace(/[^a-z0-9\-_ ]/gi, "").trim().slice(0, 60) || `Charter-${id}`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}.docx"`);
    res.send(buf);
  } catch (e) {
    res.status(500).json({ error: `Failed to generate Charter+NFA document: ${(e as Error).message}` });
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

export default router;
