import { pgTable, text, serial, jsonb, boolean, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * MCP integration registry. One row per external app the org has connected
 * to Project Hub (Jira, GitHub, Streamliner, etc.). Stored org-wide —
 * super-admins configure; every PMO user uses the same connection.
 *
 *  - `kind`         — discriminator. 'jira' is the only one implemented
 *                     today; 'github' and 'streamliner' are placeholders
 *                     so the registry shape is forward-compatible.
 *  - `name`         — display label, e.g. "Granules Engineering Jira".
 *  - `config`       — kind-specific settings + credentials. Jira shape:
 *                     { baseUrl, email, apiToken, projectKey? }
 *  - `secret_keys`  — names of config fields that must be masked when
 *                     returned to the UI (apiToken, oauthClientSecret…).
 *                     Stored alongside config so the masking rule travels
 *                     with the row instead of being hard-coded per route.
 *  - `enabled`      — soft on/off without deleting credentials.
 *  - `created_by_id`— pmo_users.id of the admin who added this. No FK so
 *                     deleting that admin doesn't cascade-drop the
 *                     integration; the audit trail just goes null.
 */
export const mcpIntegrationsTable = pgTable("pmo_mcp_integrations", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  config: jsonb("config").notNull().default({}),
  secretKeys: text("secret_keys").array().notNull().default([]),
  enabled: boolean("enabled").notNull().default(true),
  createdById: integer("created_by_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertMcpIntegrationSchema = createInsertSchema(mcpIntegrationsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertMcpIntegration = z.infer<typeof insertMcpIntegrationSchema>;
export type McpIntegration = typeof mcpIntegrationsTable.$inferSelect;
