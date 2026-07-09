// Progress rollup engine — the single source of truth for the work-hierarchy
// completion chain:
//
//   Subtask -> Task -> Milestone -> Project   (-> Portfolio, computed on read)
//
// recomputeRollups(projectId) recomputes the whole project's hierarchy in one
// pass and persists the derived numbers. It is called at the end of every task
// and milestone mutation in routes/projects.ts. Project sizes are tens-to-low-
// hundreds of rows, so a full recompute per mutation is cheap and keeps the
// logic in one obvious place rather than scattered incremental updates.
//
// IMPORTANT (governance): this only touches the *progress %* columns
// (pmo_tasks.progress_pct, pmo_milestones.progress_pct, pmo_projects.progress).
// It NEVER writes rag / rag_status / gate_decision / stage / approvals — those
// stay PM-controlled governance signals. Computed % is the source of truth for
// completion; RAG health is a separate, deliberate human judgement.
//
// The leaf->parent task math intentionally mirrors the client-side rollup in
// project-hub/src/components/wbs-tree.tsx so the board and the API always agree.
import { db, tasksTable, milestonesTable, projectsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

interface RollupTask {
  id: number;
  parentTaskId: number | null;
  milestoneId: number | null;
  progressPct: number;
  status: string;
}

// A leaf task's effective completion: a 'completed' status is 100% regardless of
// the stored progress_pct (status changes don't write progress_pct — e.g. the
// status popup, or Jira-imported issues that arrive completed with pct 0). This
// mirrors project-detail.tsx's on-screen `status === "completed" ? 100 : pct`.
function leafProgress(t: RollupTask): number {
  return t.status === "completed" ? 100 : (t.progressPct ?? 0);
}

/**
 * Recompute and persist all derived progress for one project:
 *   - parent tasks    = round(avg of children's effective progress)
 *   - milestones      = round(avg of their TOP-LEVEL tasks' effective progress)
 *   - project.progress = round(avg of milestones that contain top-level tasks)
 *
 * Only writes rows whose value actually changed (IS DISTINCT semantics), so a
 * no-op mutation costs a few SELECTs and no UPDATEs. Best-effort: callers should
 * not let a rollup failure fail the user's mutation — wrap in try/catch at the
 * call site if the write already succeeded.
 */
export async function recomputeRollups(projectId: number): Promise<void> {
  const tasks: RollupTask[] = await db
    .select({
      id: tasksTable.id,
      parentTaskId: tasksTable.parentTaskId,
      milestoneId: tasksTable.milestoneId,
      progressPct: tasksTable.progressPct,
      status: tasksTable.status,
    })
    .from(tasksTable)
    .where(eq(tasksTable.projectId, projectId));

  const milestones = await db
    .select({ id: milestonesTable.id, progressPct: milestonesTable.progressPct, status: milestonesTable.status })
    .from(milestonesTable)
    .where(eq(milestonesTable.projectId, projectId));

  // children grouped by parent task id
  const childrenByParent = new Map<number, RollupTask[]>();
  for (const t of tasks) {
    if (t.parentTaskId != null) {
      const arr = childrenByParent.get(t.parentTaskId) ?? [];
      arr.push(t);
      childrenByParent.set(t.parentTaskId, arr);
    }
  }

  // Effective progress of a task: a leaf reports its own progress_pct; a parent
  // reports the average of its children's effective progress (recursive, memoised).
  const memo = new Map<number, number>();
  const effective = (t: RollupTask): number => {
    const cached = memo.get(t.id);
    if (cached !== undefined) return cached;
    const kids = childrenByParent.get(t.id) ?? [];
    const val = kids.length
      ? Math.round(kids.reduce((s, k) => s + effective(k), 0) / kids.length)
      : leafProgress(t);
    memo.set(t.id, val);
    return val;
  };

  // 1) Persist parent-task progress where the stored value drifted from the roll-up.
  for (const t of tasks) {
    const kids = childrenByParent.get(t.id) ?? [];
    if (kids.length === 0) continue; // leaf — user-owned, never overwritten
    const val = effective(t);
    if (val !== (t.progressPct ?? 0)) {
      await db.update(tasksTable).set({ progressPct: val }).where(eq(tasksTable.id, t.id));
    }
  }

  // 2) Milestone progress = avg of its TOP-LEVEL tasks' effective progress.
  const topByMilestone = new Map<number, RollupTask[]>();
  for (const t of tasks) {
    if (t.parentTaskId == null && t.milestoneId != null) {
      const arr = topByMilestone.get(t.milestoneId) ?? [];
      arr.push(t);
      topByMilestone.set(t.milestoneId, arr);
    }
  }
  const milestonePct = new Map<number, number>();
  for (const m of milestones) {
    const ts = topByMilestone.get(m.id) ?? [];
    // With no tasks to average, fall back to the milestone's own status — the
    // same rule leafProgress() applies to tasks. Milestones legitimately carry
    // no tasks (imported plans, gates), and forcing those to 0 renders a
    // "Completed" milestone at 0%.
    const val = ts.length
      ? Math.round(ts.reduce((s, t) => s + effective(t), 0) / ts.length)
      : m.status === "completed" ? 100 : 0;
    milestonePct.set(m.id, val);
    if (val !== (m.progressPct ?? 0)) {
      await db.update(milestonesTable).set({ progressPct: val }).where(eq(milestonesTable.id, m.id));
    }
  }

  // 3) Project progress = avg of milestones that actually contain top-level tasks
  //    (empty gate milestones don't dilute the denominator).
  const contributing = milestones.filter((m) => (topByMilestone.get(m.id)?.length ?? 0) > 0);
  let projectPct: number;
  if (contributing.length > 0) {
    projectPct = Math.round(
      contributing.reduce((s, m) => s + (milestonePct.get(m.id) ?? 0), 0) / contributing.length,
    );
  } else if (milestones.some((m) => (milestonePct.get(m.id) ?? 0) > 0)) {
    // A plan tracked purely at milestone level (imported schedules): no tasks
    // anywhere, but some milestones are done. Average all of them, so progress
    // isn't stuck at 0. Guarded on "some milestone is non-zero" so a project of
    // empty, not-started gates still falls through to the task math below and
    // keeps its existing behaviour.
    projectPct = Math.round(
      milestones.reduce((s, m) => s + (milestonePct.get(m.id) ?? 0), 0) / milestones.length,
    );
  } else {
    // Fallback: no milestone-bucketed work — average top-level tasks directly.
    const tops = tasks.filter((t) => t.parentTaskId == null);
    projectPct = tops.length ? Math.round(tops.reduce((s, t) => s + effective(t), 0) / tops.length) : 0;
  }

  const [proj] = await db
    .select({ progress: projectsTable.progress })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId));
  if (proj && proj.progress !== projectPct) {
    await db.update(projectsTable).set({ progress: projectPct }).where(eq(projectsTable.id, projectId));
  }
}
