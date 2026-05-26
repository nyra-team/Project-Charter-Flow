import { Router, type IRouter } from "express";
import { db, projectStagesTable, projectsTable, documentsTable, issuesTable } from "@workspace/db";
import { eq, and, inArray, ne } from "drizzle-orm";
import { logActivity } from "./activity";

const router: IRouter = Router();

// Server-side lifecycle gate config (mirrors lifecycle-config.ts in the frontend)
// This is the authoritative enforcement layer — the UI gates are UX only.
type StageGate = {
  prerequisites: string[];
  blockingChecklistIds: string[];
  requiredDocNames: string[];
  advanceRoles: string[];
};

const STAGE_GATES: Record<string, StageGate> = {
  project_case: {
    prerequisites: [],
    blockingChecklistIds: ["biz_just", "scope_done", "outcomes", "budget_est"],
    // Documents are optional for the Business Case stage — the form's structured
    // fields (BJ / Scope / Outcomes / Budget) are the source of truth, and the
    // checklist is derived from them. No uploads required to submit.
    requiredDocNames: [],
    advanceRoles: ["initiator", "pmo"],
  },
  urs: {
    prerequisites: ["project_case"],
    blockingChecklistIds: ["biz_req", "it_review", "biz_owner_approved", "it_approved"],
    requiredDocNames: ["URS Document", "URS Review Sign-off"],
    advanceRoles: ["hod", "pmo"],
  },
  rfp: {
    prerequisites: ["urs"],
    blockingChecklistIds: ["urs_approved_gate", "rfp_created", "vendor_invited", "deadline_set"],
    requiredDocNames: ["RFP Document", "Vendor Shortlist"],
    advanceRoles: ["scm", "pmo"],
  },
  vendor_evaluation: {
    prerequisites: ["rfp"],
    blockingChecklistIds: [
      "proposals_received", "func_eval_done", "tech_eval_done", "eval_summary",
      "proposals_analysed", "negotiation_complete", "scm_uploaded", "finance_reviewed", "vendor_selected",
    ],
    requiredDocNames: [
      "Functional Scorecard", "Technical Evaluation Report",
      "Commercial Proposals", "Negotiation Log", "Finalized Commercials",
    ],
    advanceRoles: ["scm", "finance", "hod", "pmo"],
  },
  charter: {
    prerequisites: ["vendor_evaluation"],
    blockingChecklistIds: ["charter_drafted", "pmo_review", "dept_head_approved", "budget_confirmed"],
    requiredDocNames: ["Project Charter", "Charter Template"],
    advanceRoles: ["pmo", "hod"],
  },
  nfa: {
    prerequisites: ["charter"],
    blockingChecklistIds: ["charter_approved_gate", "nfa_form_submitted", "finance_head_approved", "pmo_nfa_approved", "dept_head_nfa", "mgmt_approved"],
    requiredDocNames: ["NFA Form", "Budget Breakdown"],
    advanceRoles: ["cfo", "chairman"],
  },
  legal: {
    prerequisites: ["nfa"],
    blockingChecklistIds: ["contract_uploaded", "legal_reviewed", "compliance_confirmed", "legal_signoff"],
    requiredDocNames: ["Vendor Contract", "Legal Review Note"],
    advanceRoles: ["legal", "pmo"],
  },
  pr_po: {
    prerequisites: ["legal"],
    blockingChecklistIds: ["legal_approved_gate", "vendor_contract_uploaded", "pr_submitted", "po_released"],
    requiredDocNames: ["PR Form", "PO Document", "Vendor Contract"],
    advanceRoles: ["finance", "scm"],
  },
  kickoff: {
    prerequisites: ["pr_po"],
    blockingChecklistIds: ["kickoff_date_set", "attendees_defined", "kickoff_held", "minutes_uploaded", "project_activated"],
    requiredDocNames: ["Meeting Minutes", "Kickoff Presentation"],
    advanceRoles: ["pm", "pmo"],
  },
  technical_design: {
    prerequisites: ["kickoff"],
    blockingChecklistIds: ["td_drafted", "arch_uploaded", "integrations_listed", "security_signed", "td_lead_approved"],
    requiredDocNames: ["Technical Design Document", "Architecture Diagram", "Security Review"],
    advanceRoles: ["pm", "pmo", "hod"],
  },
  development: {
    prerequisites: ["technical_design"],
    blockingChecklistIds: ["dev_env_ready", "status_updated"],
    requiredDocNames: ["Build Specifications", "Development Status Report"],
    advanceRoles: ["pm", "pmo"],
  },
  implementation_plan: {
    prerequisites: ["development"],
    blockingChecklistIds: ["impl_plan_uploaded", "milestones_defined", "stakeholder_signoff", "cutover_plan_approved"],
    requiredDocNames: ["Implementation Plan", "Cutover Plan"],
    advanceRoles: ["pm", "pmo"],
  },
  uat: {
    prerequisites: ["implementation_plan"],
    blockingChecklistIds: ["uat_plan_approved", "test_cases_executed", "critical_defects_closed", "uat_signed"],
    requiredDocNames: ["UAT Test Plan", "UAT Sign-off Document", "Defect Log"],
    advanceRoles: ["pm", "hod"],
  },
  go_live: {
    prerequisites: ["uat"],
    blockingChecklistIds: ["uat_approved_gate", "go_live_date_frozen", "training_uploaded", "stakeholders_notified"],
    requiredDocNames: ["Go Live Checklist", "Training Materials", "Communications Plan"],
    advanceRoles: ["pm", "pmo"],
  },
  closure_readiness: {
    prerequisites: ["go_live"],
    blockingChecklistIds: ["csat_complete", "doc_handover_done", "all_deliverables_signed", "support_transitioned"],
    requiredDocNames: ["CSAT Survey Results", "Documentation Handover Package", "Deliverable Sign-offs"],
    advanceRoles: ["pm", "pmo"],
  },
  project_closure: {
    prerequisites: ["closure_readiness"],
    blockingChecklistIds: ["all_artifacts_approved", "lessons_learned_done", "closure_report_generated", "final_financials_uploaded", "stakeholder_closed"],
    requiredDocNames: ["Lessons Learned Report", "Closure Report", "Final Financial Report"],
    advanceRoles: ["pm", "pmo", "chairman"],
  },
};

const ORDERED_STAGES = [
  "project_case", "urs", "rfp", "vendor_evaluation",
  "charter", "nfa", "legal", "pr_po", "kickoff", "technical_design", "development",
  "implementation_plan", "uat", "go_live", "closure_readiness", "project_closure",
];

router.get("/projects/:id/stages", async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const stages = await db.select().from(projectStagesTable).where(eq(projectStagesTable.projectId, projectId)).orderBy(projectStagesTable.createdAt);
  res.json(stages);
});

router.post("/projects/:id/stages", async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { stage, status, notes } = req.body as { stage: string; status?: string; notes?: string };
  if (!stage) { res.status(400).json({ error: "stage is required" }); return; }
  const [projectStage] = await db.insert(projectStagesTable).values({
    projectId,
    stage,
    status: status ?? "not_started",
    notes,
    enteredAt: status === "in_progress" ? new Date() : undefined,
  }).returning();
  res.status(201).json(projectStage);
});

router.get("/project-stages/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [stage] = await db.select().from(projectStagesTable).where(eq(projectStagesTable.id, id));
  if (!stage) { res.status(404).json({ error: "Project stage not found" }); return; }
  res.json(stage);
});

router.patch("/project-stages/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { status, notes, enteredAt, completedAt } = req.body as { status?: string; notes?: string; enteredAt?: string; completedAt?: string };
  const updateData: Record<string, unknown> = {};
  if (status !== undefined) updateData.status = status;
  if (notes !== undefined) updateData.notes = notes;
  if (enteredAt !== undefined) updateData.enteredAt = new Date(enteredAt);
  if (completedAt !== undefined) updateData.completedAt = new Date(completedAt);
  if (status === "complete" && completedAt === undefined) updateData.completedAt = new Date();
  if (status === "in_progress" && enteredAt === undefined) updateData.enteredAt = new Date();
  const [projectStage] = await db.update(projectStagesTable).set(updateData).where(eq(projectStagesTable.id, id)).returning();
  if (!projectStage) { res.status(404).json({ error: "Project stage not found" }); return; }
  res.json(projectStage);
});

router.post("/projects/:id/stages/:stage/advance", async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { stage } = req.params;
  // Role is read from the server-side session (set via POST /api/session/role when the
  // user switches role in the sidebar). This cannot be forged per-request by a client.
  const requestRole = req.session.simulatedRole;

  const gate = STAGE_GATES[stage];
  if (!gate) { res.status(400).json({ error: `Unknown stage: ${stage}` }); return; }

  // 0. Closed projects are read-only — no further stage advances are permitted
  const [project] = await db.select({ status: projectsTable.status }).from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }
  if (project.status === "closed") {
    res.status(409).json({ error: "Project is closed and archived. No further stage advances are permitted." });
    return;
  }

  // 1. Role authorization from server-side session
  if (!requestRole) {
    res.status(403).json({ error: "No role set in session. Please select a role before advancing a stage." });
    return;
  }
  if (!gate.advanceRoles.includes(requestRole)) {
    res.status(403).json({
      error: `Role '${requestRole}' is not authorized to advance stage '${stage}'. Allowed roles: ${gate.advanceRoles.join(", ")}`,
    });
    return;
  }

  // 2. Prerequisite stages must all be complete
  if (gate.prerequisites.length > 0) {
    const prereqRecords = await db.select()
      .from(projectStagesTable)
      .where(and(
        eq(projectStagesTable.projectId, projectId),
        inArray(projectStagesTable.stage, gate.prerequisites),
      ));
    const completedPrereqs = prereqRecords.filter(r => r.status === "complete").map(r => r.stage);
    const missing = gate.prerequisites.filter(p => !completedPrereqs.includes(p));
    if (missing.length > 0) {
      res.status(422).json({ error: `Prerequisites not yet complete: ${missing.join(", ")}` });
      return;
    }
  }

  // 3. Blocking checklist items must all be checked (read from persisted stage notes)
  if (gate.blockingChecklistIds.length > 0) {
    const [stageRecord] = await db.select()
      .from(projectStagesTable)
      .where(and(eq(projectStagesTable.projectId, projectId), eq(projectStagesTable.stage, stage)));
    if (stageRecord?.notes) {
      try {
        const parsed = JSON.parse(stageRecord.notes) as Record<string, unknown>;
        const checklistState = (parsed.__checklist ?? {}) as Record<string, boolean>;
        const unchecked = gate.blockingChecklistIds.filter(id => !checklistState[id]);
        if (unchecked.length > 0) {
          res.status(422).json({
            error: `${unchecked.length} blocking checklist item(s) not yet completed. Check all mandatory items before advancing.`,
            uncheckedItems: unchecked,
          });
          return;
        }
      } catch {
        // Notes is not valid JSON — checklist not saved yet; block the advance
        res.status(422).json({ error: "Checklist state not found. Please complete all blocking checklist items before advancing." });
        return;
      }
    } else {
      // No notes at all means checklist has never been touched; block if there are blocking items
      res.status(422).json({ error: "Checklist not yet completed. Please check all mandatory items before advancing." });
      return;
    }
  }

  // 4a. URS-specific gate: both Business Owner and IT Team approvals must be recorded in stage notes
  if (stage === "urs") {
    const [ursRecord] = await db.select({ notes: projectStagesTable.notes })
      .from(projectStagesTable)
      .where(and(eq(projectStagesTable.projectId, projectId), eq(projectStagesTable.stage, "urs")));
    let bizApproved = false;
    let itApproved = false;
    if (ursRecord?.notes) {
      try {
        const n = JSON.parse(ursRecord.notes) as Record<string, unknown>;
        bizApproved = n.__urs_biz_approved === true;
        itApproved = n.__urs_it_approved === true;
      } catch { /* treat as not approved */ }
    }
    if (!bizApproved || !itApproved) {
      const missing = [...(!bizApproved ? ["Business Owner"] : []), ...(!itApproved ? ["IT Team"] : [])];
      res.status(422).json({ error: `URS dual-approval required before advancing. Missing approvals: ${missing.join(", ")}.` });
      return;
    }
  }

  // 4b. UAT-specific gate: all critical defects must be resolved before advancing from uat
  if (stage === "uat") {
    const openCriticalDefects = await db.select()
      .from(issuesTable)
      .where(and(
        eq(issuesTable.projectId, projectId),
        eq(issuesTable.dependencyType, "uat_defect"),
        ne(issuesTable.status, "resolved"),
      ));
    if (openCriticalDefects.length > 0) {
      res.status(422).json({
        error: `${openCriticalDefects.length} unresolved UAT defect(s) must be closed before advancing to Go Live.`,
        openDefectCount: openCriticalDefects.length,
      });
      return;
    }
  }

  // 5. Required documents must all be uploaded
  if (gate.requiredDocNames.length > 0) {
    const docs = await db.select()
      .from(documentsTable)
      .where(and(eq(documentsTable.projectId, projectId), eq(documentsTable.stage, stage)));
    const uploadedNames = docs.map(d => d.name);
    const missingDocs = gate.requiredDocNames.filter(n => !uploadedNames.includes(n));
    if (missingDocs.length > 0) {
      res.status(422).json({
        error: `Required documents not yet uploaded: ${missingDocs.join(", ")}`,
        missingDocs,
      });
      return;
    }
  }

  // All gates passed — complete the current stage and activate next
  const stageIdx = ORDERED_STAGES.indexOf(stage);
  await db.update(projectStagesTable)
    .set({ status: "complete", completedAt: new Date() })
    .where(and(eq(projectStagesTable.projectId, projectId), eq(projectStagesTable.stage, stage)));

  const nextStage = ORDERED_STAGES[stageIdx + 1];
  if (nextStage) {
    const existing = await db.select().from(projectStagesTable)
      .where(and(eq(projectStagesTable.projectId, projectId), eq(projectStagesTable.stage, nextStage)));
    if (existing.length === 0) {
      await db.insert(projectStagesTable).values({ projectId, stage: nextStage, status: "in_progress", enteredAt: new Date() });
    } else {
      await db.update(projectStagesTable)
        .set({ status: "in_progress", enteredAt: new Date() })
        .where(and(eq(projectStagesTable.projectId, projectId), eq(projectStagesTable.stage, nextStage)));
    }
    await db.update(projectsTable).set({ stage: nextStage, updatedAt: new Date() }).where(eq(projectsTable.id, projectId));
  } else {
    // No next stage — this is project_closure being completed.
    // Archive the project: mark status "closed" (read-only operational state).
    await db.update(projectsTable)
      .set({ status: "closed", updatedAt: new Date() })
      .where(eq(projectsTable.id, projectId));
    await logActivity(
      "project_closed",
      `Project ${projectId} formally closed and archived. All stages complete.`,
      projectId,
      "project",
    );
  }

  // Audit log the transition
  await logActivity(
    "stage_advanced",
    `Project lifecycle advanced from "${stage}" to "${nextStage ?? "(final)"}"${requestRole ? ` by ${requestRole}` : ""}`,
    projectId,
    "project",
  );

  const stages = await db.select().from(projectStagesTable).where(eq(projectStagesTable.projectId, projectId)).orderBy(projectStagesTable.createdAt);
  res.json({ projectId, stages, advancedTo: nextStage ?? null });
});

// Test-only: bypass ALL gates (role, prerequisites, checklist, docs, dual
// approvals) and force the project's current stage to "complete" + activate
// the next stage. Restricted to the "initiator" session role for demo/testing.
// Records the simulated approver role in the activity log so the audit trail
// still tells the story of who "approved".
router.post("/projects/:id/stages/:stage/test-advance", async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { stage } = req.params;
  const requestRole = req.session.simulatedRole;

  if (requestRole !== "initiator") {
    res.status(403).json({ error: "Test-advance is only available in initiator (testing) role." });
    return;
  }

  const gate = STAGE_GATES[stage];
  if (!gate) { res.status(400).json({ error: `Unknown stage: ${stage}` }); return; }

  const [project] = await db.select({ status: projectsTable.status }).from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }
  if (project.status === "closed") {
    res.status(409).json({ error: "Project is closed and archived." });
    return;
  }

  const { simulatedApprover } = (req.body ?? {}) as { simulatedApprover?: string };

  // For URS: also auto-fill the dual-approval flags so the audit story is consistent.
  if (stage === "urs") {
    const [ursRecord] = await db.select().from(projectStagesTable)
      .where(and(eq(projectStagesTable.projectId, projectId), eq(projectStagesTable.stage, "urs")));
    if (ursRecord) {
      let notes: Record<string, unknown> = {};
      try { notes = JSON.parse(ursRecord.notes ?? "{}") as Record<string, unknown>; } catch { /* ignore */ }
      const now = new Date().toISOString();
      notes.__urs_biz_approved = true;
      notes.__urs_biz_approved_at = now;
      notes.__urs_biz_approver = notes.__urs_biz_approver ?? "hod (test)";
      notes.__urs_it_approved = true;
      notes.__urs_it_approved_at = now;
      notes.__urs_it_approver = notes.__urs_it_approver ?? "pmo (test)";
      await db.update(projectStagesTable).set({ notes: JSON.stringify(notes) })
        .where(eq(projectStagesTable.id, ursRecord.id));
    }
  }

  // Complete the current stage and activate the next
  const stageIdx = ORDERED_STAGES.indexOf(stage);
  await db.update(projectStagesTable)
    .set({ status: "complete", completedAt: new Date() })
    .where(and(eq(projectStagesTable.projectId, projectId), eq(projectStagesTable.stage, stage)));

  const nextStage = ORDERED_STAGES[stageIdx + 1];
  if (nextStage) {
    const existing = await db.select().from(projectStagesTable)
      .where(and(eq(projectStagesTable.projectId, projectId), eq(projectStagesTable.stage, nextStage)));
    if (existing.length === 0) {
      await db.insert(projectStagesTable).values({ projectId, stage: nextStage, status: "in_progress", enteredAt: new Date() });
    } else {
      await db.update(projectStagesTable)
        .set({ status: "in_progress", enteredAt: new Date() })
        .where(and(eq(projectStagesTable.projectId, projectId), eq(projectStagesTable.stage, nextStage)));
    }
    await db.update(projectsTable).set({ stage: nextStage, updatedAt: new Date() }).where(eq(projectsTable.id, projectId));
  } else {
    await db.update(projectsTable)
      .set({ status: "closed", updatedAt: new Date() })
      .where(eq(projectsTable.id, projectId));
  }

  await logActivity(
    "stage_test_advanced",
    `[TEST] ${simulatedApprover ?? "initiator"} force-advanced "${stage}" → "${nextStage ?? "(closed)"}"`,
    projectId,
    "project",
  );

  const stages = await db.select().from(projectStagesTable).where(eq(projectStagesTable.projectId, projectId)).orderBy(projectStagesTable.createdAt);
  res.json({ projectId, stages, advancedTo: nextStage ?? null });
});

router.delete("/project-stages/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(projectStagesTable).where(eq(projectStagesTable.id, id));
  res.sendStatus(204);
});

export default router;
