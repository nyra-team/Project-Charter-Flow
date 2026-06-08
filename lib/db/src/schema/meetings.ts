import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const meetingsTable = pgTable("pmo_meetings", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  type: text("type").notNull().default("other"), // steering_committee | pmo | ldm_scrum | other
  projectId: integer("project_id"), // nullable — meetings can be standalone
  scheduledDate: text("scheduled_date").notNull(),
  scheduledTime: text("scheduled_time"),
  status: text("status").notNull().default("planned"), // planned | in_progress | completed | cancelled
  location: text("location").default(""),
  agenda: text("agenda").default(""),
  notes: text("notes").default(""), // general meeting notes / minutes
  createdById: integer("created_by_id"),
  isFlashMode: boolean("is_flash_mode").notNull().default(false),
  // Marks the synthetic per-project "CXO Action Center" meeting that holds
  // action items mirrored in from the CXO dashboard (two-way sync). One per
  // project, enforced by a partial unique index; never user-created/deleted.
  isCxoContainer: boolean("is_cxo_container").notNull().default(false),
  // ── Microsoft Teams integration (Stage 6 — Teams MoM, mock-first) ──────
  // Populated by routes/integrations/teams.ts and jobs/teams-sync.ts. All
  // additive — meetings without a Teams origin leave these null and behave
  // exactly as before.
  //
  // teamsMeetingId    — Graph onlineMeeting id (or fixture id under the
  //                     mock). Stored as text because Graph IDs are long
  //                     opaque strings, not integers.
  // teamsTranscriptRaw— full transcript text once fetched. The existing
  //                     /api/ai/meetings/:id/extract-action-items reads
  //                     the `notes` column so the sync job mirrors the
  //                     transcript into notes too (kept here as the
  //                     unedited audit copy).
  // teamsSyncedAt     — last successful pull from the adapter.
  // momPostedToChannelId / momPostedAt — when MoM is sent back into a
  //                     Teams channel via postMomToChannel(), we stamp
  //                     these so "Post MoM" can become an idempotent UI
  //                     gesture.
  teamsMeetingId: text("teams_meeting_id"),
  teamsTranscriptRaw: text("teams_transcript_raw"),
  teamsSyncedAt: timestamp("teams_synced_at", { withTimezone: true }),
  momPostedToChannelId: text("mom_posted_to_channel_id"),
  momPostedAt: timestamp("mom_posted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertMeetingSchema = createInsertSchema(meetingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMeeting = z.infer<typeof insertMeetingSchema>;
export type Meeting = typeof meetingsTable.$inferSelect;

export const meetingItemsTable = pgTable("pmo_meeting_items", {
  id: serial("id").primaryKey(),
  meetingId: integer("meeting_id").notNull(),
  description: text("description").notNull(),
  assignedToUserId: integer("assigned_to_user_id"),
  dueDate: text("due_date"),
  percentComplete: integer("percent_complete").notNull().default(0),
  status: text("status").notNull().default("open"), // open | in_progress | completed | deferred
  notes: text("notes").default(""),
  category: text("category").default("action_item"), // action_item | decision | information
  // Cross-link to the CXO Action Center mirror (exec_action_items.id). Set when
  // this MOM item is synced to/from the CXO dashboard. Nullable, no hard FK —
  // the two rows must be independently deletable.
  execActionItemId: integer("exec_action_item_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertMeetingItemSchema = createInsertSchema(meetingItemsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMeetingItem = z.infer<typeof insertMeetingItemSchema>;
export type MeetingItem = typeof meetingItemsTable.$inferSelect;
