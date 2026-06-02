// SAP adapter contract — implemented by both mockSapAdapter (in-memory,
// dev/demo) and realSapAdapter (S/4HANA OData, gated behind SAP_MODE=real).
//
// The adapter NEVER touches pmo_purchase_requisitions / pmo_purchase_orders
// directly. It only models the SAP side of the integration: create, fetch
// status, convert, cancel. Persistence + side-effects (notifications,
// activity logs) live in routes/purchase_orders.ts and jobs/sap-sync.ts.
//
// All numeric/currency fields use plain `number` here for ergonomics; the
// caller is responsible for converting to numeric() strings at DB-write
// time. Adapters should reject obviously-bad inputs (negative qty, missing
// lines) but are NOT the place to enforce business rules — those live in
// the route handler.

export interface SapPurchaseRequisitionLine {
  description: string;
  qty: number;
  uom: string;
  unitPrice: number;
  materialCode?: string;
}

export interface CreatePRInput {
  /** Free-text reference for the SAP side (project name, charter title). */
  referenceText: string;
  /** Optional SAP vendor code. Mock adapter accepts undefined. */
  sapVendorCode?: string;
  lineItems: SapPurchaseRequisitionLine[];
  currency: string;
  /** Master DB UUID of the requester. Forwarded for audit only. */
  requestedById?: string;
}

/**
 * Status the adapter reports back. Stays free-text rather than an enum
 * because real SAP returns its own strings; the mock standardises on the
 * five-state machine documented below. The local DB column stores it
 * verbatim — UI maps to badges via a tone-map.
 *
 * Canonical (mock) machine:
 *   pending → approved → po_issued → received
 *               └→ rejected (terminal)
 *               └→ cancelled (terminal)
 */
export type SapPRStatus = string;
export type SapPOStatus = string;

export interface SapPurchaseRequisition {
  sapPrNumber: string;
  status: SapPRStatus;
  /** Set once the PR has been converted into a PO. */
  sapPoNumber?: string;
}

export interface SapPurchaseOrder {
  sapPoNumber: string;
  status: SapPOStatus;
  /** ISO YYYY-MM-DD; adapter may return null until confirmed. */
  deliveryDate?: string;
}

export interface SapAdapter {
  /** Mode label for diagnostics ("mock" or "real"). */
  readonly mode: "mock" | "real";

  /** Submit a fresh PR. Returns the SAP-assigned PR number + initial status. */
  createPR(input: CreatePRInput): Promise<SapPurchaseRequisition>;

  /** Re-fetch the current state of a PR. Cron-driven from sap-sync. */
  getPRStatus(sapPrNumber: string): Promise<SapPurchaseRequisition>;

  /**
   * Convert an approved PR into a PO. Idempotent — calling it on an already-
   * converted PR returns the same PO number.
   */
  convertToPO(sapPrNumber: string): Promise<SapPurchaseOrder>;

  /** Re-fetch the current state of a PO. Cron-driven from sap-sync. */
  getPOStatus(sapPoNumber: string): Promise<SapPurchaseOrder>;

  /**
   * Cancel a pending PR. Real SAP supports cancellation only before PO
   * issuance; the mock mirrors that. Throws otherwise.
   */
  cancelPR(sapPrNumber: string): Promise<SapPurchaseRequisition>;
}
