import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateIssue, useListUsers, useListMilestones, useListTasks } from "@workspace/api-client-react";
import { useUserStore } from "../lib/store";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Plus } from "lucide-react";

// Shared option sets for the issue fields — reused by the rich raise modal and
// the issues register so the vocabulary never drifts.
export const ISSUE_TYPES = ["Risk", "Issue", "Dependency", "Blocker", "Change Request"] as const;
export const SEVERITIES = ["Low", "Medium", "High", "Critical"] as const;
export const PRIORITIES = ["Low", "Medium", "High", "Urgent"] as const;

// Radix Select has no empty value, so "nothing picked" travels as a sentinel and
// is mapped back to "" on the way into the form state.
const NONE = "__none";

// Raise an issue against a single project, choosing its milestone → task →
// subtask scope. On success it invalidates the project's issue list so the
// register beside it refreshes. Mirrors the cascading scope from the global
// /issues page, but the project is fixed.
export function RaiseIssueForm({ projectId, onRaised }: { projectId: number; onRaised?: () => void }) {
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
          onRaised?.();
        },
        onError: () => toast({ title: "Could not raise issue", variant: "destructive" }),
        onSettled: () => setBusy(false),
      },
    );
  }

  const labelCls = "text-[11px] font-semibold text-muted-foreground";

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/[0.03] p-3">
      <h3 className="text-xs font-bold text-foreground mb-2 flex items-center gap-1.5">
        <Plus size={13} className="text-primary" /> Raise an issue
      </h3>
      <div className="grid gap-2 sm:grid-cols-4">
        <Field label="Milestone">
          <FormSelect
            value={form.milestoneId}
            onChange={(v) => setForm({ ...form, milestoneId: v, taskId: "", subtaskId: "" })}
            placeholder={milestonesArr.length ? "Select milestone…" : "No milestones"}
            options={milestonesArr.map((m) => ({ value: String(m.id), label: m.name }))}
          />
        </Field>
        <Field label="Task">
          <FormSelect
            value={form.taskId}
            onChange={(v) => setForm({ ...form, taskId: v, subtaskId: "" })}
            disabled={!form.milestoneId}
            placeholder={!form.milestoneId ? "Pick a milestone first" : tasksForMilestone.length ? "Select task…" : "No tasks"}
            options={tasksForMilestone.map((t) => ({ value: String(t.id), label: t.name }))}
          />
        </Field>
        <Field label="Subtask">
          <FormSelect
            value={form.subtaskId}
            onChange={(v) => setForm({ ...form, subtaskId: v })}
            disabled={!form.taskId}
            placeholder={!form.taskId ? "Pick a task first" : subtasksForTask.length ? "Select subtask…" : "No subtasks"}
            options={subtasksForTask.map((t) => ({ value: String(t.id), label: t.name }))}
          />
        </Field>
        <Field label="SPOC (single point of contact)">
          <FormSelect
            value={form.assignee}
            onChange={(v) => setForm({ ...form, assignee: v })}
            placeholder="Unassigned"
            options={usersArr.map((u) => ({ value: String(u.id), label: u.name ?? `User ${u.id}` }))}
          />
        </Field>
        <Field label="Issue type">
          <FormSelect
            value={form.issueType}
            onChange={(v) => setForm({ ...form, issueType: v })}
            placeholder="Select type…"
            options={ISSUE_TYPES.map((t) => ({ value: t, label: t }))}
          />
        </Field>
        <Field label="Severity / impact">
          <FormSelect
            value={form.severity}
            onChange={(v) => setForm({ ...form, severity: v })}
            placeholder="Select severity…"
            options={SEVERITIES.map((s) => ({ value: s, label: s }))}
          />
        </Field>
        <Field label="Priority">
          <FormSelect
            value={form.priority}
            onChange={(v) => setForm({ ...form, priority: v })}
            placeholder="Select priority…"
            options={PRIORITIES.map((p) => ({ value: p, label: p }))}
          />
        </Field>
        <Field label="Due date">
          <Input
            type="date"
            value={form.dueDate}
            onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
            className="h-8 text-xs"
          />
        </Field>
        <div className="sm:col-span-4">
          <label className={labelCls}>Title <span className="text-destructive">*</span></label>
          <Input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="What's the issue?"
            className="h-8 text-xs mt-0.5"
          />
        </div>
        <div className="sm:col-span-4">
          <label className={labelCls}>Description</label>
          <Textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={2}
            placeholder="Add context — what's blocked and why…"
            className="text-xs mt-0.5 resize-y"
          />
        </div>
      </div>
      <div className="flex justify-end mt-2">
        <button
          onClick={raise}
          disabled={!canRaise || busy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-primary-foreground bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <AlertTriangle size={13} /> Raise issue
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[11px] font-semibold text-muted-foreground">{label}</label>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

// Optional single-select. The placeholder row doubles as the "clear it" option.
function FormSelect({ value, onChange, placeholder, options, disabled }: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <Select value={value || NONE} onValueChange={(v) => onChange(v === NONE ? "" : v)} disabled={disabled}>
      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
      <SelectContent className="max-h-72">
        <SelectItem value={NONE} className="text-xs text-muted-foreground">{placeholder}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
