// Shared task detail modal — Monday-style. Opened from My Tasks / Tasks / board.
// Shows all task fields, derived ownership (Owner · Approver · Waiting-On) + SLA,
// subtasks (with roll-up), dependencies, and a comment thread (pmo_messages).
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Link } from "wouter";
import { ExternalLink, MessageSquare, Send, Paperclip, GitBranch } from "lucide-react";
import { api } from "@/lib/extra-api";
import { useToast } from "@/hooks/use-toast";
import { PersonAvatar } from "./person-avatar";
import { StatusSelect, PrioritySelect } from "./task-status-chip";
import { OwnerStrip, PhaseChip } from "@/components/ui-kit";
import { Skeleton } from "@/components/ui/skeleton";
import type { AggTask, TaskComment } from "@/lib/work-types";

function SlaChip({ gate }: { gate: AggTask["gate"] }) {
  if (!gate) return null;
  if (gate.daysOverdue > 0) {
    return <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-destructive/10 text-destructive border border-destructive/20">SLA · {gate.daysOverdue}d overdue</span>;
  }
  if (gate.slaDays != null) {
    return <span className="text-[11px] px-2 py-0.5 rounded-full bg-success/10 text-success border border-success/20">SLA {gate.slaDays}d · within</span>;
  }
  return null;
}

export function TaskDetailModal({
  task, allTasks, onClose, onRefresh,
}: {
  task: AggTask;
  allTasks: AggTask[];
  onClose: () => void;
  onRefresh: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");

  const subtasks = allTasks.filter((t) => t.parentTaskId === task.id);
  const deps = Array.isArray(task.predecessorIds) ? task.predecessorIds : [];
  const depTasks = allTasks.filter((t) => deps.includes(t.id));

  const comments = useQuery({
    queryKey: [`/api/tasks/${task.id}/comments`],
    queryFn: () => api.get<TaskComment[]>(`/api/tasks/${task.id}/comments`),
  });

  const patch = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.patch(`/api/tasks/${task.id}`, data),
    onSuccess: () => { onRefresh(); toast({ title: "Task updated" }); },
    onError: () => toast({ title: "Update failed", variant: "destructive" }),
  });

  const addComment = useMutation({
    mutationFn: (body: string) => api.post(`/api/tasks/${task.id}/comments`, { body }),
    onSuccess: () => { setDraft(""); qc.invalidateQueries({ queryKey: [`/api/tasks/${task.id}/comments`] }); },
    onError: () => toast({ title: "Couldn't post comment", variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto scrollbar-thin">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-6">
            <span className="truncate">{task.name}</span>
            {task.stage && <PhaseChip stageKey={task.stage} size="xs" />}
          </DialogTitle>
        </DialogHeader>

        {/* Meta band */}
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <Link href={`/projects/${task.projectId}?tab=grid`}>
            <span className="inline-flex items-center gap-1 text-primary hover:underline cursor-pointer">
              <ExternalLink size={12} /> {task.projectName}
            </span>
          </Link>
          {task.milestoneName && <span className="text-muted-foreground">· {task.milestoneName}</span>}
          <SlaChip gate={task.gate} />
        </div>

        {/* Editable fields */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-1">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Status</p>
            <div className="h-7 rounded overflow-hidden border border-border">
              <StatusSelect value={task.status} onChange={(v) => patch.mutate({ status: v })} />
            </div>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Priority</p>
            <div className="h-7 rounded overflow-hidden border border-border">
              <PrioritySelect value={task.priority} onChange={(v) => patch.mutate({ priority: v })} />
            </div>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Progress</p>
            <input
              type="number" min={0} max={100} defaultValue={task.progressPct}
              onBlur={(e) => { const v = Math.max(0, Math.min(100, Number(e.target.value) || 0)); if (v !== task.progressPct) patch.mutate({ progressPct: v }); }}
              className="w-full text-sm border border-input bg-background rounded px-2 py-1 h-7 outline-none focus:ring-2 focus:ring-ring/40"
            />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Due</p>
            <input
              type="date" defaultValue={task.endDate ?? ""}
              onBlur={(e) => { if (e.target.value !== (task.endDate ?? "")) patch.mutate({ endDate: e.target.value || null }); }}
              className="w-full text-xs border border-input bg-background rounded px-2 py-1 h-7 outline-none focus:ring-2 focus:ring-ring/40"
            />
          </div>
        </div>

        {/* Ownership — Owner · Approver · Waiting-On (derived from stage gate) */}
        <div className="rounded-lg bg-muted/30 border border-border/60 p-3 mt-2">
          <OwnerStrip
            owner={task.assigneeId ? { id: task.assigneeId, name: task.assigneeName ?? "—" } : null}
            approver={task.gate?.approver ?? null}
            waitingOn={task.gate?.waitingOn ?? (task.assigneeId ? { role: "assignee", person: { id: task.assigneeId, name: task.assigneeName ?? "—" } } : null)}
          />
        </div>

        {/* Dependencies */}
        {depTasks.length > 0 && (
          <div className="mt-1">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1"><GitBranch size={11} /> Depends on</p>
            <div className="flex flex-wrap gap-1.5">
              {depTasks.map((d) => (
                <span key={d.id} className="text-[11px] px-2 py-0.5 rounded-full bg-muted border border-border">{d.name}</span>
              ))}
            </div>
          </div>
        )}

        {/* Subtasks */}
        {subtasks.length > 0 && (
          <div className="mt-1">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Subtasks ({subtasks.filter(s => s.status === "completed").length}/{subtasks.length})</p>
            <div className="space-y-1">
              {subtasks.map((s) => (
                <div key={s.id} className="flex items-center gap-2 text-xs rounded-md border border-border/60 bg-card px-2.5 py-1.5">
                  <span className={`w-2 h-2 rounded-full ${s.status === "completed" ? "bg-success" : s.status === "in_progress" ? "bg-primary" : "bg-muted-foreground/40"}`} />
                  <span className="flex-1 truncate">{s.name}</span>
                  {s.assigneeName && <PersonAvatar id={s.assigneeId} name={s.assigneeName} size={16} />}
                  <span className="text-muted-foreground">{s.progressPct}%</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Comments */}
        <div className="mt-2 border-t border-border/60 pt-3">
          <p className="text-[11px] font-semibold text-foreground mb-2 flex items-center gap-1.5"><MessageSquare size={13} /> Comments</p>
          {comments.isLoading ? (
            <Skeleton className="h-16 rounded-lg" />
          ) : (
            <div className="space-y-2 mb-2 max-h-48 overflow-y-auto scrollbar-thin">
              {(comments.data ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground/70 italic">No comments yet.</p>
              ) : (
                comments.data!.map((c) => (
                  <div key={c.id} className="flex items-start gap-2">
                    <PersonAvatar id={c.senderId} name={c.senderName ?? "?"} size={22} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px]"><span className="font-medium text-foreground">{c.senderName ?? "User"}</span> <span className="text-muted-foreground">· {new Date(c.createdAt).toLocaleString()}</span></p>
                      <p className="text-xs text-foreground/90 whitespace-pre-wrap">{c.body}</p>
                      {c.attachments?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {c.attachments.map((a, i) => (
                            <span key={i} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground"><Paperclip size={9} />{a.name ?? "file"}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
          <div className="flex items-center gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && draft.trim()) addComment.mutate(draft.trim()); }}
              placeholder="Add a comment…"
              className="flex-1 text-xs border border-input bg-background rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-ring/40"
            />
            <button
              onClick={() => draft.trim() && addComment.mutate(draft.trim())}
              disabled={!draft.trim() || addComment.isPending}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Send size={13} /> Post
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
