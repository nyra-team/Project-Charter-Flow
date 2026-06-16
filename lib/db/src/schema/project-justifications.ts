import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";

// Owner-supplied justification for a project that has gone DELAYED or OFF-TRACK
// (schedule health, same rule as the Delivery bar). One row per episode: a new
// row is required whenever the project's current delayed/off-track KIND has no
// matching justification yet. The latest row per project surfaces in the
// Projects list "Justification" column.
export const projectJustificationsTable = pgTable("pmo_project_justifications", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  userId: integer("user_id").notNull(), // pmo_users.id of the owner who justified
  kind: text("kind").notNull(), // "delayed" | "off_track"
  justification: text("justification").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ProjectJustification = typeof projectJustificationsTable.$inferSelect;
export type InsertProjectJustification = typeof projectJustificationsTable.$inferInsert;
