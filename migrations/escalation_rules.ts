import { pgTable, text, serial, timestamp, integer, numeric, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const escalationRulesTable = pgTable("escalation_rules", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id"),
  triggerType: text("trigger_type").notNull(),
  thresholdValue: numeric("threshold_value", { precision: 10, scale: 2 }).notNull().default("0"),
  notifyUserIds: jsonb("notify_user_ids").notNull().default([]),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertEscalationRuleSchema = createInsertSchema(escalationRulesTable).omit({ id: true, createdAt: true });
export type InsertEscalationRule = z.infer<typeof insertEscalationRuleSchema>;
export type EscalationRule = typeof escalationRulesTable.$inferSelect;
