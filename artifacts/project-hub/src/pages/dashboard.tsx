import { lazy, Suspense } from "react";
import { useUserStore } from "../lib/store";
import { MyWorkBoard } from "../components/monday/MyWorkBoard";

// Lazy-load every role dashboard so only the one the user actually needs
// hits the network. Previously all 5 ended up in the initial bundle even
// though each user renders exactly one — roughly 2,200 lines of inert JS.
const ExecutiveDashboard = lazy(() => import("./dashboards/ExecutiveDashboard"));
const PortfolioDashboard = lazy(() => import("./dashboards/PortfolioDashboard"));
const PMDashboard = lazy(() => import("./dashboards/PMDashboard"));
const FunctionalHeadDashboard = lazy(() => import("./dashboards/FunctionalHeadDashboard"));
const GeneralDashboard = lazy(() => import("./dashboards/GeneralDashboard"));

function DashboardFallback() {
  return (
    <div className="flex items-center justify-center min-h-[40vh]">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
    </div>
  );
}

export default function Dashboard() {
  const { role } = useUserStore();

  let Body;
  if (role === "executive_director" || role === "chairman" || role === "cfo") {
    Body = ExecutiveDashboard;
  } else if (role === "pmo" || role === "scm") {
    Body = PortfolioDashboard;
  } else if (role === "pm") {
    Body = PMDashboard;
  } else if (role === "hod" || role === "finance") {
    Body = FunctionalHeadDashboard;
  } else {
    Body = GeneralDashboard;
  }

  return (
    <div className="space-y-6">
      {/* Role preview now lives in the top-bar "View as" switcher (Layout). */}
      {/* Monday-style personal work board — sits above the role dashboard,
          which is kept intact as the analytics layer. Renders nothing when
          the user has no assigned work. */}
      <MyWorkBoard />
      <Suspense fallback={<DashboardFallback />}>
        <Body />
      </Suspense>
    </div>
  );
}
