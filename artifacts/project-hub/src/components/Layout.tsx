import { Link, useLocation } from "wouter";
import { useUserStore } from "../lib/store";
import { useTheme } from "../lib/use-theme";
import { useAuth } from "../auth/context";

function getInitials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return ((parts[0]![0] ?? "") + (parts[parts.length - 1]![0] ?? "")).toUpperCase();
}
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
  Library,
  ClipboardList,
  Sparkles as SparklesIcon,
  Moon,
  Sun,
  Command,
  Menu,
  X,
  Plug,
  Building2,
  ScrollText,
  ShoppingCart,
  Timer,
  Users,
  BellRing,
  ListChecks,
  UserCheck,
  Activity,
  Zap,
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { NotificationBell } from "./notification-bell";
import { ConnectorsPopup } from "./ConnectorsPopup";

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

type NavLeaf = { href: string; label: string; icon: React.ComponentType<{ size?: number; className?: string }> };
type NavGroup = { label: string; icon: React.ComponentType<{ size?: number; className?: string }>; children: NavLeaf[]; color?: string };
type NavNode = NavLeaf | NavGroup;

function isGroup(n: NavNode): n is NavGroup {
  return (n as NavGroup).children !== undefined;
}

// Primary navigation — collapsed from 9 flat items to 5 destinations.
// The pre-execution funnel (Requests · Demands · Charters · Overview) now
// lives under one "Pipeline" parent; Vendors + Sourcing(RFx) are siblings
// under "Procurement"; Portfolio + Tree nest under "Projects". Every child
// points at an existing route — no page, route, or API changed. Labels are
// plain-English (PIFs → Requests, RFx → Sourcing); routes keep their old
// paths so bookmarks and the API surface are untouched.
const PRIMARY_NAV: NavNode[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  {
    label: "Pipeline",
    icon: Workflow,
    color: "#6366F1",
    children: [
      { href: "/pifs", label: "Requests", icon: ClipboardList },
      { href: "/demands", label: "Demands", icon: Inbox },
      { href: "/charters", label: "Charters", icon: FileText },
      { href: "/pipeline", label: "Overview", icon: Workflow },
    ],
  },
  {
    label: "Projects",
    icon: BarChart3,
    color: "#0EA5E9",
    children: [
      { href: "/projects", label: "Active", icon: BarChart3 },
      { href: "/portfolio", label: "Portfolio", icon: FolderOpen },
      { href: "/projects/tree", label: "Tree", icon: FolderOpen },
    ],
  },
  {
    label: "Work",
    icon: Briefcase,
    color: "#10B981",
    children: [
      { href: "/my-tasks", label: "My Tasks", icon: UserCheck },
      { href: "/tasks", label: "Work Breakdown", icon: ListChecks },
    ],
  },
  {
    label: "Procurement",
    icon: ShoppingCart,
    color: "#F59E0B",
    children: [
      { href: "/vendors", label: "Vendors", icon: Building2 },
      { href: "/rfx", label: "Sourcing", icon: ScrollText },
    ],
  },
  { href: "/approvals", label: "Approvals", icon: CheckSquare },
];

const WORKSPACE_NAV: NavLeaf[] = [
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/automations", label: "Automations", icon: Zap },
  { href: "/documents", label: "Documents", icon: FileText },
  { href: "/templates", label: "Templates", icon: Library },
  { href: "/lessons-learned", label: "Lessons Learned", icon: BookOpen },
  { href: "/nudges", label: "Nudges", icon: SparklesIcon },
  // Connectors stays reachable here; page-level role gate still applies for
  // who can actually create/edit (see admin-integrations.tsx).
  { href: "/admin/integrations", label: "Connectors", icon: Plug },
];

const ADMIN_NAV: NavLeaf[] = [
  { href: "/admin/scoring", label: "Scoring Config", icon: PieChart },
  { href: "/admin/stage-slas", label: "Stage SLAs", icon: Timer },
  { href: "/admin/role-directory", label: "Role Directory", icon: Users },
  { href: "/admin/stage-escalation", label: "Escalation Ladders", icon: BellRing },
];

// Presentation-layer titles for the top header — keeps the plain-English
// labels (Requests, Sourcing) consistent without touching any route.
const PAGE_TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/pipeline": "Pipeline",
  "/demands": "Demands",
  "/pifs": "Requests",
  "/charters": "Charters",
  "/projects": "Projects",
  "/projects/tree": "Project Tree",
  "/portfolio": "Portfolio View",
  "/vendors": "Vendors",
  "/rfx": "Sourcing",
  "/approvals": "Approvals",
  "/my-tasks": "My Tasks",
  "/tasks": "Work Breakdown",
  "/activity": "Activity",
  "/automations": "Automations",
  "/documents": "Documents",
  "/lessons-learned": "Lessons Learned",
  "/templates": "Templates",
  "/nudges": "Nudges",
  "/admin/scoring": "Scoring Configuration",
  "/admin/stage-slas": "Stage SLA Configuration",
  "/admin/role-directory": "Role Directory",
  "/admin/stage-escalation": "Escalation Ladders",
  "/admin/integrations": "MCP Integrations",
};

function leafActive(href: string, location: string): boolean {
  if (href === "/") return location === "/";
  return location === href || location.startsWith(href + "/");
}

// Within a group, only the most specific matching child is "active" so that
// /projects/tree highlights Tree, not Active (/projects is a prefix of both).
function activeChildHref(group: NavGroup, location: string): string | null {
  let best: string | null = null;
  for (const c of group.children) {
    if (leafActive(c.href, location) && (!best || c.href.length > best.length)) {
      best = c.href;
    }
  }
  return best;
}

const ADMIN_ROLES = ["pmo", "executive_director", "chairman"];

function NavSection({ label, items, location, collapsed }: { label: string; items: NavLeaf[]; location: string; collapsed: boolean }) {
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

// A single nav pill (leaf). Used for top-level leaves and, indented, for the
// children rendered inside an expanded group.
function LinkPill({ href, label, Icon, isActive, collapsed, indented }: {
  href: string;
  label: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  isActive: boolean;
  collapsed: boolean;
  indented?: boolean;
}) {
  return (
    <Link href={href} aria-label={collapsed ? label : undefined} aria-current={isActive ? "page" : undefined}>
      <div
        data-active={isActive}
        title={collapsed ? label : undefined}
        className={`nav-pill group relative flex items-center cursor-pointer text-[13px] font-medium ${
          collapsed
            ? "justify-center w-10 h-10 mx-auto rounded-lg"
            : `gap-3 ${indented ? "pl-9 pr-3" : "px-3"} py-2 mx-1.5 rounded-md`
        } ${
          isActive
            ? "bg-sidebar-accent text-sidebar-foreground"
            : "text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
        }`}
      >
        <Icon
          size={collapsed ? 17 : indented ? 15 : 16}
          className={`transition-all duration-300 ${
            isActive
              ? "text-sidebar-primary scale-110"
              : !collapsed ? "group-hover:text-sidebar-foreground group-hover:translate-x-0.5" : "group-hover:text-sidebar-foreground"
          }`}
        />
        {!collapsed && (
          <span className="truncate transition-transform duration-300 group-hover:translate-x-0.5">{label}</span>
        )}
        {!collapsed && isActive && (
          <span className="ml-auto w-1.5 h-1.5 rounded-full bg-sidebar-primary shadow-[0_0_8px_hsl(var(--sidebar-primary))]" />
        )}
      </div>
    </Link>
  );
}

// A collapsible parent with child subtabs. Expanded: header row + indented
// children. Collapsed (icon rail): parent icon with a hover flyout of children.
function NavGroupItem({ group, location, collapsed, open, onToggle }: {
  group: NavGroup;
  location: string;
  collapsed: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const activeHref = activeChildHref(group, location);
  const groupActive = activeHref !== null;
  const Icon = group.icon;

  if (collapsed) {
    return (
      <div className="relative group/navgrp flex justify-center">
        <button
          type="button"
          title={group.label}
          aria-label={group.label}
          data-active={groupActive}
          className={`nav-pill flex items-center justify-center w-10 h-10 mx-auto rounded-lg cursor-pointer ${
            groupActive
              ? "bg-sidebar-accent text-sidebar-foreground"
              : "text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
          }`}
        >
          <Icon size={17} className={groupActive ? "text-sidebar-primary scale-110" : ""} />
        </button>
        {/* Hover flyout — the only way to reach subtabs while the rail is collapsed. */}
        <div className="invisible opacity-0 translate-x-1 group-hover/navgrp:visible group-hover/navgrp:opacity-100 group-hover/navgrp:translate-x-0 transition-all duration-150 absolute left-full top-0 ml-2 z-50 w-52 rounded-md py-1 bg-popover text-popover-foreground border border-popover-border shadow-lg">
          <div className="px-3 py-1.5 text-[10px] font-semibold tracking-[0.18em] uppercase text-muted-foreground">{group.label}</div>
          {group.children.map((c) => {
            const Ci = c.icon;
            const active = c.href === activeHref;
            return (
              <Link key={c.href} href={c.href}>
                <div className={`flex items-center gap-2.5 px-3 py-2 text-xs cursor-pointer transition-colors ${
                  active ? "bg-accent text-primary" : "hover:bg-accent/60"
                }`}>
                  <Ci size={14} />
                  <span className="truncate">{c.label}</span>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        data-active={groupActive}
        className={`nav-pill group w-[calc(100%-12px)] flex items-center gap-3 px-3 py-2 mx-1.5 rounded-md cursor-pointer text-[13px] font-medium ${
          groupActive
            ? "text-sidebar-foreground"
            : "text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
        }`}
      >
        {group.color && (
          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: group.color, boxShadow: groupActive ? `0 0 6px ${group.color}` : "none" }} />
        )}
        <Icon size={16} className={`transition-all duration-300 ${groupActive ? "text-sidebar-primary" : "group-hover:text-sidebar-foreground group-hover:translate-x-0.5"}`} />
        <span className="truncate transition-transform duration-300 group-hover:translate-x-0.5">{group.label}</span>
        <ChevronDown size={13} className={`ml-auto transition-transform duration-200 ${open ? "" : "-rotate-90"} ${groupActive ? "text-sidebar-primary/70" : "text-sidebar-foreground/40"}`} />
      </button>
      {open && (
        <div className="mt-0.5 space-y-0.5">
          {group.children.map((c) => (
            <LinkPill
              key={c.href}
              href={c.href}
              label={c.label}
              Icon={c.icon}
              isActive={c.href === activeHref}
              collapsed={false}
              indented
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Primary navigation block — mixes top-level leaves with collapsible groups.
function PrimaryNav({ nodes, location, collapsed, openGroups, toggleGroup }: {
  nodes: NavNode[];
  location: string;
  collapsed: boolean;
  openGroups: Record<string, boolean>;
  toggleGroup: (label: string, active: boolean) => void;
}) {
  return (
    <div>
      <div className={`mt-5 mb-2 ${collapsed ? "px-0 flex justify-center" : "px-3"}`}>
        {collapsed ? (
          <span className="block h-px w-6 bg-sidebar-foreground/15" />
        ) : (
          <span className="text-[10px] font-semibold tracking-[0.18em] uppercase text-sidebar-foreground/40">Navigation</span>
        )}
      </div>
      <div className="space-y-0.5">
        {nodes.map((n) => {
          if (!isGroup(n)) {
            return (
              <LinkPill
                key={n.href}
                href={n.href}
                label={n.label}
                Icon={n.icon}
                isActive={leafActive(n.href, location)}
                collapsed={collapsed}
              />
            );
          }
          const active = activeChildHref(n, location) !== null;
          const open = openGroups[n.label] ?? active;
          return (
            <NavGroupItem
              key={n.label}
              group={n}
              location={location}
              collapsed={collapsed}
              open={open}
              onToggle={() => toggleGroup(n.label, active)}
            />
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
  const { profile, signOut } = useAuth();
  const displayName = profile?.full_name || profile?.email || "Signed in";
  const initials = getInitials(profile?.full_name ?? profile?.email ?? null);
  const [showRoleMenu, setShowRoleMenu] = useState(false);
  const roleMenuRef = useRef<HTMLDivElement | null>(null);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [connectorsOpen, setConnectorsOpen] = useState(false);
  // Manual open/close overrides for nav groups. When a group has no entry
  // here it defaults to open iff one of its children is the active route, so
  // navigating into a section auto-reveals it; users can still collapse it.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const toggleGroup = (label: string, active: boolean) =>
    setOpenGroups((s) => ({ ...s, [label]: !(s[label] ?? active) }));
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
    if (PAGE_TITLES[location]) return PAGE_TITLES[location];
    const segment = location.split("/")[1];
    if (!segment) return "Dashboard";
    const bySegment = PAGE_TITLES["/" + segment];
    return bySegment || segment.charAt(0).toUpperCase() + segment.slice(1);
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
          <PrimaryNav nodes={PRIMARY_NAV} location={location} collapsed={effectiveCollapsed} openGroups={openGroups} toggleGroup={toggleGroup} />
          <NavSection label="Workspace" items={WORKSPACE_NAV} location={location} collapsed={effectiveCollapsed} />
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
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-sm" title={effectiveCollapsed ? displayName : undefined}>
              {initials}
            </div>
            {!effectiveCollapsed && (
              <>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-sidebar-foreground truncate">{displayName}</div>
                  <div className="text-[11px] capitalize truncate text-sidebar-foreground/50">{role.replace(/_/g, " ")}</div>
                </div>
                <button
                  onClick={() => { void signOut(); }}
                  title="Sign out"
                  className="p-1.5 rounded-md text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
                >
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

      {/* Connectors & data-sources popup — globally available to admins,
          additive (does not modify any existing page or route). */}
      <ConnectorsPopup open={connectorsOpen} onClose={() => setConnectorsOpen(false)} />
    </div>
  );
}
