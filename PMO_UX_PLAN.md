# PMO "Project Hub" — Usability & UI/UX Improvement Plan

**Date:** 2026-06-17
**App:** `apps/pmo/artifacts/project-hub` (React 18 + wouter + TanStack Query + Tailwind, ~238 files, ~40 routes)
**Status:** planning doc. Approve an item → I produce the diff.

Audited the live frontend before writing. The headline: **most high-value fixes are
"wire up something that already exists," not new builds.** The repo already ships `cmdk`,
a `breadcrumb` primitive, the suite `FormModal`, a saved-views engine, skeletons, and a
notification bell — several are unused or half-rolled-out. That makes these cheap.

Ranked by **(user impact ÷ effort)**. Each says what's there to reuse so nothing is rebuilt.

---

## Tier 1 — Cheap, high-impact (wire up what's already installed)

### 1. Global command palette (Cmd-K) + make header search actually work
**Friction:** The header search box is a **placeholder — not wired to anything**. For a 40-route
app, there's no fast way to jump to a project/charter/RFP. The only global shortcut is Cmd-B.
**User win:** Type `Cmd-K` → fuzzy-jump to any project, page, or action. The single biggest
navigation speed-up.
**Lazy build:** `cmdk` is **already installed** (`components/ui/command.tsx`, used in comms
drawers). Mount one global `<CommandDialog>` in `Layout.tsx`, feed it the route list from
`App.tsx` + a `/api/projects` quick query. Bind `Cmd-K`. Wire the existing header search input
to open the same palette.
**Files:** `Layout.tsx` (+1 dialog, +1 key listener), reuse `ui/command.tsx`. ~80 lines.
`// ponytail: static route list + projects query; add full-text search across docs only if asked`

### 2. Breadcrumbs on deep routes
**Friction:** `project-detail` (1308 lines), `charter-detail`, `rfx-detail` have **no breadcrumb
trail**. Users lose orientation on nested pages and rely on the back button.
**User win:** "Portfolio › Project X › Charter" — always know where you are, one-click up.
**Lazy build:** `ui/breadcrumb.tsx` **exists with zero consumers.** Drop it into the ~5 detail
page headers. No new component.
**Files:** the detail pages' header rows. ~5 lines each.

### 3. Unified "Needs my attention" inbox
**Friction:** Action discovery is scattered across **4 places** — the bell, Approvals page,
Nudges page, My Tasks. A user can't answer "what do I owe today?" in one glance.
**User win:** One inbox = pending approvals + overdue tasks + open nudges, grouped, each with a
deep-link. The home a busy PM/exec actually wants.
**Lazy build:** The data already powers the bell (`notification-bell.tsx` polls every 30s) and
those 4 pages. Make `/my-tasks` (or a new `/inbox`) a thin aggregator over the **existing**
endpoints — no new backend. Reuse the bell's `NudgeRow` + dedup logic.
**Files:** one page component aggregating current queries. Medium-small.

### 4. Standardize loading on skeletons (kill the spinner/skeleton split)
**Friction:** ~20 pages use skeletons, **29 still use spinners** — inconsistent, and spinners on
heavy surfaces (task-grid, project-detail) feel slower than they are.
**User win:** Consistent, faster-feeling loads.
**Lazy build:** Skeleton components already exist and are used. Replace the `Loader2`/`animate-spin`
blocks on the heavy surfaces with the existing skeletons. Mechanical.
`// ponytail: convert the heavy 5 surfaces first (task-grid, project-detail, portfolio-overview, projects, approvals); leave trivial spinners`

---

## Tier 2 — Real UX depth (moderate effort)

### 5. Bulk multi-select + bulk actions on lists
**Friction:** Multi-select exists in **only** `task-grid`/`nudges`. A PMO tool managing hundreds of
tasks/projects has no "select rows → set status / reassign / move" anywhere else.
**User win:** Reassign 20 tasks in one move instead of 20. Core PMO productivity.
**Lazy build:** Generalize the `task-grid` selection pattern into a small `useRowSelection` hook +
a sticky bulk-action bar; apply to projects list and tasks. Backend already has the per-row
PATCH endpoints — bulk = loop or one batch route.
**Files:** 1 hook + 1 toolbar component + wire 2-3 lists. Medium.

### 6. Wizard-ify the long intake forms
**Friction:** Charter (721 lines), NFA (499), RFP, PIF are **long single-page dense forms** with no
stepping or progress affordance — the highest-friction surfaces in the app.
**User win:** Step-by-step with a progress bar; less abandonment; "save & continue later."
**Lazy build:** The suite `FormModal` has a **built-in `wizard` mode** (`size="wizard"` + stepper)
— and this app currently uses it **nowhere** (22 hand-rolled Radix dialogs instead). Adopt
`FormModal` wizard for these 4 intakes. Also folds in #8 below.
**Files:** refactor 4 intake forms onto `FormModal`. Larger but high-value; can do one at a time.

### 7. First-run + better empty states
**Friction:** Empty states are **passive one-liners** ("No tasks match…") with no CTA — except the
polished `projects.tsx` empty state, which is decorative without a clear "create your first" button.
No product tour, no coachmarks.
**User win:** A new user lands and knows the next step. Adoption.
**Lazy build:** Add a small `<EmptyState icon title body cta>` component and use it across the
list/board empties (replace the muted-text lines). Skip a full product tour for v1 — a good empty
state with a CTA covers 80%. `// ponytail: empty-state component, not a tour library`
**Files:** 1 component + swap ~10 one-liner empties.

---

## Tier 3 — Consistency / debt (do alongside the above)

### 8. Migrate hand-rolled dialogs to `FormModal`
**22 files hand-roll Radix `DialogContent`** — against the suite convention, giving inconsistent
header/footer/gradient/mobile-fullscreen vs portal & OHC. Migrate opportunistically (every time you
touch a dialog, convert it). Pairs with #6.

### 9. Finish the saved-views rollout
The `use-user-view` engine defines a **`task_grid` scope that's never wired** — `views-menu` only
appears on projects + 2 dashboards. Add the existing `<ViewsMenu>` to the task pages. ~Reuse only.

### 10. Delete legacy duplicates
`project-detail.legacy.tsx` and `portfolio.tsx` (legacy) shadow live surfaces — drift + confusion.
Confirm dead, delete. (Same hygiene call as the dead `ViewSwitcher` and `pmo-suite` clone in the
other plan.)

---

## UI / visual & interaction polish (small, cumulative)

These are quick, low-risk, and use the existing design system (`design-system.css`, RAG palette,
`.zone-*`, shared toasts):

- **Dark mode follows OS by default.** `use-theme.ts` defaults to light and ignores
  `prefers-color-scheme`. One line: seed initial theme from the media query.
- **"?" keyboard-shortcut overlay.** Once #1 lands, add a `?`-triggered cheat-sheet (Cmd-K, Cmd-B,
  Esc). Tiny, signals "power tool."
- **Optimistic mutations beyond boards.** Only 5 surfaces are optimistic (the drag boards). Extend
  `onMutate` to the common single-field edits (status, assignee, due-date) so they feel instant.
- **Sticky table headers + column freeze** on the dense grids (task-grid 1357, portfolio drill
  tables) — long scrolls lose context. Pure CSS (`position: sticky`).
- **Consistent status color = RAG only.** Reuse the suite rule (Completed = green, never blue;
  `.zone-*`). Audit the PMO grids/badges the way CXO was standardized.
- **Mobile: surface hidden header actions.** Connectors/Settings are `hidden sm:flex`; move them into
  the mobile drawer so they're reachable on a phone.
- **Toast → action link.** Save toasts confirm but don't link; add "View" / "Undo" where cheap
  (e.g. after bulk actions in #5).

---

## Recommended sequence (all reuse-heavy, ship incrementally)

1. **Quick wins first (1 PR):** #1 command palette + #2 breadcrumbs + the OS-dark-mode and sticky-header
   polish. Highest impact-per-line; everything needed is already installed.
2. **Then:** #4 skeleton standardization + #3 unified inbox.
3. **Then depth:** #5 bulk actions, then #6 wizard intakes (one form at a time), #7 empty states.
4. **Continuous:** #8 FormModal migration, #9 saved-views, #10 delete legacy — whenever you're in the file.

Skipped deliberately (YAGNI until asked): full product-tour/coachmark library, real-time
collaborative cursors, a native mobile app. The empty-state CTA (#7) and the responsive sweep cover
the actual pain without them.
