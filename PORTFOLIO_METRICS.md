# Portfolio View — Metrics Reference

A precise definition of every metric, filter, and column on the PMO **Portfolio View** page (`apps/pmo/artifacts/project-hub/src/pages/portfolio.tsx`). Last updated 2026-06-03.

> **Key principle:** nothing on this page is split or bucketed by a percentage threshold. Grouping is by **categorical status**; "health" (RAG) is a **human-set** judgment; percentages (Progress) are **displayed only** and never decide a project's group or health.

---

## 1. Data scope & filter pipeline

All numbers are computed over the **currently filtered set** of projects, in this order:

```
all projects
  → filters.Department   (project.function == selected)
  → filters.Category     (project.category == selected: CAPEX | NPX | CIP | IT)
  → filters.Stage        (project.status   == mapped value, see §5)
  → filters.Priority     (project.priority == selected: P0–P3)
  = filteredProjects   ← KPI boxes, Project Health pie, Budget chart use THIS
      → (optional) Project Health pie click → filter by ragStatus
      = tableProjects  ← the Projects table/Timeline use THIS
```

So the **KPI boxes and pie always reflect the filter bar** (Department/Category/Stage/Priority). Clicking a pie slice filters **only the table**, not the KPIs/pie (so the pie never collapses to one slice).

---

## 2. KPI boxes (the 5 tiles)

Counts over `filteredProjects`. Note the boxes mix **two different dimensions** — health (RAG) for the first two, lifecycle status for the last two:

| Box | Source field | Definition | Color |
|---|---|---|---|
| **Total Projects** | — | `filteredProjects.length` (count matching the filters) | neutral |
| **On Track** | `rag_status` | count where `rag_status = "green"` (a project with **no** RAG set counts as green) | 🟢 green |
| **At Risk** | `rag_status` | count where `rag_status = "amber"` **or** `"red"` | 🟠 amber |
| **On Hold** | `status` | count where `status = "on_hold"` | 🔴 red |
| **Closed** | `status` | count where `status = "closed"` | 🔵 blue |

*Caveat:* On Track / At Risk are **RAG-based** (health), while On Hold / Closed are **status-based** (lifecycle). They are not mutually exclusive — e.g. an `active` project that is `red` counts in **At Risk** but not in On Hold/Closed.

---

## 3. Project Health (RAG distribution pie)

- **What it shows:** the breakdown of `filteredProjects` by **RAG health** — `rag_status` of green / amber / red.
- **Source:** the project's `rag_status` field — **set manually by the PM/PMO** (it is *not* derived from progress, budget, or schedule).
- **Null handling:** projects with no `rag_status` are treated as **green** in the On-Track count, but the pie only plots the three explicit colors.
- **Interaction:** click a slice (or its legend chip) → the **Projects table filters to that health color**; click again / "clear" to reset.

---

## 4. Budget Utilization (bar chart)

- **Per project budget** = `capex_budget + opex_budget`.
- The chart shows the **top 8** projects of the filtered set by name.
- The **Total Budget** figure (where shown) is the **sum** of `capex_budget + opex_budget` across `filteredProjects`.
- Currency formatted via the shared `formatCurrency` (₹, Indian grouping).

---

## 5. Filter bar

| Filter | Field used | Options | Notes |
|---|---|---|---|
| **Department** | `project.function` (from the master employee directory function) | distinct values present in the data | |
| **Category** | `project.category` | CAPEX · NPX · CIP · IT | New investment-category field; null until assigned per project |
| **Stage** | `project.status` (label-mapped) | **Plan**→`planning`, **Execute**→`active`, **Hold**→`on_hold`, **Close**→`closed` | Labeled "Stage" but filters the status field; `completed` is not one of these 4 options |
| **Priority** | `project.priority` | **Critical**=`P0`, **High**=`P1`, **Medium**=`P2`, **Low**=`P3` | Stored values stay P0–P3; only labels are Critical/High/Medium/Low |

---

## 6. Projects table

### Grouping (the section headers)
- **Grouped by:** the project's **`status`** field — **purely categorical, no percentage.**
- **Groups & order:** Active → Planning → On Hold → Completed → Closed (`STATUS_GROUP_META`).
- A group **only appears if it has ≥1 project**. Any unrecognized status falls into a grey catch-all group at the end.
- Current data → only **Active (31), Planning (3), Completed (1)** render; On Hold / Closed are empty so they're hidden.

### Columns
| Column | Source | Definition |
|---|---|---|
| **Project Name** | `name` (+ `function`) | Always shown (anchor column); shows the department beneath |
| **Timeline** | `start_date` → `end_date` | A bar on a **shared min..max date scale** across the visible rows (mini-Gantt); colored by RAG; "—" if start or end missing |
| **Status** | `status` | Lifecycle status chip |
| **Health** | `rag_status` | RAG dot (green/amber/red) |
| **Priority** | `priority` | Critical/High/Medium/Low chip |
| **Category** | `category` | CAPEX/NPX/CIP/IT (— if unset) |
| **Budget** | `capex_budget + opex_budget` | Combined allocation |
| **Progress** | `progress` (rolled up) | **Computed %** = Subtask→Task→Milestone→Project average. **Displayed only — does NOT determine the group or RAG.** |
| **Due** | `end_date` | Project end date |

- **Column chooser** ("Columns" button) toggles any column on/off (Project Name always stays).
- **Row click** → opens the project detail page.

---

## 7. What is (and isn't) percentage-driven

| Surface | Driven by | % threshold? |
|---|---|---|
| Table grouping (Active/Planning/Completed…) | `status` | **No** — categorical |
| KPI On Track / At Risk | `rag_status` (human-set) | **No** |
| KPI On Hold / Closed | `status` | **No** |
| Project Health pie | `rag_status` (human-set) | **No** |
| Progress column | rolled-up `progress_pct` | It *is* a %, but it only displays — it never reclassifies a project |

If you want a **percentage rule** introduced — e.g. auto-mark a project **At Risk** when `progress` lags its elapsed schedule, or auto-move to **Completed** at 100% — that's a deliberate rule we can add. It does **not** exist today.

---

## 8. Rollup chain (where Progress comes from)

`progress_pct` is computed bottom-up on every task/milestone write (`lib/rollup.ts`):

```
Subtask %  → Task %     (avg of children)
Task %     → Milestone % (avg of top-level tasks)
Milestone % → Project %  (avg of contributing milestones)
Project %  → Portfolio   (avg on read, exec view)
```

RAG and gate decisions are **excluded** from this rollup on purpose — they remain human-controlled governance signals.
