import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Admin-editable, GLOBAL tiered escalation ladder per lifecycle stage. Each row is
// one rung: "after `afterDays` days pending in `stage` (optionally a sub-gate), do
// `action` (remind|escalate) to `targetRole`". Multiple rows per stage form the ladder
// (ordered by tier). `afterDays` is measured from stage entry (now - enteredAt), so a
// row with afterDays=3 fires once the stage has been pending >3 days. `targetRole` is
// resolved to a person/email at fire time via lib/role-resolver.ts (directory + charter).
// Coexists with the per-project pmo_escalation_rules engine — this is the org default.
export const stageEscalationPolicyTable = pgTable("pmo_stage_escalation_policy", {
  id: serial("id").primaryKey(),
  stage: text("stage").notNull(),
  subGateKey: text("sub_gate_key"),
  tier: integer("tier").notNull().default(1),
  afterDays: integer("after_days").notNull().default(0),
  action: text("action").notNull().default("remind"), // 'remind' | 'escalate'
  targetRole: text("target_role").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertStageEscalationPolicySchema = createInsertSchema(stageEscalationPolicyTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertStageEscalationPolicy = z.infer<typeof insertStageEscalationPolicySchema>;
export type StageEscalationPolicy = typeof stageEscalationPolicyTable.$inferSelect;
