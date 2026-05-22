import { Link, useLocation } from "wouter";
import { useUserStore } from "../lib/store";
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

type NavItem = { href: string; label: string; icon: React.ComponentType<{ size?: number }> };

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
    <>
      <div className="mt-4 mb-2 px-2">
        <span className="text-xs font-semibold tracking-widest uppercase" style={{ color: "rgba(148,163,184,0.5)" }}>
          {label}
        </span>
      </div>
      {items.map((item) => {
        const isActive = item.href === "/" ? location === "/" : location.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link key={item.href} href={item.href}>
            <div
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all text-sm font-medium group"
              style={{
                background: isActive ? "rgba(99,102,241,0.25)" : "transparent",
                color: isActive ? "#A5B4FC" : "rgba(148,163,184,0.75)",
                borderLeft: isActive ? "3px solid #6366F1" : "3px solid transparent",
              }}
              onMouseEnter={e => {
                if (!isActive) {
                  (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.05)";
                  (e.currentTarget as HTMLElement).style.color = "#E2E8F0";
                }
              }}
              onMouseLeave={e => {
                if (!isActive) {
                  (e.currentTarget as HTMLElement).style.background = "transparent";
                  (e.currentTarget as HTMLElement).style.color = "rgba(148,163,184,0.75)";
                }
              }}
            >
              <Icon size={17} />
              <span>{item.label}</span>
              {isActive && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-indigo-400" />}
            </div>
          </Link>
        );
      })}
    </>
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
    <div className="flex h-screen w-full overflow-hidden" style={{ background: "#F1F5F9" }}>
      {/* Sidebar */}
      <aside
        className="w-64 flex-shrink-0 flex flex-col"
        style={{
          background: "linear-gradient(180deg, #0F172A 0%, #1E293B 100%)",
          boxShadow: "4px 0 24px rgba(0,0,0,0.15)",
        }}
      >
        {/* Logo */}
        <div className="h-16 flex items-center gap-3 px-5 border-b" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)" }}>
            <Briefcase size={16} className="text-white" />
          </div>
          <div>
            <div className="text-white font-bold text-sm tracking-tight">ProjectHub</div>
            <div className="text-xs" style={{ color: "rgba(148,163,184,0.8)" }}>Enterprise PMO</div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-4 px-3 overflow-y-auto scrollbar-thin">
          <NavSection label="Navigation" items={MAIN_NAV} location={location} />
          <NavSection label="Portfolio" items={PORTFOLIO_NAV} location={location} />
          {isAdmin && <NavSection label="Admin" items={ADMIN_NAV} location={location} />}
        </nav>

        {/* Role Switcher + User */}
        <div className="p-4 border-t space-y-3" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
          {/* Role Switcher */}
          <div className="relative">
            <div className="mb-1.5">
              <span className="text-xs font-semibold tracking-widest uppercase" style={{ color: "rgba(148,163,184,0.5)" }}>
                Simulate Role
              </span>
            </div>
            <button
              onClick={() => setShowRoleMenu(!showRoleMenu)}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all"
              style={{ background: "rgba(255,255,255,0.06)", color: "#E2E8F0", border: "1px solid rgba(255,255,255,0.1)" }}
            >
              <div className="w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold flex-shrink-0" style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)", color: "white" }}>
                {currentRole.initials}
              </div>
              <span className="flex-1 text-left text-xs font-medium">{currentRole.label}</span>
              <ChevronDown size={13} className={`transition-transform ${showRoleMenu ? "rotate-180" : ""}`} />
            </button>

            {showRoleMenu && (
              <div
                className="absolute bottom-full left-0 right-0 mb-1 rounded-lg py-1 z-50"
                style={{ background: "#1E293B", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 -8px 30px rgba(0,0,0,0.3)", maxHeight: "280px", overflowY: "auto" }}
              >
                {ROLES.map(r => (
                  <button
                    key={r.value}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left transition-colors"
                    style={{ color: r.value === role ? "#A5B4FC" : "rgba(148,163,184,0.8)", background: r.value === role ? "rgba(99,102,241,0.15)" : "transparent" }}
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
                    onMouseEnter={e => { if (r.value !== role) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.05)"; }}
                    onMouseLeave={e => { if (r.value !== role) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                  >
                    <div className="w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold flex-shrink-0" style={{ background: r.value === role ? "rgba(99,102,241,0.5)" : "rgba(255,255,255,0.1)", color: "white" }}>
                      {r.initials}
                    </div>
                    {r.label}
                    {r.value === role && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-indigo-400" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* User Info */}
          <div className="flex items-center gap-3 px-1">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0" style={{ background: "linear-gradient(135deg, #10B981, #059669)", color: "white" }}>
              JD
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-white truncate">John Doe</div>
              <div className="text-xs capitalize truncate" style={{ color: "rgba(148,163,184,0.6)" }}>{role.replace(/_/g, " ")}</div>
            </div>
            <button className="p-1.5 rounded-lg transition-colors" style={{ color: "rgba(148,163,184,0.5)" }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "#94A3B8"}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "rgba(148,163,184,0.5)"}
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {/* Header */}
        <header className="h-16 flex-shrink-0 flex items-center justify-between px-6 z-10" style={{ background: "white", borderBottom: "1px solid #E2E8F0", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
          <div className="flex items-center gap-4">
            <div>
              <h1 className="font-bold text-gray-900 text-lg">{pageTitle}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all" style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", color: "#64748B" }}>
              <Search size={14} />
              <span className="hidden sm:inline">Search...</span>
              <kbd className="hidden sm:inline text-xs px-1.5 py-0.5 rounded" style={{ background: "#E2E8F0", fontFamily: "monospace" }}>⌘K</kbd>
            </button>
            <NotificationBell />
            <Link href="/admin/scoring">
              <button className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors" style={{ color: "#64748B" }} title="Scoring Configuration">
                <Settings size={17} />
              </button>
            </Link>
          </div>
        </header>

        {/* Page Content */}
        <div className="flex-1 overflow-y-auto scrollbar-thin" style={{ background: "#F1F5F9" }}>
          <div className="max-w-7xl mx-auto p-6">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
