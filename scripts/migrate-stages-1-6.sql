-- ============================================================================
-- Stages 1–6 schema migration — runs around the drizzle-kit 0.31.9
-- introspection bug that surfaces as `Unexpected end of JSON input` while
-- "Pulling schema from database…".
--
-- Apply with:
--   cd apps/pmo
--   set -a; source .env; set +a
--   psql "$DATABASE_URL" -f scripts/migrate-stages-1-6.sql
--
-- The file is idempotent — every CREATE uses IF NOT EXISTS and every ALTER
-- uses ADD COLUMN IF NOT EXISTS, so re-running is a no-op once applied.
-- Wrapped in a single transaction so a failure mid-file rolls back cleanly
-- and doesn't leave the DB half-migrated.
--
-- This mirrors exactly what drizzle-kit push WOULD have generated from the
-- 7 new schema files + 5 new columns on pmo_meetings, but bypasses the
-- introspection step that's tripping the json parser.
-- ============================================================================

BEGIN;

-- ─── Stage 1 — Templates ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pmo_project_templates (
  id                  SERIAL PRIMARY KEY,
  name                TEXT NOT NULL,
  description         TEXT DEFAULT '',
  category            TEXT NOT NULL DEFAULT 'general',
  source_project_id   INTEGER,
  created_by_id       INTEGER,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pmo_template_tasks (
  id                      SERIAL PRIMARY KEY,
  template_id             INTEGER NOT NULL,
  parent_task_id          INTEGER,
  name                    TEXT NOT NULL,
  description             TEXT DEFAULT '',
  default_duration_days   INTEGER NOT NULL DEFAULT 1,
  default_day_offset      INTEGER NOT NULL DEFAULT 0,
  default_priority        TEXT NOT NULL DEFAULT 'P2',
  default_owner_role      TEXT,
  default_effort_hours    NUMERIC(8,2),
  predecessor_offsets     JSONB NOT NULL DEFAULT '[]'::jsonb,
  sort_order              INTEGER NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pmo_template_milestones (
  id                    SERIAL PRIMARY KEY,
  template_id           INTEGER NOT NULL,
  name                  TEXT NOT NULL,
  description           TEXT DEFAULT '',
  default_day_offset    INTEGER NOT NULL DEFAULT 0,
  gate_decision         TEXT,
  readiness_checklist   JSONB NOT NULL DEFAULT '[]'::jsonb,
  sort_order            INTEGER NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Stage 2 — PIF ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pmo_pifs (
  id                          SERIAL PRIMARY KEY,
  title                       TEXT NOT NULL,
  business_problem            TEXT NOT NULL,
  proposed_solution           TEXT NOT NULL,
  sponsor_id                  INTEGER,
  hod_id                      INTEGER,
  target_outcomes             JSONB NOT NULL DEFAULT '[]'::jsonb,
  success_metrics             JSONB NOT NULL DEFAULT '[]'::jsonb,
  dependencies                JSONB NOT NULL DEFAULT '[]'::jsonb,
  top_risks                   JSONB NOT NULL DEFAULT '[]'::jsonb,
  estimated_capex             NUMERIC(15,2),
  estimated_opex              NUMERIC(15,2),
  estimated_duration_days     INTEGER,
  classification              TEXT NOT NULL DEFAULT 'standard',
  urgency                     TEXT NOT NULL DEFAULT 'normal',
  status                      TEXT NOT NULL DEFAULT 'draft',
  decided_at                  TIMESTAMPTZ,
  decided_by_id               INTEGER,
  decision_note               TEXT,
  converted_project_id        INTEGER,
  converted_at                TIMESTAMPTZ,
  created_by_id               INTEGER,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Stage 3 — Customization (saved views) ─────────────────────────────────

CREATE TABLE IF NOT EXISTS pmo_user_preferences (
  id                  SERIAL PRIMARY KEY,
  user_id             TEXT NOT NULL,
  scope               TEXT NOT NULL,
  key                 TEXT NOT NULL,
  config              JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_default          BOOLEAN NOT NULL DEFAULT FALSE,
  shared_with_role    TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pmo_user_preferences_user_scope_key_uniq UNIQUE (user_id, scope, key)
);

-- ─── Stage 4 — Nudges ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pmo_nudges (
  id                    SERIAL PRIMARY KEY,
  user_id               INTEGER NOT NULL,
  kind                  TEXT NOT NULL,
  urgency               TEXT NOT NULL DEFAULT 'normal',
  headline              TEXT NOT NULL,
  body                  TEXT,
  link                  TEXT,
  source_entity_type    TEXT,
  source_entity_id      INTEGER,
  llm_model             TEXT,
  llm_input_hash        TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'active',
  dismissed_at          TIMESTAMPTZ,
  acted_on_at           TIMESTAMPTZ,
  expired_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pmo_nudges_user_hash_uniq UNIQUE (user_id, llm_input_hash)
);

-- ─── Stage 5 — SAP PR / PO ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pmo_purchase_requisitions (
  id                  SERIAL PRIMARY KEY,
  project_id          INTEGER,
  charter_id          INTEGER,
  requested_by_id     TEXT,
  vendor_id           INTEGER,
  sap_pr_number       TEXT UNIQUE,
  line_items          JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_amount        NUMERIC(15,2) NOT NULL DEFAULT 0,
  currency            TEXT NOT NULL DEFAULT 'INR',
  status              TEXT NOT NULL DEFAULT 'draft',
  sap_status          TEXT,
  last_synced_at      TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pmo_purchase_orders (
  id                  SERIAL PRIMARY KEY,
  pr_id               INTEGER,
  vendor_id           INTEGER,
  sap_po_number       TEXT UNIQUE,
  line_items          JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_amount        NUMERIC(15,2) NOT NULL DEFAULT 0,
  currency            TEXT NOT NULL DEFAULT 'INR',
  status              TEXT NOT NULL DEFAULT 'open',
  sap_status          TEXT,
  delivery_date       TEXT,
  last_synced_at      TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Stage 6 — Teams MoM (extends pmo_meetings) ─────────────────────────────

ALTER TABLE pmo_meetings
  ADD COLUMN IF NOT EXISTS teams_meeting_id          TEXT,
  ADD COLUMN IF NOT EXISTS teams_transcript_raw      TEXT,
  ADD COLUMN IF NOT EXISTS teams_synced_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mom_posted_to_channel_id  TEXT,
  ADD COLUMN IF NOT EXISTS mom_posted_at             TIMESTAMPTZ;

-- ─── Sanity report ──────────────────────────────────────────────────────────
-- Lists the new tables so the migrator can eyeball success without scrolling.

\echo ''
\echo 'New tables present in DB:'
SELECT relname FROM pg_class
 WHERE relnamespace = 'public'::regnamespace
   AND relkind = 'r'
   AND relname IN (
     'pmo_project_templates',
     'pmo_template_tasks',
     'pmo_template_milestones',
     'pmo_pifs',
     'pmo_user_preferences',
     'pmo_nudges',
     'pmo_purchase_requisitions',
     'pmo_purchase_orders'
   )
 ORDER BY relname;

\echo ''
\echo 'New columns on pmo_meetings:'
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'pmo_meetings'
   AND column_name IN (
     'teams_meeting_id',
     'teams_transcript_raw',
     'teams_synced_at',
     'mom_posted_to_channel_id',
     'mom_posted_at'
   )
 ORDER BY column_name;

COMMIT;
