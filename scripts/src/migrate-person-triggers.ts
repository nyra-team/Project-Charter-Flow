/**
 * Person-based & email-based workflow triggers — schema migration.
 *
 * 1) pmo_role_directory      — org role → person/email (admin-managed). Seeded with
 *                              the role KEYS only (no people) per the no-dummy-data rule;
 *                              admins assign real people via /admin/role-directory.
 * 2) pmo_stage_escalation_policy — global tiered escalation ladder per stage; seeded
 *                              with the canonical defaults (CFO 3d→remind, 5d→escalate
 *                              Sponsor; UAT→QA Lead+PM; Go-Live→PM then SteerCo; etc.).
 * 3) pmo_escalation_log      — append-only fired-escalation log (dedup + SLA history).
 *
 * Raw DDL (NOT drizzle-kit push — a footgun on the shared Recruit DB). DDL is
 * transactional in Postgres, so the dry run rolls back cleanly.
 *
 * SAFE BY DEFAULT: dry run (prints plan, rolls back) unless you pass `--commit`.
 * Idempotent — re-running is a no-op (IF NOT EXISTS + ON CONFLICT DO NOTHING).
 *
 * Run:
 *   cd apps/pmo
 *   set -a; source .env; set +a            # exports DATABASE_URL
 *   pnpm --filter @workspace/scripts exec tsx ./src/migrate-person-triggers.ts            # dry run
 *   pnpm --filter @workspace/scripts exec tsx ./src/migrate-person-triggers.ts --commit   # apply
 */
import { pool } from "@workspace/db";

// Role keys seeded with NO person attached (admins fill these in). Project-specific
// roles (sponsor, project_manager, owner) are NOT seeded — they resolve per-project
// from the charter at runtime (see lib/role-resolver.ts).
const ROLE_DIRECTORY_SEED: Array<[role: string, label: string]> = [
  ["cfo", "Chief Financial Officer"],
  ["procurement_head", "Procurement / SCM Head"],
  ["qa_lead", "QA Lead"],
  ["steering_committee", "Steering Committee"],
  ["finance_head", "Finance Head"],
  ["legal_head", "Legal & Compliance Head"],
  ["hod", "Head of Department"],
  ["pmo_head", "PMO Head"],
  ["chairman", "Chairman / Management"],
];

// Global escalation ladder defaults, straight from the user's examples.
// [stage, subGateKey|null, tier, afterDays, action, targetRole]
const POLICY_SEED: Array<[string, string | null, number, number, string, string]> = [
  // CFO approval pending > 3 days → remind CFO; > 5 days → escalate to Sponsor.
  ["investment_authorization", null, 1, 3, "remind", "cfo"],
  ["investment_authorization", null, 2, 5, "escalate", "sponsor"],
  // Vendor Selection overdue → notify Procurement Head.
  ["vendor_selection", null, 1, 0, "remind", "procurement_head"],
  // UAT blocked by defects → notify QA Lead and Project Manager.
  ["uat", null, 1, 0, "remind", "qa_lead"],
  ["uat", null, 1, 0, "remind", "project_manager"],
  // Go-Live pending approval > SLA → remind owner, then escalate to Steering Committee.
  ["go_live", null, 1, 0, "remind", "project_manager"],
  ["go_live", null, 2, 2, "escalate", "steering_committee"],
];

async function migrate(commit: boolean) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1) pmo_role_directory
    await client.query(
      `CREATE TABLE IF NOT EXISTS pmo_role_directory (
         id         serial PRIMARY KEY,
         role       text NOT NULL UNIQUE,
         label      text NOT NULL DEFAULT '',
         user_id    integer,
         email      text,
         is_active  boolean NOT NULL DEFAULT true,
         created_at timestamptz NOT NULL DEFAULT now(),
         updated_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    console.log("✓ pmo_role_directory table ensured.");

    // 2) pmo_stage_escalation_policy
    await client.query(
      `CREATE TABLE IF NOT EXISTS pmo_stage_escalation_policy (
         id           serial PRIMARY KEY,
         stage        text NOT NULL,
         sub_gate_key text,
         tier         integer NOT NULL DEFAULT 1,
         after_days   integer NOT NULL DEFAULT 0,
         action       text NOT NULL DEFAULT 'remind',
         target_role  text NOT NULL,
         is_active    boolean NOT NULL DEFAULT true,
         created_at   timestamptz NOT NULL DEFAULT now(),
         updated_at   timestamptz NOT NULL DEFAULT now()
       )`,
    );
    // Dedup guard for seeding (one default row per stage/tier/target).
    await client.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS pmo_stage_escalation_policy_seed_uniq
         ON pmo_stage_escalation_policy (stage, tier, target_role, COALESCE(sub_gate_key, ''))`,
    );
    console.log("✓ pmo_stage_escalation_policy table ensured.");

    // 3) pmo_escalation_log
    await client.query(
      `CREATE TABLE IF NOT EXISTS pmo_escalation_log (
         id            serial PRIMARY KEY,
         project_id    integer NOT NULL,
         stage         text NOT NULL,
         sub_gate_key  text,
         tier          integer NOT NULL DEFAULT 0,
         action        text NOT NULL,
         target_role   text NOT NULL DEFAULT '',
         recipient_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
         emailed       integer NOT NULL DEFAULT 0,
         source        text NOT NULL DEFAULT 'ladder',
         sent_at       timestamptz NOT NULL DEFAULT now()
       )`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS pmo_escalation_log_dedup
         ON pmo_escalation_log (project_id, stage, tier, sent_at)`,
    );
    console.log("✓ pmo_escalation_log table ensured.");

    // Seed role directory (keys only)
    let roles = 0;
    for (const [role, label] of ROLE_DIRECTORY_SEED) {
      const r = await client.query(
        `INSERT INTO pmo_role_directory (role, label) VALUES ($1, $2)
           ON CONFLICT (role) DO NOTHING`,
        [role, label],
      );
      if (r.rowCount) { roles++; console.log(`  seeded role ${role}`); }
    }
    console.log(`\nSeeded ${roles} role key(s) (no people attached — fill via /admin/role-directory).`);

    // Seed escalation policy
    let tiers = 0;
    for (const [stage, sub, tier, afterDays, action, targetRole] of POLICY_SEED) {
      const r = await client.query(
        `INSERT INTO pmo_stage_escalation_policy (stage, sub_gate_key, tier, after_days, action, target_role)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (stage, tier, target_role, COALESCE(sub_gate_key, '')) DO NOTHING`,
        [stage, sub, tier, afterDays, action, targetRole],
      );
      if (r.rowCount) { tiers++; console.log(`  seeded ${stage} tier ${tier}: ${action} → ${targetRole} (after ${afterDays}d)`); }
    }
    console.log(`\nSeeded ${tiers} escalation policy tier(s).`);

    // Verify
    for (const t of ["pmo_role_directory", "pmo_stage_escalation_policy", "pmo_escalation_log"]) {
      const { rows } = await client.query<{ n: string }>(`SELECT COUNT(*)::text n FROM ${t}`);
      console.log(`${t} now has ${rows[0]?.n ?? "?"} row(s).`);
    }

    if (commit) {
      await client.query("COMMIT");
      console.log("\n✅ COMMITTED.");
    } else {
      await client.query("ROLLBACK");
      console.log("\n🔙 DRY RUN — rolled back. Re-run with --commit to apply.");
    }
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("\n❌ Error — rolled back:", err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate(process.argv.includes("--commit")).catch(() => process.exit(1));
