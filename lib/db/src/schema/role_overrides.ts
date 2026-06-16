import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Per-employee Project Hub role override, managed from the super-admin-only
// /admin/roles page. Lives in the Recruit DB because the master-DB
// employee_auth.pmo_role CHECK constraint (migration 027 was never applied
// to the live master DB) only accepts 'admin' — every other override value
// is stored here instead. requireAuth() consults this table and the row
// wins over directory derivation, exactly like an employee_auth.pmo_role
// override would. The 'admin' override (allowed by the live constraint)
// still writes to employee_auth.pmo_role; the roles admin API keeps the two
// stores mutually exclusive.
export const roleOverridesTable = pgTable("pmo_role_overrides", {
  employeeCode: text("employee_code").primaryKey(),
  pmoRole: text("pmo_role").notNull(),
  updatedBy: text("updated_by"),
  updatedByName: text("updated_by_name"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type RoleOverride = typeof roleOverridesTable.$inferSelect;
