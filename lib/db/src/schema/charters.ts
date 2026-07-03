import { pgTable, text, serial, timestamp, integer, numeric, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Merged Charter + NFA. One row per consolidated approval document.
// Legacy pmo_nfas table is kept for back-compat reads; new writes flow here.
export const chartersTable = pgTable("pmo_charters", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  scope: text("scope").notNull().default(""),
  deliverables: text("deliverables").notNull().default(""),
  solutionComparison: text("solution_comparison").default(""),
  tentativeBudget: numeric("tentative_budget", { precision: 15, scale: 2 }).notNull().default("0"),
  finalNegotiatedBudget: numeric("final_negotiated_budget", { precision: 15, scale: 2 }),
  internalOrderNumber: text("internal_order_number"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  durationDays: integer("duration_days"),
  status: text("status").notNull().default("draft"),
  submittedById: integer("submitted_by_id").notNull(),
  projectSponsorId: integer("project_sponsor_id"),
  projectOwnerId: integer("project_owner_id"),
  projectManagerId: integer("project_manager_id"),
  projectId: integer("project_id"),
  // Business Benefits (qualitative)
  toplineImprovement: text("topline_improvement").default(""),
  bottomLineOptimization: text("bottom_line_optimization").default(""),
  complianceBenefits: text("compliance_benefits").default(""),
  productivityImprovement: text("productivity_improvement").default(""),
  // Strategic alignment
  strategicAlignmentTags: jsonb("strategic_alignment_tags").notNull().default([]),
  scoringWeights: jsonb("scoring_weights").notNull().default({}),
  nfaThreshold: numeric("nfa_threshold", { precision: 15, scale: 2 }),

  // === Charter narrative sections (MES template parity) ===
  executiveSummary: text("executive_summary").notNull().default(""),
  currentState: text("current_state").notNull().default(""),
  businessDrivers: text("business_drivers").notNull().default(""),
  outOfScope: text("out_of_scope").notNull().default(""),
  constraints: text("constraints").notNull().default(""),
  assumptions: text("assumptions").notNull().default(""),
  potentialAdditionalBudget: text("potential_additional_budget").notNull().default(""),

  // === Project metadata ===
  category: text("category").notNull().default(""),     // Compliance | ROI | Compliance + ROI
  entity: text("entity").notNull().default(""),         // GIL | GLS | CZRO | …
  revision: integer("revision").notNull().default(1),   // Revised NFA cycle (v1, v2…)

  // === Project Charter template fields (single-page charter form parity) ===
  projectSponsor: text("project_sponsor").notNull().default(""),          // CMD | ED | …
  pmType: text("pm_type").notNull().default(""),                          // IT PM | Business PM
  pmName: text("pm_name").notNull().default(""),                          // Name of PM
  projectApprovalDate: text("project_approval_date"),                     // Date of Project Approval
  lastRevisionDate: text("last_revision_date"),                           // Optional
  businessOutcome: text("business_outcome").notNull().default(""),
  scopeLimitations: text("scope_limitations").notNull().default(""),
  risks: text("risks").notNull().default(""),
  // Flexible vendor comparison matrix: { columns: string[], rows: string[][] }
  vendorMatrix: jsonb("vendor_matrix").notNull().default({}),

  // User-defined extra fields added on the charter form (step 2). Array of
  // { id, label, value }, ordered as the author arranged them (drag-and-drop).
  customFields: jsonb("custom_fields").notNull().default([]),

  // === Investment summary (drives DOA band lookup) ===
  kind: text("kind").notNull().default("capex"),        // capex | opex | mixed
  capexAmount: numeric("capex_amount", { precision: 15, scale: 2 }).notNull().default("0"),
  opexAmount: numeric("opex_amount", { precision: 15, scale: 2 }).notNull().default("0"),
  // [{ fyLabel: "FY'25", amountInr: number }]
  fyRecurring: jsonb("fy_recurring").notNull().default([]),
  // Quantitative business case
  roiPerAnnum: numeric("roi_per_annum", { precision: 15, scale: 2 }),
  paybackMonths: integer("payback_months"),
  // Earlier vs Revised delta (the MES "₹17.98 Cr → ₹43.81 Cr" framing)
  previousNfaAmount: numeric("previous_nfa_amount", { precision: 15, scale: 2 }),
  leAmount: numeric("le_amount", { precision: 15, scale: 2 }),  // Latest Estimate

  // === Absorbed NFA fields ===
  noteNo: text("note_no").notNull().default(""),
  department: text("department").notNull().default(""),
  location: text("location").notNull().default(""),
  locationRequired: text("location_required").notNull().default(""),
  noteDate: text("note_date"),
  subject: text("subject").notNull().default(""),
  background: text("background").notNull().default(""),
  // [{ item, details }]
  requirementItems: jsonb("requirement_items").notNull().default([]),
  orderFormNote: text("order_form_note").notNull().default(""),
  totalUsd: text("total_usd").notNull().default(""),
  totalInr: text("total_inr").notNull().default(""),
  recommendation: text("recommendation").notNull().default(""),
  // [{ role, name, empCode?, status: 'pending'|'approved'|'rejected', comment?, decidedAt? }]
  // Resolved at /submit from pmo_doa_matrix; mirrored to pmo_approvals for the engine.
  signatories: jsonb("signatories").notNull().default([]),

  // === Roadmap / governance / attachments (jsonb to avoid 4 child tables) ===
  // [{ milestone, responsible, targetDate, status? }]
  milestones: jsonb("milestones").notNull().default([]),
  // [{ kpi, baseline, goal }]
  kpis: jsonb("kpis").notNull().default([]),
  // [{ role, name, empCode? }]
  steeringCommittee: jsonb("steering_committee").notNull().default([]),
  keyProjectMembers: jsonb("key_project_members").notNull().default([]),
  // [{ name, url, size?, mimeType? }]
  attachments: jsonb("attachments").notNull().default([]),
  // Documenso e-sign envelope: { provider, documentId, sentAt, recipients: [{ email, role, signingOrder }] }
  esign: jsonb("esign"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertCharterSchema = createInsertSchema(chartersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCharter = z.infer<typeof insertCharterSchema>;
export type Charter = typeof chartersTable.$inferSelect;
