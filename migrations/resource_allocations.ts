import { pgTable, text, serial, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const resourceAllocationsTable = pgTable("resource_allocations", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  workstreamId: integer("workstream_id"),
  userId: integer("user_id").notNull(),
  role: text("role"),
  skill: text("skill"),
  allocationPct: numeric("allocation_pct", { precision: 5, scale: 2 }).notNull().default("100"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const raciMatrixTable = pgTable("raci_matrix", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  taskId: integer("task_id"),
  workstreamId: integer("workstream_id"),
  userId: integer("user_id").notNull(),
  raciType: text("raci_type").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertResourceAllocationSchema = createInsertSchema(resourceAllocationsTable).omit({ id: true, createdAt: true });
export type InsertResourceAllocation = z.infer<typeof insertResourceAllocationSchema>;
export type ResourceAllocation = typeof resourceAllocationsTable.$inferSelect;

export const insertRaciMatrixSchema = createInsertSchema(raciMatrixTable).omit({ id: true, createdAt: true });
export type InsertRaciMatrix = z.infer<typeof insertRaciMatrixSchema>;
export type RaciMatrix = typeof raciMatrixTable.$inferSelect;
