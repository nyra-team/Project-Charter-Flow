import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

/**
 * Master Employee DB client (service-role).
 *
 * Reads MASTER_DB_URL + MASTER_DB_SERVICE_ROLE_KEY from env on first call.
 * Lazy so missing env at module-load time doesn't crash the build/import.
 */
export function getMasterDb(): SupabaseClient {
  if (cached) return cached;
  const url = process.env["MASTER_DB_URL"];
  const key = process.env["MASTER_DB_SERVICE_ROLE_KEY"];
  if (!url || !key) {
    throw new Error(
      "MASTER_DB_URL and MASTER_DB_SERVICE_ROLE_KEY must be set in the environment.",
    );
  }
  cached = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cached;
}
