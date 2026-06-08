-- ============================================================================
-- Two-way sync: CXO Action Center ⇄ PMO MOM — PMO-side schema.
--
-- Apply with:
--   cd apps/pmo
--   psql "$DATABASE_URL" -f scripts/add-cxo-sync-link.sql
--
-- Adds (all idempotent — IF NOT EXISTS):
--   1. pmo_meeting_items.exec_action_item_id  → exec_action_items.id (cross-link)
--   2. pmo_meetings.is_cxo_container          → flags the synthetic per-project
--                                               "CXO Action Center" meeting
--   3. helper index on the cross-link
--   4. PARTIAL UNIQUE index: at most one CXO container meeting per project
--      (makes the find-or-create in the sync helpers race-safe via ON CONFLICT)
--
-- The matching CXO-side column (exec_action_items.pmo_meeting_item_id) is added
-- by apps/cxo/server/migrations/addPmoSyncLink.ts. Both columns are nullable
-- with NO hard FK so the two mirror rows stay independently deletable.
-- ============================================================================

BEGIN;

ALTER TABLE pmo_meeting_items
  ADD COLUMN IF NOT EXISTS exec_action_item_id integer;

ALTER TABLE pmo_meetings
  ADD COLUMN IF NOT EXISTS is_cxo_container boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS pmo_meeting_items_exec_link_idx
  ON pmo_meeting_items (exec_action_item_id);

-- One "CXO Action Center" container meeting per project. The partial predicate
-- is what the sync helper's `ON CONFLICT (project_id) WHERE is_cxo_container`
-- targets.
CREATE UNIQUE INDEX IF NOT EXISTS pmo_meetings_one_cxo_container_per_project
  ON pmo_meetings (project_id) WHERE is_cxo_container;

\echo ''
\echo 'CXO sync columns present:'
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name='pmo_meeting_items' AND column_name='exec_action_item_id') AS has_exec_link,
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name='pmo_meetings' AND column_name='is_cxo_container') AS has_container_flag;

COMMIT;
