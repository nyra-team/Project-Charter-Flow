-- ============================================================================
-- Add teams_channel_email to pmo_projects.
--
-- Email address of the project's Microsoft Teams channel (Channel → ⋯ →
-- Get email address). Project alerts (task added/closed, effort overruns,
-- escalations) are mirrored there via plain SMTP. NULL = no Teams mirror.
--
-- Apply with:
--   cd apps/pmo
--   psql "$DATABASE_URL" -f scripts/add-project-teams-channel-email.sql
--
-- Idempotent: ADD COLUMN uses IF NOT EXISTS, re-running is a no-op.
-- ============================================================================

ALTER TABLE pmo_projects ADD COLUMN IF NOT EXISTS teams_channel_email TEXT;
