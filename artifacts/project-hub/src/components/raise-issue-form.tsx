import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateIssue, useListUsers, useListMilestones, useListTasks } from "@workspace/api-client-react";
import { useUserStore } from "../lib/store";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, Plus } from "lucide-react";

// Shared option sets for the issue fields — reused by the rich raise modal and
// the issues register so the vocabulary never drifts.
export const ISSUE_TYPES = ["Risk", "Issue", "Dependency", "Blocker", "Change Request"] as const;
export const SEVERITIES = ["Low", "Medium", "High", "Critical"] as const;
export const PRIORITIES = ["Low", "Medium", "High", "Urgent"] as const;

// Raise an issue against a single project, choosing its milestone → task →
// subtask scope. On success it invalidates the project's issue list so the
// IssuesTab beside it refreshes. Mirrors the cascading scope from the global
// /issues page, but the project is fixed.
export function RaiseIssueForm({ projectId }: { projectId: number }) {
  const { toast } = useToast();
  const { userId } = useUserStore();
  const qc = useQueryClient();
  const createIssue = useCreateIssue();
  const { data: users = [] } = useListUsers();
  const { data: milestones = [] } = useListMilestones(projectId);
  const { data: tasks = [] } = useListTasks(projectId);

  const usersArr = users as Array<{ id: number; name?: string }>;
  const milestonesArr = milestones as Array<{ id: number; name: string }>;
  const tasksArr = tasks as Array<{ id: number; name: string; milestoneId?: number | null; parentTaskId?: number | null }>;

  const [form, setForm] = useState({ milestoneId: "", taskId: "", subtaskId: "", title: "", description: "", assignee: "", issueType: "", severity: "", priority: "", dueDate: "" });
  const [busy, setBusy] = useState(false);

  const tasksForMilestone = form.milestoneId
    ? tasksArr.filter((t) => t.parentTaskId == null && String(t.milestoneId ?? "") === form.milestoneId)
    : [];
  const subtasksForTask = form.taskId ? tasksArr.filter((t) => String(t.parentTaskId ?? "") === form.taskId) : [];
  const canRaise = form.title.trim() !== "";

  function raise() {
    if (!canRaise) return;
    setBusy(true);
    createIssue.mutate(
      {
        id: projectId,
        data: {
          title: form.title.trim(),
          description: form.description.trim() || undefined,
          issueType: form.issueType || undefined,
          severity: form.severity || undefined,
          priority: form.priority || undefined,
          dueDate: form.dueDate || undefined,
          milestoneId: form.milestoneId ? Number(form.milestoneId) : undefined,
          // Leaf scope: the subtask if chosen, else the task.
          taskId: form.subtaskId ? Number(form.subtaskId) : form.taskId ? Number(form.taskId) : undefined,
          blockingOwnerId: form.assignee ? Number(form.assignee) : undefined,
          raisedBy: userId ?? undefined,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Issue raised" });
          setForm({ milestoneId: form.milestoneId, taskId: form.taskId, subtaskId: form.subtaskId, title: "", description: "", assignee: "", issueType: "", severity: "", priority: "", dueDate: "" });
          void qc.invalidateQueries({ queryKey: [`/api/projects/${projectId}/issues`] });
        },
        onError: () => toast({ title: "Could not raise issue", variant: "destructive" }),
        onSettled: () => setBusy(false),
      },
    );
  }

  const selectCls = "w-full text-xs border border-border rounded-md px-2 py-0.5 mt-0.5 bg-card disabled:opacity-50 disabled:cursor-not-allowed";
  const labelCls = "text-[11px] font-semibold text-muted-foreground";

  return (
    <div className="glass-surface lift-card rounded-xl p-2.5">
      <h3 className="text-xs font-bold text-foreground mb-1.5 flex items-center gap-1.5"><Plus size={13} className="text-primary" /> Raise an issue</h3>
      <div className="grid gap-1.5 sm:grid-cols-4">
        <div>
          <label className={labelCls}>Milestone</label>
          <select value={form.milestoneId} onChange={(e) => setForm({ ...form, milestoneId: e.target.value, taskId: "", subtaskId: "" })} className={selectCls}>
            <option value="">{milestonesArr.length ? "Select milestone…" : "No milestones"}</option>
            {milestonesArr.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Task</label>
          <select disabled={!form.milestoneId} value={form.taskId} onChange={(e) => setForm({ ...form, taskId: e.target.value, subtaskId: "" })} className={selectCls}>
            <option value="">{!form.milestoneId ? "Select a milestone first" : tasksForMilestone.length ? "Select task…" : "No tasks"}</option>
            {tasksForMilestone.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Subtask</label>
          <select disabled={!form.taskId} value={form.subtaskId} onChange={(e) => setForm({ ...form, subtaskId: e.target.value })} className={selectCls}>
            <option value="">{!form.taskId ? "Select a task first" : subtasksForTask.length ? "Select subtask…" : "No subtasks"}</option>
            {subtasksForTask.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>SPOC (single point of contact)</label>
          <select value={form.assignee} onChange={(e) => setForm({ ...form, assignee: e.target.value })} className={selectCls}>
            <option value="">Unassigned</option>
            {usersArr.map((u) => <option key={u.id} value={u.id}>{u.name ?? `User ${u.id}`}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Issue Type</label>
          <select value={form.issueType} onChange={(e) => setForm({ ...form, issueType: e.target.value })} className={selectCls}>
            <option value="">Select type…</option>
            {ISSUE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Severity / Impact</label>
          <select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })} className={selectCls}>
            <option value="">Select severity…</option>
            {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Priority</label>
          <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className={selectCls}>
            <option value="">Select priority…</option>
            {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Due date</label>
          <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className={selectCls} />
        </div>
        <div className="sm:col-span-4">
          <label className={labelCls}>Title <span className="text-destructive">*</span></label>
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="What's the issue?" className="w-full text-xs border border-border rounded-md px-2 py-0.5 mt-0.5 bg-card outline-none focus:ring-1 focus:ring-primary/40" />
        </div>
        <div className="sm:col-span-4">
          <label className={labelCls}>Description</label>
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={1} placeholder="Add context — what's blocked and why…" className="w-full text-xs border border-border rounded-md px-2 py-0.5 mt-0.5 resize-y bg-card outline-none focus:ring-1 focus:ring-primary/40" />
        </div>
      </div>
      <div className="flex justify-end mt-1.5">
        <button onClick={raise} disabled={!canRaise || busy} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-primary-foreground bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed">
          <AlertTriangle size={13} /> Raise issue
        </button>
      </div>
    </div>
  );
}
