import { useCallback, useEffect, useRef, useState, type ComponentProps } from "react";
import { useLocation } from "wouter";
import { CollapsibleSidebar } from "@granules/shared/components/CollapsibleSidebar";
import {
  FolderOpen,
  BarChart3,
  FileText,
  ShoppingCart,
  CheckSquare,
  UserCheck,
  ScrollText,
  Building2,
  Activity,
  Zap,
  BookOpen,
  Sparkles,
  Plug,
  PieChart,
  Timer,
  Users,
  BellRing,
  ShieldCheck,
  LayoutGrid,
  Wrench,
  FlaskConical,
} from "lucide-react";

const SIDEBAR_COLLAPSED_KEY = "ph:sidebar:collapsed";

// Sentinel href: clicking "Charter + e-NFA" opens the workflow chooser popup
// (same as the old "Business Case" CTA) rather than navigating to a route. The
// shared sidebar treats it as a normal item and routes it through `navigate`,
// where we intercept the sentinel. It never matches a real path, so the default
// active-state logic correctly leaves it unhighlighted.
const CHARTER_NFA_HREF = "#charter-nfa";

// Type the nav data against THIS app's lucide/React copy. The shared
// CollapsibleSidebar resolves React from its own @types/react tree, so its
// `NavItem["icon"]` type and our lucide icon type are structurally identical
// but nominally distinct — bridged with a single cast at the prop boundary
// below (same workaround cxo uses).
type LucideIcon = typeof FolderOpen;
type SidebarSections = ComponentProps<typeof CollapsibleSidebar>["sections"];
type SidebarFooter = ComponentProps<typeof CollapsibleSidebar>["footer"];
type Item = { icon: LucideIcon; label: string; href: string; external?: boolean; badgeCount?: number };
type Section = { title?: string; icon?: LucideIcon; items: Item[]; collapsible?: boolean };

// Primary leaf destinations — always shown as icons, expanded or collapsed.
const PORTFOLIO: Item = { icon: FolderOpen, label: "Portfolio", href: "/portfolio" };
const PROJECTS: Item = { icon: BarChart3, label: "Projects", href: "/projects" };
const CHARTER: Item = { icon: FileText, label: "Charter + e-NFA", href: CHARTER_NFA_HREF };
const MY_TASKS: Item = { icon: UserCheck, label: "My Tasks", href: "/my-tasks" };
const APPROVALS: Item = { icon: CheckSquare, label: "Approvals", href: "/approvals" };
const VENDOR_ITEMS: Item[] = [
  { icon: ScrollText, label: "New RFP", href: "/rfx" },
  { icon: Building2, label: "Vendor on board", href: "/vendors" },
];
const WORKSPACE_ITEMS: Item[] = [
  { icon: Activity, label: "My Activities", href: "/activity" },
  { icon: Zap, label: "Automations", href: "/automations" },
  { icon: FileText, label: "Document Repository", href: "/documents" },
  { icon: BookOpen, label: "Lessons Learned", href: "/lessons-learned" },
  { icon: Sparkles, label: "Nudges", href: "/nudges" },
  { icon: Plug, label: "Connectors", href: "/admin/integrations" },
];
const ADMIN_ITEMS: Item[] = [
  { icon: PieChart, label: "Scoring Config", href: "/admin/scoring" },
  { icon: Timer, label: "Stage SLAs", href: "/admin/stage-slas" },
  { icon: Users, label: "Role Directory", href: "/admin/role-directory" },
  { icon: BellRing, label: "Escalation Ladders", href: "/admin/stage-escalation" },
  { icon: ShieldCheck, label: "DOA Matrix", href: "/admin/doa-matrix" },
];
const ROLES_ITEMS: Item[] = [
  { icon: ShieldCheck, label: "Roles & Access", href: "/admin/roles" },
  { icon: FlaskConical, label: "CIP", href: "/admin/cip" },
];

/**
 * Project Hub sidebar — the suite-shared CollapsibleSidebar (same component as
 * portal / recruit / pms / cxo), wrapped to feed it Project Hub's navigation.
 *
 * Router-agnostic mode: Project Hub runs on wouter (not react-router), so we
 * pass `currentPath` + `navigate` and the component never touches react-router.
 *
 * Collapsed rail: Work / Vendor / Workspace are collapsible dropdowns when the
 * rail is expanded. When collapsed they're hidden entirely — the narrow rail
 * shows only the primary leaf icons (Portfolio, Projects, Charter, Approvals)
 * plus a single Admin / Roles icon — so it stays clean instead of stacking
 * every grouped item's icon. We mirror the component's collapsed state locally
 * (seeded from + persisted to localStorage) to rebuild `sections` accordingly.
 */
export default function PmoSidebar({
  isAdmin,
  isSuperAdmin,
  onCharterNfa,
  mobileOpen,
  onClose,
  footer,
}: {
  isAdmin: boolean;
  isSuperAdmin: boolean;
  /** Opens the Charter/e-NFA workflow chooser popup. */
  onCharterNfa: () => void;
  mobileOpen?: boolean;
  onClose?: () => void;
  /** Rendered at the bottom of the rail (e.g. the signed-in profile block). */
  footer?: React.ReactNode;
}) {
  const [location, setLocation] = useLocation();
  const [collapsed, setCollapsed] = useState<boolean>(
    () => typeof window !== "undefined" && window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1",
  );
  // Bumped to force-remount the (uncontrolled) shared CollapsibleSidebar so it
  // re-seeds its internal collapsed state from `defaultCollapsed`.
  const [remountKey, setRemountKey] = useState(0);
  const collapsedRef = useRef(collapsed);
  useEffect(() => { collapsedRef.current = collapsed; }, [collapsed]);

  const onCollapsedChange = useCallback((next: boolean) => {
    collapsedRef.current = next;
    setCollapsed(next);
    try { window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0"); } catch {}
  }, []);

  // Clicking the "Projects" nav item auto-collapses the rail. No-op when it's
  // already collapsed (so we never remount needlessly).
  const forceCollapse = useCallback(() => {
    if (collapsedRef.current) return;
    collapsedRef.current = true;
    setCollapsed(true);
    try { window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, "1"); } catch {}
    setRemountKey((k) => k + 1);
  }, []);

  // The reduction is a DESKTOP collapsed-rail affordance only. The mobile drawer
  // always renders expanded, so when it's open we feed the full grouped nav.
  const railCollapsed = collapsed && !mobileOpen;

  let sections: Section[];
  if (railCollapsed) {
    // Collapsed rail: leaf icons + ONE representative icon per dropdown group
    // (Vendor / Workspace / Admin / Roles) — the group's own icon, no chevron.
    // Each navigates to its first destination.
    sections = [{ items: [PORTFOLIO, PROJECTS, CHARTER, MY_TASKS, APPROVALS] }];
    sections.push({ items: [
      { icon: ShoppingCart, label: "Vendor Evaluation", href: VENDOR_ITEMS[0]!.href },
      { icon: LayoutGrid, label: "Workspace", href: WORKSPACE_ITEMS[0]!.href },
    ] });
    if (isAdmin) sections.push({ items: [{ icon: Wrench, label: "Admin", href: "/admin/scoring" }] });
    if (isSuperAdmin) sections.push({ items: [
      { icon: ShieldCheck, label: "Roles & Access", href: "/admin/roles" },
      { icon: FlaskConical, label: "CIP", href: "/admin/cip" },
    ] });
  } else {
    sections = [
      { items: [PORTFOLIO, PROJECTS, CHARTER, MY_TASKS] },
      { title: "Vendor Evaluation", icon: ShoppingCart, collapsible: true, items: VENDOR_ITEMS },
      { items: [APPROVALS] },
      { title: "Workspace", icon: LayoutGrid, collapsible: true, items: WORKSPACE_ITEMS },
    ];
    if (isAdmin) sections.push({ title: "Admin", icon: Wrench, items: ADMIN_ITEMS });
    if (isSuperAdmin) sections.push({ items: ROLES_ITEMS });
  }

  return (
    <CollapsibleSidebar
      key={remountKey}
      logoSrc="/Granules-logo.png"
      iconSrc="/icon-32x32.png"
      appName="Project Hub"
      logoHref="/portfolio"
      sections={sections as unknown as SidebarSections}
      currentPath={location}
      navigate={(href) => {
        if (href === CHARTER_NFA_HREF) {
          onCharterNfa();
          return;
        }
        // Clicking "Projects" auto-collapses the rail for a wider board.
        if (href === PROJECTS.href) forceCollapse();
        setLocation(href);
      }}
      mobileOpen={mobileOpen}
      onClose={onClose}
      defaultCollapsed={collapsed}
      onCollapsedChange={onCollapsedChange}
      footer={footer as unknown as SidebarFooter}
    />
  );
}
