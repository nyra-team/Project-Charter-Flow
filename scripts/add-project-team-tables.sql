-- ============================================================================
-- Add Project Team Management tables.
--
--   pmo_project_team_members — unified roster of internal (employee, by user_id)
--     and external (vendor / partner / consultant / contractor, captured inline)
--     members, each with a free-text role + responsibilities. Replaces the
--     board's separate Owner / Manager columns with one "Team" surface.
--   pmo_project_team_raci    — full project-level RACI matrix (member x
--     deliverable -> R/A/S/C/I). Distinct from the per-task pmo_raci_matrix.
--
-- Apply with:
--   cd apps/pmo
--   set -a; source .env; set +a
--   psql "$DATABASE_URL" --file=scripts/add-project-team-tables.sql
--
-- Equivalent to `pnpm --filter @workspace/db push` (Drizzle is the source of
-- truth — see lib/db/src/schema/project_team.ts). Idempotent: re-running is a
-- no-op.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS pmo_project_team_members (
  id               SERIAL PRIMARY KEY,
  project_id       INTEGER NOT NULL,
  member_type      TEXT NOT NULL,
  user_id          INTEGER,
  external_name    TEXT,
  external_org     TEXT,
  external_email   TEXT,
  external_kind    TEXT,
  role             TEXT,
  responsibilities TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pmo_project_team_members_project
  ON pmo_project_team_members (project_id);

CREATE TABLE IF NOT EXISTS pmo_project_team_raci (
  id           SERIAL PRIMARY KEY,
  project_id   INTEGER NOT NULL,
  member_id    INTEGER NOT NULL,
  deliverable  TEXT NOT NULL,
  raci_type    TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pmo_project_team_raci_project
  ON pmo_project_team_raci (project_id);

\echo ''
\echo 'Table state:'
SELECT relname FROM pg_class
 WHERE relnamespace = 'public'::regnamespace
   AND relkind = 'r'
   AND relname IN ('pmo_project_team_members', 'pmo_project_team_raci')
 ORDER BY relname;

COMMIT;
