import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const squadMembersTable = pgTable("pmo_squad_members", {
  id: serial("id").primaryKey(),
  charterId: integer("charter_id").notNull(),
  userId: integer("user_id").notNull(),
  role: text("role").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSquadMemberSchema = createInsertSchema(squadMembersTable).omit({ id: true, createdAt: true });
export type InsertSquadMember = z.infer<typeof insertSquadMemberSchema>;
export type SquadMember = typeof squadMembersTable.$inferSelect;
