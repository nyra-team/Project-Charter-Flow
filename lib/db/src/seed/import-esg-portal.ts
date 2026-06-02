/**
 * One-shot import of the "ESG Portal" project export
 * (apps/pmo/Streamliner Project - ESG Portal.xlsx) into the PMO DB.
 *
 * Source structure (single Excel sheet, 18 rows, 20 cols):
 *   Cols 0-9   — project metadata (only populated on row 1)
 *   Cols 10-19 — per-milestone fields (one row per milestone)
 *
 * Data is inlined below rather than re-parsing the .xlsx on every run, so
 * this script has zero non-workspace deps and runs with the same toolchain
 * as the templates seed:
 *
 *   DATABASE_URL=... pnpm -F @workspace/db exec tsx src/seed/import-esg-portal.ts
 *
 * Idempotent on project name — if "ESG Portal" already exists, the script
 * exits without touching anything. If you genuinely want to re-import,
 * delete the existing pmo_projects row first.
 *
 * Mapping decisions:
 *   - Excel "Project Owner" / "Department Head" / per-milestone "Owner" are
 *     people NAMES, but pmo_projects / pmo_milestones use integer FKs into
 *     pmo_users. We don't auto-create pmo_users rows (would pollute every
 *     dropdown). Instead the names land in description / agenda text so the
 *     PMO renders them faithfully; PM/assignment fields stay null and the
 *     user can wire real IDs through the UI later.
 *   - Excel "Status" → milestone.status: Completed=completed,
 *     "In Progress"=in_progress, "Not Started"=not_started.
 *   - Excel "Project Status" = "On Track" → projects.ragStatus="green".
 *   - Excel "Dependencies" is free-text milestone names; we preserve them
 *     in description because pmo_milestones has no first-class predecessor
 *     graph (only tasks do).
 *   - "Functional Assessment" in source has target_date < start_date — kept
 *     as-is so the user sees the real upstream data quirk.
 */

import { eq } from "drizzle-orm";
import {
  db,
  projectsTable,
  chartersTable,
  milestonesTable,
} from "../index";

// ─── Inlined source data ────────────────────────────────────────────────────

const PROJECT = {
  name: "ESG Portal",
  department: "IT",
  departmentHead: "Karthick Raja S",
  domain: "IT Enabled",
  portfolio: "Digital Applications",
  portfolioOwner: "S N Aditya Murthy",
  projectOwner: "Srihari Chellu",
  businessTeam: "EHS & Sustainability",
  projectStatus: "On Track",
  phase: "Define",
};

type SourceStatus = "Completed" | "In Progress" | "Not Started";

interface SourceMilestone {
  name: string;
  startDate: string;       // YYYY-MM-DD
  targetDate: string;      // YYYY-MM-DD
  dependencies: string | null;
  department: string;
  owner: string;
  status: SourceStatus;
}

const MILESTONES: SourceMilestone[] = [
  { name: "User Requirement Specifications",       startDate: "2025-10-16", targetDate: "2025-11-03", dependencies: null,                                          department: "EHS & Sustainability",         owner: "P Latchi Reddy",                       status: "Completed" },
  { name: "Request for Proposal",                  startDate: "2025-11-04", targetDate: "2025-11-11", dependencies: "User Requirement Specifications",             department: "IT",                            owner: "Srihari Chellu",                       status: "Completed" },
  { name: "Vendor Demo",                           startDate: "2025-11-12", targetDate: "2025-12-02", dependencies: "Request for Proposal",                        department: "IT",                            owner: "Srihari Chellu",                       status: "Completed" },
  { name: "Technical Assessment",                  startDate: "2025-12-03", targetDate: "2025-12-22", dependencies: "Vendor Demo",                                 department: "IT",                            owner: "Srihari Chellu",                       status: "Completed" },
  { name: "Functional Assessment",                 startDate: "2025-12-23", targetDate: "2025-12-22", dependencies: "Vendor Demo",                                 department: "EHS & Sustainability",         owner: "P Latchi Reddy",                       status: "Completed" },
  { name: "Comparison Matrix",                     startDate: "2025-12-23", targetDate: "2026-01-01", dependencies: "Technical Assessment, Functional Assessment", department: "EHS & Sustainability, IT",      owner: "P Latchi Reddy, Srihari Chellu",       status: "Completed" },
  { name: "Project Charter",                       startDate: "2026-01-02", targetDate: "2026-01-11", dependencies: "Comparison Matrix",                           department: "IT",                            owner: "Srihari Chellu",                       status: "Completed" },
  { name: "Commercial Negotiation",                startDate: "2026-01-12", targetDate: "2026-02-11", dependencies: "Project Charter",                             department: "Procurement",                   owner: "Vijay Kumar Raju Kusampudi",           status: "Completed" },
  { name: "Note for Approval",                     startDate: "2026-02-12", targetDate: "2026-02-22", dependencies: "Commercial Negotiation",                      department: "IT",                            owner: "Srihari Chellu",                       status: "Completed" },
  { name: "Purchase Order",                        startDate: "2026-02-23", targetDate: "2026-03-04", dependencies: "Note for Approval",                           department: "EHS & Sustainability, IT",      owner: "P Latchi Reddy, Srihari Chellu",       status: "Completed" },
  { name: "Master Service Agreement",              startDate: "2026-03-05", targetDate: "2026-03-15", dependencies: "Purchase Order",                              department: "IT, Legal",                     owner: "Srihari Chellu, Debleena Ray",         status: "Completed" },
  { name: "Technical Design",                      startDate: "2026-03-16", targetDate: "2026-03-30", dependencies: "Master Service Agreement",                    department: "IT",                            owner: "Srihari Chellu",                       status: "Completed" },
  { name: "Functional Design",                     startDate: "2026-03-16", targetDate: "2026-03-30", dependencies: "Master Service Agreement",                    department: "EHS & Sustainability",         owner: "P Latchi Reddy",                       status: "Completed" },
  { name: "Configurations / Customizations",       startDate: "2026-03-31", targetDate: "2026-05-30", dependencies: "Technical Design, Functional Design",         department: "IT",                            owner: "Srihari Chellu",                       status: "Completed" },
  { name: "Unit Testing",                          startDate: "2026-05-31", targetDate: "2026-06-12", dependencies: "Configurations / Customizations",             department: "IT",                            owner: "Srihari Chellu",                       status: "In Progress" },
  { name: "User Acceptance Testing",               startDate: "2026-06-10", targetDate: "2026-07-05", dependencies: "Unit Testing",                                department: "EHS & Sustainability",         owner: "P Latchi Reddy",                       status: "Not Started" },
  { name: "Go Live",                               startDate: "2026-07-06", targetDate: "2026-07-15", dependencies: "User Acceptance Testing",                     department: "EHS & Sustainability",         owner: "P Latchi Reddy",                       status: "Not Started" },
];

// ─── Status mapping ─────────────────────────────────────────────────────────

const STATUS_MAP: Record<SourceStatus, string> = {
  "Completed": "completed",
  "In Progress": "in_progress",
  "Not Started": "not_started",
};

// Earliest start + latest target across all milestones bracket the project.
const projectStart = MILESTONES.reduce((min, m) => (m.startDate < min ? m.startDate : min), MILESTONES[0].startDate);
const projectEnd = MILESTONES.reduce((max, m) => (m.targetDate > max ? m.targetDate : max), MILESTONES[0].targetDate);

// ─── Run ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Idempotency check — skip if the project is already present.
  const existing = await db
    .select({ id: projectsTable.id, name: projectsTable.name })
    .from(projectsTable)
    .where(eq(projectsTable.name, PROJECT.name));
  if (existing.length) {
    console.log(`✗ Project "${PROJECT.name}" already exists (id=${existing[0].id}). Aborting to avoid duplicates.`);
    console.log(`  To re-import: DELETE FROM pmo_projects WHERE id = ${existing[0].id};`);
    process.exit(0);
  }

  console.log(`→ Importing project "${PROJECT.name}"…`);

  // 1. Project shell.
  const projectDescription = [
    `Imported from "Streamliner Project - ESG Portal.xlsx".`,
    "",
    `Department: ${PROJECT.department} (head: ${PROJECT.departmentHead})`,
    `Domain: ${PROJECT.domain}`,
    `Portfolio: ${PROJECT.portfolio} (owner: ${PROJECT.portfolioOwner})`,
    `Project Owner: ${PROJECT.projectOwner}`,
    `Business Team: ${PROJECT.businessTeam}`,
    `Source phase: ${PROJECT.phase}`,
  ].join("\n");

  const [project] = await db
    .insert(projectsTable)
    .values({
      name: PROJECT.name,
      description: projectDescription,
      status: "active",
      stage: "execution",
      ragStatus: PROJECT.projectStatus === "On Track" ? "green" : "amber",
      startDate: projectStart,
      endDate: projectEnd,
      // Owner mapping is deferred — names land in description above; the
      // user wires real pmo_users.id via the project edit surface.
    } as never)
    .returning();
  console.log(`  ✓ Project id=${project.id} created`);

  // 2. Charter shell — minimal, pre-filled with the same narrative so the
  //    Charters page links back cleanly.
  const [charter] = await db
    .insert(chartersTable)
    .values({
      title: PROJECT.name,
      description: projectDescription,
      scope: `Deliver the ESG Portal end-to-end across ${MILESTONES.length} milestones, from URS through Go-Live (${projectStart} → ${projectEnd}).`,
      deliverables: MILESTONES.slice(0, 8).map((m) => `- ${m.name}`).join("\n"),
      status: "active",
      submittedById: 0, // placeholder — column is NOT NULL; real user wired via UI
      projectId: project.id,
    } as never)
    .returning();
  // Back-stamp the project so projects.charterId points at the new charter
  // (matches the convention in routes/projects.ts when a project is born
  // from a charter — keeps the bidirectional link clean either way).
  await db
    .update(projectsTable)
    .set({ charterId: charter.id })
    .where(eq(projectsTable.id, project.id));
  console.log(`  ✓ Charter id=${charter.id} created and linked`);

  // 3. Milestones — one per Excel row, in source order.
  for (let i = 0; i < MILESTONES.length; i++) {
    const m = MILESTONES[i];
    const description = [
      `Start: ${m.startDate} · Target: ${m.targetDate}`,
      `Department: ${m.department}`,
      `Owner: ${m.owner}`,
      m.dependencies ? `Depends on: ${m.dependencies}` : null,
    ].filter(Boolean).join("\n");

    await db.insert(milestonesTable).values({
      projectId: project.id,
      name: m.name,
      description,
      // Both dates persist as first-class columns. The Gantt promotes any
      // milestone with both startDate + dueDate from a diamond marker to a
      // duration bar (see GanttChart > rowBarProps).
      startDate: m.startDate,
      dueDate: m.targetDate,
      status: STATUS_MAP[m.status],
      priority: "P2",
      rag: m.status === "Completed" ? "green" : m.status === "In Progress" ? "amber" : "green",
      order: i,
    } as never);
  }
  console.log(`  ✓ ${MILESTONES.length} milestones inserted`);

  console.log("");
  console.log(`Done. Open the project in the PMO:`);
  console.log(`  http://localhost:5182/projects/${project.id}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
