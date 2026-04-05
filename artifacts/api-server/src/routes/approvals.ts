import { Router, type IRouter } from "express";
import { db, approvalsTable, chartersTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  GetApprovalParams,
  DecideApprovalParams,
  DecideApprovalBody,
  ListApprovalsQueryParams,
  GetPendingApprovalsQueryParams,
} from "@workspace/api-zod";
import { logActivity } from "./activity";

const router: IRouter = Router();

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

router.post("/approvals/:id/decide", async (req, res): Promise<void> => {
  const params = DecideApprovalParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = DecideApprovalBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [approval] = await db.select().from(approvalsTable).where(eq(approvalsTable.id, params.data.id));
  if (!approval) { res.status(404).json({ error: "Approval not found" }); return; }

  const decision = parsed.data.decision;
  const [updated] = await db.update(approvalsTable).set({
    status: decision,
    comments: parsed.data.comments ?? null,
    decidedAt: new Date(),
  }).where(eq(approvalsTable.id, params.data.id)).returning();

  const [charter] = await db.select().from(chartersTable).where(eq(chartersTable.id, approval.charterId));
  const [approver] = await db.select().from(usersTable).where(eq(usersTable.id, approval.approverId));

  await logActivity(
    `approval_${decision}`,
    `${approver?.name ?? "Approver"} (${approval.approverRole}) ${decision} charter "${charter?.title}"`,
    approval.charterId,
    "charter",
    approval.approverId
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
