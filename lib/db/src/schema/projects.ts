import { pgTable, text, serial, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const projectsTable = pgTable("pmo_projects", {
  id: serial("id").primaryKey(),
  charterId: integer("charter_id"),
  portfolioId: integer("portfolio_id"),
  programId: integer("program_id"),
  name: text("name").notNull(),
  description: text("description").default(""),
  status: text("status").notNull().default("planning"),
  priority: text("priority").notNull().default("P2"),
  stage: text("stage").notNull().default("initiation"),
  // Lifecycle path: "vendor" runs all 9 stages; "internal" skips vendor_selection +
  // contract_po. Drives the stage-governance critical path. Default "vendor" so
  // existing projects keep the full procurement path unchanged. See lib/stage-gates.ts.
  projectType: text("project_type").notNull().default("vendor"),
  // Investment category: CAPEX | NPX | CIP | IT (nullable until assigned).
  category: text("category"),
  strategicTheme: text("strategic_theme").default(""),
  ragStatus: text("rag_status").notNull().default("green"),
  ragOverrideJustification: text("rag_override_justification").default(""),
  capexBudget: numeric("capex_budget", { precision: 15, scale: 2 }).notNull().default("0"),
  opexBudget: numeric("opex_budget", { precision: 15, scale: 2 }).notNull().default("0"),
  budgetThresholdPct: numeric("budget_threshold_pct", { precision: 5, scale: 2 }).notNull().default("10"),
  scoringTotal: numeric("scoring_total", { precision: 5, scale: 2 }),
  siteRegion: text("site_region").default(""),
  function: text("function").default(""),
  projectManagerId: integer("project_manager_id"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  progress: integer("progress").notNull().default(0),
  // Jira sync mapping (nullable). jiraKey = linked Jira project key (e.g.
  // "MYG"); jiraSyncedAt = last import/export time. See routes/integrations/jira.ts.
  jiraKey: text("jira_key"),
  jiraSyncedAt: timestamp("jira_synced_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertProjectSchema = createInsertSchema(projectsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projectsTable.$inferSelect;
