import { pgTable, text, serial, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const milestonesTable = pgTable("pmo_milestones", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  workstreamId: integer("workstream_id"),
  name: text("name").notNull(),
  description: text("description").default(""),
  // YYYY-MM-DD; optional planned start. When present (alongside dueDate),
  // the Gantt renders the milestone as a duration bar instead of a single-
  // day diamond. Backfilled for legacy rows by the
  // apps/pmo/scripts/add-milestone-start-date.sql migration.
  startDate: text("start_date"),
  dueDate: text("due_date"),
  dueDateHistory: text("due_date_history").notNull().default("[]"),
  actualStart: text("actual_start"),
  actualEnd: text("actual_end"),
  status: text("status").notNull().default("not_started"),
  priority: text("priority").notNull().default("P2"),
  rag: text("rag").notNull().default("green"),
  // Derived progress % (0-100). NOT user-set: recomputeRollups() (api-server
  // lib/rollup.ts) writes this as the average of the milestone's top-level
  // tasks' effective progress, which itself rolls up from subtasks. Source of
  // truth for milestone completion; `rag` above stays a separate,
  // PM-controlled governance signal that the rollup never overwrites.
  progressPct: integer("progress_pct").notNull().default(0),
  // Lifecycle stage this milestone gates (one of the 9 LIFECYCLE_STAGES keys).
  // Standard gate milestones (BC Approved, URS Approved, …) carry their stage;
  // ad-hoc milestones may leave it null. Drives group-by-stage / phase.
  stage: text("stage"),
  plannedEffortHours: integer("planned_effort_hours").notNull().default(0),
  scheduleVarianceDays: integer("schedule_variance_days").notNull().default(0),
  // Reason recorded when the due date was auto-extended because a child task's
  // end date ran past it (carried from the task's justification).
  justification: text("justification"),
  readinessChecklist: jsonb("readiness_checklist").notNull().default([]),
  gateDecision: text("gate_decision"),
  order: integer("order").notNull().default(0),
  // Finish-to-start predecessor: the milestone that must complete before this
  // one starts. Delivery milestones are auto-chained (each one's predecessor is
  // the prior milestone in `order`) so the Gantt can draw M1→M2→M3 arrows.
  // Nullable: the first milestone in a chain (and ad-hoc milestones) have none.
  predecessorId: integer("predecessor_id"),
  // Jira sync mapping (nullable). A Jira *Epic* imports into a milestone:
  // jiraKey = linked Epic issue key (e.g. "MYG-42"); jiraSyncedAt = last
  // import/sync time. Mirrors the same columns on pmo_tasks / pmo_projects
  // so re-imports are idempotent (upsert by jiraKey).
  jiraKey: text("jira_key"),
  jiraSyncedAt: timestamp("jira_synced_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertMilestoneSchema = createInsertSchema(milestonesTable).omit({ id: true, createdAt: true });
export type InsertMilestone = z.infer<typeof insertMilestoneSchema>;
export type Milestone = typeof milestonesTable.$inferSelect;
