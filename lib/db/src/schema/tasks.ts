import { pgTable, text, serial, timestamp, integer, numeric, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tasksTable = pgTable("pmo_tasks", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  milestoneId: integer("milestone_id"),
  workstreamId: integer("workstream_id"),
  parentTaskId: integer("parent_task_id"),
  managerId: integer("manager_id"),
  name: text("name").notNull(),
  description: text("description").default(""),
  assigneeId: integer("assignee_id"),
  cftOwner: integer("cft_owner"),
  cftDept: text("cft_dept"),
  status: text("status").notNull().default("not_started"),
  priority: text("priority").notNull().default("P2"),
  rag: text("rag").notNull().default("green"),
  // Lifecycle stage this task belongs to (one of the 9 LIFECYCLE_STAGES keys).
  // Defaults from the task's milestone stage when unset; editable. Drives
  // group-by-stage / phase and the derived gate approver/SLA.
  stage: text("stage"),
  // Monday-style completion %. Leaf tasks: editable 0-100; parent tasks:
  // auto-rolled-up from children (avg of child progress).
  progressPct: integer("progress_pct").notNull().default(0),
  startDate: text("start_date"),
  endDate: text("end_date"),
  actualStart: text("actual_start"),
  actualEnd: text("actual_end"),
  estimatedHours: numeric("estimated_hours", { precision: 8, scale: 2 }),
  actualHours: numeric("actual_hours", { precision: 8, scale: 2 }),
  plannedEffortHours: numeric("planned_effort_hours", { precision: 8, scale: 2 }),
  scheduleVarianceDays: integer("schedule_variance_days").notNull().default(0),
  predecessorIds: text("predecessor_ids").notNull().default("[]"),
  crossProjectPredecessors: text("cross_project_predecessors").notNull().default("[]"),
  isCritical: boolean("is_critical").notNull().default(false),
  order: integer("order").notNull().default(0),
  // Jira sync mapping (nullable). jiraKey = linked Jira issue key (e.g.
  // "MYG-123"); jiraComponent = first Jira component (module, e.g. "OHC");
  // jiraSyncedAt = last import/export time.
  jiraKey: text("jira_key"),
  jiraComponent: text("jira_component"),
  jiraSyncedAt: timestamp("jira_synced_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTaskSchema = createInsertSchema(tasksTable).omit({ id: true, createdAt: true });
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Task = typeof tasksTable.$inferSelect;
