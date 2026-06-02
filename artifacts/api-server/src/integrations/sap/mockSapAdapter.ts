import type {
  SapAdapter,
  CreatePRInput,
  SapPurchaseRequisition,
  SapPurchaseOrder,
} from "./types";

/**
 * In-memory SAP mock. The state machine advances purely on `getPRStatus` /
 * `getPOStatus` calls — every poll bumps the PR/PO one state forward (with
 * a small dwell time so the UI shows distinct transitions across two-minute
 * cron ticks).
 *
 * Deterministic numbering (`PR-MOCK-<ts>`, `PO-MOCK-<ts>`) so the same number
 * lands in the DB on first call and stays stable for subsequent polls.
 *
 * Important: state lives in-process. A backend restart wipes it. That's
 * intentional — this adapter is for demos/dev; if you need persistence,
 * flip SAP_MODE=real and wire the real adapter against an actual SAP
 * sandbox.
 */

interface PRState {
  sapPrNumber: string;
  status: "pending" | "approved" | "po_issued" | "rejected" | "cancelled";
  poNumber?: string;
  createdAt: number;
  lastAdvancedAt: number;
}

interface POState {
  sapPoNumber: string;
  prNumber: string;
  status: "open" | "in_transit" | "received" | "cancelled";
  deliveryDate?: string;
  createdAt: number;
  lastAdvancedAt: number;
}

// Each state holds for at least DWELL_MS before being eligible to advance.
// 90 s lets two-minute cron ticks tend to walk one step per tick instead of
// flashing through the whole machine in a single poll.
const DWELL_MS = 90 * 1000;

class MockSapAdapter implements SapAdapter {
  readonly mode = "mock" as const;

  private prs = new Map<string, PRState>();
  private pos = new Map<string, POState>();

  async createPR(input: CreatePRInput): Promise<SapPurchaseRequisition> {
    if (!input.lineItems?.length) {
      throw new Error("SAP[mock].createPR: lineItems required");
    }
    const sapPrNumber = `PR-MOCK-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const now = Date.now();
    this.prs.set(sapPrNumber, {
      sapPrNumber,
      status: "pending",
      createdAt: now,
      lastAdvancedAt: now,
    });
    return { sapPrNumber, status: "pending" };
  }

  async getPRStatus(sapPrNumber: string): Promise<SapPurchaseRequisition> {
    const pr = this.prs.get(sapPrNumber);
    if (!pr) throw new Error(`SAP[mock].getPRStatus: unknown PR ${sapPrNumber}`);

    // Advance pending → approved if dwell satisfied. Stay parked at
    // approved (no auto po_issued — convertToPO is the explicit transition).
    if (pr.status === "pending" && Date.now() - pr.lastAdvancedAt >= DWELL_MS) {
      pr.status = "approved";
      pr.lastAdvancedAt = Date.now();
    }

    return { sapPrNumber, status: pr.status, sapPoNumber: pr.poNumber };
  }

  async convertToPO(sapPrNumber: string): Promise<SapPurchaseOrder> {
    const pr = this.prs.get(sapPrNumber);
    if (!pr) throw new Error(`SAP[mock].convertToPO: unknown PR ${sapPrNumber}`);
    if (pr.poNumber) {
      // Idempotent — return the existing PO.
      const existing = this.pos.get(pr.poNumber)!;
      return { sapPoNumber: existing.sapPoNumber, status: existing.status, deliveryDate: existing.deliveryDate };
    }
    if (pr.status !== "approved") {
      throw new Error(`SAP[mock].convertToPO: PR ${sapPrNumber} is "${pr.status}", must be "approved"`);
    }
    const sapPoNumber = `PO-MOCK-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const now = Date.now();
    this.pos.set(sapPoNumber, {
      sapPoNumber,
      prNumber: sapPrNumber,
      status: "open",
      createdAt: now,
      lastAdvancedAt: now,
    });
    pr.poNumber = sapPoNumber;
    pr.status = "po_issued";
    pr.lastAdvancedAt = now;
    return { sapPoNumber, status: "open" };
  }

  async getPOStatus(sapPoNumber: string): Promise<SapPurchaseOrder> {
    const po = this.pos.get(sapPoNumber);
    if (!po) throw new Error(`SAP[mock].getPOStatus: unknown PO ${sapPoNumber}`);

    // open → in_transit → received. Each step gated by DWELL_MS.
    if (Date.now() - po.lastAdvancedAt >= DWELL_MS) {
      if (po.status === "open") {
        po.status = "in_transit";
        po.lastAdvancedAt = Date.now();
      } else if (po.status === "in_transit") {
        po.status = "received";
        po.deliveryDate = new Date().toISOString().slice(0, 10);
        po.lastAdvancedAt = Date.now();
      }
    }

    return { sapPoNumber, status: po.status, deliveryDate: po.deliveryDate };
  }

  async cancelPR(sapPrNumber: string): Promise<SapPurchaseRequisition> {
    const pr = this.prs.get(sapPrNumber);
    if (!pr) throw new Error(`SAP[mock].cancelPR: unknown PR ${sapPrNumber}`);
    if (pr.poNumber) {
      throw new Error(`SAP[mock].cancelPR: PR ${sapPrNumber} already issued PO ${pr.poNumber}; cancel the PO instead`);
    }
    pr.status = "cancelled";
    pr.lastAdvancedAt = Date.now();
    return { sapPrNumber, status: "cancelled" };
  }
}

// Module-level singleton — the adapter is stateful and we want one instance
// across the whole server process (so the same in-memory store backs every
// route + cron tick).
export const mockSapAdapter: SapAdapter = new MockSapAdapter();
