import { Router, type IRouter, type Request, type Response } from "express";
import { timingSafeEqual, createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { db, nfasTable, chartersTable, approvalsTable, notificationsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logActivity } from "./activity";
import { applyApprovalDecision } from "./approvals";
import { getDocumensoDocument, downloadSignedPdf, nextPendingSigner, type DocumensoRecipientState, type DocumensoDocumentState } from "../integrations/documenso";
import { notifySignerTurn } from "../lib/esign-notify";
import { writeLocalUpload } from "../lib/localStorage";

// Documenso → PMO signature webhook. Mounted BEFORE requireAuth (app.ts) —
// Documenso can't carry a Bearer token; authenticity = the shared secret it
// echoes in X-Documenso-Secret, plus the fact that all decision data is
// re-fetched from the Documenso API rather than trusted from the body.
// Idempotent: only signatories/approvals still "pending" are flipped, so
// duplicate/overlapping events (SIGNED + RECIPIENT_COMPLETED + COMPLETED)
// are harmless.

const router: IRouter = Router();

function secretOk(req: Request): boolean {
  const expected = process.env.DOCUMENSO_WEBHOOK_SECRET;
  if (!expected) return false;
  const presented = req.get("x-documenso-secret") ?? "";
  // Hash both sides so timingSafeEqual gets equal-length buffers.
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function emailOf(sig: { email?: string; name?: string }): string {
  return (sig.email || (sig.name?.includes("@") ? sig.name : "") || "").trim().toLowerCase();
}

function decisionFor(status: string | undefined): "approved" | "rejected" | null {
  if (status === "SIGNED") return "approved";
  if (status === "REJECTED") return "rejected";
  return null;
}

// Standalone e-NFA: flip matching pending signatories in the jsonb grid and
// roll the row status up — same effect as POST /nfas/:id/decide.
async function syncNfa(id: number, byEmail: Map<string, string>): Promise<void> {
  const [nfa] = await db.select().from(nfasTable).where(eq(nfasTable.id, id));
  if (!nfa || nfa.status !== "pending_approval") return;

  const sigs = [...((nfa.signatories as Array<Record<string, unknown>>) ?? [])];
  let changed = false;
  for (let i = 0; i < sigs.length; i++) {
    const sig = sigs[i] as { email?: string; name?: string; status?: string };
    if (sig.status !== "pending") continue;
    const decision = decisionFor(byEmail.get(emailOf(sig)));
    if (!decision) continue;
    sigs[i] = { ...sigs[i], status: decision, comment: "e-signed via Documenso", decidedAt: new Date().toISOString() };
    changed = true;
  }
  if (!changed) return;

  const typed = sigs as Array<{ status: string }>;
  const status = typed.some((s) => s.status === "rejected")
    ? "rejected"
    : typed.every((s) => s.status === "approved") ? "approved" : "pending_approval";

  await db.update(nfasTable).set({ signatories: sigs, status } as never).where(eq(nfasTable.id, id));
  await logActivity("nfa_esign_decision", `NFA "${nfa.subject || nfa.noteNo}" — e-signature update from Documenso (now ${status})`, id, "nfa");

  if ((status === "approved" || status === "rejected") && nfa.createdById) {
    await db.insert(notificationsTable).values({
      userId: nfa.createdById,
      type: status === "approved" ? "nfa_approved" : "nfa_rejected",
      title: `NFA ${status} via e-sign: "${nfa.subject || nfa.noteNo}"`,
      body: null,
      link: `/nfas/${id}`,
      relatedEntityType: "nfa",
      relatedEntityId: id,
    } as never);
  }
}

// Charter+NFA: record each signature on its pmo_approvals row via the same
// applyApprovalDecision the in-app decide endpoint uses (mirrors signatories,
// drives stage progression).
async function syncCharter(id: number, byEmail: Map<string, string>): Promise<void> {
  const [charter] = await db.select().from(chartersTable).where(eq(chartersTable.id, id));
  if (!charter) return;

  // email → role from the send-time envelope, with the signatory grid as fallback.
  const envelope = (charter.esign as { recipients?: Array<{ email: string; role: string }> } | null)?.recipients ?? [];
  const sigs = (charter.signatories as Array<{ role?: string; name?: string; email?: string }>) ?? [];
  const roleByEmail = new Map<string, string>();
  for (const s of sigs) if (emailOf(s) && s.role) roleByEmail.set(emailOf(s), s.role);
  for (const r of envelope) if (r.email && r.role) roleByEmail.set(r.email.toLowerCase(), r.role);

  for (const [email, signingStatus] of byEmail) {
    const decision = decisionFor(signingStatus);
    const role = roleByEmail.get(email);
    if (!decision || !role) continue;
    const [row] = await db.select().from(approvalsTable).where(and(
      eq(approvalsTable.charterId, id),
      eq(approvalsTable.approverRole, role),
      eq(approvalsTable.status, "pending"),
    )).limit(1);
    if (row) await applyApprovalDecision(row, decision, "e-signed via Documenso");
  }
}

// After the signature sync: advance the sequential chain (tell the next
// pending signer it's their turn), snapshot the working PDF as a new stored
// VERSION after every signature (so each signer's mark is visible on the
// Charter+eNFA immediately), and once the envelope is COMPLETED keep the
// sealed PDF as the final artifact. Idempotent (versions dedup on signed
// count) + best-effort.
type EsignVersion = { v: number; path: string; signedBy?: string; at: string };

async function afterSync(kind: "nfa" | "charter", id: number, doc: DocumensoDocumentState, event: string): Promise<void> {
  const table = kind === "nfa" ? nfasTable : chartersTable;
  const [row] = await db.select().from(table).where(eq(table.id, id));
  if (!row) return;
  const title = kind === "nfa"
    ? ((row as { subject?: string; noteNo?: string }).subject || (row as { noteNo?: string }).noteNo || `NFA ${id}`)
    : ((row as { title?: string }).title || `Charter ${id}`);
  const esign = ((row as { esign?: unknown }).esign ?? {}) as Record<string, unknown>;
  const safeTitle = String(title).replace(/[^\w.-]+/g, "_").slice(0, 80);

  const recipients = doc.recipients ?? [];
  const signed = recipients.filter((r) => r.signingStatus === "SIGNED");
  const versions: EsignVersion[] = Array.isArray(esign.versions) ? [...(esign.versions as EsignVersion[])] : [];
  let changed = false;

  // One stored version per signature milestone (dedup on signed-count so
  // Documenso's duplicate/retried webhooks don't multiply snapshots).
  const versionWorthy = event === "DOCUMENT_RECIPIENT_COMPLETED" || doc.status === "COMPLETED";
  if (versionWorthy && signed.length > 0 && !versions.some((x) => x.v === signed.length)) {
    const pdf = await downloadSignedPdf(doc.id);
    const objectId = `local-${randomUUID()}`;
    await writeLocalUpload(objectId, Readable.from(pdf), "application/pdf", `${safeTitle}-signed-v${signed.length}.pdf`);
    const lastSigner = [...signed].sort((a, b) => new Date(a.signedAt ?? 0).getTime() - new Date(b.signedAt ?? 0).getTime()).pop();
    versions.push({ v: signed.length, path: `/api/storage/objects/${objectId}`, signedBy: lastSigner?.email, at: new Date().toISOString() });
    esign.versions = versions;
    changed = true;
    await logActivity(`${kind}_esign_version`, `"${title}" — signature ${signed.length}/${recipients.length} recorded (${lastSigner?.email ?? "?"}); version stored`, id, kind);
  }

  if (doc.status === "COMPLETED" && !esign.signedObjectPath) {
    // Download FRESH at COMPLETED — the version snapshots were captured at each
    // signature (pre-seal), so they lack Documenso's final seal + certificate
    // page. Re-fetch now to store the authoritative sealed artifact.
    const pdf = await downloadSignedPdf(doc.id);
    const objectId = `local-${randomUUID()}`;
    await writeLocalUpload(objectId, Readable.from(pdf), "application/pdf", `${safeTitle}-signed.pdf`);
    esign.signedObjectPath = `/api/storage/objects/${objectId}`;
    esign.completedAt = new Date().toISOString();
    changed = true;
    await logActivity(`${kind}_esign_completed`, `"${title}" fully e-signed — sealed PDF stored`, id, kind);
  }

  if (changed) {
    await db.update(table).set({ esign } as never).where(eq(table.id, id));
  }

  if (doc.status === "PENDING" && event === "DOCUMENT_RECIPIENT_COMPLETED") {
    const next = nextPendingSigner(doc);
    if (next) await notifySignerTurn({ email: next.email, signingUrl: next.signingUrl, kind, entityId: id, title });
  }

  // All signatures are in but Documenso hasn't sealed yet (sealing is async and
  // every webhook fires at signing time) — poll until COMPLETED so the sealed
  // PDF + certificate actually get stored. afterSync is idempotent.
  const allSigned = recipients.length > 0 && recipients.every((r) => r.signingStatus === "SIGNED");
  if (allSigned && doc.status !== "COMPLETED" && !esign.signedObjectPath) {
    scheduleSealedPdfCapture(kind, id, doc.id);
  }
}

// ponytail: in-memory poll (30×30s covers the */15 seal sweep); lost on restart —
// replay the webhook (POST /api/documenso/webhook, event DOCUMENT_COMPLETED) to recover.
const sealPolls = new Set<string>();
function scheduleSealedPdfCapture(kind: "nfa" | "charter", id: number, documentId: number, attempt = 0): void {
  const key = `${kind}:${id}`;
  if (attempt === 0) {
    if (sealPolls.has(key)) return;
    sealPolls.add(key);
  }
  if (attempt >= 30) { sealPolls.delete(key); return; }
  setTimeout(() => {
    void (async () => {
      try {
        const doc = await getDocumensoDocument(documentId);
        if (doc.status === "COMPLETED") {
          await afterSync(kind, id, doc, "seal-poll");
          sealPolls.delete(key);
          return;
        }
      } catch { /* transient — keep polling */ }
      scheduleSealedPdfCapture(kind, id, documentId, attempt + 1);
    })();
  }, 30_000).unref();
}

router.post("/documenso/webhook", async (req: Request, res: Response): Promise<void> => {
  if (!process.env.DOCUMENSO_WEBHOOK_SECRET) { res.status(501).json({ error: "Set DOCUMENSO_WEBHOOK_SECRET." }); return; }
  if (!secretOk(req)) { res.status(403).json({ error: "Invalid webhook secret" }); return; }

  const body = (req.body ?? {}) as { event?: string; payload?: { id?: number; externalId?: string | null } };
  const documentId = Number(body.payload?.id);
  if (!Number.isFinite(documentId)) { res.json({ ok: true, skipped: "no document id" }); return; }

  try {
    // Re-read authoritative state from Documenso (don't trust the posted body).
    const doc = await getDocumensoDocument(documentId);
    const externalId = doc.externalId ?? body.payload?.externalId ?? "";
    const m = /^(nfa|charter):(\d+)$/.exec(externalId);
    if (!m) { res.json({ ok: true, skipped: `unrecognized externalId "${externalId}"` }); return; }

    const byEmail = new Map<string, string>();
    for (const r of (doc.recipients ?? []) as DocumensoRecipientState[]) {
      if (r.email) byEmail.set(r.email.toLowerCase(), r.signingStatus);
    }

    const kind = m[1] as "nfa" | "charter";
    if (kind === "nfa") await syncNfa(Number(m[2]), byEmail);
    else await syncCharter(Number(m[2]), byEmail);

    try {
      await afterSync(kind, Number(m[2]), doc, body.event ?? "");
    } catch (e) {
      // Chain-advance/PDF-pull problems must not fail the signature sync —
      // Documenso would retry and re-apply decisions we already recorded.
      req.log?.warn({ err: String(e), documentId }, "documenso webhook afterSync failed");
    }

    res.json({ ok: true });
  } catch (e) {
    req.log?.error({ err: e }, "documenso webhook sync failed");
    res.status(500).json({ error: (e as Error).message });
  }
});

export default router;
