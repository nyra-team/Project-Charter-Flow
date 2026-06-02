/**
 * Seed three starter project templates so the Templates feature ships with a
 * useful library on first launch.
 *
 *   1. ANDA Submission              (regulatory filing, pharma)
 *   2. Plant Commissioning Project  (capex / engineering)
 *   3. ERP Module Rollout           (cross-functional IT)
 *
 * Run with:
 *   DATABASE_URL=... pnpm -w -F @workspace/db exec tsx src/seed/templates.ts
 *
 * Idempotent on `name` — skips inserting if a template with the same name
 * already exists, so it's safe to re-run after schema pushes.
 */

import { eq } from "drizzle-orm";
import { db, projectTemplatesTable, templateTasksTable, templateMilestonesTable } from "../index";

type SeedTask = {
  name: string;
  description?: string;
  defaultDayOffset: number;
  defaultDurationDays: number;
  defaultPriority?: string;
  defaultOwnerRole?: string;
  // Indices into the SAME tasks array (resolved to row IDs at insert time).
  predecessorIndices?: number[];
};

type SeedMilestone = {
  name: string;
  defaultDayOffset: number;
  gateDecision?: string;
};

type SeedTemplate = {
  name: string;
  description: string;
  category: string;
  tasks: SeedTask[];
  milestones: SeedMilestone[];
};

const TEMPLATES: SeedTemplate[] = [
  {
    name: "ANDA Submission",
    description: "Abbreviated New Drug Application — end-to-end submission template covering R&D, CMC, BE study, regulatory dossier, and FDA filing.",
    category: "regulatory",
    milestones: [
      { name: "Project Kickoff", defaultDayOffset: 0, gateDecision: "Approved" },
      { name: "Formulation Lock", defaultDayOffset: 60, gateDecision: "Approved" },
      { name: "BE Study Complete", defaultDayOffset: 180, gateDecision: "Approved" },
      { name: "Dossier Submission", defaultDayOffset: 270, gateDecision: "Approved" },
      { name: "FDA Acceptance", defaultDayOffset: 300, gateDecision: "Pending" },
    ],
    tasks: [
      { name: "Define target product profile", defaultDayOffset: 0, defaultDurationDays: 7, defaultPriority: "P1", defaultOwnerRole: "pm" },
      { name: "Reference product procurement", defaultDayOffset: 7, defaultDurationDays: 14, defaultPriority: "P1", predecessorIndices: [0] },
      { name: "Formulation development (lab scale)", defaultDayOffset: 21, defaultDurationDays: 30, defaultPriority: "P1", predecessorIndices: [1] },
      { name: "Analytical method development", defaultDayOffset: 21, defaultDurationDays: 45, defaultPriority: "P1", predecessorIndices: [1] },
      { name: "Pilot scale-up batch", defaultDayOffset: 51, defaultDurationDays: 15, defaultPriority: "P1", predecessorIndices: [2] },
      { name: "Bioequivalence study protocol", defaultDayOffset: 66, defaultDurationDays: 30, defaultPriority: "P2", predecessorIndices: [4] },
      { name: "BE study execution", defaultDayOffset: 96, defaultDurationDays: 75, defaultPriority: "P1", predecessorIndices: [5] },
      { name: "CMC dossier authoring", defaultDayOffset: 100, defaultDurationDays: 90, defaultPriority: "P1", predecessorIndices: [3, 4] },
      { name: "Clinical summary authoring", defaultDayOffset: 171, defaultDurationDays: 30, defaultPriority: "P1", predecessorIndices: [6] },
      { name: "QA review of complete dossier", defaultDayOffset: 200, defaultDurationDays: 30, defaultPriority: "P1", defaultOwnerRole: "qa_lead", predecessorIndices: [7, 8] },
      { name: "Regulatory submission (eCTD)", defaultDayOffset: 240, defaultDurationDays: 30, defaultPriority: "P1", predecessorIndices: [9] },
      { name: "FDA RTA review", defaultDayOffset: 270, defaultDurationDays: 30, defaultPriority: "P2", predecessorIndices: [10] },
    ],
  },
  {
    name: "Plant Commissioning Project",
    description: "Greenfield manufacturing plant commissioning — site readiness, equipment installation, qualification (IQ/OQ/PQ), GMP audit, and first batch.",
    category: "engineering",
    milestones: [
      { name: "Site Handover", defaultDayOffset: 0, gateDecision: "Approved" },
      { name: "Mechanical Completion", defaultDayOffset: 90, gateDecision: "Pending" },
      { name: "Qualification Complete", defaultDayOffset: 150, gateDecision: "Pending" },
      { name: "First Engineering Batch", defaultDayOffset: 180, gateDecision: "Pending" },
      { name: "Commercial Go-Live", defaultDayOffset: 210, gateDecision: "Pending" },
    ],
    tasks: [
      { name: "Site survey & readiness assessment", defaultDayOffset: 0, defaultDurationDays: 14, defaultPriority: "P1" },
      { name: "Utilities installation (HVAC, water, power)", defaultDayOffset: 14, defaultDurationDays: 45, defaultPriority: "P1", predecessorIndices: [0] },
      { name: "Equipment delivery & uncrating", defaultDayOffset: 30, defaultDurationDays: 21, defaultPriority: "P1", predecessorIndices: [0] },
      { name: "Equipment installation", defaultDayOffset: 51, defaultDurationDays: 30, defaultPriority: "P1", predecessorIndices: [1, 2] },
      { name: "Installation Qualification (IQ)", defaultDayOffset: 90, defaultDurationDays: 21, defaultPriority: "P1", defaultOwnerRole: "qa_lead", predecessorIndices: [3] },
      { name: "Operational Qualification (OQ)", defaultDayOffset: 111, defaultDurationDays: 21, defaultPriority: "P1", defaultOwnerRole: "qa_lead", predecessorIndices: [4] },
      { name: "Performance Qualification (PQ)", defaultDayOffset: 132, defaultDurationDays: 18, defaultPriority: "P1", defaultOwnerRole: "qa_lead", predecessorIndices: [5] },
      { name: "SOP authoring & training", defaultDayOffset: 132, defaultDurationDays: 30, defaultPriority: "P2", predecessorIndices: [4] },
      { name: "Engineering batch execution", defaultDayOffset: 150, defaultDurationDays: 21, defaultPriority: "P1", predecessorIndices: [6, 7] },
      { name: "GMP internal audit", defaultDayOffset: 171, defaultDurationDays: 14, defaultPriority: "P1", defaultOwnerRole: "qa_lead", predecessorIndices: [8] },
      { name: "Regulatory pre-approval inspection prep", defaultDayOffset: 185, defaultDurationDays: 21, defaultPriority: "P1", predecessorIndices: [9] },
    ],
  },
  {
    name: "ERP Module Rollout",
    description: "Enterprise software module rollout across plants — discovery, build, UAT, training, go-live, and 30-day hypercare.",
    category: "it",
    milestones: [
      { name: "Discovery Sign-off", defaultDayOffset: 21, gateDecision: "Approved" },
      { name: "URS Frozen", defaultDayOffset: 45, gateDecision: "Approved" },
      { name: "UAT Pass", defaultDayOffset: 120, gateDecision: "Approved" },
      { name: "Go-Live", defaultDayOffset: 150, gateDecision: "Approved" },
      { name: "Hypercare Exit", defaultDayOffset: 180, gateDecision: "Approved" },
    ],
    tasks: [
      { name: "Stakeholder workshops (AS-IS)", defaultDayOffset: 0, defaultDurationDays: 14, defaultPriority: "P1", defaultOwnerRole: "ba" },
      { name: "Process mapping (TO-BE)", defaultDayOffset: 14, defaultDurationDays: 14, defaultPriority: "P1", defaultOwnerRole: "ba", predecessorIndices: [0] },
      { name: "URS authoring", defaultDayOffset: 21, defaultDurationDays: 21, defaultPriority: "P1", defaultOwnerRole: "ba", predecessorIndices: [1] },
      { name: "Configuration build (Sprint 1)", defaultDayOffset: 45, defaultDurationDays: 21, defaultPriority: "P1", predecessorIndices: [2] },
      { name: "Configuration build (Sprint 2)", defaultDayOffset: 66, defaultDurationDays: 21, defaultPriority: "P1", predecessorIndices: [3] },
      { name: "Data migration scripts", defaultDayOffset: 60, defaultDurationDays: 30, defaultPriority: "P1", predecessorIndices: [2] },
      { name: "Integration with adjacent systems", defaultDayOffset: 87, defaultDurationDays: 21, defaultPriority: "P1", predecessorIndices: [4] },
      { name: "UAT scripts authoring", defaultDayOffset: 80, defaultDurationDays: 14, defaultPriority: "P2", defaultOwnerRole: "qa_lead", predecessorIndices: [2] },
      { name: "UAT execution", defaultDayOffset: 108, defaultDurationDays: 12, defaultPriority: "P1", defaultOwnerRole: "qa_lead", predecessorIndices: [6, 7] },
      { name: "End-user training", defaultDayOffset: 108, defaultDurationDays: 21, defaultPriority: "P2", predecessorIndices: [4] },
      { name: "Cutover plan & dress rehearsal", defaultDayOffset: 130, defaultDurationDays: 14, defaultPriority: "P1", predecessorIndices: [8] },
      { name: "Production cutover", defaultDayOffset: 148, defaultDurationDays: 3, defaultPriority: "P1", predecessorIndices: [10] },
      { name: "Hypercare support (30 days)", defaultDayOffset: 151, defaultDurationDays: 30, defaultPriority: "P1", predecessorIndices: [11] },
    ],
  },
];

async function seedOne(t: SeedTemplate): Promise<void> {
  // Idempotency: skip if a template with the same name already exists.
  const existing = await db
    .select({ id: projectTemplatesTable.id })
    .from(projectTemplatesTable)
    .where(eq(projectTemplatesTable.name, t.name));
  if (existing.length) {
    console.log(`  · ${t.name} — already present, skipping`);
    return;
  }

  const [tpl] = await db
    .insert(projectTemplatesTable)
    .values({ name: t.name, description: t.description, category: t.category })
    .returning();

  // Milestones — straightforward single pass.
  for (let i = 0; i < t.milestones.length; i++) {
    const m = t.milestones[i];
    await db.insert(templateMilestonesTable).values({
      templateId: tpl.id,
      name: m.name,
      defaultDayOffset: m.defaultDayOffset,
      gateDecision: m.gateDecision ?? null,
      sortOrder: i,
    } as never);
  }

  // Tasks — two passes so predecessorOffsets can reference sibling task IDs.
  const idByIndex = new Map<number, number>();
  for (let i = 0; i < t.tasks.length; i++) {
    const tk = t.tasks[i];
    const [row] = await db
      .insert(templateTasksTable)
      .values({
        templateId: tpl.id,
        name: tk.name,
        description: tk.description ?? "",
        defaultDayOffset: tk.defaultDayOffset,
        defaultDurationDays: tk.defaultDurationDays,
        defaultPriority: tk.defaultPriority ?? "P2",
        defaultOwnerRole: tk.defaultOwnerRole,
        sortOrder: i,
      } as never)
      .returning();
    idByIndex.set(i, row.id);
  }
  for (let i = 0; i < t.tasks.length; i++) {
    const tk = t.tasks[i];
    if (!tk.predecessorIndices?.length) continue;
    const id = idByIndex.get(i);
    if (!id) continue;
    const offsets = tk.predecessorIndices
      .map((idx) => idByIndex.get(idx))
      .filter((x): x is number => x != null)
      .map((templateTaskId) => ({ templateTaskId, lagDays: 0 }));
    await db.update(templateTasksTable).set({ predecessorOffsets: offsets }).where(eq(templateTasksTable.id, id));
  }

  console.log(`  ✓ ${t.name} (${t.tasks.length} tasks, ${t.milestones.length} milestones)`);
}

async function main(): Promise<void> {
  console.log("Seeding project templates…");
  for (const t of TEMPLATES) {
    await seedOne(t);
  }
  console.log("Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
