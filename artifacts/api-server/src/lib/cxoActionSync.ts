/**
 * cxoActionSync — PMO MOM → CXO Action Center mirror (the PMO → CXO half of the
 * two-way sync). The CXO → PMO half lives in the CXO app at
 * apps/cxo/server/pmoMomSync.ts. Both apps share ONE Supabase DB, so this writes
 * the CXO table (`exec_action_items`) directly via the raw `pool` — that table
 * is NOT in the drizzle schema, so we use plain SQL. Writing the table directly
 * (never via CXO's HTTP API) means CXO's handlers don't re-fire → no echo loop.
 *
 * Contract:
 *  - A `pmo_meeting_items` row mirrors into CXO only when its parent meeting has
 *    a non-null project_id AND the meeting is NOT itself the synthetic CXO
 *    container (those items originated in CXO — mirroring them back would loop).
 *  - pmo_meeting_items.exec_action_item_id ←→ exec_action_items.pmo_meeting_item_id
 *    is the cross-link. Upserts dedupe by the CXO row's pmo_meeting_item_id
 *    back-ref so a lost link write self-heals instead of duplicating.
 *  - CXO mirror rows are inserted approval_status='approved' (skip the draft
 *    gate so they show immediately), source='pmo_mom', source_meeting=<title>.
 *  - Everything is BEST-EFFORT and NEVER throws to the caller.
 */
import { pool } from "@workspace/db";

export type MomItemForSync = {
  id: number;
  description: string;
  status: string;                 // open | in_progress | completed | deferred
  category?: string | null;       // action_item | decision | information
  assignedToUserId?: number | null;
  dueDate?: string | null;        // free text; only mirrored when YYYY-MM-DD
  percentComplete?: number | null;
  execActionItemId?: number | null;
};

export type MeetingForSync = {
  id: number;
  title: string;
  projectId: number | null;
  isCxoContainer?: boolean | null;
};

const STATUS_TO_CXO: Record<string, string> = {
  open: "not_started",
  in_progress: "in_process",
  completed: "completed",
  deferred: "on_hold",
};
const CATEGORY_TO_CXO: Record<string, string> = {
  action_item: "action",
  decision: "decision",
  information: "information",
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** PMO `description` → CXO title + description (split on the first blank line). */
function splitDescription(desc: string): { title: string; body: string | null } {
  const text = String(desc ?? "").trim();
  const idx = text.indexOf("\n\n");
  if (idx === -1) return { title: text, body: null };
  return { title: text.slice(0, idx).trim(), body: text.slice(idx + 2).trim() || null };
}

/** CXO due_date is a real DATE column — only pass a clean YYYY-MM-DD through. */
function safeDate(due?: string | null): string | null {
  const s = String(due ?? "").trim();
  return ISO_DATE.test(s) ? s : null;
}

/** Should this MOM item be mirrored to CXO at all? */
export function shouldMirror(meeting: MeetingForSync | null | undefined): boolean {
  return !!meeting && meeting.projectId != null && !meeting.isCxoContainer;
}

/**
 * Upsert the CXO mirror for a MOM item. Re-links/creates as needed; idempotent
 * (dedupes by the CXO row's pmo_meeting_item_id back-ref). Best-effort.
 * Pass `meeting` so project_id + title are available (the item row lacks them).
 */
export async function syncMomItemToCxo(
  item: MomItemForSync,
  meeting: MeetingForSync
): Promise<void> {
  if (!item?.id || !shouldMirror(meeting)) return;
  try {
    const { title, body } = splitDescription(item.description);
    const status = STATUS_TO_CXO[item.status] ?? "not_started";
    const type = CATEGORY_TO_CXO[item.category ?? "action_item"] ?? "action";
    const due = safeDate(item.dueDate);
    const assignee = item.assignedToUserId ?? null;
    const pct =
      item.percentComplete != null
        ? item.percentComplete
        : status === "completed"
        ? 100
        : null;

    // Find an existing CXO mirror via its back-ref (self-healing even if a
    // prior link write to pmo_meeting_items was lost).
    const existing = await pool.query<{ id: number }>(
      `SELECT id FROM exec_action_items WHERE pmo_meeting_item_id = $1 LIMIT 1`,
      [item.id]
    );
    const cxoId: number | null = existing.rows[0]?.id ?? null;

    if (cxoId != null) {
      await pool.query(
        `UPDATE exec_action_items
            SET title = $2, description = $3, status = $4, item_type = $5,
                assignee_id = $6, project_id = $7, due_date = $8,
                targeted_date_raw = $8, progress_pct = $9,
                source = 'pmo_mom', source_meeting = $10,
                completed_at = CASE WHEN $4 = 'completed' THEN now() ELSE NULL END,
                updated_at = now()
          WHERE id = $1`,
        [cxoId, title, body, status, type, assignee, meeting.projectId, due, pct, meeting.title]
      );
      // Make sure the PMO row points back at this CXO row.
      await pool.query(
        `UPDATE pmo_meeting_items SET exec_action_item_id = $2
           WHERE id = $1 AND exec_action_item_id IS DISTINCT FROM $2`,
        [item.id, cxoId]
      );
      return;
    }

    // No mirror yet → insert an approved CXO item and link it both ways.
    const created = await pool.query<{ id: number }>(
      `INSERT INTO exec_action_items
         (title, description, status, item_type, assignee_id, project_id,
          due_date, targeted_date_raw, progress_pct, source, source_type,
          source_meeting, approval_status, pmo_meeting_item_id, completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8,'pmo_mom','project',$9,'approved',$10,
               CASE WHEN $3 = 'completed' THEN now() ELSE NULL END)
       RETURNING id`,
      [title, body, status, type, assignee, meeting.projectId, due, pct, meeting.title, item.id]
    );
    const newCxoId = created.rows[0]?.id;
    if (newCxoId != null) {
      await pool.query(
        `UPDATE pmo_meeting_items SET exec_action_item_id = $2 WHERE id = $1`,
        [item.id, newCxoId]
      );
    }
  } catch (e) {
    console.error("cxoActionSync.syncMomItemToCxo failed:", (e as Error).message);
  }
}

/** Remove the CXO mirror for a deleted/unlinked MOM item. Best-effort. */
export async function deleteCxoMirror(execActionItemId: number | null | undefined): Promise<void> {
  if (execActionItemId == null) return;
  try {
    await pool.query(`DELETE FROM exec_action_items WHERE id = $1`, [execActionItemId]);
  } catch (e) {
    console.error("cxoActionSync.deleteCxoMirror failed:", (e as Error).message);
  }
}
