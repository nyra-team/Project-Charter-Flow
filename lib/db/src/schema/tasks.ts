import { pgTable, text, serial, timestamp, integer, numeric, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tasksTable = pgTable("tasks", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  milestoneId: integer("milestone_id"),
  name: text("name").notNull(),
  description: text("description").default(""),
  assigneeId: integer("assignee_id"),
  status: text("status").notNull().default("not_started"),
  priority: text("priority").notNull().default("medium"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  estimatedHours: numeric("estimated_hours", { precision: 8, scale: 2 }),
  actualHours: numeric("actual_hours", { precision: 8, scale: 2 }),
  predecessorIds: text("predecessor_ids").notNull().default("[]"),
  isCritical: boolean("is_critical").notNull().default(false),
  order: integer("order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTaskSchema = createInsertSchema(tasksTable).omit({ id: true, createdAt: true });
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Task = typeof tasksTable.$inferSelect;
