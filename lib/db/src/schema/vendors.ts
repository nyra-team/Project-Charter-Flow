import { pgTable, text, serial, timestamp, integer, numeric, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const vendorsTable = pgTable("pmo_vendors", {
  id: serial("id").primaryKey(),
  charterId: integer("charter_id").notNull(),
  vendorName: text("vendor_name").notNull(),
  proposedPrice: numeric("proposed_price", { precision: 15, scale: 2 }).notNull().default("0"),
  description: text("description").default(""),
  isSelected: boolean("is_selected").notNull().default(false),
  // Pointer into the new pmo_vendor_master. Charter rows created post-2026-05
  // come in as pointers via the master-picker; legacy rows backfilled by
  // migrate-vendor-json-to-master.ts.
  masterVendorId: integer("master_vendor_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertVendorSchema = createInsertSchema(vendorsTable).omit({ id: true, createdAt: true });
export type InsertVendor = z.infer<typeof insertVendorSchema>;
export type Vendor = typeof vendorsTable.$inferSelect;
