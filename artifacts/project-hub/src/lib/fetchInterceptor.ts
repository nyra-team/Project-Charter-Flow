import { getFreshToken } from "./supabase";

export const SESSION_EXPIRED_EVENT = "granules:session-expired";

let installed = false;
let dispatched = false;

/**
 * Monkey-patch `window.fetch` so every call into `/api/...` carries the
 * current Master DB bearer token. Idempotent — safe to call from main.tsx.
 *
 * On a 401 to a call we actually authorized, dispatches a
 * `granules:session-expired` CustomEvent so SessionExpiredModal can prompt
 * the user to log in again. Pre-auth 401s (no token attached) are ignored
 * so we don't false-trigger on, e.g., the initial /api/healthz from a
 * logged-out browser.
 */
export function installFetchInterceptor(): void {
  if (installed) return;
  installed = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    const isApi = url.startsWith("/api/") || url.includes("/api/");
    let tokenAttached = false;
    let nextInit = init;

    if (isApi) {
      const headers = new Headers(init?.headers);
      try {
        const token = await getFreshToken();
        if (token && !headers.has("Authorization")) {
          headers.set("Authorization", `Bearer ${token}`);
          tokenAttached = true;
        } else if (headers.has("Authorization")) {
          tokenAttached = true;
        }
      } catch {
        /* no session — request goes through unauthorized */
      }
      nextInit = { ...init, headers };
    }

    const res = await originalFetch(input, nextInit);

    if (res.status === 401 && tokenAttached && !dispatched) {
      dispatched = true;
      window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
    }

    return res;
  };
}

export function resetFetchInterceptorDispatchFlag(): void {
  dispatched = false;
}
