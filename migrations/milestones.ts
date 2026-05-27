import { pgTable, text, serial, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const milestonesTable = pgTable("milestones", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  workstreamId: integer("workstream_id"),
  name: text("name").notNull(),
  description: text("description").default(""),
  dueDate: text("due_date"),
  actualStart: text("actual_start"),
  actualEnd: text("actual_end"),
  status: text("status").notNull().default("not_started"),
  priority: text("priority").notNull().default("P2"),
  rag: text("rag").notNull().default("green"),
  plannedEffortHours: integer("planned_effort_hours").notNull().default(0),
  scheduleVarianceDays: integer("schedule_variance_days").notNull().default(0),
  readinessChecklist: jsonb("readiness_checklist").notNull().default([]),
  gateDecision: text("gate_decision"),
  order: integer("order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertMilestoneSchema = createInsertSchema(milestonesTable).omit({ id: true, createdAt: true });
export type InsertMilestone = z.infer<typeof insertMilestoneSchema>;
export type Milestone = typeof milestonesTable.$inferSelect;
