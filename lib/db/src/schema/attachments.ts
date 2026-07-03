import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Per-entity file attachments. One row per uploaded file, tied to a project and
// optionally a milestone + task/subtask. taskId null = project-level attachment;
// taskId set = the file belongs to that task or subtask (subtasks are tasks with
// a parentTaskId). Distinct from pmo_messages (comms) and pmo_documents (the
// versioned project repository) — this is the lightweight "clip a file onto the
// row" store surfaced by the paperclip icon next to each code.
export const attachmentsTable = pgTable("pmo_attachments", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  milestoneId: integer("milestone_id"),
  taskId: integer("task_id"),
  fileUrl: text("file_url").notNull(),
  fileName: text("file_name").notNull(),
  fileType: text("file_type"),
  fileSize: integer("file_size"),
  uploadedBy: integer("uploaded_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAttachmentSchema = createInsertSchema(attachmentsTable).omit({ id: true, createdAt: true });
export type InsertAttachment = z.infer<typeof insertAttachmentSchema>;
export type Attachment = typeof attachmentsTable.$inferSelect;
