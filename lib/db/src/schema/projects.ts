import { pgTable, text, serial, timestamp, integer, numeric, boolean } from "drizzle-orm/pg-core";
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
  confidential: boolean("confidential").notNull().default(false),
  ragOverrideJustification: text("rag_override_justification").default(""),
  capexBudget: numeric("capex_budget", { precision: 15, scale: 2 }).notNull().default("0"),
  opexBudget: numeric("opex_budget", { precision: 15, scale: 2 }).notNull().default("0"),
  budgetThresholdPct: numeric("budget_threshold_pct", { precision: 5, scale: 2 }).notNull().default("10"),
  scoringTotal: numeric("scoring_total", { precision: 5, scale: 2 }),
  siteRegion: text("site_region").default(""),
  function: text("function").default(""),
  // IT central-tracker fields (imported from the IT Central Project Tracker).
  // domain = IT sub-area (Digital Applications, Infrastructure, Cybersecurity, …);
  // itCode = the tracker project code (e.g. IE-DA-CBP); systemOwner / businessOwner
  // are the raw owner names from the tracker (the linked account lives on
  // projectOwnerId). Null for non-IT projects. domain drives the projects-list badge.
  domain: text("domain"),
  itCode: text("it_code"),
  systemOwner: text("system_owner"),
  businessOwner: text("business_owner"),
  projectManagerId: integer("project_manager_id"),
  // Project owner (pmo_users.id). Assignable from the projects table even when
  // the project has no linked charter; for charter-backed projects it's kept in
  // sync with the charter's projectOwnerId. Read project-first, charter-fallback.
  projectOwnerId: integer("project_owner_id"),
  // Email address of the project's Microsoft Teams channel (Channel → ⋯ → Get email
  // address). All project alerts are mirrored there via plain SMTP. Null = no mirror.
  teamsChannelEmail: text("teams_channel_email"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  // Target go-live date: the date the project is meant to launch. Distinct from
  // endDate (delivery). Surfaced as a flag marker in the Gantt. YYYY-MM-DD.
  goLiveDate: text("go_live_date"),
  // When the project really started / finished, against the planned pair above.
  // Same planned-vs-actual model pmo_tasks and pmo_milestones already carry.
  actualStartDate: text("actual_start_date"),
  actualEndDate: text("actual_end_date"),
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
