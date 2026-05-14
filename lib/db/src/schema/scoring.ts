import { pgTable, text, serial, timestamp, integer, numeric, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const scoringCriteriaTable = pgTable("scoring_criteria", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  weightPct: numeric("weight_pct", { precision: 5, scale: 2 }).notNull().default("0"),
  description: text("description").default(""),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const projectScoresTable = pgTable("project_scores", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  criterionId: integer("criterion_id").notNull(),
  score: integer("score").notNull().default(1),
  weightedScore: numeric("weighted_score", { precision: 8, scale: 4 }).notNull().default("0"),
  notes: text("notes").default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertScoringCriteriaSchema = createInsertSchema(scoringCriteriaTable).omit({ id: true, createdAt: true });
export type InsertScoringCriteria = z.infer<typeof insertScoringCriteriaSchema>;
export type ScoringCriteria = typeof scoringCriteriaTable.$inferSelect;

export const insertProjectScoreSchema = createInsertSchema(projectScoresTable).omit({ id: true, createdAt: true, weightedScore: true });
export type InsertProjectScore = z.infer<typeof insertProjectScoreSchema>;
export type ProjectScore = typeof projectScoresTable.$inferSelect;
