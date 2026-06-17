# PMO "Project Hub" — Improvement Plan (grounded)

**Date:** 2026-06-17
**App:** `apps/pmo` (live; web :5182, API :3008). The `artifacts/{api-server,project-hub}` tree is the real one.
**Status:** planning doc. Approve an item → I produce the diff. Nothing here rebuilds what exists.

This plan supersedes the earlier gap-analysis. Every claim below was re-verified against
the code before writing. **Two findings from the original analysis turned out to be wrong**
and changed the design — flagged inline.

---

## Corrections to the original analysis (verified in code)

1. **`monday/ViewSwitcher.tsx` is dead code.** It is not imported anywhere. The live
   saved-view system is the `useUserView` hook (`hooks/use-user-view.ts`), a different
   mechanism. → The recommended "add a Workload view to ViewSwitcher" is a dead end. The
   workload heatmap belongs in the dashboards that **already** fetch capacity data
   (`PortfolioDashboard.tsx`, `FunctionalHeadDashboard.tsx`).

2. **There is no per-person capacity anywhere.** `pmo_resource_allocations` stores only a
   `allocation_pct` (no FTE, no hours/day, no leave). The existing `capacity-demand`
   endpoint *synthesizes* capacity as `headcount × 100%`. → A v1 leveling feature can reuse
   that same 100%-per-head assumption per-person and **needs no new table**. An FTE/leave
   source is a later add, only if part-time/leave accuracy is actually demanded.

---

## Verified bottlenecks (all 5 TRUE) and the lazy disposition

| # | Bottleneck | Verified | Lazy call |
|---|---|---|---|
| 1 | Two approval engines: DOA resolver seeds only the stage-1 fan-out (`charters.ts:276`), then a hardcoded `parallel_review→scm→chairman→finance→pmo` machine (`approvals.ts:172-211`) drives the rest and discards the resolved chain | ✅ | **Real refactor, not now.** Consolidate onto DOA only when a chain needs to differ from the hardcoded path. Until then it works. Tracked, not built. |
| 2 | Single-process `setInterval` scheduler (`scheduler.ts`), 5 jobs (escalations, nudges, sap-sync, teams-sync, stage-escalation emails) | ✅ | **Leave it.** Already gated behind `ENABLE_SCHEDULER=true` with an intended one-process deploy (`scheduler.ts:10-13`). Not a live bug at 1 replica. Add a DB advisory-lock guard the day you go multi-replica — not before. `// ponytail: single-process scheduler, advisory-lock if it ever runs >1 replica` |
| 3 | Dead duplicate codebase `apps/pmo-suite/pmo/Project-Charter-Flow` (no `.git`, stale mtimes ≤Jun-15, win32 dep cruft) | ✅ | **Delete after one confirmation.** Pure maintenance-drag removal, no runtime risk. Needs explicit go-ahead since I didn't create it. ~1 line of work. |
| 4 | CPM is unitless day-offsets, fallback `estimatedHours/8` or 1 day, no weekend/holiday calendar (`critical-path-cpm.ts:23,81-90`) | ✅ | **Roadmap #2.** Genuine "gantt feels half-built" fix. Medium effort. |
| 5 | SAP/Teams adapters default to mock; the "real" adapters throw `"not wired yet"` (`integrations/{sap,teams}/index.ts`). GitHub/MCP are declared-but-unimplemented config kinds | ✅ | **Hide the toggle.** Don't expose "switch to real" in the UI until a real adapter exists; leaving `SAP_MODE`/`TEAMS_MODE` unset keeps the working mock path. Cheap. Low priority. |

**Fix-first, this sprint (cheap, high signal-to-noise):** #3 (delete clone, on confirm) and
#5 (don't surface non-functional integration toggles). #2 stays as a documented ceiling.
#1 and #4 are real work — schedule deliberately.

---

## First build — Resource Capacity & Leveling

Biggest genuine PPM gap, data already exists, **no new table**, no new dependency, immediately
visible to PMs and FHs. Scope: one endpoint + one dashboard section + an over-allocation badge.

### What exists today (reuse, don't rebuild)
- `pmo_resource_allocations` rows: `{project_id, user_id, role, skill, allocation_pct, start_date, end_date}` (`lib/db/src/schema/resource_allocations.ts:5`). `user_id` → `pmo_users.id` (`name, email, role, department`). Dates are `YYYY-MM-DD` text. Entry already allows `allocationPct` up to 200 (`resource-tab.tsx:331`) — **overallocation is enterable but never flagged anywhere.**
- `GET /dashboard/capacity-demand` (`dashboard.ts:267`) already does the month-window + overlap math, but pivots by **department × month** with `capacity = headcount × 100`. We pivot the same data by **person**.
- `PortfolioDashboard.tsx` (heatmap render at ~:765) and `FunctionalHeadDashboard.tsx` (conflict detection `utilization>100` at :107) already fetch and render this shape. Add the new view next to them.

### The gap (one sentence)
No view sums one person's `allocation_pct` **across all their projects** to show who is booked
>100%, when, and on what.

### Build

**1. Endpoint — `GET /dashboard/resource-load` in `routes/dashboard.ts`**
Clone the `capacity-demand` structure (same 6-month rolling window, same `start/end` month-string
overlap test) but group by `user_id` instead of `department`. For each person × month:
- `allocatedPct` = Σ `allocation_pct` of that user's allocations overlapping the month, across **all** projects.
- `capacity` = `100` (`// ponytail: flat 100% per head, same assumption as capacity-demand; add an FTE/leave source only when part-time accuracy is demanded`).
- `overAllocated` = `allocatedPct > 100`.
- Include a per-cell `projects: [{projectId, projectName, pct}]` breakdown so the UI can answer "overloaded on what" without a second call.

Return:
```jsonc
{
  "months": ["Jun 26", ...],            // 6 labels, same as capacity-demand
  "people": [
    { "userId": 12, "name": "...", "department": "...",
      "cells": [ { "monthKey":"2026-06", "allocatedPct":140, "capacity":100,
                   "overAllocated": true,
                   "projects":[{"projectId":3,"projectName":"X","pct":100},
                               {"projectId":7,"projectName":"Y","pct":40}] } ]
    }
  ],
  "overAllocatedCount": 4               // people with ≥1 overloaded month — drives the badge
}
```
No guard (matches `capacity-demand`, a read). Imports already in the file (`db`, `resourceAllocationsTable`, `usersTable`, `projectsTable`).

**2. UI — "Workload" section in the existing dashboards (NOT ViewSwitcher)**
- Person × month heatmap. Cell color = utilization band using the suite RAG palette
  (`.zone-*` from `design-system.css`): green ≤100, light-red 101–150, red >150. **Reuse the
  existing heatmap markup** in `PortfolioDashboard.tsx` — don't write a new grid component.
- Hover/click a red cell → the `projects[]` breakdown (which projects sum to the overload).
- An **over-allocation badge** (`overAllocatedCount`) on the dashboard header.
- Add it to `FunctionalHeadDashboard.tsx` too (FHs are the audience for their own department's load).

**3. Skip for v1 (add when asked):**
- Auto-leveling / reassignment suggestions — **flag only, don't auto-move people.**
- FTE / leave / working-hours capacity — flat 100% until accuracy is demanded.
- Weekly granularity — months match the existing endpoint; go weekly only if PMs ask.

### Files touched
- `artifacts/api-server/src/routes/dashboard.ts` — +1 endpoint (~40 lines, paralleling `capacity-demand`).
- `artifacts/project-hub/src/components/.../PortfolioDashboard.tsx` + `FunctionalHeadDashboard.tsx` — +1 section + badge, reusing the existing heatmap.
- No schema migration. No new dependency.

### Verification
- Backend `artifacts/api-server` on :3008, web on :5182 (Vite dev).
- Seed two projects allocating the **same `user_id`** at 100% + 40% over an overlapping date range
  (extend `scripts/src/seed.ts:197`).
- `GET /api/dashboard/resource-load` → assert that user's June `allocatedPct == 140`,
  `overAllocated == true`, `projects` lists both, and `overAllocatedCount >= 1`.
- Playwright headless against :5182: the person's June cell renders red and the badge shows the count.
- One runnable check: a tiny assert script hitting the endpoint against the seeded data
  (`// ponytail: one endpoint self-check, no framework`).

---

## Roadmap for the rest (ranked, condensed — detailed plan on pick)

**Tier 1 — genuine PPM depth**
2. **Working-calendar + auto-reschedule.** Give CPM (`critical-path-cpm.ts`) a weekend+holiday
   list so it emits real calendar dates, and cascade successor dates when one task moves. Also
   schedule cross-project predecessors (today informational only). *Medium effort, highest "feels
   commercial" payoff after #1.*
3. **Earned-value & labor-cost rollup.** Join `pmo_budget_lines` (have) × timelogs (have) ×
   a new `pmo_rate_cards` (person→₹/hr) → SPI/CPI per project + portfolio. *High exec value;
   CXO dashboard sync already exists to surface it.*

**Tier 2 — monday-style polish (stickiness)**
4. **Data-driven automation engine.** The `/automations` page exists but no `automations.ts`
   route does — backend is hardcoded. Make it trigger→condition→action over the existing
   `pmo_activity` event stream + `notify()` sink + the escalation-evaluator job as runner.
5. **Formula / rollup custom columns.** `CustomFieldsEditor` stores fields but can't compute.
   Add formula + rollup types. Pure frontend + small eval, no dependency.
6. **Generic forms-as-view + public intake.** Reuse PIF/demand form components + the existing
   public unauthenticated POST pattern (vendor portal / template downloads).

**Tier 3 — differentiators & reach**
7. **Predictive AI layer.** All ~40 AI endpoints are generative. Add a delay-risk score per
   project from existing signals (schedule variance, open UAT defects, stuck approvals, activity
   gaps) on the portfolio dashboard + smart-assign using the new #1 capacity data. *Leapfrog, not catch-up.*
8. **Integration breadth.** Wire the real SAP/Teams adapters (or hide them — see bottleneck #5),
   add Slack + 2-way calendar. Pick the 4 your users use; don't chase 850.
9. **Collaborative Docs + mobile-responsive pass.** Lowest priority — threaded comments already
   cover most doc needs; mobile = a responsive sweep, not a native app.

---

## Recommended sequence
1. **Now:** Resource Capacity & Leveling (above) — the first build.
2. **Same PR or next:** delete the dead `pmo-suite` clone (on confirm) + hide non-functional
   integration toggles. Cheap hygiene.
3. **Then pick one Tier-1:** working-calendar (#2) or earned-value (#3) — I'll write the detailed plan on selection.

Leave the single-process scheduler and the two-engine approval chain as documented ceilings —
neither is a live bug today; upgrade only when scale (multi-replica) or a divergent approval
chain actually forces it.
