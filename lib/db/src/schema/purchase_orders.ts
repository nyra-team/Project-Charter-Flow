import { pgTable, text, serial, timestamp, integer, numeric, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ─── Purchase Requisitions ──────────────────────────────────────────────────
//
// One pmo_purchase_requisitions row per PR submitted to SAP. We persist the
// SAP-side `sap_pr_number` and a derived `sap_status` ("pending" → "approved"
// → "po_issued" → "received" → "rejected" → "cancelled") so the UI never has
// to round-trip to SAP just to render a status badge.
//
// Adapter contract — see src/integrations/sap/types.ts. The mock adapter
// runs the status machine locally; the real adapter (SAP_MODE=real) will
// call S/4HANA OData and the same fields get overwritten on every poll.
//
// line_items is intentionally jsonb (no per-line table) because PMO doesn't
// edit lines after submission — they're attached at PR creation and only
// updated wholesale if the PR gets re-issued.
export const purchaseRequisitionsTable = pgTable("pmo_purchase_requisitions", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id"),
  charterId: integer("charter_id"),
  // Master DB UUID (employeeId from req.user) — same identity convention as
  // pmo_user_preferences. Free-text rather than int FK so the column doesn't
  // need rewriting when a contractor is renamed in HR.
  requestedById: text("requested_by_id"),
  vendorId: integer("vendor_id"),

  // SAP's response: a real PR number ("PR-MOCK-1234567890" under the mock).
  // Unique so the sync job can use it as the natural key.
  sapPrNumber: text("sap_pr_number").unique(),

  // Submitted lines: [{ description, qty, uom, unitPrice, materialCode? }]
  // Validated at insert time by the route's Zod schema; the table itself
  // stays opaque so adding a line field doesn't require a migration.
  lineItems: jsonb("line_items").notNull().default([]),
  totalAmount: numeric("total_amount", { precision: 15, scale: 2 }).notNull().default("0"),
  currency: text("currency").notNull().default("INR"),

  // Local status — the lifecycle the UI follows. Distinct from sapStatus so
  // we can express "the row exists locally but hasn't been pushed yet"
  // (status='draft', sapStatus=null).
  status: text("status").notNull().default("draft"),
  // Adapter-reported state from the last sync tick. Free-text rather than
  // enum because each adapter (real SAP, mock, future ERP) may report
  // distinct strings.
  sapStatus: text("sap_status"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPurchaseRequisitionSchema = createInsertSchema(purchaseRequisitionsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastSyncedAt: true,
});
export type InsertPurchaseRequisition = z.infer<typeof insertPurchaseRequisitionSchema>;
export type PurchaseRequisition = typeof purchaseRequisitionsTable.$inferSelect;

// ─── Purchase Orders ────────────────────────────────────────────────────────
//
// Spawned from an approved PR via POST /api/prs/:id/convert-to-po. The
// adapter returns a `sap_po_number`; subsequent ticks of the sap-sync job
// keep `sap_status` + `delivery_date` fresh.
//
// We carry `pr_id` rather than FK-ing it (Drizzle FKs across this schema
// are inconsistent and the route handler enforces the parent-row check
// before insert — keeps things simple).
export const purchaseOrdersTable = pgTable("pmo_purchase_orders", {
  id: serial("id").primaryKey(),
  prId: integer("pr_id"),
  vendorId: integer("vendor_id"),

  sapPoNumber: text("sap_po_number").unique(),

  lineItems: jsonb("line_items").notNull().default([]),
  totalAmount: numeric("total_amount", { precision: 15, scale: 2 }).notNull().default("0"),
  currency: text("currency").notNull().default("INR"),

  status: text("status").notNull().default("open"),
  sapStatus: text("sap_status"),
  // YYYY-MM-DD; text to match the convention used elsewhere in the schema
  // (tasks.startDate, milestones.dueDate).
  deliveryDate: text("delivery_date"),

  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPurchaseOrderSchema = createInsertSchema(purchaseOrdersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastSyncedAt: true,
});
export type InsertPurchaseOrder = z.infer<typeof insertPurchaseOrderSchema>;
export type PurchaseOrder = typeof purchaseOrdersTable.$inferSelect;
