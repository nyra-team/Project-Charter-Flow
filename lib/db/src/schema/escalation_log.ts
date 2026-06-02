import { pgTable, text, serial, timestamp, integer, jsonb } from "drizzle-orm/pg-core";

// Append-only record of every escalation/reminder fired — by the automated ladder
// (jobs/stage-escalation-ladder.ts) AND by manual Remind/Escalate (critical-path-actions.ts).
// Two jobs: (1) dedup — the ladder skips a (project, stage, sub-gate, tier) already logged
// today so the same rung doesn't fire every hour; (2) history — feeds the "Approval SLA
// Performance" dashboard (who was chased, how often, did it clear).
export const escalationLogTable = pgTable("pmo_escalation_log", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  stage: text("stage").notNull(),
  subGateKey: text("sub_gate_key"),
  tier: integer("tier").notNull().default(0), // 0 = manual action (no policy tier)
  action: text("action").notNull(), // 'remind' | 'escalate'
  targetRole: text("target_role").notNull().default(""),
  recipientIds: jsonb("recipient_ids").notNull().default([]),
  emailed: integer("emailed").notNull().default(0),
  source: text("source").notNull().default("ladder"), // 'ladder' | 'manual'
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
});

export type EscalationLog = typeof escalationLogTable.$inferSelect;
