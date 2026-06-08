# Project Hub (PMO) — A‑to‑Z Documentation

> Enterprise Project & Portfolio Management with Monday.com‑style usability, layered on a governed PMO data model. Part of the Granules AI‑Powered platform. Last updated 2026‑06‑03.

---

## 1. What it is

**Project Hub** (codename `pmo`, `apps/pmo`) is the enterprise PMO application: it runs the full project lifecycle from demand intake → procurement → execution → go‑live → closure, with hard governance gates, an approval engine, automatic escalations, procurement/RFx, and portfolio reporting — wrapped in a Monday.com‑style work‑management UX (WBS tree, board, table, Gantt, calendar, rollups).

Two design pillars:
1. **Governance is authoritative.** Stage advancement, approvals, RBAC, escalations and procurement are enforced server‑side; the Monday‑style UI sits *on top of* and never bypasses them.
2. **Computed progress is the source of truth, RAG is human.** `progress_pct` rolls up Subtask→Task→Milestone→Project→Portfolio automatically; RAG health and gate approvals stay deliberate PM/PMO judgments.

---

## 2. Architecture

| Layer | Detail |
|---|---|
| **Frontend** | `artifacts/project-hub/` — React 18 + TypeScript + Vite 7 + Tailwind. Dev server **port 5182** (`PORT` + `BASE_PATH` env required). |
| **Backend API** | `artifacts/api-server/` — Node + Express, esbuild‑bundled to `dist/index.mjs`. **Port 3008**. |
| **Shared DB lib** | `lib/db/` — Drizzle ORM schema (41 schema files, **63 `pmo_*` tables**). esbuild bundles from **`src`**, so schema edits are live without a dist rebuild of the lib. |
| **API types** | `lib/api-zod/` — zod request/response schemas; `lib/api-client-react/` — generated React Query hooks. |
| **Database** | **Recruit Supabase DB** (`rhhpmohhxlmylrnzdcoe`, aws‑1‑ap‑northeast‑1 pooler) — all tables are `pmo_`‑prefixed and coexist with the recruiting app's tables. |
| **Auth DB** | **Master Employee DB** (`loqyxdhkfjnuaykxxwis`) — JWT validation + `employee_auth` access flags. |
| **Vendor auth** | Separate Supabase project for the external vendor portal (OTP‑based, distinct from employee auth). |

**Access URL (LAN):** http://172.30.101.2:5182

### Request path
```
Browser → Vite (5182, proxies /api) → Express (3008)
          requireAuth (JWT vs Master DB + access_pmo)  → routes → Drizzle → Recruit DB
```

---

## 3. Running & operating

```bash
# from apps/pmo/artifacts/api-server
node ./build.mjs            # esbuild bundle → dist/index.mjs
pnpm run start              # node --enable-source-maps ./dist/index.mjs   (reads env from process)
pnpm run dev                # build + start (NODE_ENV=development)

# from apps/pmo/artifacts/project-hub
PORT=5182 BASE_PATH=/ pnpm run dev     # Vite dev server (HMR)
pnpm run build && pnpm run serve        # production preview
```

**Environment** — the API server reads env from the **process** (no `.env` for the API; `DATABASE_URL`, `MASTER_DB_URL`, `MASTER_DB_SERVICE_ROLE_KEY`, `SESSION_SECRET`, `PORT=3008`, `VENDOR_AUTH_DB_URL`). The frontend uses `artifacts/project-hub/.env` (Vite `VITE_*` vars) plus process `PORT` + `BASE_PATH`.

**Feature flags (default OFF):**
- `ENABLE_SCHEDULER=true` — turns on the 5 background jobs (escalations, nudges, SAP/Teams sync).
- `AUTO_ESCALATION_EMAILS=on` — lets the automated jobs send email (in‑app notifications always work; manual Remind/Escalate buttons always email).

**Operational gotchas**
- The API runs from a bundled `dist/index.mjs` — **source edits require `node ./build.mjs` + restart** (the lib `@workspace/db` is the exception — it bundles from `src`).
- Frontend (Vite) is **HMR** — frontend edits are live, no restart.
- `drizzle-kit push` is a footgun on this shared DB — use manual `ALTER`/SQL scripts.
- When restarting via shell, never `pkill -f 'dist/index.mjs'` in a command whose own text contains that string (it self‑kills the shell).

---

## 4. Data model (63 `pmo_*` tables)

Grouped by domain. (Schema files in `lib/db/src/schema/`.)

### Core project structure
| Table | Purpose |
|---|---|
| `pmo_portfolios` | Top‑level grouping of programs/projects. |
| `pmo_programs` | Program under a portfolio. |
| `pmo_projects` | The project. Carries `stage` (current lifecycle stage), `status`, `projectType` (internal/vendor), `rag_status` (human), `progress` (rolled up), `portfolioId`/`programId`, `projectManagerId`, `charterId`, `endDate`. |
| `pmo_charters` | Project charter — sponsor/owner/manager, scope, business case. |
| `pmo_pifs` | Project Initiation Forms / demand intake. |
| `pmo_squad_members` | Charter team membership (pm/sponsor/tech_lead…). |
| `pmo_workstreams` | Optional sub‑grouping of work (self‑ref hierarchy). |

### Work management (Monday layer)
| Table | Purpose |
|---|---|
| `pmo_milestones` | Milestone. `stage` (gate linkage), `progress_pct` (rolled from tasks), `rag`, `order`, `dueDate`/`startDate`, `gateDecision`, `readinessChecklist`. |
| `pmo_tasks` | Task **and** subtask (self‑ref `parent_task_id`). `milestone_id`, `predecessor_ids` + `cross_project_predecessors` (dependencies), `is_critical` (CPM), `progress_pct`, `assignee_id`, `cft_owner/dept`, `start/end_date`, `estimated/actual_hours`, `stage`, `order`, `jira_key`. |
| `pmo_raci_matrix` | RASCI ownership — `raci_type` ∈ {R, A, S, C, I}, scoped per `task_id` or `workstream_id`. |
| `pmo_resource_allocations` | Person × workstream allocation %, skill, dates. |
| `pmo_timelogs` | Time entries against a task. |
| `pmo_messages` | Task comment threads. |
| `pmo_template_milestones`, `pmo_template_tasks` | Reusable project templates (subtask hierarchy + predecessor offsets). |
| `pmo_project_templates` | Template definitions. |

### Lifecycle & governance
| Table | Purpose |
|---|---|
| `pmo_project_stages` | One row per stage per project — `status`, `entered_at`, `completed_at`, `notes` (JSON: `__checklist`, approval flags). |
| `pmo_stage_slas` | Admin per‑stage SLA (`target_days`). |
| `pmo_approvals` | Approval steps for charters/gates. |
| `pmo_change_requests`, `pmo_baselines` | Change control + baseline snapshots. |
| `pmo_risks`, `pmo_issues` | Risk & issue registers. |
| `pmo_benefits_reviews` | Post‑go‑live benefits realization. |
| `pmo_lessons_learned` | Knowledge capture (closure gate). |
| `pmo_documents`, `pmo_document_versions` | Project documents (gate required docs). |
| `pmo_activity` | Append‑only audit log. |

### Escalations & notifications
| Table | Purpose |
|---|---|
| `pmo_escalation_rules` | Per‑project condition rules (rag/budget/schedule/risk/issue/stage triggers). |
| `pmo_stage_escalation_policy` | Org‑wide per‑stage escalation **ladder** (tier, after_days, action, target_role). |
| `pmo_escalation_log` | Audit of fired escalations. |
| `pmo_role_directory` | Role → person/email map (cfo, procurement_head, qa_lead, steering_committee…). |
| `pmo_notifications` | In‑app notifications. |
| `pmo_nudges` | AI‑generated nudges. |

### Procurement / RFx / vendors
| Table | Purpose |
|---|---|
| `pmo_purchase_requisitions`, `pmo_purchase_orders` | PR/PO, SAP‑synced. |
| `pmo_vendor_master`, `pmo_vendors` | Vendor records (segment, risk, category). |
| `pmo_vendor_qualifications`, `pmo_vendor_documents`, `pmo_vendor_kpis`, `pmo_vendor_risk_events` | Vendor qualification, compliance, KPIs, risk events. |
| `pmo_vendor_questionnaire_templates`, `pmo_vendor_questionnaire_responses` | Vendor questionnaires. |
| `pmo_rfx_events`, `pmo_rfx_invitations`, `pmo_rfx_envelopes`, `pmo_rfx_envelope_files/keys` | RFI/RFP/RFQ/e‑auction with **sealed (encrypted) envelopes**. |
| `pmo_rfx_questions`, `pmo_rfx_clarifications`, `pmo_rfx_scoring_dimensions`, `pmo_rfx_scores`, `pmo_rfx_awards`, `pmo_rfx_audit`, `pmo_rfx_events` | RFx Q&A, scoring, award, audit. |

### Reporting / scoring / misc
| Table | Purpose |
|---|---|
| `pmo_project_scores`, `pmo_scoring_criteria` | Project prioritization scoring. |
| `pmo_budget_lines` | Project budget baseline vs actual. |
| `pmo_meetings`, `pmo_meeting_items` | Meeting MoM + action items (Teams‑synced). |
| `pmo_users` | Local app user rows (auto‑provisioned from Master DB on first login; `id` is the FK target for created_by/owner). |
| `pmo_user_preferences` | Saved views/column prefs. |
| `pmo_mcp_integrations` | Jira/Teams connector config. |

---

## 5. The PMO lifecycle (governance backbone)

**SSOT:** `artifacts/api-server/src/lib/stage-gates.ts` (frontend mirror: `lib/lifecycle-config.ts`).

**9 stages across 4 phases.** Two project paths: **vendor** (all 9) and **internal** (skips `vendor_selection` + `contract_po`).

| Phase | Stage | Gate (blocking checklist) | Required docs | Advance roles |
|---|---|---|---|---|
| **Initiate** | `initiation` | biz_just, scope_done, outcomes, budget_est, biz_req, it_review, biz_owner_approved, it_approved (+ BC & URS sub‑gates) | URS Document, URS Review Sign‑off | initiator, pmo, hod |
| **Procure** | `vendor_selection` *(vendor only)* | urs_approved_gate, rfp_created, vendor_invited, deadline_set, proposals_analysed, negotiation_complete, scm_uploaded, finance_reviewed, vendor_selected | RFP, Comparison, SCM/Finance notes | scm, pmo, finance, hod |
| | `investment_authorization` | charter/NFA/budget checklist | Project Charter, Charter Template, NFA Form, Budget Breakdown | pmo, hod, cfo, chairman |
| | `contract_po` *(vendor only)* | contract_uploaded, legal_reviewed, compliance_confirmed, legal_signoff, pr_submitted, po_released | Vendor Contract, Legal Review Note, PR Form, PO Document | legal, pmo, finance, scm |
| **Execute** | `design` | kickoff/design/security checklist | MoM, Kickoff, Tech Design, Architecture, Security Review | pm, pmo, hod |
| | `build` | dev_env_ready, status_updated, impl_plan_uploaded, milestones_defined, stakeholder_signoff, cutover_plan_approved | Build Specs, Status Report, Impl Plan, Cutover Plan | pm, pmo |
| **Release & Close** | `uat` | uat_plan_approved, test_cases_executed, critical_defects_closed, uat_signed | UAT Test Plan, Sign‑off, Defect Log | pm, hod |
| | `go_live` | uat_approved_gate, go_live_date_frozen, training_uploaded, stakeholders_notified | Go Live Checklist, Training Materials, Comms Plan | pm, pmo |
| | `closure` | csat, doc handover, deliverables signed, support transitioned, **lessons_learned_done**, closure report, final financials, stakeholder closed | Closure Report, CSAT, Handover | pm, pmo, chairman |

**Gate enforcement:** advancing a stage is **only** possible via `POST /projects/:id/stages/:stage/advance`, which checks (server‑side): prerequisite stage complete → role in `advanceRoles` → all blocking checklist items ticked → required docs uploaded → sub‑gate approvals (BC/URS) → UAT defects closed. Checklist state lives in `pmo_project_stages.notes.__checklist`. Closed projects are read‑only. `evaluateStageGate()` is the non‑mutating evaluator reused by both the advance endpoint and the critical‑path display.

**Gate ↔ milestone linkage** (`lib/gate-milestones.ts`): 7 standard gate milestones (BC Approved, URS Approved, IA Approved, Contract Signed, UAT Sign‑off, Go Live, Closure) are auto‑created per project and tagged with their `stage`, tying the Monday milestone tree to the governance stages.

---

## 6. RBAC

**SSOT:** `lib/derivePmoRole.ts` + `middlewares/requireAuth.ts` + `lib/guard.ts`.

- **Auth:** `requireAuth` validates the bearer JWT against the Master DB, joins `employees` + `employee_auth`, and gates on `access_pmo` OR `is_super_admin`.
- **Role resolution:** `derivePmoRole(emp, auth)` resolves the functional role — explicit `employee_auth.pmo_role` override wins, else derived from directory `designation_text`/`function`/`grade_code`. **10 roles:** `admin, chairman, executive_director, cfo, pmo, pm, hod, scm, finance, team_member`. Result is stored on `req.user.pmoRole` and returned by `GET /api/users/me`.
- **Guards:** `requireRole(...)` authorizes on `req.user.pmoRole`; platform admins bypass; `"initiator"` means any authenticated PMO user (a per‑project relationship). `requireAdmin` gates `/admin/*`.
- **Note:** `requireRole` on lessons/meetings/change‑requests/benefits + the CR decision gate use the real derived role. A few endpoints (`project_stages`, `scoring`, `storage`, `dashboard`) still read the legacy dev `session.simulatedRole` — flagged follow‑ups. The `POST /session/role` simulator is dev‑only (403 in production).

---

## 7. Work management (Monday layer)

### Hierarchy & rollup
- **Stage → Milestone → Task → Subtask.** Milestone via `tasks.milestone_id`; subtask via self‑ref `tasks.parent_task_id`.
- **Rollup engine** (`lib/rollup.ts` → `recomputeRollups(projectId)`, called on every task/milestone write): `progress_pct` averages Subtask→Task→Milestone→Project; portfolio rolls up **on read** in `routes/portfolios.ts` (now also surfaces `ragDistribution`, `atRiskCount`, `delayedCount`). **RAG / gate decisions are never auto‑written.**

### Dependencies & Critical Path
- **Dependencies:** `predecessor_ids` (in‑project) + `cross_project_predecessors` (external) JSON arrays on the task. Editable from the task modal (add/remove), validated server‑side.
- **CPM** (`lib/critical-path-cpm.ts`): Kahn topological sort → **forward & backward pass** → early/late start/finish, **slack/float**, `is_critical`. Duration from real `start/end` dates (fallback `estimatedHours/8`). **Cycle‑safe** — cyclic graphs are detected and reported, never recursed into. `wouldCreateDependencyCycle()` blocks edges that would form a loop.
- **Lifecycle‑stage critical path** (`lib/critical-path.ts`, distinct): which governance stage is blocking, who owns it, days overdue/pending, blocking reasons — feeds the escalation ladder.

### RACI / RASI
`pmo_raci_matrix` with `raci_type` ∈ **R**(esponsible), **A**(ccountable), **S**(upport), **C**(onsulted), **I**(nformed). Task × user grid UI (`raci-tab.tsx`) with over‑allocation warnings (R+A > 5) and CSV export.

### Views (all on the same data model)
- **Tree (WBS):** `components/wbs-tree.tsx` — Stage→Milestone→Task→Subtask, expand/collapse with smooth framer‑motion animation, dnd‑kit reparenting, inline add, rollup bars.
- **Board:** `connect-board.tsx` (kanban by status, drag to move).
- **Table:** `task-grid.tsx` / `milestone-grid.tsx`.
- **Timeline/Gantt:** custom SVG in `project-detail.tsx` — zoom presets, dependency arrows, milestone diamonds, critical‑path highlight.
- **Calendar:** `monday/CalendarView.tsx`.
- **MondayBoard kit:** `components/monday/` (generic grouped/expandable/dnd board + status tokens) used by Portfolio, My Work, Projects.
- Global `/tasks` has a Tree/Board/Table/Timeline ViewSwitcher; project detail exposes the same views as tabs.

---

## 8. Approvals, escalations, procurement, reporting

### Approvals
`routes/approvals.ts` + `change_requests.ts`. Charters flow through multi‑stage approval (parallel review → SCM → Chairman → Finance → PMO). Change requests snapshot baseline vs proposed; only `submitted` CRs are decidable; decided CRs are immutable; decisions require `DECIDE_ROLES`.

### Escalations (two engines)
1. **Condition rules** — `pmo_escalation_rules` + `jobs/escalation-evaluator.ts` (5 min). Triggers: rag_change, budget_overrun_pct, schedule_slip_days, risk_score, issue_open_days, stage_blocked_days → in‑app notifications (no email), deduped per rule/day.
2. **Stage ladder** — `pmo_stage_escalation_policy` + `jobs/stage-escalation-ladder.ts` (hourly). Per‑stage tiers fire remind/escalate to the `target_role` (resolved via `role-resolver.ts` + `pmo_role_directory`) when a stage is overdue past `after_days`. Emails gated by `AUTO_ESCALATION_EMAILS`. Manual Remind/Escalate buttons (`critical-path-actions.ts`) always email.
> Both engines are **dormant** unless `ENABLE_SCHEDULER=true`, and most roles need assignees in `/admin/role-directory` to resolve recipients.

### Procurement / RFx
`routes/purchase_orders.ts`, `rfx.ts`, `vendor_master.ts`, `vendor_portal.ts` + `lib/envelopeCrypto.ts` (sealed bids) + `integrations/sap/` (PR/PO sync). RFx flow: create → invite vendors → sealed envelopes → open after deadline → score → clarifications → award. The vendor portal authenticates separately (OTP).

### Portfolio / reporting
`routes/portfolios.ts`, `dashboard.ts` + role dashboards (Executive / Functional Head / PM / Portfolio / General). Portfolio rollup = average member‑project progress + RAG distribution + delayed/at‑risk counts (closed projects excluded).

### Automations
`pages/automations.tsx` — a Monday "When…then…" recipe gallery that creates/toggles **real** `pmo_escalation_rules` over the existing engine (no parallel rules engine).

---

## 9. Integrations & jobs

| Integration | Where |
|---|---|
| **Jira** | `routes/jira.ts` + `routes/integrations/`, `pmo_mcp_integrations`. Two‑way task import/export (verified: MYG → 264 tasks). Export writes to live Jira — trigger via UI. |
| **Teams** | `routes/teams.ts` + `jobs/teams-sync.ts` (30 min) — meeting MoM ingest. |
| **SAP** | `integrations/sap/` + `jobs/sap-sync.ts` (2 min) — vendor + PR/PO sync (real + mock adapters). |

**Scheduler** (`lib/scheduler.ts`, in‑process, off unless `ENABLE_SCHEDULER=true`): `escalation-evaluator` (5m), `nudge-generator` (15m), `sap-sync` (2m), `teams-sync` (30m), `stage-escalation-ladder` (60m). Debug: `POST /api/jobs/run/:name`.

---

## 10. API surface (route files)

All mounted under `/api`, behind `requireAuth` (except `/healthz`, vendor‑portal OTP, public paths). Key files in `artifacts/api-server/src/routes/`:

`projects.ts` (projects, milestones, tasks, **critical‑path**, **schedule**, **dependencies**), `work.ts` (cross‑project tasks/milestones, `/me/tasks`, comments), `project_stages.ts` (stage advance/gates), `portfolios.ts`, `charters.ts`, `pifs.ts`, `approvals.ts`, `change_requests.ts`, `escalation.ts`, `stage-escalation-policy.ts`, `stage_slas.ts`, `role-directory.ts`, `resources.ts` (RACI + allocations), `workstreams.ts`, `risks`/`issues`/`documents`/`benefits`/`budget`/`scoring`/`lessons`/`meetings`/`messages`/`notifications`/`nudges`, `purchase_orders.ts`, `rfx.ts`, `vendor_master.ts`, `vendor_portal.ts`, `vendor_auth.ts`, `jira.ts`, `teams.ts`, `templates.ts`, `dashboard.ts`, `activity.ts`, `employees.ts`, `users.ts`, `ai.ts`, `storage.ts`, `documents.ts`, `user_preferences.ts`, `session.ts`, `health.ts`, `admin/`.

Notable work‑management endpoints:
```
GET    /api/projects/:id/critical-path        # CPM: critical tasks + full schedule (slack), cycle-aware
GET    /api/projects/:id/schedule             # Gantt-friendly CPM (read-only, no writes)
GET    /api/projects/:id/critical-path-stages # lifecycle-stage governance critical path
POST   /api/tasks/:id/dependencies            # add predecessor (validates cycle/scope)
DELETE /api/tasks/:id/dependencies/:predId    # remove predecessor
POST   /api/projects/:id/stages/:stage/advance# the gate — only path that moves a stage
GET    /api/users/me                          # local user + derived pmoRole + access flags
```

---

## 11. Frontend pages

`pages/`: dashboard, projects, projects-tree, project-detail (Overview/Lifecycle/Work/Timeline/Calendar/Board/Grid + Documents/Approvals/Activity/Milestones/Tasks/Risks/Lessons/Resources/Budget/Procurement/Issues/RACI/Escalation/MOM/Changes/Benefits/Messages/Analytics/Scoring), portfolio, pipeline, tasks, my-tasks, approvals, automations, activity, lessons-learned, nudges, templates, demands/demand-new, pifs/pif-detail/pif-new, charters/charter-detail/charter-new, task-new, vendors/vendor-detail/vendor-new/vendor-scorecards, rfx-list/rfx-detail/rfx-new, admin-* (role-directory, scoring, stage-escalation, stage-slas, integrations), and role dashboards (Executive/FunctionalHead/PM/Portfolio/General).

---

## 12. Recent changes (2026‑06‑03)

- **RBAC wired:** `derivePmoRole` now drives `req.user.pmoRole` (was dead code) in `requireAuth` + `requireRole` + CR decision gate + `/users/me`.
- **CPM rebuilt:** new `critical-path-cpm.ts` — forward+backward pass, slack, cycle detection; fixed a stack‑overflow risk and stale `is_critical` flags; added `/schedule` + dependency endpoints.
- **RASI:** added Support (S) to the RACI matrix (now R/A/S/C/I).
- **Tree animations:** framer‑motion smooth expand/collapse in the WBS tree.
- **Dependency editor:** add/remove predecessors + critical‑path badge in the task modal.
- **Portfolio rollup:** RAG distribution + at‑risk + delayed counts.

---

## 13. Cheat sheet

| Need | Where |
|---|---|
| Add a lifecycle stage / change a gate | `lib/stage-gates.ts` (+ mirror `lib/lifecycle-config.ts`) |
| Change rollup math | `lib/rollup.ts` |
| Critical path / dependencies | `lib/critical-path-cpm.ts` |
| Escalation behavior | `jobs/escalation-evaluator.ts`, `jobs/stage-escalation-ladder.ts`, `lib/role-resolver.ts` |
| RBAC roles | `lib/derivePmoRole.ts`, `lib/guard.ts`, `middlewares/requireAuth.ts` |
| WBS tree UI | `components/wbs-tree.tsx` |
| Board kit | `components/monday/` |
| Turn on automations/escalations | env `ENABLE_SCHEDULER=true` (+ `AUTO_ESCALATION_EMAILS=on`) + assign people in `/admin/role-directory` |
| DB access | Recruit pooler `rhhpmohhxlmylrnzdcoe` (see project memory `recruit_db_ddl_access`) |
```
```
