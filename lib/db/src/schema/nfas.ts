import { pgTable, text, serial, timestamp, integer, jsonb, numeric, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * pmo_nfas — Granules "Internal Approval Note" (Note For Approval).
 *
 * Standalone OR linked to a PMO project (projectId). Captures the structured
 * note (subject, background, requirement line-items, costing, recommendation)
 * plus the signatory approval grid. The .docx is generated on demand from
 * these fields (scripts/generate_nfa.py).
 */
export const nfasTable = pgTable("pmo_nfas", {
  id: serial("id").primaryKey(),
  noteNo: text("note_no").notNull(),
  // Optional link to a project (per-project NFA); null = standalone note.
  projectId: integer("project_id"),
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

  // === Corporate e-NFA template fields (single-page e-NFA form parity) ===
  functionDept: text("function_dept").notNull().default(""),
  requirements: text("requirements").notNull().default(""),          // Procurement details
  justification: text("justification").notNull().default(""),
  vendorDetails: text("vendor_details").notNull().default(""),
  modeOfProcurement: text("mode_of_procurement").notNull().default(""),
  financialImplication: text("financial_implication").notNull().default(""),
  financialAmount: numeric("financial_amount", { precision: 15, scale: 2 }),
  // DOA-derived: does this note need the CMD/Chairman signature?
  cmdRequired: boolean("cmd_required").notNull().default(false),

  // [{ role, name, empCode?, status: 'pending'|'approved'|'rejected', comment?, decidedAt? }]
  // Approval workflow: Requestor → Functional Head → CFO → ED → (CMD if DOA requires)
  signatories: jsonb("signatories").notNull().default([]),
  // User-defined extra fields added on the e-NFA form (step 2). Array of
  // { id, label, value }, ordered as the author arranged them (drag-and-drop).
  customFields: jsonb("custom_fields").notNull().default([]),
  // draft | pending_approval | approved | rejected
  status: text("status").notNull().default("draft"),
  // Documenso e-sign envelope: { provider, documentId, sentAt, recipients: [{ email, role, signingOrder }] }
  esign: jsonb("esign"),
  createdById: integer("created_by_id"),
  createdByName: text("created_by_name").notNull().default(""),
  createdByCode: text("created_by_code").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertNfaSchema = createInsertSchema(nfasTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertNfa = z.infer<typeof insertNfaSchema>;
export type Nfa = typeof nfasTable.$inferSelect;
