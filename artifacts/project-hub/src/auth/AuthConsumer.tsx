import { useEffect, useState, type ReactNode } from "react";
import { supabase, getPortalLoginUrl } from "../lib/supabase";
import { AuthContext } from "./context";
import type { AuthUser, Profile } from "./types";
import { useUserStore } from "../lib/store";

/**
 * Hydrate the legacy zustand `useUserStore` (numeric pmo_users.id +
 * simulated role) from the authenticated employee's real pmo_users row.
 *
 * The backend `/api/users/me` endpoint auto-provisions a pmo_users row on
 * first sight, so this works for any newly-granted access_pmo employee
 * without any DB seeding. Failures are logged but non-fatal — the app
 * still renders, just with the seeded mock user id as a fallback.
 */
async function hydrateLocalUser(): Promise<void> {
  try {
    const res = await fetch("/api/users/me");
    if (!res.ok) {
      console.warn("[auth] /api/users/me returned", res.status);
      return;
    }
    const row = await res.json() as { id: number; role: string };
    if (typeof row?.id === "number") {
      const store = useUserStore.getState();
      store.setUserId(row.id);
      if (row.role) store.setRole(row.role);
    }
  } catch (err) {
    console.warn("[auth] /api/users/me failed", err);
  }
}

const SESSION_TIMEOUT_MS = 8 * 60 * 60 * 1000;
const SESSION_START_KEY = "granules-session-start";

function isSessionExpired(): boolean {
  const start = localStorage.getItem(SESSION_START_KEY);
  if (!start) return false;
  return Date.now() - Number(start) > SESSION_TIMEOUT_MS;
}

function redirectToLogin(loginUrl: string): void {
  const returnUrl = window.location.origin + window.location.pathname + window.location.search;
  window.location.href = `${loginUrl}?redirect=${encodeURIComponent(returnUrl)}`;
}

async function fetchProfile(userId: string, userEmail: string): Promise<Profile | null> {
  if (!supabase) return null;
  const emailLower = userEmail.toLowerCase();

  const { data: emp } = await supabase
    .from("employees")
    .select("id, employee_code, first_name, last_name, office_email, employee_auth(access_pmo, pmo_role, is_admin, is_super_admin)")
    .ilike("office_email", emailLower)
    .maybeSingle();

  if (emp) {
    const auth = Array.isArray(emp.employee_auth) ? emp.employee_auth[0] : emp.employee_auth;
    return {
      id: userId,
      email: emp.office_email ?? userEmail,
      full_name: `${emp.first_name ?? ""} ${emp.last_name ?? ""}`.trim() || null,
      employee_code: emp.employee_code ?? null,
      employee_id: emp.id ?? null,
      access_pmo: auth?.access_pmo ?? false,
      pmo_role: auth?.pmo_role === "admin" ? "admin" : null,
      is_admin: auth?.is_admin ?? false,
      is_super_admin: auth?.is_super_admin ?? false,
    };
  }

  const { data: ct } = await supabase
    .from("contractual_employees")
    .select("id, employee_code, first_name, last_name, office_email, employee_auth(access_pmo, pmo_role, is_admin, is_super_admin)")
    .ilike("office_email", emailLower)
    .maybeSingle();

  if (ct) {
    const auth = Array.isArray(ct.employee_auth) ? ct.employee_auth[0] : ct.employee_auth;
    return {
      id: userId,
      email: ct.office_email ?? userEmail,
      full_name: `${ct.first_name ?? ""} ${ct.last_name ?? ""}`.trim() || null,
      employee_code: ct.employee_code ?? null,
      employee_id: ct.id ?? null,
      access_pmo: auth?.access_pmo ?? false,
      pmo_role: auth?.pmo_role === "admin" ? "admin" : null,
      is_admin: auth?.is_admin ?? false,
      is_super_admin: auth?.is_super_admin ?? false,
    };
  }

  return null;
}

interface AuthConsumerProps {
  children: ReactNode;
  /** Optional override. Default: derived from window.location via
   *  getPortalLoginUrl() so the redirect works across same-machine
   *  localhost, LAN-IP dev, and prod subdomain access. */
  loginUrl?: string;
}

/**
 * Read-only auth provider for Project Hub. Mirrors the pattern that
 * Recruit / PMS / OHC use against the Master Employee DB:
 *   - Reads the existing Supabase session from localStorage (shared with
 *     Portal under the same `granules-master-auth` key).
 *   - If no session → redirects to the Portal login URL.
 *   - If logged in → fetches the employee profile and gates the app on
 *     `access_pmo` (or `is_super_admin`).
 *   - No sign-in UI here — auth happens in Portal.
 */
export function AuthConsumer({ children, loginUrl }: AuthConsumerProps) {
  const portalLoginUrl = loginUrl ?? getPortalLoginUrl();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileReady, setProfileReady] = useState(false);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    let mounted = true;

    if (!supabase) {
      console.warn("[auth] VITE_MASTER_DB_URL / VITE_MASTER_DB_ANON_KEY not set; auth disabled.");
      setLoading(false);
      setProfileReady(true);
      return () => { mounted = false; };
    }

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!mounted) return;

      if (!session || isSessionExpired()) {
        if (isSessionExpired()) {
          localStorage.removeItem(SESSION_START_KEY);
          if (session) await supabase!.auth.signOut();
        }
        setLoading(false);
        setProfileReady(true);
        redirectToLogin(portalLoginUrl);
        return;
      }

      const u = session.user;
      const email = u.email ?? "";
      setUser({ id: u.id, email });

      const dbProfile = await fetchProfile(u.id, email);
      if (!mounted) return;

      if (!dbProfile) {
        setDenied(true);
        setLoading(false);
        setProfileReady(true);
        return;
      }
      if (!dbProfile.access_pmo && !dbProfile.is_super_admin) {
        setDenied(true);
        setProfile(dbProfile);
        setLoading(false);
        setProfileReady(true);
        return;
      }

      setProfile(dbProfile);
      // Fire-and-forget hydration of the local pmo_users id/role. Doesn't
      // block render — the app shows the master DB name immediately;
      // useUserStore.userId catches up moments later.
      void hydrateLocalUser();
      setLoading(false);
      setProfileReady(true);
    }).catch((err) => {
      console.error("[auth] getSession failed", err);
      if (mounted) {
        setLoading(false);
        setProfileReady(true);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (event === "TOKEN_REFRESHED") return;
      if (!session) {
        setUser(null);
        setProfile(null);
        redirectToLogin(portalLoginUrl);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [portalLoginUrl]);

  const signOut = async () => {
    setUser(null);
    setProfile(null);
    localStorage.removeItem(SESSION_START_KEY);
    if (supabase) await supabase.auth.signOut();
    redirectToLogin(portalLoginUrl);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary" />
      </div>
    );
  }

  if (denied) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background p-6">
        <div className="max-w-md text-center space-y-3">
          <p className="text-lg font-semibold text-foreground">Project Hub access not granted</p>
          <p className="text-sm text-muted-foreground">
            Your account is signed in but doesn&apos;t have <code>access_pmo</code>. Ask a Portal admin to enable it for you.
          </p>
          <button
            onClick={signOut}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90"
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ user, profile, loading, profileReady, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
