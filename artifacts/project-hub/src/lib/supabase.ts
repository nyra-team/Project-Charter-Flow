import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Master Employee DB client (anon, browser-side).
 *
 * Uses `@supabase/ssr`'s `createBrowserClient` so the auth session is
 * stored as a cookie scoped to the parent domain (`.granulesrecruit.com`)
 * — exactly the way Portal / Recruit / OHC / PMS do it. Logging in on
 * any one subdomain ([…].granulesrecruit.com) automatically hydrates
 * the session on every other subdomain, including pmo.granulesrecruit.com,
 * without any redirect/token-bridging code.
 *
 * On `localhost` or LAN IP hostnames, cookies can't be scoped to a parent
 * domain, so the session falls back to that origin's localStorage only —
 * meaning the IP/port URL is fine for direct PMO testing but won't share
 * session with a Portal that's on a different port/IP. To get a single
 * shared login experience, browse every app via
 * https://*.granulesrecruit.com.
 */
function getCookieDomain(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const { hostname } = window.location;
  if (hostname.endsWith("granulesrecruit.com")) return ".granulesrecruit.com";
  if (hostname.endsWith("mygranules.com")) return ".mygranules.com";
  return undefined; // localhost / IP — no parent-domain cookie possible
}

const url = import.meta.env["VITE_MASTER_DB_URL"] as string | undefined;
const anon = import.meta.env["VITE_MASTER_DB_ANON_KEY"] as string | undefined;

export const supabase: SupabaseClient | null = url && anon
  ? createBrowserClient(url, anon, {
      cookieOptions: {
        domain: getCookieDomain(),
        path: "/",
        sameSite: "lax",
        secure: typeof window !== "undefined" && window.location.protocol === "https:",
      },
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

/** Returns the current access token, refreshing if needed. Null when logged out. */
export async function getFreshToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) return null;
  // Supabase access tokens last ~1h. getSession() can hand back an expired
  // token if the background auto-refresh hasn't fired (idle/blurred tab),
  // which the api-server then 401s → a spurious "session expired" modal.
  // Force a refresh when the token is past or within 60s of expiry so we
  // never attach a stale token. Genuine expiry (dead refresh token) makes
  // refreshSession() error → we return the stale token → 401 → modal (correct).
  const expMs = (session.expires_at ?? 0) * 1000;
  if (!session.expires_at || expMs - Date.now() < 60_000) {
    const { data: refreshed, error } = await supabase.auth.refreshSession();
    if (!error && refreshed.session?.access_token) return refreshed.session.access_token;
  }
  return session.access_token ?? null;
}

/**
 * Resolve the Portal `/login` URL from the current browser location.
 *
 *   pmo.granulesrecruit.com  → https://granulesrecruit.com/login   (prod, cookie-shared)
 *   granulesrecruit.com      → /login                              (same origin)
 *   172.30.101.2:5182        → http://172.30.101.2:5173/login     (LAN dev)
 *   localhost:5182           → http://localhost:5173/login         (same-machine dev)
 */
export function getPortalLoginUrl(): string {
  if (typeof window === "undefined") return "/login";
  const { protocol, hostname } = window.location;

  if (hostname.endsWith(".granulesrecruit.com")) {
    return `${protocol}//granulesrecruit.com/login`;
  }
  if (hostname === "granulesrecruit.com" || hostname === "www.granulesrecruit.com") {
    return "/login";
  }

  return `${protocol}//${hostname}:5173/login`;
}
