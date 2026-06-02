import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const issuesTable = pgTable("pmo_issues", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  taskId: integer("task_id"),
  milestoneId: integer("milestone_id"),
  title: text("title").notNull(),
  description: text("description").default(""),
  dependencyType: text("dependency_type"),
  blockingOwnerId: integer("blocking_owner_id"),
  blockingDept: text("blocking_dept"),
  originalDeadline: text("original_deadline"),
  proposedRevisedDeadline: text("proposed_revised_deadline"),
  status: text("status").notNull().default("open"),
  raisedBy: integer("raised_by"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolutionNotes: text("resolution_notes").default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertIssueSchema = createInsertSchema(issuesTable).omit({ id: true, createdAt: true });
export type InsertIssue = z.infer<typeof insertIssueSchema>;
export type Issue = typeof issuesTable.$inferSelect;
