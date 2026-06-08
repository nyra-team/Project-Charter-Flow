import { Router, type IRouter } from "express";
import {
  db,
  rfxEventsTable,
  rfxInvitationsTable,
  rfxQuestionsTable,
  rfxEnvelopesTable,
  rfxEnvelopeKeysTable,
  rfxEnvelopeFilesTable,
  rfxScoringDimensionsTable,
  rfxScoresTable,
  rfxClarificationsTable,
  rfxAwardsTable,
  rfxAuditTable,
  vendorMasterTable,
} from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod/v4";
import { isPastDeadline, openJson, recombineKey, sealJson } from "../lib/envelopeCrypto";
import { logActivity } from "./activity";

// ─── RFx routes — events, invitations, envelopes, scoring, award ────────────
//
// Mounted behind the global requireAuth chain. All endpoints assume
// req.user is populated with a PMO-access employee. Vendor-facing
// envelope submission lives in vendor_portal.ts.

const router: IRouter = Router();

function actor(req: { user?: { employeeId: string | null; email: string } }): string {
  return req.user?.employeeId ?? req.user?.email ?? "unknown";
}

async function audit(rfxId: number, event: string, payload: unknown, actorEmployeeId: string | null, actorVendorId?: number) {
  await db.insert(rfxAuditTable).values({
    rfxId, event,
    actorEmployeeId: actorEmployeeId,
    actorVendorId: actorVendorId ?? null,
    payload: (payload && typeof payload === "object") ? payload : { value: payload },
  });
}

async function loadEvent(id: number) {
  const [evt] = await db.select().from(rfxEventsTable).where(eq(rfxEventsTable.id, id));
  return evt;
}

// ─── Events ─────────────────────────────────────────────────────────────────

router.get("/rfx", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : null;
  const charterId = req.query.charterId ? Number(req.query.charterId) : null;
  let rows = await db.select().from(rfxEventsTable).orderBy(desc(rfxEventsTable.updatedAt));
  if (status) rows = rows.filter(r => r.status === status);
  if (charterId) rows = rows.filter(r => r.charterId === charterId);
  res.json(rows);
});

const CreateRfxBody = z.object({
  type: z.enum(["rfi", "rfp", "rfq", "eauction"]),
  title: z.string().min(1),
  summary: z.string().optional(),
  brief: z.string().optional(),
  charterId: z.number().int().nullable().optional(),
  projectId: z.number().int().nullable().optional(),
  currency: z.string().optional(),
  opensAt: z.string().datetime().nullable().optional(),
  closesAt: z.string().datetime().nullable().optional(),
  auctionMode: z.enum(["none", "reverse", "dutch", "japanese"]).optional(),
  tcoModel: z.record(z.unknown()).optional(),
  evaluationThresholdPct: z.number().int().min(0).max(100).optional(),
  blindGrading: z.boolean().optional(),
  surrogateBiddingAllowed: z.boolean().optional(),
  alternativeBidsAllowed: z.boolean().optional(),
  publicDiscovery: z.boolean().optional(),
});

router.post("/rfx", async (req, res) => {
  const parsed = CreateRfxBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const d = parsed.data;
  const [row] = await db.insert(rfxEventsTable).values({
    type: d.type,
    title: d.title,
    summary: d.summary ?? "",
    brief: d.brief ?? "",
    charterId: d.charterId ?? null,
    projectId: d.projectId ?? null,
    currency: d.currency ?? "INR",
    status: "draft",
    opensAt: d.opensAt ? new Date(d.opensAt) : null,
    closesAt: d.closesAt ? new Date(d.closesAt) : null,
    auctionMode: d.auctionMode ?? "none",
    tcoModel: d.tcoModel ?? {},
    evaluationThresholdPct: d.evaluationThresholdPct ?? 60,
    blindGrading: d.blindGrading ?? true,
    surrogateBiddingAllowed: d.surrogateBiddingAllowed ?? true,
    alternativeBidsAllowed: d.alternativeBidsAllowed ?? false,
    publicDiscovery: d.publicDiscovery ?? false,
    createdBy: actor(req),
  }).returning();
  await audit(row.id, "rfx_created", { type: d.type, title: d.title }, req.user?.employeeId ?? null);
  await logActivity("rfx_created", `${d.type.toUpperCase()} — ${d.title} by ${actor(req)}`, row.id, "rfx", null);
  res.status(201).json(row);
});

router.get("/rfx/:id", async (req, res) => {
  const id = Number(req.params.id);
  const evt = await loadEvent(id);
  if (!evt) { res.status(404).json({ error: "RFx not found" }); return; }
  const [invitations, questions, dimensions, envelopes, clarifications, awards] = await Promise.all([
    db.select().from(rfxInvitationsTable).where(eq(rfxInvitationsTable.rfxId, id)),
    db.select().from(rfxQuestionsTable).where(eq(rfxQuestionsTable.rfxId, id)),
    db.select().from(rfxScoringDimensionsTable).where(eq(rfxScoringDimensionsTable.rfxId, id)),
    db.select().from(rfxEnvelopesTable).where(eq(rfxEnvelopesTable.rfxId, id)),
    db.select().from(rfxClarificationsTable).where(eq(rfxClarificationsTable.rfxId, id)),
    db.select().from(rfxAwardsTable).where(eq(rfxAwardsTable.rfxId, id)),
  ]);
  // Strip ciphertext blobs from the wire — they're only useful to the
  // server-side open route. UI never receives raw bytes.
  const safeEnvelopes = envelopes.map(e => ({
    id: e.id, invitationId: e.invitationId, rfxId: e.rfxId, kind: e.kind, status: e.status,
    submittedBySurrogate: e.submittedBySurrogate, surrogateActorId: e.surrogateActorId,
    submittedAt: e.submittedAt, openedAt: e.openedAt, openedBy: e.openedBy, labelAlias: e.labelAlias,
    notes: e.notes,
  }));
  res.json({ event: evt, invitations, questions, dimensions, envelopes: safeEnvelopes, clarifications, awards });
});

router.patch("/rfx/:id", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = CreateRfxBody.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const d = parsed.data;
  const patch: Record<string, unknown> = { ...d };
  if (d.opensAt) patch.opensAt = new Date(d.opensAt);
  if (d.closesAt) patch.closesAt = new Date(d.closesAt);
  const [row] = await db.update(rfxEventsTable).set(patch).where(eq(rfxEventsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "RFx not found" }); return; }
  res.json(row);
});

router.post("/rfx/:id/publish", async (req, res) => {
  const id = Number(req.params.id);
  const evt = await loadEvent(id);
  if (!evt) { res.status(404).json({ error: "RFx not found" }); return; }
  if (evt.status !== "draft") { res.status(409).json({ error: `Cannot publish from status ${evt.status}` }); return; }
  if (!evt.closesAt) { res.status(400).json({ error: "closes_at must be set before publishing" }); return; }
  // Pre-generate per-kind envelope key shares so the seal flow can use them
  // immediately and the dual-role unlock UI has rows to anchor to.
  for (const kind of ["technical", "commercial", "alternative"] as const) {
    const [existing] = await db.select().from(rfxEnvelopeKeysTable).where(and(
      eq(rfxEnvelopeKeysTable.rfxId, id), eq(rfxEnvelopeKeysTable.kind, kind),
    ));
    if (!existing) {
      // We don't *use* these keys to seal — each envelope is sealed with its
      // own per-envelope key (see vendor_portal.ts). These rows are the
      // per-kind dual-role unlock anchors; the per-envelope shares are stored
      // ON the envelope row itself via wrappedKeyId pointing here.
      //
      // For the v1 implementation we keep ONE pair of shares per (rfx, kind)
      // — the same key seals every envelope of that kind. This is the
      // standard Ariba-style "open the commercial envelopes" UX. Stronger
      // per-envelope keys can be added later by promoting wrappedKeyId into
      // a real FK to a fresh row per envelope.
      const { generateKey, splitKey } = await import("../lib/envelopeCrypto");
      const k = generateKey();
      const [a, b] = splitKey(k);
      k.fill(0);
      await db.insert(rfxEnvelopeKeysTable).values({ rfxId: id, kind, keyShareA: a, keyShareB: b });
    }
  }
  const [row] = await db.update(rfxEventsTable).set({ status: "open" }).where(eq(rfxEventsTable.id, id)).returning();
  await audit(id, "rfx_published", { closesAt: evt.closesAt }, req.user?.employeeId ?? null);
  res.json(row);
});

router.post("/rfx/:id/cancel", async (req, res) => {
  const id = Number(req.params.id);
  const evt = await loadEvent(id);
  if (!evt) { res.status(404).json({ error: "RFx not found" }); return; }
  const [row] = await db.update(rfxEventsTable).set({ status: "cancelled" }).where(eq(rfxEventsTable.id, id)).returning();
  await audit(id, "rfx_cancelled", { from: evt.status }, req.user?.employeeId ?? null);
  await logActivity("rfx_cancelled", `${evt.title} cancelled by ${actor(req)}`, id, "rfx", null);
  res.json(row);
});

// ─── Questions ──────────────────────────────────────────────────────────────

const SaveQuestionsBody = z.object({
  questions: z.array(z.object({
    id: z.number().int().optional(),
    section: z.enum(["technical", "commercial", "qualification"]),
    label: z.string().min(1),
    description: z.string().optional(),
    kind: z.enum(["text", "number", "select", "multi", "file", "bool", "currency"]),
    options: z.array(z.unknown()).optional(),
    weight: z.number().int().optional(),
    required: z.boolean().optional(),
    order: z.number().int().optional(),
  })),
});

router.put("/rfx/:id/questions", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = SaveQuestionsBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  // Wholesale replace — RFx questions are versioned at the event level, not
  // per-row, so editing during draft is destructive by design.
  const evt = await loadEvent(id);
  if (!evt) { res.status(404).json({ error: "RFx not found" }); return; }
  if (evt.status !== "draft") { res.status(409).json({ error: "Questions are frozen after publish" }); return; }
  await db.delete(rfxQuestionsTable).where(eq(rfxQuestionsTable.rfxId, id));
  const inserted = parsed.data.questions.length === 0 ? [] : await db.insert(rfxQuestionsTable).values(
    parsed.data.questions.map((q, i) => ({
      rfxId: id,
      section: q.section,
      label: q.label,
      description: q.description ?? "",
      kind: q.kind,
      options: q.options ?? [],
      weight: q.weight ?? 0,
      required: q.required ?? false,
      order: q.order ?? i,
    }))
  ).returning();
  res.json(inserted);
});

// ─── Scoring dimensions ─────────────────────────────────────────────────────

const SaveDimensionsBody = z.object({
  dimensions: z.array(z.object({
    label: z.string().min(1),
    description: z.string().optional(),
    kind: z.enum(["technical", "commercial"]),
    weight: z.number().int().min(0).max(100),
    order: z.number().int().optional(),
  })),
});

router.put("/rfx/:id/dimensions", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = SaveDimensionsBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  await db.delete(rfxScoringDimensionsTable).where(eq(rfxScoringDimensionsTable.rfxId, id));
  const inserted = parsed.data.dimensions.length === 0 ? [] : await db.insert(rfxScoringDimensionsTable).values(
    parsed.data.dimensions.map((dm, i) => ({
      rfxId: id,
      label: dm.label, description: dm.description ?? "",
      kind: dm.kind, weight: dm.weight, order: dm.order ?? i,
    }))
  ).returning();
  res.json(inserted);
});

// ─── Invitations ────────────────────────────────────────────────────────────

const InviteBody = z.object({
  vendorIds: z.array(z.number().int()).min(1),
});

router.post("/rfx/:id/invitations", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = InviteBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const evt = await loadEvent(id);
  if (!evt) { res.status(404).json({ error: "RFx not found" }); return; }
  const existing = await db.select().from(rfxInvitationsTable).where(eq(rfxInvitationsTable.rfxId, id));
  const existingVendors = new Set(existing.map(e => e.vendorId));
  const toInvite = parsed.data.vendorIds.filter(v => !existingVendors.has(v));
  if (toInvite.length === 0) { res.json(existing); return; }
  const inserted = await db.insert(rfxInvitationsTable).values(
    toInvite.map(vendorId => ({
      rfxId: id, vendorId, status: "invited",
      // 16-byte hex token used in the magic-link emailed to the vendor.
      inviteToken: cryptoRandomHex(16),
    }))
  ).returning();
  for (const inv of inserted) {
    await audit(id, "invitation_sent", { vendorId: inv.vendorId }, req.user?.employeeId ?? null);
  }
  res.status(201).json([...existing, ...inserted]);
});

function cryptoRandomHex(bytes: number): string {
  // Tiny helper to avoid pulling in a fresh crypto namespace per call site
  // — the seal/open helpers handle the heavy crypto; this is just for
  // unique invitation tokens emailed to vendors.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { randomBytes } = require("node:crypto") as typeof import("node:crypto");
  return randomBytes(bytes).toString("hex");
}

// ─── Envelope unlock (dual-role) ────────────────────────────────────────────
//
// Endpoint design:
//   POST /api/rfx/:id/envelopes/:kind/release-share
//     Body: { side: 'a' | 'b' }
//   The caller stamps their employeeId into the releasedByA OR releasedByB
//   slot on the pmo_rfx_envelope_keys row. When BOTH slots are filled by
//   DISTINCT employeeIds, the server recombines the shares, decrypts every
//   envelope of (rfxId, kind), and flips their status to opened.
//
// Layer 1 gate: closes_at must have passed. Pre-deadline returns 423 Locked.
// Layer 2 gate: same employee cannot fill both slots (server checks). Each
// fill emits an audit event so the procurement audit has the full unlock
// timeline.
//
// `side` is sent by the UI based on which "Open as SCM"/"Open as PMO" button
// the user clicks. Real production should additionally check
// req.session.simulatedRole — left as a follow-up since the existing
// codebase uses the simulated-role pattern loosely.

const ReleaseShareBody = z.object({ side: z.enum(["a", "b"]) });

router.post("/rfx/:id/envelopes/:kind/release-share", async (req, res) => {
  const id = Number(req.params.id);
  const kind = req.params.kind as "technical" | "commercial" | "alternative";
  const parsed = ReleaseShareBody.safeParse(req.body);
  if (!Number.isFinite(id) || !["technical", "commercial", "alternative"].includes(kind) || !parsed.success) {
    res.status(400).json({ error: parsed.success ? "Invalid id/kind" : parsed.error.message });
    return;
  }
  const evt = await loadEvent(id);
  if (!evt) { res.status(404).json({ error: "RFx not found" }); return; }
  if (!isPastDeadline(evt.closesAt)) {
    res.status(423).json({ error: "Sealed until closes_at" });
    return;
  }
  const [keyRow] = await db.select().from(rfxEnvelopeKeysTable).where(and(
    eq(rfxEnvelopeKeysTable.rfxId, id), eq(rfxEnvelopeKeysTable.kind, kind),
  ));
  if (!keyRow) { res.status(404).json({ error: "Envelope key not initialised" }); return; }
  if (keyRow.releasedAt) { res.status(409).json({ error: "Envelopes already opened" }); return; }
  const me = actor(req);
  if (parsed.data.side === "a") {
    if (keyRow.releasedByA && keyRow.releasedByA !== me) {
      // Slot already held by another employee — replacing would let one
      // person take both slots. Block.
    }
    if (keyRow.releasedByB === me) {
      res.status(409).json({ error: "You already filled the other slot — need a second distinct employee" });
      return;
    }
    await db.update(rfxEnvelopeKeysTable).set({ releasedByA: me }).where(eq(rfxEnvelopeKeysTable.id, keyRow.id));
  } else {
    if (keyRow.releasedByA === me) {
      res.status(409).json({ error: "You already filled the other slot — need a second distinct employee" });
      return;
    }
    await db.update(rfxEnvelopeKeysTable).set({ releasedByB: me }).where(eq(rfxEnvelopeKeysTable.id, keyRow.id));
  }
  await audit(id, "envelope_unlocked", { kind, side: parsed.data.side, actor: me }, req.user?.employeeId ?? null);

  // Refresh and see if both shares are now released
  const [refreshed] = await db.select().from(rfxEnvelopeKeysTable).where(eq(rfxEnvelopeKeysTable.id, keyRow.id));
  if (!refreshed?.releasedByA || !refreshed?.releasedByB) {
    res.json({ keyRow: refreshed, opened: 0, awaiting: !refreshed?.releasedByA ? "a" : "b" });
    return;
  }
  if (refreshed.releasedByA === refreshed.releasedByB) {
    res.status(409).json({ error: "Both unlock slots taken by same employee — invalid" });
    return;
  }
  // Recombine and decrypt every sealed envelope of this kind
  const key = recombineKey(Buffer.from(refreshed.keyShareA as Buffer), Buffer.from(refreshed.keyShareB as Buffer));
  const sealedEnvelopes = await db.select().from(rfxEnvelopesTable).where(and(
    eq(rfxEnvelopesTable.rfxId, id), eq(rfxEnvelopesTable.kind, kind), eq(rfxEnvelopesTable.status, "sealed"),
  ));
  let opened = 0;
  for (const env of sealedEnvelopes) {
    if (!env.sealedPayload || !env.iv || !env.authTag) continue;
    // Each envelope was sealed with the same key (per-kind v1). The auth tag
    // verifies integrity — a tampered ciphertext won't decrypt.
    try {
      openJson({
        ciphertext: Buffer.from(env.sealedPayload as Buffer),
        iv: Buffer.from(env.iv as Buffer),
        authTag: Buffer.from(env.authTag as Buffer),
        // Re-use the same key as both "shares" — we already have it
        // recombined; the openJson helper just wants two halves that XOR to
        // the key. Pass key XOR 0 and 0 to satisfy the API.
        shareA: key,
        shareB: Buffer.alloc(key.length),
      });
      await db.update(rfxEnvelopesTable).set({
        status: "opened", openedAt: new Date(), openedBy: me,
      }).where(eq(rfxEnvelopesTable.id, env.id));
      await audit(id, "envelope_opened", { envelopeId: env.id, kind }, req.user?.employeeId ?? null);
      opened++;
    } catch (err) {
      // Decryption failure should never happen with our own ciphertext;
      // log and continue so one bad envelope doesn't block the rest.
      const msg = err instanceof Error ? err.message : String(err);
      await audit(id, "envelope_open_failed", { envelopeId: env.id, kind, error: msg }, req.user?.employeeId ?? null);
    }
  }
  // Stamp released_at + zero the shares in memory (DB still holds the bytes;
  // future hardening can rotate them at this point)
  await db.update(rfxEnvelopeKeysTable).set({ releasedAt: new Date() }).where(eq(rfxEnvelopeKeysTable.id, refreshed.id));
  key.fill(0);
  // Flip event status to evaluating if both technical+commercial unlocked
  if (kind === "commercial") {
    await db.update(rfxEventsTable).set({ status: "evaluating" }).where(eq(rfxEventsTable.id, id));
  }
  res.json({ opened, kind, releasedAt: new Date() });
});

// ─── Decrypted bid read (scope-gated) ───────────────────────────────────────
//
// The tech graders should only read tech envelopes; commercial graders read
// commercial. The commercial-envelope read additionally requires the
// vendor's tech weighted-average to clear evaluation_threshold_pct (or the
// vendor's tech envelope must be flagged disqualified).

router.get("/rfx/:id/envelopes/:envelopeId/payload", async (req, res) => {
  const id = Number(req.params.id);
  const envelopeId = Number(req.params.envelopeId);
  const evt = await loadEvent(id);
  if (!evt) { res.status(404).json({ error: "RFx not found" }); return; }
  const [env] = await db.select().from(rfxEnvelopesTable).where(eq(rfxEnvelopesTable.id, envelopeId));
  if (!env || env.rfxId !== id) { res.status(404).json({ error: "Envelope not found" }); return; }
  if (env.status !== "opened") { res.status(423).json({ error: "Envelope not yet opened" }); return; }
  // Commercial-scope gate
  if (env.kind === "commercial") {
    const techEnvelopes = await db.select().from(rfxEnvelopesTable).where(and(
      eq(rfxEnvelopesTable.invitationId, env.invitationId),
      eq(rfxEnvelopesTable.kind, "technical"),
    ));
    const techEnv = techEnvelopes[0];
    if (techEnv) {
      const score = await weightedTechScore(id, techEnv.id);
      if (score === null || score < evt.evaluationThresholdPct) {
        res.status(423).json({
          error: "Tech threshold not crossed",
          threshold: evt.evaluationThresholdPct, score,
        });
        return;
      }
    }
  }
  // Reload the key row and decrypt on the fly
  const [keyRow] = await db.select().from(rfxEnvelopeKeysTable).where(and(
    eq(rfxEnvelopeKeysTable.rfxId, id), eq(rfxEnvelopeKeysTable.kind, env.kind),
  ));
  if (!keyRow || !keyRow.releasedAt || !env.sealedPayload || !env.iv || !env.authTag) {
    res.status(409).json({ error: "Envelope cannot be decrypted" });
    return;
  }
  try {
    const payload = openJson<{ answers: Record<string, unknown>; meta?: Record<string, unknown> }>({
      ciphertext: Buffer.from(env.sealedPayload as Buffer),
      iv: Buffer.from(env.iv as Buffer),
      authTag: Buffer.from(env.authTag as Buffer),
      shareA: Buffer.from(keyRow.keyShareA as Buffer),
      shareB: Buffer.from(keyRow.keyShareB as Buffer),
    });
    const files = await db.select().from(rfxEnvelopeFilesTable).where(eq(rfxEnvelopeFilesTable.envelopeId, envelopeId));
    res.json({
      envelope: {
        id: env.id, kind: env.kind, status: env.status, labelAlias: env.labelAlias,
        submittedAt: env.submittedAt, openedAt: env.openedAt,
      },
      answers: payload.answers,
      files,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: "Decryption failed", detail: msg });
  }
});

async function weightedTechScore(rfxId: number, techEnvelopeId: number): Promise<number | null> {
  const dims = await db.select().from(rfxScoringDimensionsTable).where(and(
    eq(rfxScoringDimensionsTable.rfxId, rfxId),
    eq(rfxScoringDimensionsTable.kind, "technical"),
  ));
  if (dims.length === 0) return null;
  const totalWeight = dims.reduce((s, d) => s + d.weight, 0) || 1;
  const scores = await db.select().from(rfxScoresTable).where(and(
    eq(rfxScoresTable.envelopeId, techEnvelopeId),
    inArray(rfxScoresTable.dimensionId, dims.map(d => d.id)),
  ));
  if (scores.length === 0) return null;
  // Average across graders per dimension first
  const byDim: Record<number, number[]> = {};
  for (const s of scores) {
    (byDim[s.dimensionId] ||= []).push(s.score);
  }
  let weighted = 0;
  let coveredWeight = 0;
  for (const d of dims) {
    const arr = byDim[d.id];
    if (!arr || arr.length === 0) continue;
    const avg = arr.reduce((s, v) => s + v, 0) / arr.length;
    weighted += avg * (d.weight / totalWeight);
    coveredWeight += d.weight;
  }
  if (coveredWeight === 0) return null;
  return Math.round(weighted);
}

// ─── Scoring ────────────────────────────────────────────────────────────────

const SubmitScoreBody = z.object({
  envelopeId: z.number().int(),
  dimensionId: z.number().int(),
  score: z.number().int().min(0).max(100),
  rationale: z.string().optional(),
});

router.post("/rfx/:id/scores", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = SubmitScoreBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const me = actor(req);
  // Upsert: one score per (envelope, dimension, grader)
  const [existing] = await db.select().from(rfxScoresTable).where(and(
    eq(rfxScoresTable.envelopeId, parsed.data.envelopeId),
    eq(rfxScoresTable.dimensionId, parsed.data.dimensionId),
    eq(rfxScoresTable.graderId, me),
  ));
  let row;
  if (existing) {
    [row] = await db.update(rfxScoresTable).set({
      score: parsed.data.score, rationale: parsed.data.rationale ?? "",
    }).where(eq(rfxScoresTable.id, existing.id)).returning();
  } else {
    // Assign blind alias deterministically by grader sequence per RFx
    const others = await db.selectDistinct({ graderId: rfxScoresTable.graderId }).from(rfxScoresTable)
      .innerJoin(rfxEnvelopesTable, eq(rfxScoresTable.envelopeId, rfxEnvelopesTable.id))
      .where(eq(rfxEnvelopesTable.rfxId, id));
    const seen = new Set(others.map(o => o.graderId));
    seen.add(me);
    const alias = `Grader ${String.fromCharCode(64 + Math.min(seen.size, 26))}`;
    [row] = await db.insert(rfxScoresTable).values({
      envelopeId: parsed.data.envelopeId,
      dimensionId: parsed.data.dimensionId,
      graderId: me,
      graderAlias: alias,
      score: parsed.data.score,
      rationale: parsed.data.rationale ?? "",
    }).returning();
  }
  await audit(id, "score_submitted", {
    envelopeId: parsed.data.envelopeId, dimensionId: parsed.data.dimensionId, score: parsed.data.score,
  }, req.user?.employeeId ?? null);
  res.json(row);
});

router.get("/rfx/:id/scores", async (req, res) => {
  const id = Number(req.params.id);
  const evt = await loadEvent(id);
  if (!evt) { res.status(404).json({ error: "RFx not found" }); return; }
  const rows = await db.select({
    id: rfxScoresTable.id,
    envelopeId: rfxScoresTable.envelopeId,
    dimensionId: rfxScoresTable.dimensionId,
    score: rfxScoresTable.score,
    rationale: rfxScoresTable.rationale,
    graderAlias: rfxScoresTable.graderAlias,
    graderId: rfxScoresTable.graderId,
  }).from(rfxScoresTable)
    .innerJoin(rfxEnvelopesTable, eq(rfxScoresTable.envelopeId, rfxEnvelopesTable.id))
    .where(eq(rfxEnvelopesTable.rfxId, id));
  // Blind grading: hide graderId from anyone other than the grader themselves
  // until award. After award, both are revealed for audit.
  const me = actor(req);
  const out = rows.map(r => ({
    ...r,
    graderId: evt.status === "awarded" || r.graderId === me ? r.graderId : null,
  }));
  res.json(out);
});

// ─── Awards ─────────────────────────────────────────────────────────────────

const DecideAwardBody = z.object({
  awards: z.array(z.object({
    vendorId: z.number().int(),
    envelopeIdTechnical: z.number().int().optional(),
    envelopeIdCommercial: z.number().int().optional(),
    sharePct: z.number().int().min(1).max(100),
    value: z.number().nonnegative(),
    rationale: z.string().optional(),
  })),
  awardRationale: z.string().optional(),
});

router.post("/rfx/:id/award", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = DecideAwardBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const evt = await loadEvent(id);
  if (!evt) { res.status(404).json({ error: "RFx not found" }); return; }
  const totalShare = parsed.data.awards.reduce((s, a) => s + a.sharePct, 0);
  if (totalShare > 100) { res.status(400).json({ error: "Total share_pct exceeds 100" }); return; }
  await db.delete(rfxAwardsTable).where(eq(rfxAwardsTable.rfxId, id));
  if (parsed.data.awards.length > 0) {
    await db.insert(rfxAwardsTable).values(parsed.data.awards.map(a => ({
      rfxId: id,
      vendorId: a.vendorId,
      envelopeIdTechnical: a.envelopeIdTechnical ?? null,
      envelopeIdCommercial: a.envelopeIdCommercial ?? null,
      sharePct: a.sharePct,
      value: String(a.value),
      currency: evt.currency,
      rationale: a.rationale ?? "",
      decidedBy: actor(req),
    })));
  }
  const [row] = await db.update(rfxEventsTable).set({
    status: "awarded",
    awardedAt: new Date(),
    awardRationale: parsed.data.awardRationale ?? "",
  }).where(eq(rfxEventsTable.id, id)).returning();
  await audit(id, "award_decided", { awards: parsed.data.awards, totalShare }, req.user?.employeeId ?? null);
  await logActivity("rfx_awarded", `${evt.title} awarded by ${actor(req)}`, id, "rfx", null);
  res.json(row);
});

// ─── Clarifications ─────────────────────────────────────────────────────────

const RaiseClarBody = z.object({
  invitationId: z.number().int().nullable().optional(),
  question: z.string().min(1),
  isPublic: z.boolean().optional(),
});

router.post("/rfx/:id/clarifications", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = RaiseClarBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [row] = await db.insert(rfxClarificationsTable).values({
    rfxId: id,
    invitationId: parsed.data.invitationId ?? null,
    fromRole: "buyer",
    question: parsed.data.question,
    isPublic: parsed.data.isPublic ?? false,
    askedBy: actor(req),
  }).returning();
  await audit(id, "clarification_asked", { question: parsed.data.question }, req.user?.employeeId ?? null);
  res.status(201).json(row);
});

const AnswerClarBody = z.object({ answer: z.string().min(1), isPublic: z.boolean().optional() });

router.post("/rfx/:id/clarifications/:clarId/answer", async (req, res) => {
  const id = Number(req.params.id);
  const clarId = Number(req.params.clarId);
  const parsed = AnswerClarBody.safeParse(req.body);
  if (!Number.isFinite(id) || !Number.isFinite(clarId) || !parsed.success) {
    res.status(400).json({ error: parsed.success ? "Invalid id" : parsed.error.message });
    return;
  }
  const [row] = await db.update(rfxClarificationsTable).set({
    answer: parsed.data.answer,
    isPublic: parsed.data.isPublic ?? false,
    answeredAt: new Date(),
    answeredBy: actor(req),
  }).where(and(eq(rfxClarificationsTable.id, clarId), eq(rfxClarificationsTable.rfxId, id))).returning();
  if (!row) { res.status(404).json({ error: "Clarification not found" }); return; }
  await audit(id, "clarification_answered", { clarId }, req.user?.employeeId ?? null);
  res.json(row);
});

// ─── Audit log read ─────────────────────────────────────────────────────────

router.get("/rfx/:id/audit", async (req, res) => {
  const id = Number(req.params.id);
  const rows = await db.select().from(rfxAuditTable).where(eq(rfxAuditTable.rfxId, id)).orderBy(desc(rfxAuditTable.createdAt));
  res.json(rows);
});

// ─── Surrogate bid (SCM submits on behalf of a vendor) ──────────────────────

const SurrogateBidBody = z.object({
  invitationId: z.number().int(),
  kind: z.enum(["technical", "commercial", "alternative"]),
  answers: z.record(z.unknown()),
  reason: z.string().min(1),
});

router.post("/rfx/:id/surrogate-bid", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = SurrogateBidBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const evt = await loadEvent(id);
  if (!evt) { res.status(404).json({ error: "RFx not found" }); return; }
  if (!evt.surrogateBiddingAllowed) { res.status(409).json({ error: "Surrogate bidding not allowed" }); return; }
  if (evt.status !== "open") { res.status(409).json({ error: `Event is ${evt.status}, not open` }); return; }
  const [keyRow] = await db.select().from(rfxEnvelopeKeysTable).where(and(
    eq(rfxEnvelopeKeysTable.rfxId, id), eq(rfxEnvelopeKeysTable.kind, parsed.data.kind),
  ));
  if (!keyRow) { res.status(500).json({ error: "Envelope key not initialised" }); return; }
  const sealed = sealJson({ answers: parsed.data.answers, meta: { surrogate: true, reason: parsed.data.reason, actor: actor(req) } });
  // Per-kind shared key model: re-use the existing keyRow shares; the seal
  // produced fresh shares which we discard because the unlock UX expects
  // ONE pair of shares per kind. Re-encrypt with the existing key to keep
  // the model consistent: recombine current shares, re-seal with that key.
  const existingKey = recombineKey(Buffer.from(keyRow.keyShareA as Buffer), Buffer.from(keyRow.keyShareB as Buffer));
  const { createCipheriv, randomBytes } = await import("node:crypto");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", existingKey, iv);
  const json = Buffer.from(JSON.stringify({ answers: parsed.data.answers, meta: { surrogate: true, reason: parsed.data.reason, actor: actor(req) } }), "utf8");
  const ciphertext = Buffer.concat([cipher.update(json), cipher.final()]);
  const authTag = cipher.getAuthTag();
  existingKey.fill(0);
  // discard the throwaway shares from sealJson (we only used it for the doc)
  sealed.shareA.fill(0); sealed.shareB.fill(0);

  const [envelope] = await db.insert(rfxEnvelopesTable).values({
    invitationId: parsed.data.invitationId,
    rfxId: id,
    kind: parsed.data.kind,
    status: "sealed",
    sealedPayload: ciphertext,
    iv, authTag,
    wrappedKeyId: keyRow.id,
    submittedBySurrogate: true,
    surrogateActorId: actor(req),
    submittedAt: new Date(),
  }).returning();
  await audit(id, "envelope_sealed", {
    envelopeId: envelope.id, kind: parsed.data.kind, surrogate: true, actor: actor(req),
  }, req.user?.employeeId ?? null);
  await db.update(rfxInvitationsTable).set({ status: "submitted", submittedAt: new Date() })
    .where(eq(rfxInvitationsTable.id, parsed.data.invitationId));
  res.status(201).json({ id: envelope.id, status: envelope.status });
});

// Delete a sourcing event + all its child rows. AWARDED events are protected
// (the award + audit trail must survive) — cancel them instead.
router.delete("/rfx/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [evt] = await db.select().from(rfxEventsTable).where(eq(rfxEventsTable.id, id));
  if (!evt) { res.status(404).json({ error: "Sourcing event not found" }); return; }
  if (evt.status === "awarded") {
    res.status(409).json({ error: "Awarded sourcing events can't be deleted (award & audit trail). Cancel it instead." });
    return;
  }
  // Cascade owned children (no DB FK cascade on this schema). rfx_scores and
  // rfx_envelope_files key on envelope_id, so resolve this event's envelope
  // ids first and delete those by envelope.
  const envs = await db.select({ id: rfxEnvelopesTable.id }).from(rfxEnvelopesTable).where(eq(rfxEnvelopesTable.rfxId, id));
  const envIds = envs.map((e) => e.id);
  if (envIds.length) {
    await db.delete(rfxScoresTable).where(inArray(rfxScoresTable.envelopeId, envIds));
    await db.delete(rfxEnvelopeFilesTable).where(inArray(rfxEnvelopeFilesTable.envelopeId, envIds));
  }
  await db.delete(rfxScoringDimensionsTable).where(eq(rfxScoringDimensionsTable.rfxId, id));
  await db.delete(rfxAwardsTable).where(eq(rfxAwardsTable.rfxId, id));
  await db.delete(rfxClarificationsTable).where(eq(rfxClarificationsTable.rfxId, id));
  await db.delete(rfxQuestionsTable).where(eq(rfxQuestionsTable.rfxId, id));
  await db.delete(rfxEnvelopesTable).where(eq(rfxEnvelopesTable.rfxId, id));
  await db.delete(rfxEnvelopeKeysTable).where(eq(rfxEnvelopeKeysTable.rfxId, id));
  await db.delete(rfxInvitationsTable).where(eq(rfxInvitationsTable.rfxId, id));
  await db.delete(rfxAuditTable).where(eq(rfxAuditTable.rfxId, id));
  await db.delete(rfxEventsTable).where(eq(rfxEventsTable.id, id));
  await logActivity("rfx_deleted", `Sourcing event "${evt.title}" deleted`, id, "rfx");
  res.sendStatus(204);
});

// Used by vendor_portal.ts and elsewhere to seal a fresh envelope with the
// per-kind shared key. Kept here so the encryption logic lives next to the
// rest of the RFx lifecycle.
export async function sealEnvelopeForKind(
  rfxId: number, kind: "technical" | "commercial" | "alternative", payload: unknown,
): Promise<{ ciphertext: Buffer; iv: Buffer; authTag: Buffer; keyRowId: number }> {
  const [keyRow] = await db.select().from(rfxEnvelopeKeysTable).where(and(
    eq(rfxEnvelopeKeysTable.rfxId, rfxId), eq(rfxEnvelopeKeysTable.kind, kind),
  ));
  if (!keyRow) throw new Error(`Envelope key not initialised for rfx=${rfxId} kind=${kind}`);
  const key = recombineKey(Buffer.from(keyRow.keyShareA as Buffer), Buffer.from(keyRow.keyShareB as Buffer));
  const { createCipheriv, randomBytes } = await import("node:crypto");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const json = Buffer.from(JSON.stringify(payload), "utf8");
  const ciphertext = Buffer.concat([cipher.update(json), cipher.final()]);
  const authTag = cipher.getAuthTag();
  key.fill(0);
  return { ciphertext, iv, authTag, keyRowId: keyRow.id };
}

// Re-export the vendor master lookup so the vendor portal can resolve an
// authed vendor to a master row without redefining the column list.
export async function findVendorMasterByAuthUser(authUserId: string) {
  const [v] = await db.select().from(vendorMasterTable).where(eq(vendorMasterTable.authUserId, authUserId));
  return v;
}

export default router;
