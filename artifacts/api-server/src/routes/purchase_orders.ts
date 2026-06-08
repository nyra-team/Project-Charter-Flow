import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import {
  db,
  purchaseRequisitionsTable,
  purchaseOrdersTable,
  projectsTable,
  notificationsTable,
  chartersTable,
} from "@workspace/db";
import { eq, desc, and, or } from "drizzle-orm";
import { logActivity } from "./activity";
import { getSapAdapter } from "../integrations/sap";

const router: IRouter = Router();

// ─── Validation ─────────────────────────────────────────────────────────────

const LineItemSchema = z.object({
  description: z.string().min(1),
  qty: z.number().positive(),
  uom: z.string().min(1),
  unitPrice: z.number().nonnegative(),
  materialCode: z.string().optional(),
});

const CreatePRBody = z.object({
  projectId: z.number().int(),
  // Required — PR creation is gated on an approved Charter+NFA. The charter
  // is the consolidated investment-authorization artifact in the Granules
  // governance model; SAP can't be hit without it.
  charterId: z.number().int(),
  vendorId: z.number().int().optional(),
  sapVendorCode: z.string().optional(),
  lineItems: z.array(LineItemSchema).min(1),
  currency: z.string().min(3).max(3).optional().default("INR"),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function sumLines(lines: z.infer<typeof LineItemSchema>[]): number {
  return lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
}

async function notifyRequester(prRow: typeof purchaseRequisitionsTable.$inferSelect, status: string): Promise<void> {
  // requestedById is a master DB UUID — notifications.user_id is integer.
  // We can't notify the requester directly without a UUID→pmoUser map, so
  // notify the project manager (pmo_users.id) instead. This matches the
  // pattern used by escalation-evaluator + nudge-generator.
  if (prRow.projectId == null) return;
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, prRow.projectId));
  if (!project?.projectManagerId) return;
  await db.insert(notificationsTable).values({
    userId: project.projectManagerId,
    type: `pr_${status}`,
    title: `PR ${prRow.sapPrNumber ?? "(unsubmitted)"}: ${status}`,
    body: `Project "${project.name}" — PR status changed to ${status}.`,
    link: `/projects/${project.id}?tab=procurement`,
    relatedEntityType: "purchase_requisition",
    relatedEntityId: prRow.id,
  } as never);
}

// ═══════════════════════════════════════════════════════════════════════════
// PURCHASE REQUISITIONS
// ═══════════════════════════════════════════════════════════════════════════

router.get("/prs", async (req, res): Promise<void> => {
  // Two scoping flavours so the procurement tab on a project and a global
  // procurement queue both read the same endpoint.
  const projectId = req.query.projectId ? parseInt(req.query.projectId as string) : undefined;
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const conds = [];
  if (projectId != null && !isNaN(projectId)) conds.push(eq(purchaseRequisitionsTable.projectId, projectId));
  if (status) conds.push(eq(purchaseRequisitionsTable.status, status));
  const rows = conds.length
    ? await db.select().from(purchaseRequisitionsTable).where(and(...conds)).orderBy(desc(purchaseRequisitionsTable.createdAt))
    : await db.select().from(purchaseRequisitionsTable).orderBy(desc(purchaseRequisitionsTable.createdAt));
  res.json(rows);
});

router.get("/prs/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [pr] = await db.select().from(purchaseRequisitionsTable).where(eq(purchaseRequisitionsTable.id, id));
  if (!pr) { res.status(404).json({ error: "PR not found" }); return; }
  // Attach the spawned PO (if any) so the UI can render both in one card.
  const pos = await db.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.prId, id));
  res.json({ ...pr, purchaseOrders: pos });
});

router.post("/prs", async (req, res): Promise<void> => {
  const parsed = CreatePRBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { projectId, charterId, vendorId, sapVendorCode, lineItems, currency } = parsed.data;

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  // Gate — the Charter+NFA must be fully approved through the DOA chain.
  // Block both "draft" and any in-review status (parallel_review, scm_review,
  // chairman_review, finance_review, pmo_review). Only "approved" passes.
  const [charter] = await db.select().from(chartersTable).where(eq(chartersTable.id, charterId));
  if (!charter) { res.status(404).json({ error: "Charter not found" }); return; }
  if (charter.status !== "approved") {
    res.status(409).json({
      error: `Charter+NFA not yet approved (status: ${charter.status}). PR creation is blocked until the DOA chain completes.`,
      charterId,
      charterStatus: charter.status,
    });
    return;
  }

  const adapter = getSapAdapter();
  let sapResp;
  try {
    sapResp = await adapter.createPR({
      referenceText: `${project.name}${charterId ? ` (charter ${charterId})` : ""}`,
      sapVendorCode,
      lineItems,
      currency,
      requestedById: req.user?.employeeId ?? undefined,
    });
  } catch (err) {
    res.status(502).json({ error: `SAP[${adapter.mode}] PR submission failed: ${(err as Error).message}` });
    return;
  }

  const totalAmount = sumLines(lineItems);
  const [row] = await db
    .insert(purchaseRequisitionsTable)
    .values({
      projectId,
      charterId,
      vendorId,
      requestedById: req.user?.employeeId ?? null,
      sapPrNumber: sapResp.sapPrNumber,
      lineItems,
      totalAmount: String(totalAmount),
      currency,
      status: "submitted",
      sapStatus: sapResp.status,
      lastSyncedAt: new Date(),
    } as never)
    .returning();

  await logActivity(
    "pr_submitted",
    `PR ${sapResp.sapPrNumber} submitted via SAP[${adapter.mode}] — ${currency} ${totalAmount.toLocaleString("en-IN")}`,
    row.id,
    "purchase_requisition",
  );
  await notifyRequester(row, "submitted");
  res.status(201).json(row);
});

// ─── Convert PR → PO ────────────────────────────────────────────────────────

router.post("/prs/:id/convert-to-po", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [pr] = await db.select().from(purchaseRequisitionsTable).where(eq(purchaseRequisitionsTable.id, id));
  if (!pr) { res.status(404).json({ error: "PR not found" }); return; }
  if (!pr.sapPrNumber) { res.status(409).json({ error: "PR not submitted to SAP yet" }); return; }
  if (pr.sapStatus !== "approved") {
    res.status(409).json({ error: `PR is "${pr.sapStatus}", must be "approved" to convert.` });
    return;
  }

  const adapter = getSapAdapter();
  let poResp;
  try {
    poResp = await adapter.convertToPO(pr.sapPrNumber);
  } catch (err) {
    res.status(502).json({ error: `SAP[${adapter.mode}] PR→PO failed: ${(err as Error).message}` });
    return;
  }

  // Idempotency: if a PO row already exists for this PR + sapPoNumber, return it.
  const [existing] = await db
    .select()
    .from(purchaseOrdersTable)
    .where(and(eq(purchaseOrdersTable.prId, id), eq(purchaseOrdersTable.sapPoNumber, poResp.sapPoNumber)));
  if (existing) {
    res.json(existing);
    return;
  }

  const [poRow] = await db
    .insert(purchaseOrdersTable)
    .values({
      prId: id,
      vendorId: pr.vendorId,
      sapPoNumber: poResp.sapPoNumber,
      lineItems: pr.lineItems as never,
      totalAmount: pr.totalAmount,
      currency: pr.currency,
      status: "open",
      sapStatus: poResp.status,
      deliveryDate: poResp.deliveryDate,
      lastSyncedAt: new Date(),
    } as never)
    .returning();

  // Stamp the PR with po_issued so the UI shows the chain progressing.
  await db
    .update(purchaseRequisitionsTable)
    .set({ status: "po_issued", sapStatus: "po_issued" })
    .where(eq(purchaseRequisitionsTable.id, id));

  await logActivity("po_issued", `PO ${poResp.sapPoNumber} issued for PR ${pr.sapPrNumber}`, poRow.id, "purchase_order");
  await notifyRequester({ ...pr, status: "po_issued", sapStatus: "po_issued" }, "po_issued");
  res.status(201).json(poRow);
});

router.post("/prs/:id/cancel", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [pr] = await db.select().from(purchaseRequisitionsTable).where(eq(purchaseRequisitionsTable.id, id));
  if (!pr) { res.status(404).json({ error: "PR not found" }); return; }
  if (!pr.sapPrNumber) { res.status(409).json({ error: "PR has no SAP number to cancel" }); return; }

  const adapter = getSapAdapter();
  try {
    await adapter.cancelPR(pr.sapPrNumber);
  } catch (err) {
    res.status(502).json({ error: `SAP[${adapter.mode}] cancel failed: ${(err as Error).message}` });
    return;
  }

  const [row] = await db
    .update(purchaseRequisitionsTable)
    .set({ status: "cancelled", sapStatus: "cancelled" })
    .where(eq(purchaseRequisitionsTable.id, id))
    .returning();
  await logActivity("pr_cancelled", `PR ${pr.sapPrNumber} cancelled`, id, "purchase_requisition");
  res.json(row);
});

// ═══════════════════════════════════════════════════════════════════════════
// PURCHASE ORDERS
// ═══════════════════════════════════════════════════════════════════════════

router.get("/pos", async (req, res): Promise<void> => {
  const prId = req.query.prId ? parseInt(req.query.prId as string) : undefined;
  const rows = prId != null && !isNaN(prId)
    ? await db.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.prId, prId)).orderBy(desc(purchaseOrdersTable.createdAt))
    : await db.select().from(purchaseOrdersTable).orderBy(desc(purchaseOrdersTable.createdAt));
  res.json(rows);
});

router.get("/pos/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [po] = await db.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, id));
  if (!po) { res.status(404).json({ error: "PO not found" }); return; }
  res.json(po);
});

// ─── Manual refresh for a single PR (used by the Refresh button) ────────────

router.post("/prs/:id/refresh", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [pr] = await db.select().from(purchaseRequisitionsTable).where(eq(purchaseRequisitionsTable.id, id));
  if (!pr) { res.status(404).json({ error: "PR not found" }); return; }
  if (!pr.sapPrNumber) { res.status(409).json({ error: "PR has no SAP number" }); return; }

  const adapter = getSapAdapter();
  try {
    const fresh = await adapter.getPRStatus(pr.sapPrNumber);
    const updates: Record<string, unknown> = {
      sapStatus: fresh.status,
      lastSyncedAt: new Date(),
    };
    if (pr.sapStatus !== fresh.status) {
      await notifyRequester(pr, fresh.status);
    }
    await db.update(purchaseRequisitionsTable).set(updates).where(eq(purchaseRequisitionsTable.id, id));
  } catch (err) {
    res.status(502).json({ error: `SAP[${adapter.mode}] refresh failed: ${(err as Error).message}` });
    return;
  }

  // Refresh the PO too (if there's one).
  const [po] = await db.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.prId, id));
  if (po?.sapPoNumber) {
    try {
      const freshPo = await adapter.getPOStatus(po.sapPoNumber);
      await db
        .update(purchaseOrdersTable)
        .set({
          sapStatus: freshPo.status,
          deliveryDate: freshPo.deliveryDate ?? po.deliveryDate,
          lastSyncedAt: new Date(),
        })
        .where(eq(purchaseOrdersTable.id, po.id));
    } catch {
      // Swallow — the PO refresh failure shouldn't fail the whole call.
    }
  }

  // Return the freshened combo so the UI doesn't need a second round-trip.
  const [refreshedPr] = await db.select().from(purchaseRequisitionsTable).where(eq(purchaseRequisitionsTable.id, id));
  const refreshedPos = await db.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.prId, id));
  res.json({ ...refreshedPr, purchaseOrders: refreshedPos });
});

// Delete a purchase requisition. BLOCKED once converted to a PO (delete the PO
// first) — the PR→PO link is a governance/SAP relationship.
router.delete("/prs/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [pr] = await db.select().from(purchaseRequisitionsTable).where(eq(purchaseRequisitionsTable.id, id));
  if (!pr) { res.status(404).json({ error: "Purchase requisition not found" }); return; }
  const pos = await db.select({ id: purchaseOrdersTable.id }).from(purchaseOrdersTable).where(eq(purchaseOrdersTable.prId, id));
  if (pos.length) {
    res.status(409).json({ error: "This requisition has been converted to a purchase order; delete the PO first." });
    return;
  }
  await db.delete(purchaseRequisitionsTable).where(eq(purchaseRequisitionsTable.id, id));
  await logActivity("pr_deleted", `Purchase requisition #${id} deleted`, id, "purchase_requisition");
  res.sendStatus(204);
});

// Delete a purchase order. BLOCKED when it exists in SAP (sap_po_number set) —
// that record must be removed in SAP, not here.
router.delete("/pos/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [po] = await db.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, id));
  if (!po) { res.status(404).json({ error: "Purchase order not found" }); return; }
  if (po.sapPoNumber) {
    res.status(409).json({ error: "This PO exists in SAP and can't be deleted from here." });
    return;
  }
  await db.delete(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, id));
  await logActivity("po_deleted", `Purchase order #${id} deleted`, id, "purchase_order");
  res.sendStatus(204);
});

// Re-export of `or` used above kept here for future expansion (search across
// projectId / status combos). Suppresses unused-import noise.
void or;

export default router;
