import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { db, doaMatrixTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { matchBand } from "../lib/doa-resolver";
import { requireRole } from "../lib/guard";

const router: IRouter = Router();

// ─── Validation ──────────────────────────────────────────────────────────────

const BandBody = z.object({
  entity: z.string().default("*"),
  category: z.string().default("*"),
  kind: z.string().default("*"),
  minInr: z.coerce.number().min(0).default(0),
  maxInr: z.coerce.number().min(0).nullable().optional(),
  approverRoles: z.array(z.string()).default([]),
  active: z.boolean().default(true),
  label: z.string().default(""),
  notes: z.string().default(""),
});

const UpdateBandBody = BandBody.partial();

const PreviewQuery = z.object({
  entity: z.string().optional(),
  category: z.string().optional(),
  kind: z.string().optional(),
  amount: z.coerce.number().min(0),
});

// ─── List ────────────────────────────────────────────────────────────────────
router.get("/doa-matrix", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(doaMatrixTable)
    .orderBy(asc(doaMatrixTable.entity), asc(doaMatrixTable.category), asc(doaMatrixTable.kind), asc(doaMatrixTable.minInr));
  res.json(rows);
});

// ─── Preview — resolve a chain without persisting ────────────────────────────
router.get("/doa-matrix/preview", async (req, res): Promise<void> => {
  const parsed = PreviewQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const match = await matchBand({
    entity: parsed.data.entity ?? "",
    category: parsed.data.category ?? "",
    kind: parsed.data.kind ?? "",
    amountInr: parsed.data.amount,
  });
  if (!match) {
    res.json({ matched: false, approverRoles: [], reason: "No active DOA band covers this amount + context." });
    return;
  }
  res.json({
    matched: true,
    bandId: match.bandId,
    label: match.label,
    approverRoles: match.approverRoles,
    specificity: match.specificity,
  });
});

// ─── Create ──────────────────────────────────────────────────────────────────
router.post("/doa-matrix", requireRole("pmo"), async (req, res): Promise<void> => {
  const parsed = BandBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (parsed.data.maxInr != null && parsed.data.maxInr <= parsed.data.minInr) {
    res.status(422).json({ error: "maxInr must be greater than minInr (or null for unbounded)." });
    return;
  }
  const [row] = await db.insert(doaMatrixTable).values({
    entity: parsed.data.entity,
    category: parsed.data.category,
    kind: parsed.data.kind,
    minInr: String(parsed.data.minInr),
    maxInr: parsed.data.maxInr != null ? String(parsed.data.maxInr) : null,
    approverRoles: parsed.data.approverRoles,
    active: parsed.data.active,
    label: parsed.data.label,
    notes: parsed.data.notes,
  }).returning();
  res.status(201).json(row);
});

// ─── Update ──────────────────────────────────────────────────────────────────
router.patch("/doa-matrix/:id", requireRole("pmo"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = UpdateBandBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const patch: Record<string, unknown> = { ...parsed.data };
  if (patch.minInr != null) patch.minInr = String(patch.minInr);
  if (patch.maxInr != null) patch.maxInr = String(patch.maxInr);
  // explicit null for maxInr clears the upper bound
  if (parsed.data.maxInr === null) patch.maxInr = null;

  const [row] = await db.update(doaMatrixTable).set(patch).where(eq(doaMatrixTable.id, id)).returning();
  if (!row) {
    res.status(404).json({ error: "Band not found" });
    return;
  }
  res.json(row);
});

// ─── Delete ──────────────────────────────────────────────────────────────────
router.delete("/doa-matrix/:id", requireRole("pmo"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [row] = await db.delete(doaMatrixTable).where(eq(doaMatrixTable.id, id)).returning();
  if (!row) {
    res.status(404).json({ error: "Band not found" });
    return;
  }
  res.json({ ok: true });
});

export default router;
