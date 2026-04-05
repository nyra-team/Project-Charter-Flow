import { pgTable, text, serial, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const chartersTable = pgTable("charters", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  scope: text("scope").notNull().default(""),
  deliverables: text("deliverables").notNull().default(""),
  solutionComparison: text("solution_comparison").default(""),
  tentativeBudget: numeric("tentative_budget", { precision: 15, scale: 2 }).notNull().default("0"),
  finalNegotiatedBudget: numeric("final_negotiated_budget", { precision: 15, scale: 2 }),
  internalOrderNumber: text("internal_order_number"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  durationDays: integer("duration_days"),
  status: text("status").notNull().default("draft"),
  submittedById: integer("submitted_by_id").notNull(),
  projectSponsorId: integer("project_sponsor_id"),
  projectOwnerId: integer("project_owner_id"),
  projectManagerId: integer("project_manager_id"),
  projectId: integer("project_id"),
  // Business Benefits
  toplineImprovement: text("topline_improvement").default(""),
  bottomLineOptimization: text("bottom_line_optimization").default(""),
  complianceBenefits: text("compliance_benefits").default(""),
  productivityImprovement: text("productivity_improvement").default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertCharterSchema = createInsertSchema(chartersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCharter = z.infer<typeof insertCharterSchema>;
export type Charter = typeof chartersTable.$inferSelect;
