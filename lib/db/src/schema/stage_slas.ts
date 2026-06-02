import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Admin-editable target duration per lifecycle stage. Drives "days overdue" on the
// stage-governance critical path: daysOverdue = today - (stage.enteredAt + targetDays).
// One row per stage key (unique). Seeded with sensible defaults by the migration.
export const stageSlasTable = pgTable("pmo_stage_slas", {
  id: serial("id").primaryKey(),
  stage: text("stage").notNull().unique(),
  targetDays: integer("target_days").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertStageSlaSchema = createInsertSchema(stageSlasTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertStageSla = z.infer<typeof insertStageSlaSchema>;
export type StageSla = typeof stageSlasTable.$inferSelect;
