import { Link, useLocation } from "wouter";
import { useUserStore } from "../lib/store";
import { useTheme } from "../lib/use-theme";
import { useAuth } from "../auth/context";
import { Sparkles, Settings, Plug, Moon, Sun } from "lucide-react";
import { useState, useEffect } from "react";
import { AppHeader } from "@granules/shared/components/AppHeader";
import PmoSidebar from "./PmoSidebar";
import { NotificationBell } from "./notification-bell";
import { RoleSimulator } from "./role-simulator";
import { openAskNyra } from "./AskNyra";
import { useAiStatus } from "./ai-button";
import { ConnectorsPopup } from "./ConnectorsPopup";
import { CharterNfaPopup } from "./CharterNfaPopup";

const ADMIN_ROLES = ["pmo", "executive_director", "chairman"];

// "Ask NYRA" launcher for the top header — opens the floating analyst panel
// (AskNyra listens for ask-nyra:open). Hidden when AI isn't configured.
function AskNyraButton() {
  const status = useAiStatus();
  if (status && !status.configured) return null;
  return (
    <button
      type="button"
      onClick={openAskNyra}
      aria-label="Ask NYRA"
      title="Ask NYRA — your portfolio analyst"
      className="group relative flex items-center justify-center gap-2 h-9 w-9 sm:w-auto sm:px-3.5 rounded-full text-white
        bg-[linear-gradient(110deg,#0E7FBE,#1090D0_55%,#34ABE6)] bg-[length:200%_100%] bg-[position:0%]
        shadow-[0_2px_12px_-2px_rgba(16,144,208,0.55)] ring-1 ring-white/10
        hover:bg-[position:100%] hover:shadow-[0_4px_18px_-2px_rgba(16,144,208,0.7)]
        transition-[background-position,box-shadow] duration-500 ease-out"
    >
      <Sparkles size={15} className="shrink-0 drop-shadow-sm transition-transform duration-500 group-hover:rotate-[18deg] group-hover:scale-110" />
      <span className="hidden sm:inline text-[13px] font-semibold tracking-tight">Ask NYRA</span>
      <span aria-hidden className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-t from-transparent to-white/15" />
    </button>
  );
}

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
  const [location] = useLocation();
  const { role, setRole } = useUserStore();
  const { profile, signOut } = useAuth();

  const displayName = profile?.full_name || profile?.email || "Signed in";
  const roleLabel = role ? role.replace(/_/g, " ") : "";

  const [mobileOpen, setMobileOpen] = useState(false);
  const [connectorsOpen, setConnectorsOpen] = useState(false);
  // Charter/e-NFA workflow chooser — opened by the "Charter + e-NFA" nav item.
  const [charterNfaOpen, setCharterNfaOpen] = useState(false);
  const openCharterNfa = () => { setMobileOpen(false); setCharterNfaOpen(true); };

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

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      {/* Suite-shared sidebar (same component as portal / recruit / pms / cxo) */}
      <PmoSidebar
        isAdmin={isAdmin}
        isSuperAdmin={isSuperAdmin}
        onCharterNfa={openCharterNfa}
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
            actions={
              <>
                <RoleSimulator />
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
                <AskNyraButton />
              </>
            }
          />
        </div>

        {/* Page Content */}
        <div className="relative flex-1 overflow-y-auto scrollbar-thin bg-background">
          <div className="page-ambient" />
          <div key={location} className="relative w-full p-4 sm:p-6 lg:p-8 ph-rise">
            {children}
          </div>
        </div>
      </div>

      {/* Connectors & data-sources popup — globally available to admins. */}
      <ConnectorsPopup open={connectorsOpen} onClose={() => setConnectorsOpen(false)} />

      {/* Charter / e-NFA workflow chooser — opened by the "Charter + e-NFA" nav item. */}
      <CharterNfaPopup open={charterNfaOpen} onClose={() => setCharterNfaOpen(false)} />
    </div>
  );
}
