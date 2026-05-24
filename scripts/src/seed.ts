import { db, pool } from "@workspace/db";
import * as schema from "@workspace/db";

async function seed() {
  console.log("🌱 Seeding database (fresh single-project pipeline)...");

  // ─── Wipe all data ───────────────────────────────────────────────────────
  console.log("  → truncating all tables");
  await pool.query(`
    TRUNCATE TABLE
      activity, approvals, baselines, benefits_reviews, budget_lines,
      change_requests, charters, documents, document_versions,
      escalation_rules, issues, lessons_learned, meeting_items, meetings,
      messages, milestones, notifications, portfolios, programs,
      project_scores, projects, project_stages, raci_matrix,
      resource_allocations, risks, scoring_criteria, squad_members,
      tasks, timelogs, users, vendors, workstreams
    RESTART IDENTITY CASCADE
  `);

  // ─── Users ───────────────────────────────────────────────────────────────
  console.log("  → users");
  const [alice, bob, carol, dave, eve, frank, grace, henry, ivy] = await db
    .insert(schema.usersTable)
    .values([
      { name: "Alice Sharma",  email: "alice@granules.com",  role: "initiator",          department: "IT" },
      { name: "Bob Patel",     email: "bob@granules.com",    role: "hod",                department: "IT" },
      { name: "Carol Singh",   email: "carol@granules.com",  role: "executive_director", department: "Executive" },
      { name: "Dave Kumar",    email: "dave@granules.com",   role: "cfo",                department: "Finance" },
      { name: "Eve Mehta",     email: "eve@granules.com",    role: "scm",                department: "SCM" },
      { name: "Frank Thomas",  email: "frank@granules.com",  role: "chairman",           department: "Executive" },
      { name: "Grace Nair",    email: "grace@granules.com",  role: "pmo",                department: "PMO" },
      { name: "Henry D'Souza", email: "henry@granules.com",  role: "pm",                 department: "IT" },
      { name: "Ivan Roy",      email: "ivan@granules.com",   role: "legal",              department: "Legal" },
    ])
    .returning();

  // ─── Portfolio & Program ─────────────────────────────────────────────────
  console.log("  → portfolio & program");
  const [portfolio] = await db.insert(schema.portfoliosTable).values({
    name: "Digital Transformation",
    description: "Enterprise-wide digitisation initiatives",
    ownerId: carol.id,
  }).returning();

  const [program] = await db.insert(schema.programsTable).values({
    portfolioId: portfolio.id,
    name: "Infrastructure Modernisation",
    description: "Core IT infrastructure upgrade",
    ownerId: bob.id,
  }).returning();

  // ─── Charter (approved) ──────────────────────────────────────────────────
  console.log("  → charter");
  const [charter] = await db.insert(schema.chartersTable).values({
    title: "ERP System Modernization",
    description: "Cloud ERP rollout across Finance, HR and Operations",
    scope: "Replace legacy SAP ECC with SAP S/4HANA SaaS. Covers 3 sites and 500 users.",
    deliverables: "Configured S/4HANA instance; cutover plan; training material; UAT sign-off; hypercare support.",
    tentativeBudget: "12000000",
    finalNegotiatedBudget: "11500000",
    startDate: "2025-09-01",
    endDate: "2026-06-30",
    durationDays: 303,
    status: "approved",
    submittedById: alice.id,
    projectSponsorId: carol.id,
    projectOwnerId: bob.id,
    projectManagerId: henry.id,
    strategicAlignmentTags: ["digital_core", "efficiency"],
    nfaThreshold: "13200000",
  }).returning();

  // ─── Approvals on charter ────────────────────────────────────────────────
  console.log("  → approvals");
  await db.insert(schema.approvalsTable).values([
    { charterId: charter.id, approverId: bob.id,   approverRole: "hod",                stage: "parallel_review", status: "approved", comments: "Critical for digital roadmap.",        decidedAt: new Date("2025-08-10") },
    { charterId: charter.id, approverId: carol.id, approverRole: "executive_director", stage: "parallel_review", status: "approved", comments: "Approved.",                            decidedAt: new Date("2025-08-11") },
    { charterId: charter.id, approverId: dave.id,  approverRole: "cfo",                stage: "parallel_review", status: "approved", comments: "Budget within tolerance.",             decidedAt: new Date("2025-08-12") },
    { charterId: charter.id, approverId: eve.id,   approverRole: "scm",                stage: "scm_review",      status: "approved", comments: "Negotiated 4% reduction.",             decidedAt: new Date("2025-08-15") },
    { charterId: charter.id, approverId: frank.id, approverRole: "chairman",           stage: "chairman_review", status: "approved", comments: "Approved. Proceed to procurement.",   decidedAt: new Date("2025-08-18") },
  ]);

  // ─── Scoring criteria + project scores ───────────────────────────────────
  console.log("  → scoring criteria");
  const [crit1, crit2, crit3, crit4] = await db.insert(schema.scoringCriteriaTable).values([
    { name: "Strategic Alignment",     weightPct: "30", description: "Alignment to corporate strategy",   isActive: true },
    { name: "ROI / Financial Benefit", weightPct: "30", description: "Expected financial return over 3 years", isActive: true },
    { name: "Risk Level",              weightPct: "20", description: "Overall delivery risk (lower=better)", isActive: true },
    { name: "Urgency / Compliance",    weightPct: "20", description: "Regulatory deadline / market urgency", isActive: true },
  ]).returning();

  // ─── Project (single, mid-pipeline at stage 10: Technical Design) ────────
  console.log("  → project");
  const [project] = await db.insert(schema.projectsTable).values({
    charterId: charter.id,
    portfolioId: portfolio.id,
    programId: program.id,
    name: "ERP System Modernization",
    description: "Cloud ERP rollout across Finance, HR and Operations",
    status: "active",
    priority: "P1",
    stage: "technical_design",
    strategicTheme: "digital_core",
    ragStatus: "amber",
    capexBudget: "9000000",
    opexBudget: "2500000",
    scoringTotal: "87.50",
    siteRegion: "Mumbai HQ",
    function: "IT",
    projectManagerId: henry.id,
    startDate: "2025-09-01",
    endDate: "2026-06-30",
    progress: 55,
  }).returning();

  await db.insert(schema.projectScoresTable).values([
    { projectId: project.id, criterionId: crit1.id, score: 5, weightedScore: "1.5000" },
    { projectId: project.id, criterionId: crit2.id, score: 4, weightedScore: "1.2000" },
    { projectId: project.id, criterionId: crit3.id, score: 3, weightedScore: "0.6000" },
    { projectId: project.id, criterionId: crit4.id, score: 4, weightedScore: "0.8000" },
  ]);

  // ─── 16 Project Stages (stages 1-9 complete, 10 in_progress, 11-16 pending)
  console.log("  → 16 project stages");
  const STAGES = [
    "project_case", "urs", "rfp", "vendor_evaluation",
    "charter", "nfa", "legal", "pr_po", "kickoff",
    "technical_design", "development", "implementation_plan",
    "uat", "go_live", "closure_readiness", "project_closure",
  ];
  const stageRows: typeof schema.projectStagesTable.$inferInsert[] = [];
  const baseDate = new Date("2025-07-01");
  for (let i = 0; i < STAGES.length; i++) {
    const enteredAt = new Date(baseDate.getTime() + i * 14 * 86_400_000);
    const completedAt = new Date(enteredAt.getTime() + 12 * 86_400_000);
    if (i < 9) {
      stageRows.push({ projectId: project.id, stage: STAGES[i], status: "complete", enteredAt, completedAt, notes: `Completed by Henry D'Souza on ${completedAt.toISOString().slice(0,10)}.` });
    } else if (i === 9) {
      stageRows.push({ projectId: project.id, stage: STAGES[i], status: "in_progress", enteredAt, notes: "Technical design workshops underway with vendor architects." });
    } else {
      stageRows.push({ projectId: project.id, stage: STAGES[i], status: "not_started" });
    }
  }
  await db.insert(schema.projectStagesTable).values(stageRows);

  // ─── Workstreams ─────────────────────────────────────────────────────────
  console.log("  → workstreams");
  const [wsConfig, wsData, wsTraining] = await db.insert(schema.workstreamsTable).values([
    { projectId: project.id, name: "System Configuration", description: "SAP S/4HANA base configuration", order: 0 },
    { projectId: project.id, name: "Data Migration",       description: "Legacy data extraction and load", order: 1 },
    { projectId: project.id, name: "User Training",        description: "End-user and key-user training",  order: 2 },
  ]).returning();

  // ─── Milestones ──────────────────────────────────────────────────────────
  console.log("  → milestones");
  const [msBlueprint, msDryRun, msUAT, msTrain] = await db.insert(schema.milestonesTable).values([
    { projectId: project.id, workstreamId: wsConfig.id,   name: "System Blueprint Approved",       dueDate: "2025-11-30", status: "completed",   priority: "P1", rag: "green", plannedEffortHours: 120, gateDecision: "go", order: 0 },
    { projectId: project.id, workstreamId: wsData.id,     name: "Data Migration Dry Run Complete", dueDate: "2026-02-28", status: "in_progress", priority: "P1", rag: "amber", plannedEffortHours: 80,                       order: 1 },
    { projectId: project.id, workstreamId: wsConfig.id,   name: "UAT Sign-off",                    dueDate: "2026-05-15", status: "not_started", priority: "P1", rag: "green", plannedEffortHours: 160,                      order: 2 },
    { projectId: project.id, workstreamId: wsTraining.id, name: "Training Completion (95%)",       dueDate: "2026-06-01", status: "not_started", priority: "P2", rag: "green", plannedEffortHours: 200,                      order: 3 },
  ]).returning();

  // ─── Tasks ───────────────────────────────────────────────────────────────
  console.log("  → tasks");
  const tasks = await db.insert(schema.tasksTable).values([
    { projectId: project.id, milestoneId: msBlueprint.id, workstreamId: wsConfig.id,   name: "Fit-Gap Analysis",       status: "completed",   priority: "P1", rag: "green", assigneeId: henry.id, startDate: "2025-10-11", endDate: "2025-10-31", plannedEffortHours: "40", actualHours: "42.00", isCritical: true,  order: 0, predecessorIds: "[]" },
    { projectId: project.id, milestoneId: msBlueprint.id, workstreamId: wsConfig.id,   name: "Finance Module Config",  status: "completed",   priority: "P1", rag: "green", assigneeId: henry.id, startDate: "2025-11-01", endDate: "2025-11-20", plannedEffortHours: "60", actualHours: "58.00", isCritical: true,  order: 1, predecessorIds: "[1]" },
    { projectId: project.id, milestoneId: msDryRun.id,    workstreamId: wsData.id,     name: "Data Extraction Rules",  status: "in_progress", priority: "P1", rag: "amber", assigneeId: alice.id, startDate: "2026-01-15", endDate: "2026-02-10", plannedEffortHours: "48", actualHours: "20.00", isCritical: true,  order: 0, predecessorIds: "[]" },
    { projectId: project.id, milestoneId: msUAT.id,       workstreamId: wsConfig.id,   name: "UAT Test Script Prep",   status: "not_started", priority: "P1", rag: "green", assigneeId: alice.id, startDate: "2026-03-01", endDate: "2026-03-20", plannedEffortHours: "40",                       isCritical: true,  order: 0, predecessorIds: "[]" },
    { projectId: project.id, milestoneId: msTrain.id,     workstreamId: wsTraining.id, name: "Training Material",      status: "not_started", priority: "P2", rag: "green", assigneeId: alice.id, startDate: "2026-04-01", endDate: "2026-04-30", plannedEffortHours: "70",                       isCritical: false, order: 0, predecessorIds: "[]" },
  ]).returning();

  // ─── Risks ───────────────────────────────────────────────────────────────
  console.log("  → risks");
  await db.insert(schema.risksTable).values([
    { charterId: charter.id, title: "Data Quality Issues",          description: "Legacy data has inconsistencies that could delay migration cutover.", impact: "high",   likelihood: "high",   priority: "high",   rag: "red",   mitigation: "Run parallel data cleansing sprints; define acceptance criteria before dry run.", status: "open",      owner: "Henry D'Souza" },
    { charterId: charter.id, title: "Resource Availability",        description: "Vendor FTEs allocated across 2 other projects.",                       impact: "medium", likelihood: "medium", priority: "medium", rag: "amber", mitigation: "SLA for dedicated headcount; escalation if utilisation < 80%.",                   status: "open",      owner: "Grace Nair" },
    { charterId: charter.id, title: "Change Management Resistance", description: "End-users accustomed to legacy may resist new workflows.",             impact: "medium", likelihood: "high",   priority: "medium", rag: "amber", mitigation: "Early engagement programme; key-user champions; pilot feedback loop.",            status: "mitigated", owner: "Bob Patel" },
  ]);

  // ─── Issues ──────────────────────────────────────────────────────────────
  console.log("  → issues");
  await db.insert(schema.issuesTable).values([
    { projectId: project.id, taskId: tasks[2].id, title: "Source data inconsistencies blocking extraction", dependencyType: "data", blockingOwnerId: dave.id, blockingDept: "Finance", originalDeadline: "2026-02-10", proposedRevisedDeadline: "2026-02-20", status: "open", raisedBy: alice.id, description: "Finance master data needs cleansing before extraction rules can finalise." },
  ]);

  // ─── Budget Lines ────────────────────────────────────────────────────────
  console.log("  → budget lines");
  await db.insert(schema.budgetLinesTable).values([
    { projectId: project.id, category: "capex", description: "SAP S/4HANA Licences (3-year)",   baselineAmount: "4500000", forecastAmount: "4500000", actualAmount: "4500000", varianceAmount: "0",       variancePct: "0.00",  period: "q4_2025" },
    { projectId: project.id, category: "capex", description: "Implementation Services — Vendor", baselineAmount: "3500000", forecastAmount: "3800000", actualAmount: "1200000", varianceAmount: "-300000", variancePct: "-8.57", period: "q1_2026" },
    { projectId: project.id, category: "opex",  description: "Infrastructure / Azure Hosting",   baselineAmount: "800000",  forecastAmount: "850000",  actualAmount: "200000",  varianceAmount: "-50000",  variancePct: "-6.25", period: "q1_2026" },
    { projectId: project.id, category: "opex",  description: "Change Management & Training",     baselineAmount: "700000",  forecastAmount: "720000",  actualAmount: "0",       varianceAmount: "-20000",  variancePct: "-2.86", period: "q2_2026" },
  ]);

  // ─── Resource Allocations ────────────────────────────────────────────────
  console.log("  → resource allocations");
  await db.insert(schema.resourceAllocationsTable).values([
    { projectId: project.id, userId: henry.id, role: "Project Manager",    skill: "SAP PM",     allocationPct: "100", startDate: "2025-09-01", endDate: "2026-06-30" },
    { projectId: project.id, userId: alice.id, role: "Functional Lead",    skill: "SAP FI/HR",  allocationPct: "80",  startDate: "2025-10-01", endDate: "2026-05-31" },
    { projectId: project.id, userId: bob.id,   role: "Steering Committee", skill: "Governance", allocationPct: "10",  startDate: "2025-09-01", endDate: "2026-06-30" },
    { projectId: project.id, userId: ivy.id,   role: "Legal Reviewer",     skill: "Contracts",  allocationPct: "15",  startDate: "2025-10-15", endDate: "2025-11-30" },
  ]);

  // ─── Notifications ───────────────────────────────────────────────────────
  console.log("  → notifications");
  await db.insert(schema.notificationsTable).values([
    { userId: henry.id, type: "stage_active",      title: "Stage 10 active: Technical Design",   body: "Technical Design workshops in progress with vendor architects.", link: `/projects/${project.id}?stage=technical_design`, isRead: false, relatedEntityType: "project", relatedEntityId: project.id },
    { userId: grace.id, type: "risk_alert",        title: "High Risk: Data Quality Issues",      body: "Risk RAG is red. Immediate mitigation required.",                link: `/projects/${project.id}`,                       isRead: false, relatedEntityType: "project", relatedEntityId: project.id },
    { userId: henry.id, type: "milestone_due",     title: "Milestone Due in 14 Days: Dry Run",   body: "Data Migration Dry Run due 2026-02-28. Status: In Progress.",    link: `/projects/${project.id}`,                       isRead: true,  relatedEntityType: "milestone", relatedEntityId: msDryRun.id },
  ]);

  await pool.end();
  console.log("✅ Seed complete. 1 project at stage 10 of 16 (Technical Design).");
}

seed().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
