import { pgTable, text, serial, timestamp, integer, numeric, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Benefits Realization Reviews — post-implementation reviews at
 * +3, +6, +12 months after Go Live to compare actual benefit vs charter projection.
 */
export const benefitsReviewsTable = pgTable("pmo_benefits_reviews", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  reviewPeriod: text("review_period").notNull(), // "3m" | "6m" | "12m"
  scheduledDate: text("scheduled_date").notNull(),
  conductedDate: text("conducted_date"),
  status: text("status").notNull().default("scheduled"), // scheduled | in_progress | completed | overdue | cancelled
  // KPI snapshot — comparing each benefit type vs charter projection
  toplineProjected: numeric("topline_projected", { precision: 15, scale: 2 }),
  toplineActual: numeric("topline_actual", { precision: 15, scale: 2 }),
  bottomlineProjected: numeric("bottomline_projected", { precision: 15, scale: 2 }),
  bottomlineActual: numeric("bottomline_actual", { precision: 15, scale: 2 }),
  productivityProjected: text("productivity_projected").default(""),
  productivityActual: text("productivity_actual").default(""),
  complianceProjected: text("compliance_projected").default(""),
  complianceActual: text("compliance_actual").default(""),
  overallRealizationPct: numeric("overall_realization_pct", { precision: 5, scale: 2 }),
  rag: text("rag").notNull().default("amber"), // green | amber | red
  findings: text("findings").default(""),
  recommendations: text("recommendations").default(""),
  attachments: jsonb("attachments").notNull().default([]),
  conductedById: integer("conducted_by_id"),
  signedOffById: integer("signed_off_by_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertBenefitsReviewSchema = createInsertSchema(benefitsReviewsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertBenefitsReview = z.infer<typeof insertBenefitsReviewSchema>;
export type BenefitsReview = typeof benefitsReviewsTable.$inferSelect;
