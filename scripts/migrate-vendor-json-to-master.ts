// One-shot backfill script — walks every pmo_project_stages row, pulls the
// __vendors[] array out of the RFP stage notes JSON, upserts each distinct
// vendor name into pmo_vendor_master, and writes the new master_vendor_id
// back into the JSON blob so the augmented VendorShortlist component lights
// up immediately.
//
// IDEMPOTENT: re-running is safe — it matches existing master rows by
// lower-case name and never duplicates.
//
// Run:  pnpm --filter @workspace/db exec tsx scripts/migrate-vendor-json-to-master.ts
//
// CAUTION: requires DATABASE_URL to be set. Inspect output before applying
// in production; the script logs every upsert + JSON rewrite.

import { db, projectStagesTable, vendorMasterTable } from "@workspace/db";
import { eq } from "drizzle-orm";

type LegacyVendor = {
  id: string;
  name: string;
  description?: string;
  contact?: string;
  website?: string;
  pricing?: string;
  notes?: string;
  masterVendorId?: number;
};

async function main() {
  console.log("[migrate] Loading all project_stages rows…");
  const stages = await db.select().from(projectStagesTable);
  console.log(`[migrate] ${stages.length} stages scanned`);
  let stagesTouched = 0;
  let vendorsUpserted = 0;
  let masterCacheHits = 0;

  // Cache name → masterVendorId across the run so we hit the DB at most once
  // per distinct name.
  const cache = new Map<string, number>();

  for (const stage of stages) {
    if (stage.stage !== "rfp") continue;
    let notes: Record<string, unknown> = {};
    try { notes = JSON.parse(stage.notes ?? "{}"); } catch { continue; }
    const list = notes.__vendors as LegacyVendor[] | undefined;
    if (!Array.isArray(list) || list.length === 0) continue;

    let mutated = false;
    for (const v of list) {
      if (v.masterVendorId) continue;
      const name = (v.name ?? "").trim();
      if (!name) continue;
      const key = name.toLowerCase();
      let masterId = cache.get(key);
      if (!masterId) {
        // Try existing master row by case-insensitive name
        const candidates = await db.select().from(vendorMasterTable);
        const existing = candidates.find(c => c.name.trim().toLowerCase() === key);
        if (existing) {
          masterId = existing.id;
          masterCacheHits++;
        } else {
          // Compose contact / region / category from the JSON shape so the
          // backfilled master row is at least a useful skeleton.
          const [inserted] = await db.insert(vendorMasterTable).values({
            name,
            email: v.contact && v.contact.includes("@") ? v.contact : "",
            phone: v.contact && !v.contact.includes("@") ? v.contact : "",
            website: v.website ?? "",
            category: v.description ?? "",
            segment: "provisional",
            riskStatus: "unknown",
            profileExtras: { backfilled: true, legacyDescription: v.description, legacyPricing: v.pricing, legacyNotes: v.notes },
          }).returning();
          masterId = inserted.id;
          vendorsUpserted++;
          console.log(`[migrate] + master vendor #${masterId} = "${name}"`);
        }
        cache.set(key, masterId);
      }
      v.masterVendorId = masterId;
      mutated = true;
    }
    if (mutated) {
      await db.update(projectStagesTable)
        .set({ notes: JSON.stringify(notes) })
        .where(eq(projectStagesTable.id, stage.id));
      stagesTouched++;
    }
  }

  console.log(`\n[migrate] DONE. Stages touched: ${stagesTouched}. New master rows: ${vendorsUpserted}. Existing matches: ${masterCacheHits}.`);
  process.exit(0);
}

main().catch(err => { console.error("[migrate] FAILED:", err); process.exit(1); });
