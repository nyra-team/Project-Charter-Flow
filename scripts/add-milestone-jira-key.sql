-- ============================================================================
-- Add Jira sync columns to pmo_milestones.
--
-- The Jira ⇄ PMO import now routes Jira *Epics* into pmo_milestones (and their
-- child stories/sub-tasks into pmo_tasks nested under the epic-milestone), so
-- epics render as milestone bars/diamonds on the timeline instead of a flat
-- task list. These columns mirror the jira_key / jira_synced_at pair already on
-- pmo_tasks and pmo_projects, making epic re-imports idempotent (upsert by key).
--
-- Apply with (DATABASE_URL = the Recruit/PMO Supabase session-pooler URL):
--   cd apps/pmo
--   psql "$DATABASE_URL" -f scripts/add-milestone-jira-key.sql
--
-- Idempotent: both ADD COLUMNs use IF NOT EXISTS.
--
-- NOTE: shares the Recruit DB. This is a manual, additive ALTER on purpose —
-- do NOT run `drizzle-kit push`, which would diff/alter unrelated pmo_* tables.
-- ============================================================================

BEGIN;

ALTER TABLE pmo_milestones
  ADD COLUMN IF NOT EXISTS jira_key TEXT,
  ADD COLUMN IF NOT EXISTS jira_synced_at TIMESTAMPTZ;

-- Optional helper index for the upsert-by-key lookup on re-import.
CREATE INDEX IF NOT EXISTS pmo_milestones_jira_key_idx
  ON pmo_milestones (jira_key)
  WHERE jira_key IS NOT NULL;

COMMIT;
