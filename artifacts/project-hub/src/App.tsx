import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "./components/Layout";
import { AuthConsumer } from "./auth/AuthConsumer";
import { SessionExpiredModal } from "./components/SessionExpiredModal";
import Dashboard from "./pages/dashboard";
import ChartersList from "./pages/charters";
import NewCharter from "./pages/charter-new";
import NewDemand from "./pages/demand-new";
import DemandsList from "./pages/demands";
import PipelinePage from "./pages/pipeline";
import CharterDetail from "./pages/charter-detail";
import ApprovalsList from "./pages/approvals";
import ProjectsList from "./pages/projects";
import ProjectDetail from "./pages/project-detail";
import NewTask from "./pages/task-new";
import PortfolioView from "./pages/portfolio";
import ProjectsTreeView from "./pages/projects-tree";
import MyTasksPage from "./pages/my-tasks";
import TasksPage from "./pages/tasks";
import AdminScoring from "./pages/admin-scoring";
import AdminStageSlas from "./pages/admin-stage-slas";
import AdminRoleDirectory from "./pages/admin-role-directory";
import AdminStageEscalation from "./pages/admin-stage-escalation";
import DocumentsPage from "./pages/documents";
import LessonsLearnedPage from "./pages/lessons-learned";
import TemplatesPage from "./pages/templates";
import PifsList from "./pages/pifs";
import PifNew from "./pages/pif-new";
import PifDetail from "./pages/pif-detail";
import NudgesPage from "./pages/nudges";
import AdminIntegrationsPage from "./pages/admin-integrations";
import VendorsPage from "./pages/vendors";
import VendorNewPage from "./pages/vendor-new";
import VendorDetailPage from "./pages/vendor-detail";
import VendorScorecardsPage from "./pages/vendor-scorecards";
import RfxListPage from "./pages/rfx-list";
import RfxNewPage from "./pages/rfx-new";
import RfxDetailPage from "./pages/rfx-detail";
import NotFound from "@/pages/not-found";

// React Query defaults tuned for Project Hub:
//   - staleTime 30s: a fresh GET stays usable for 30 seconds, so every
//     component re-mount within that window reads from cache instead of
//     hammering the API. The dashboard renders many independent hooks
//     against the same endpoints (summary, projects) — without this, every
//     mount fires a fresh request.
//   - refetchOnWindowFocus disabled: tabbing back to a dashboard tab no
//     longer triggers a full N+1 refetch burst.
//   - retry 1: don't pile on a failing endpoint with 3+ retries.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/charters" component={ChartersList} />
        <Route path="/charters/new" component={NewCharter} />
        <Route path="/demands/new" component={NewDemand} />
        <Route path="/demands" component={DemandsList} />
        <Route path="/pipeline" component={PipelinePage} />
        <Route path="/charters/:id" component={CharterDetail} />
        <Route path="/approvals" component={ApprovalsList} />
        <Route path="/projects" component={ProjectsList} />
        <Route path="/projects/tree" component={ProjectsTreeView} />
        <Route path="/projects/:id/tasks/new" component={NewTask} />
        <Route path="/projects/:id" component={ProjectDetail} />
        <Route path="/portfolio" component={PortfolioView} />
        <Route path="/my-tasks" component={MyTasksPage} />
        <Route path="/tasks" component={TasksPage} />
        <Route path="/admin/scoring" component={AdminScoring} />
        <Route path="/admin/stage-slas" component={AdminStageSlas} />
        <Route path="/admin/role-directory" component={AdminRoleDirectory} />
        <Route path="/admin/stage-escalation" component={AdminStageEscalation} />
        <Route path="/admin/integrations" component={AdminIntegrationsPage} />
        <Route path="/documents" component={DocumentsPage} />
        <Route path="/lessons-learned" component={LessonsLearnedPage} />
        <Route path="/templates" component={TemplatesPage} />
        <Route path="/pifs/new" component={PifNew} />
        <Route path="/pifs/:id" component={PifDetail} />
        <Route path="/pifs" component={PifsList} />
        <Route path="/nudges" component={NudgesPage} />
        <Route path="/vendors/new" component={VendorNewPage} />
        <Route path="/vendors/scorecards" component={VendorScorecardsPage} />
        <Route path="/vendors/:id" component={VendorDetailPage} />
        <Route path="/vendors" component={VendorsPage} />
        <Route path="/rfx/new" component={RfxNewPage} />
        <Route path="/rfx/:id" component={RfxDetailPage} />
        <Route path="/rfx" component={RfxListPage} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthConsumer>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
          <SessionExpiredModal />
        </TooltipProvider>
      </AuthConsumer>
    </QueryClientProvider>
  );
}

export default App;
