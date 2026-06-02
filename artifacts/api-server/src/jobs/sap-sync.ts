import {
  db,
  purchaseRequisitionsTable,
  purchaseOrdersTable,
  projectsTable,
  notificationsTable,
} from "@workspace/db";
import { and, eq, isNotNull, notInArray } from "drizzle-orm";
import { logger } from "../lib/logger";
import { getSapAdapter } from "../integrations/sap";

/**
 * SAP sync job — runs every 2 min via the scheduler. Walks every open PR/PO
 * (anything whose sap_status isn't a terminal state), asks the adapter for
 * fresh status, and updates the local rows. On a status transition we
 * mirror a notification to the project's PM so the bell surfaces the change.
 *
 * Terminal states (skipped to keep the polling set small):
 *   PRs: rejected, cancelled, po_issued (handed off to the PO machine)
 *   POs: received, cancelled
 *
 * Failures per row are logged and swallowed so one broken record doesn't
 * stall the whole sweep.
 */

const PR_TERMINAL = ["rejected", "cancelled", "po_issued"] as const;
const PO_TERMINAL = ["received", "cancelled"] as const;

async function notifyTransition(
  projectId: number | null,
  prevStatus: string | null,
  nextStatus: string,
  entityType: "purchase_requisition" | "purchase_order",
  entityId: number,
  sapNumber: string,
): Promise<void> {
  if (prevStatus === nextStatus) return;
  if (projectId == null) return;
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project?.projectManagerId) return;
  await db.insert(notificationsTable).values({
    userId: project.projectManagerId,
    type: entityType === "purchase_requisition" ? `pr_${nextStatus}` : `po_${nextStatus}`,
    title: `${entityType === "purchase_requisition" ? "PR" : "PO"} ${sapNumber}: ${nextStatus}`,
    body: `Project "${project.name}" — status moved from "${prevStatus ?? "(none)"}" to "${nextStatus}".`,
    link: `/projects/${project.id}?tab=procurement`,
    relatedEntityType: entityType,
    relatedEntityId: entityId,
  } as never);
}

async function syncPRs(): Promise<{ checked: number; transitions: number }> {
  const open = await db
    .select()
    .from(purchaseRequisitionsTable)
    .where(
      and(
        isNotNull(purchaseRequisitionsTable.sapPrNumber),
        notInArray(purchaseRequisitionsTable.sapStatus, PR_TERMINAL as unknown as string[]),
      ),
    );
  const adapter = getSapAdapter();
  let transitions = 0;
  for (const pr of open) {
    if (!pr.sapPrNumber) continue;
    try {
      const fresh = await adapter.getPRStatus(pr.sapPrNumber);
      const moved = fresh.status !== pr.sapStatus;
      await db
        .update(purchaseRequisitionsTable)
        .set({ sapStatus: fresh.status, lastSyncedAt: new Date() })
        .where(eq(purchaseRequisitionsTable.id, pr.id));
      if (moved) {
        transitions += 1;
        await notifyTransition(pr.projectId, pr.sapStatus, fresh.status, "purchase_requisition", pr.id, pr.sapPrNumber);
      }
    } catch (err) {
      logger.warn({ err, prId: pr.id, sapPrNumber: pr.sapPrNumber }, "sap-sync: PR poll failed");
    }
  }
  return { checked: open.length, transitions };
}

async function syncPOs(): Promise<{ checked: number; transitions: number }> {
  const open = await db
    .select()
    .from(purchaseOrdersTable)
    .where(
      and(
        isNotNull(purchaseOrdersTable.sapPoNumber),
        notInArray(purchaseOrdersTable.sapStatus, PO_TERMINAL as unknown as string[]),
      ),
    );
  const adapter = getSapAdapter();
  let transitions = 0;
  for (const po of open) {
    if (!po.sapPoNumber) continue;
    try {
      const fresh = await adapter.getPOStatus(po.sapPoNumber);
      const moved = fresh.status !== po.sapStatus;
      await db
        .update(purchaseOrdersTable)
        .set({
          sapStatus: fresh.status,
          deliveryDate: fresh.deliveryDate ?? po.deliveryDate,
          lastSyncedAt: new Date(),
        })
        .where(eq(purchaseOrdersTable.id, po.id));
      if (moved) {
        transitions += 1;
        // Notify via the parent PR's project context (PO has no projectId).
        if (po.prId != null) {
          const [pr] = await db
            .select({ projectId: purchaseRequisitionsTable.projectId })
            .from(purchaseRequisitionsTable)
            .where(eq(purchaseRequisitionsTable.id, po.prId));
          await notifyTransition(pr?.projectId ?? null, po.sapStatus, fresh.status, "purchase_order", po.id, po.sapPoNumber);
        }
      }
    } catch (err) {
      logger.warn({ err, poId: po.id, sapPoNumber: po.sapPoNumber }, "sap-sync: PO poll failed");
    }
  }
  return { checked: open.length, transitions };
}

export async function runSapSync(): Promise<void> {
  logger.info("sap-sync: tick start");
  const prs = await syncPRs();
  const pos = await syncPOs();
  logger.info({ prs, pos }, "sap-sync: tick done");
}
