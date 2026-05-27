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
import AdminScoring from "./pages/admin-scoring";
import DocumentsPage from "./pages/documents";
import LessonsLearnedPage from "./pages/lessons-learned";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

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
        <Route path="/admin/scoring" component={AdminScoring} />
        <Route path="/documents" component={DocumentsPage} />
        <Route path="/lessons-learned" component={LessonsLearnedPage} />
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
