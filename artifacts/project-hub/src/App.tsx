import { Switch, Route, Redirect, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "./components/Layout";
import { AuthConsumer } from "./auth/AuthConsumer";
import { SessionExpiredModal } from "./components/SessionExpiredModal";
import { JustificationRequiredModal } from "./components/JustificationRequiredModal";
import { AskNyra } from "./components/AskNyra";
import { TitleTooltip } from "./components/ui-kit/TitleTooltip";
import NewCharterTemplate from "./pages/charter-template-new";
import NewDemand from "./pages/demand-new";
import CharterNfaSelect from "./pages/charter-nfa-select";
import DemandsList from "./pages/demands";
import PipelinePage from "./pages/pipeline";
import CharterDetail from "./pages/charter-detail";
import ChartersList from "./pages/charters";
import ApprovalsList from "./pages/approvals";
import IssuesList from "./pages/issues";
import ProjectsList from "./pages/projects";
import ProjectDetail from "./pages/project-detail";
import NewTask from "./pages/task-new";
import PortfolioView from "./pages/portfolio";
import PortfolioOverview from "./pages/portfolio-overview";
import ProjectsTreeView from "./pages/projects-tree";
import MyTasksPage from "./pages/my-tasks";
import TasksPage from "./pages/tasks";
import AdminScoring from "./pages/admin-scoring";
import AdminStageSlas from "./pages/admin-stage-slas";
import AdminRoleDirectory from "./pages/admin-role-directory";
import AdminRoles from "./pages/admin-roles";
import AdminCip from "./pages/admin-cip";
import AdminStageEscalation from "./pages/admin-stage-escalation";
import AdminDoaMatrix from "./pages/admin-doa-matrix";
import DocumentsPage from "./pages/documents";
import LessonsLearnedPage from "./pages/lessons-learned";
import TemplatesPage from "./pages/templates";
import PifsList from "./pages/pifs";
import PifNew from "./pages/pif-new";
import PifDetail from "./pages/pif-detail";
import NfaNew from "./pages/nfa-new";
import NfaDetail from "./pages/nfa-detail";
import NfasList from "./pages/nfas";
import NudgesPage from "./pages/nudges";
import AdminIntegrationsPage from "./pages/admin-integrations";
import VendorsPage from "./pages/vendors";
import VendorNewPage from "./pages/vendor-new";
import VendorDetailPage from "./pages/vendor-detail";
import VendorScorecardsPage from "./pages/vendor-scorecards";
import RfxListPage from "./pages/rfx-list";
import RfxNewPage from "./pages/rfx-new";
import RfxDetailPage from "./pages/rfx-detail";
import AutomationsPage from "./pages/automations";
import ActivityPage from "./pages/activity";
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
        <Route path="/"><Redirect to="/portfolio" /></Route>
        <Route path="/charters/new" component={NewCharterTemplate} />
        <Route path="/charters" component={ChartersList} />
        <Route path="/charter-nfa" component={CharterNfaSelect} />
        <Route path="/demands/new" component={NewDemand} />
        <Route path="/demands" component={DemandsList} />
        <Route path="/pipeline" component={PipelinePage} />
        <Route path="/issues" component={IssuesList} />
        <Route path="/charters/:id" component={CharterDetail} />
        <Route path="/approvals" component={ApprovalsList} />
        <Route path="/projects" component={ProjectsList} />
        <Route path="/projects/tree" component={ProjectsTreeView} />
        <Route path="/projects/:id/tasks/new" component={NewTask} />
        <Route path="/projects/:id" component={ProjectDetail} />
        <Route path="/portfolio" component={PortfolioOverview} />
        <Route path="/portfolio-legacy" component={PortfolioView} />
        <Route path="/my-tasks" component={MyTasksPage} />
        <Route path="/tasks" component={TasksPage} />
        <Route path="/admin/scoring" component={AdminScoring} />
        <Route path="/admin/stage-slas" component={AdminStageSlas} />
        <Route path="/admin/role-directory" component={AdminRoleDirectory} />
        <Route path="/admin/roles" component={AdminRoles} />
        <Route path="/admin/cip" component={AdminCip} />
        <Route path="/admin/stage-escalation" component={AdminStageEscalation} />
        <Route path="/admin/doa-matrix" component={AdminDoaMatrix} />
        <Route path="/admin/integrations" component={AdminIntegrationsPage} />
        <Route path="/documents" component={DocumentsPage} />
        <Route path="/lessons-learned" component={LessonsLearnedPage} />
        <Route path="/templates" component={TemplatesPage} />
        <Route path="/pifs/new" component={PifNew} />
        <Route path="/pifs/:id" component={PifDetail} />
        <Route path="/pifs" component={PifsList} />
        <Route path="/nfas/new" component={NfaNew} />
        <Route path="/nfas/:id" component={NfaDetail} />
        <Route path="/nfas" component={NfasList} />
        <Route path="/nudges" component={NudgesPage} />
        <Route path="/automations" component={AutomationsPage} />
        <Route path="/activity" component={ActivityPage} />
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
          <TitleTooltip />
          <SessionExpiredModal />
          <JustificationRequiredModal />
          <AskNyra />
        </TooltipProvider>
      </AuthConsumer>
    </QueryClientProvider>
  );
}

export default App;
