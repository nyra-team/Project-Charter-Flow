import { pgTable, text, serial, timestamp, integer, numeric, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Project Initiation Form — pre-charter intake. Captures the business case
// at the moment someone first writes the idea down: problem, proposed
// solution, sponsor + HOD, target outcomes, success metrics, ballpark cost
// and duration, top risks. HOD signs off, after which a real project (and an
// optional charter shell) is spawned — optionally chaining into Stage 1's
// from-template flow.
//
// Lifecycle:
//   draft        → user is still editing
//   submitted    → HOD now owns the review
//   under_review → HOD opened / commented but hasn't decided
//   approved     → ready to convert; spawns project on /convert-to-project
//   rejected     → HOD said no (frozen, can be cloned / superseded)
//   converted    → a project has been spawned; `converted_project_id` set
//
// The decision audit trail lives on the row itself: decided_at + decided_by_id
// + decision_note keep things simple for a single-stage gate. If this ever
// needs multi-stage routing, lift into the generic approvals engine.
export const pifsTable = pgTable("pmo_pifs", {
  id: serial("id").primaryKey(),

  title: text("title").notNull(),
  businessProblem: text("business_problem").notNull(),
  proposedSolution: text("proposed_solution").notNull(),

  // Who's championing it / who decides.
  sponsorId: integer("sponsor_id"),
  hodId: integer("hod_id"),

  // Free-form lists serialised as JSONB arrays of plain strings.
  targetOutcomes: jsonb("target_outcomes").notNull().default([]),
  successMetrics: jsonb("success_metrics").notNull().default([]),
  dependencies: jsonb("dependencies").notNull().default([]),
  topRisks: jsonb("top_risks").notNull().default([]),

  estimatedCapex: numeric("estimated_capex", { precision: 15, scale: 2 }),
  estimatedOpex: numeric("estimated_opex", { precision: 15, scale: 2 }),
  estimatedDurationDays: integer("estimated_duration_days"),

  // Free text — kept loose because business taxonomies move faster than enums.
  classification: text("classification").notNull().default("standard"),
  urgency: text("urgency").notNull().default("normal"),

  status: text("status").notNull().default("draft"),
  // Populated when status transitions to approved/rejected.
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decidedById: integer("decided_by_id"),
  decisionNote: text("decision_note"),

  // Set when /convert-to-project runs; link to the spawned project.
  convertedProjectId: integer("converted_project_id"),
  convertedAt: timestamp("converted_at", { withTimezone: true }),

  createdById: integer("created_by_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPifSchema = createInsertSchema(pifsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  decidedAt: true,
  decidedById: true,
  decisionNote: true,
  convertedProjectId: true,
  convertedAt: true,
});
export type InsertPif = z.infer<typeof insertPifSchema>;
export type Pif = typeof pifsTable.$inferSelect;
