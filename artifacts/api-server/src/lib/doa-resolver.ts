import { db, doaMatrixTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * Resolve the approver chain for a Charter+NFA based on the DOA matrix.
 *
 * Pick rules (most-specific match wins):
 *   1. Filter pmo_doa_matrix rows where active=true and the amount falls in
 *      [min_inr, max_inr) and entity/category/kind either match exactly or
 *      are the "*" wildcard.
 *   2. Score each surviving row: entity exact = +4, category exact = +2,
 *      kind exact = +1.  Higher specificity wins.
 *   3. Ties are broken by tighter (max_inr − min_inr) range, then by id ASC.
 *
 * Returns the ordered list of role strings (e.g. ["hod","cfo","executive_director","chairman"]).
 * Empty array means no matching band — caller should treat this as a config error.
 */
export type DoaContext = {
  entity?: string | null;
  category?: string | null;
  kind?: string | null;
  amountInr: number;
};

export type DoaMatchDetail = {
  bandId: number;
  label: string;
  approverRoles: string[];
  specificity: number;
};

export async function resolveApproverChain(ctx: DoaContext): Promise<string[]> {
  const match = await matchBand(ctx);
  return match?.approverRoles ?? [];
}

export async function matchBand(ctx: DoaContext): Promise<DoaMatchDetail | null> {
  const rows = await db.select().from(doaMatrixTable).where(eq(doaMatrixTable.active, true));
  const entity = (ctx.entity ?? "").trim();
  const category = (ctx.category ?? "").trim();
  const kind = (ctx.kind ?? "").trim();
  const amount = ctx.amountInr;

  type Candidate = {
    row: typeof rows[number];
    specificity: number;
    rangeWidth: number;
  };
  const candidates: Candidate[] = [];

  for (const row of rows) {
    const min = Number(row.minInr ?? 0);
    const max = row.maxInr == null ? Number.POSITIVE_INFINITY : Number(row.maxInr);
    if (amount < min) continue;
    if (amount >= max) continue;

    const entityOk = row.entity === "*" || row.entity === entity;
    const categoryOk = row.category === "*" || row.category === category;
    const kindOk = row.kind === "*" || row.kind === kind;
    if (!entityOk || !categoryOk || !kindOk) continue;

    let spec = 0;
    if (row.entity !== "*") spec += 4;
    if (row.category !== "*") spec += 2;
    if (row.kind !== "*") spec += 1;

    candidates.push({
      row,
      specificity: spec,
      rangeWidth: max === Number.POSITIVE_INFINITY ? Number.MAX_SAFE_INTEGER : max - min,
    });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) =>
    b.specificity - a.specificity ||
    a.rangeWidth - b.rangeWidth ||
    a.row.id - b.row.id
  );

  const winner = candidates[0];
  const roles = Array.isArray(winner.row.approverRoles) ? winner.row.approverRoles as string[] : [];
  return {
    bandId: winner.row.id,
    label: winner.row.label || `Band #${winner.row.id}`,
    approverRoles: roles,
    specificity: winner.specificity,
  };
}
