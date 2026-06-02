import { pgTable, text, serial, timestamp, integer, numeric, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Task blueprint inside a project template. Mirrors pmo_tasks but stores
// schedule data as offsets from the project's eventual start date rather than
// absolute dates — the "from-template" expander resolves them when a real
// project is spawned.
//
// predecessor_offsets holds an array of `{ templateTaskId, lagDays }` rows
// referring to other template tasks in the same template. The expander
// rewrites those refs into the new project's task IDs so the dependency
// graph survives the clone.
export const templateTasksTable = pgTable("pmo_template_tasks", {
  id: serial("id").primaryKey(),
  templateId: integer("template_id").notNull(),
  // Self-FK for hierarchical sub-tasks (mirrors pmo_tasks.parentTaskId).
  parentTaskId: integer("parent_task_id"),
  name: text("name").notNull(),
  description: text("description").default(""),
  defaultDurationDays: integer("default_duration_days").notNull().default(1),
  // Days from the template's project start (resolved at from-template time).
  defaultDayOffset: integer("default_day_offset").notNull().default(0),
  defaultPriority: text("default_priority").notNull().default("P2"),
  // Suggested assignee role (e.g. "pm", "qa_lead"); left null when freeform.
  defaultOwnerRole: text("default_owner_role"),
  defaultEffortHours: numeric("default_effort_hours", { precision: 8, scale: 2 }),
  // Array of { templateTaskId, lagDays } pointing at sibling template tasks.
  predecessorOffsets: jsonb("predecessor_offsets").notNull().default([]),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTemplateTaskSchema = createInsertSchema(templateTasksTable).omit({ id: true, createdAt: true });
export type InsertTemplateTask = z.infer<typeof insertTemplateTaskSchema>;
export type TemplateTask = typeof templateTasksTable.$inferSelect;
