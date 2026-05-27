import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Master Employee DB client (anon, browser-side).
 *
 * Used for auth only — login / session reads / signOut. Data queries for
 * project-hub continue to flow through the api-server, which gates them
 * via the access_pmo flag on this same database.
 *
 * The storage key matches the convention shared with Portal / Recruit /
 * PMS / OHC so a user who logs into any of those gets an already-warm
 * session when they hit Project Hub on the same domain.
 */
const url = import.meta.env["VITE_MASTER_DB_URL"] as string | undefined;
const anon = import.meta.env["VITE_MASTER_DB_ANON_KEY"] as string | undefined;

export const supabase: SupabaseClient | null = url && anon
  ? createClient(url, anon, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        storageKey: "granules-master-auth",
      },
    })
  : null;

/** Returns the current access token, refreshing if needed. Null when logged out. */
export async function getFreshToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
