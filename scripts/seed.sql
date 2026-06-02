-- Sample seed data for PMO Project Hub
-- Idempotent: truncate + insert. Run via: psql -d pmo -f scripts/seed.sql

BEGIN;

TRUNCATE TABLE
  pmo_tasks, pmo_milestones, pmo_workstreams, pmo_risks, pmo_vendors, pmo_squad_members, pmo_approvals,
  pmo_activity, pmo_project_stages, pmo_projects, pmo_charters, pmo_programs, pmo_portfolios, pmo_users
RESTART IDENTITY CASCADE;

-- ── Users ─────────────────────────────────────────────────────────────────
INSERT INTO pmo_users (name, email, role, department) VALUES
  ('Asha Reddy',       'asha.reddy@granules.com',   'pmo',                'PMO'),
  ('Rohan Iyer',       'rohan.iyer@granules.com',   'pm',                 'Engineering'),
  ('Meera Singh',      'meera.singh@granules.com',  'executive_director', 'Operations'),
  ('Vikram Joshi',     'vikram.joshi@granules.com', 'cfo',                'Finance'),
  ('Priya Nair',       'priya.nair@granules.com',   'hod',                'Quality'),
  ('Karthik Rao',      'karthik.rao@granules.com',  'pm',                 'IT'),
  ('Sneha Kapoor',     'sneha.kapoor@granules.com', 'scm',                'SCM'),
  ('Arjun Mehta',      'arjun.mehta@granules.com',  'team_member',        'Engineering');

-- ── Portfolios & Programs ────────────────────────────────────────────────
INSERT INTO pmo_portfolios (name, description, owner_id) VALUES
  ('Manufacturing Excellence', 'Plant modernization & yield programs', 3),
  ('Digital Transformation',   'IT, data, automation initiatives',     2);

INSERT INTO pmo_programs (portfolio_id, name, description, owner_id) VALUES
  (1, 'Yield & Throughput',     'Cross-plant capacity uplift', 3),
  (2, 'Data Platform Refresh',  'Lake-house + governance',     2);

-- ── Charters ─────────────────────────────────────────────────────────────
INSERT INTO pmo_charters (title, description, scope, deliverables, tentative_budget, status, submitted_by_id, project_sponsor_id, project_manager_id) VALUES
  ('API-1 Granulation Line Upgrade', 'Replace ageing wet-granulation line at API-1 with modern continuous unit.', 'API-1 site, granulation only', '1× continuous granulator + DCS integration', 12500000, 'approved', 1, 3, 2),
  ('SAP S/4HANA Migration',          'Move ERP from ECC to S/4HANA private cloud.',                                'All finance, SD, MM modules',    'S/4 go-live + cutover',                     45000000, 'active',   1, 3, 6),
  ('LIMS Modernisation',             'Replace legacy LIMS with cloud-native QC system.',                           'All QC labs, 4 sites',           'Vendor selection + pilot',                  8500000,  'submitted',1, 3, 2),
  ('Edge Vision QC Pilot',           'Computer-vision inspection on tablet line.',                                 'Plant-3 packing hall',           'PoC + ROI report',                          1800000,  'draft',    1, 3, 6);

-- ── Projects (across all 5 phases) ───────────────────────────────────────
INSERT INTO pmo_projects (charter_id, portfolio_id, program_id, name, description, status, priority, stage, strategic_theme, rag_status, capex_budget, opex_budget, site_region, function, project_manager_id, start_date, end_date, progress) VALUES
  (NULL, 1, 1, 'Plant-2 OEE Telemetry',          'Real-time OEE dashboards on packing lines.',           'planning',  'P1', 'project_case',       'Operational Excellence', 'green', 2200000, 400000, 'Plant-2',  'Manufacturing', 2, '2026-06-01', '2026-12-15', 5),
  (NULL, 2, NULL,'Customer Portal Refresh',      'Self-serve portal for B2B customers.',                 'planning',  'P2', 'urs',                'Customer Experience',    'amber', 3500000, 500000, 'HQ',       'IT',            6, '2026-07-01', '2027-01-30', 12),
  (3,    1, 1,   'LIMS Modernisation',           'Cloud-native QC LIMS replacement.',                    'planning',  'P1', 'rfp',                'Quality',                'green', 8500000, 1200000,'Multi-site','Quality',       2, '2026-08-01', '2027-06-30', 18),
  (NULL, 2, 2,   'Data Lake Governance',         'DLP, lineage, and access controls on lake-house.',     'planning',  'P2', 'vendor_evaluation',  'Data',                   'green', 4200000, 600000, 'HQ',       'IT',            6, '2026-09-01', '2027-03-30', 22),
  (1,    1, 1,   'API-1 Granulation Upgrade',    'Continuous granulation line at API-1.',                'active',    'P0', 'pr_po',              'Operational Excellence', 'amber',12500000, 800000, 'API-1',    'Manufacturing', 2, '2026-04-01', '2027-04-30', 38),
  (2,    2, 2,   'SAP S/4HANA Migration',        'ERP refresh to S/4HANA.',                              'active',    'P0', 'development',        'Digital Backbone',       'amber',45000000, 5000000,'HQ',       'IT',            6, '2026-01-15', '2027-07-30', 54),
  (NULL, 2, 2,   'Identity & SSO Rollout',       'Okta SSO + MFA across all enterprise apps.',           'active',    'P1', 'uat',                'Security',               'green', 1800000, 300000, 'HQ',       'IT',            6, '2026-02-01', '2026-08-15', 78),
  (NULL, 1, 1,   'Plant-3 Smart Meters',         'Sub-metering energy across utility skids.',            'active',    'P2', 'go_live',            'Sustainability',         'green', 1400000, 200000, 'Plant-3',  'Engineering',   2, '2026-01-10', '2026-06-30', 92),
  (NULL, 1, NULL,'ETP Compliance Refresh',       'Upgrade ETP monitoring for new norms.',                'completed', 'P1', 'closure_readiness',  'Sustainability',         'green', 900000,  100000, 'Plant-1',  'EHS',           2, '2025-09-01', '2026-04-30', 100),
  (NULL, 2, NULL,'Helpdesk Ticketing Revamp',    'Move ServiceDesk to Jira Service Mgmt.',               'completed', 'P3', 'project_closure',    'IT Service',             'green', 600000,  120000, 'HQ',       'IT',            6, '2025-07-01', '2026-02-28', 100);

-- ── Workstreams (for the larger live pmo_projects) ───────────────────────────
INSERT INTO pmo_workstreams (project_id, name, "order") VALUES
  (5, 'Mechanical', 1),
  (5, 'DCS / Controls', 2),
  (5, 'Qualification & GMP', 3),
  (6, 'Finance Stream', 1),
  (6, 'SD/MM Stream', 2),
  (6, 'Cutover & Hypercare', 3);

-- ── Milestones ───────────────────────────────────────────────────────────
INSERT INTO pmo_milestones (project_id, workstream_id, name, due_date, status, priority, rag, "order") VALUES
  (5, 1, 'FAT — Granulator at vendor',  '2026-08-15', 'in_progress', 'P0', 'amber', 1),
  (5, 2, 'DCS Integration Frozen',      '2026-10-01', 'not_started', 'P0', 'green', 2),
  (5, 3, 'IQ/OQ Complete',              '2027-01-30', 'not_started', 'P1', 'green', 3),
  (6, 4, 'GL Conversion Cutover',       '2026-08-30', 'in_progress', 'P0', 'amber', 1),
  (6, 5, 'SD Pricing Migration UAT',    '2026-11-15', 'not_started', 'P0', 'green', 2),
  (6, 6, 'Production Go-Live',          '2027-05-30', 'not_started', 'P0', 'green', 3),
  (7, NULL, 'Pilot apps onboarded',     '2026-05-15', 'completed',   'P1', 'green', 1),
  (7, NULL, 'Org-wide cutover',         '2026-08-15', 'in_progress', 'P0', 'green', 2);

-- ── Tasks ────────────────────────────────────────────────────────────────
INSERT INTO pmo_tasks (project_id, milestone_id, name, status, priority, rag, assignee_id, start_date, end_date, estimated_hours, is_critical, "order") VALUES
  (5, 1, 'Vendor FAT witness travel plan',     'in_progress', 'P1', 'amber', 8, '2026-07-15', '2026-08-15',  40, true,  1),
  (5, 1, 'Punch-list closure with OEM',        'not_started', 'P0', 'green', 2, '2026-08-16', '2026-09-30',  80, true,  2),
  (5, 2, 'Tag database freeze',                'not_started', 'P0', 'green', 8, '2026-09-01', '2026-10-01',  60, true,  3),
  (6, 4, 'TB-to-GL parallel run #2',           'in_progress', 'P0', 'amber', 8, '2026-07-01', '2026-08-30', 120, true,  1),
  (6, 5, 'Pricing condition mapping',          'not_started', 'P1', 'green', 8, '2026-09-15', '2026-11-15', 200, false, 2),
  (7, 8, 'Service-now app inventory sweep',    'in_progress', 'P1', 'green', 8, '2026-06-01', '2026-07-30',  40, false, 1);

-- ── Risks (linked to pmo_charters) ───────────────────────────────────────────
INSERT INTO pmo_risks (charter_id, title, description, impact, likelihood, priority, rag, status, owner, mitigation) VALUES
  (1, 'OEM lead-time slip',           'Granulator vendor flagged 4-week steel shortage.',   'high',   'medium', 'high',   'amber', 'open',     'Rohan Iyer', 'Weekly OEM call + alternate supplier scoped'),
  (1, 'Site civil works overlap',     'Floor strengthening conflicts with shutdown window.', 'medium', 'medium', 'medium', 'green', 'mitigating','Rohan Iyer', 'Pre-shutdown civil scope frozen'),
  (2, 'SAP basis skills shortage',    'Limited in-house S/4 basis admin coverage.',          'high',   'high',   'high',   'amber', 'open',     'Karthik Rao','Backfill hire + partner cover'),
  (2, 'Cutover blackout governance',  'Need exec-level no-merge window during cutover.',     'high',   'medium', 'high',   'green', 'mitigating','Karthik Rao','Steering com approved freeze policy'),
  (3, 'Lab user training capacity',   'Multi-site rollout collides with audit season.',      'medium', 'medium', 'medium', 'green', 'open',     'Priya Nair','Sequenced site-by-site rollout');

-- ── Project Stages (timeline entries) ────────────────────────────────────
INSERT INTO pmo_project_stages (project_id, stage, status, entered_at, completed_at) VALUES
  (5, 'project_case',      'completed',  '2026-02-01', '2026-02-20'),
  (5, 'urs',               'completed',  '2026-02-20', '2026-03-05'),
  (5, 'rfp',               'completed',  '2026-03-05', '2026-03-25'),
  (5, 'vendor_evaluation', 'completed',  '2026-03-25', '2026-04-10'),
  (5, 'charter',           'completed',  '2026-04-10', '2026-04-20'),
  (5, 'nfa',               'completed',  '2026-04-20', '2026-05-01'),
  (5, 'legal',             'completed',  '2026-05-01', '2026-05-15'),
  (5, 'pr_po',             'in_progress','2026-05-15', NULL),
  (6, 'project_case',      'completed',  '2025-10-01', '2025-10-25'),
  (6, 'urs',               'completed',  '2025-10-25', '2025-11-30'),
  (6, 'rfp',               'completed',  '2025-12-01', '2025-12-20'),
  (6, 'vendor_evaluation', 'completed',  '2025-12-20', '2026-01-10'),
  (6, 'charter',           'completed',  '2026-01-10', '2026-01-15'),
  (6, 'kickoff',           'completed',  '2026-01-15', '2026-01-25'),
  (6, 'technical_design',  'completed',  '2026-01-25', '2026-04-30'),
  (6, 'development',       'in_progress','2026-04-30', NULL);

-- ── Activity feed ────────────────────────────────────────────────────────
INSERT INTO pmo_activity (type, message, entity_id, entity_type, user_id, created_at)
SELECT 'stage_advance', 'Project moved into ' || proj.stage, proj.id, 'project', 2, NOW() - (random() * INTERVAL '30 days')
  FROM pmo_projects proj WHERE proj.status = 'active'
UNION ALL
SELECT 'milestone_update', 'Milestone "' || m.name || '" set to ' || m.status, m.id, 'milestone', 8, NOW() - (random() * INTERVAL '14 days')
  FROM pmo_milestones m;

COMMIT;

SELECT 'pmo_projects' AS table_name, count(*) FROM pmo_projects
UNION ALL SELECT 'pmo_charters', count(*) FROM pmo_charters
UNION ALL SELECT 'pmo_users', count(*) FROM pmo_users
UNION ALL SELECT 'pmo_milestones', count(*) FROM pmo_milestones
UNION ALL SELECT 'pmo_tasks', count(*) FROM pmo_tasks
UNION ALL SELECT 'pmo_risks', count(*) FROM pmo_risks
UNION ALL SELECT 'pmo_project_stages', count(*) FROM pmo_project_stages
UNION ALL SELECT 'pmo_activity', count(*) FROM pmo_activity;
