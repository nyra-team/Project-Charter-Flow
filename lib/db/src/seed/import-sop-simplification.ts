/**
 * One-shot import of the "SOP Simplification - AI" project from the BRD
 * (02_Business Requirement Document-3.docx, Sreeram Prudhvi, v1.0
 * 2026-03-31). Mirrors the import-esg-portal.ts shape so both seeds run
 * identically.
 *
 *   DATABASE_URL=… pnpm -F @workspace/db exec tsx src/seed/import-sop-simplification.ts
 *
 * Idempotent on project name — if "SOP Simplification - AI" already exists,
 * the script exits cleanly without creating duplicates.
 *
 * The charter is populated with the verbatim Background / Objective / Scope
 * / Deliverables / Success Criteria / Benefits sections from the BRD so
 * everything an HOD or reviewer needs is on the charter detail page; the
 * project's `description` holds a compact one-paragraph summary for the
 * Projects-list card.
 *
 * Milestones are derived from the To-Be process in the BRD:
 *   SOP drafted → AI-assisted optimization → HOD review → Approval →
 *   Training Assignment → Completion of Training → Publish of SOP
 * Spread across the project window (31-Mar-2026 → 30-May-2026, ~60 days).
 * Status is back-derived from due-date relative to today (28-May-2026):
 * completed for everything safely in the past, in_progress for the
 * straddling ones, not_started for the tail.
 */

import { eq } from "drizzle-orm";
import {
  db,
  projectsTable,
  chartersTable,
  milestonesTable,
} from "../index";

// ─── Source fields (verbatim from the BRD) ──────────────────────────────────

const PROJECT_NAME = "SOP Simplification - AI";
const PROJECT_START = "2026-03-31"; // BRD v1.0 release date
const PROJECT_END = "2026-05-30";   // "expected to be completed by 30 May 2026"

const BACKGROUND =
  "Standard Operating Procedures (SOPs) are prepared, reviewed, and approved through the Document Management System (DMS). " +
  "Several SOPs currently exceed 40 pages in length, which increases reading time and makes it challenging for users to thoroughly " +
  "understand the procedures. This extended length has a direct impact on training effectiveness and timely SOP adherence, " +
  "highlighting the need for an optimized approach without compromising quality or compliance.";

const OBJECTIVE =
  "Optimize SOPs that exceed 40 pages by reducing their length using AI-assisted tools and content restructuring. " +
  "Maintain regulatory compliance, procedural accuracy, and content quality while improving readability, user comprehension, " +
  "and overall training effectiveness.";

const SCOPE_OF_WORK = [
  "Review all SOPs available in the DMS that consist of more than 40 pages.",
  "Analyze the long-form SOPs to identify repetitive, verbose, or non-value-adding content.",
  "Use AI-enabled techniques to restructure and condense the documents while aligning with Quality Assurance requirements, regulatory standards, and internal SOP guidelines.",
  "Route revised SOPs through review and approval by the respective HODs and designated approvers.",
];

const DELIVERABLES = [
  "Reduced-length SOP draft documents.",
  "Comparative analysis report outlining 'As-Is' vs 'To-Be' versions.",
  "Implementation tracker to monitor SOP rollout and training completion.",
  "Execution timeline target: each SOP set completed within 15 days.",
];

const SUCCESS_CRITERIA = [
  "25-40% reduction in SOP page count.",
  "Measurable decrease in average SOP reading time.",
  "Improved training evaluation scores and effectiveness.",
  "Timely completion of SOP-related training by identified personnel.",
];

const BENEFITS = [
  "Improved SOP compliance and reduced training time.",
  "Enhanced user understanding of procedures.",
  "Better audit readiness and timely completion of training.",
  "Operational efficiency and stronger documentation quality.",
  "Strengthened overall quality governance.",
];

// ─── To-Be process → Milestones ─────────────────────────────────────────────
//
// Project window ~60 days. Day offsets distribute the 7 to-be process steps
// across that span: setup-heavy upfront work + rolling optimization /
// review / training cadence behind it.

type SeedMilestone = {
  name: string;
  description: string;
  dueDate: string;
  gateDecision?: string;
};

const MILESTONES: SeedMilestone[] = [
  {
    name: "SOP Identification & Tooling Readiness",
    description: "Catalogue all DMS SOPs over 40 pages; finalise AI tooling, prompt templates, and QA guardrails for content restructuring.",
    dueDate: "2026-04-10",
    gateDecision: "Approved",
  },
  {
    name: "AI-Assisted Optimization — Batch 1",
    description: "Run AI-assisted condensation + restructuring on the first SOP batch; produce side-by-side As-Is vs To-Be drafts.",
    dueDate: "2026-04-22",
    gateDecision: "Approved",
  },
  {
    name: "HOD Review — Batch 1",
    description: "HODs review reduced-length drafts against regulatory + internal SOP guidelines; capture redlines.",
    dueDate: "2026-05-02",
    gateDecision: "Approved",
  },
  {
    name: "Approval — Batch 1",
    description: "Designated approvers sign off the revised SOPs through DMS workflow.",
    dueDate: "2026-05-12",
    gateDecision: "Approved",
  },
  {
    name: "Training Assignment — Batch 1",
    description: "Re-publish approved SOPs; assign training to the identified personnel; refresh implementation tracker.",
    dueDate: "2026-05-20",
    gateDecision: "Pending",
  },
  {
    name: "Completion of Training — Batch 1",
    description: "Track and confirm training completion; capture evaluation scores against baseline.",
    dueDate: "2026-05-26",
    gateDecision: "Pending",
  },
  {
    name: "Publish & Project Closure",
    description: "Final batch published; comparative analysis report finalised; lessons learned + audit-readiness pack handed to QA.",
    dueDate: "2026-05-30",
    gateDecision: "Pending",
  },
];

// ─── Status derivation — today is 2026-05-28 per the seed runtime ──────────

function statusFor(dueDate: string, todayIso: string): "completed" | "in_progress" | "not_started" {
  // Past due → completed (project is mature; everything that should be done by now is done)
  // Within ±5 days of today → in_progress
  // Future > 5 days → not_started
  const due = new Date(dueDate + "T00:00:00Z").getTime();
  const today = new Date(todayIso + "T00:00:00Z").getTime();
  const dayDiff = Math.round((due - today) / 86_400_000);
  if (dayDiff <= -5) return "completed";
  if (dayDiff <= 5) return "in_progress";
  return "not_started";
}

function ragFor(status: "completed" | "in_progress" | "not_started"): "green" | "amber" | "red" {
  if (status === "completed") return "green";
  if (status === "in_progress") return "amber";
  return "green";
}

// ─── Run ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const existing = await db
    .select({ id: projectsTable.id, name: projectsTable.name })
    .from(projectsTable)
    .where(eq(projectsTable.name, PROJECT_NAME));
  if (existing.length) {
    console.log(`✗ Project "${PROJECT_NAME}" already exists (id=${existing[0].id}). Aborting to avoid duplicates.`);
    console.log(`  To re-import: DELETE FROM pmo_projects WHERE id = ${existing[0].id};`);
    process.exit(0);
  }

  console.log(`→ Importing project "${PROJECT_NAME}" from BRD…`);

  // ── Project ────────────────────────────────────────────────────────────
  const projectDescription = [
    `Imported from "02_Business Requirement Document-3.docx" (Sreeram Prudhvi, v1.0 2026-03-31).`,
    "",
    "Reduce length of DMS SOPs over 40 pages via AI-assisted content restructuring, without compromising regulatory compliance " +
      "or quality. Target: 25-40% page reduction, with improved training effectiveness as the success measure.",
    "",
    `Owner: Transformation Division (Tx), Granules.`,
    `Target completion: ${PROJECT_END}.`,
  ].join("\n");

  const [project] = await db
    .insert(projectsTable)
    .values({
      name: PROJECT_NAME,
      description: projectDescription,
      status: "active",
      stage: "execution",
      ragStatus: "amber", // tail-end milestones still in motion as of today
      startDate: PROJECT_START,
      endDate: PROJECT_END,
    } as never)
    .returning();
  console.log(`  ✓ Project id=${project.id} created`);

  // ── Charter (BRD-faithful — every BRD section becomes a charter field) ─
  const charterScope = [
    "## Scope of Work",
    ...SCOPE_OF_WORK.map((s) => `- ${s}`),
    "",
    "## Out of Scope",
    "- SOPs ≤ 40 pages (handled by existing DMS review cycle).",
    "- Net-new SOP authoring (only existing long-form SOPs are condensed).",
  ].join("\n");

  const charterDeliverables = [
    "## Deliverables",
    ...DELIVERABLES.map((d) => `- ${d}`),
    "",
    "## Success Criteria",
    ...SUCCESS_CRITERIA.map((s) => `- ${s}`),
    "",
    "## Expected Business Benefits / ROI",
    ...BENEFITS.map((b) => `- ${b}`),
  ].join("\n");

  const [charter] = await db
    .insert(chartersTable)
    .values({
      title: PROJECT_NAME,
      description: `${BACKGROUND}\n\n## Objective\n\n${OBJECTIVE}`,
      scope: charterScope,
      deliverables: charterDeliverables,
      status: "active",
      submittedById: 0, // placeholder — real user wired via UI later
      projectId: project.id,
    } as never)
    .returning();

  await db
    .update(projectsTable)
    .set({ charterId: charter.id })
    .where(eq(projectsTable.id, project.id));
  console.log(`  ✓ Charter id=${charter.id} created and linked`);

  // ── Milestones (7, from the To-Be process flow) ────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  for (let i = 0; i < MILESTONES.length; i++) {
    const m = MILESTONES[i];
    const status = statusFor(m.dueDate, today);
    await db.insert(milestonesTable).values({
      projectId: project.id,
      name: m.name,
      description: m.description,
      dueDate: m.dueDate,
      status,
      priority: "P1",
      rag: ragFor(status),
      gateDecision: m.gateDecision ?? null,
      order: i,
    } as never);
  }
  console.log(`  ✓ ${MILESTONES.length} milestones inserted (status auto-derived from today=${today})`);

  console.log("");
  console.log(`Done. Open the project in the PMO:`);
  console.log(`  http://localhost:5182/projects/${project.id}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
