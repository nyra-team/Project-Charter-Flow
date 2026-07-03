// A subtask's due date can run past its parent task's end. When it does, the
// parent must stretch to cover it — a plan shouldn't show a child ending after
// its parent. Returns the parent's new end date to patch, or null when the
// parent already covers the child (or there's nothing to compare).
// Dates are ISO strings ("YYYY-MM-DD…"); compared on the date portion only.
export function parentEndToExtend(
  parentEnd: string | null | undefined,
  childEnd: string | null | undefined,
): string | null {
  if (!childEnd) return null;
  const child = childEnd.slice(0, 10);
  if (parentEnd && parentEnd.slice(0, 10) >= child) return null;
  return childEnd;
}
