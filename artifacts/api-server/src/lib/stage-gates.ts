import { db, projectStagesTable, documentsTable, issuesTable, approvalsTable, projectsTable } from "@workspace/db";
import { eq, and, ne } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Authoritative lifecycle gate config (Option B, 9 merged stages).
//
// This is the single source of truth for stage-gate enforcement. It powers:
//   - the advance endpoint (routes/project_stages.ts) — mutating
//   - the stage-governance critical path (routes/projects.ts) — read-only
//   - the portfolio critical-path rollup (routes/dashboard.ts) — read-only
//   - escalation scans (jobs/escalation-evaluator.ts)
//
// Mirrors lifecycle-config.ts in the frontend. UI gates are UX only; this is
// the enforcement layer. Each gate is the UNION of its constituents' blocking
// checklist ids, required docs and advance roles, so every control is preserved.
// Prerequisites are NOT hard-coded here — they are derived from the project's
// path (prerequisiteFor) so 'internal' projects gate correctly when procurement
// stages are skipped.
// ---------------------------------------------------------------------------

export type StageGate = {
  blockingChecklistIds: string[];
  requiredDocNames: string[];
  advanceRoles: string[];
};

export const STAGE_GATES: Record<string, StageGate> = {
  initiation: {
    blockingChecklistIds: ["biz_just", "scope_done", "outcomes", "budget_est", "biz_req", "it_review", "biz_owner_approved", "it_approved"],
    requiredDocNames: ["URS Document", "URS Review Sign-off"],
    advanceRoles: ["initiator", "pmo", "hod"],
  },
  vendor_selection: {
    blockingChecklistIds: [
      "urs_approved_gate", "rfp_created", "vendor_invited", "deadline_set",
      "proposals_received", "func_eval_done", "tech_eval_done", "eval_summary",
      "proposals_analysed", "negotiation_complete", "scm_uploaded", "finance_reviewed", "vendor_selected",
    ],
    requiredDocNames: [
      "RFP Document", "Vendor Shortlist",
      "Functional Scorecard", "Technical Evaluation Report",
      "Commercial Proposals", "Negotiation Log", "Finalized Commercials",
    ],
    advanceRoles: ["scm", "pmo", "finance", "hod"],
  },
  investment_authorization: {
    blockingChecklistIds: [
      "charter_drafted", "pmo_review", "dept_head_approved", "budget_confirmed",
      "nfa_form_submitted", "finance_head_approved", "pmo_nfa_approved", "dept_head_nfa", "mgmt_approved",
    ],
    requiredDocNames: ["Project Charter", "Charter Template", "NFA Form", "Budget Breakdown"],
    advanceRoles: ["pmo", "hod", "cfo", "chairman"],
  },
  contract_po: {
    blockingChecklistIds: ["contract_uploaded", "legal_reviewed", "compliance_confirmed", "legal_signoff", "pr_submitted", "po_released"],
    requiredDocNames: ["Vendor Contract", "Legal Review Note", "PR Form", "PO Document"],
    advanceRoles: ["legal", "pmo", "finance", "scm"],
  },
  design: {
    blockingChecklistIds: [
      "kickoff_date_set", "attendees_defined", "kickoff_held", "minutes_uploaded", "project_activated",
      "td_drafted", "arch_uploaded", "integrations_listed", "security_signed", "td_lead_approved",
    ],
    requiredDocNames: ["Meeting Minutes", "Kickoff Presentation", "Technical Design Document", "Architecture Diagram", "Security Review"],
    advanceRoles: ["pm", "pmo", "hod"],
  },
  build: {
    blockingChecklistIds: ["dev_env_ready", "status_updated", "impl_plan_uploaded", "milestones_defined", "stakeholder_signoff", "cutover_plan_approved"],
    requiredDocNames: ["Build Specifications", "Development Status Report", "Implementation Plan", "Cutover Plan"],
    advanceRoles: ["pm", "pmo"],
  },
  uat: {
    blockingChecklistIds: ["uat_plan_approved", "test_cases_executed", "critical_defects_closed", "uat_signed"],
    requiredDocNames: ["UAT Test Plan", "UAT Sign-off Document", "Defect Log"],
    advanceRoles: ["pm", "hod"],
  },
  go_live: {
    blockingChecklistIds: ["uat_approved_gate", "go_live_date_frozen", "training_uploaded", "stakeholders_notified"],
    requiredDocNames: ["Go Live Checklist", "Training Materials", "Communications Plan"],
    advanceRoles: ["pm", "pmo"],
  },
  closure: {
    blockingChecklistIds: [
      "csat_complete", "doc_handover_done", "all_deliverables_signed", "support_transitioned",
      "lessons_learned_done", "closure_report_generated", "final_financials_uploaded", "stakeholder_closed",
    ],
    requiredDocNames: [
      "CSAT Survey Results", "Documentation Handover Package", "Deliverable Sign-offs",
      "Lessons Learned Report", "Closure Report", "Final Financial Report",
    ],
    advanceRoles: ["pm", "pmo", "chairman"],
  },
};

// ---------------------------------------------------------------------------
// Conditional paths
// ---------------------------------------------------------------------------

// Display metadata per stage (mirrors lifecycle-config.ts / lifecycle-phases.ts in
// the frontend). Kept here so the API and server-side escalation emails can label
// stages without the client. 9 entries — low drift risk.
export type StageMeta = { label: string; shortLabel: string; phaseKey: string; color: string };

export const STAGE_META: Record<string, StageMeta> = {
  initiation: { label: "Initiation", shortLabel: "INIT", phaseKey: "initiate", color: "#6366F1" },
  vendor_selection: { label: "Vendor Selection", shortLabel: "VS", phaseKey: "procure", color: "#10B981" },
  investment_authorization: { label: "Investment Authorization", shortLabel: "IA", phaseKey: "procure", color: "#EF4444" },
  contract_po: { label: "Contract & PO", shortLabel: "CPO", phaseKey: "procure", color: "#7C3AED" },
  design: { label: "Design", shortLabel: "DSN", phaseKey: "execute", color: "#0EA5E9" },
  build: { label: "Build & Implementation", shortLabel: "BLD", phaseKey: "execute", color: "#6366F1" },
  uat: { label: "UAT Sign-off", shortLabel: "UAT", phaseKey: "release_close", color: "#F59E0B" },
  go_live: { label: "Go Live", shortLabel: "GO", phaseKey: "release_close", color: "#10B981" },
  closure: { label: "Closure", shortLabel: "CLS", phaseKey: "release_close", color: "#1E293B" },
};

// ---------------------------------------------------------------------------
// Sub-gates — independently-governed deliverables WITHIN a single stage.
// Only `initiation` uses them today: Business Case + URS are two distinct,
// separately-approved/audited gates that live inside one lifecycle stage (so the
// project never has to navigate to a new stage between them). A stage with
// sub-gates is satisfied only when EVERY sub-gate is satisfied.
// ---------------------------------------------------------------------------

export type ApprovalFlag = { flag: string; label: string };

export type SubGate = {
  key: string;
  label: string;
  blockingChecklistIds: string[];
  requiredDocNames: string[];
  // Notes flags that must all be `true` for this sub-gate's approval.
  approvalFlags: ApprovalFlag[];
  // pmo_stage_slas key for this sub-gate's overdue clock (falls back to the stage SLA).
  slaKey: string;
  // Prior sub-gates whose approval must land before THIS sub-gate may be approved
  // (drafting is always allowed; only the approval/sign-off is sequenced).
  requiresApprovedSubgates?: string[];
};

export const STAGE_SUBGATES: Record<string, SubGate[]> = {
  initiation: [
    {
      key: "business_case",
      label: "Business Case",
      blockingChecklistIds: ["biz_just", "scope_done", "outcomes", "budget_est"],
      requiredDocNames: [], // BC docs are optional
      approvalFlags: [{ flag: "__bc_approved", label: "Business Case approval" }],
      slaKey: "initiation.business_case",
    },
    {
      key: "urs",
      label: "URS",
      blockingChecklistIds: ["biz_req", "it_review", "biz_owner_approved", "it_approved"],
      requiredDocNames: ["URS Document", "URS Review Sign-off"],
      approvalFlags: [
        { flag: "__urs_biz_approved", label: "Business Owner" },
        { flag: "__urs_it_approved", label: "IT Team" },
      ],
      slaKey: "initiation.urs",
      requiresApprovedSubgates: ["business_case"],
    },
  ],
};

export function subGatesFor(stage: string): SubGate[] {
  return STAGE_SUBGATES[stage] ?? [];
}

// ---------------------------------------------------------------------------
// Per-stage PRIMARY responsible role — the "trigger owner" surfaced on the stage
// card and the default escalation target when there's no concrete pending-approval
// row. Resolved to an actual person/email at runtime via lib/role-resolver.ts
// (org roles → pmo_role_directory; sponsor/project_manager → charter/project).
// These keys must match the role directory + escalation-policy targetRole vocabulary.
// ---------------------------------------------------------------------------
export const STAGE_OWNER_ROLE: Record<string, string> = {
  initiation: "hod",
  vendor_selection: "procurement_head",
  investment_authorization: "cfo",
  contract_po: "legal_head",
  design: "project_manager",
  build: "project_manager",
  uat: "qa_lead",
  go_live: "project_manager",
  closure: "project_manager",
};

export type ProjectType = "internal" | "vendor";

// Full vendor/procurement path — all 9 stages, in order.
export const VENDOR_PATH = [
  "initiation", "vendor_selection", "investment_authorization", "contract_po",
  "design", "build", "uat", "go_live", "closure",
] as const;

// Stages internal projects skip (no procurement / external contracting).
export const INTERNAL_SKIPPED_STAGES = ["vendor_selection", "contract_po"];

export const STAGE_PATHS: Record<ProjectType, string[]> = {
  vendor: [...VENDOR_PATH],
  internal: VENDOR_PATH.filter((s) => !INTERNAL_SKIPPED_STAGES.includes(s)),
};

function normalizeType(projectType?: string | null): ProjectType {
  return projectType === "internal" ? "internal" : "vendor";
}

/** Ordered list of stages that apply to a project of the given type. */
export function applicableStages(projectType?: string | null): string[] {
  return STAGE_PATHS[normalizeType(projectType)];
}

/** The stage that must be complete before `stage` (the previous applicable stage), or null. */
export function prerequisiteFor(stage: string, projectType?: string | null): string | null {
  const path = applicableStages(projectType);
  const idx = path.indexOf(stage);
  return idx > 0 ? path[idx - 1] : null;
}

/** The stage that follows `stage` on the project's path, or null at the end. */
export function nextStageFor(stage: string, projectType?: string | null): string | null {
  const path = applicableStages(projectType);
  const idx = path.indexOf(stage);
  return idx >= 0 && idx < path.length - 1 ? path[idx + 1] : null;
}

// ---------------------------------------------------------------------------
// Non-mutating gate evaluation — returns WHY a stage can/can't advance.
// ---------------------------------------------------------------------------

export type PendingApproval = {
  id: number;
  approverId: number | null;
  approverRole: string;
  dueAt: Date | null;
  breached: boolean;
};

export type SubGateEvaluation = {
  key: string;
  label: string;
  satisfied: boolean;
  uncheckedChecklist: string[];
  missingDocs: string[];
  approvalsMissing: string[];      // labels of unmet approval flags
  approvalBlockedBy: string[];     // prior sub-gates not yet approved (blocks sign-off)
  approvedAt: string | null;       // latest approval timestamp on this sub-gate
};

export type GateEvaluation = {
  satisfied: boolean;
  prerequisitesMissing: string[];
  uncheckedChecklist: string[];
  missingDocs: string[];
  openUatDefects: number;
  ursDualApprovalMissing: string[];
  pendingApprovals: PendingApproval[];
  // Present only for stages that have sub-gates (currently `initiation`).
  subGates?: SubGateEvaluation[];
  bcApprovalMissing?: boolean;
};

/**
 * Read-only evaluation of a stage's gate for a project. `satisfied` mirrors the
 * advance endpoint's pass/fail (prereqs + checklist + URS dual-approval + UAT
 * defects + required docs). Pending approvals are surfaced informationally (they
 * are represented as checklist items in the gate, so they don't gate `satisfied`
 * on their own — but they tell us WHO to chase / escalate).
 */
export async function evaluateStageGate(
  projectId: number,
  stage: string,
  projectType?: string | null,
): Promise<GateEvaluation> {
  const result: GateEvaluation = {
    satisfied: true,
    prerequisitesMissing: [],
    uncheckedChecklist: [],
    missingDocs: [],
    openUatDefects: 0,
    ursDualApprovalMissing: [],
    pendingApprovals: [],
  };
  const gate = STAGE_GATES[stage];
  if (!gate) return result;

  // Prerequisite (previous applicable stage) must be complete.
  const prereq = prerequisiteFor(stage, projectType);
  if (prereq) {
    const [pr] = await db.select().from(projectStagesTable)
      .where(and(eq(projectStagesTable.projectId, projectId), eq(projectStagesTable.stage, prereq)));
    if (!pr || pr.status !== "complete") result.prerequisitesMissing.push(prereq);
  }

  // Load this stage's record once (used for checklist + URS flags).
  const [stageRecord] = await db.select().from(projectStagesTable)
    .where(and(eq(projectStagesTable.projectId, projectId), eq(projectStagesTable.stage, stage)));
  let notes: Record<string, unknown> = {};
  if (stageRecord?.notes) { try { notes = JSON.parse(stageRecord.notes) as Record<string, unknown>; } catch { notes = {}; } }

  const checklistState = (notes.__checklist ?? {}) as Record<string, boolean>;
  const subGates = subGatesFor(stage);

  if (subGates.length > 0) {
    // Sub-gated stage (initiation): evaluate each sub-gate independently. The
    // stage's aggregate fields are the union across sub-gates so generic consumers
    // still work, and subGates[] carries the per-sub-gate breakdown.
    const stageDocs = gate.requiredDocNames.length || subGates.some((s) => s.requiredDocNames.length)
      ? (await db.select().from(documentsTable).where(and(eq(documentsTable.projectId, projectId), eq(documentsTable.stage, stage)))).map((d) => d.name)
      : [];
    const approvedKeys = new Set<string>();
    const subEvals: SubGateEvaluation[] = subGates.map((sg) => {
      const unchecked = sg.blockingChecklistIds.filter((id) => !checklistState[id]);
      const missingDocs = sg.requiredDocNames.filter((n) => !stageDocs.includes(n));
      const approvalsMissing = sg.approvalFlags.filter((a) => notes[a.flag] !== true).map((a) => a.label);
      const approvalBlockedBy = (sg.requiresApprovedSubgates ?? []).filter((k) => !approvedKeys.has(k));
      const satisfied = unchecked.length === 0 && missingDocs.length === 0 && approvalsMissing.length === 0;
      if (satisfied) approvedKeys.add(sg.key);
      // Latest approval timestamp recorded on this sub-gate (for audit display).
      const tsKeys = sg.approvalFlags.map((a) => `${a.flag}_at`);
      const approvedAt = tsKeys.map((k) => (typeof notes[k] === "string" ? (notes[k] as string) : null)).filter(Boolean).sort().pop() ?? null;
      return { key: sg.key, label: sg.label, satisfied, uncheckedChecklist: unchecked, missingDocs, approvalsMissing, approvalBlockedBy, approvedAt };
    });
    result.subGates = subEvals;
    result.uncheckedChecklist = subEvals.flatMap((s) => s.uncheckedChecklist);
    result.missingDocs = subEvals.flatMap((s) => s.missingDocs);
    // Back-compat: surface URS dual-approval + BC approval in the legacy fields.
    const ursEval = subEvals.find((s) => s.key === "urs");
    if (ursEval) result.ursDualApprovalMissing = ursEval.approvalsMissing;
    const bcEval = subEvals.find((s) => s.key === "business_case");
    result.bcApprovalMissing = bcEval ? !bcEval.satisfied : undefined;
  } else {
    // Generic (non-sub-gated) stage.
    if (gate.blockingChecklistIds.length > 0) {
      result.uncheckedChecklist = gate.blockingChecklistIds.filter((id) => !checklistState[id]);
    }
    if (gate.requiredDocNames.length > 0) {
      const docs = await db.select().from(documentsTable)
        .where(and(eq(documentsTable.projectId, projectId), eq(documentsTable.stage, stage)));
      const uploaded = docs.map((d) => d.name);
      result.missingDocs = gate.requiredDocNames.filter((n) => !uploaded.includes(n));
    }
  }

  // UAT critical-defect gate (uat only).
  if (stage === "uat") {
    const defects = await db.select().from(issuesTable).where(and(
      eq(issuesTable.projectId, projectId),
      eq(issuesTable.dependencyType, "uat_defect"),
      ne(issuesTable.status, "resolved"),
    ));
    result.openUatDefects = defects.length;
  }

  // Pending approvals for this stage (via the project's charter). Informational.
  const [project] = await db.select({ charterId: projectsTable.charterId })
    .from(projectsTable).where(eq(projectsTable.id, projectId));
  if (project?.charterId) {
    const appr = await db.select().from(approvalsTable).where(and(
      eq(approvalsTable.charterId, project.charterId),
      eq(approvalsTable.stage, stage),
      eq(approvalsTable.status, "pending"),
    ));
    const now = Date.now();
    result.pendingApprovals = appr.map((a) => ({
      id: a.id,
      approverId: a.approverId,
      approverRole: a.approverRole,
      dueAt: a.dueAt,
      breached: a.dueAt ? new Date(a.dueAt).getTime() < now : false,
    }));
  }

  result.satisfied =
    result.prerequisitesMissing.length === 0 &&
    result.uncheckedChecklist.length === 0 &&
    result.missingDocs.length === 0 &&
    result.openUatDefects === 0 &&
    result.ursDualApprovalMissing.length === 0 &&
    // For sub-gated stages, every sub-gate (incl. the BC approval, which is not a
    // checklist item) must be satisfied.
    (result.subGates ? result.subGates.every((s) => s.satisfied) : true);

  return result;
}
