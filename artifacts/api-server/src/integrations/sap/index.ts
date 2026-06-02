import { logger } from "../../lib/logger";
import { mockSapAdapter } from "./mockSapAdapter";
import { realSapAdapter } from "./realSapAdapter";
import type { SapAdapter } from "./types";

// Singleton selector — pick the adapter from process.env at first call,
// mirror the lazy-init pattern from lib/objectStorage.ts / lib/masterDb.ts.
// Reading env inside the function (not at module load) survives the dotenv
// ordering issues called out in the workspace CLAUDE.md.
let _adapter: SapAdapter | null = null;

export function getSapAdapter(): SapAdapter {
  if (_adapter) return _adapter;
  const mode = (process.env["SAP_MODE"] || "mock").toLowerCase();
  if (mode === "real") {
    _adapter = realSapAdapter;
    logger.info("sap: using real adapter (S/4HANA OData)");
  } else {
    _adapter = mockSapAdapter;
    logger.info({ mode }, "sap: using mock adapter (in-memory)");
  }
  return _adapter;
}

export type { SapAdapter } from "./types";
export type {
  CreatePRInput,
  SapPurchaseRequisitionLine,
  SapPurchaseRequisition,
  SapPurchaseOrder,
} from "./types";
