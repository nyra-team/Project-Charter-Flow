import { pgTable, text, serial, timestamp, numeric, jsonb, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * pmo_doa_matrix — Delegation Of Authority bands.
 *
 * Lookup keyed by (entity, category, kind, amount_inr). The most-specific
 * matching row wins; "*" is a wildcard. `approverRoles` is an ordered list
 * of role strings drawn from pmo_users.role
 * (e.g. ["hod","cfo","executive_director","chairman"]). The resolver inserts
 * one pmo_approvals row per role when a charter is submitted.
 *
 * Seeded with three placeholder bands (see scripts/add-doa-matrix-and-merge-charter-nfa.sql).
 * Refine via /admin/doa-matrix once the matrix UI ships.
 */
export const doaMatrixTable = pgTable("pmo_doa_matrix", {
  id: serial("id").primaryKey(),
  entity: text("entity").notNull().default("*"),       // GIL | GLS | CZRO | "*"
  category: text("category").notNull().default("*"),   // Compliance | ROI | Compliance + ROI | "*"
  kind: text("kind").notNull().default("*"),           // capex | opex | mixed | "*"
  minInr: numeric("min_inr", { precision: 15, scale: 2 }).notNull().default("0"),
  maxInr: numeric("max_inr", { precision: 15, scale: 2 }),  // null = unbounded
  approverRoles: jsonb("approver_roles").notNull().default([]),  // ["hod","cfo",…]
  active: boolean("active").notNull().default(true),
  label: text("label").notNull().default(""),          // human-readable band name
  notes: text("notes").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertDoaMatrixSchema = createInsertSchema(doaMatrixTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDoaMatrix = z.infer<typeof insertDoaMatrixSchema>;
export type DoaMatrix = typeof doaMatrixTable.$inferSelect;
