/**
 * Critical Path Visualization — schema migration.
 *
 * 1) Adds pmo_projects.project_type (text, NOT NULL, default 'vendor'). Existing
 *    projects therefore keep the full 9-stage procurement path. 'internal' projects
 *    skip vendor_selection + contract_po (see api-server/src/lib/stage-gates.ts).
 * 2) Creates pmo_stage_slas — admin-editable target duration (days) per lifecycle
 *    stage; drives "days overdue" on the stage-governance critical path.
 * 3) Seeds the 9 stage SLA rows with sensible defaults (idempotent via ON CONFLICT).
 *
 * Done with raw DDL (NOT drizzle-kit push, which is a footgun on the shared Recruit
 * DB). DDL is transactional in Postgres, so the dry run rolls back cleanly.
 *
 * SAFE BY DEFAULT: dry run (prints plan, rolls back) unless you pass `--commit`.
 * Idempotent — re-running is a no-op (IF NOT EXISTS + ON CONFLICT DO NOTHING).
 *
 * Run:
 *   cd apps/pmo
 *   set -a; source .env; set +a            # exports DATABASE_URL
 *   pnpm --filter @workspace/scripts exec tsx ./src/migrate-critical-path.ts            # dry run
 *   pnpm --filter @workspace/scripts exec tsx ./src/migrate-critical-path.ts --commit   # apply
 */
import { pool } from "@workspace/db";

// Default target durations (calendar days) per stage. Admin-editable post-seed.
const STAGE_SLA_DEFAULTS: Array<[stage: string, targetDays: number]> = [
  ["initiation", 10],
  // Initiation sub-gates (Option D): Business Case + URS tracked independently.
  ["initiation.business_case", 5],
  ["initiation.urs", 10],
  ["vendor_selection", 30],
  ["investment_authorization", 14],
  ["contract_po", 21],
  ["design", 15],
  ["build", 30],
  ["uat", 15],
  ["go_live", 7],
  ["closure", 10],
];

async function migrate(commit: boolean) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1) project_type column
    await client.query(
      `ALTER TABLE pmo_projects
         ADD COLUMN IF NOT EXISTS project_type text NOT NULL DEFAULT 'vendor'`,
    );
    console.log("✓ pmo_projects.project_type ensured (default 'vendor').");

    // 2) pmo_stage_slas table
    await client.query(
      `CREATE TABLE IF NOT EXISTS pmo_stage_slas (
         id          serial PRIMARY KEY,
         stage       text NOT NULL UNIQUE,
         target_days integer NOT NULL,
         is_active   boolean NOT NULL DEFAULT true,
         created_at  timestamptz NOT NULL DEFAULT now(),
         updated_at  timestamptz NOT NULL DEFAULT now()
       )`,
    );
    console.log("✓ pmo_stage_slas table ensured.");

    // 3) Seed defaults (idempotent)
    let seeded = 0;
    for (const [stage, targetDays] of STAGE_SLA_DEFAULTS) {
      const r = await client.query(
        `INSERT INTO pmo_stage_slas (stage, target_days)
           VALUES ($1, $2)
           ON CONFLICT (stage) DO NOTHING`,
        [stage, targetDays],
      );
      if (r.rowCount) {
        seeded++;
        console.log(`  seeded ${stage} → ${targetDays}d`);
      }
    }
    console.log(`\nSeeded ${seeded} stage SLA row(s) (existing rows left untouched).\n`);

    // Verify
    const { rows: slaRows } = await client.query<{ n: string }>(
      "SELECT COUNT(*)::text n FROM pmo_stage_slas",
    );
    console.log(`pmo_stage_slas now has ${slaRows[0]?.n ?? "?"} row(s).`);

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
