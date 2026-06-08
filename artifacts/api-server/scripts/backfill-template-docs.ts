/**
 * One-time backfill: attach the 11 universal deliverable templates to every
 * EXISTING project. Idempotent (skips templates already present), so it is safe
 * to re-run. New projects are seeded automatically at creation.
 *
 * Run from apps/pmo/artifacts/api-server with DATABASE_URL in env, e.g.:
 *   set -a && . ../../.env && set +a && \
 *   ../../scripts/node_modules/.bin/tsx scripts/backfill-template-docs.ts
 */
import { db, pool, projectsTable } from "@workspace/db";
import { seedProjectTemplateDocuments } from "../src/lib/templateDocuments";

async function main(): Promise<void> {
  const projects = await db.select({ id: projectsTable.id, name: projectsTable.name }).from(projectsTable);
  let totalDocs = 0;
  for (const p of projects) {
    const created = await seedProjectTemplateDocuments(p.id, null);
    totalDocs += created;
    if (created > 0) console.log(`  project ${p.id} (${p.name}): +${created} template docs`);
  }
  console.log(`\nDone — ${projects.length} projects scanned, ${totalDocs} template docs created.`);
  await pool.end();
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
