import { Router, type IRouter } from "express";
import { db, approvalsTable, chartersTable, usersTable, projectStagesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireRole } from "../lib/guard";

// Checklist items in pmo_project_stages.notes.__checklist that auto-tick
// when the Charter+NFA chain reaches "approved". Mapped to both the legacy
// `investment_authorization` stage and its successor `vendor_selection`
// (DEPRECATED_STAGE_KEYS in lifecycle-config maps them 1:1, but project rows
// from before the rename can still hold the legacy stage key).
const INVESTMENT_GATE_CHECKLIST_KEYS = [
  "charter_drafted",
  "dept_head_approved",
  "pmo_nfa_approved",
  "mgmt_approved",
];
const INVESTMENT_GATE_STAGES = ["investment_authorization", "vendor_selection"];

async function tickInvestmentGate(charterId: number): Promise<void> {
  const [charter] = await db.select().from(chartersTable).where(eq(chartersTable.id, charterId));
  if (!charter?.projectId) return; // no project to gate on
  for (const stage of INVESTMENT_GATE_STAGES) {
    const [row] = await db.select().from(projectStagesTable)
      .where(and(eq(projectStagesTable.projectId, charter.projectId), eq(projectStagesTable.stage, stage)));
    if (!row) continue;
    let notes: Record<string, unknown> = {};
    try { notes = JSON.parse(row.notes ?? "{}") as Record<string, unknown>; } catch { notes = {}; }
    const checklist = (notes.__checklist as Record<string, boolean> | undefined) ?? {};
    for (const key of INVESTMENT_GATE_CHECKLIST_KEYS) {
      checklist[key] = true;
    }
    notes.__checklist = checklist;
    notes.__charter_approved_at = new Date().toISOString();
    await db.update(projectStagesTable)
      .set({ notes: JSON.stringify(notes) })
      .where(eq(projectStagesTable.id, row.id));
  }
}

type Signatory = { role: string; name?: string; status?: string; decidedAt?: string; comment?: string };

async function mirrorSignatoryDecision(
  charterId: number,
  approverRole: string,
  decision: "approved" | "rejected",
  comments: string | null | undefined,
  decidedAt: Date,
): Promise<void> {
  const [charter] = await db.select().from(chartersTable).where(eq(chartersTable.id, charterId));
  if (!charter) return;
  const sigs = (charter.signatories as Signatory[] | null) ?? [];
  const next = sigs.map(s =>
    s.role === approverRole
      ? { ...s, status: decision, decidedAt: decidedAt.toISOString(), comment: comments ?? s.comment ?? "" }
      : s,
  );
  await db.update(chartersTable).set({ signatories: next }).where(eq(chartersTable.id, charterId));
}
import {
  GetApprovalParams,
  DecideApprovalParams,
  DecideApprovalBody,
  ListApprovalsQueryParams,
  GetPendingApprovalsQueryParams,
} from "@workspace/api-zod";
import { logActivity } from "./activity";

const router: IRouter = Router();

const DECIDE_ROLES = ["pmo", "hod", "cfo", "chairman", "executive_director", "scm", "finance"];

async function enrichApprovals(approvals: Array<Record<string, unknown>>) {
  if (!approvals.length) return [];
  const charterIds = [...new Set(approvals.map(a => a.charterId as number))];
  const approverIds = [...new Set(approvals.map(a => a.approverId as number))];

  const { inArray } = await import("drizzle-orm");

  const charters = charterIds.length
    ? await db.select({ id: chartersTable.id, title: chartersTable.title }).from(chartersTable)
        .where(inArray(chartersTable.id, charterIds))
    : [];
  const users = approverIds.length
    ? await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable)
        .where(inArray(usersTable.id, approverIds))
    : [];

  const charterMap = Object.fromEntries(charters.map(c => [c.id, c.title]));
  const userMap = Object.fromEntries(users.map(u => [u.id, u.name]));

  return approvals.map(a => ({
    ...a,
    charterTitle: charterMap[a.charterId as number] ?? null,
    approverName: userMap[a.approverId as number] ?? null,
  }));
}

router.get("/approvals", async (req, res): Promise<void> => {
  const qp = ListApprovalsQueryParams.safeParse(req.query);
  let approvals = await db.select().from(approvalsTable).orderBy(approvalsTable.createdAt);

  if (qp.success) {
    if (qp.data.charterId) approvals = approvals.filter(a => a.charterId === Number(qp.data.charterId));
    if (qp.data.approverId) approvals = approvals.filter(a => a.approverId === Number(qp.data.approverId));
    if (qp.data.status) approvals = approvals.filter(a => a.status === qp.data.status);
  }

  const enriched = await enrichApprovals(approvals as unknown as Array<Record<string, unknown>>);
  res.json(enriched);
});

router.get("/approvals/:id", async (req, res): Promise<void> => {
  const params = GetApprovalParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [approval] = await db.select().from(approvalsTable).where(eq(approvalsTable.id, params.data.id));
  if (!approval) { res.status(404).json({ error: "Approval not found" }); return; }
  const [enriched] = await enrichApprovals([approval as unknown as Record<string, unknown>]);
  res.json(enriched);
});

router.post("/approvals/:id/decide", requireRole(...DECIDE_ROLES), async (req, res): Promise<void> => {
  const params = DecideApprovalParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = DecideApprovalBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [approval] = await db.select().from(approvalsTable).where(eq(approvalsTable.id, params.data.id));
  if (!approval) { res.status(404).json({ error: "Approval not found" }); return; }

  // Beyond the role gate: unless the caller is a platform admin, they must be
  // the approver this row was assigned to (pmo_users.id → email match).
  if (!(req.user?.isSuperAdmin || req.user?.pmoRole === "admin") && approval.approverId != null) {
    const [assignedApprover] = await db.select().from(usersTable).where(eq(usersTable.id, approval.approverId));
    const assignedEmail = assignedApprover?.email?.toLowerCase();
    const callerEmail = req.user?.email?.toLowerCase();
    if (!assignedEmail || !callerEmail || assignedEmail !== callerEmail) {
      res.status(403).json({ error: "Only the assigned approver can decide this approval" });
      return;
    }
  }

  const decision = parsed.data.decision;
  const decidedAt = new Date();
  const [updated] = await db.update(approvalsTable).set({
    status: decision,
    comments: parsed.data.comments ?? null,
    decidedAt,
  }).where(eq(approvalsTable.id, params.data.id)).returning();

  // Mirror the per-row decision into charter.signatories jsonb so the DOCX
  // renderer + charter-detail UI see live status without joining pmo_approvals.
  await mirrorSignatoryDecision(approval.charterId, approval.approverRole, decision, parsed.data.comments ?? null, decidedAt);

  const [charter] = await db.select().from(chartersTable).where(eq(chartersTable.id, approval.charterId));
  const [approver] = approval.approverId != null
    ? await db.select().from(usersTable).where(eq(usersTable.id, approval.approverId))
    : [undefined];

  await logActivity(
    `approval_${decision}`,
    `${approver?.name ?? "Approver"} (${approval.approverRole}) ${decision} charter "${charter?.title}"`,
    approval.charterId,
    "charter",
    approval.approverId ?? undefined
  );

  // Check workflow progression
  if (decision === "rejected") {
    await db.update(chartersTable).set({ status: "rejected" }).where(eq(chartersTable.id, approval.charterId));
  } else if (decision === "approved") {
    // For parallel review: check if all are approved
    if (approval.stage === "parallel_review") {
      const parallelApprovals = await db.select().from(approvalsTable)
        .where(and(eq(approvalsTable.charterId, approval.charterId), eq(approvalsTable.stage, "parallel_review")));
      const allApproved = parallelApprovals.every(a => a.status === "approved");
      if (allApproved) {
        // Move to SCM review - find SCM user and create approval
        const [scmUser] = await db.select().from(usersTable).where(eq(usersTable.role, "scm")).limit(1);
        if (scmUser) {
          await db.insert(approvalsTable).values({
            charterId: approval.charterId,
            approverId: scmUser.id,
            approverRole: "scm",
            stage: "scm_review",
            status: "pending",
          });
        }
        await db.update(chartersTable).set({ status: "scm_review" }).where(eq(chartersTable.id, approval.charterId));
        await logActivity("moved_to_scm", `Charter "${charter?.title}" moved to SCM for negotiation`, approval.charterId, "charter");
      }
    } else if (approval.stage === "chairman_review") {
      // Move to finance review
      const [financeUser] = await db.select().from(usersTable).where(eq(usersTable.role, "finance")).limit(1);
      if (financeUser) {
        await db.insert(approvalsTable).values({
          charterId: approval.charterId,
          approverId: financeUser.id,
          approverRole: "finance",
          stage: "finance_review",
          status: "pending",
        });
      }
      await db.update(chartersTable).set({ status: "finance_review" }).where(eq(chartersTable.id, approval.charterId));
      await logActivity("moved_to_finance", `Charter "${charter?.title}" approved by Chairman, moved to Finance`, approval.charterId, "charter");
    } else if (approval.stage === "pmo_review") {
      await db.update(chartersTable).set({ status: "approved" }).where(eq(chartersTable.id, approval.charterId));
      await logActivity("charter_approved", `Charter "${charter?.title}" fully approved by PMO!`, approval.charterId, "charter");
      // Auto-tick the investment-authorization stage-gate checklist. Closes
      // the loop: UI → DOA → PR/PO without manual checklist toggling.
      await tickInvestmentGate(approval.charterId);
    }
  }

  const [enriched] = await enrichApprovals([updated as unknown as Record<string, unknown>]);
  res.json(enriched);
});

// Dashboard: pending approvals
router.get("/dashboard/pending-approvals", async (req, res): Promise<void> => {
  const qp = GetPendingApprovalsQueryParams.safeParse(req.query);
  let approvals = await db.select().from(approvalsTable)
    .where(eq(approvalsTable.status, "pending"))
    .orderBy(approvalsTable.createdAt);

  if (qp.success && qp.data.approverId) {
    approvals = approvals.filter(a => a.approverId === Number(qp.data.approverId));
  }

  const enriched = await enrichApprovals(approvals as unknown as Array<Record<string, unknown>>);
  res.json(enriched);
});

export default router;
