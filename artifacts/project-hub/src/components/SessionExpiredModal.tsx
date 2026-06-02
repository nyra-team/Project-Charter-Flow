import { useEffect, useState } from "react";
import { supabase, getPortalLoginUrl } from "../lib/supabase";
import {
  SESSION_EXPIRED_EVENT,
  resetFetchInterceptorDispatchFlag,
} from "../lib/fetchInterceptor";

/**
 * Listens for the `granules:session-expired` event dispatched by the fetch
 * interceptor when an authorized API call comes back 401. Shows a modal
 * that signs the user out and bounces them to the Portal login.
 */
export function SessionExpiredModal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener(SESSION_EXPIRED_EVENT, handler);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handler);
  }, []);

  if (!open) return null;

  const loginUrl = getPortalLoginUrl();

  const handleLogin = async () => {
    if (supabase) await supabase.auth.signOut();
    resetFetchInterceptorDispatchFlag();
    const returnUrl = window.location.origin + window.location.pathname + window.location.search;
    window.location.href = `${loginUrl}?redirect=${encodeURIComponent(returnUrl)}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-card text-card-foreground rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4 space-y-4">
        <p className="text-base font-semibold">Session expired</p>
        <p className="text-sm text-muted-foreground">
          Your sign-in has timed out. Log in again to continue.
        </p>
        <button
          onClick={handleLogin}
          className="w-full py-2 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90"
        >
          Log in
        </button>
      </div>
    </div>
  );
}
