import { pgTable, text, serial, timestamp, integer, jsonb, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// One cached "Live Project Charter" snapshot per project. The Live Charter is a
// read-only, regenerable executive view assembled from live project data — the
// consolidated AI summary of every document in the project's space plus the
// stage × (required-doc + checklist) governance matrix. Distinct from the
// hand-authored initiation charter in `charters.ts`.
export const liveChartersTable = pgTable("pmo_live_charters", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().unique(),
  // Consolidated executive summary (markdown). Null when AI was unavailable but
  // the matrix could still be computed.
  narrative: text("narrative"),
  // Computed checklist matrix: per-stage required-doc presence/approval +
  // checklist-item completion + roll-up RAG. Shape defined by the api-server
  // matrix builder.
  matrix: jsonb("matrix").notNull().default([]),
  // Per-document digest used to build the narrative:
  // [{ docId, name, stage, tags, summary }].
  docDigest: jsonb("doc_digest").notNull().default([]),
  stale: boolean("stale").notNull().default(false),
  generatedBy: integer("generated_by"),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertLiveCharterSchema = createInsertSchema(liveChartersTable).omit({ id: true, createdAt: true });
export type InsertLiveCharter = z.infer<typeof insertLiveCharterSchema>;
export type LiveCharter = typeof liveChartersTable.$inferSelect;
