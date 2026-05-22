import { useUserStore } from "../lib/store";
import ExecutiveDashboard from "./dashboards/ExecutiveDashboard";
import PortfolioDashboard from "./dashboards/PortfolioDashboard";
import PMDashboard from "./dashboards/PMDashboard";
import FunctionalHeadDashboard from "./dashboards/FunctionalHeadDashboard";
import GeneralDashboard from "./dashboards/GeneralDashboard";

export default function Dashboard() {
  const { role } = useUserStore();

  if (role === "executive_director" || role === "chairman" || role === "cfo") {
    return <ExecutiveDashboard />;
  }

  if (role === "pmo" || role === "scm") {
    return <PortfolioDashboard />;
  }

  if (role === "pm") {
    return <PMDashboard />;
  }

  if (role === "hod" || role === "finance") {
    return <FunctionalHeadDashboard />;
  }

  return <GeneralDashboard />;
}
