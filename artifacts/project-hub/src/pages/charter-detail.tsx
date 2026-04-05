import { useRoute } from "wouter";
import { useGetCharter, useListCharterVendors, useListCharterRisks, useListCharterSquad, useListApprovals, useSubmitCharter, useListUsers, useScmNegotiate, useEnterFinanceOrder, useCreateProject } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { formatCurrency, formatDate } from "../lib/format";
import { StatusBadge } from "../components/status-badge";
import { useUserStore } from "../lib/store";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Textarea } from "@/components/ui/textarea";

export default function CharterDetail() {
  const [, params] = useRoute("/charters/:id");
  const charterId = parseInt(params?.id || "0");
  const { role, userId } = useUserStore();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: charter, isLoading: loadingCharter } = useGetCharter(charterId, { query: { enabled: !!charterId } });
  const { data: vendors } = useListCharterVendors(charterId, { query: { enabled: !!charterId } });
  const { data: risks } = useListCharterRisks(charterId, { query: { enabled: !!charterId } });
  const { data: squad } = useListCharterSquad(charterId, { query: { enabled: !!charterId } });
  const { data: approvals } = useListApprovals({ charterId }, { query: { enabled: !!charterId } });
  const { data: users } = useListUsers();

  const submitMutation = useSubmitCharter();
  const createProjectMutation = useCreateProject();
  const scmMutation = useScmNegotiate();
  const financeMutation = useEnterFinanceOrder();

  if (loadingCharter) {
    return <div className="space-y-4"><Skeleton className="h-32" /><Skeleton className="h-64" /></div>;
  }
  if (!charter) return <div>Charter not found</div>;

  const handleSubmit = () => {
    submitMutation.mutate({ id: charterId }, {
      onSuccess: () => {
        toast({ title: "Charter submitted for approval" });
        queryClient.invalidateQueries({ queryKey: ["/api/charters", charterId] });
      }
    });
  };

  const handleCreateProject = () => {
    createProjectMutation.mutate({
      data: {
        charterId,
        name: charter.title,
        description: charter.description,
        projectManagerId: charter.projectManagerId || undefined,
        startDate: charter.startDate || undefined,
        endDate: charter.endDate || undefined
      }
    }, {
      onSuccess: () => {
        toast({ title: "Project activated" });
        queryClient.invalidateQueries({ queryKey: ["/api/charters", charterId] });
      }
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">{charter.title}</h1>
          <div className="flex items-center gap-4 text-muted-foreground text-sm">
            <span>Created by ID: {charter.submittedById} on {formatDate(charter.createdAt)}</span>
            <StatusBadge status={charter.status} />
          </div>
        </div>
        <div className="flex gap-2">
          {charter.status === "draft" && role === "initiator" && (
            <Button onClick={handleSubmit} disabled={submitMutation.isPending}>
              Submit for Approval
            </Button>
          )}
          {charter.status === "approved" && role === "pmo" && (
            <Button onClick={handleCreateProject} disabled={createProjectMutation.isPending}>
              Create Project
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Tabs defaultValue="details">
            <TabsList>
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="vendors">Vendors</TabsTrigger>
              <TabsTrigger value="risks">Risks</TabsTrigger>
              <TabsTrigger value="squad">Squad</TabsTrigger>
            </TabsList>
            
            <TabsContent value="details" className="space-y-6 mt-4">
              <Card>
                <CardHeader>
                  <CardTitle>Description</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="whitespace-pre-wrap">{charter.description}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Scope</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="whitespace-pre-wrap">{charter.scope}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Deliverables</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="whitespace-pre-wrap">{charter.deliverables}</p>
                </CardContent>
              </Card>
            </TabsContent>
            
            <TabsContent value="vendors" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle>Vendor Comparison</CardTitle>
                </CardHeader>
                <CardContent>
                  {vendors?.length ? (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-2">Vendor Name</th>
                          <th className="text-right py-2">Proposed Price</th>
                          <th className="text-center py-2">Selected</th>
                        </tr>
                      </thead>
                      <tbody>
                        {vendors.map(v => (
                          <tr key={v.id} className="border-b">
                            <td className="py-2 font-medium">{v.vendorName}</td>
                            <td className="text-right py-2">{formatCurrency(v.proposedPrice)}</td>
                            <td className="text-center py-2">{v.isSelected ? "Yes" : "No"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : <p className="text-muted-foreground">No vendors added.</p>}
                </CardContent>
              </Card>
            </TabsContent>
            
            <TabsContent value="risks" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle>Risk Register</CardTitle>
                </CardHeader>
                <CardContent>
                  {risks?.length ? (
                    <div className="space-y-4">
                      {risks.map(r => (
                        <div key={r.id} className="border p-4 rounded-md">
                          <h4 className="font-bold">{r.title}</h4>
                          <p className="text-sm text-muted-foreground mb-2">{r.description}</p>
                          <div className="flex gap-4 text-xs">
                            <span>Impact: <strong className="capitalize">{r.impact}</strong></span>
                            <span>Likelihood: <strong className="capitalize">{r.likelihood}</strong></span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : <p className="text-muted-foreground">No risks identified.</p>}
                </CardContent>
              </Card>
            </TabsContent>
            
            <TabsContent value="squad" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle>Squad Members</CardTitle>
                </CardHeader>
                <CardContent>
                  {squad?.length ? (
                    <ul className="space-y-2">
                      {squad.map(s => {
                        const user = users?.find(u => u.id === s.userId);
                        return (
                          <li key={s.id} className="flex justify-between items-center border-b pb-2">
                            <span>{user?.name || `User ${s.userId}`}</span>
                            <span className="text-muted-foreground text-sm capitalize">{s.role}</span>
                          </li>
                        );
                      })}
                    </ul>
                  ) : <p className="text-muted-foreground">No squad members assigned.</p>}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Budget & Timeline</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">Tentative Budget</span>
                <span className="font-medium">{formatCurrency(charter.tentativeBudget)}</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">Final Budget</span>
                <span className="font-medium">{formatCurrency(charter.finalNegotiatedBudget)}</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">Start Date</span>
                <span className="font-medium">{formatDate(charter.startDate)}</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">End Date</span>
                <span className="font-medium">{formatDate(charter.endDate)}</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">Duration</span>
                <span className="font-medium">{charter.durationDays ? `${charter.durationDays} days` : "-"}</span>
              </div>
              <div className="flex justify-between pb-2">
                <span className="text-muted-foreground">Internal Order</span>
                <span className="font-medium">{charter.internalOrderNumber || "-"}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Approval Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              {approvals?.length ? (
                <div className="space-y-4">
                  {approvals.map(app => (
                    <div key={app.id} className="border-l-2 border-muted pl-4 ml-2 pb-4 relative">
                      <div className={`absolute w-3 h-3 rounded-full -left-[7px] top-1 ${app.status === 'approved' ? 'bg-green-500' : app.status === 'rejected' ? 'bg-red-500' : 'bg-amber-500'}`}></div>
                      <p className="text-sm font-bold capitalize">{app.approverRole.replace(/_/g, ' ')}</p>
                      <p className="text-xs text-muted-foreground capitalize">Status: {app.status}</p>
                      {app.comments && <p className="text-sm mt-1 bg-muted/50 p-2 rounded">{app.comments}</p>}
                      {app.decidedAt && <p className="text-xs text-muted-foreground mt-1">{formatDate(app.decidedAt)}</p>}
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm text-muted-foreground">No approval records yet.</p>}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
