import { Link, useLocation } from "wouter";
import { useUserStore } from "../lib/store";
import { useTheme } from "../lib/use-theme";
import { useAuth } from "../auth/context";
import { Settings, Plug, Moon, Sun, Compass } from "lucide-react";
import { useState, useEffect } from "react";
import { AppHeader } from "@granules/shared/components/AppHeader";
import PmoSidebar from "./PmoSidebar";
import { NotificationBell } from "./notification-bell";
import { ConnectorsPopup } from "./ConnectorsPopup";
import { CharterNfaPopup } from "./CharterNfaPopup";

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
  const { role, setRole, setIsSuperAdmin } = useUserStore();
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

  // Close mobile drawer + the Business Case chooser on route change (so the
  // tour navigating into a charter form doesn't leave the popup hanging over it).
  useEffect(() => { setMobileOpen(false); setCharterNfaOpen(false); }, [location]);

  // Let the guided tour drive the Business Case chooser directly (so it doesn't
  // depend on the sidebar CTA, which is hidden when the rail is collapsed).
  useEffect(() => {
    const open = () => setCharterNfaOpen(true);
    const close = () => setCharterNfaOpen(false);
    window.addEventListener("pmo:tour:open-business-case", open);
    window.addEventListener("pmo:tour:close-business-case", close);
    return () => {
      window.removeEventListener("pmo:tour:open-business-case", open);
      window.removeEventListener("pmo:tour:close-business-case", close);
    };
  }, []);

  // Sync the UI role from the user's REAL role (resolved from the master
  // employee DB, returned by /api/users/me). Authorization is enforced
  // server-side off this same real role.
  useEffect(() => {
    fetch("/api/users/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => { if (me?.pmoRole) setRole(me.pmoRole); setIsSuperAdmin(!!me?.isSuperAdmin); })
      .catch(() => {});
  }, [setRole, setIsSuperAdmin]);

  // PMO has no functional roles anymore — every PMO user sees all sections,
  // including the Admin section + admin topbar tools.
  const isAdmin = true;
  const isSuperAdmin = !!profile?.is_super_admin;

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
            hideSearch
            leftSlot={
              /* Page-owned controls portal into here (e.g. the portfolio
                 Search + Department + Health filters), left corner. */
              <div id="ph-topbar-slot" className="hidden lg:flex items-center gap-2" />
            }
            actions={
              <>
                <button
                  onClick={() => window.dispatchEvent(new Event("pmo:start-tour-live"))}
                  title="Take a guided tour"
                  aria-label="Take a guided product tour"
                  className="hidden md:flex w-9 h-9 rounded-md items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors duration-200"
                >
                  <Compass size={16} />
                </button>
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
          {/* min-h-full column so the footer hugs the bottom of the window on
              short pages, and trails the content on long (scrolling) ones. */}
          <div className="min-h-full flex flex-col">
            <div key={location} className="relative w-full flex-1 px-4 sm:px-6 lg:px-8 pt-3 pb-6 lg:pb-8 ph-rise">
              {children}
            </div>
            <footer className="mt-auto px-4 sm:px-6 lg:px-8 pt-4 pb-4 flex items-center justify-center gap-2 text-[11px] font-medium text-muted-foreground border-t border-border/50">
              <span className="leading-none">Powered by</span>
              <img src="/txo-logo.png" alt="TXO" className="h-4 w-auto object-contain block -translate-y-[10%]" />
            </footer>
          </div>
        </div>
      </div>

      {/* Connectors & data-sources popup — globally available to admins. */}
      <ConnectorsPopup open={connectorsOpen} onClose={() => setConnectorsOpen(false)} />
      <CharterNfaPopup open={charterNfaOpen} onClose={() => setCharterNfaOpen(false)} />
    </div>
  );
}
