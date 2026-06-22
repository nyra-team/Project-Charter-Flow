import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Project Team Management — a single roster that replaces the board's separate
// Owner / Manager columns with one "Team" surface. A member is either:
//   • INTERNAL — an employee, referenced by userId (resolves against /api/users).
//   • EXTERNAL — a vendor / partner / consultant / contractor, captured inline
//     (name / org / email / kind). Lightweight by design: external members live
//     only on their project — there is no global external directory.
// Each member carries a free-text role and responsibilities; the project-level
// RACI lives in pmo_project_team_raci below.
export const projectTeamMembersTable = pgTable("pmo_project_team_members", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  // "internal" → userId set; "external" → externalName (+ optional org/email/kind).
  memberType: text("member_type").notNull(),
  userId: integer("user_id"),
  externalName: text("external_name"),
  externalOrg: text("external_org"),
  externalEmail: text("external_email"),
  // vendor | partner | consultant | contractor (free-text, external only).
  externalKind: text("external_kind"),
  role: text("role"),
  responsibilities: text("responsibilities"),
  // pending | approved | rejected — set inline per member in the Team table.
  approval: text("approval").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

// Full project-level RACI matrix: team member × deliverable → R/A/S/C/I.
// Distinct from the per-task pmo_raci_matrix (resource_allocations.ts): that one
// is anchored on a task + internal userId; this one is anchored on a team member
// (so external people are covered too) and a PM-defined deliverable column
// (e.g. Plan / Build / Test / Deploy, or workstream names).
export const projectTeamRaciTable = pgTable("pmo_project_team_raci", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  memberId: integer("member_id").notNull(),
  deliverable: text("deliverable").notNull(),
  raciType: text("raci_type").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertProjectTeamMemberSchema = createInsertSchema(projectTeamMembersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProjectTeamMember = z.infer<typeof insertProjectTeamMemberSchema>;
export type ProjectTeamMember = typeof projectTeamMembersTable.$inferSelect;

export const insertProjectTeamRaciSchema = createInsertSchema(projectTeamRaciTable).omit({ id: true, createdAt: true });
export type InsertProjectTeamRaci = z.infer<typeof insertProjectTeamRaciSchema>;
export type ProjectTeamRaci = typeof projectTeamRaciTable.$inferSelect;
