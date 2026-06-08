-- pmo_nfas — Granules "Internal Approval Note" (Note For Approval).
-- Standalone or linked to a PMO project. Manual migration (drizzle-kit push is
-- a footgun on the shared Recruit DB — see project memory pmo_app).

CREATE TABLE IF NOT EXISTS pmo_nfas (
  id                serial PRIMARY KEY,
  note_no           text NOT NULL,
  project_id        integer,
  department        text NOT NULL DEFAULT '',
  location          text NOT NULL DEFAULT '',
  location_required text NOT NULL DEFAULT '',
  note_date         text,
  subject           text NOT NULL DEFAULT '',
  background        text NOT NULL DEFAULT '',
  requirement_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  order_form_note   text NOT NULL DEFAULT '',
  total_usd         text NOT NULL DEFAULT '',
  total_inr         text NOT NULL DEFAULT '',
  recommendation    text NOT NULL DEFAULT '',
  signatories       jsonb NOT NULL DEFAULT '[]'::jsonb,
  status            text NOT NULL DEFAULT 'draft',
  created_by_id     integer,
  created_by_name   text NOT NULL DEFAULT '',
  created_by_code   text NOT NULL DEFAULT '',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pmo_nfas_project ON pmo_nfas (project_id);
CREATE INDEX IF NOT EXISTS idx_pmo_nfas_status  ON pmo_nfas (status);
