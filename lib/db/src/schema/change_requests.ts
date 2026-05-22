import { pgTable, text, serial, timestamp, integer, numeric, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Change Request (CR) object — formal scope/budget/schedule change with
 * impact assessment, approval workflow and baseline-lock awareness.
 * A CR is REQUIRED to alter any baselined value (locked at Charter / NFA stage).
 */
export const changeRequestsTable = pgTable("change_requests", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  crNumber: text("cr_number").notNull(), // CR-PRJ123-001 etc, generated on create
  title: text("title").notNull(),
  description: text("description").notNull(),
  rationale: text("rationale").notNull(),
  changeType: text("change_type").notNull().default("scope"), // scope | schedule | budget | resource | technical | mixed
  // Impact assessment
  scheduleImpactDays: integer("schedule_impact_days").notNull().default(0),
  budgetImpact: numeric("budget_impact", { precision: 15, scale: 2 }).notNull().default("0"),
  scopeImpactSummary: text("scope_impact_summary").default(""),
  riskImpactSummary: text("risk_impact_summary").default(""),
  // Workflow
  status: text("status").notNull().default("draft"), // draft | submitted | under_review | approved | rejected | implemented | withdrawn
  priority: text("priority").notNull().default("medium"), // low | medium | high | critical
  raisedById: integer("raised_by_id").notNull(),
  reviewedById: integer("reviewed_by_id"),
  decidedById: integer("decided_by_id"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decisionNotes: text("decision_notes").default(""),
  // Baseline diff — what the CR alters
  baselineSnapshot: jsonb("baseline_snapshot").default({}), // { budget, schedule, scope }
  proposedSnapshot: jsonb("proposed_snapshot").default({}),
  // SLA
  slaHours: integer("sla_hours").notNull().default(72),
  dueAt: timestamp("due_at", { withTimezone: true }),
  breachedAt: timestamp("breached_at", { withTimezone: true }),
  attachments: jsonb("attachments").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertChangeRequestSchema = createInsertSchema(changeRequestsTable).omit({ id: true, createdAt: true, updatedAt: true, crNumber: true });
export type InsertChangeRequest = z.infer<typeof insertChangeRequestSchema>;
export type ChangeRequest = typeof changeRequestsTable.$inferSelect;
