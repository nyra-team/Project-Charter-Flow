// MyWorkBoard — the personal Monday board for the Dashboard "My Work" home.
// Pulls the current user's tasks (/api/me/tasks → MeTasks buckets) and shows
// them as a single grouped board, each task in its most-urgent bucket only
// (Overdue → Due Today → Waiting Approval → Upcoming → Assigned). Reuses the
// shared MondayBoard + cells; clicking a row opens the standard task modal.
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/extra-api";
import type { AggTask, MeTasks } from "@/lib/work-types";
import { MondayBoard, type BoardColumn, type BoardGroup } from "./MondayBoard";
import { StatusCell, PriorityCell, DateCell, ProgressCell, TextCell } from "./cells";
import { TaskDetailModal } from "../task-detail-modal";
import { Skeleton } from "@/components/ui/skeleton";

// Urgency-ordered buckets; a task lands in the first one it qualifies for.
const BUCKETS: { key: keyof MeTasks; label: string; color: string }[] = [
  { key: "overdue", label: "Overdue", color: "#DC2626" },
  { key: "dueToday", label: "Due Today", color: "#F59E0B" },
  { key: "waitingForApproval", label: "Waiting for Approval", color: "#8B5CF6" },
  { key: "upcoming", label: "Upcoming", color: "#6366F1" },
  { key: "assignedToMe", label: "Assigned to Me", color: "#0EA5E9" },
];

const COLUMNS: BoardColumn<AggTask>[] = [
  { key: "status", header: "Status", width: 120, align: "center", render: (t) => <StatusCell status={t.status} /> },
  { key: "priority", header: "Priority", width: 92, align: "center", render: (t) => <PriorityCell priority={t.priority} /> },
  { key: "project", header: "Project", width: 150, render: (t) => <TextCell value={t.projectName} /> },
  { key: "due", header: "Due", width: 84, align: "center", render: (t) => <DateCell value={t.endDate} overdue={(t.gate?.daysOverdue ?? 0) > 0} /> },
  { key: "progress", header: "Progress", width: 120, render: (t) => <ProgressCell pct={t.progressPct ?? 0} /> },
];

export function MyWorkBoard() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["/api/me/tasks"], queryFn: () => api.get<MeTasks>("/api/me/tasks") });
  const { data: allTasks } = useQuery({ queryKey: ["/api/tasks"], queryFn: () => api.get<AggTask[]>("/api/tasks") });
  const [open, setOpen] = useState<AggTask | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["/api/me/tasks"] }); qc.invalidateQueries({ queryKey: ["/api/tasks"] }); };

  const groups = useMemo<BoardGroup<AggTask>[]>(() => {
    if (!data) return [];
    const seen = new Set<number>();
    const out: BoardGroup<AggTask>[] = [];
    for (const b of BUCKETS) {
      const rows = (data[b.key] as AggTask[] | undefined ?? []).filter((t) => {
        if (seen.has(t.id)) return false;
        seen.add(t.id);
        return true;
      });
      if (rows.length) out.push({ key: b.key, label: b.label, color: b.color, rows });
    }
    return out;
  }, [data]);

  const total = groups.reduce((s, g) => s + g.rows.length, 0);

  if (isLoading) return <Skeleton className="h-48 w-full rounded-xl" />;
  if (total === 0) return null; // nothing assigned — don't clutter the dashboard

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">My Work</h2>
        <span className="text-xs text-muted-foreground">{total} item{total === 1 ? "" : "s"} need your attention</span>
      </div>
      <MondayBoard<AggTask>
        groups={groups}
        columns={COLUMNS}
        getRowId={(t) => `task:${t.id}`}
        getName={(t) => <span className="font-medium">{t.name}</span>}
        getProgress={(t) => t.progressPct ?? 0}
        storageKey="my-work"
        onOpenRow={(t) => setOpen(t)}
      />
      {open && (
        <TaskDetailModal task={open} allTasks={(allTasks ?? []) as AggTask[]} onClose={() => setOpen(null)} onRefresh={refresh} />
      )}
    </div>
  );
}
