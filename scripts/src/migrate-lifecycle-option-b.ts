/**
 * Lifecycle Option B (Moderate) data migration — 16 stages → 9.
 *
 * Remaps `pmo_projects.stage` and `pmo_project_stages.stage` from the old
 * 16-stage keys to the new 9 merged keys, CONSOLIDATING the multiple
 * project_stages rows that collapse onto a single new key (e.g. project_case +
 * urs → initiation) into ONE row whose `notes` is the deep-merge of the
 * constituents' notes (so the Business Case form data AND the URS dual-approval
 * flags survive on the same record the merged section components now read).
 *
 * SAFE BY DEFAULT: runs as a DRY RUN (prints the plan, rolls back) unless you
 * pass `--commit`. Idempotent — re-running after a successful commit is a no-op
 * because every stage value is already a new key.
 *
 * Run:
 *   cd apps/pmo
 *   set -a; source .env; set +a            # exports DATABASE_URL
 *   pnpm --filter @workspace/scripts exec tsx ./src/migrate-lifecycle-option-b.ts            # dry run
 *   pnpm --filter @workspace/scripts exec tsx ./src/migrate-lifecycle-option-b.ts --commit   # apply
 *
 * ALWAYS run the dry run first, and ideally against a copy of the DB, before
 * committing against production.
 */
import { pool } from "@workspace/db";

// old stage key → new merged key
const MAP: Record<string, string> = {
  project_case: "initiation",
  urs: "initiation",
  rfp: "vendor_selection",
  vendor_evaluation: "vendor_selection",
  charter: "investment_authorization",
  nfa: "investment_authorization",
  legal: "contract_po",
  pr_po: "contract_po",
  kickoff: "design",
  technical_design: "design",
  development: "build",
  implementation_plan: "build",
  uat: "uat",
  go_live: "go_live",
  closure_readiness: "closure",
  project_closure: "closure",
};

// Order the constituents merge in (earlier = base for note merging).
const OLD_ORDER = [
  "project_case", "urs", "rfp", "vendor_evaluation", "charter", "nfa",
  "legal", "pr_po", "kickoff", "technical_design", "development",
  "implementation_plan", "uat", "go_live", "closure_readiness", "project_closure",
];

const NEW_ORDER = [
  "initiation", "vendor_selection", "investment_authorization", "contract_po",
  "design", "build", "uat", "go_live", "closure",
];

const toNew = (oldKey: string): string => MAP[oldKey] ?? oldKey;

type StageRow = {
  id: number;
  project_id: number;
  stage: string;
  status: string;
  entered_at: string | null;
  completed_at: string | null;
  notes: string | null;
};

/** Deep-merge a set of notes JSON strings; __checklist sub-maps are unioned. */
function mergeNotes(noteStrings: (string | null)[]): string {
  const out: Record<string, unknown> = {};
  for (const s of noteStrings) {
    let obj: Record<string, unknown>;
    try { obj = s ? (JSON.parse(s) as Record<string, unknown>) : {}; }
    catch { obj = {}; }
    for (const [k, v] of Object.entries(obj)) {
      const existing = out[k];
      if (k === "__checklist" && existing && typeof existing === "object" && v && typeof v === "object") {
        out[k] = { ...(existing as object), ...(v as object) };
      } else if (existing === undefined || existing === null || existing === "") {
        out[k] = v;
      } else if (v && typeof v === "object" && !Array.isArray(v) && typeof existing === "object" && !Array.isArray(existing)) {
        out[k] = { ...(existing as object), ...(v as object) };
      }
      // otherwise keep the earlier constituent's value
    }
  }
  return JSON.stringify(out);
}

async function migrate(commit: boolean) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: projects } = await client.query<{ id: number; stage: string }>(
      "SELECT id, stage FROM pmo_projects",
    );
    const { rows: stageRows } = await client.query<StageRow>(
      "SELECT id, project_id, stage, status, entered_at, completed_at, notes FROM pmo_project_stages",
    );

    console.log(`Loaded ${projects.length} projects and ${stageRows.length} project_stages rows.\n`);

    // 1) Remap pmo_projects.stage
    let projectsUpdated = 0;
    for (const p of projects) {
      const next = toNew(p.stage);
      if (next !== p.stage) {
        await client.query("UPDATE pmo_projects SET stage = $1, updated_at = NOW() WHERE id = $2", [next, p.id]);
        projectsUpdated++;
        console.log(`  project ${p.id}: stage ${p.stage} → ${next}`);
      }
    }
    console.log(`\nRemapped current stage on ${projectsUpdated} project(s).\n`);

    // 2) Consolidate pmo_project_stages per project, per new key
    const projStageById = new Map(projects.map((p) => [p.id, toNew(p.stage)]));
    const byProject = new Map<number, StageRow[]>();
    for (const r of stageRows) {
      if (!byProject.has(r.project_id)) byProject.set(r.project_id, []);
      byProject.get(r.project_id)!.push(r);
    }

    let rowsUpdated = 0;
    let rowsDeleted = 0;
    for (const [projectId, rows] of byProject) {
      const projNewStage = projStageById.get(projectId) ?? "initiation";
      const projIdx = NEW_ORDER.indexOf(projNewStage);

      // group rows by new key
      const groups = new Map<string, StageRow[]>();
      for (const r of rows) {
        const nk = toNew(r.stage);
        if (!groups.has(nk)) groups.set(nk, []);
        groups.get(nk)!.push(r);
      }

      for (const [newKey, groupRows] of groups) {
        // deterministic merge order by the old stage order
        groupRows.sort((a, b) => OLD_ORDER.indexOf(a.stage) - OLD_ORDER.indexOf(b.stage));
        const keyIdx = NEW_ORDER.indexOf(newKey);

        // status derived from position relative to the project's current stage
        const status = keyIdx < projIdx ? "complete" : keyIdx === projIdx ? "in_progress" : "not_started";

        const mergedNotes = mergeNotes(groupRows.map((r) => r.notes));
        const enteredCandidates = groupRows.map((r) => r.entered_at).filter(Boolean) as string[];
        const enteredAt = enteredCandidates.length
          ? enteredCandidates.sort()[0] // earliest
          : null;
        const completedCandidates = groupRows.map((r) => r.completed_at).filter(Boolean) as string[];
        const completedAt = status === "complete"
          ? (completedCandidates.length ? completedCandidates.sort().reverse()[0] : null)
          : null;

        const keep = groupRows[0];
        const drop = groupRows.slice(1);

        await client.query(
          "UPDATE pmo_project_stages SET stage = $1, status = $2, notes = $3, entered_at = $4, completed_at = $5 WHERE id = $6",
          [newKey, status, mergedNotes, enteredAt, completedAt, keep.id],
        );
        rowsUpdated++;

        if (drop.length) {
          await client.query(
            `DELETE FROM pmo_project_stages WHERE id = ANY($1::int[])`,
            [drop.map((r) => r.id)],
          );
          rowsDeleted += drop.length;
          console.log(`  project ${projectId} ${newKey}: merged ${groupRows.length} rows (${groupRows.map((r) => r.stage).join(" + ")}) → status=${status}, dropped ${drop.length}`);
        }
      }
    }
    console.log(`\nConsolidated project_stages: ${rowsUpdated} row(s) kept/updated, ${rowsDeleted} row(s) deleted.\n`);

    // 3) Verify no stale keys remain
    const { rows: badProjects } = await client.query<{ stage: string; n: string }>(
      `SELECT stage, COUNT(*)::text n FROM pmo_projects WHERE stage <> ALL($1::text[]) GROUP BY stage`,
      [NEW_ORDER],
    );
    const { rows: badStages } = await client.query<{ stage: string; n: string }>(
      `SELECT stage, COUNT(*)::text n FROM pmo_project_stages WHERE stage <> ALL($1::text[]) GROUP BY stage`,
      [NEW_ORDER],
    );
    if (badProjects.length || badStages.length) {
      console.error("⚠️  Unexpected stage keys remain after migration:");
      badProjects.forEach((r) => console.error(`   pmo_projects.stage="${r.stage}" × ${r.n}`));
      badStages.forEach((r) => console.error(`   pmo_project_stages.stage="${r.stage}" × ${r.n}`));
      throw new Error("Stale stage keys detected — rolling back.");
    }
    console.log("✓ All stage values are valid Option-B keys.");

    if (commit) {
      await client.query("COMMIT");
      console.log("\n✅ COMMITTED.");
    } else {
      await client.query("ROLLBACK");
      console.log("\n🧪 DRY RUN — rolled back. Re-run with --commit to apply.");
    }
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("\n❌ Rolled back due to error:", err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

const commit = process.argv.includes("--commit");
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Run: set -a; source .env; set +a");
  process.exit(1);
}
migrate(commit);
