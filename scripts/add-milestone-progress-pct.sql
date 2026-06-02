-- ============================================================================
-- Add derived progress_pct to pmo_milestones + one-time backfill.
--
-- Part of the Monday.com-style transformation: completes the rollup chain
--   Subtask -> Task -> Milestone -> Project -> Portfolio
-- so milestone completion is the average of its top-level tasks' progress
-- (which already roll up from subtasks). The api-server recomputeRollups()
-- (lib/rollup.ts) keeps this column current on every task/milestone mutation;
-- this script just adds the column and seeds existing rows so the UI shows
-- correct numbers immediately, before any further edits.
--
-- Apply with (DATABASE_URL = the Recruit/PMO Supabase session-pooler URL):
--   cd apps/pmo
--   psql "$DATABASE_URL" -f scripts/add-milestone-progress-pct.sql
--
-- Idempotent:
--   - ADD COLUMN uses IF NOT EXISTS
--   - The backfill is a plain recompute from current data; safe to re-run.
--
-- NOTE: shares the Recruit DB. This is a manual, additive ALTER on purpose —
-- do NOT run `drizzle-kit push`, which would diff/alter unrelated pmo_* tables.
-- ============================================================================

BEGIN;

ALTER TABLE pmo_milestones
  ADD COLUMN IF NOT EXISTS progress_pct INTEGER NOT NULL DEFAULT 0;

-- Backfill: milestone progress = round(avg of its TOP-LEVEL tasks' progress_pct).
-- Top-level = parent_task_id IS NULL (subtasks already rolled into their parent's
-- progress_pct by the existing task-update logic, so averaging top-level tasks is
-- the correct one-time seed). Milestones with no top-level tasks stay at 0.
UPDATE pmo_milestones m
   SET progress_pct = sub.avg_pct
  FROM (
    SELECT milestone_id, ROUND(AVG(progress_pct))::INT AS avg_pct
      FROM pmo_tasks
     WHERE milestone_id IS NOT NULL
       AND parent_task_id IS NULL
     GROUP BY milestone_id
  ) sub
 WHERE m.id = sub.milestone_id
   AND m.progress_pct IS DISTINCT FROM sub.avg_pct;

-- Project progress = round(avg of its milestones' progress_pct), counting only
-- milestones that contain at least one top-level task (so empty gate milestones
-- don't drag the denominator). Mirrors recomputeRollups() exactly.
UPDATE pmo_projects p
   SET progress = sub.avg_pct
  FROM (
    SELECT m.project_id, ROUND(AVG(m.progress_pct))::INT AS avg_pct
      FROM pmo_milestones m
     WHERE EXISTS (
       SELECT 1 FROM pmo_tasks t
        WHERE t.milestone_id = m.id AND t.parent_task_id IS NULL
     )
     GROUP BY m.project_id
  ) sub
 WHERE p.id = sub.project_id
   AND p.progress IS DISTINCT FROM sub.avg_pct;

\echo ''
\echo 'Milestones now carrying a non-zero progress_pct:'
SELECT COUNT(*) AS with_progress FROM pmo_milestones WHERE progress_pct > 0;
\echo 'Projects whose progress was seeded from milestone rollup:'
SELECT COUNT(*) AS rolled_projects FROM pmo_projects WHERE progress > 0;

COMMIT;
