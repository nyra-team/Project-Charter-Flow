import type {
  SapAdapter,
  CreatePRInput,
  SapPurchaseRequisition,
  SapPurchaseOrder,
} from "./types";

/**
 * Typed stub for the real S/4HANA SAP integration. Activated only when
 * SAP_MODE=real; otherwise the selector in ./index.ts hands back the mock.
 *
 * Wiring TODOs (intentionally not implemented in Stage 5):
 *  - Auth: SAP service-user OAuth (client credentials or username/password).
 *    Read SAP_BASE_URL, SAP_CLIENT_ID, SAP_CLIENT_SECRET (or
 *    SAP_USERNAME/SAP_PASSWORD) from env at first call (lazy, never at
 *    module load — same rule as the LLM client to survive dotenv ordering).
 *  - OData endpoint: SAP_BASE_URL + "/sap/opu/odata/sap/MM_PUR_PR_API_SRV/"
 *    for PRs, "/MM_PO_API_SRV/" for POs.
 *  - CSRF: SAP requires GET /$metadata first to grab an X-CSRF-Token, which
 *    must be sent with every mutating call. Cache the token per session.
 *  - Mapping: SAP returns SAP-specific strings ("01" = pending, "05" =
 *    approved, "I1132" = released, …). Translate to the canonical
 *    {pending|approved|po_issued|received|rejected|cancelled} that the UI
 *    expects in routes/purchase_orders.ts.
 *  - Error handling: SAP 5xx and CSRF-expired must auto-retry exactly once
 *    after refreshing the token; everything else surface as-is.
 *
 * Until the wiring lands every method throws — guaranteed by the selector
 * which never instantiates this class unless SAP_MODE=real.
 */
class RealSapAdapter implements SapAdapter {
  readonly mode = "real" as const;

  async createPR(_input: CreatePRInput): Promise<SapPurchaseRequisition> {
    throw new Error("SAP[real].createPR: not wired yet. Provide SAP_BASE_URL + credentials and implement OData call.");
  }

  async getPRStatus(_sapPrNumber: string): Promise<SapPurchaseRequisition> {
    throw new Error("SAP[real].getPRStatus: not wired yet.");
  }

  async convertToPO(_sapPrNumber: string): Promise<SapPurchaseOrder> {
    throw new Error("SAP[real].convertToPO: not wired yet.");
  }

  async getPOStatus(_sapPoNumber: string): Promise<SapPurchaseOrder> {
    throw new Error("SAP[real].getPOStatus: not wired yet.");
  }

  async cancelPR(_sapPrNumber: string): Promise<SapPurchaseRequisition> {
    throw new Error("SAP[real].cancelPR: not wired yet.");
  }
}

export const realSapAdapter: SapAdapter = new RealSapAdapter();
