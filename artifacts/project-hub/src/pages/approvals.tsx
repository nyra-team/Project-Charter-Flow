import { useGetPendingApprovals, useDecideApproval } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { useUserStore } from "../lib/store";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

export default function ApprovalsList() {
  const { role, userId } = useUserStore();
  const { data: approvals, isLoading } = useGetPendingApprovals({ approverId: userId });
  const decideMutation = useDecideApproval();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [comments, setComments] = useState("");

  const handleDecision = (id: number, decision: "approved" | "rejected") => {
    decideMutation.mutate({ id, data: { decision, comments } }, {
      onSuccess: () => {
        toast({ title: `Approval ${decision}` });
        queryClient.invalidateQueries({ queryKey: ["/api/approvals/pending"] });
        setComments("");
      }
    });
  };

  // Note: Approvals returned here need to be filtered by the currently selected role
  // for simulation purposes, since we are using a mock store for role.
  const filteredApprovals = approvals?.filter(a => a.approverRole === role);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-3xl font-bold tracking-tight">My Approvals</h2>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2].map((i) => <Skeleton key={i} className="h-32 w-full" />)}
        </div>
      ) : filteredApprovals && filteredApprovals.length > 0 ? (
        <div className="space-y-4">
          {filteredApprovals.map((approval) => (
            <Card key={approval.id}>
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle className="text-xl">
                      <Link href={`/charters/${approval.charterId}`} className="hover:underline text-primary">
                        {approval.charterTitle || `Charter #${approval.charterId}`}
                      </Link>
                    </CardTitle>
                    <CardDescription className="capitalize">Stage: {approval.stage.replace('_', ' ')}</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardFooter className="bg-muted/30 p-4 flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Awaiting your review</span>
                <div className="flex gap-2">
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button variant="destructive">Reject</Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader><DialogTitle>Reject Charter</DialogTitle></DialogHeader>
                      <Textarea placeholder="Reason for rejection (required)" value={comments} onChange={e => setComments(e.target.value)} />
                      <Button variant="destructive" onClick={() => handleDecision(approval.id, 'rejected')} disabled={!comments || decideMutation.isPending}>Confirm Rejection</Button>
                    </DialogContent>
                  </Dialog>
                  
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button className="bg-green-600 hover:bg-green-700">Approve</Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader><DialogTitle>Approve Charter</DialogTitle></DialogHeader>
                      <Textarea placeholder="Comments (optional)" value={comments} onChange={e => setComments(e.target.value)} />
                      <Button onClick={() => handleDecision(approval.id, 'approved')} disabled={decideMutation.isPending}>Confirm Approval</Button>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardFooter>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center h-64 text-muted-foreground">
            <p>No pending approvals for your role ({role}).</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
