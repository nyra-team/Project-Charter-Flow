import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";

let cached: SupabaseClient | null = null;

/**
 * Vendor-auth Supabase client (service-role).
 *
 * Reads VENDOR_AUTH_DB_URL + VENDOR_AUTH_DB_SERVICE_ROLE_KEY from env. If
 * those aren't set, falls back to RECRUIT_DB_URL + RECRUIT_DB_SERVICE_ROLE_KEY
 * — the same Supabase project the candidate portal uses — so a fresh dev
 * env can run the vendor portal without provisioning a third project. Real
 * deployment SHOULD set VENDOR_AUTH_DB_* to a dedicated project to keep
 * vendor identities separate from candidate identities.
 *
 * Lazy so missing env at module-load time doesn't crash the build/import.
 */
export function getVendorAuthDb(): SupabaseClient {
  if (cached) return cached;
  const url = process.env["VENDOR_AUTH_DB_URL"] || process.env["RECRUIT_DB_URL"] || process.env["SUPABASE_URL"];
  const key = process.env["VENDOR_AUTH_DB_SERVICE_ROLE_KEY"]
    || process.env["RECRUIT_DB_SERVICE_ROLE_KEY"]
    || process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) {
    throw new Error(
      "VENDOR_AUTH_DB_URL + VENDOR_AUTH_DB_SERVICE_ROLE_KEY (or RECRUIT_DB_* fallback) must be set.",
    );
  }
  cached = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
  });
  return cached;
}
