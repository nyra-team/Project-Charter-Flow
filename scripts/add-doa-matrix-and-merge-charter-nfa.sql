-- Step 1 of the consolidated Charter+NFA build.
--
-- Adds the columns needed to merge NFA fields + the MES Charter+NFA template
-- sections into pmo_charters, creates pmo_doa_matrix (Delegation Of Authority
-- bands), and seeds three placeholder bands. Idempotent — safe to re-run.
--
-- Apply via:
--   psql "$DATABASE_URL" -f apps/pmo/scripts/add-doa-matrix-and-merge-charter-nfa.sql
-- DO NOT use drizzle-kit push on the shared Recruit DB.

BEGIN;

-- =============================================================
-- 1. pmo_charters — new columns (narrative + investment + NFA fields)
-- =============================================================
ALTER TABLE pmo_charters
  ADD COLUMN IF NOT EXISTS executive_summary           text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS current_state               text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS business_drivers            text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS out_of_scope                text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS constraints                 text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS assumptions                 text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS potential_additional_budget text NOT NULL DEFAULT '',

  ADD COLUMN IF NOT EXISTS category                    text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS entity                      text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS revision                    integer NOT NULL DEFAULT 1,

  ADD COLUMN IF NOT EXISTS kind                        text NOT NULL DEFAULT 'capex',
  ADD COLUMN IF NOT EXISTS capex_amount                numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS opex_amount                 numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fy_recurring                jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS roi_per_annum               numeric(15,2),
  ADD COLUMN IF NOT EXISTS payback_months              integer,
  ADD COLUMN IF NOT EXISTS previous_nfa_amount         numeric(15,2),
  ADD COLUMN IF NOT EXISTS le_amount                   numeric(15,2),

  -- Absorbed NFA fields
  ADD COLUMN IF NOT EXISTS note_no                     text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS department                  text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS location                    text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS location_required           text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS note_date                   text,
  ADD COLUMN IF NOT EXISTS subject                     text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS background                  text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS requirement_items           jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS order_form_note             text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS total_usd                   text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS total_inr                   text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS recommendation              text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS signatories                 jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Roadmap / governance / attachments (jsonb to avoid four child tables)
  ADD COLUMN IF NOT EXISTS milestones                  jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS kpis                        jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS steering_committee          jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS key_project_members         jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS attachments                 jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_pmo_charters_entity   ON pmo_charters (entity);
CREATE INDEX IF NOT EXISTS idx_pmo_charters_category ON pmo_charters (category);
CREATE INDEX IF NOT EXISTS idx_pmo_charters_kind     ON pmo_charters (kind);


-- =============================================================
-- 2. pmo_doa_matrix
-- =============================================================
CREATE TABLE IF NOT EXISTS pmo_doa_matrix (
  id              serial PRIMARY KEY,
  entity          text NOT NULL DEFAULT '*',
  category        text NOT NULL DEFAULT '*',
  kind            text NOT NULL DEFAULT '*',
  min_inr         numeric(15,2) NOT NULL DEFAULT 0,
  max_inr         numeric(15,2),
  approver_roles  jsonb NOT NULL DEFAULT '[]'::jsonb,
  active          boolean NOT NULL DEFAULT true,
  label           text NOT NULL DEFAULT '',
  notes           text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pmo_doa_matrix_lookup
  ON pmo_doa_matrix (entity, category, kind, min_inr, active);


-- =============================================================
-- 3. Seed placeholder DOA bands (refine via admin UI later)
--    All values are illustrative — replace with the authoritative
--    Granules DOA matrix when shared.
-- =============================================================
INSERT INTO pmo_doa_matrix (entity, category, kind, min_inr, max_inr, approver_roles, label, notes)
SELECT * FROM (VALUES
  ('*', '*', '*', 0::numeric,        5000000::numeric,   '["hod"]'::jsonb,                                                'Up to ₹50 L',            'Department Head only'),
  ('*', '*', '*', 5000000::numeric,  50000000::numeric,  '["hod","cfo"]'::jsonb,                                          '₹50 L – ₹5 Cr',          'Dept Head + CFO'),
  ('*', '*', '*', 50000000::numeric, NULL::numeric,      '["hod","cfo","executive_director","chairman"]'::jsonb,          'Above ₹5 Cr',            'Dept Head + CFO + ED + CMD')
) AS v(entity, category, kind, min_inr, max_inr, approver_roles, label, notes)
WHERE NOT EXISTS (SELECT 1 FROM pmo_doa_matrix LIMIT 1);


-- =============================================================
-- 4. Legacy pmo_nfas — kept for back-compat reads; new writes flow into
--    pmo_charters. No structural change here; documentation only.
-- =============================================================
COMMENT ON TABLE pmo_nfas IS
  'LEGACY. New writes flow into pmo_charters (Charter+NFA merged in Step 1, 2026). Kept for read-only back-compat with existing rows.';

COMMIT;
