-- ============================================================================
-- Add pmo_mcp_integrations table.
--
-- This table was added to the Drizzle schema after the original Stages 1-6
-- batch migration (migrate-stages-1-6.sql) and never got pushed to the DB,
-- so the new /admin/integrations page errors with "Failed query …
-- pmo_mcp_integrations" on first load.
--
-- Apply with:
--   cd apps/pmo
--   set -a; source .env; set +a
--   psql "$DATABASE_URL" --file=scripts/add-mcp-integrations-table.sql
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, re-running is a no-op.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS pmo_mcp_integrations (
  id              SERIAL PRIMARY KEY,
  kind            TEXT NOT NULL,
  name            TEXT NOT NULL,
  config          JSONB NOT NULL DEFAULT '{}'::jsonb,
  secret_keys     TEXT[] NOT NULL DEFAULT '{}',
  enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_id   INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

\echo ''
\echo 'Table state:'
SELECT relname FROM pg_class
 WHERE relnamespace = 'public'::regnamespace
   AND relkind = 'r'
   AND relname = 'pmo_mcp_integrations';

COMMIT;
