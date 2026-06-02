import { pgTable, text, serial, timestamp, integer, jsonb, boolean, numeric, customType } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Drizzle ships text/jsonb/integer but no first-class bytea; declare it
// locally. AES-GCM ciphertext + IV + auth tag are stored as raw bytes.
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() { return "bytea"; },
});

// ─── RFx Events ─────────────────────────────────────────────────────────────
//
// Top-level sourcing event. type discriminates RFI / RFP / RFQ / e-auction.
// Optional charter_id / project_id binds the event to PMO's project flow;
// nullable so SCM can run a standalone sourcing exercise too.
//
// evaluation_threshold_pct gates commercial-envelope visibility from
// technical graders: once a vendor's weighted technical score crosses this
// threshold, the commercial envelope flips to opened for the commercial
// scope.
//
// tco_model is a free-form JSON describing TCO components and how to weight
// unit-price vs lifecycle costs in the award analysis tab.
export const rfxEventsTable = pgTable("pmo_rfx_events", {
  id: serial("id").primaryKey(),
  // rfi | rfp | rfq | eauction
  type: text("type").notNull(),
  title: text("title").notNull(),
  summary: text("summary").default(""),
  // Free-form rich text / markdown captured from the wizard.
  brief: text("brief").default(""),
  charterId: integer("charter_id"),
  projectId: integer("project_id"),
  currency: text("currency").notNull().default("INR"),
  // draft | open | closed | evaluating | awarded | cancelled
  status: text("status").notNull().default("draft"),
  opensAt: timestamp("opens_at", { withTimezone: true }),
  closesAt: timestamp("closes_at", { withTimezone: true }),
  // none | reverse | dutch | japanese
  auctionMode: text("auction_mode").notNull().default("none"),
  tcoModel: jsonb("tco_model").notNull().default({}),
  // Tech weighted-score gate (0-100) above which a vendor's commercial
  // envelope becomes readable to commercial graders. Defaults to 60.
  evaluationThresholdPct: integer("evaluation_threshold_pct").notNull().default(60),
  blindGrading: boolean("blind_grading").notNull().default(true),
  surrogateBiddingAllowed: boolean("surrogate_bidding_allowed").notNull().default(true),
  alternativeBidsAllowed: boolean("alternative_bids_allowed").notNull().default(false),
  publicDiscovery: boolean("public_discovery").notNull().default(false),
  // Master DB employee id (uuid string) of the SCM/PMO user who created it.
  createdBy: text("created_by"),
  awardedAt: timestamp("awarded_at", { withTimezone: true }),
  awardRationale: text("award_rationale").default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

const rfxTypeEnum = z.enum(["rfi", "rfp", "rfq", "eauction"]);
const rfxStatusEnum = z.enum(["draft", "open", "closed", "evaluating", "awarded", "cancelled"]);
const auctionModeEnum = z.enum(["none", "reverse", "dutch", "japanese"]);

export const insertRfxEventSchema = createInsertSchema(rfxEventsTable, {
  type: rfxTypeEnum,
  status: rfxStatusEnum,
  auctionMode: auctionModeEnum,
}).omit({ id: true, createdAt: true, updatedAt: true, awardedAt: true });
export type InsertRfxEvent = z.infer<typeof insertRfxEventSchema>;
export type RfxEvent = typeof rfxEventsTable.$inferSelect;

// ─── Invitations ────────────────────────────────────────────────────────────
//
// One row per vendor invited to an RFx. Controls who can see and submit on
// the vendor portal. status walks: invited → registered → submitted (or
// declined / withdrawn at any point).
export const rfxInvitationsTable = pgTable("pmo_rfx_invitations", {
  id: serial("id").primaryKey(),
  rfxId: integer("rfx_id").notNull(),
  vendorId: integer("vendor_id").notNull(),
  // invited | declined | registered | submitted | withdrawn
  status: text("status").notNull().default("invited"),
  invitedAt: timestamp("invited_at", { withTimezone: true }).notNull().defaultNow(),
  registeredAt: timestamp("registered_at", { withTimezone: true }),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  inviteToken: text("invite_token").unique(),
  notes: text("notes").default(""),
});

const invitationStatusEnum = z.enum(["invited", "declined", "registered", "submitted", "withdrawn"]);
export const insertRfxInvitationSchema = createInsertSchema(rfxInvitationsTable, {
  status: invitationStatusEnum,
}).omit({ id: true, invitedAt: true, registeredAt: true, submittedAt: true });
export type InsertRfxInvitation = z.infer<typeof insertRfxInvitationSchema>;
export type RfxInvitation = typeof rfxInvitationsTable.$inferSelect;

// ─── Questions ──────────────────────────────────────────────────────────────
//
// RFx-level question bank. section discriminates which envelope the answer
// lives in (technical answers → technical envelope, commercial answers →
// commercial envelope). qualification questions live outside both envelopes
// and are visible from the moment the vendor accepts the invitation.
export const rfxQuestionsTable = pgTable("pmo_rfx_questions", {
  id: serial("id").primaryKey(),
  rfxId: integer("rfx_id").notNull(),
  // technical | commercial | qualification
  section: text("section").notNull(),
  label: text("label").notNull(),
  description: text("description").default(""),
  // text | number | select | multi | file | bool
  kind: text("kind").notNull().default("text"),
  options: jsonb("options").notNull().default([]),
  weight: integer("weight").notNull().default(0),
  required: boolean("required").notNull().default(false),
  order: integer("order").notNull().default(0),
});

const sectionEnum = z.enum(["technical", "commercial", "qualification"]);
const questionKindEnum = z.enum(["text", "number", "select", "multi", "file", "bool", "currency"]);
export const insertRfxQuestionSchema = createInsertSchema(rfxQuestionsTable, {
  section: sectionEnum,
  kind: questionKindEnum,
}).omit({ id: true });
export type InsertRfxQuestion = z.infer<typeof insertRfxQuestionSchema>;
export type RfxQuestion = typeof rfxQuestionsTable.$inferSelect;

// ─── Envelope Keys (2-of-2 secret sharing) ──────────────────────────────────
//
// One row per (rfxId, kind). Holds the two halves (XOR shares) of the AES
// key. Neither share is decryptable alone. Released_at is stamped when both
// halves are combined — that's the moment the envelopes for this kind become
// readable.
export const rfxEnvelopeKeysTable = pgTable("pmo_rfx_envelope_keys", {
  id: serial("id").primaryKey(),
  rfxId: integer("rfx_id").notNull(),
  // technical | commercial | alternative
  kind: text("kind").notNull(),
  keyShareA: bytea("key_share_a").notNull(),
  keyShareB: bytea("key_share_b").notNull(),
  // Master DB employee id who released share A / share B at unlock time.
  releasedByA: text("released_by_a"),
  releasedByB: text("released_by_b"),
  releasedAt: timestamp("released_at", { withTimezone: true }),
});

const envelopeKindEnum = z.enum(["technical", "commercial", "alternative"]);
export const insertRfxEnvelopeKeySchema = createInsertSchema(rfxEnvelopeKeysTable, {
  kind: envelopeKindEnum,
}).omit({ id: true, releasedAt: true });
export type InsertRfxEnvelopeKey = z.infer<typeof insertRfxEnvelopeKeySchema>;
export type RfxEnvelopeKey = typeof rfxEnvelopeKeysTable.$inferSelect;

// ─── Envelopes ──────────────────────────────────────────────────────────────
//
// One row per (invitation, kind). sealed_payload is AES-256-GCM ciphertext
// over a JSON object { answers: { questionId: value, ... }, meta: {...} }.
// iv is the 12-byte GCM nonce, auth_tag the 16-byte tag. When the row is
// opened, the decrypted answers JSON becomes available via the route layer —
// it is NEVER persisted in plaintext.
//
// label_alias is the per-event blind-grading alias ("Vendor 1") assigned at
// open time so graders see a stable, anonymous label.
export const rfxEnvelopesTable = pgTable("pmo_rfx_envelopes", {
  id: serial("id").primaryKey(),
  invitationId: integer("invitation_id").notNull(),
  rfxId: integer("rfx_id").notNull(),
  kind: text("kind").notNull(),
  // draft | sealed | opened | disqualified
  status: text("status").notNull().default("draft"),
  sealedPayload: bytea("sealed_payload"),
  iv: bytea("iv"),
  authTag: bytea("auth_tag"),
  wrappedKeyId: integer("wrapped_key_id"),
  submittedBySurrogate: boolean("submitted_by_surrogate").notNull().default(false),
  surrogateActorId: text("surrogate_actor_id"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  openedAt: timestamp("opened_at", { withTimezone: true }),
  openedBy: text("opened_by"),
  labelAlias: text("label_alias"),
  notes: text("notes").default(""),
});

const envelopeStatusEnum = z.enum(["draft", "sealed", "opened", "disqualified"]);
export const insertRfxEnvelopeSchema = createInsertSchema(rfxEnvelopesTable, {
  kind: envelopeKindEnum,
  status: envelopeStatusEnum,
}).omit({ id: true, submittedAt: true, openedAt: true });
export type InsertRfxEnvelope = z.infer<typeof insertRfxEnvelopeSchema>;
export type RfxEnvelope = typeof rfxEnvelopesTable.$inferSelect;

// ─── Envelope Files ─────────────────────────────────────────────────────────
//
// Vendor-uploaded supporting files attached to an envelope. The file itself
// lives in object storage under /objects/rfx/{rfxId}/env/{envelopeId}/...
// (access-controlled by the storage middleware reading the envelope's
// status).
export const rfxEnvelopeFilesTable = pgTable("pmo_rfx_envelope_files", {
  id: serial("id").primaryKey(),
  envelopeId: integer("envelope_id").notNull(),
  questionId: integer("question_id"),
  fileUrl: text("file_url").notNull(),
  originalName: text("original_name").default(""),
  mime: text("mime").default(""),
  sizeBytes: integer("size_bytes").default(0),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertRfxEnvelopeFileSchema = createInsertSchema(rfxEnvelopeFilesTable).omit({
  id: true, uploadedAt: true,
});
export type InsertRfxEnvelopeFile = z.infer<typeof insertRfxEnvelopeFileSchema>;
export type RfxEnvelopeFile = typeof rfxEnvelopeFilesTable.$inferSelect;

// ─── Scoring Dimensions ─────────────────────────────────────────────────────
//
// Same shape as the JSON __eval_dimensions used inside VendorEvalScorecard,
// promoted to a proper table because we now need to join scores by dimension
// across vendors and graders.
export const rfxScoringDimensionsTable = pgTable("pmo_rfx_scoring_dimensions", {
  id: serial("id").primaryKey(),
  rfxId: integer("rfx_id").notNull(),
  label: text("label").notNull(),
  description: text("description").default(""),
  // technical | commercial
  kind: text("kind").notNull(),
  weight: integer("weight").notNull().default(10),
  order: integer("order").notNull().default(0),
});

const dimensionKindEnum = z.enum(["technical", "commercial"]);
export const insertRfxScoringDimensionSchema = createInsertSchema(rfxScoringDimensionsTable, {
  kind: dimensionKindEnum,
}).omit({ id: true });
export type InsertRfxScoringDimension = z.infer<typeof insertRfxScoringDimensionSchema>;
export type RfxScoringDimension = typeof rfxScoringDimensionsTable.$inferSelect;

// ─── Scores ─────────────────────────────────────────────────────────────────
//
// One row per (envelope, dimension, grader). Blind grading is enforced at
// read time — the column itself always holds the real grader id for audit.
// grader_alias ("Grader A/B/C") is rendered to other graders while the event
// is open; revealed in the audit log after award.
export const rfxScoresTable = pgTable("pmo_rfx_scores", {
  id: serial("id").primaryKey(),
  envelopeId: integer("envelope_id").notNull(),
  dimensionId: integer("dimension_id").notNull(),
  graderId: text("grader_id").notNull(),
  graderAlias: text("grader_alias").default(""),
  score: integer("score").notNull(),
  rationale: text("rationale").default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertRfxScoreSchema = createInsertSchema(rfxScoresTable).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertRfxScore = z.infer<typeof insertRfxScoreSchema>;
export type RfxScore = typeof rfxScoresTable.$inferSelect;

// ─── Clarifications ─────────────────────────────────────────────────────────
//
// Vendor → buyer and buyer → vendor Q&A during an open RFx. is_public marks
// answers SCM wants broadcast to every invited vendor (the standard Ariba
// pattern for fairness).
export const rfxClarificationsTable = pgTable("pmo_rfx_clarifications", {
  id: serial("id").primaryKey(),
  rfxId: integer("rfx_id").notNull(),
  invitationId: integer("invitation_id"),
  // vendor | buyer
  fromRole: text("from_role").notNull(),
  question: text("question").notNull(),
  answer: text("answer"),
  isPublic: boolean("is_public").notNull().default(false),
  askedBy: text("asked_by"),
  answeredBy: text("answered_by"),
  answeredAt: timestamp("answered_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

const clarRoleEnum = z.enum(["vendor", "buyer"]);
export const insertRfxClarificationSchema = createInsertSchema(rfxClarificationsTable, {
  fromRole: clarRoleEnum,
}).omit({ id: true, createdAt: true, answeredAt: true });
export type InsertRfxClarification = z.infer<typeof insertRfxClarificationSchema>;
export type RfxClarification = typeof rfxClarificationsTable.$inferSelect;

// ─── Awards ─────────────────────────────────────────────────────────────────
//
// Supports split awards: multiple rows per RFx, each with a share_pct and a
// monetary value. rationale is the human-written justification surfaced to
// CFO/SCM review.
export const rfxAwardsTable = pgTable("pmo_rfx_awards", {
  id: serial("id").primaryKey(),
  rfxId: integer("rfx_id").notNull(),
  vendorId: integer("vendor_id").notNull(),
  envelopeIdTechnical: integer("envelope_id_technical"),
  envelopeIdCommercial: integer("envelope_id_commercial"),
  sharePct: integer("share_pct").notNull().default(100),
  value: numeric("value", { precision: 15, scale: 2 }).notNull().default("0"),
  currency: text("currency").notNull().default("INR"),
  rationale: text("rationale").default(""),
  decidedBy: text("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertRfxAwardSchema = createInsertSchema(rfxAwardsTable).omit({
  id: true, decidedAt: true,
});
export type InsertRfxAward = z.infer<typeof insertRfxAwardSchema>;
export type RfxAward = typeof rfxAwardsTable.$inferSelect;

// ─── Audit ──────────────────────────────────────────────────────────────────
//
// Append-only event log specific to RFx evaluation. Distinct from the
// generic pmo_activity table because this is what the platform reads during
// a procurement audit — must never be edited, must never be filtered, must
// carry every state-change with the acting employee id.
export const rfxAuditTable = pgTable("pmo_rfx_audit", {
  id: serial("id").primaryKey(),
  rfxId: integer("rfx_id").notNull(),
  // rfx_created | rfx_published | invitation_sent | envelope_sealed |
  // envelope_unlocked | envelope_opened | score_submitted | clarification_asked |
  // clarification_answered | deadline_extended | award_decided | rfx_cancelled
  event: text("event").notNull(),
  // Master DB employee id (uuid) of the actor — null only when the actor is
  // a vendor on the portal (use actorVendorId then).
  actorEmployeeId: text("actor_employee_id"),
  actorVendorId: integer("actor_vendor_id"),
  payload: jsonb("payload").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertRfxAuditSchema = createInsertSchema(rfxAuditTable).omit({
  id: true, createdAt: true,
});
export type InsertRfxAudit = z.infer<typeof insertRfxAuditSchema>;
export type RfxAudit = typeof rfxAuditTable.$inferSelect;
