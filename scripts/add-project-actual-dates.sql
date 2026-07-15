-- ============================================================================
-- Add actual_start_date + actual_end_date to pmo_projects.
--
-- The table only carried the PLANNED schedule (start_date / end_date). These
-- two record when the project really started and finished, so the projects
-- table can show planned vs actual side by side (the same planned/actual pair
-- pmo_tasks and pmo_milestones already carry as actual_start / actual_end).
--
-- Apply with:
--   cd apps/pmo
--   psql "$DATABASE_URL" -f scripts/add-project-actual-dates.sql
--
-- Idempotent: ADD COLUMN uses IF NOT EXISTS, re-running is a no-op.
-- ============================================================================

ALTER TABLE pmo_projects ADD COLUMN IF NOT EXISTS actual_start_date TEXT;
ALTER TABLE pmo_projects ADD COLUMN IF NOT EXISTS actual_end_date TEXT;
