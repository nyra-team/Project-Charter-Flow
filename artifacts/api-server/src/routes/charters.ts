import { Router, type IRouter } from "express";
import { db, chartersTable, vendorsTable, risksTable, squadMembersTable, approvalsTable, usersTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
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

const router: IRouter = Router();

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
router.post("/charters", async (req, res): Promise<void> => {
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
router.patch("/charters/:id", async (req, res): Promise<void> => {
  const params = UpdateCharterParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateCharterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updateData: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.tentativeBudget !== undefined) {
    updateData.tentativeBudget = String(parsed.data.tentativeBudget);
  }
  if ((parsed.data as Record<string, unknown>).nfaThreshold != null) {
    updateData.nfaThreshold = String((parsed.data as Record<string, unknown>).nfaThreshold);
  }
  const [charter] = await db.update(chartersTable).set(updateData).where(eq(chartersTable.id, params.data.id)).returning();
  if (!charter) {
    res.status(404).json({ error: "Charter not found" });
    return;
  }
  res.json(formatCharter(charter));
});

// Submit charter
router.post("/charters/:id/submit", async (req, res): Promise<void> => {
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

  // Find HOD, Executive Director, CFO users
  const approverRoles = ["hod", "executive_director", "cfo"];
  const approvers = await db.select().from(usersTable)
    .where(eq(usersTable.role, "hod"))
    .limit(1);
  const edUsers = await db.select().from(usersTable).where(eq(usersTable.role, "executive_director")).limit(1);
  const cfoUsers = await db.select().from(usersTable).where(eq(usersTable.role, "cfo")).limit(1);

  const allApprovers = [
    ...(approvers.length ? [{ user: approvers[0], role: "hod" }] : []),
    ...(edUsers.length ? [{ user: edUsers[0], role: "executive_director" }] : []),
    ...(cfoUsers.length ? [{ user: cfoUsers[0], role: "cfo" }] : []),
  ];

  // Create parallel approvals
  for (const { user, role } of allApprovers) {
    await db.insert(approvalsTable).values({
      charterId: charter.id,
      approverId: user.id,
      approverRole: role,
      stage: "parallel_review",
      status: "pending",
    });
  }

  const [updated] = await db.update(chartersTable)
    .set({ status: "parallel_review" })
    .where(eq(chartersTable.id, params.data.id))
    .returning();
  await logActivity("charter_submitted", `Charter "${charter.title}" submitted for approval`, charter.id, "charter", charter.submittedById);
  res.json(formatCharter(updated));
});

// SCM negotiate
router.post("/charters/:id/scm-negotiate", async (req, res): Promise<void> => {
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
router.post("/charters/:id/finance-order", async (req, res): Promise<void> => {
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

router.post("/charters/:id/vendors", async (req, res): Promise<void> => {
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

router.post("/charters/:id/risks", async (req, res): Promise<void> => {
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

router.post("/charters/:id/squad", async (req, res): Promise<void> => {
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
  return {
    ...c,
    tentativeBudget: c.tentativeBudget != null ? Number(c.tentativeBudget) : 0,
    finalNegotiatedBudget: c.finalNegotiatedBudget != null ? Number(c.finalNegotiatedBudget) : null,
    nfaThreshold: c.nfaThreshold != null ? Number(c.nfaThreshold) : null,
  };
}

export default router;
