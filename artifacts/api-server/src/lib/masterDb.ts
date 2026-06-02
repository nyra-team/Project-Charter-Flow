import { createClient, type SupabaseClient } from "@supabase/supabase-js";
// @supabase/supabase-js@2.106+ instantiates a RealtimeClient inside its
// constructor unconditionally. On Node < 22 there's no native global
// WebSocket, so the RealtimeClient throws at init time and every request
// that touches getMasterDb() (i.e. every auth-gated endpoint) 500s. We
// don't use Supabase Realtime here; we just need a non-crashing transport,
// so feed it the well-established `ws` package as the WebSocket impl.
//
// `ws` is a tiny, mature, transitively-already-installed dep — adding it
// directly to the api-server's package.json is a metadata-only change
// (no fresh download, so the workspace's minimumReleaseAge policy doesn't
// fire).
import WebSocket from "ws";

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
    realtime: {
      // Node 20 has no global WebSocket; supply `ws` so RealtimeClient's
      // constructor doesn't throw. We never subscribe to channels, so the
      // socket itself is never opened — this is purely to keep the
      // constructor happy.
      transport: WebSocket as unknown as typeof globalThis.WebSocket,
    },
  });
  return cached;
}
