import { pgTable, text, serial, timestamp, integer, jsonb, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Baseline snapshot — captured at gate approval (Charter, NFA, Implementation Plan, etc.)
 * Once `locked = true`, baselined fields (budget, schedule, scope) can only change
 * via an approved Change Request.
 */
export const baselinesTable = pgTable("pmo_baselines", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  baselineType: text("baseline_type").notNull(), // budget | schedule | scope | full
  stage: text("stage").notNull(), // lifecycle stage at which it was taken
  version: integer("version").notNull().default(1),
  snapshot: jsonb("snapshot").notNull().default({}), // captured values
  locked: boolean("locked").notNull().default(true),
  capturedById: integer("captured_by_id"),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  notes: text("notes").default(""),
});

export const insertBaselineSchema = createInsertSchema(baselinesTable).omit({ id: true, capturedAt: true });
export type InsertBaseline = z.infer<typeof insertBaselineSchema>;
export type Baseline = typeof baselinesTable.$inferSelect;
