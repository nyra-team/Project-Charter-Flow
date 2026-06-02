-- ============================================================================
-- Distribute milestone start_date + due_date across each project's planned
-- window so the Gantt renders bars instead of empty rows.
--
-- Apply with:
--   cd apps/pmo
--   set -a; source .env; set +a
--   psql "$DATABASE_URL" --file=scripts/distribute-milestone-dates.sql
--
-- Logic per project:
--   slice = project.end_date − project.start_date  ÷  milestone_count
--   milestone N (0-indexed by order, then id) gets:
--       start_date = project.start +  N      × slice
--       due_date   = project.start + (N+1)   × slice − 1
--
-- Idempotent + lossless:
--   - Only touches milestones where start_date OR due_date is NULL.
--   - COALESCE preserves any pre-existing dates (so ESG Portal's 17
--     authentic dates are untouched).
--   - Projects without start/end bounds are skipped (no synthetic dates
--     would be meaningful).
--
-- Re-running is safe; only NULL slots get filled.
-- ============================================================================

BEGIN;

-- Smarter bounds derivation that handles every project case:
--   - normal (start < end)            → use as-is
--   - inverted (start > end, typo)    → LEAST/GREATEST auto-swap
--   - one bound null                  → use the non-null + synth 180 days
--   - both bounds null                → CURRENT_DATE + 180 days
-- A minimum 180-day window is enforced so each milestone gets ≥ 1 day even
-- in short / collapsed-span projects.
WITH project_bounds AS (
  SELECT p.id,
         COALESCE(
           LEAST(p.start_date::date, p.end_date::date),
           p.start_date::date,
           p.end_date::date,
           CURRENT_DATE
         ) AS proj_start,
         GREATEST(
           COALESCE(
             GREATEST(p.start_date::date, p.end_date::date)
               - LEAST(p.start_date::date, p.end_date::date),
             0
           ),
           180
         ) AS total_days,
         (SELECT COUNT(*) FROM pmo_milestones WHERE project_id = p.id) AS milestone_count
    FROM pmo_projects p
   WHERE EXISTS (
           SELECT 1 FROM pmo_milestones m
            WHERE m.project_id = p.id
              AND (m.start_date IS NULL OR m.due_date IS NULL)
         )
),
indexed AS (
  SELECT m.id AS milestone_id,
         m.start_date AS existing_start,
         m.due_date   AS existing_due,
         pb.proj_start,
         pb.total_days,
         pb.milestone_count,
         ROW_NUMBER() OVER (PARTITION BY m.project_id ORDER BY m."order", m.id) - 1 AS idx
    FROM pmo_milestones m
    JOIN project_bounds pb ON pb.id = m.project_id
   WHERE (m.start_date IS NULL OR m.due_date IS NULL)
     AND pb.milestone_count > 0
)
UPDATE pmo_milestones
   SET start_date = COALESCE(
         indexed.existing_start,
         (indexed.proj_start
            + ((indexed.idx       * indexed.total_days / indexed.milestone_count))::int)::text
       ),
       due_date   = COALESCE(
         indexed.existing_due,
         (indexed.proj_start
            + (((indexed.idx + 1) * indexed.total_days / indexed.milestone_count - 1))::int)::text
       )
  FROM indexed
 WHERE pmo_milestones.id = indexed.milestone_id;

-- ─── Sanity report ─────────────────────────────────────────────────────────
\echo ''
\echo 'After distribution:'
SELECT
    COUNT(*)                                                                AS total_milestones,
    COUNT(*) FILTER (WHERE start_date IS NOT NULL AND due_date IS NOT NULL) AS with_both_dates,
    COUNT(*) FILTER (WHERE start_date IS NULL OR due_date IS NULL)          AS still_missing
  FROM pmo_milestones;

\echo ''
\echo 'Projects whose milestones are still missing dates (no project bounds):'
SELECT p.id, p.name,
       (SELECT COUNT(*) FROM pmo_milestones m
         WHERE m.project_id = p.id
           AND (m.start_date IS NULL OR m.due_date IS NULL)) AS unbounded_milestones
  FROM pmo_projects p
 WHERE EXISTS (SELECT 1 FROM pmo_milestones m
                WHERE m.project_id = p.id
                  AND (m.start_date IS NULL OR m.due_date IS NULL))
 ORDER BY p.id;

COMMIT;
