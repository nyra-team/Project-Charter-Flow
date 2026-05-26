import { Link, useLocation } from "wouter";
import { useUserStore } from "../lib/store";
import { useTheme } from "../lib/use-theme";
import {
  BarChart3,
  Briefcase,
  CheckSquare,
  FileText,
  LayoutDashboard,
  Sparkles,
  Inbox,
  Workflow,
  LogOut,
  Settings,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Search,
  FolderOpen,
  PieChart,
  BookOpen,
  Moon,
  Sun,
  Command,
  Menu,
  X,
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { NotificationBell } from "./notification-bell";

const SIDEBAR_COLLAPSED_KEY = "ph:sidebar:collapsed";

const ROLES = [
  { value: "initiator", label: "Initiator", initials: "IN" },
  { value: "hod", label: "Head of Dept", initials: "HD" },
  { value: "executive_director", label: "Exec. Director", initials: "ED" },
  { value: "cfo", label: "CFO", initials: "CF" },
  { value: "scm", label: "SCM", initials: "SC" },
  { value: "chairman", label: "Chairman", initials: "CH" },
  { value: "finance", label: "Finance", initials: "FI" },
  { value: "pmo", label: "PMO", initials: "PM" },
  { value: "pm", label: "Project Manager", initials: "PM" },
  { value: "team_member", label: "Team Member", initials: "TM" },
];

type NavItem = { href: string; label: string; icon: React.ComponentType<{ size?: number; className?: string }> };

const MAIN_NAV: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/pipeline", label: "Pipeline", icon: Workflow },
  { href: "/demands", label: "Demands", icon: Inbox },
  { href: "/charters", label: "Charters", icon: FileText },
  { href: "/approvals", label: "Approvals", icon: CheckSquare },
  { href: "/projects", label: "Projects", icon: BarChart3 },
];

const PORTFOLIO_NAV: NavItem[] = [
  { href: "/portfolio", label: "Portfolio View", icon: FolderOpen },
  { href: "/projects/tree", label: "Project Tree", icon: FolderOpen },
  { href: "/documents", label: "Documents", icon: FileText },
  { href: "/lessons-learned", label: "Lessons Learned", icon: BookOpen },
];

const ADMIN_NAV: NavItem[] = [
  { href: "/admin/scoring", label: "Scoring Config", icon: PieChart },
];

const ADMIN_ROLES = ["pmo", "executive_director", "chairman"];

function NavSection({ label, items, location, collapsed }: { label: string; items: NavItem[]; location: string; collapsed: boolean }) {
  return (
    <div>
      <div className={`mt-5 mb-2 ${collapsed ? "px-0 flex justify-center" : "px-3"}`}>
        {collapsed ? (
          <span className="block h-px w-6 bg-sidebar-foreground/15" />
        ) : (
          <span className="text-[10px] font-semibold tracking-[0.18em] uppercase text-sidebar-foreground/40">
            {label}
          </span>
        )}
      </div>
      <div className="space-y-0.5">
        {items.map((item) => {
          const isActive = item.href === "/" ? location === "/" : location.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} aria-label={collapsed ? item.label : undefined} aria-current={isActive ? "page" : undefined}>
              <div
                data-active={isActive}
                title={collapsed ? item.label : undefined}
                className={`nav-pill group relative flex items-center cursor-pointer text-[13px] font-medium ${
                  collapsed
                    ? "justify-center w-10 h-10 mx-auto rounded-lg"
                    : "gap-3 px-3 py-2 mx-1.5 rounded-md"
                } ${
                  isActive
                    ? "bg-sidebar-accent text-sidebar-foreground"
                    : "text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                }`}
              >
                <Icon
                  size={collapsed ? 17 : 16}
                  className={`transition-all duration-300 ${
                    isActive
                      ? "text-sidebar-primary scale-110"
                      : !collapsed ? "group-hover:text-sidebar-foreground group-hover:translate-x-0.5" : "group-hover:text-sidebar-foreground"
                  }`}
                />
                {!collapsed && (
                  <span className="truncate transition-transform duration-300 group-hover:translate-x-0.5">{item.label}</span>
                )}
                {!collapsed && isActive && (
                  <span className="ml-auto w-1.5 h-1.5 rounded-full bg-sidebar-primary shadow-[0_0_8px_hsl(var(--sidebar-primary))]" />
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
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
  const [showRoleMenu, setShowRoleMenu] = useState(false);
  const roleMenuRef = useRef<HTMLDivElement | null>(null);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState<boolean>(() =>
    typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches
  );

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Collapsed (icon-only) layout is desktop-only. On mobile the drawer is always full-width.
  const effectiveCollapsed = isDesktop && collapsed;

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
    setShowRoleMenu(false);
  }, [collapsed]);

  // Close mobile drawer on route change
  useEffect(() => { setMobileOpen(false); }, [location]);

  // Ensure the server-side session knows our current role. Without this, a
  // fresh page load leaves session.simulatedRole unset and any stage-advance
  // call fails with "No role set in session" until the user manually picks a
  // role from the sidebar dropdown.
  useEffect(() => {
    fetch("/api/session/role", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    }).catch(() => {});
  }, [role]);

  // Lock body scroll when mobile drawer is open
  useEffect(() => {
    if (mobileOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = prev; };
    }
  }, [mobileOpen]);

  useEffect(() => {
    if (!showRoleMenu) return;
    const onDocClick = (e: MouseEvent) => {
      if (roleMenuRef.current && !roleMenuRef.current.contains(e.target as Node)) {
        setShowRoleMenu(false);
      }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setShowRoleMenu(false); };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [showRoleMenu]);

  const currentRole = ROLES.find(r => r.value === role) || ROLES[0];
  const isAdmin = ADMIN_ROLES.includes(role);

  const pageTitle = (() => {
    if (location === "/") return "Dashboard";
    if (location === "/portfolio") return "Portfolio View";
    if (location === "/admin/scoring") return "Scoring Configuration";
    const segment = location.split("/")[1];
    if (!segment) return "Dashboard";
    const item = [...MAIN_NAV, ...PORTFOLIO_NAV, ...ADMIN_NAV].find(n => n.href === "/" + segment);
    return item?.label || segment.charAt(0).toUpperCase() + segment.slice(1);
  })();

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      {/* Mobile backdrop — only when drawer open on small screens */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      )}

      {/* Sidebar — premium atelier-dark in both modes.
          Desktop: docked 240px (or collapsed 68px floating rail).
          Mobile: off-canvas drawer, slides in from the left. */}
      <aside
        className={`${collapsed ? "md:w-[68px] md:my-3 md:ml-3 md:rounded-2xl md:shadow-2xl" : "md:w-60 md:rounded-none md:shadow-none"}
          fixed md:relative inset-y-0 left-0 z-50 md:z-auto
          w-[260px] md:flex-shrink-0 flex flex-col sidebar-glossy bg-sidebar text-sidebar-foreground border border-sidebar-border
          shadow-2xl md:shadow-none
          transition-[width,margin,border-radius,transform] duration-300 ease-[cubic-bezier(.16,1,.3,1)]
          ${mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`}
      >
        {/* Mobile close button */}
        <button
          onClick={() => setMobileOpen(false)}
          aria-label="Close menu"
          className="md:hidden absolute top-3 right-3 z-30 w-8 h-8 rounded-md flex items-center justify-center text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
        >
          <X size={16} />
        </button>
        {/* Subtle inner glow — clipped to the rail */}
        <div className={`pointer-events-none absolute inset-0 ambient-mesh-soft opacity-40 ${effectiveCollapsed ? "rounded-2xl" : ""} overflow-hidden`} />

        {/* Logo */}
        <div className={`relative h-16 flex items-center border-b border-sidebar-border ${effectiveCollapsed ? "px-0 justify-center" : "gap-3 px-5"}`}>
          <div className="w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 bg-sidebar-primary text-sidebar-primary-foreground shadow-sm">
            <Command size={15} strokeWidth={2.4} />
          </div>
          {!effectiveCollapsed && (
            <div className="leading-tight min-w-0">
              <div className="font-semibold text-[15px] tracking-tight text-sidebar-foreground truncate">Project Hub</div>
              <div className="text-[10px] tracking-[0.16em] uppercase text-sidebar-foreground/40">Enterprise PMO</div>
            </div>
          )}
        </div>

        {/* Collapse toggle — desktop only; sits on the right edge */}
        <button
          onClick={() => setCollapsed(c => !c)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="hidden md:flex absolute top-[52px] -right-3 z-30 w-6 h-6 rounded-full items-center justify-center bg-sidebar text-sidebar-foreground/70 hover:text-sidebar-foreground border border-sidebar-border shadow-md hover:scale-110 transition-all"
        >
          {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
        </button>

        {/* New Demand CTA — primary entry point into the lifecycle */}
        <div className={`relative ${effectiveCollapsed ? "px-2 pt-3" : "px-3 pt-3"}`}>
          <Link href="/demands/new" aria-label="New Demand">
            <button
              title={effectiveCollapsed ? "New Demand" : undefined}
              className={`btn-glossy-cta flex items-center justify-center gap-2 rounded-md text-[12px] font-semibold w-full ${
                effectiveCollapsed ? "h-10 px-0" : "h-9 px-3"
              }`}
            >
              <Sparkles size={13} />
              {!effectiveCollapsed && <span>New Demand</span>}
            </button>
          </Link>
        </div>

        {/* Navigation */}
        <nav className="relative flex-1 py-2 overflow-y-auto scrollbar-thin">
          <NavSection label="Navigation" items={MAIN_NAV} location={location} collapsed={effectiveCollapsed} />
          <NavSection label="Portfolio" items={PORTFOLIO_NAV} location={location} collapsed={effectiveCollapsed} />
          {isAdmin && <NavSection label="Admin" items={ADMIN_NAV} location={location} collapsed={effectiveCollapsed} />}
        </nav>

        {/* Role Switcher + User */}
        <div className={`relative border-t border-sidebar-border ${effectiveCollapsed ? "p-2 space-y-2" : "p-3 space-y-3"}`}>
          <div className="relative" ref={roleMenuRef}>
            {!effectiveCollapsed && (
              <div className="mb-1.5 px-1">
                <span className="text-[10px] font-semibold tracking-[0.18em] uppercase text-sidebar-foreground/40">
                  Simulate Role
                </span>
              </div>
            )}
            {!effectiveCollapsed ? (
              <button
                onClick={() => setShowRoleMenu(!showRoleMenu)}
                aria-haspopup="menu"
                aria-expanded={showRoleMenu}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-sm bg-sidebar-accent/60 text-sidebar-foreground border border-sidebar-border hover:bg-sidebar-accent transition-colors"
              >
                <div className="w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold flex-shrink-0 bg-sidebar-primary text-sidebar-primary-foreground">
                  {currentRole.initials}
                </div>
                <span className="flex-1 text-left text-xs font-medium truncate">{currentRole.label}</span>
                <ChevronDown size={12} className={`transition-transform ${showRoleMenu ? "rotate-180" : ""}`} />
              </button>
            ) : (
              <button
                onClick={() => setShowRoleMenu(!showRoleMenu)}
                title={`Simulate role · ${currentRole.label}`}
                aria-label={`Simulate role, current ${currentRole.label}`}
                aria-haspopup="menu"
                aria-expanded={showRoleMenu}
                className="w-10 h-10 mx-auto flex items-center justify-center rounded-lg bg-sidebar-accent/60 border border-sidebar-border hover:bg-sidebar-accent transition-colors"
              >
                <div className="w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold bg-sidebar-primary text-sidebar-primary-foreground">
                  {currentRole.initials}
                </div>
              </button>
            )}

            {showRoleMenu && (
              <div
                role="menu"
                className={`absolute bottom-0 rounded-md py-1 z-50 bg-popover text-popover-foreground border border-popover-border shadow-lg max-h-[280px] w-56 overflow-y-auto scrollbar-thin ${
                  effectiveCollapsed ? "left-full ml-3" : "left-0 right-0 mb-1 bottom-full w-auto"
                }`}
              >
                {ROLES.map(r => (
                  <button
                    key={r.value}
                    role="menuitemradio"
                    aria-checked={r.value === role}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left transition-colors ${
                      r.value === role ? "bg-accent text-primary" : "hover:bg-accent/60"
                    }`}
                    onClick={() => {
                      setRole(r.value);
                      setShowRoleMenu(false);
                      fetch("/api/session/role", {
                        method: "POST",
                        credentials: "include",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ role: r.value }),
                      }).catch(() => {});
                    }}
                  >
                    <div className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
                      r.value === role ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                    }`}>
                      {r.initials}
                    </div>
                    {r.label}
                    {r.value === role && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-primary" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* User Info */}
          <div className={`flex items-center ${effectiveCollapsed ? "justify-center" : "gap-3 px-1"}`}>
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-sm" title={effectiveCollapsed ? "John Doe" : undefined}>
              JD
            </div>
            {!effectiveCollapsed && (
              <>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-sidebar-foreground truncate">John Doe</div>
                  <div className="text-[11px] capitalize truncate text-sidebar-foreground/50">{role.replace(/_/g, " ")}</div>
                </div>
                <button className="p-1.5 rounded-md text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors">
                  <LogOut size={14} />
                </button>
              </>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className={`flex-1 flex flex-col min-w-0 h-screen overflow-hidden transition-[padding] duration-300 ease-[cubic-bezier(.16,1,.3,1)] ${collapsed ? "md:pl-3" : ""}`}>
        {/* Header — docked when sidebar expanded; floating pill when collapsed (desktop only) */}
        <header
          className={`relative h-16 flex-shrink-0 flex items-center justify-between z-10 gap-2
            bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/70
            transition-[margin,border-radius,box-shadow,padding] duration-300 ease-[cubic-bezier(.16,1,.3,1)]
            px-4 sm:px-6 border-b border-border
            ${collapsed ? "md:mx-3 md:mt-3 md:px-5 md:rounded-2xl md:border md:border-border md:shadow-xl md:border-b-0" : ""}`}
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {/* Mobile hamburger */}
            <button
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
              className="md:hidden w-9 h-9 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex-shrink-0"
            >
              <Menu size={18} />
            </button>
            <div key={pageTitle} className="flex items-center gap-3 min-w-0 ph-rise">
              <h1 className="text-[17px] sm:text-[20px] font-bold tracking-tight truncate text-gradient-primary">{pageTitle}</h1>
              <span className="hidden md:inline-flex items-center gap-1.5 text-[10px] font-mono tracking-wider uppercase text-muted-foreground px-2 py-0.5 rounded border border-border/60">
                <span className="w-1.5 h-1.5 rounded-full bg-success pulse-ring" />
                Live
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1 sm:gap-1.5 flex-shrink-0">
            <button className="group hidden lg:flex items-center gap-2 px-3 h-9 rounded-md text-sm font-medium bg-muted/70 text-muted-foreground border border-border hover:text-foreground hover:border-foreground/30 hover:bg-muted transition-all duration-200 min-w-[220px]">
              <Search size={14} className="transition-transform duration-200 group-hover:scale-110" />
              <span className="text-xs">Search portfolios, projects…</span>
              <kbd className="ml-auto text-[10px] px-1.5 py-0.5 rounded border border-border bg-background font-mono text-muted-foreground">⌘K</kbd>
            </button>
            <button className="lg:hidden w-9 h-9 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors" aria-label="Search">
              <Search size={16} />
            </button>
            <ThemeToggle />
            <NotificationBell />
            <Link href="/admin/scoring">
              <button className="hidden sm:flex w-9 h-9 rounded-md items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors duration-200" title="Scoring Configuration">
                <Settings size={16} />
              </button>
            </Link>
          </div>
          {/* Bottom hairline glow — only on docked header */}
          {!effectiveCollapsed && (
            <span aria-hidden className="pointer-events-none absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
          )}
        </header>

        {/* Page Content */}
        <div className="relative flex-1 overflow-y-auto scrollbar-thin bg-background">
          <div className="page-ambient" />
          <div key={location} className="relative max-w-[1600px] mx-auto p-4 sm:p-6 lg:p-8 ph-rise">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
