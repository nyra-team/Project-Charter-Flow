import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const workstreamsTable = pgTable("workstreams", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  name: text("name").notNull(),
  description: text("description").default(""),
  order: integer("order").notNull().default(0),
  parentWorkstreamId: integer("parent_workstream_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertWorkstreamSchema = createInsertSchema(workstreamsTable).omit({ id: true, createdAt: true });
export type InsertWorkstream = z.infer<typeof insertWorkstreamSchema>;
export type Workstream = typeof workstreamsTable.$inferSelect;
