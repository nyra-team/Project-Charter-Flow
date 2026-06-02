import { pgTable, text, serial, timestamp, integer, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// LLM-composed proactive nudges, written by src/jobs/nudge-generator.ts.
//
// One row per (user, signal). Each generator tick scans live PMO data for
// "things this user probably wants to know about today" (overdue tasks,
// approvals past SLA, RAG=red projects they own, budget breaches), dedupes
// against existing active rows via llm_input_hash, then asks the LLM to
// compose a short, personalised headline + body + suggested-action link.
//
// Mirrored notifications (pmo_notifications rows with type='nudge_<kind>')
// are written alongside so the existing NotificationBell surfaces them
// without any bell-side rework. The nudge row holds the rich, structured
// state (urgency, kind, dedupe hash, dismissed/acted timestamps) that the
// notifications table doesn't model.
//
// status:
//   active     — surfaced to user, awaiting action
//   dismissed  — user said "not now"; feeds back as a recency-weighted hint
//                so the generator demotes this kind for them next tick
//   acted_on   — user clicked through and did the thing
//   expired    — the underlying signal resolved itself (task no longer
//                overdue, approval was decided); marked by the generator
//                on its next pass via dedupe-hash absence
export const nudgesTable = pgTable(
  "pmo_nudges",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),

    // Coarse categorisation drives icon + tone on the bell and lets the
    // /nudges page filter by chips. Keep this enum loose (text not enum
    // column) so adding kinds doesn't need a migration.
    kind: text("kind").notNull(),
    urgency: text("urgency").notNull().default("normal"),

    headline: text("headline").notNull(),
    body: text("body"),
    // App-relative path the user is taken to when they click the CTA.
    link: text("link"),

    // Backlink to whichever PMO entity the signal came from (task, project,
    // charter, approval, budget_line). Used by the dedupe-against-active
    // check and by /nudges/:id/acted-on to write a richer audit entry.
    sourceEntityType: text("source_entity_type"),
    sourceEntityId: integer("source_entity_id"),

    // Bookkeeping for the LLM call that produced this nudge.
    llmModel: text("llm_model"),
    // sha256(`${kind}|${sourceEntityType}|${sourceEntityId}|${userId}`) —
    // any two ticks producing the same signal collide on this and the
    // second insert is skipped. The unique index below enforces it at the
    // DB level so concurrent generator instances can't race.
    llmInputHash: text("llm_input_hash").notNull(),

    status: text("status").notNull().default("active"),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    actedOnAt: timestamp("acted_on_at", { withTimezone: true }),
    expiredAt: timestamp("expired_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqUserHash: unique("pmo_nudges_user_hash_uniq").on(t.userId, t.llmInputHash),
  }),
);

export const insertNudgeSchema = createInsertSchema(nudgesTable).omit({
  id: true,
  createdAt: true,
  dismissedAt: true,
  actedOnAt: true,
  expiredAt: true,
});
export type InsertNudge = z.infer<typeof insertNudgeSchema>;
export type Nudge = typeof nudgesTable.$inferSelect;
