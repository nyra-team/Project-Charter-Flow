import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const meetingsTable = pgTable("meetings", {
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertMeetingSchema = createInsertSchema(meetingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMeeting = z.infer<typeof insertMeetingSchema>;
export type Meeting = typeof meetingsTable.$inferSelect;

export const meetingItemsTable = pgTable("meeting_items", {
  id: serial("id").primaryKey(),
  meetingId: integer("meeting_id").notNull(),
  description: text("description").notNull(),
  assignedToUserId: integer("assigned_to_user_id"),
  dueDate: text("due_date"),
  percentComplete: integer("percent_complete").notNull().default(0),
  status: text("status").notNull().default("open"), // open | in_progress | completed | deferred
  notes: text("notes").default(""),
  category: text("category").default("action_item"), // action_item | decision | information
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertMeetingItemSchema = createInsertSchema(meetingItemsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMeetingItem = z.infer<typeof insertMeetingItemSchema>;
export type MeetingItem = typeof meetingItemsTable.$inferSelect;
