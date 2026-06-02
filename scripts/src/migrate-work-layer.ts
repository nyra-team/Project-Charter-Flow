/**
 * Work-Management Layer — schema migration.
 *
 * Adds the columns the Monday-style task/milestone layer needs to map onto the
 * lifecycle, all ADDITIVE and idempotent:
 *   1) pmo_milestones.stage     (text, nullable) — lifecycle stage the milestone gates
 *   2) pmo_tasks.stage          (text, nullable) — lifecycle stage the task belongs to
 *   3) pmo_tasks.progress_pct   (integer NOT NULL default 0) — per-task completion %
 *
 * Raw DDL (NOT drizzle-kit push — a footgun on the shared Recruit DB). DDL is
 * transactional in Postgres, so the dry run rolls back cleanly.
 *
 * SAFE BY DEFAULT: dry run (prints plan, rolls back) unless you pass `--commit`.
 * Idempotent — re-running is a no-op (ADD COLUMN IF NOT EXISTS).
 *
 * Run:
 *   cd apps/pmo
 *   set -a; source .env; set +a
 *   pnpm --filter @workspace/scripts exec tsx ./src/migrate-work-layer.ts            # dry run
 *   pnpm --filter @workspace/scripts exec tsx ./src/migrate-work-layer.ts --commit   # apply
 */
import { pool } from "@workspace/db";

async function migrate(commit: boolean) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`ALTER TABLE pmo_milestones ADD COLUMN IF NOT EXISTS stage text`);
    console.log("✓ pmo_milestones.stage ensured.");

    await client.query(`ALTER TABLE pmo_tasks ADD COLUMN IF NOT EXISTS stage text`);
    console.log("✓ pmo_tasks.stage ensured.");

    await client.query(
      `ALTER TABLE pmo_tasks ADD COLUMN IF NOT EXISTS progress_pct integer NOT NULL DEFAULT 0`,
    );
    console.log("✓ pmo_tasks.progress_pct ensured (default 0).");

    // Verify the columns now exist.
    const { rows } = await client.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE (table_name = 'pmo_tasks' AND column_name IN ('stage','progress_pct'))
           OR (table_name = 'pmo_milestones' AND column_name = 'stage')
        ORDER BY table_name, column_name`,
    );
    console.log("\nColumns present:");
    for (const r of rows) console.log(`  ${r.table_name}.${r.column_name}`);

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
