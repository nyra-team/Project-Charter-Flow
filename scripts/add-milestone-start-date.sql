-- ============================================================================
-- Add start_date to pmo_milestones + backfill from description text.
--
-- Apply with:
--   cd apps/pmo
--   psql "$DATABASE_URL" -f scripts/add-milestone-start-date.sql
--
-- Idempotent:
--   - ADD COLUMN uses IF NOT EXISTS
--   - UPDATE only touches rows where start_date IS NULL, so re-running
--     does nothing once it's been applied.
--
-- Source of the backfill: every existing milestone description authored by
-- the import seeds (import-esg-portal.ts and the Central Tracker generator)
-- contains a "Start: YYYY-MM-DD" line. The regex captures the date and
-- promotes it to a first-class column so the Gantt can read it directly
-- without parsing text on every render.
-- ============================================================================

BEGIN;

ALTER TABLE pmo_milestones ADD COLUMN IF NOT EXISTS start_date TEXT;

UPDATE pmo_milestones
   SET start_date = substring(description from 'Start:\s*(\d{4}-\d{2}-\d{2})')
 WHERE start_date IS NULL
   AND description ~ 'Start:\s*\d{4}-\d{2}-\d{2}';

-- Sanity report: how many rows ended up with a start_date.
\echo ''
\echo 'Milestones now carrying start_date:'
SELECT COUNT(*) AS with_start_date FROM pmo_milestones WHERE start_date IS NOT NULL;
\echo 'Milestones still NULL (no Start: line in description — either by design or pre-import data):'
SELECT COUNT(*) AS without_start_date FROM pmo_milestones WHERE start_date IS NULL;

COMMIT;
