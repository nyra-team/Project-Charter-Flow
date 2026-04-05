import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const approvalsTable = pgTable("approvals", {
  id: serial("id").primaryKey(),
  charterId: integer("charter_id").notNull(),
  approverId: integer("approver_id").notNull(),
  approverRole: text("approver_role").notNull(),
  stage: text("stage").notNull(),
  status: text("status").notNull().default("pending"),
  comments: text("comments"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertApprovalSchema = createInsertSchema(approvalsTable).omit({ id: true, createdAt: true });
export type InsertApproval = z.infer<typeof insertApprovalSchema>;
export type Approval = typeof approvalsTable.$inferSelect;
