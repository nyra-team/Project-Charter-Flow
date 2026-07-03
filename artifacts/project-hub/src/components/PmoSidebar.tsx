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
  Network,
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
  AlertTriangle,
  Compass,
} from "lucide-react";

const SIDEBAR_COLLAPSED_KEY = "ph:sidebar:collapsed";

// Sentinel href: clicking "Charter + e-NFA" opens the workflow chooser popup
// (same as the old "Business Case" CTA) rather than navigating to a route. The
// shared sidebar treats it as a normal item and routes it through `navigate`,
// where we intercept the sentinel. It never matches a real path, so the default
// active-state logic correctly leaves it unhighlighted.
const CHARTER_NFA_HREF = "#charter-nfa";
// "Business Case" opens the two-card workflow chooser popup (intercepted in
// `navigate` below, same pattern as the sentinel above).
const BUSINESS_CASE_HREF = "#business-case";
// "Tour" launches the guided product tour. Same sentinel pattern as above: the
// shared sidebar routes it through `navigate`, where we dispatch the start
// event instead of changing route.
const TOUR_HREF = "#tour";

// Type the nav data against THIS app's lucide/React copy. The shared
// CollapsibleSidebar resolves React from its own @types/react tree, so its
// `NavItem["icon"]` type and our lucide icon type are structurally identical
// but nominally distinct — bridged with a single cast at the prop boundary
// below (same workaround cxo uses).
type LucideIcon = typeof FolderOpen;
type SidebarSections = ComponentProps<typeof CollapsibleSidebar>["sections"];
type SidebarFooter = ComponentProps<typeof CollapsibleSidebar>["footer"];
type Item = { icon: LucideIcon; label: string; href: string; external?: boolean; badgeCount?: number; className?: string };
type Section = { title?: string; icon?: LucideIcon; items: Item[]; collapsible?: boolean };

// Primary leaf destinations — always shown as icons, expanded or collapsed.
const PORTFOLIO: Item = { icon: FolderOpen, label: "Portfolio", href: "/portfolio" };
const PROJECTS: Item = { icon: BarChart3, label: "Projects", href: "/projects" };
const CHARTER: Item = { icon: FileText, label: "Charter + e-NFA", href: CHARTER_NFA_HREF };
// Same sentinel as Charter + e-NFA — opens the workflow chooser popup.
// Exact replica of the existing "Business Case" CTA (pipeline / dashboard):
// btn-glossy-cta + Sparkles, centered. `!` overrides the shared item's
// rounded-xl/px-3/py-2.5 layout (cn is a plain join, no tailwind-merge).
const BUSINESS_CASE: Item = {
  icon: Sparkles,
  label: "Business Case",
  href: BUSINESS_CASE_HREF,
  className:
    "btn-glossy-cta !w-fit !mx-auto !mb-3 !gap-2 !px-4 !py-0 !h-9 !rounded-full " +
    "!text-[13px] !font-semibold [&_svg]:!w-3.5 [&_svg]:!h-3.5",
};
const MY_TASKS: Item = { icon: UserCheck, label: "My Tasks", href: "/my-tasks" };
const MY_TEAM: Item = { icon: Network, label: "My Team Actions", href: "/my-team-actions" };
const RESOURCES: Item = { icon: Users, label: "Resource Management", href: "/resources" };
const APPROVALS: Item = { icon: CheckSquare, label: "Approvals", href: "/approvals" };
const RISKS_ISSUES: Item = { icon: AlertTriangle, label: "Risks / Issues", href: "/issues" };
const TOUR: Item = { icon: Compass, label: "Tour", href: TOUR_HREF };
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
  onBusinessCase,
  mobileOpen,
  onClose,
  footer,
}: {
  isAdmin: boolean;
  isSuperAdmin: boolean;
  /** "Charter + e-NFA" nav item handler (navigates to the charters list). */
  onCharterNfa: () => void;
  /** "Business Case" CTA handler — opens the two-card workflow chooser popup. */
  onBusinessCase: () => void;
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

  // Force the rail EXPANDED — used by the guided tour so it can anchor the
  // "Business Case" CTA, which only renders in the expanded rail (the collapsed
  // rail drops it). No-op when already expanded so we never remount needlessly.
  const forceExpand = useCallback(() => {
    if (!collapsedRef.current) return;
    collapsedRef.current = false;
    setCollapsed(false);
    try { window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, "0"); } catch {}
    setRemountKey((k) => k + 1);
  }, []);

  useEffect(() => {
    const onExpand = () => forceExpand();
    window.addEventListener("pmo:tour:expand-sidebar", onExpand);
    return () => window.removeEventListener("pmo:tour:expand-sidebar", onExpand);
  }, [forceExpand]);

  // The reduction is a DESKTOP collapsed-rail affordance only. The mobile drawer
  // always renders expanded, so when it's open we feed the full grouped nav.
  const railCollapsed = collapsed && !mobileOpen;

  let sections: Section[];
  if (railCollapsed) {
    // Collapsed rail: leaf icons + ONE representative icon per dropdown group
    // (Vendor / Workspace / Admin / Roles) — the group's own icon, no chevron.
    // Each navigates to its first destination.
    sections = [{ items: [PORTFOLIO, PROJECTS, CHARTER, MY_TASKS, MY_TEAM, APPROVALS, RISKS_ISSUES, RESOURCES] }];
    sections.push({ items: [
      { icon: ShoppingCart, label: "Vendor Evaluation", href: VENDOR_ITEMS[0]!.href },
      { icon: LayoutGrid, label: "Workspace", href: WORKSPACE_ITEMS[0]!.href },
    ] });
    if (isAdmin) sections.push({ items: [{ icon: Wrench, label: "Admin", href: "/admin/scoring" }] });
    if (isSuperAdmin) sections.push({ items: [
      { icon: ShieldCheck, label: "Roles & Access", href: "/admin/roles" },
      { icon: FlaskConical, label: "CIP", href: "/admin/cip" },
    ] });
    sections.push({ items: [TOUR] });
  } else {
    sections = [
      { items: [BUSINESS_CASE, PORTFOLIO, PROJECTS, CHARTER, MY_TASKS, MY_TEAM] },
      { title: "Vendor Evaluation", icon: ShoppingCart, collapsible: true, items: VENDOR_ITEMS },
      { items: [APPROVALS, RISKS_ISSUES, RESOURCES] },
      { title: "Workspace", icon: LayoutGrid, collapsible: true, items: WORKSPACE_ITEMS },
    ];
    if (isAdmin) sections.push({ title: "Admin", icon: Wrench, items: ADMIN_ITEMS });
    if (isSuperAdmin) sections.push({ items: ROLES_ITEMS });
    sections.push({ title: "Tour", items: [TOUR] });
  }

  // Mirror the shared sidebar's default active logic, but treat the
  // "Charter + e-NFA" sentinel as if it lived at /charters (where it navigates)
  // so it highlights on the charters routes without a real route href.
  const effHref = (href: string) => (href === CHARTER_NFA_HREF ? "/charters" : href);
  const matches = (href: string, pathname: string) => {
    const h = effHref(href);
    return pathname === h || pathname.startsWith(h + "/");
  };
  const allHrefs = sections.flatMap((s) => s.items).filter((it) => !it.external).map((it) => it.href);
  const isActive = (href: string, pathname: string) => {
    if (!matches(href, pathname)) return false;
    const bestLen = Math.max(...allHrefs.filter((h) => matches(h, pathname)).map((h) => effHref(h).length));
    return effHref(href).length === bestLen;
  };

  return (
    <CollapsibleSidebar
      key={remountKey}
      className="pmo-sidebar"
      logoSrc="/Granules-logo.png"
      iconSrc="/icon-32x32.png"
      appName="Project Hub"
      logoHref="/portfolio"
      sections={sections as unknown as SidebarSections}
      isActive={isActive}
      currentPath={location}
      navigate={(href) => {
        if (href === CHARTER_NFA_HREF) {
          onCharterNfa();
          return;
        }
        if (href === BUSINESS_CASE_HREF) {
          onBusinessCase();
          return;
        }
        if (href === TOUR_HREF) {
          window.dispatchEvent(new Event("pmo:start-tour-live"));
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
