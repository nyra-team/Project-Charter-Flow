/**
 * Work Breakdown Structure — data migration.
 *
 * Makes the live data express the hierarchy Stage → Milestone → Task → Subtask,
 * preserving every existing row:
 *   1) Backfill pmo_milestones.stage (null only) from the milestone NAME via an
 *      ordered name→stage dictionary. Unmatched stay null → "Unassigned Stage".
 *   2) Home orphan tasks: per open project with milestone-less tasks, ensure an
 *      "Unscheduled" milestone exists and move those tasks into it.
 *   3) Backfill pmo_tasks.stage (null only) = the task's milestone's stage.
 *
 * Raw SQL (NOT drizzle-kit push). DDL/DML is transactional, so dry run rolls back.
 * SAFE BY DEFAULT: dry run (prints plan, rolls back) unless you pass `--commit`.
 * Idempotent: re-running only touches still-null rows / still-orphan tasks.
 *
 * Run:
 *   cd apps/pmo; set -a; source .env; set +a
 *   pnpm --filter @workspace/scripts exec tsx ./src/migrate-wbs.ts            # dry run
 *   pnpm --filter @workspace/scripts exec tsx ./src/migrate-wbs.ts --commit   # apply
 */
import { pool } from "@workspace/db";

// Inlined name→stage classifier (mirror of api-server/src/lib/gate-milestones.ts
// milestoneStageFromName — kept in sync). Ordered specific→general; first hit wins.
const GATE_EXACT: Record<string, string> = {
  "bc approved": "initiation",
  "urs approved": "initiation",
  "ia approved": "investment_authorization",
  "contract signed": "contract_po",
  "uat sign-off": "uat",
  "go live": "go_live",
  "closure": "closure",
};
const STAGE_PATTERNS: Array<[string[], string]> = [
  [["user requirement", "urs", "business case", "brd", "bc approved"], "initiation"],
  [["rfp", "request for proposal", "vendor demo", "vendor short", "vendor eval", "vendor selection",
    "commercial negotiation", "negotiation", "comparison matrix", "functional assessment",
    "technical assessment", "functional evaluation", "technical evaluation", "proposal", "evaluation"], "vendor_selection"],
  [["charter", "note for approval", "nfa", "investment", "budget approval", "ia approved"], "investment_authorization"],
  [["po release", "purchase order", "p.o", "contract", "legal", "pr release", "agreement"], "contract_po"],
  [["technical design", "functional design", "business blue print", "business blueprint", "bbp",
    "architecture", "kickoff", "kick off", "design"], "design"],
  [["unit testing", "development", "build", "implementation", "configuration", "coding"], "build"],
  [["uat", "user acceptance", "sit", "system integration test"], "uat"],
  [["go live", "go-live", "golive", "deployment", "cutover", "training", "rollout"], "go_live"],
  [["closure", "csat", "handover", "hand over", "lessons", "project close", "sign off", "sign-off"], "closure"],
];
function stageFromName(name: string): string | null {
  const n = name.trim().toLowerCase();
  if (GATE_EXACT[n]) return GATE_EXACT[n];
  for (const [patterns, stage] of STAGE_PATTERNS) if (patterns.some((p) => n.includes(p))) return stage;
  return null;
}

async function migrate(commit: boolean) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1) Backfill milestone.stage from name (null only).
    const { rows: msRows } = await client.query<{ id: number; name: string }>(
      "SELECT id, name FROM pmo_milestones WHERE stage IS NULL",
    );
    const byStage: Record<string, number> = {};
    let staged = 0, unassigned = 0;
    for (const m of msRows) {
      const stage = stageFromName(m.name);
      if (stage) {
        await client.query("UPDATE pmo_milestones SET stage = $1 WHERE id = $2", [stage, m.id]);
        byStage[stage] = (byStage[stage] ?? 0) + 1;
        staged++;
      } else {
        unassigned++;
      }
    }
    console.log(`\n[1] Milestones: ${staged} staged, ${unassigned} left Unassigned (of ${msRows.length} null-stage).`);
    for (const [s, c] of Object.entries(byStage).sort((a, b) => b[1] - a[1])) console.log(`      ${s}: ${c}`);

    // 2) Home orphan tasks under a per-project "Unscheduled" milestone.
    const { rows: orphanProjects } = await client.query<{ project_id: number }>(
      `SELECT DISTINCT t.project_id
         FROM pmo_tasks t
         JOIN pmo_projects p ON p.id = t.project_id
        WHERE t.milestone_id IS NULL AND p.status <> 'closed'`,
    );
    let projectsTouched = 0, tasksRehomed = 0, unscheduledCreated = 0;
    for (const { project_id } of orphanProjects) {
      let [{ id: msId } = { id: undefined }] = (await client.query<{ id: number }>(
        "SELECT id FROM pmo_milestones WHERE project_id = $1 AND lower(name) = 'unscheduled' LIMIT 1",
        [project_id],
      )).rows;
      if (!msId) {
        const ins = await client.query<{ id: number }>(
          `INSERT INTO pmo_milestones (project_id, name, stage, "order")
             VALUES ($1, 'Unscheduled', NULL, 9999) RETURNING id`,
          [project_id],
        );
        msId = ins.rows[0].id;
        unscheduledCreated++;
      }
      const upd = await client.query(
        "UPDATE pmo_tasks SET milestone_id = $1 WHERE project_id = $2 AND milestone_id IS NULL",
        [msId, project_id],
      );
      tasksRehomed += upd.rowCount ?? 0;
      projectsTouched++;
    }
    console.log(`\n[2] Orphan tasks: ${tasksRehomed} rehomed across ${projectsTouched} project(s); ${unscheduledCreated} 'Unscheduled' milestone(s) created.`);

    // 3) Backfill task.stage from the (now-assigned) milestone (null only).
    const taskStage = await client.query(
      `UPDATE pmo_tasks t SET stage = m.stage
         FROM pmo_milestones m
        WHERE t.milestone_id = m.id AND t.stage IS NULL AND m.stage IS NOT NULL`,
    );
    console.log(`\n[3] Tasks staged from milestone: ${taskStage.rowCount ?? 0}.`);

    // Verify
    const { rows: post } = await client.query<{ metric: string; n: string }>(
      `SELECT 'milestones still null-stage' metric, count(*)::text n FROM pmo_milestones WHERE stage IS NULL
       UNION ALL SELECT 'tasks still milestone-less', count(*)::text FROM pmo_tasks t JOIN pmo_projects p ON p.id=t.project_id WHERE t.milestone_id IS NULL AND p.status<>'closed'
       UNION ALL SELECT 'tasks still null-stage', count(*)::text FROM pmo_tasks WHERE stage IS NULL`,
    );
    console.log("\nPost-state:");
    for (const r of post) console.log(`      ${r.metric}: ${r.n}`);

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
