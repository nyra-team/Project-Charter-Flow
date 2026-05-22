import { useState } from "react";
import { useCreateIssue, useListIssues, useUpdateIssue, useListUsers, useCreateNotification } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, CheckCircle2, Clock, Plus, X } from "lucide-react";
import { DEPARTMENTS } from "../lib/task-constants";
import { formatDate } from "../lib/format";

interface Issue {
  id: number;
  title: string;
  description?: string | null;
  taskId?: number | null;
  milestoneId?: number | null;
  dependencyType?: string | null;
  blockingOwnerId?: number | null;
  blockingDept?: string | null;
  originalDeadline?: string | null;
  proposedRevisedDeadline?: string | null;
  status: string;
  resolutionNotes?: string | null;
  createdAt: string;
}

interface IssueRaiseModalProps {
  open: boolean;
  onClose: () => void;
  projectId: number;
  taskId?: number;
  milestoneId?: number;
  taskName?: string;
}

const ISSUE_STATUS_META: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  open:     { label: "Open",     color: "#DC3545", bg: "#FDEDEE", icon: <AlertTriangle size={12} /> },
  pending:  { label: "Pending",  color: "#FFC107", bg: "#FFF8E1", icon: <Clock size={12} /> },
  resolved: { label: "Resolved", color: "#28A745", bg: "#E9F7ED", icon: <CheckCircle2 size={12} /> },
};

export function IssueRaiseModal({ open, onClose, projectId, taskId, milestoneId, taskName }: IssueRaiseModalProps) {
  const { toast } = useToast();
  const { data: users = [] } = useListUsers();
  const { data: issues = [], refetch } = useListIssues(projectId);
  const createIssue = useCreateIssue();
  const updateIssue = useUpdateIssue();
  const createNotification = useCreateNotification();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    title: "",
    description: "",
    dependencyType: "blocking",
    blockingOwnerId: "",
    blockingDept: "",
    originalDeadline: "",
    proposedRevisedDeadline: "",
  });

  const usersArr = users as Array<{ id: number; name: string }>;

  const relevantIssues = (issues as Issue[]).filter(i =>
    (taskId && i.taskId === taskId) ||
    (milestoneId && i.milestoneId === milestoneId) ||
    (!taskId && !milestoneId)
  );

  function resetForm() {
    setForm({ title: "", description: "", dependencyType: "blocking", blockingOwnerId: "", blockingDept: "", originalDeadline: "", proposedRevisedDeadline: "" });
    setShowForm(false);
  }

  function handleSubmit() {
    if (!form.title.trim()) { toast({ title: "Issue title is required", variant: "destructive" }); return; }

    const blockingOwnerIdNum = form.blockingOwnerId ? parseInt(form.blockingOwnerId) : undefined;

    createIssue.mutate(
      {
        id: projectId,
        data: {
          title: form.title,
          description: form.description || undefined,
          taskId: taskId,
          milestoneId: milestoneId,
          dependencyType: form.dependencyType || undefined,
          blockingOwnerId: blockingOwnerIdNum,
          blockingDept: form.blockingDept || undefined,
          originalDeadline: form.originalDeadline || undefined,
          proposedRevisedDeadline: form.proposedRevisedDeadline || undefined,
        },
      },
      {
        onSuccess: (created) => {
          toast({ title: "Issue raised successfully" });

          // Notify blocking owner if one was specified
          if (blockingOwnerIdNum) {
            const issueId = (created as { id?: number })?.id;
            createNotification.mutate({
              data: {
                userId: blockingOwnerIdNum,
                type: "issue_raised",
                title: `You are the blocking owner of a new issue: "${form.title}"`,
                body: form.description
                  ? `${form.description}\n\nDependency type: ${form.dependencyType}. Project #${projectId}${taskName ? `, Task: ${taskName}` : ""}.`
                  : `Dependency type: ${form.dependencyType}. Project #${projectId}${taskName ? `, Task: ${taskName}` : ""}.`,
                link: `/projects/${projectId}`,
                relatedEntityType: "issue",
                relatedEntityId: issueId,
              },
            }, {
              onError: () => {
                // Notification failure is non-critical — issue was still created
              },
            });
          }

          resetForm();
          refetch();
        },
        onError: () => toast({ title: "Failed to raise issue", variant: "destructive" }),
      }
    );
  }

  function handleStatusChange(issueId: number, status: string) {
    updateIssue.mutate(
      { id: issueId, data: { status: status as "open" | "pending" | "resolved" } },
      {
        onSuccess: () => { refetch(); },
        onError: () => toast({ title: "Failed to update issue", variant: "destructive" }),
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle size={18} className="text-amber-500" />
            Issues{taskName ? ` — ${taskName}` : ""}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Existing issues */}
          {relevantIssues.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                {relevantIssues.length} Issue{relevantIssues.length !== 1 ? "s" : ""}
              </p>
              {relevantIssues.map((issue) => {
                const meta = ISSUE_STATUS_META[issue.status] ?? ISSUE_STATUS_META.open;
                const ownerName = usersArr.find(u => u.id === issue.blockingOwnerId)?.name;
                return (
                  <div
                    key={issue.id}
                    className="rounded-xl p-4 space-y-2"
                    style={{ background: "#F8FAFC", border: "1px solid #E2E8F0" }}
                  >
                    <div className="flex items-start gap-2">
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold flex-shrink-0"
                        style={{ background: meta.bg, color: meta.color }}
                      >
                        {meta.icon} {meta.label}
                      </span>
                      <p className="text-sm font-medium text-gray-800 flex-1">{issue.title}</p>
                    </div>
                    {issue.description && <p className="text-xs text-gray-500">{issue.description}</p>}
                    <div className="flex flex-wrap gap-3 text-xs text-gray-500">
                      {issue.dependencyType && <span>Type: <b>{issue.dependencyType}</b></span>}
                      {ownerName && <span>Blocking Owner: <b>{ownerName}</b></span>}
                      {issue.blockingDept && <span>Dept: <b>{issue.blockingDept}</b></span>}
                      {issue.originalDeadline && <span>Original: <b>{formatDate(issue.originalDeadline)}</b></span>}
                      {issue.proposedRevisedDeadline && (
                        <span className="text-amber-600">Proposed: <b>{formatDate(issue.proposedRevisedDeadline)}</b></span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                      <span className="text-xs text-gray-400">Status:</span>
                      {(["open", "pending", "resolved"] as const).map(s => {
                        const m = ISSUE_STATUS_META[s];
                        return (
                          <button
                            key={s}
                            onClick={() => handleStatusChange(issue.id, s)}
                            className="text-xs px-2 py-0.5 rounded-full border font-medium transition-all"
                            style={{
                              background: issue.status === s ? m.bg : "transparent",
                              color: issue.status === s ? m.color : "#94A3B8",
                              borderColor: issue.status === s ? m.color + "60" : "#E2E8F0",
                            }}
                          >
                            {m.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {relevantIssues.length === 0 && !showForm && (
            <div className="text-center py-6 text-gray-400 text-sm">No issues raised yet.</div>
          )}

          {/* Raise new issue form */}
          {showForm ? (
            <div className="rounded-xl p-4 space-y-3" style={{ background: "#FFF8F5", border: "1px solid #FDBA74" }}>
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-700">Raise New Issue</p>
                <button onClick={resetForm} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Issue Title *</label>
                <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Describe the issue..." className="text-sm" />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Description</label>
                <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} className="text-sm" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Dependency Type</label>
                  <Select value={form.dependencyType} onValueChange={v => setForm(f => ({ ...f, dependencyType: v }))}>
                    <SelectTrigger className="text-sm h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="blocking">Blocking</SelectItem>
                      <SelectItem value="waiting">Waiting</SelectItem>
                      <SelectItem value="external">External</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Blocking Department</label>
                  <Select value={form.blockingDept} onValueChange={v => setForm(f => ({ ...f, blockingDept: v }))}>
                    <SelectTrigger className="text-sm h-9"><SelectValue placeholder="Select dept" /></SelectTrigger>
                    <SelectContent>
                      {DEPARTMENTS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">
                    Blocking Owner <span className="text-xs text-gray-400">(notified on create)</span>
                  </label>
                  <Select value={form.blockingOwnerId} onValueChange={v => setForm(f => ({ ...f, blockingOwnerId: v }))}>
                    <SelectTrigger className="text-sm h-9"><SelectValue placeholder="Select owner" /></SelectTrigger>
                    <SelectContent>
                      {usersArr.map(u => (
                        <SelectItem key={u.id} value={u.id.toString()}>{u.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Original Deadline</label>
                  <Input type="date" value={form.originalDeadline} onChange={e => setForm(f => ({ ...f, originalDeadline: e.target.value }))} className="text-sm h-9" />
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Proposed Revised Deadline</label>
                  <Input type="date" value={form.proposedRevisedDeadline} onChange={e => setForm(f => ({ ...f, proposedRevisedDeadline: e.target.value }))} className="text-sm h-9" />
                </div>
              </div>

              <div className="flex gap-2 pt-1">
                <Button size="sm" onClick={handleSubmit} disabled={createIssue.isPending} className="text-xs">
                  {createIssue.isPending ? "Raising..." : "Raise Issue"}
                </Button>
                <Button size="sm" variant="ghost" onClick={resetForm} className="text-xs">Cancel</Button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowForm(true)}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium text-indigo-600 border border-dashed border-indigo-300 hover:bg-indigo-50 transition-colors"
            >
              <Plus size={14} />
              Raise New Issue
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
