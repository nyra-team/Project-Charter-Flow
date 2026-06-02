import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const projectStagesTable = pgTable("pmo_project_stages", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  stage: text("stage").notNull(),
  status: text("status").notNull().default("not_started"),
  enteredAt: timestamp("entered_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  notes: text("notes").default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertProjectStageSchema = createInsertSchema(projectStagesTable).omit({ id: true, createdAt: true });
export type InsertProjectStage = z.infer<typeof insertProjectStageSchema>;
export type ProjectStage = typeof projectStagesTable.$inferSelect;
