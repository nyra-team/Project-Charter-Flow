# Project Hub (PMO) — Executive Product Summary

**Granules AI‑Powered Platform · 3 June 2026**

---

## 1. What it is

**Project Hub** is the enterprise **Project & Portfolio Management (PPM)** platform for Granules. It runs the entire project journey end‑to‑end — from demand intake → procurement → execution → go‑live → closure — under hard governance gates, with an approval engine, automatic escalations, full procurement/sourcing, and live portfolio reporting.

What makes it different: all of that enterprise governance is wrapped in a **Monday.com‑style, modern work‑management experience** (drag‑and‑drop boards, Gantt timelines, calendars, work‑breakdown trees) — and now an **embedded AI analyst, NYRA**, that answers questions about the portfolio in plain English.

> **One sentence for the boss:** Project Hub gives Granules a single, governed system of record for every project — as easy to use as Monday.com, as rigorous as a formal PMO, and now AI‑assisted.

---

## 2. Why it matters (business value)

| Outcome | How Project Hub delivers it |
|---|---|
| **Governance you can trust** | Projects cannot skip stages or controls — every gate (budget approved, URS signed, UAT passed, etc.) is enforced by the system, not by memory or email. |
| **One source of truth** | Progress rolls up automatically from subtask → task → milestone → project → portfolio. Leadership sees real, live status — not hand‑built slides. |
| **Faster, cleaner approvals** | Charters, investment authorizations and change requests flow through structured, auditable approval chains instead of email threads. |
| **Nothing slips silently** | Automated escalations chase overdue stages up the chain; AI nudges flag what needs attention. |
| **Procurement done right** | Full sourcing (RFI/RFP/RFQ) with sealed, encrypted bids and a dedicated external vendor portal. |
| **Decisions in seconds** | Ask NYRA answers portfolio questions instantly from live data, with the supporting numbers always visible. |
| **Connected, not siloed** | Two‑way Jira sync, Teams meeting capture, and SAP PR/PO integration. |

---

## 3. Core capabilities

### A. Governed project lifecycle (the backbone)
- **3 phases, 13 stages** — the canonical Granules project life cycle:
  - **Plan** — Business Requirements · Request for Proposal · Vendor Evaluation & Finalization · Solution Design · Project Plan
  - **Execute** — Development & Configuration · System Testing & Validation · Deployment Readiness · Production Deployment & Go‑Live
  - **Close** — Business Closure · Operational Handover · Financial Closure · PMO Closure
- **Adapts to project type** — vendor‑led projects run the full sourcing path; internal projects skip the vendor stages.
- **Hard governance gates**: each stage has a blocking checklist, required documents, and authorised roles. A project can only advance when every condition is met — enforced on the server, never bypassable from the UI.
- **Sub‑gates** for Business Case and URS approval, test/defect closure, and mandatory lessons‑learned at closure.

### B. Monday.com‑style work management
- **Work‑Breakdown Structure tree** (Stage → Milestone → Task → Subtask) with drag‑and‑drop reparenting, inline editing, and animated expand/collapse.
- **Five interchangeable views on the same data**: Tree (WBS), Kanban Board, Table/Grid, Gantt Timeline, and Calendar.
- **Automatic progress rollups** — update one subtask and the whole tree, project, and portfolio reflect it instantly.
- **RASCI ownership matrix** (Responsible / Accountable / Support / Consulted / Informed) with over‑allocation warnings and CSV export.
- **Time logging, comments, resource allocation, and reusable project templates.**

### C. Critical Path & dependencies
- True **Critical Path Method (CPM)** engine — forward/backward pass, slack/float calculation, automatic critical‑task flagging, and **cycle‑safe** dependency validation.
- Task dependencies (in‑project and cross‑project) editable directly from the task panel.
- A separate **governance critical path** highlights which lifecycle stage is blocking, who owns it, and how overdue it is — feeding the escalation engine.

### D. Portfolio & executive dashboards
- **Role‑specific dashboards** for Executives, Functional Heads, Project Managers, the Portfolio office, and general users.
- Portfolio rollups with **RAG (Red/Amber/Green) distribution, at‑risk and delayed counts**, and average progress (closed projects excluded).

### E. Approvals & change control
- Multi‑stage **charter approvals** (parallel review → SCM → Chairman → Finance → PMO).
- **Change requests** snapshot baseline vs. proposed; only submitted CRs are decidable; decided CRs are locked for a clean audit trail.

### F. Automated escalations & AI nudges
- **Condition‑based rules** (RAG change, budget overrun, schedule slip, risk score, open issues, blocked stages) → instant in‑app alerts.
- **Stage escalation ladder** — overdue stages trigger tiered reminders/escalations to the right role automatically.
- **AI‑generated nudges** surface what each user should act on next.

### G. Procurement, sourcing (RFx) & vendor management
- Full **RFI / RFP / RFQ / e‑auction** flow: create → invite vendors → **sealed (encrypted) bid envelopes** → open after deadline → score → clarifications → award, with complete audit.
- **Vendor master** with qualification, compliance documents, KPIs, and risk events.
- A **dedicated external vendor portal** with its own secure OTP login (kept separate from employee access).
- **SAP‑synced** purchase requisitions and purchase orders.

### H. Registers & knowledge
- Risk register, issue register, **benefits realization** tracking, **lessons learned**, document management with versioning, and an append‑only **activity audit log**.

### I. Enterprise integrations
- **Jira** — two‑way task import/export (proven: 264 tasks synced from a live project).
- **Microsoft Teams** — meeting minutes & action‑item capture.
- **SAP** — vendor and PR/PO synchronization.

---

## 4. ⭐ Highlight: Ask NYRA — the embedded AI analyst

NYRA is a conversational AI analyst built directly into Project Hub. Ask it anything about the portfolio in plain English and get an instant, accurate answer from **live data**:

- *"Which projects are amber or red?"* · *"How many tasks are overdue, by project?"* · *"Show milestones due this month."*
- **Grounded, never guessed** — every figure comes from the live database; if the data isn't there, NYRA says so rather than inventing.
- **Fully transparent** — each answer includes the exact queries it ran and how many records it read.
- **Secure by design** — read‑only, scoped strictly to project data (sensitive HR/recruitment data in the shared database is hard‑walled off), authenticated, and auditable.
- **Verified live**: *"36 projects total; 2 flagged amber or red — ~6% of the portfolio at risk,"* answered in seconds.

NYRA is the same analyst experience already running in the CXO Central Command dashboard — so Granules now has a **consistent, enterprise‑wide AI layer** across its leadership tools, not a one‑off.

---

## 5. Security & access control

- **Enterprise authentication** against the Master Employee directory; access gated by an `access_pmo` permission flag.
- **10 functional roles** (Chairman, Executive Director, CFO, PMO, PM, Head of Dept, SCM, Finance, Team Member, Admin) resolved from the HR directory, enforcing who can advance stages, approve, and administer.
- **External vendors** authenticate through a completely separate, OTP‑secured portal.
- Every approval, gate advance, and data change is **logged for audit**.

---

## 6. Technology & scale

- **Modern stack:** React + TypeScript + Vite front end; Node/Express API; PostgreSQL (Supabase) data layer.
- **Depth of model:** **63 dedicated data tables** spanning projects, work, governance, procurement, and reporting.
- **Live footprint today:** 36 active projects, ~484 milestones, ~395 tasks, 32 charters across 2 portfolios — real operational data, not a demo.
- **AI:** powered by Anthropic's Claude models via a secure, governed integration shared across the platform.

---

## 7. Status

**Live and in active use** on the Granules network. The platform is feature‑complete across the lifecycle, work‑management, approvals, escalation, procurement and reporting domains, with the **Ask NYRA AI analyst now deployed and verified end‑to‑end**.

**Access:** http://172.30.101.2:5182 → sign in → the full Project Hub, with **Ask NYRA** available from the top header on every page.

---

*Prepared for leadership review — Granules AI‑Powered Platform, Project Hub (PMO).*
