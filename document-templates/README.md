# Mandatory Document Templates — Granules Project Lifecycle

The **15 official mandatory deliverables** every Granules data/AI project must produce, organized
by the Project Hub's three lifecycle phases (**Plan → Execute → Close**). These are blank
templates (Granules IT / Digital Enterprise standard) — copy one per project and fill it in.

**Source of truth:** extracted from [`../Checklist.zip`](../Checklist.zip) (kept intact at the PMO
repo root for provenance). The numbered `NN_` prefixes are the canonical document IDs — do not
renumber.

> **Status:** these templates are **not yet wired into the gate config**. They live here as files,
> mapped to phases, so the wiring can be decided later. See **"Wiring this up later"** below.

## Mapping — document → phase → stage

Stage keys/labels come from `artifacts/project-hub/src/lib/lifecycle-phases.ts` +
`lifecycle-config.ts` (canonical 3-phase / 13-stage lifecycle).

### Plan (`Plan/`)

| #  | Document | Mapped stage (key → label) |
|----|----------|----------------------------|
| 01 | Project Charter | `initiation` → Business Requirements (also the Charter/NFA gate) |
| 02 | Business Requirement Document | `initiation` → Business Requirements (≈ URS/BRD) |
| 03 | Project Plan (.xlsx) | `project_plan` → Project Plan |
| 05 | Solution Architecture & Pitch Deck (.pptx) | `solution_design` → Solution Design |
| 07 | Issues, Risks & Opportunities (.xlsx) | `project_plan` → Project Plan (living register, baselined in Plan) |
| —  | Annexure — Request for Proposal | `rfp` → Request for Proposal (supporting template, not one of the numbered 15) |

### Execute (`Execute/`)

| #  | Document | Mapped stage (key → label) |
|----|----------|----------------------------|
| 04 | Data Exploration | `dev_config` → Development & Configuration |
| 06 | Exploratory Data Analysis | `dev_config` → Development & Configuration |
| 08 | Data Transformation | `dev_config` → Development & Configuration |
| 09 | Modelling Approach and DAR | `dev_config` → Development & Configuration |
| 10 | Test Scenarios, Defect Log & RCA (.xlsx) | `uat` → System Testing & Validation |
| 12 | UAT | `uat` → System Testing & Validation |
| 11 | Deployment Design | `deployment_readiness` → Deployment Readiness |
| 13 | Release Notes | `go_live` → Production Deployment & Go-Live |

### Close (`Close/`)

| #  | Document | Mapped stage (key → label) |
|----|----------|----------------------------|
| 14 | User Handbook | `operational_handover` → Operational Handover |
| 15 | Operations & Support Handbook | `operational_handover` → Operational Handover |

**Totals:** Plan 5 · Execute 8 · Close 2 = **15** (+ RFP annexure under Plan).

## ⚠️ Known issue — verify before use

- **`Execute/11_Deployment Design.docx`** has the **wrong internal title**: its first heading reads
  *"User Acceptance Testing"* (identical to doc 12), so the body looks like a UAT document, not a
  deployment-design one. The filename/slot is correct; the **template content appears to be the
  wrong template**. Verify and replace the source template before circulating it.

## Wiring this up later

When these are eventually enforced as stage gates, the rule is **augment — add them alongside the
existing required docs, never replace them.** The Project Hub already gates each stage on its own
(procurement-flavored) doc set; these 15 are an additional standard.

Two files to extend (keep them in sync):

- **Frontend** — `artifacts/project-hub/src/lib/lifecycle-config.ts`: add entries to the relevant
  stage's `requiredDocs: [{ id, name, description, acceptedTypes, maxSizeMB, optional? }]` array.
- **Backend** — `artifacts/api-server/src/lib/stage-gates.ts`: add the matching `name` strings to
  that stage's `requiredDocNames: [...]`. The gate evaluator matches an uploaded document's `name`
  field against this list, so the two files' names **must match exactly**.

Map each doc to the stage shown in the tables above (e.g. doc 04/06/08/09 → `dev_config`,
doc 14/15 → `operational_handover`).
