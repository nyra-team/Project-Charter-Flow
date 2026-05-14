import { pgTable, text, serial, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const budgetLinesTable = pgTable("budget_lines", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  category: text("category").notNull().default("OpEx"),
  description: text("description").default(""),
  baselineAmount: numeric("baseline_amount", { precision: 15, scale: 2 }).notNull().default("0"),
  forecastAmount: numeric("forecast_amount", { precision: 15, scale: 2 }).notNull().default("0"),
  actualAmount: numeric("actual_amount", { precision: 15, scale: 2 }).notNull().default("0"),
  varianceAmount: numeric("variance_amount", { precision: 15, scale: 2 }).notNull().default("0"),
  variancePct: numeric("variance_pct", { precision: 8, scale: 2 }).notNull().default("0"),
  period: text("period"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBudgetLineSchema = createInsertSchema(budgetLinesTable).omit({ id: true, createdAt: true, varianceAmount: true, variancePct: true });
export type InsertBudgetLine = z.infer<typeof insertBudgetLineSchema>;
export type BudgetLine = typeof budgetLinesTable.$inferSelect;
