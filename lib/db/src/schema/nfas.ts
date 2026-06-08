import { pgTable, text, serial, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
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
  // [{ role, name, empCode?, status: 'pending'|'approved'|'rejected', comment?, decidedAt? }]
  signatories: jsonb("signatories").notNull().default([]),
  // draft | pending_approval | approved | rejected
  status: text("status").notNull().default("draft"),
  createdById: integer("created_by_id"),
  createdByName: text("created_by_name").notNull().default(""),
  createdByCode: text("created_by_code").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertNfaSchema = createInsertSchema(nfasTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertNfa = z.infer<typeof insertNfaSchema>;
export type Nfa = typeof nfasTable.$inferSelect;
