import { pgTable, text, serial, timestamp, boolean, jsonb, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Per-user, per-surface saved views. The "config" jsonb shape is owned by
// each surface (filters, column visibility, sort, named scenarios, hidden
// dashboard tiles) — kept opaque here so this table never needs migrations
// when a surface adds a new knob.
//
// Identity note: user_id stores the **master DB employeeId** (UUID string)
// from req.user.employeeId. Preferences live in their own identity space
// rather than FK-ing pmo_users.id, because the natural unit is "this human"
// not "this PMO row" — and pmo_users.id is currently not 1:1 with the
// authenticated identity.
//
// scope taxonomy (deliberately closed-set; widen here when adding a surface):
//   task_grid             — per-project Tasks view (filters, columns, sort)
//   project_list          — global Projects page
//   portfolio_dashboard   — named scoring-weight scenarios for what-if
//   exec_dashboard        — hidden / reordered KPI tiles
//   sidebar               — collapsed groups, pinned items (future)
//
// Per (user, scope) a row with is_default=true is the default view loaded
// on first render of that surface for that user. At most one default per
// (user, scope); enforced in app code, not the DB, so users can flip
// defaults without a transactional dance.
export const userPreferencesTable = pgTable(
  "pmo_user_preferences",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    scope: text("scope").notNull(),
    // Human-meaningful name within the scope ("Critical only", "Q1 push",
    // "Hide RAG tiles"). Serves both as display label and as the lookup key
    // for the hook's per-call cache.
    key: text("key").notNull(),
    config: jsonb("config").notNull().default({}),
    isDefault: boolean("is_default").notNull().default(false),
    // Optional — when set, the view is suggested to anyone with that role
    // on the same surface. UI exposure of this knob comes in Stage 3a.
    sharedWithRole: text("shared_with_role"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    uniqUserScopeKey: unique("pmo_user_preferences_user_scope_key_uniq").on(t.userId, t.scope, t.key),
  }),
);

export const insertUserPreferenceSchema = createInsertSchema(userPreferencesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertUserPreference = z.infer<typeof insertUserPreferenceSchema>;
export type UserPreference = typeof userPreferencesTable.$inferSelect;
