import { pgTable, text, serial, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const timelogsTable = pgTable("timelogs", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull(),
  userId: integer("user_id"),
  date: text("date").notNull(),
  hours: numeric("hours", { precision: 6, scale: 2 }).notNull(),
  note: text("note").default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTimelogSchema = createInsertSchema(timelogsTable).omit({ id: true, createdAt: true });
export type InsertTimelog = z.infer<typeof insertTimelogSchema>;
export type Timelog = typeof timelogsTable.$inferSelect;
