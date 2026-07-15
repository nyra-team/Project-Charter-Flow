-- ============================================================================
-- Add owner_id + dept to pmo_milestones.
--
-- A milestone had no accountability of its own — only its tasks carried an
-- assignee (tasks.assignee_id) and a department (tasks.cft_dept). The project
-- table view now shows Owner / Dept on the milestone row: it INHERITS the
-- project's owner + function for display until someone sets these, at which
-- point the milestone's own accountability takes over.
--
-- Both stay NULL for inherited milestones — "inherit" is the absence of a
-- value, not a copy of the project's, so re-assigning the project owner keeps
-- flowing through instead of leaving stale copies behind.
--
-- Apply with:
--   cd apps/pmo
--   psql "$DATABASE_URL" -f scripts/add-milestone-owner-dept.sql
--
-- Idempotent: ADD COLUMN uses IF NOT EXISTS, re-running is a no-op.
-- ============================================================================

ALTER TABLE pmo_milestones ADD COLUMN IF NOT EXISTS owner_id INTEGER;
ALTER TABLE pmo_milestones ADD COLUMN IF NOT EXISTS dept TEXT;
