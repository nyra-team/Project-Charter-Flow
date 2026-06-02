// ---------------------------------------------------------------------------
// Lifecycle stages — Option B (Moderate) simplification: 9 stages across 4
// phases. Each merged stage carries the UNION of its constituents' required
// docs, checklist items, advance roles and stageSpecific flags, so every
// governance control (URS dual-approval, the Charter approval chain, the NFA
// multi-level chain, legal-before-PO ordering, the UAT critical-defect gate
// and chairman closure sign-off) is preserved — it just lives inside fewer
// stage boundaries. See lifecycle-phases.ts for the 4 phase groupings and
// scripts/src/migrate-lifecycle-option-b.ts for the old→new key remap.
//
// Merge map (old → new):
//   project_case + urs                  → initiation
//   rfp + vendor_evaluation             → vendor_selection
//   charter + nfa                       → investment_authorization
//   legal + pr_po                       → contract_po
//   kickoff + technical_design          → design
//   development + implementation_plan   → build
//   uat                                 → uat            (unchanged)
//   go_live                             → go_live        (unchanged)
//   closure_readiness + project_closure → closure
// ---------------------------------------------------------------------------
export const LIFECYCLE_STAGES = [
  {
    key: "initiation",
    label: "Initiation",
    shortLabel: "INIT",
    description: "Business Case and Requirements — dual-approval by Business Owner and IT Team",
    color: "#6366F1",
    requiredDocs: [
      // Business Case documents are optional uploads — the in-app Business
      // Case form is the source of truth. The Requirements documents below
      // are the gated artifacts that drive sign-off.
      { id: "pc_form", name: "Business Case Form", description: "Completed business case form with business justification", acceptedTypes: ["PDF", "DOCX"], maxSizeMB: 25, optional: true },
      { id: "business_case", name: "Business Case Document", description: "Detailed business case with ROI analysis", acceptedTypes: ["PDF", "DOCX", "XLSX"], maxSizeMB: 25, optional: true },
      { id: "urs_doc", name: "Requirements Document", description: "Full requirements specification", acceptedTypes: ["PDF", "DOCX"], maxSizeMB: 25 },
      { id: "urs_review", name: "Requirements Review Sign-off", description: "Signed review sheet from Business & IT", acceptedTypes: ["PDF"], maxSizeMB: 10 },
    ],
    checklistItems: [
      // — Business Case —
      { id: "biz_just", label: "Business justification documented (≥100 chars)", blocking: true },
      { id: "scope_done", label: "Scope summary completed (≥50 chars)", blocking: true },
      { id: "outcomes", label: "Expected outcomes defined", blocking: true },
      { id: "sponsor", label: "Project sponsor assigned", blocking: false },
      { id: "budget_est", label: "Preliminary budget estimated (CapEx/OpEx split)", blocking: true },
      // — Requirements (dual-approval gate) —
      { id: "biz_req", label: "Business requirements fully documented", blocking: true },
      { id: "it_review", label: "IT Team review completed", blocking: true },
      { id: "biz_owner_approved", label: "Business Owner approval received", blocking: true },
      { id: "it_approved", label: "IT Team approval received", blocking: true },
      { id: "version_ctrl", label: "Requirements version control applied", blocking: false },
    ],
    prerequisites: [] as string[],
    advanceRoles: ["initiator", "pmo", "hod"],
    advanceLabel: "Approve Initiation & Advance to Vendor Selection",
    stageSpecific: { hasDemandInitiation: true, hasURSDualApproval: true },
  },
  {
    key: "vendor_selection",
    label: "Vendor Selection",
    shortLabel: "VS",
    description: "RFP issuance plus functional & technical evaluation of vendor proposals, commercial negotiation and Finance approval",
    color: "#10B981",
    requiredDocs: [
      // — RFP —
      { id: "rfp_doc", name: "RFP Document", description: "Detailed RFP with technical and commercial requirements", acceptedTypes: ["PDF", "DOCX"], maxSizeMB: 25 },
      { id: "vendor_list", name: "Vendor Shortlist", description: "List of invited vendors with justification", acceptedTypes: ["PDF", "DOCX", "XLSX"], maxSizeMB: 10 },
      // — Vendor Evaluation —
      { id: "func_scorecard", name: "Functional Scorecard", description: "Completed functional evaluation scorecard", acceptedTypes: ["PDF", "XLSX"], maxSizeMB: 25 },
      { id: "tech_eval", name: "Technical Evaluation Report", description: "Technical assessment of each vendor", acceptedTypes: ["PDF", "DOCX"], maxSizeMB: 25 },
      { id: "commercial_proposals", name: "Commercial Proposals", description: "Received commercial proposals from shortlisted vendors", acceptedTypes: ["PDF", "XLSX"], maxSizeMB: 25 },
      { id: "negotiation_log", name: "Negotiation Log", description: "Record of all commercial negotiations", acceptedTypes: ["PDF", "DOCX", "XLSX"], maxSizeMB: 10 },
      { id: "final_commercials", name: "Finalized Commercials", description: "SCM-uploaded finalized commercial terms", acceptedTypes: ["PDF"], maxSizeMB: 25 },
    ],
    checklistItems: [
      // — RFP — (RFP issued + responses evaluated kept as distinct attributable steps for tender-fairness audit)
      { id: "urs_approved_gate", label: "Initiation stage approved ✓", blocking: true },
      { id: "rfp_created", label: "RFP document created or uploaded", blocking: true },
      { id: "urs_populated", label: "RFP header auto-populated from Requirements", blocking: false },
      { id: "vendor_invited", label: "Vendor list defined and notified", blocking: true },
      { id: "deadline_set", label: "Proposal submission deadline set", blocking: true },
      // — Vendor Evaluation —
      { id: "proposals_received", label: "All vendor proposals received", blocking: true },
      { id: "func_eval_done", label: "Functional evaluation scorecard completed", blocking: true },
      { id: "tech_eval_done", label: "Technical evaluation completed", blocking: true },
      { id: "demo_conducted", label: "Vendor demos/presentations conducted", blocking: false },
      { id: "eval_summary", label: "Evaluation summary report compiled", blocking: true },
      { id: "proposals_analysed", label: "Commercial proposals analysed", blocking: true },
      { id: "negotiation_complete", label: "Negotiation log completed", blocking: true },
      { id: "scm_uploaded", label: "SCM uploaded finalized commercials", blocking: true },
      { id: "finance_reviewed", label: "Finance review completed", blocking: true },
      { id: "vendor_selected", label: "Preferred vendor selected", blocking: true },
    ],
    prerequisites: ["initiation"],
    advanceRoles: ["scm", "pmo", "finance", "hod"],
    advanceLabel: "Complete Vendor Selection & Advance to Investment Authorization",
    stageSpecific: { hasRFPTemplate: true, hasVendorEvalScorecard: true },
  },
  {
    key: "investment_authorization",
    label: "Investment Authorization",
    shortLabel: "IA",
    description: "Combined Project Charter and NFA financial authorization — PMO + Dept Head charter sign-off and Finance → PMO → Dept Head → Management NFA chain",
    color: "#EF4444",
    requiredDocs: [
      // — Charter —
      { id: "charter_doc", name: "Project Charter", description: "Fully completed project charter document", acceptedTypes: ["PDF", "DOCX"], maxSizeMB: 25 },
      { id: "charter_template", name: "Charter Template", description: "Completed charter template with all mandatory sections", acceptedTypes: ["PDF", "DOCX"], maxSizeMB: 25 },
      // — NFA —
      { id: "nfa_form", name: "NFA Form", description: "Completed NFA form with budget justification", acceptedTypes: ["PDF", "DOCX"], maxSizeMB: 25 },
      { id: "budget_breakdown", name: "Budget Breakdown", description: "Detailed CapEx/OpEx budget breakdown", acceptedTypes: ["PDF", "XLSX"], maxSizeMB: 25 },
    ],
    checklistItems: [
      // — Charter —
      { id: "charter_drafted", label: "Charter document drafted and uploaded", blocking: true },
      { id: "pmo_review", label: "PMO review completed", blocking: true },
      { id: "dept_head_approved", label: "Department Head charter approval received", blocking: true },
      { id: "budget_confirmed", label: "Project budget confirmed", blocking: true },
      { id: "timeline_approved", label: "Project timeline approved", blocking: false },
      // — NFA (multi-level financial chain) —
      { id: "nfa_form_submitted", label: "NFA form submitted", blocking: true },
      { id: "finance_head_approved", label: "Finance Head approval received", blocking: true },
      { id: "pmo_nfa_approved", label: "PMO NFA approval received", blocking: true },
      { id: "dept_head_nfa", label: "Department Head NFA approval received", blocking: true },
      { id: "mgmt_approved", label: "Management / CFO approval received", blocking: true },
    ],
    prerequisites: ["vendor_selection"],
    advanceRoles: ["pmo", "hod", "cfo", "chairman"],
    advanceLabel: "Authorize Investment & Advance to Contract & PO",
    stageSpecific: { hasCharter: true, hasNFA: true },
  },
  {
    key: "contract_po",
    label: "Contract & PO",
    shortLabel: "CPO",
    description: "Vendor contract review, NDA, statutory compliance and Legal sign-off, then Purchase Requisition and Purchase Order release",
    color: "#7C3AED",
    requiredDocs: [
      // — Legal —
      { id: "vendor_contract_legal", name: "Vendor Contract", description: "Final vendor contract for legal review and signature", acceptedTypes: ["PDF", "DOCX"], maxSizeMB: 25 },
      { id: "legal_note", name: "Legal Review Note", description: "Signed legal review note / opinion", acceptedTypes: ["PDF", "DOCX"], maxSizeMB: 10 },
      // — PR/PO — (PO's duplicate "Vendor Contract" doc folded into the legal one above)
      { id: "pr_form", name: "PR Form", description: "Purchase Requisition form", acceptedTypes: ["PDF", "DOCX"], maxSizeMB: 25 },
      { id: "po_document", name: "PO Document", description: "Purchase Order document from approved vendor", acceptedTypes: ["PDF"], maxSizeMB: 25 },
    ],
    checklistItems: [
      // — Legal — (must complete before PO release; PRPOSection enforces the ordering internally)
      { id: "contract_uploaded", label: "Vendor contract uploaded for review", blocking: true },
      { id: "legal_reviewed", label: "Legal team review completed", blocking: true },
      { id: "compliance_confirmed", label: "Statutory / regulatory compliance confirmed", blocking: true },
      { id: "nda_signed", label: "NDA signed (if applicable)", blocking: false },
      { id: "legal_signoff", label: "Legal sign-off received", blocking: true },
      // — PR/PO —
      { id: "pr_submitted", label: "PR form submitted", blocking: true },
      { id: "po_released", label: "PO document uploaded and released", blocking: true },
      { id: "sap_order", label: "SAP internal order number confirmed", blocking: false },
    ],
    prerequisites: ["investment_authorization"],
    advanceRoles: ["legal", "pmo", "finance", "scm"],
    advanceLabel: "Release PO & Advance to Design",
    stageSpecific: { hasLegal: true, hasPRPO: true },
  },
  {
    key: "design",
    label: "Design",
    shortLabel: "DSN",
    description: "Project kickoff and activation, then Technical Design sign-off — solution architecture, integration design and security review",
    color: "#0EA5E9",
    requiredDocs: [
      // — Kickoff —
      { id: "kickoff_minutes", name: "Meeting Minutes", description: "Kickoff meeting minutes and attendee list", acceptedTypes: ["PDF", "DOCX"], maxSizeMB: 10 },
      { id: "kickoff_deck", name: "Kickoff Presentation", description: "Project kickoff presentation deck", acceptedTypes: ["PDF", "PPTX"], maxSizeMB: 25 },
      // — Technical Design —
      { id: "td_doc", name: "Technical Design Document", description: "Full TDD including architecture, data model, integrations and NFRs", acceptedTypes: ["PDF", "DOCX"], maxSizeMB: 25 },
      { id: "arch_diagram", name: "Architecture Diagram", description: "Solution architecture / context diagram", acceptedTypes: ["PDF", "DOCX", "PPTX"], maxSizeMB: 25 },
      { id: "security_review", name: "Security Review", description: "Signed security / privacy review", acceptedTypes: ["PDF", "DOCX"], maxSizeMB: 10 },
    ],
    checklistItems: [
      // — Kickoff —
      { id: "kickoff_date_set", label: "Kickoff date confirmed", blocking: true },
      { id: "attendees_defined", label: "Attendees list finalized", blocking: true },
      { id: "kickoff_held", label: "Kickoff meeting conducted", blocking: true },
      { id: "minutes_uploaded", label: "Meeting minutes uploaded", blocking: true },
      { id: "project_activated", label: "Project status set to In Progress", blocking: true },
      // — Technical Design (HOD design-quality gate) —
      { id: "td_drafted", label: "Technical Design Document uploaded", blocking: true },
      { id: "arch_uploaded", label: "Architecture diagram included", blocking: true },
      { id: "integrations_listed", label: "All integration points documented", blocking: true },
      { id: "nfrs_captured", label: "NFRs (performance, scalability, availability) captured", blocking: false },
      { id: "security_signed", label: "Security/Infosec review signed off", blocking: true },
      { id: "td_lead_approved", label: "Tech Lead / Architect approved", blocking: true },
    ],
    prerequisites: ["contract_po"],
    advanceRoles: ["pm", "pmo", "hod"],
    advanceLabel: "Approve Design — Start Build",
    stageSpecific: { hasKickoffAttendees: true, hasTechnicalDesign: true },
  },
  {
    key: "build",
    label: "Build & Implementation",
    shortLabel: "BLD",
    description: "Active development and configuration, with implementation planning — milestones, dependencies, cutover and stakeholder sign-off",
    color: "#6366F1",
    requiredDocs: [
      // — Development —
      { id: "build_specs", name: "Build Specifications", description: "Detailed build and configuration specifications", acceptedTypes: ["PDF", "DOCX"], maxSizeMB: 25 },
      { id: "dev_status", name: "Development Status Report", description: "Progress update report", acceptedTypes: ["PDF", "DOCX", "XLSX"], maxSizeMB: 10 },
      // — Implementation Plan —
      { id: "impl_plan", name: "Implementation Plan", description: "Detailed implementation plan document", acceptedTypes: ["PDF", "DOCX", "XLSX"], maxSizeMB: 25 },
      { id: "cutover_plan", name: "Cutover Plan", description: "System cutover and rollback plan", acceptedTypes: ["PDF", "DOCX"], maxSizeMB: 25 },
    ],
    checklistItems: [
      // — Development —
      { id: "dev_env_ready", label: "Development environment set up", blocking: true },
      { id: "build_specs_uploaded", label: "Build specifications uploaded", blocking: false },
      { id: "dev_progress_50", label: "Development at least 50% complete", blocking: false },
      { id: "status_updated", label: "Status notes and % complete updated", blocking: true },
      { id: "blockers_resolved", label: "All blockers resolved or escalated", blocking: false },
      // — Implementation Plan —
      { id: "impl_plan_uploaded", label: "Implementation plan uploaded", blocking: true },
      { id: "milestones_defined", label: "All milestones defined in system", blocking: true },
      { id: "dependencies_mapped", label: "Task dependencies mapped", blocking: false },
      { id: "stakeholder_signoff", label: "Stakeholder sign-off on plan", blocking: true },
      { id: "cutover_plan_approved", label: "Cutover plan reviewed and approved", blocking: true },
    ],
    prerequisites: ["design"],
    advanceRoles: ["pm", "pmo"],
    advanceLabel: "Build Complete — Advance to UAT",
    stageSpecific: { hasDevelopment: true, hasImplementationPlan: true },
  },
  {
    key: "uat",
    label: "UAT Sign-off",
    shortLabel: "UAT",
    description: "User Acceptance Testing — 100% critical defect closure required before Go Live",
    color: "#F59E0B",
    requiredDocs: [
      { id: "uat_plan", name: "UAT Test Plan", description: "Comprehensive UAT test plan and cases", acceptedTypes: ["PDF", "DOCX", "XLSX"], maxSizeMB: 25 },
      { id: "uat_signoff", name: "UAT Sign-off Document", description: "Signed UAT completion sign-off", acceptedTypes: ["PDF"], maxSizeMB: 10 },
      { id: "defect_log", name: "Defect Log", description: "Full defect log with closure status", acceptedTypes: ["PDF", "XLSX"], maxSizeMB: 25 },
    ],
    checklistItems: [
      { id: "uat_plan_approved", label: "UAT test plan approved", blocking: true },
      { id: "test_cases_executed", label: "All test cases executed", blocking: true },
      { id: "critical_defects_closed", label: "100% of critical defects closed", blocking: true },
      { id: "high_defects_80", label: "≥80% of high defects closed", blocking: false },
      { id: "uat_signed", label: "UAT sign-off document obtained", blocking: true },
    ],
    prerequisites: ["build"],
    advanceRoles: ["pm", "hod"],
    advanceLabel: "UAT Approved — Advance to Go Live",
    stageSpecific: { hasUATDefects: true },
  },
  {
    key: "go_live",
    label: "Go Live",
    shortLabel: "GO",
    description: "System go-live, stakeholder notifications and post-launch monitoring",
    color: "#10B981",
    requiredDocs: [
      { id: "go_live_checklist", name: "Go Live Checklist", description: "Completed pre-go-live checklist", acceptedTypes: ["PDF", "DOCX"], maxSizeMB: 10 },
      { id: "training_materials", name: "Training Materials", description: "End-user training materials (video up to 500MB)", acceptedTypes: ["PDF", "DOCX", "MP4", "MOV"], maxSizeMB: 500 },
      { id: "comms_plan", name: "Communications Plan", description: "Stakeholder notification and communication plan", acceptedTypes: ["PDF", "DOCX"], maxSizeMB: 10 },
    ],
    checklistItems: [
      { id: "uat_approved_gate", label: "UAT stage approved ✓", blocking: true },
      { id: "go_live_date_frozen", label: "Go Live date frozen by Project Lead", blocking: true },
      { id: "training_uploaded", label: "Training materials uploaded", blocking: true },
      { id: "stakeholders_notified", label: "Stakeholders notified of Go Live date", blocking: true },
      { id: "hypercare_plan", label: "Hypercare / support plan in place", blocking: false },
    ],
    prerequisites: ["uat"],
    advanceRoles: ["pm", "pmo"],
    advanceLabel: "Go Live Complete — Advance to Closure",
    stageSpecific: { hasGoLiveCountdown: true },
  },
  {
    key: "closure",
    label: "Closure",
    shortLabel: "CLS",
    description: "Closure readiness — CSAT, documentation handover, support transition — and final closure with Lessons Learned, Closure Report and archival",
    color: "#1E293B",
    requiredDocs: [
      // — Closure Readiness —
      { id: "csat_results", name: "CSAT Survey Results", description: "Customer satisfaction survey results", acceptedTypes: ["PDF", "XLSX"], maxSizeMB: 10 },
      { id: "doc_handover", name: "Documentation Handover Package", description: "All project documentation for operations handover", acceptedTypes: ["PDF", "DOCX"], maxSizeMB: 25 },
      { id: "deliverable_signoffs", name: "Deliverable Sign-offs", description: "Signed acceptance for each deliverable", acceptedTypes: ["PDF"], maxSizeMB: 25 },
      // — Project Closure —
      { id: "lessons_learned", name: "Lessons Learned Report", description: "Structured lessons learned document", acceptedTypes: ["PDF", "DOCX"], maxSizeMB: 25 },
      { id: "closure_report", name: "Closure Report", description: "Auto-generated project closure report", acceptedTypes: ["PDF"], maxSizeMB: 25 },
      { id: "final_financials", name: "Final Financial Report", description: "Actual vs budget summary", acceptedTypes: ["PDF", "XLSX"], maxSizeMB: 25 },
    ],
    checklistItems: [
      // — Closure Readiness —
      { id: "csat_complete", label: "CSAT survey distributed and completed", blocking: true },
      { id: "doc_handover_done", label: "Documentation handover package uploaded", blocking: true },
      { id: "all_deliverables_signed", label: "All deliverables signed off by stakeholders", blocking: true },
      { id: "support_transitioned", label: "Support transitioned to operations team", blocking: true },
      { id: "outstanding_issues_resolved", label: "All outstanding issues resolved or closed", blocking: false },
      // — Project Closure (chairman sign-off) —
      { id: "lessons_learned_done", label: "Lessons Learned structured form completed", blocking: true },
      { id: "closure_report_generated", label: "Closure Report generated", blocking: true },
      { id: "final_financials_uploaded", label: "Final financial report submitted", blocking: true },
      { id: "stakeholder_closed", label: "Project closure acknowledged by sponsor", blocking: true },
    ],
    prerequisites: ["go_live"],
    advanceRoles: ["pm", "pmo", "chairman"],
    advanceLabel: "Close Project & Archive",
    stageSpecific: { hasClosureReadinessSection: true, isClosureStage: true },
  },
] as const;

export type LifecycleStageKey = typeof LIFECYCLE_STAGES[number]["key"];

export function getStageConfig(key: string) {
  return LIFECYCLE_STAGES.find(s => s.key === key) ?? null;
}

// ── Conditional paths (mirrors api-server/src/lib/stage-gates.ts) ──────────────
// 'vendor' runs all 9 stages; 'internal' skips the two procurement stages.
export const INTERNAL_SKIPPED_STAGES = ["vendor_selection", "contract_po"];

export function applicableStageKeys(projectType?: string | null): string[] {
  const all = LIFECYCLE_STAGES.map(s => s.key as string);
  return projectType === "internal" ? all.filter(k => !INTERNAL_SKIPPED_STAGES.includes(k)) : all;
}

/** Human label for a blocking-checklist id (searches every stage's checklist). */
export function getChecklistLabel(id: string): string {
  for (const s of LIFECYCLE_STAGES) {
    const items = (s as { checklist?: ReadonlyArray<{ id: string; label: string }> }).checklist ?? [];
    const hit = items.find(i => i.id === id);
    if (hit) return hit.label;
  }
  return id;
}

export function getStageIndex(key: string): number {
  return LIFECYCLE_STAGES.findIndex(s => s.key === key);
}

export function isStageComplete(stageKey: string, stageRecords: Array<{ stage: string; status: string }>) {
  return stageRecords.some(r => r.stage === stageKey && r.status === "complete");
}

export function isStageActive(stageKey: string, stageRecords: Array<{ stage: string; status: string }>) {
  return stageRecords.some(r => r.stage === stageKey && r.status === "in_progress");
}

export function getCurrentStageKey(projectStage: string | null | undefined, stageRecords: Array<{ stage: string; status: string }>): string {
  const activeRecord = stageRecords.find(r => r.status === "in_progress");
  if (activeRecord) return activeRecord.stage;
  return projectStage ?? "initiation";
}

export const STRATEGIC_THEMES = [
  "Digital Transformation",
  "Operational Excellence",
  "Customer Experience",
  "Revenue Growth",
  "Cost Reduction",
  "Compliance & Risk",
  "Sustainability",
  "Innovation",
  "Infrastructure",
  "Talent & Culture",
] as const;

// Phase grouping lives in `./lifecycle-phases.ts` (single source of truth).

export const FUNCTIONS_LIST = [
  "Finance",
  "Human Resources",
  "Information Technology",
  "Operations",
  "Sales & Marketing",
  "Supply Chain",
  "Legal & Compliance",
  "Engineering",
  "Customer Service",
  "Strategy",
] as const;
