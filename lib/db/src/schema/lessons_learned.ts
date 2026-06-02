import { pgTable, text, serial, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Cross-project searchable Lessons Learned repository.
 * Each project can contribute multiple entries; entries are searchable
 * across the whole organisation by tag, category, and (via AI) by free-text query.
 */
export const lessonsLearnedTable = pgTable("pmo_lessons_learned", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull().default("general"), // schedule | budget | vendor | scope | stakeholder | technical | quality | general
  whatWorked: text("what_worked").default(""),
  whatDidnt: text("what_didnt").default(""),
  recommendation: text("recommendation").default(""),
  tags: jsonb("tags").notNull().default([]),
  capturedById: integer("captured_by_id"),
  stage: text("stage").default(""), // lifecycle stage where it was learned
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertLessonLearnedSchema = createInsertSchema(lessonsLearnedTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertLessonLearned = z.infer<typeof insertLessonLearnedSchema>;
export type LessonLearned = typeof lessonsLearnedTable.$inferSelect;
