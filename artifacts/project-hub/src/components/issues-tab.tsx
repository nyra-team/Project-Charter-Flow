import { useMemo, useState } from "react";
import {
  useListIssues, useUpdateIssue, useDeleteIssue, useListUsers, useListTasks, useListMilestones,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { AlertCircle, CheckCircle2, Clock, Trash2 } from "lucide-react";
import { formatDate } from "../lib/format";

type Issue = {
  id: number; projectId: number; taskId?: number | null; milestoneId?: number | null;
  title: string; description?: string | null;
  dependencyType?: string | null; blockingOwnerId?: number | null; blockingDept?: string | null;
  originalDeadline?: string | null; proposedRevisedDeadline?: string | null;
  status: string; raisedBy?: number | null; resolvedAt?: string | null; resolutionNotes?: string | null;
  createdAt?: string;
};

const STATUS_META: Record<string, { color: string; bg: string; icon: typeof Clock }> = {
  open: { color: "hsl(var(--warn))", bg: "hsl(var(--warn) / 0.10)", icon: AlertCircle },
  in_progress: { color: "hsl(var(--primary))", bg: "hsl(var(--primary) / 0.10)", icon: Clock },
  resolved: { color: "hsl(var(--success))", bg: "hsl(var(--success) / 0.10)", icon: CheckCircle2 },
  closed: { color: "hsl(var(--muted-foreground))", bg: "hsl(var(--border))", icon: CheckCircle2 },
};

export function IssuesTab({ projectId }: { projectId: number }) {
  const { toast } = useToast();
  const { data: issues = [], refetch } = useListIssues(projectId);
  const { data: users = [] } = useListUsers();
  const { data: tasks = [] } = useListTasks(projectId);
  const { data: milestones = [] } = useListMilestones(projectId);
  const updateIssue = useUpdateIssue();
  const deleteIssue = useDeleteIssue();

  const [statusFilter, setStatusFilter] = useState<string>("");
  const [ownerFilter, setOwnerFilter] = useState<string>("");
  const [deptFilter, setDeptFilter] = useState<string>("");

  const issuesArr = (issues as Issue[]) ?? [];
  const usersArr = users as Array<{ id: number; name: string; department?: string }>;
  const tasksArr = tasks as Array<{ id: number; title: string }>;
  const milestonesArr = milestones as Array<{ id: number; title: string }>;
  const userName = (id?: number | null) => id ? (usersArr.find(u => u.id === id)?.name ?? `#${id}`) : "—";
  const taskTitle = (id?: number | null) => id ? (tasksArr.find(t => t.id === id)?.title ?? `Task #${id}`) : null;
  const msTitle = (id?: number | null) => id ? (milestonesArr.find(m => m.id === id)?.title ?? `MS #${id}`) : null;

  const depts = useMemo(() => Array.from(new Set(issuesArr.map(i => i.blockingDept).filter(Boolean))) as string[], [issuesArr]);

  const filtered = issuesArr.filter(i =>
    (!statusFilter || i.status === statusFilter) &&
    (!ownerFilter || String(i.blockingOwnerId) === ownerFilter) &&
    (!deptFilter || i.blockingDept === deptFilter)
  );

  const grouped = useMemo(() => {
    const g = { open: 0, in_progress: 0, resolved: 0, closed: 0 } as Record<string, number>;
    for (const i of issuesArr) g[i.status] = (g[i.status] ?? 0) + 1;
    return g;
  }, [issuesArr]);

  function changeStatus(id: number, status: string) {
    updateIssue.mutate({
      id,
      data: { status, ...(status === "resolved" || status === "closed" ? { resolvedAt: new Date().toISOString() } : {}) },
    }, {
      onSuccess: () => { refetch(); toast({ title: `Marked ${status.replace("_", " ")}` }); },
      onError: () => toast({ title: "Update failed", variant: "destructive" }),
    });
  }

  function handleDelete(id: number) {
    if (!confirm("Delete this issue?")) return;
    deleteIssue.mutate({ id }, { onSuccess: () => { refetch(); toast({ title: "Issue deleted" }); } });
  }

  return (
    <div className="space-y-5">
      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { key: "open", label: "Open", count: grouped.open ?? 0 },
          { key: "in_progress", label: "In Progress", count: grouped.in_progress ?? 0 },
          { key: "resolved", label: "Resolved", count: grouped.resolved ?? 0 },
          { key: "closed", label: "Closed", count: grouped.closed ?? 0 },
        ].map(s => {
          const m = STATUS_META[s.key];
          return (
            <button
              key={s.key}
              onClick={() => setStatusFilter(statusFilter === s.key ? "" : s.key)}
              className="glass-surface lift-card ph-rise rounded-2xl p-4 text-left transition-all"
              style={{ border: `1px solid ${statusFilter === s.key ? m.color : "hsl(var(--border))"}` }}
            >
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: m.color }}>{s.label}</p>
              <p className="text-2xl font-bold mt-1" style={{ color: m.color }}>{s.count}</p>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="glass-surface lift-card ph-rise rounded-2xl p-4 flex flex-wrap gap-3 items-center">
        <span className="text-xs font-semibold text-muted-foreground">FILTERS:</span>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="text-sm border border-border rounded-lg px-3 py-1.5">
          <option value="">All statuses</option>
          {Object.keys(STATUS_META).map(s => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
        </select>
        <select value={ownerFilter} onChange={e => setOwnerFilter(e.target.value)} className="text-sm border border-border rounded-lg px-3 py-1.5">
          <option value="">All blocking owners</option>
          {usersArr.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)} className="text-sm border border-border rounded-lg px-3 py-1.5">
          <option value="">All blocking depts</option>
          {depts.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <span className="ml-auto text-xs text-muted-foreground">{filtered.length} of {issuesArr.length}</span>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="glass-surface lift-card ph-rise rounded-2xl p-10 text-center text-sm text-muted-foreground">
          {issuesArr.length === 0 ? "No issues raised on this project." : "No issues match your filters."}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(i => {
            const meta = STATUS_META[i.status] ?? STATUS_META.open;
            const Icon = meta.icon;
            const taskLabel = taskTitle(i.taskId);
            const msLabel = msTitle(i.milestoneId);
            return (
              <div key={i.id} className="glass-surface lift-card ph-rise rounded-2xl p-4">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: meta.bg }}>
                    <Icon size={15} style={{ color: meta.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-mono text-muted-foreground">I-{i.id}</span>
                      <p className="text-sm font-semibold text-foreground">{i.title}</p>
                      <span className="text-xs font-bold px-2 py-0.5 rounded" style={{ background: meta.bg, color: meta.color }}>{i.status.replace("_", " ")}</span>
                      {i.dependencyType && <span className="text-xs px-2 py-0.5 rounded bg-muted text-foreground">{i.dependencyType}</span>}
                    </div>
                    {i.description && <p className="text-xs text-muted-foreground mt-1">{i.description}</p>}
                    <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
                      {taskLabel && <span>↳ Task: <b>{taskLabel}</b></span>}
                      {msLabel && <span>↳ Milestone: <b>{msLabel}</b></span>}
                      {i.blockingOwnerId && <span>Blocking: <b>{userName(i.blockingOwnerId)}</b></span>}
                      {i.blockingDept && <span>Dept: <b>{i.blockingDept}</b></span>}
                      {i.originalDeadline && <span>Original: {formatDate(i.originalDeadline)}</span>}
                      {i.proposedRevisedDeadline && <span>Revised: {formatDate(i.proposedRevisedDeadline)}</span>}
                      <span>Raised by {userName(i.raisedBy)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <select
                      value={i.status}
                      onChange={e => changeStatus(i.id, e.target.value)}
                      className="text-xs border border-border rounded px-2 py-1"
                    >
                      {Object.keys(STATUS_META).map(s => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
                    </select>
                    <button onClick={() => handleDelete(i.id)} className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-destructive" title="Delete">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
