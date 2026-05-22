# Agent Handoff — Project Hub PMO

This document is for the next Replit agent taking over this project.
Read it fully before touching any code.

---

## 1. What Is This App?

**Project Hub** is an enterprise project management system (PMO tool) built as a pnpm monorepo.
It covers the full charter-to-execution lifecycle for a mid-to-large organisation.

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Monorepo | pnpm workspaces |
| Node | 24 |
| API | Express 5 (`artifacts/api-server`) |
| DB | PostgreSQL + Drizzle ORM (`lib/db`) |
| Validation | Zod (`zod/v4`), `drizzle-zod` |
| API contract | OpenAPI spec → Orval codegen |
| Frontend | React + Vite + TailwindCSS + shadcn/ui (`artifacts/project-hub`) |
| State | Zustand |
| Charts | Recharts |

### Key Commands

```bash
# Install dependencies
pnpm install --frozen-lockfile

# Push DB schema to PostgreSQL
pnpm --filter @workspace/db run push

# Seed the database with test data
pnpm --filter @workspace/scripts run seed

# Regenerate API hooks + Zod schemas from OpenAPI spec
pnpm --filter @workspace/api-spec run codegen

# Full typecheck
pnpm run typecheck

# Dev servers are managed via Replit Workflows (not pnpm dev at root)
```

---

## 2. First-Time Setup in a New Replit Account

1. Import this repo from GitHub into your new Replit account.
2. Replit will auto-run `scripts/post-merge.sh` which does:
   - `pnpm install --frozen-lockfile`
   - `pnpm --filter db push` (applies all DB schema)
3. After that, seed the DB with realistic test data:
   ```bash
   pnpm --filter @workspace/scripts run seed
   ```
4. Start the three workflows from the Replit workflow panel:
   - `artifacts/api-server: API Server`
   - `artifacts/project-hub: web`
   - `artifacts/mockup-sandbox: Component Preview Server`
5. The app should be visible in the preview pane at `/`.

> **Note:** If the seed script fails with a duplicate key error, the DB already has data.
> You can truncate all tables first: connect to the DB and run
> `TRUNCATE users, portfolios, programs, scoring_criteria, charters, approvals, projects, project_stages, project_scores, workstreams, milestones, tasks, timelogs, risks, issues, budget_lines, resource_allocations, notifications, escalation_rules CASCADE;`

---

## 3. Monorepo Structure

```
artifacts/
  api-server/          — Express 5 REST API (port from $PORT env var)
  project-hub/         — React + Vite frontend (port from $PORT env var)
  mockup-sandbox/      — Vite server for canvas component previews
lib/
  api-spec/            — openapi.yaml + Orval codegen config
  api-zod/             — Generated Zod schemas (DO NOT EDIT by hand)
  api-client/          — Generated React Query hooks (DO NOT EDIT by hand)
  db/                  — Drizzle ORM schema + migrations
scripts/
  src/seed.ts          — Database seed script
```

### Routing

A global reverse proxy routes by path prefix:
- `/api/**` → api-server
- `/` → project-hub

Services must handle their own base path. Do NOT configure Vite proxy.
Always use `localhost:80/api/...` for curl testing (not the raw service port).

---

## 4. Database Schema (All Tables)

| Table | Purpose |
|-------|---------|
| `users` | All users; roles: initiator, hod, executive_director, cfo, scm, chairman, finance, pmo, pm, team_member |
| `portfolios` | Top-level portfolio grouping |
| `programs` | Programs within a portfolio |
| `charters` | Project charter requests (draft → approved flow) |
| `approvals` | Per-role approval decisions on charters |
| `projects` | Active projects linked to approved charters |
| `project_stages` | 14-stage lifecycle tracker per project |
| `scoring_criteria` | PMO-defined weighted scoring criteria |
| `project_scores` | Per-project score against each criterion |
| `workstreams` | Work breakdown structure within a project |
| `milestones` | Stage-gate milestones with gate decisions |
| `tasks` | Tasks within milestones; support subtasks, predecessors, CFT fields |
| `timelogs` | Time entries per task (date, hours, userId, note) |
| `risks` | Risk register per charter (probability × impact scoring) |
| `issues` | Issues raised at task/milestone level (dependency type, blocking owner) |
| `budget_lines` | CapEx/OpEx budget lines with baseline vs actual vs forecast |
| `resource_allocations` | User allocation % per project per date range |
| `notifications` | In-app notifications per user |
| `escalation_rules` | Rules engine: trigger type → notify users |
| `activity` | Audit trail of all entity changes |
| `documents` | Document metadata with versioning and access level |
| `messages` | In-app threaded messages per project/task |
| `meetings` | Meeting records (WRM, BRM, CFT) with action items |
| `squad` | Charter squad members (from charter creation) |
| `vendors` | Vendor records linked to charters |

---

## 5. User Roles & Approval Workflow

The app includes a **Role Switcher** in the sidebar so a single user can simulate any role.

### Charter Approval Flow

```
draft → submitted → parallel_review → scm_review → chairman_review → finance_review → pmo_review → approved → active
```

Parallel review: HOD + Executive Director + CFO all approve simultaneously.
After all three approve, SCM enters the final negotiated price, then Chairman approves.

### Seed Users (for testing)

| Name | Role | Department |
|------|------|-----------|
| Alice Sharma | initiator | IT |
| Bob Patel | hod | IT |
| Carol Singh | executive_director | Executive |
| Dave Kumar | cfo | Finance |
| Eve Mehta | scm | SCM |
| Frank Thomas | chairman | Executive |
| Grace Nair | pmo | PMO |
| Henry D'Souza | pm | IT |

---

## 6. Completed Tasks

### ✅ Task #1 — Foundation: Schema, Hierarchy & Lifecycle Engine
Extended the database with the full FRS-compliant schema:
- `portfolios`, `programs`, updated `projects` (hierarchy, RAG, scoring, CapEx/OpEx, priority P0–P4, 14-stage lifecycle enum)
- `workstreams`, `project_stages`, `documents`, `issues`, `messages`, `resource_allocations`, `budget_lines`, `escalation_rules`, `scoring_criteria`, `project_scores`, `notifications`
- Extended `tasks` (subtasks, priority, effort, schedule variance, CFT fields, RAG)
- Extended `milestones` (gate decision, readiness checklist, planned effort)
- Full OpenAPI spec update and codegen re-run

### ✅ Task #2 — Project Lifecycle Stage-Gate UI
- 14-stage horizontal stepper on project detail page
- Per-stage panels: document checklists, mandatory items, approval history, role-gated action buttons
- Stage advance blocking rules (e.g., Go Live blocked without UAT sign-off)
- NFA approval auto-trigger when budget exceeds threshold
- Closure report generation and project archiving

### ✅ Task #3 — WBS Task Grid, Board & Execution
- Four-tab project detail view: Lifecycle, Grid, Gantt, Board, Analytics
- Virtualized task grid with inline editing (status, priority, dates, effort, owner)
- Subtask support with expand/collapse; parent RAG rolls up from children
- Kanban board with drag-and-drop between status columns
- Task detail drawer with issues, time logs, and messaging
- Critical path calculation (longest dependency chain)
- Issue Raise modal linked to tasks/milestones
- Progress tracking rings (Milestone %, Task Completion %, Overall %)
- Schedule variance auto-calculation
- Search and filter bar (name, owner, status, priority, date range)

### ✅ Task #4 — Multi-Level Dashboards & Portfolio View
- Role-aware dashboard router (Executive / PMO / PM / Functional Head)
- **Executive Dashboard**: KPI tiles (Active Projects, RAG counts, Budget Variance ₹/%, Schedule Variance), Top Strategic Projects table (with Sponsor, Due Date, XLSX export), Top Risks table, Upcoming Deadlines, Change Requests summary (real aggregated data)
- **PMO Dashboard**: Intake pipeline, Scoring rank table, Capacity heatmap, Stage-gate compliance, RAG trend chart
- Weighted Scoring admin UI (`/admin/scoring`) — PMO only, weight-sum validated (must = 100%)
- **PM Dashboard**: My active projects with dual-ring baseline vs actual overlay, per-project Actual vs Baseline bar, issues/CRs/budget stat row
- **Functional Head Dashboard**: Function KPIs, RAG pie, utilisation gauge, resource conflicts
- Department Portfolio view (`/portfolio`) with filter, drill-down
- Dashboard auto-refresh (1/5/15 min / Manual) with "Last Refreshed" timestamp
- Export to Excel on key tables

### ✅ Task #15 — Time Tracking (Actual vs Planned Effort)
- New `timelogs` table (taskId, userId, date, hours, note)
- `GET /tasks/:id/timelogs` — list enriched with userName
- `POST /tasks/:id/timelogs` — validates task exists, inserts, syncs `tasks.actualHours` to running sum
- `LogTimeModal` component — effort progress bar, entry list, date/hours/user/note form
- Task Grid: new "Actual hrs" column (indigo tint when > 0), "Log Time" button per row
- Board cards: "Log" button (does not open drawer)
- Board task detail drawer: Time Logs section with total vs planned bar + per-entry list

---

## 7. Tasks In Progress

### ✅ Task #5 — Risk Register, RAID & Escalation Management (COMPLETE)

**Built (frontend tabs wired into `project-detail.tsx`):**
- `risk-tab.tsx` — Risk Register table + 5×5 heat map (probability × impact), click-to-filter zones, severity badge for score ≥ 15, "Add Risk" modal. Maps text levels (`very_low|low|medium|high|very_high`) ↔ numeric 1–5.
- `issues-tab.tsx` — Aggregated project issues with status tiles + filters (status/owner/dept), inline status updates, delete.
- `raci-tab.tsx` — Tasks × users matrix with R/A/C/I selects, CSV export, over-allocation warning (>5 R+A). Note: backend has no PATCH endpoint → cell update = delete-then-create (small race risk on rapid edits).
- `escalation-rules-tab.tsx` — PMO/ED/Chairman-only; create/toggle/delete rules with trigger types (rag_change / budget_overrun_pct / schedule_slip_days / risk_score / issue_open_days).

**Deferred / Out of scope:**
- **Action Items tab** — Skipped. Schema for meetings/meeting_items exists but no API routes/hooks → would require backend work first.
- **Escalation rules server-side authorization** — Frontend gates by role, but API has no role enforcement (consistent with the rest of the codebase, no auth model yet). Add when system-wide auth is introduced.
- **Risk update/delete** — No PATCH/DELETE endpoint for risks in spec; register is currently add-only on the UI.

**Original spec (for reference):**

**What to build:**
- **Risk Register tab** on project detail: sortable table (Risk ID, Description, Category, Probability 1–5, Impact 1–5, Risk Score P×I, Owner, Mitigation Plan, Mitigation Due Date, Status)
- **Risk Heat Map**: 5×5 SVG/CSS grid. Colour zones: green (1–4), amber (5–9), red (10–25). Clickable dots open risk popover. Clicking zone filters table below
- Risk score ≥ 15 → auto-insert notification for PM + Sponsor + Functional Head
- **Issues tab**: aggregate all issues across tasks/milestones; filterable by status/owner/dept; inline status updates; link issues to risks
- **Action Items tab**: meeting type (WRM/BRM/CFT/Other), date, action, owner, deadline, status chip. Bulk creation from a meeting record
- **Escalation Rules panel** (PMO/Admin only): create rules (trigger type → threshold → notify contacts). Backend fires rules on RAG change / date update / budget update. Log to `escalation_events` table
- **RACI Matrix tab**: rows = tasks/workstreams, columns = team members, R/A/C/I per cell. Flag over-allocation. Export to Excel

**Key files:**
- `artifacts/project-hub/src/pages/project-detail.tsx`
- `artifacts/api-server/src/routes/projects.ts`
- `lib/db/src/schema/risks.ts`, `meetings.ts`, `issues.ts`
- `lib/api-spec/openapi.yaml`

---

## 8. Pending Tasks

### 📋 Task #6 — Resource Planning, Budget Management & Document Repository

**What to build:**
- **Resource tab**: allocation grid (users × months, cells = %, amber if > 100%). Add Resource form drawer. Capacity Forecast stacked bar chart (Recharts)
- **Budget tab**: CapEx/OpEx table (Baseline vs Forecast vs Actual vs Variance). Summary row. Recharts bar chart. Amber alert if variance > threshold → triggers NFA workflow
- **Document Repository** (`/documents` and project "Documents" tab): folder/list view by stage; version auto-increment; check-in/check-out locking; access permissions (Public/Restricted/Confidential); full-text search; category tags (URS, RFP, NFA, Charter, Contract, UAT, Closure)

### 📋 Task #7 — Communication, Audit Trail & Notifications

**What to build:**
- **Notification centre** (bell icon top bar): list of unread/read notifications; mark-as-read; link to entity
- **Audit Trail** tab per project: every entity change logged with user, timestamp, field, old/new value. Exportable to Excel/PDF
- **In-app messaging** per task/milestone: threaded comments, @mentions, attachment support
- **Meeting records**: create WRM/BRM/CFT meeting → add action items → track follow-ups
- **Email digest** (optional): daily/weekly summary to PM of overdue items

### 📋 Task #8 — UI/UX Polish: Monday.com-Grade Design System

**What to build:**
- Design tokens in Tailwind config (brand colours, semantic status colours, spacing, shadows)
- Sidebar redesign: collapsible icon-only mode, mobile hamburger overlay
- Global search command palette (Cmd+K): queries projects, tasks, documents, users
- Micro-animations: route transitions, skeleton loaders, button loading spinners, modal/drawer animations
- Empty states and error states as reusable components
- Dark mode (CSS variable toggle, persisted in localStorage)
- Accessibility pass: ARIA labels, keyboard navigation, WCAG AA contrast
- Cross-browser QA (Chrome, Edge, Safari, Firefox)

### 📋 Task #18 — Live Notifications When Projects Go Off-Track

- WebSocket or SSE channel for real-time push of notification records
- Bell icon badge auto-updates without page refresh
- Toast popup on new high-priority notifications

### 📋 Task #19 — Capacity Heatmap Connected to Real Allocation Data

- Connect the PMO dashboard capacity heatmap to live `resource_allocations` rows
- Aggregate by function/role and month, compare to baseline headcount targets
- Highlight over-allocated cells in red

### 📋 Task #20 — PDF-Friendly Print Layout for Dashboard Exports

- "Export PDF" button on each dashboard section
- Uses `window.print()` with a print-specific CSS stylesheet or a headless puppeteer/html2canvas approach
- Covers: Executive Dashboard summary, Project Snapshot card, Risk Register table

### 📋 Task #21 — Effort Burn Across All Tasks on Analytics Tab

- Analytics tab (already exists with burndown) needs an **Effort Burn** chart
- X axis: weeks; Y axis: cumulative planned vs actual hours
- Data from `tasks.plannedEffortHours` (planned) and `timelogs` sum (actual)
- Show per-workstream breakdown as stacked bars

### 📋 Task #22 — Delete or Correct a Time Log Entry

- `DELETE /tasks/:taskId/timelogs/:id` — removes entry, re-syncs `actualHours`
- `PATCH /tasks/:taskId/timelogs/:id` — update date, hours, or note; re-syncs `actualHours`
- UI: edit icon and delete (trash) icon on each timelog row in the LogTimeModal and drawer timelog list

### 📋 Task #23 — Warn PMs When Logged Hours Exceed Planned Effort

- When `POST /tasks/:id/timelogs` causes `actualHours > plannedEffortHours`, insert a notification for the task assignee and project PM
- Frontend: show an amber banner in LogTimeModal when over-logged
- Task Grid: show the "Actual hrs" cell in red when `actualHours > plannedEffortHours`

---

## 9. Key Architectural Decisions

1. **Contract-first API**: All routes must match the OpenAPI spec in `lib/api-spec/openapi.yaml`. After any spec change, run `pnpm --filter @workspace/api-spec run codegen` to regenerate hooks and Zod schemas. Never edit generated files manually.

2. **No `console.log` in server code**: Use `req.log` in route handlers and the singleton `logger` for non-request code.

3. **DB push, not migrations**: Development uses `pnpm --filter @workspace/db run push` (Drizzle push). There are no migration files.

4. **Role simulation**: The frontend has a role switcher (Zustand store) that sets the active role for API calls. The backend trusts the `x-user-id` and `x-user-role` headers sent by the frontend. This is for demo/development — not production auth.

5. **Numeric fields**: PostgreSQL `numeric` columns come back as strings from `pg`. Always `parseFloat()` or `Number()` before arithmetic in route handlers.

6. **Typecheck pre-existing errors**: There are some pre-existing TS errors in `lib/api-zod` (duplicate exports from codegen drift). These are known and non-blocking — the app runs fine. Do not introduce new errors.

---

## 10. Files to Know Well

| File | What it does |
|------|-------------|
| `lib/api-spec/openapi.yaml` | Single source of truth for all API contracts |
| `lib/db/src/schema/index.ts` | Re-exports all table schemas |
| `artifacts/api-server/src/routes/projects.ts` | ~80% of all business logic routes |
| `artifacts/api-server/src/routes/dashboard.ts` | Dashboard summary and role-scoped data |
| `artifacts/project-hub/src/pages/project-detail.tsx` | Main project page (tabs, drawer, board) |
| `artifacts/project-hub/src/pages/dashboard.tsx` | Role-aware dashboard router |
| `artifacts/project-hub/src/components/task-grid.tsx` | WBS task grid with inline editing |
| `artifacts/project-hub/src/components/connect-board.tsx` | Kanban board |
| `artifacts/project-hub/src/components/log-time-modal.tsx` | Time logging modal |
| `scripts/src/seed.ts` | DB seed script — run once after setup |
| `scripts/post-merge.sh` | Auto-run after task merges: install + db push |
