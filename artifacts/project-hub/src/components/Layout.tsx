import { Link, useLocation } from "wouter";
import { useUserStore } from "../lib/store";
import { useTheme } from "../lib/use-theme";
import { useAuth } from "../auth/context";
import { Settings, Plug, Moon, Sun, LogOut } from "lucide-react";
import { useState, useEffect } from "react";
import { AppHeader } from "@granules/shared/components/AppHeader";
import PmoSidebar from "./PmoSidebar";
import { NotificationBell } from "./notification-bell";
import { ConnectorsPopup } from "./ConnectorsPopup";
import { CharterNfaPopup } from "./CharterNfaPopup";

const ADMIN_ROLES = ["pmo", "executive_director", "chairman"];

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button
      onClick={toggleTheme}
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      aria-label="Toggle color theme"
      className="relative w-9 h-9 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
    >
      <Sun size={16} className={`absolute transition-all ${theme === "dark" ? "rotate-90 scale-0 opacity-0" : "rotate-0 scale-100 opacity-100"}`} />
      <Moon size={16} className={`absolute transition-all ${theme === "dark" ? "rotate-0 scale-100 opacity-100" : "-rotate-90 scale-0 opacity-0"}`} />
    </button>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const { role, setRole } = useUserStore();
  const { profile, signOut } = useAuth();

  const displayName = profile?.full_name || profile?.email || "Signed in";
  const roleLabel = role ? role.replace(/_/g, " ") : "";

  const [mobileOpen, setMobileOpen] = useState(false);
  const [connectorsOpen, setConnectorsOpen] = useState(false);
  const [charterNfaOpen, setCharterNfaOpen] = useState(false);
  // "Charter + e-NFA" nav item goes straight to the charters list (no chooser popup).
  const openCharterNfa = () => { setMobileOpen(false); setLocation("/charters"); };
  // "Business Case" CTA opens the two-card workflow chooser popup.
  const openBusinessCase = () => { setMobileOpen(false); setCharterNfaOpen(true); };

  // Close mobile drawer on route change.
  useEffect(() => { setMobileOpen(false); }, [location]);

  // Sync the UI role from the user's REAL role (resolved from the master
  // employee DB, returned by /api/users/me). Authorization is enforced
  // server-side off this same real role.
  useEffect(() => {
    fetch("/api/users/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => { if (me?.pmoRole) setRole(me.pmoRole); })
      .catch(() => {});
  }, [setRole]);

  const isAdmin = ADMIN_ROLES.includes(role);
  const isSuperAdmin = !!profile?.is_super_admin;

  // Signed-in identity — moved out of the top bar to the sidebar foot.
  const initials = displayName.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join("") || "U";
  const profileFooter = (
    <div className="flex items-center gap-2.5 px-3 py-3">
      <div className="w-9 h-9 shrink-0 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white text-xs font-bold border border-border">
        {initials}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium leading-tight text-foreground">{displayName}</p>
        {roleLabel && <p className="truncate text-xs capitalize text-muted-foreground">{roleLabel}</p>}
      </div>
      <button
        onClick={() => { void signOut(); }}
        title="Sign out"
        aria-label="Sign out"
        className="shrink-0 w-8 h-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
      >
        <LogOut size={16} />
      </button>
    </div>
  );

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      {/* Suite-shared sidebar (same component as portal / recruit / pms / cxo) */}
      <PmoSidebar
        isAdmin={isAdmin}
        isSuperAdmin={isSuperAdmin}
        onCharterNfa={openCharterNfa}
        onBusinessCase={openBusinessCase}
        mobileOpen={mobileOpen}
        onClose={() => setMobileOpen(false)}
        footer={profileFooter}
      />

      {/* Main Content */}
      <div className="flex-1 min-w-0 flex flex-col h-screen overflow-hidden">
        {/* Suite-shared header. Project Hub doesn't mount the shared
            AuthProvider, so the signed-in identity + sign-out are passed via
            the context-less props. The app's root tokens are the suite/OHC
            palette, so the bar matches the rail with no extra scoping. */}
        <div className="flex-shrink-0">
          <AppHeader
            onMenuToggle={() => setMobileOpen(true)}
            searchPlaceholder="Search portfolios, projects…"
            profile={{ full_name: displayName, email: profile?.email, role: roleLabel }}
            onSignOut={() => { void signOut(); }}
            hideProfileChip
            hideSearch
            leftSlot={
              /* Page-owned controls portal into here (e.g. the portfolio
                 Search + Department + Health filters), left corner. */
              <div id="ph-topbar-slot" className="hidden lg:flex items-center gap-2" />
            }
            actions={
              <>
                <ThemeToggle />
                <NotificationBell />
                {isAdmin && (
                  <button
                    onClick={() => setConnectorsOpen(true)}
                    title="Connectors & Data Sources"
                    aria-label="Open connectors and data sources"
                    className="hidden sm:flex w-9 h-9 rounded-md items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors duration-200"
                  >
                    <Plug size={16} />
                  </button>
                )}
                <Link href="/admin/scoring">
                  <button className="hidden sm:flex w-9 h-9 rounded-md items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors duration-200" title="Scoring Configuration">
                    <Settings size={16} />
                  </button>
                </Link>
              </>
            }
          />
        </div>

        {/* Page Content */}
        <div id="ph-content" className="relative flex-1 overflow-y-auto scrollbar-thin bg-background">
          <div className="page-ambient" />
          <div key={location} className="relative w-full px-4 sm:px-6 lg:px-8 pt-3 pb-6 lg:pb-8 ph-rise">
            {children}
          </div>
        </div>
      </div>

      {/* Connectors & data-sources popup — globally available to admins. */}
      <ConnectorsPopup open={connectorsOpen} onClose={() => setConnectorsOpen(false)} />
      <CharterNfaPopup open={charterNfaOpen} onClose={() => setCharterNfaOpen(false)} />
    </div>
  );
}
