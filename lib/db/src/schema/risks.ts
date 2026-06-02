import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const risksTable = pgTable("pmo_risks", {
  id: serial("id").primaryKey(),
  charterId: integer("charter_id").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  impact: text("impact").notNull().default("medium"),
  likelihood: text("likelihood").notNull().default("medium"),
  mitigation: text("mitigation").default(""),
  // Extended fields
  priority: text("priority").notNull().default("medium"),
  rag: text("rag").notNull().default("green"),
  effortDays: integer("effort_days"),
  scheduleImpact: text("schedule_impact").default(""),
  status: text("status").notNull().default("open"),
  owner: text("owner").default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertRiskSchema = createInsertSchema(risksTable).omit({ id: true, createdAt: true });
export type InsertRisk = z.infer<typeof insertRiskSchema>;
export type Risk = typeof risksTable.$inferSelect;
