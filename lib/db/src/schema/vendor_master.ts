import { pgTable, text, serial, timestamp, integer, jsonb, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ─── Vendor Master ──────────────────────────────────────────────────────────
//
// First-class supplier identity, independent of any charter. A charter-scoped
// row (pmo_vendors) may point at one of these via master_vendor_id, but the
// master row is the source of truth for profile, segment, qualifications,
// KPIs, and the vendor-portal login.
//
// auth_user_id is the Supabase auth user id from the **vendor** Supabase
// project (separate from master/recruit projects). Nullable for vendors
// entered by PMO staff who never log in.
//
// segment / risk_status are free text in the column but constrained by the
// Zod insert schema below. Same pattern as charters.status — keeps schema
// migrations cheap when a new band gets added.
export const vendorMasterTable = pgTable("pmo_vendor_master", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  legalName: text("legal_name").default(""),
  gst: text("gst").default(""),
  pan: text("pan").default(""),
  country: text("country").default("IN"),
  region: text("region").default(""),
  category: text("category").default(""),
  email: text("email").default(""),
  phone: text("phone").default(""),
  website: text("website").default(""),
  address: text("address").default(""),
  sapVendorCode: text("sap_vendor_code").unique(),
  // strategic | preferred | approved | provisional | blocked
  segment: text("segment").notNull().default("provisional"),
  // green | amber | red | unknown
  riskStatus: text("risk_status").notNull().default("unknown"),
  authUserId: uuid("auth_user_id"),
  // Free-form JSON for portal-collected profile extras (capabilities,
  // certifications) without a migration each time the form grows.
  profileExtras: jsonb("profile_extras").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

const vendorSegmentEnum = z.enum(["strategic", "preferred", "approved", "provisional", "blocked"]);
const vendorRiskEnum = z.enum(["green", "amber", "red", "unknown"]);

export const insertVendorMasterSchema = createInsertSchema(vendorMasterTable, {
  segment: vendorSegmentEnum,
  riskStatus: vendorRiskEnum,
}).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertVendorMaster = z.infer<typeof insertVendorMasterSchema>;
export type VendorMaster = typeof vendorMasterTable.$inferSelect;

// ─── Vendor Documents ───────────────────────────────────────────────────────
//
// Registration certs, GST cert, ISO certificates, financial statements, etc.
// File itself lives in object storage; this row carries metadata + the
// verification trail. expires_at lets the portal nag the vendor before a cert
// lapses; verified_by/verified_at populated when a PMO user marks it good.
export const vendorDocumentsTable = pgTable("pmo_vendor_documents", {
  id: serial("id").primaryKey(),
  vendorId: integer("vendor_id").notNull(),
  // registration | gst | pan | iso | insurance | financial | other
  kind: text("kind").notNull(),
  fileUrl: text("file_url").notNull(),
  originalName: text("original_name").default(""),
  mime: text("mime").default(""),
  sizeBytes: integer("size_bytes").default(0),
  notes: text("notes").default(""),
  // Master DB employee id (uuid) of the PMO user who verified the doc.
  verifiedBy: text("verified_by"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

const vendorDocKindEnum = z.enum([
  "registration", "gst", "pan", "iso", "insurance", "financial", "msme", "tax_residency", "other",
]);

export const insertVendorDocumentSchema = createInsertSchema(vendorDocumentsTable, {
  kind: vendorDocKindEnum,
}).omit({ id: true, createdAt: true, verifiedAt: true });
export type InsertVendorDocument = z.infer<typeof insertVendorDocumentSchema>;
export type VendorDocument = typeof vendorDocumentsTable.$inferSelect;

// ─── Vendor Qualifications ──────────────────────────────────────────────────
//
// Matrix entry: one row per (vendor, category, region, business_unit). A
// vendor may be qualified to sell injectable APIs in MN Park but not in
// Bonthapally — separate rows. status reflects the latest decision.
export const vendorQualificationsTable = pgTable("pmo_vendor_qualifications", {
  id: serial("id").primaryKey(),
  vendorId: integer("vendor_id").notNull(),
  category: text("category").notNull(),
  region: text("region").default(""),
  businessUnit: text("business_unit").default(""),
  // pending | qualified | disqualified | expired
  status: text("status").notNull().default("pending"),
  notes: text("notes").default(""),
  decidedBy: text("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

const vendorQualStatusEnum = z.enum(["pending", "qualified", "disqualified", "expired"]);
export const insertVendorQualificationSchema = createInsertSchema(vendorQualificationsTable, {
  status: vendorQualStatusEnum,
}).omit({ id: true, createdAt: true, decidedAt: true });
export type InsertVendorQualification = z.infer<typeof insertVendorQualificationSchema>;
export type VendorQualification = typeof vendorQualificationsTable.$inferSelect;

// ─── Questionnaire Templates ────────────────────────────────────────────────
//
// PMO authors templates (e.g. "ESG self-assessment v3"); vendors submit
// responses on the portal. Questions kept as JSON so the form builder can
// evolve without a migration per added question type.
export const vendorQuestionnaireTemplatesTable = pgTable("pmo_vendor_questionnaire_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").default(""),
  version: integer("version").notNull().default(1),
  isActive: integer("is_active").notNull().default(1),
  // [{ id, label, kind: 'text'|'number'|'select'|'multi'|'file'|'bool',
  //    options?: string[], required?: boolean, section?: string }]
  questions: jsonb("questions").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertVendorQuestionnaireTemplateSchema = createInsertSchema(vendorQuestionnaireTemplatesTable).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertVendorQuestionnaireTemplate = z.infer<typeof insertVendorQuestionnaireTemplateSchema>;
export type VendorQuestionnaireTemplate = typeof vendorQuestionnaireTemplatesTable.$inferSelect;

export const vendorQuestionnaireResponsesTable = pgTable("pmo_vendor_questionnaire_responses", {
  id: serial("id").primaryKey(),
  vendorId: integer("vendor_id").notNull(),
  templateId: integer("template_id").notNull(),
  // { questionId: answerValue, ... }
  answers: jsonb("answers").notNull().default({}),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertVendorQuestionnaireResponseSchema = createInsertSchema(vendorQuestionnaireResponsesTable).omit({
  id: true, submittedAt: true,
});
export type InsertVendorQuestionnaireResponse = z.infer<typeof insertVendorQuestionnaireResponseSchema>;
export type VendorQuestionnaireResponse = typeof vendorQuestionnaireResponsesTable.$inferSelect;

// ─── Vendor KPIs ────────────────────────────────────────────────────────────
//
// One row per (vendor, period). Period can be YYYY-MM or YYYY-Qn. Composite
// score is a weighted average computed at ingest; weights live in admin
// config. Source tracks whether the row came from a SAP feed, an internal
// manual fill, or an auto-calc job.
export const vendorKpisTable = pgTable("pmo_vendor_kpis", {
  id: serial("id").primaryKey(),
  vendorId: integer("vendor_id").notNull(),
  period: text("period").notNull(),
  onTimeDeliveryPct: integer("on_time_delivery_pct"),
  invoiceAccuracyPct: integer("invoice_accuracy_pct"),
  qualityPct: integer("quality_pct"),
  responsivenessPct: integer("responsiveness_pct"),
  compositeScore: integer("composite_score"),
  // auto | manual | sap
  source: text("source").notNull().default("manual"),
  notes: text("notes").default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

const kpiSourceEnum = z.enum(["auto", "manual", "sap"]);
export const insertVendorKpiSchema = createInsertSchema(vendorKpisTable, {
  source: kpiSourceEnum,
}).omit({ id: true, createdAt: true });
export type InsertVendorKpi = z.infer<typeof insertVendorKpiSchema>;
export type VendorKpi = typeof vendorKpisTable.$inferSelect;

// ─── Vendor Risk Events ─────────────────────────────────────────────────────
//
// Append-only feed of risk signals (internal escalation, legal flag, ESG
// concern, financial instability, sanctions hit, news mention). The vendor's
// rolled-up risk_status on pmo_vendor_master is recomputed from the latest
// unresolved high-severity event on this table.
export const vendorRiskEventsTable = pgTable("pmo_vendor_risk_events", {
  id: serial("id").primaryKey(),
  vendorId: integer("vendor_id").notNull(),
  // internal | legal | esg | financial | sanctions | news
  source: text("source").notNull(),
  // green | amber | red
  severity: text("severity").notNull(),
  summary: text("summary").notNull(),
  link: text("link"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedBy: text("resolved_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

const riskSourceEnum = z.enum(["internal", "legal", "esg", "financial", "sanctions", "news", "other"]);
const riskSeverityEnum = z.enum(["green", "amber", "red"]);
export const insertVendorRiskEventSchema = createInsertSchema(vendorRiskEventsTable, {
  source: riskSourceEnum,
  severity: riskSeverityEnum,
}).omit({ id: true, createdAt: true, resolvedAt: true });
export type InsertVendorRiskEvent = z.infer<typeof insertVendorRiskEventSchema>;
export type VendorRiskEvent = typeof vendorRiskEventsTable.$inferSelect;
