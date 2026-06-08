# Ask NYRA — AI Analyst for the Project Hub (PMO)

## Executive summary

We've embedded **NYRA**, a conversational AI analyst, directly into the PMO Project Hub. Anyone on the team can now ask plain-English questions about the project portfolio — *"Which projects are at risk?"*, *"How many tasks are overdue, by project?"*, *"Show milestones due this month"* — and get an instant, accurate answer drawn from **live data**, not stale reports or guesswork.

It turns the Project Hub from a place you *navigate* into a place you can *interrogate* — board-room answers in seconds, with the underlying numbers always one click away.

---

## What it does

| Capability | What it means for the business |
|---|---|
| **Natural-language Q&A** | No dashboards to learn, no filters to configure. Ask the way you'd ask a senior analyst. |
| **Live, grounded answers** | Every figure comes from the live portfolio database in real time. NYRA never invents or estimates — if the data isn't there, it says so. |
| **Full transparency** | Each answer ships with a collapsible *"queries run"* panel showing exactly what was checked and how many records — auditable, not a black box. |
| **Executive formatting** | Answers lead with the key numbers (bolded), then crisp insight bullets and compact tables — built to be read, not waded through. |
| **Always available** | One **Ask NYRA** button in the top header opens it on any page, in any workflow. |

**Example, verified live:** *"How many projects are there, and how many are amber or red?"* → **"36 projects total; 2 flagged amber or red — only ~6% of the portfolio is currently at risk."** — answered in seconds, straight from the database.

---

## How it works (in plain terms)

NYRA understands the structure of the entire project portfolio — projects, stages, milestones, tasks, risks, issues, charters, owners, budgets, RAG status, progress, dates. When you ask a question, it:

1. **Translates** your question into a precise database query,
2. **Runs it** against the live portfolio,
3. **Reads the real results**, and
4. **Answers** in clear, executive language — citing the actual numbers it retrieved.

If it needs to dig deeper, it asks follow-up queries automatically before answering.

---

## Built-in trust & security

This was engineered to be safe to put in front of the whole organisation:

- **Read-only by design** — NYRA can *look*, never *touch*. Any attempt to modify data is blocked at multiple layers.
- **Scoped to the portfolio only** — it can query project data exclusively. Sensitive HR/recruitment data that shares the same database is **hard-walled off** and unreachable.
- **Grounded, not generative-guessing** — answers are constrained to retrieved facts; fabrication is explicitly prevented.
- **Authenticated** — only logged-in Project Hub users can use it.
- **Auditable** — every query NYRA runs is surfaced to the user.

*(Every one of these guardrails was tested: write attempts, cross-database access attempts, and injection attempts were all correctly blocked.)*

---

## Experience & design

We also polished the surrounding experience so the feature looks as good as it works:

- **Premium chat interface** — a frosted-glass panel with a gradient NYRA identity, live-status indicator, smooth entrance animation, typing indicator, suggested-question shortcuts, rich tables/formatting, and a one-tap "new conversation" reset.
- **Refined header** — a distinctive **Ask NYRA** gradient button sits beside the settings icon; clean, on-brand, unmistakably the AI entry point.
- **Role-aware "View as" switcher** — a full role dropdown in the top bar lets authorised users preview the Hub from any role's perspective (Exec, PMO, PM, Finance, etc.), consolidating what used to be a scattered control into one tidy header menu.

---

## Status

**Live and verified** in the Project Hub today — end-to-end tested against real portfolio data, with all security guardrails confirmed. Consistent in look and capability with the same NYRA analyst already running in the CXO Central Command dashboard, so it's a coherent, enterprise-wide AI experience rather than a one-off.

---

## Access

- **Live app:** http://172.30.101.2:5182 → log in → click **Ask NYRA** (top-right of the header, next to the settings icon).
