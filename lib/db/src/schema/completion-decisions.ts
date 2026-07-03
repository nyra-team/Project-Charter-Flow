import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Append-only log of task/subtask completion sign-offs — one row per approver
// decision (accept/reject), so the Approvals page can show a history even after
// the pending request is cleared off the task. task_name is snapshotted so the
// log reads without a join and survives task edits/deletes.
export const completionDecisionsTable = pgTable("pmo_completion_decisions", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull(),
  projectId: integer("project_id").notNull(),
  taskName: text("task_name"),
  decision: text("decision").notNull(), // 'accepted' | 'rejected'
  approverId: integer("approver_id"),
  requesterId: integer("requester_id"),
  reason: text("reason"),
  decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCompletionDecisionSchema = createInsertSchema(completionDecisionsTable).omit({ id: true, decidedAt: true });
export type InsertCompletionDecision = z.infer<typeof insertCompletionDecisionSchema>;
export type CompletionDecision = typeof completionDecisionsTable.$inferSelect;
