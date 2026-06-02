import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Reusable project blueprint — captures a project's shape (tasks + milestones +
// dependency wiring) so a new project can be spun up in one click. Authored
// either freshly through the Templates UI or cloned from an existing project
// via POST /api/templates/from-project/:projectId. Soft-delete only — flipping
// is_active=false hides the template without orphaning its children rows.
export const projectTemplatesTable = pgTable("pmo_project_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").default(""),
  category: text("category").notNull().default("general"),
  // When the template was cloned from a live project, retain a backlink so
  // future audits can answer "where did this template come from?".
  sourceProjectId: integer("source_project_id"),
  createdById: integer("created_by_id"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertProjectTemplateSchema = createInsertSchema(projectTemplatesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProjectTemplate = z.infer<typeof insertProjectTemplateSchema>;
export type ProjectTemplate = typeof projectTemplatesTable.$inferSelect;
