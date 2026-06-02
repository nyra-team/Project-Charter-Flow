import { pgTable, text, serial, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Milestone blueprint inside a project template. Like pmo_milestones but the
// due date is stored as days-from-project-start; resolved at template-expand
// time into a concrete dueDate on the spawned project's milestones.
export const templateMilestonesTable = pgTable("pmo_template_milestones", {
  id: serial("id").primaryKey(),
  templateId: integer("template_id").notNull(),
  name: text("name").notNull(),
  description: text("description").default(""),
  // Days from project start. 0 = at kickoff, 90 = 90 days in.
  defaultDayOffset: integer("default_day_offset").notNull().default(0),
  gateDecision: text("gate_decision"),
  // Mirrors pmo_milestones.readinessChecklist shape so the clone is lossless.
  readinessChecklist: jsonb("readiness_checklist").notNull().default([]),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTemplateMilestoneSchema = createInsertSchema(templateMilestonesTable).omit({ id: true, createdAt: true });
export type InsertTemplateMilestone = z.infer<typeof insertTemplateMilestoneSchema>;
export type TemplateMilestone = typeof templateMilestonesTable.$inferSelect;
