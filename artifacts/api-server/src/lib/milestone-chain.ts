import { db, milestonesTable } from "@workspace/db";
import { asc, eq } from "drizzle-orm";

// Re-link a project's milestones into a finish-to-start chain in display order:
// each milestone's predecessor is the one before it (the first has none). This
// is what lets the Gantt draw M1→M2→M3 arrows. Idempotent — only writes rows
// whose predecessor actually changed. Call after milestones are created or
// reordered so the chain stays correct.
export async function chainProjectMilestones(projectId: number): Promise<void> {
  const rows = await db
    .select({ id: milestonesTable.id, predecessorId: milestonesTable.predecessorId })
    .from(milestonesTable)
    .where(eq(milestonesTable.projectId, projectId))
    .orderBy(asc(milestonesTable.order), asc(milestonesTable.createdAt), asc(milestonesTable.id));

  let prev: number | null = null;
  for (const m of rows) {
    if (m.predecessorId !== prev) {
      await db.update(milestonesTable).set({ predecessorId: prev }).where(eq(milestonesTable.id, m.id));
    }
    prev = m.id;
  }
}
