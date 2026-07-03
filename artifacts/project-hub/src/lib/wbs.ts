// Project-local task numbering (WBS style). The DB id is a global primary key,
// so showing it as a code (TSK-0042, TSK-0517…) looks random within one project.
// Instead number top-level tasks 1, 2, 3… per project (creation order) and give
// each subtask its parent's number + a child index — so a subtask carries its
// parent task's identity: task 2 → subtasks 2.1, 2.2, 2.3.
//
// demo() at the bottom is the runnable self-check.
type WbsTask = { id: number; parentTaskId?: number | null };

export function buildWbsCodes(tasks: WbsTask[]): Map<number, string> {
  const m = new Map<number, string>();
  const tops = tasks.filter((t) => t.parentTaskId == null).sort((a, b) => a.id - b.id);
  tops.forEach((t, i) => {
    const top = `${i + 1}`;
    m.set(t.id, top);
    tasks
      .filter((s) => s.parentTaskId === t.id)
      .sort((a, b) => a.id - b.id)
      .forEach((s, j) => m.set(s.id, `${top}.${j + 1}`));
  });
  return m;
}

// Display label. Falls back to the raw id for anything not in the map (e.g. a
// cross-project linked task that isn't in this project's list).
export const wbsLabel = (codes: Map<number, string>, id: number): string => `T${codes.get(id) ?? id}`;

export function demo(): void {
  const codes = buildWbsCodes([
    { id: 517, parentTaskId: null },
    { id: 42, parentTaskId: null },
    { id: 99, parentTaskId: 42 },
    { id: 60, parentTaskId: 42 },
  ]);
  // 42 is the lower id → task 1; its subtasks number under it by id order.
  console.assert(wbsLabel(codes, 42) === "T1", "parent ordered by id");
  console.assert(wbsLabel(codes, 517) === "T2", "second parent");
  console.assert(wbsLabel(codes, 60) === "T1.1", "subtask carries parent number");
  console.assert(wbsLabel(codes, 99) === "T1.2", "second subtask");
  console.assert(wbsLabel(codes, 7) === "T7", "unknown id falls back to raw id");
}
