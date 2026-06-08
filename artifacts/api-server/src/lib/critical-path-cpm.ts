/**
 * critical-path-cpm.ts
 *
 * Task-level Critical Path Method (CPM) over pmo_tasks dependency edges.
 *
 * This is the SCHEDULE critical path (forward + backward pass over task
 * predecessors → early/late start/finish, slack/float, isCritical). It is
 * DISTINCT from lib/critical-path.ts, which computes the lifecycle-STAGE
 * governance critical path (which gate is blocking, who owns it). Both
 * coexist; neither replaces the other.
 *
 * Design notes
 * ────────────
 *  - Edge direction: a task's `predecessorIds` are tasks that must finish
 *    before it can start (edge  pred → task). We only consider IN-PROJECT
 *    predecessors here; cross_project_predecessors are external constraints
 *    surfaced separately by the task enrichment, not scheduled in this DAG.
 *  - Cycle safety: the previous forward-only implementation recursed with no
 *    visited-guard, so a malformed A→B→A edge would blow the stack. Here we
 *    run an explicit Kahn topological sort; if not all nodes drain, the graph
 *    has a cycle and we report it (and skip scheduling) instead of looping.
 *  - Duration: prefer the real planned window (endDate − startDate, ≥1 day);
 *    fall back to estimatedHours/8 (an 8h workday); else 1 day. Durations are
 *    in whole days and unitless on the timeline (day 0 = project start).
 */

import { db, tasksTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const DAY_MS = 24 * 60 * 60 * 1000;
const EPS = 1e-6;

export interface CpmTask {
  id: number;
  name: string;
  milestoneId: number | null;
  durationDays: number;
  /** Day offset from project start (day 0). */
  earliestStart: number;
  earliestFinish: number;
  latestStart: number;
  latestFinish: number;
  /** latestStart − earliestStart. 0 (±EPS) ⇒ on the critical path. */
  slackDays: number;
  isCritical: boolean;
  predecessorIds: number[];
}

export interface CpmResult {
  hasCycle: boolean;
  /** When hasCycle: the task ids forming the detected cycle (best-effort). */
  cycle: number[] | null;
  /** Total project schedule length in days (max earliestFinish). 0 if cyclic. */
  projectDurationDays: number;
  tasks: CpmTask[];
  criticalTaskIds: number[];
}

interface RawTask {
  id: number;
  name: string;
  milestoneId: number | null;
  startDate: string | null;
  endDate: string | null;
  estimatedHours: string | null;
  predecessorIds: string | null;
}

/** Parse a JSON int array stored as text; tolerate garbage → []. */
function parseIds(json: string | null): number[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is number => typeof x === "number") : [];
  } catch {
    return [];
  }
}

/** Whole-day planned duration, with documented fallbacks (always ≥1). */
function durationFor(t: RawTask): number {
  const s = t.startDate ? new Date(t.startDate).getTime() : NaN;
  const e = t.endDate ? new Date(t.endDate).getTime() : NaN;
  if (!Number.isNaN(s) && !Number.isNaN(e) && e >= s) {
    return Math.max(1, Math.round((e - s) / DAY_MS));
  }
  const hours = t.estimatedHours != null ? Number(t.estimatedHours) : NaN;
  if (!Number.isNaN(hours) && hours > 0) return Math.max(1, hours / 8);
  return 1;
}

/**
 * Build the in-project predecessor graph for the CPM functions below.
 * Dangling predecessor ids (deleted / cross-project) are dropped so they
 * can't distort the schedule. Returns the live task map + cleaned preds.
 */
async function loadGraph(projectId: number): Promise<{
  raw: RawTask[];
  preds: Map<number, number[]>;
}> {
  const rows = (await db
    .select({
      id: tasksTable.id,
      name: tasksTable.name,
      milestoneId: tasksTable.milestoneId,
      startDate: tasksTable.startDate,
      endDate: tasksTable.endDate,
      estimatedHours: tasksTable.estimatedHours,
      predecessorIds: tasksTable.predecessorIds,
    })
    .from(tasksTable)
    .where(eq(tasksTable.projectId, projectId))) as RawTask[];

  const ids = new Set(rows.map((r) => r.id));
  const preds = new Map<number, number[]>();
  for (const r of rows) {
    // keep only in-project, non-self predecessors that still exist
    preds.set(r.id, parseIds(r.predecessorIds).filter((p) => p !== r.id && ids.has(p)));
  }
  return { raw: rows, preds };
}

/** Kahn topological order. Returns null + the offending nodes if cyclic. */
function topoOrder(
  nodes: number[],
  preds: Map<number, number[]>,
): { order: number[] | null; cycle: number[] | null } {
  const indeg = new Map<number, number>();
  const succ = new Map<number, number[]>();
  for (const n of nodes) {
    indeg.set(n, 0);
    succ.set(n, []);
  }
  for (const n of nodes) {
    for (const p of preds.get(n) ?? []) {
      // edge p → n
      indeg.set(n, (indeg.get(n) ?? 0) + 1);
      succ.get(p)!.push(n);
    }
  }
  const queue = nodes.filter((n) => (indeg.get(n) ?? 0) === 0);
  const order: number[] = [];
  while (queue.length) {
    const n = queue.shift()!;
    order.push(n);
    for (const m of succ.get(n) ?? []) {
      indeg.set(m, (indeg.get(m) ?? 0) - 1);
      if ((indeg.get(m) ?? 0) === 0) queue.push(m);
    }
  }
  if (order.length === nodes.length) return { order, cycle: null };
  // Remaining nodes (indeg>0) are involved in or downstream of a cycle.
  const cycle = nodes.filter((n) => !order.includes(n));
  return { order: null, cycle };
}

/**
 * Compute the full task-level CPM schedule for a project. Pure read — never
 * writes. Cyclic graphs short-circuit with hasCycle=true and no schedule.
 */
export async function computeTaskCpm(projectId: number): Promise<CpmResult> {
  const { raw, preds } = await loadGraph(projectId);
  const nodes = raw.map((r) => r.id);
  const byId = new Map(raw.map((r) => [r.id, r]));

  if (nodes.length === 0) {
    return { hasCycle: false, cycle: null, projectDurationDays: 0, tasks: [], criticalTaskIds: [] };
  }

  const { order, cycle } = topoOrder(nodes, preds);
  if (!order) {
    return { hasCycle: true, cycle, projectDurationDays: 0, tasks: [], criticalTaskIds: [] };
  }

  // A critical path is only meaningful when there is an actual dependency
  // network. With zero edges, every task is an independent one-node "path" and
  // the CPM slack collapses to 0 for all of them (especially when durations are
  // equal — e.g. tasks with no dates/estimates all fall back to 1 day), which
  // would mark EVERY task critical and paint the whole Gantt red. Treat a
  // dependency-free project as having no critical path so bars colour by status.
  const edgeCount = nodes.reduce((sum, n) => sum + (preds.get(n)?.length ?? 0), 0);
  const hasNetwork = edgeCount > 0;

  const dur = new Map<number, number>(raw.map((r) => [r.id, durationFor(r)]));
  const es = new Map<number, number>();
  const ef = new Map<number, number>();

  // Forward pass (topo order): ES = max(EF of preds); EF = ES + duration.
  for (const n of order) {
    const ps = preds.get(n) ?? [];
    const start = ps.length ? Math.max(...ps.map((p) => ef.get(p) ?? 0)) : 0;
    es.set(n, start);
    ef.set(n, start + (dur.get(n) ?? 1));
  }

  const projectDuration = Math.max(0, ...nodes.map((n) => ef.get(n) ?? 0));

  // Successors map for the backward pass.
  const succ = new Map<number, number[]>(nodes.map((n) => [n, []]));
  for (const n of nodes) for (const p of preds.get(n) ?? []) succ.get(p)!.push(n);

  const lf = new Map<number, number>();
  const ls = new Map<number, number>();
  // Backward pass (reverse topo): LF = min(LS of successors), project end if none.
  for (const n of [...order].reverse()) {
    const ss = succ.get(n) ?? [];
    const finish = ss.length ? Math.min(...ss.map((s) => ls.get(s) ?? projectDuration)) : projectDuration;
    lf.set(n, finish);
    ls.set(n, finish - (dur.get(n) ?? 1));
  }

  const tasks: CpmTask[] = raw.map((r) => {
    const slack = (ls.get(r.id) ?? 0) - (es.get(r.id) ?? 0);
    return {
      id: r.id,
      name: r.name,
      milestoneId: r.milestoneId,
      durationDays: dur.get(r.id) ?? 1,
      earliestStart: es.get(r.id) ?? 0,
      earliestFinish: ef.get(r.id) ?? 0,
      latestStart: ls.get(r.id) ?? 0,
      latestFinish: lf.get(r.id) ?? 0,
      slackDays: Math.round(slack * 1000) / 1000,
      isCritical: hasNetwork && Math.abs(slack) <= EPS,
      predecessorIds: preds.get(r.id) ?? [],
    };
  });

  const criticalTaskIds = tasks.filter((t) => t.isCritical).map((t) => t.id);
  return { hasCycle: false, cycle: null, projectDurationDays: projectDuration, tasks, criticalTaskIds };
}

/**
 * Would adding `predecessorId` as a predecessor of `taskId` create a cycle?
 * True iff `taskId` is already a (transitive) predecessor of `predecessorId`
 * — i.e. predecessorId already (eventually) depends on taskId, so making it a
 * prerequisite of taskId would close a loop. Self-edges are always rejected.
 */
export async function wouldCreateDependencyCycle(
  projectId: number,
  taskId: number,
  predecessorId: number,
): Promise<boolean> {
  if (taskId === predecessorId) return true;
  const { preds } = await loadGraph(projectId);
  // Walk the predecessor-closure of predecessorId; if we reach taskId → cycle.
  const seen = new Set<number>();
  const stack = [...(preds.get(predecessorId) ?? [])];
  while (stack.length) {
    const n = stack.pop()!;
    if (n === taskId) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    for (const p of preds.get(n) ?? []) stack.push(p);
  }
  return false;
}
