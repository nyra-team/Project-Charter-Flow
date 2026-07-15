// Multi-segment status roll-up bar — how a parent's children are doing, at a
// glance. Used by the Projects list (a project's tasks) and the project table
// view (a milestone's tasks, a task's subtasks), so the segments always mean the
// same thing wherever you see them.

export type StatusCounts = {
  total: number;
  done: number;
  in_progress: number;
  delayed: number;
  on_hold: number;
  not_started: number;
};

// Count a list of children by status into the bar's shape.
export function countByStatus(rows: Array<{ status?: string | null }>): StatusCounts {
  const c: StatusCounts = { total: 0, done: 0, in_progress: 0, delayed: 0, on_hold: 0, not_started: 0 };
  for (const r of rows) {
    c.total++;
    switch (r.status) {
      case "completed": c.done++; break;
      case "in_progress": c.in_progress++; break;
      case "delayed": c.delayed++; break;
      case "on_hold": c.on_hold++; break;
      default: c.not_started++; break;
    }
  }
  return c;
}

export function TaskStatusBar({ counts, emptyLabel = "No tasks" }: { counts?: StatusCounts; emptyLabel?: string }) {
  if (!counts || counts.total === 0) return <span className="text-[10px] text-gray-400">{emptyLabel}</span>;
  const seg = [
    { n: counts.done, c: "#10B981", label: "done" },
    { n: counts.in_progress, c: "#6366F1", label: "in progress" },
    { n: counts.delayed, c: "#EF4444", label: "delayed" },
    { n: counts.on_hold, c: "#94A3B8", label: "on hold" },
    { n: counts.not_started, c: "#CBD5E1", label: "not started" },
  ].filter((s) => s.n > 0);
  return (
    <div className="flex items-center gap-2 w-full min-w-0">
      <div
        className="flex h-2 flex-1 min-w-0 rounded-full overflow-hidden bg-gray-200"
        title={seg.map((s) => `${s.n} ${s.label}`).join(" · ")}
      >
        {seg.map((s, i) => <div key={i} style={{ width: `${(s.n / counts.total) * 100}%`, background: s.c }} />)}
      </div>
      <span className="shrink-0 text-[10px] font-semibold text-gray-700 tabular-nums whitespace-nowrap">
        {counts.done}/{counts.total}
      </span>
    </div>
  );
}
