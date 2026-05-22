import { Link, useLocation } from "wouter";
import { useUserStore } from "../lib/store";
import { useTheme } from "../lib/use-theme";
import {
  BarChart3,
  Briefcase,
  CheckSquare,
  FileText,
  LayoutDashboard,
  LogOut,
  Settings,
  ChevronDown,
  Search,
  FolderOpen,
  PieChart,
  Moon,
  Sun,
  Command,
} from "lucide-react";
import { useState } from "react";
import { NotificationBell } from "./notification-bell";

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
  { href: "/charters", label: "Charters", icon: FileText },
  { href: "/approvals", label: "Approvals", icon: CheckSquare },
  { href: "/projects", label: "Projects", icon: BarChart3 },
];

const PORTFOLIO_NAV: NavItem[] = [
  { href: "/portfolio", label: "Portfolio View", icon: FolderOpen },
  { href: "/documents", label: "Documents", icon: FileText },
];

const ADMIN_NAV: NavItem[] = [
  { href: "/admin/scoring", label: "Scoring Config", icon: PieChart },
];

const ADMIN_ROLES = ["pmo", "executive_director", "chairman"];

function NavSection({ label, items, location }: { label: string; items: NavItem[]; location: string }) {
  return (
    <div>
      <div className="mt-5 mb-2 px-3">
        <span className="text-[10px] font-semibold tracking-[0.18em] uppercase text-sidebar-foreground/40">
          {label}
        </span>
      </div>
      <div className="space-y-0.5">
        {items.map((item) => {
          const isActive = item.href === "/" ? location === "/" : location.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href}>
              <div
                className={`group relative flex items-center gap-3 px-3 py-2 mx-1.5 rounded-md cursor-pointer transition-all text-[13px] font-medium ${
                  isActive
                    ? "bg-sidebar-accent text-sidebar-foreground"
                    : "text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                }`}
              >
                {isActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[2px] rounded-r bg-sidebar-primary" />
                )}
                <Icon size={16} className={isActive ? "text-sidebar-primary" : ""} />
                <span className="truncate">{item.label}</span>
                {isActive && <span className="ml-auto w-1 h-1 rounded-full bg-sidebar-primary" />}
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
      {/* Sidebar — premium atelier-dark in both modes */}
      <aside className="w-60 flex-shrink-0 flex flex-col sidebar-glossy bg-sidebar text-sidebar-foreground border-r border-sidebar-border relative">
        {/* Subtle inner glow */}
        <div className="pointer-events-none absolute inset-0 ambient-mesh-soft opacity-40" />

        {/* Logo */}
        <div className="relative h-16 flex items-center gap-3 px-5 border-b border-sidebar-border">
          <div className="w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 bg-sidebar-primary text-sidebar-primary-foreground shadow-sm">
            <Command size={15} strokeWidth={2.4} />
          </div>
          <div className="leading-tight">
            <div className="font-semibold text-[15px] tracking-tight text-sidebar-foreground">Project Hub</div>
            <div className="text-[10px] tracking-[0.16em] uppercase text-sidebar-foreground/40">Enterprise PMO</div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="relative flex-1 py-2 overflow-y-auto scrollbar-thin">
          <NavSection label="Navigation" items={MAIN_NAV} location={location} />
          <NavSection label="Portfolio" items={PORTFOLIO_NAV} location={location} />
          {isAdmin && <NavSection label="Admin" items={ADMIN_NAV} location={location} />}
        </nav>

        {/* Role Switcher + User */}
        <div className="relative p-3 border-t border-sidebar-border space-y-3">
          <div className="relative">
            <div className="mb-1.5 px-1">
              <span className="text-[10px] font-semibold tracking-[0.18em] uppercase text-sidebar-foreground/40">
                Simulate Role
              </span>
            </div>
            <button
              onClick={() => setShowRoleMenu(!showRoleMenu)}
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-sm bg-sidebar-accent/60 text-sidebar-foreground border border-sidebar-border hover:bg-sidebar-accent transition-colors"
            >
              <div className="w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold flex-shrink-0 bg-sidebar-primary text-sidebar-primary-foreground">
                {currentRole.initials}
              </div>
              <span className="flex-1 text-left text-xs font-medium truncate">{currentRole.label}</span>
              <ChevronDown size={12} className={`transition-transform ${showRoleMenu ? "rotate-180" : ""}`} />
            </button>

            {showRoleMenu && (
              <div className="absolute bottom-full left-0 right-0 mb-1 rounded-md py-1 z-50 bg-popover text-popover-foreground border border-popover-border shadow-lg max-h-[280px] overflow-y-auto scrollbar-thin">
                {ROLES.map(r => (
                  <button
                    key={r.value}
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
          <div className="flex items-center gap-3 px-1">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-sm">
              JD
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-sidebar-foreground truncate">John Doe</div>
              <div className="text-[11px] capitalize truncate text-sidebar-foreground/50">{role.replace(/_/g, " ")}</div>
            </div>
            <button className="p-1.5 rounded-md text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors">
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {/* Header */}
        <header className="h-16 flex-shrink-0 flex items-center justify-between px-6 z-10 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/70 border-b border-border">
          <div className="flex items-center gap-3 min-w-0">
            <h1 className="text-[20px] font-bold text-foreground tracking-tight truncate">{pageTitle}</h1>
            <span className="hidden md:inline-flex items-center gap-1.5 text-[10px] font-mono tracking-wider uppercase text-muted-foreground px-2 py-0.5 rounded border border-border/60">
              <span className="w-1.5 h-1.5 rounded-full bg-success pulse-ring" />
              Live
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button className="hidden sm:flex items-center gap-2 px-3 h-9 rounded-md text-sm font-medium bg-muted text-muted-foreground border border-border hover:text-foreground transition-colors min-w-[220px]">
              <Search size={14} />
              <span className="text-xs">Search portfolios, projects…</span>
              <kbd className="ml-auto text-[10px] px-1.5 py-0.5 rounded border border-border bg-background font-mono text-muted-foreground">⌘K</kbd>
            </button>
            <ThemeToggle />
            <NotificationBell />
            <Link href="/admin/scoring">
              <button className="w-9 h-9 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors" title="Scoring Configuration">
                <Settings size={16} />
              </button>
            </Link>
          </div>
        </header>

        {/* Page Content */}
        <div className="relative flex-1 overflow-y-auto scrollbar-thin bg-background">
          <div className="page-ambient" />
          <div className="relative max-w-[1600px] mx-auto p-6 lg:p-8">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
