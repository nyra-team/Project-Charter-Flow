import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Admin-managed mapping of an org-wide governance role (e.g. cfo, procurement_head,
// qa_lead, steering_committee) to the actual person/email to notify. Project-specific
// roles (sponsor, project_manager, owner) are NOT stored here — they resolve from the
// charter/project per project (see lib/role-resolver.ts). `userId` links a pmo_users
// row (preferred — gives in-app notifications); `email` is a fallback / group inbox
// (e.g. a Steering Committee distribution list) used when there's no single user.
export const roleDirectoryTable = pgTable("pmo_role_directory", {
  id: serial("id").primaryKey(),
  role: text("role").notNull().unique(),
  label: text("label").notNull().default(""),
  userId: integer("user_id"),
  email: text("email"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertRoleDirectorySchema = createInsertSchema(roleDirectoryTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRoleDirectory = z.infer<typeof insertRoleDirectorySchema>;
export type RoleDirectory = typeof roleDirectoryTable.$inferSelect;
