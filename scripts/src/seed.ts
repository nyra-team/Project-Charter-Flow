import { db, pool } from "@workspace/db";
import * as schema from "@workspace/db";

async function seed() {
  console.log("🌱 Seeding database...");

  // ─── Users ───────────────────────────────────────────────────────────────
  console.log("  → users");
  const [alice, bob, carol, dave, eve, frank, grace, henry] = await db
    .insert(schema.usersTable)
    .values([
      { name: "Alice Sharma",   email: "alice@company.com",  role: "initiator",         department: "IT" },
      { name: "Bob Patel",      email: "bob@company.com",    role: "hod",               department: "IT" },
      { name: "Carol Singh",    email: "carol@company.com",  role: "executive_director", department: "Executive" },
      { name: "Dave Kumar",     email: "dave@company.com",   role: "cfo",               department: "Finance" },
      { name: "Eve Mehta",      email: "eve@company.com",    role: "scm",               department: "SCM" },
      { name: "Frank Thomas",   email: "frank@company.com",  role: "chairman",          department: "Executive" },
      { name: "Grace Nair",     email: "grace@company.com",  role: "pmo",               department: "PMO" },
      { name: "Henry D'Souza",  email: "henry@company.com",  role: "pm",                department: "IT" },
    ])
    .returning();

  // ─── Portfolios & Programs ────────────────────────────────────────────────
  console.log("  → portfolios & programs");
  const [digitalPortfolio] = await db
    .insert(schema.portfoliosTable)
    .values({ name: "Digital Transformation", description: "Enterprise-wide digitisation initiatives", ownerId: carol.id })
    .returning();

  const [infraProgram] = await db
    .insert(schema.programsTable)
    .values({ portfolioId: digitalPortfolio.id, name: "Infrastructure Modernisation", description: "Core IT infrastructure upgrade", ownerId: bob.id })
    .returning();

  // ─── Scoring Criteria ─────────────────────────────────────────────────────
  console.log("  → scoring criteria");
  const [crit1, crit2, crit3, crit4] = await db
    .insert(schema.scoringCriteriaTable)
    .values([
      { name: "Strategic Alignment",    weightPct: "30", description: "How well the project aligns to corporate strategy",   isActive: true },
      { name: "ROI / Financial Benefit", weightPct: "30", description: "Expected financial return over 3 years",             isActive: true },
      { name: "Risk Level",             weightPct: "20", description: "Overall delivery risk (lower = better score)",        isActive: true },
      { name: "Urgency / Compliance",   weightPct: "20", description: "Regulatory deadline or market urgency",              isActive: true },
    ])
    .returning();

  // ─── Charters ─────────────────────────────────────────────────────────────
  console.log("  → charters");
  const [charter1] = await db
    .insert(schema.chartersTable)
    .values({
      title: "ERP System Modernization",
      description: "Cloud ERP rollout across Finance, HR and Operations",
      scope: "Replace legacy SAP ECC with SAP S/4HANA SaaS. Covers 3 sites and 500 users.",
      deliverables: "Configured S/4HANA instance; cutover plan; training material; UAT sign-off; hypercare support.",
      tentativeBudget: "12000000",
      finalNegotiatedBudget: "11500000",
      startDate: "2024-09-01",
      endDate: "2025-06-30",
      durationDays: 303,
      status: "approved",
      submittedById: alice.id,
      projectSponsorId: carol.id,
      projectOwnerId: bob.id,
      projectManagerId: henry.id,
      strategicAlignmentTags: ["digital_core", "efficiency"],
      nfaThreshold: "13200000",
    })
    .returning();

  const [charter2] = await db
    .insert(schema.chartersTable)
    .values({
      title: "Customer Portal Redesign",
      description: "Rebuild the B2B customer self-service portal for improved UX and API integration",
      scope: "New React SPA, REST API layer, SSO integration with Azure AD, mobile responsive.",
      deliverables: "Deployed portal; API documentation; user acceptance; load-test report.",
      tentativeBudget: "4500000",
      startDate: "2025-01-15",
      endDate: "2025-09-30",
      durationDays: 257,
      status: "parallel_review",
      submittedById: alice.id,
      projectSponsorId: bob.id,
      projectManagerId: henry.id,
      strategicAlignmentTags: ["customer_experience"],
    })
    .returning();

  const [charter3] = await db
    .insert(schema.chartersTable)
    .values({
      title: "Data Analytics Platform",
      description: "Centralised BI & analytics platform to replace siloed Excel reporting",
      scope: "Data warehouse on Azure Synapse, Power BI dashboards, self-serve analytics for 10 departments.",
      deliverables: "Data warehouse; 15 certified dashboards; data governance policy; training.",
      tentativeBudget: "7800000",
      startDate: "2025-03-01",
      endDate: "2025-12-31",
      durationDays: 305,
      status: "draft",
      submittedById: alice.id,
      projectSponsorId: carol.id,
    })
    .returning();

  // ─── Approvals (for charter1 — already approved) ─────────────────────────
  console.log("  → approvals");
  await db.insert(schema.approvalsTable).values([
    { charterId: charter1.id, approverId: bob.id,   approverRole: "hod",               stage: "parallel_review", status: "approved", comments: "Approved — critical for digital roadmap.", decidedAt: new Date("2024-08-10") },
    { charterId: charter1.id, approverId: carol.id, approverRole: "executive_director", stage: "parallel_review", status: "approved", comments: "Approved with note to track hypercare budget separately.", decidedAt: new Date("2024-08-11") },
    { charterId: charter1.id, approverId: dave.id,  approverRole: "cfo",               stage: "parallel_review", status: "approved", comments: "Budget within tolerance. Approved.", decidedAt: new Date("2024-08-12") },
    { charterId: charter1.id, approverId: eve.id,   approverRole: "scm",               stage: "scm_review",      status: "approved", comments: "Negotiated 4% reduction. Final price ₹1.15 Cr.", decidedAt: new Date("2024-08-15") },
    { charterId: charter1.id, approverId: frank.id, approverRole: "chairman",          stage: "chairman_review", status: "approved", comments: "Approved. Proceed to procurement.", decidedAt: new Date("2024-08-18") },
    { charterId: charter2.id, approverId: bob.id,   approverRole: "hod",               stage: "parallel_review", status: "pending" },
    { charterId: charter2.id, approverId: carol.id, approverRole: "executive_director", stage: "parallel_review", status: "pending" },
    { charterId: charter2.id, approverId: dave.id,  approverRole: "cfo",               stage: "parallel_review", status: "pending" },
  ]);

  // ─── Projects ─────────────────────────────────────────────────────────────
  console.log("  → projects");
  const [proj1] = await db
    .insert(schema.projectsTable)
    .values({
      charterId: charter1.id,
      portfolioId: digitalPortfolio.id,
      programId: infraProgram.id,
      name: "ERP System Modernization",
      description: "Cloud ERP rollout across Finance, HR and Operations",
      status: "active",
      priority: "P1",
      stage: "implementation",
      strategicTheme: "digital_core",
      ragStatus: "amber",
      capexBudget: "9000000",
      opexBudget: "2500000",
      scoringTotal: "87.50",
      siteRegion: "Mumbai HQ",
      function: "IT",
      projectManagerId: henry.id,
      startDate: "2024-09-01",
      endDate: "2025-06-30",
      progress: 45,
    })
    .returning();

  const [proj2] = await db
    .insert(schema.projectsTable)
    .values({
      charterId: charter2.id,
      portfolioId: digitalPortfolio.id,
      name: "Customer Portal Redesign",
      description: "Rebuild the B2B customer self-service portal",
      status: "planning",
      priority: "P2",
      stage: "urs",
      strategicTheme: "customer_experience",
      ragStatus: "green",
      capexBudget: "3000000",
      opexBudget: "1500000",
      siteRegion: "Pune Office",
      function: "IT",
      projectManagerId: henry.id,
      startDate: "2025-01-15",
      endDate: "2025-09-30",
      progress: 10,
    })
    .returning();

  // ─── Project Stages ────────────────────────────────────────────────────────
  console.log("  → project stages");
  await db.insert(schema.projectStagesTable).values([
    { projectId: proj1.id, stage: "project_case",  status: "complete",    enteredAt: new Date("2024-07-01"), completedAt: new Date("2024-07-15") },
    { projectId: proj1.id, stage: "urs",           status: "complete",    enteredAt: new Date("2024-07-16"), completedAt: new Date("2024-08-05") },
    { projectId: proj1.id, stage: "rfp",           status: "complete",    enteredAt: new Date("2024-08-06"), completedAt: new Date("2024-08-20") },
    { projectId: proj1.id, stage: "vendor_eval",   status: "complete",    enteredAt: new Date("2024-08-21"), completedAt: new Date("2024-08-30") },
    { projectId: proj1.id, stage: "charter",       status: "complete",    enteredAt: new Date("2024-09-01"), completedAt: new Date("2024-09-10") },
    { projectId: proj1.id, stage: "nfa",           status: "complete",    enteredAt: new Date("2024-09-11"), completedAt: new Date("2024-09-20") },
    { projectId: proj1.id, stage: "po_release",    status: "complete",    enteredAt: new Date("2024-09-21"), completedAt: new Date("2024-10-01") },
    { projectId: proj1.id, stage: "kickoff",       status: "complete",    enteredAt: new Date("2024-10-02"), completedAt: new Date("2024-10-10") },
    { projectId: proj1.id, stage: "development",   status: "complete",    enteredAt: new Date("2024-10-11"), completedAt: new Date("2025-01-31") },
    { projectId: proj1.id, stage: "implementation", status: "in_progress", enteredAt: new Date("2025-02-01") },
    { projectId: proj2.id, stage: "project_case",  status: "complete",    enteredAt: new Date("2025-01-01"), completedAt: new Date("2025-01-10") },
    { projectId: proj2.id, stage: "urs",           status: "in_progress", enteredAt: new Date("2025-01-11") },
  ]);

  // ─── Project Scores ────────────────────────────────────────────────────────
  console.log("  → project scores");
  await db.insert(schema.projectScoresTable).values([
    { projectId: proj1.id, criterionId: crit1.id, score: 5, weightedScore: "1.5000" },
    { projectId: proj1.id, criterionId: crit2.id, score: 4, weightedScore: "1.2000" },
    { projectId: proj1.id, criterionId: crit3.id, score: 3, weightedScore: "0.6000" },
    { projectId: proj1.id, criterionId: crit4.id, score: 4, weightedScore: "0.8000" },
  ]);

  // ─── Workstreams ───────────────────────────────────────────────────────────
  console.log("  → workstreams");
  const [ws1, ws2, ws3] = await db
    .insert(schema.workstreamsTable)
    .values([
      { projectId: proj1.id, name: "System Configuration",  description: "SAP S/4HANA base configuration", order: 0 },
      { projectId: proj1.id, name: "Data Migration",        description: "Legacy data extraction and load",  order: 1 },
      { projectId: proj1.id, name: "User Training",         description: "End-user and key-user training",   order: 2 },
    ])
    .returning();

  // ─── Milestones ────────────────────────────────────────────────────────────
  console.log("  → milestones");
  const [ms1, ms2, ms3, ms4] = await db
    .insert(schema.milestonesTable)
    .values([
      { projectId: proj1.id, workstreamId: ws1.id, name: "System Blueprint Approved",     dueDate: "2024-11-30", status: "completed",    priority: "P1", rag: "green",  plannedEffortHours: 120, gateDecision: "go",    order: 0 },
      { projectId: proj1.id, workstreamId: ws2.id, name: "Data Migration Dry Run Complete", dueDate: "2025-02-28", status: "completed",  priority: "P1", rag: "green",  plannedEffortHours: 80,  gateDecision: "go",    order: 1 },
      { projectId: proj1.id, workstreamId: ws1.id, name: "UAT Sign-off",                  dueDate: "2025-05-15", status: "in_progress",  priority: "P1", rag: "amber",  plannedEffortHours: 160, gateDecision: null,    order: 2 },
      { projectId: proj1.id, workstreamId: ws3.id, name: "Training Completion (95%)",     dueDate: "2025-06-01", status: "not_started",  priority: "P2", rag: "green",  plannedEffortHours: 200, gateDecision: null,    order: 3 },
    ])
    .returning();

  // ─── Tasks ─────────────────────────────────────────────────────────────────
  console.log("  → tasks");
  const [t1, t2, t3, t4, t5, t6, t7, t8, t9, t10, t11, t12, t13, t14, t15] = await db
    .insert(schema.tasksTable)
    .values([
      // System Configuration workstream
      { projectId: proj1.id, milestoneId: ms1.id, workstreamId: ws1.id, name: "Fit-Gap Analysis",            status: "completed",   priority: "P1", rag: "green",  assigneeId: henry.id,  startDate: "2024-10-11", endDate: "2024-10-31", plannedEffortHours: "40",  actualHours: "42.00", isCritical: true,  order: 0, predecessorIds: "[]" },
      { projectId: proj1.id, milestoneId: ms1.id, workstreamId: ws1.id, name: "Finance Module Config",       status: "completed",   priority: "P1", rag: "green",  assigneeId: henry.id,  startDate: "2024-11-01", endDate: "2024-11-20", plannedEffortHours: "60",  actualHours: "58.00", isCritical: true,  order: 1, predecessorIds: "[1]" },
      { projectId: proj1.id, milestoneId: ms1.id, workstreamId: ws1.id, name: "HR Module Config",            status: "completed",   priority: "P2", rag: "green",  assigneeId: alice.id,  startDate: "2024-11-01", endDate: "2024-11-25", plannedEffortHours: "50",  actualHours: "55.00", isCritical: false, order: 2, predecessorIds: "[1]" },
      { projectId: proj1.id, milestoneId: ms1.id, workstreamId: ws1.id, name: "Procure-to-Pay Config",       status: "completed",   priority: "P1", rag: "green",  assigneeId: henry.id,  startDate: "2024-11-21", endDate: "2024-11-30", plannedEffortHours: "30",  actualHours: "28.00", isCritical: true,  order: 3, predecessorIds: "[2]" },
      // Data Migration workstream
      { projectId: proj1.id, milestoneId: ms2.id, workstreamId: ws2.id, name: "Data Extraction Rules",       status: "completed",   priority: "P1", rag: "green",  assigneeId: alice.id,  startDate: "2024-12-01", endDate: "2024-12-20", plannedEffortHours: "35",  actualHours: "38.00", isCritical: true,  order: 0, predecessorIds: "[]" },
      { projectId: proj1.id, milestoneId: ms2.id, workstreamId: ws2.id, name: "Customer Master Migration",   status: "completed",   priority: "P1", rag: "green",  assigneeId: alice.id,  startDate: "2024-12-21", endDate: "2025-01-15", plannedEffortHours: "48",  actualHours: "50.00", isCritical: true,  order: 1, predecessorIds: "[5]" },
      { projectId: proj1.id, milestoneId: ms2.id, workstreamId: ws2.id, name: "Financial Data Migration",    status: "completed",   priority: "P1", rag: "green",  assigneeId: henry.id,  startDate: "2025-01-16", endDate: "2025-02-10", plannedEffortHours: "60",  actualHours: "62.00", isCritical: true,  order: 2, predecessorIds: "[6]" },
      { projectId: proj1.id, milestoneId: ms2.id, workstreamId: ws2.id, name: "Data Reconciliation",         status: "completed",   priority: "P1", rag: "green",  assigneeId: henry.id,  startDate: "2025-02-11", endDate: "2025-02-28", plannedEffortHours: "40",  actualHours: "39.00", isCritical: true,  order: 3, predecessorIds: "[7]" },
      // UAT workstream (in progress)
      { projectId: proj1.id, milestoneId: ms3.id, workstreamId: ws1.id, name: "UAT Test Script Preparation", status: "completed",   priority: "P1", rag: "green",  assigneeId: alice.id,  startDate: "2025-03-01", endDate: "2025-03-20", plannedEffortHours: "40",  actualHours: "40.00", isCritical: true,  order: 0, predecessorIds: "[]" },
      { projectId: proj1.id, milestoneId: ms3.id, workstreamId: ws1.id, name: "Finance UAT Execution",       status: "in_progress", priority: "P1", rag: "amber",  assigneeId: henry.id,  startDate: "2025-03-21", endDate: "2025-04-30", plannedEffortHours: "80",  actualHours: "35.00", isCritical: true,  order: 1, predecessorIds: "[9]" },
      { projectId: proj1.id, milestoneId: ms3.id, workstreamId: ws1.id, name: "HR UAT Execution",            status: "in_progress", priority: "P2", rag: "green",  assigneeId: alice.id,  startDate: "2025-03-21", endDate: "2025-04-30", plannedEffortHours: "60",  actualHours: "20.00", isCritical: false, order: 2, predecessorIds: "[9]" },
      { projectId: proj1.id, milestoneId: ms3.id, workstreamId: ws1.id, name: "Defect Fix & Retest",         status: "not_started", priority: "P1", rag: "green",  assigneeId: henry.id,  startDate: "2025-05-01", endDate: "2025-05-15", plannedEffortHours: "50",  isCritical: true,  order: 3, predecessorIds: "[10,11]" },
      // Training workstream
      { projectId: proj1.id, milestoneId: ms4.id, workstreamId: ws3.id, name: "Training Material Development", status: "in_progress", priority: "P2", rag: "green",  assigneeId: alice.id, startDate: "2025-04-01", endDate: "2025-04-30", plannedEffortHours: "70",  actualHours: "20.00", isCritical: false, order: 0, predecessorIds: "[]" },
      { projectId: proj1.id, milestoneId: ms4.id, workstreamId: ws3.id, name: "Key User Training",           status: "not_started", priority: "P2", rag: "green",  assigneeId: alice.id,  startDate: "2025-05-01", endDate: "2025-05-20", plannedEffortHours: "60",  isCritical: false, order: 1, predecessorIds: "[13]" },
      { projectId: proj1.id, milestoneId: ms4.id, workstreamId: ws3.id, name: "End-User Training",           status: "not_started", priority: "P2", rag: "green",  assigneeId: alice.id,  startDate: "2025-05-21", endDate: "2025-06-01", plannedEffortHours: "90",  isCritical: false, order: 2, predecessorIds: "[14]" },
    ])
    .returning();

  // ─── Time Logs ─────────────────────────────────────────────────────────────
  console.log("  → timelogs");
  await db.insert(schema.timelogsTable).values([
    { taskId: t10.id, userId: henry.id, date: "2025-03-21", hours: "8",  note: "Started Finance UAT — FI-AP test cases" },
    { taskId: t10.id, userId: henry.id, date: "2025-03-24", hours: "7.5", note: "FI-AR test cases; 2 defects logged" },
    { taskId: t10.id, userId: henry.id, date: "2025-03-28", hours: "8",  note: "GL posting tests complete" },
    { taskId: t10.id, userId: henry.id, date: "2025-04-02", hours: "7",  note: "Asset accounting UAT; blocked on master data" },
    { taskId: t10.id, userId: alice.id, date: "2025-04-05", hours: "4.5", note: "Peer review of test results" },
    { taskId: t11.id, userId: alice.id, date: "2025-03-21", hours: "6",  note: "HR info-type validation" },
    { taskId: t11.id, userId: alice.id, date: "2025-03-25", hours: "8",  note: "Payroll parallel run simulation" },
    { taskId: t11.id, userId: alice.id, date: "2025-04-01", hours: "6",  note: "Leave management tests" },
    { taskId: t13.id, userId: alice.id, date: "2025-04-05", hours: "5",  note: "Finance module training deck — first draft" },
    { taskId: t13.id, userId: alice.id, date: "2025-04-10", hours: "6",  note: "HR module training deck" },
    { taskId: t13.id, userId: alice.id, date: "2025-04-14", hours: "5",  note: "Hands-on exercise workbooks" },
    { taskId: t13.id, userId: henry.id, date: "2025-04-18", hours: "4",  note: "Review and corrections" },
  ]);

  // ─── Risks ─────────────────────────────────────────────────────────────────
  console.log("  → risks");
  await db.insert(schema.risksTable).values([
    { charterId: charter1.id, title: "Data Quality Issues", description: "Legacy data has inconsistencies that could delay migration cutover.", impact: "high", likelihood: "high", priority: "high", rag: "red", mitigation: "Run parallel data cleansing sprints; define acceptance criteria before migration dry run.", status: "open", owner: "Henry D'Souza" },
    { charterId: charter1.id, title: "Resource Availability — Key Functional Consultants", description: "Vendor FTEs are allocated across 2 other projects.", impact: "medium", likelihood: "medium", priority: "medium", rag: "amber", mitigation: "Contractual SLA for dedicated headcount; escalation clause if utilisation < 80%.", status: "open", owner: "Grace Nair" },
    { charterId: charter1.id, title: "Change Management Resistance", description: "End-users accustomed to legacy system may resist new workflows.", impact: "medium", likelihood: "high", priority: "medium", rag: "amber", mitigation: "Early engagement programme; key-user champions per department; pilot group feedback loop.", status: "open", owner: "Bob Patel" },
    { charterId: charter1.id, title: "Scope Creep — Additional Module Requests", description: "Business units requesting modules not in original scope.", impact: "high", likelihood: "medium", priority: "high", rag: "amber", mitigation: "Strict CCB (Change Control Board) process; all additions require PMO approval and budget impact analysis.", status: "mitigated", owner: "Grace Nair" },
    { charterId: charter2.id, title: "SSO Integration Complexity", description: "Azure AD integration may require additional security review cycles.", impact: "medium", likelihood: "medium", priority: "medium", rag: "amber", mitigation: "Engage InfoSec team from sprint 1; run security review in parallel.", status: "open", owner: "Henry D'Souza" },
  ]);

  // ─── Issues ────────────────────────────────────────────────────────────────
  console.log("  → issues");
  await db.insert(schema.issuesTable).values([
    { projectId: proj1.id, taskId: t10.id, title: "Asset master data not cleansed — blocks AP testing", dependencyType: "data", blockingOwnerId: dave.id, blockingDept: "Finance", originalDeadline: "2025-04-01", proposedRevisedDeadline: "2025-04-15", status: "open",     raisedBy: henry.id, description: "Finance team has not completed asset master cleansing; AP test cases cannot proceed." },
    { projectId: proj1.id, taskId: t12.id, title: "Defect backlog > 20 open P1 defects",               dependencyType: "quality", blockingOwnerId: henry.id, blockingDept: "IT", originalDeadline: "2025-04-30", proposedRevisedDeadline: "2025-05-10", status: "open", raisedBy: grace.id, description: "UAT has surfaced 22 P1 defects that need resolution before sign-off gate." },
    { projectId: proj1.id, title: "Vendor support response SLA breach (48h → 72h)",                   dependencyType: "vendor",  blockingDept: "Vendor", originalDeadline: "2025-03-15", status: "resolved", raisedBy: henry.id, description: "Vendor took 72h average on P2 tickets, violating the 48h SLA. Escalated and resolved.", resolutionNotes: "Vendor agreed to dedicated support engineer for remainder of project." },
  ]);

  // ─── Budget Lines ──────────────────────────────────────────────────────────
  console.log("  → budget lines");
  await db.insert(schema.budgetLinesTable).values([
    { projectId: proj1.id, category: "capex", description: "SAP S/4HANA Licences (3-year)",          baselineAmount: "4500000", forecastAmount: "4500000", actualAmount: "4500000", varianceAmount: "0",       variancePct: "0.00",   period: "q4_2024" },
    { projectId: proj1.id, category: "capex", description: "Implementation Services — Vendor",        baselineAmount: "3500000", forecastAmount: "3800000", actualAmount: "2100000", varianceAmount: "-300000",  variancePct: "-8.57",  period: "q1_2025" },
    { projectId: proj1.id, category: "opex",  description: "Infrastructure / Azure Hosting",          baselineAmount: "800000",  forecastAmount: "850000",  actualAmount: "425000",  varianceAmount: "-50000",   variancePct: "-6.25",  period: "q1_2025" },
    { projectId: proj1.id, category: "opex",  description: "Change Management & Training",            baselineAmount: "700000",  forecastAmount: "720000",  actualAmount: "150000",  varianceAmount: "-20000",   variancePct: "-2.86",  period: "q2_2025" },
    { projectId: proj1.id, category: "capex", description: "Hardware Refresh (servers/endpoints)",    baselineAmount: "1000000", forecastAmount: "950000",  actualAmount: "950000",  varianceAmount: "50000",    variancePct: "5.00",   period: "q4_2024" },
  ]);

  // ─── Resource Allocations ──────────────────────────────────────────────────
  console.log("  → resource allocations");
  await db.insert(schema.resourceAllocationsTable).values([
    { projectId: proj1.id, userId: henry.id, role: "Project Manager",     skill: "SAP PM",        allocationPct: "100", startDate: "2024-09-01", endDate: "2025-06-30" },
    { projectId: proj1.id, userId: alice.id, role: "Functional Lead",     skill: "SAP FI/HR",     allocationPct: "80",  startDate: "2024-10-01", endDate: "2025-05-31" },
    { projectId: proj1.id, userId: bob.id,   role: "Steering Committee",  skill: "Governance",    allocationPct: "10",  startDate: "2024-09-01", endDate: "2025-06-30" },
    { projectId: proj2.id, userId: henry.id, role: "Project Manager",     skill: "Web / React",   allocationPct: "20",  startDate: "2025-01-15", endDate: "2025-09-30" },
  ]);

  // ─── Notifications ─────────────────────────────────────────────────────────
  console.log("  → notifications");
  await db.insert(schema.notificationsTable).values([
    { userId: henry.id, type: "risk_alert",        title: "High Risk: Data Quality Issues",             body: "Risk score is 25/25. Immediate mitigation required.",              link: `/projects/${proj1.id}`, isRead: false, relatedEntityType: "project", relatedEntityId: proj1.id },
    { userId: henry.id, type: "issue_raised",      title: "Issue raised on Finance UAT Execution",     body: "Asset master data not cleansed — blocks AP testing.",               link: `/projects/${proj1.id}`, isRead: false, relatedEntityType: "task",    relatedEntityId: t10.id },
    { userId: grace.id, type: "approval_required", title: "Charter Pending: Customer Portal Redesign", body: "You have a pending PMO review action for charter #2.",              link: `/charters/${charter2.id}`, isRead: false, relatedEntityType: "charter", relatedEntityId: charter2.id },
    { userId: henry.id, type: "milestone_due",     title: "Milestone Due in 14 Days: UAT Sign-off",   body: "UAT Sign-off milestone is due 2025-05-15. Status: In Progress.",   link: `/projects/${proj1.id}`, isRead: true,  relatedEntityType: "milestone", relatedEntityId: ms3.id },
  ]);

  // ─── Escalation Rules ──────────────────────────────────────────────────────
  console.log("  → escalation rules");
  await db.insert(schema.escalationRulesTable).values([
    { projectId: proj1.id, triggerType: "rag_red",             thresholdValue: "1",  notifyUserIds: [grace.id, carol.id], isActive: true },
    { projectId: proj1.id, triggerType: "budget_variance_pct", thresholdValue: "10", notifyUserIds: [dave.id, grace.id],  isActive: true },
    { projectId: null,     triggerType: "delay_days",          thresholdValue: "14", notifyUserIds: [grace.id],           isActive: true },
  ]);

  await pool.end();
  console.log("✅ Seed complete.");
}

seed().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
