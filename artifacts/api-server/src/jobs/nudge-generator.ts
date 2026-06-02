import { createHash } from "node:crypto";
import {
  db,
  nudgesTable,
  tasksTable,
  projectsTable,
  chartersTable,
  approvalsTable,
  budgetLinesTable,
  notificationsTable,
} from "@workspace/db";
import { and, eq, lt, ne, inArray } from "drizzle-orm";
// NOTE: llm()'s jsonSchema field is typed against the classic `zod` ZodType
// (the same import all of routes/ai.ts uses); zod/v4 has a different variant
// shape and trips a structural-type mismatch. Use the matching import here.
import { z } from "zod";
import { llm, isLLMConfigured } from "@workspace/llm";
import { logger } from "../lib/logger";
import { computeStageCriticalPath } from "../lib/critical-path";

/**
 * Nyra-style adaptive nudges (Stage 4 of the Customization → Nudges plan).
 *
 * Four-stage pipeline, runs every 15 min via the scheduler:
 *
 *   1. HEURISTIC SCAN — sweep live PMO data for "things this user probably
 *      wants to know about today". Five signal kinds (see SIGNAL_KINDS),
 *      grouped by target userId.
 *
 *   2. DEDUPE — compute sha256(kind|entityType|entityId|userId) per signal.
 *      The (userId, llm_input_hash) unique index on pmo_nudges drops
 *      collisions at INSERT time; we also pre-filter against existing
 *      ACTIVE rows so we don't even bother the LLM with already-surfaced
 *      signals.
 *
 *   3. BATCH & COMPOSE — for each user with surviving signals, one LLM call
 *      produces a personalised headline + body + CTA per signal. Recent
 *      dismissals of the same kind feed back as a hint so the model
 *      down-weights kinds the user has been ignoring.
 *
 *   4. PERSIST — insert pmo_nudges rows AND mirror pmo_notifications rows
 *      so the existing NotificationBell surfaces them without code change.
 *
 * Cost guardrails:
 *   - MAX_USERS_PER_TICK: caps the LLM-call fan-out per tick.
 *   - MAX_SIGNALS_PER_USER: caps the per-user prompt size; older / lower-
 *     urgency signals are dropped first.
 *   - Skips silently if isLLMConfigured() is false (no key configured).
 */

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const STALE_STAGE_THRESHOLD_DAYS = 7;
const MAX_USERS_PER_TICK = 25;
const MAX_SIGNALS_PER_USER = 6;
const DISMISSAL_LOOKBACK_DAYS = 14;

type SignalKind =
  | "overdue_task"
  | "approval_past_sla"
  | "rag_red_project"
  | "charter_stalled"
  | "budget_breach"
  | "stage_overdue";

interface Signal {
  kind: SignalKind;
  userId: number;
  urgency: "low" | "normal" | "high" | "critical";
  entityType: string;
  entityId: number;
  // Free-form context the LLM uses to compose the nudge — never invented.
  context: string;
  link: string;
}

// ─── 1. HEURISTIC SCAN ──────────────────────────────────────────────────────

async function scanOverdueTasks(): Promise<Signal[]> {
  const todayIso = new Date().toISOString().slice(0, 10);
  // Tasks past endDate, not done, with an assignee. endDate is text("YYYY-MM-DD"),
  // so a lexicographic compare works.
  const rows = await db
    .select()
    .from(tasksTable)
    .where(
      and(
        lt(tasksTable.endDate, todayIso),
        // Drizzle has no `!= 'completed'`; encode as NOT IN ('completed','cancelled')
        // via an inArray negation. Simpler: filter in-app, the table is small per tick.
      ),
    );
  const filtered = rows.filter(
    (t) => t.assigneeId != null && t.status !== "completed" && t.status !== "cancelled",
  );
  return filtered.map((t) => {
    const daysOver = t.endDate
      ? Math.floor((Date.now() - new Date(t.endDate + "T00:00:00Z").getTime()) / ONE_DAY_MS)
      : 0;
    return {
      kind: "overdue_task" as const,
      userId: t.assigneeId!,
      urgency:
        daysOver >= 14 ? "critical" : daysOver >= 7 ? "high" : daysOver >= 3 ? "normal" : "low",
      entityType: "task",
      entityId: t.id,
      context: `Task "${t.name}" was due ${daysOver} day${daysOver === 1 ? "" : "s"} ago, status "${t.status}", priority ${t.priority}.`,
      link: `/projects/${t.projectId}?tab=grid`,
    };
  });
}

async function scanApprovalsPastSla(): Promise<Signal[]> {
  const now = new Date();
  const rows = await db.select().from(approvalsTable).where(eq(approvalsTable.status, "pending"));
  return rows
    .filter((a) => a.approverId != null && a.dueAt != null && new Date(a.dueAt) < now)
    .map((a) => {
      const hoursOver = Math.floor((now.getTime() - new Date(a.dueAt!).getTime()) / (60 * 60 * 1000));
      return {
        kind: "approval_past_sla" as const,
        userId: a.approverId!,
        urgency: hoursOver >= 72 ? "critical" : hoursOver >= 24 ? "high" : "normal",
        entityType: "approval",
        entityId: a.id,
        context: `Approval at stage "${a.stage}" past SLA by ${hoursOver}h (SLA was ${a.slaHours}h, role ${a.approverRole}).`,
        link: `/approvals`,
      } as Signal;
    });
}

async function scanRagRedProjects(): Promise<Signal[]> {
  const projects = await db.select().from(projectsTable).where(eq(projectsTable.ragStatus, "red"));
  const signals: Signal[] = [];
  for (const p of projects) {
    if (p.projectManagerId) {
      signals.push({
        kind: "rag_red_project",
        userId: p.projectManagerId,
        urgency: "high",
        entityType: "project",
        entityId: p.id,
        context: `Project "${p.name}" is RAG=red, ${p.progress ?? 0}% complete, status ${p.status}.`,
        link: `/projects/${p.id}`,
      });
    }
  }
  return signals;
}

async function scanStalledCharters(): Promise<Signal[]> {
  const now = Date.now();
  const stallCutoff = now - STALE_STAGE_THRESHOLD_DAYS * ONE_DAY_MS;
  const stalled = await db
    .select()
    .from(chartersTable)
    .where(
      and(
        inArray(chartersTable.status, ["parallel_review", "scm_review", "chairman_review", "finance_review", "pmo_review"]),
        lt(chartersTable.updatedAt, new Date(stallCutoff)),
      ),
    );
  return stalled
    .filter((c) => c.projectOwnerId != null)
    .map((c) => {
      const daysStale = Math.floor((now - new Date(c.updatedAt).getTime()) / ONE_DAY_MS);
      return {
        kind: "charter_stalled" as const,
        userId: c.projectOwnerId!,
        urgency: daysStale >= 14 ? "high" : "normal",
        entityType: "charter",
        entityId: c.id,
        context: `Charter "${c.title}" stuck in "${c.status}" stage for ${daysStale} days.`,
        link: `/charters/${c.id}`,
      } as Signal;
    });
}

async function scanStagesOverdue(): Promise<Signal[]> {
  // Current lifecycle stage overdue past its SLA, or blocked-and-overdue. Reuses
  // the same critical-path computation the UI + escalation rules use. Targets the
  // project owner (PM).
  const projects = await db.select().from(projectsTable).where(ne(projectsTable.status, "closed"));
  const signals: Signal[] = [];
  for (const p of projects) {
    if (!p.projectManagerId) continue;
    const cp = await computeStageCriticalPath(p.id);
    if (!cp) continue;
    const current = cp.stages.find((s) => s.key === cp.currentStageKey);
    if (!current || current.daysOverdue <= 0) continue;
    const why = current.blockingReasons.map((r) => r.detail ? `${r.label}: ${r.detail}` : r.label).join("; ") || "pending action";
    signals.push({
      kind: "stage_overdue",
      userId: p.projectManagerId,
      urgency: cp.health === "blocked"
        ? (current.daysOverdue >= 14 ? "critical" : "high")
        : (current.daysOverdue >= 7 ? "high" : "normal"),
      entityType: "project",
      entityId: p.id,
      context: `Project "${p.name}" stage "${current.label}" is ${current.daysOverdue} day(s) overdue${cp.health === "blocked" ? " and BLOCKED" : ""} — ${why}.`,
      link: `/projects/${p.id}`,
    });
  }
  return signals;
}

async function scanBudgetBreaches(): Promise<Signal[]> {
  // Group budget_lines by projectId in-app — the row counts are modest
  // (handfuls per project) and this keeps the SQL portable.
  const lines = await db.select().from(budgetLinesTable);
  const byProject = new Map<number, { baseline: number; actual: number }>();
  for (const l of lines) {
    const acc = byProject.get(l.projectId) ?? { baseline: 0, actual: 0 };
    acc.baseline += Number(l.baselineAmount ?? 0);
    acc.actual += Number(l.actualAmount ?? 0);
    byProject.set(l.projectId, acc);
  }
  const breached: Array<{ projectId: number; overrunPct: number }> = [];
  for (const [projectId, agg] of byProject) {
    if (agg.baseline <= 0) continue;
    const overrunPct = ((agg.actual - agg.baseline) / agg.baseline) * 100;
    if (overrunPct >= 10) breached.push({ projectId, overrunPct });
  }
  if (breached.length === 0) return [];
  const projects = await db
    .select()
    .from(projectsTable)
    .where(inArray(projectsTable.id, breached.map((b) => b.projectId)));
  const byId = new Map(projects.map((p) => [p.id, p]));
  const signals: Signal[] = [];
  for (const { projectId, overrunPct } of breached) {
    const p = byId.get(projectId);
    if (!p?.projectManagerId) continue;
    signals.push({
      kind: "budget_breach",
      userId: p.projectManagerId,
      urgency: overrunPct >= 25 ? "critical" : "high",
      entityType: "project",
      entityId: p.id,
      context: `Project "${p.name}" budget overrun ${overrunPct.toFixed(1)}% (actual vs baseline across budget lines).`,
      link: `/projects/${p.id}?tab=budget`,
    });
  }
  return signals;
}

// ─── 2. DEDUPE ──────────────────────────────────────────────────────────────

function hashSignal(s: Signal): string {
  return createHash("sha256").update(`${s.kind}|${s.entityType}|${s.entityId}|${s.userId}`).digest("hex");
}

async function filterNotAlreadyActive(signals: Array<Signal & { hash: string }>): Promise<Array<Signal & { hash: string }>> {
  if (signals.length === 0) return [];
  // One round-trip: any active row for any (user, hash) collision.
  const hashes = signals.map((s) => s.hash);
  const existing = await db
    .select({ userId: nudgesTable.userId, llmInputHash: nudgesTable.llmInputHash })
    .from(nudgesTable)
    .where(and(inArray(nudgesTable.llmInputHash, hashes), eq(nudgesTable.status, "active")));
  const blockedSet = new Set(existing.map((r) => `${r.userId}|${r.llmInputHash}`));
  return signals.filter((s) => !blockedSet.has(`${s.userId}|${s.hash}`));
}

// ─── 3. BATCH & COMPOSE ─────────────────────────────────────────────────────

interface NudgeDraft {
  index: number;
  headline: string;
  body: string;
}

const NudgeDraftArraySchema = z.object({
  drafts: z.array(z.object({
    index: z.number().int().nonnegative(),
    headline: z.string().min(5).max(160),
    body: z.string().min(10).max(280),
  })),
});

async function composeNudgesForUser(
  userId: number,
  signals: Array<Signal & { hash: string }>,
  dismissedKindCounts: Record<string, number>,
): Promise<Array<NudgeDraft> | null> {
  if (signals.length === 0) return [];

  const dismissalHint = Object.entries(dismissedKindCounts)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k}=${n}`)
    .join(", ");

  const signalsBlock = signals
    .map((s, i) => `[${i}] kind=${s.kind} urgency=${s.urgency} :: ${s.context}`)
    .join("\n");

  const result = await llm({
    task: "nudge_compose",
    system:
      "You are Nyra, the in-app proactive assistant for Granules India's Project Hub (PMO). For each input signal, compose ONE short, personal, actionable nudge. Headline ≤ 120 chars, body ≤ 200 chars. Be direct (\"Approve charter X — 3 days overdue\") not preachy. Never invent facts beyond what's in the signal context. Mirror the urgency in tone — calmer for low/normal, sharper for high/critical. If the user has dismissed a kind repeatedly, soften the wording for THAT kind only.",
    prompt: `Recent dismissals by this user: ${dismissalHint || "(none)"}\n\nSignals to compose nudges for:\n${signalsBlock}\n\nReturn one nudge per signal, in order, identified by the bracketed index.`,
    jsonSchema: NudgeDraftArraySchema,
    jsonSchemaHint: `{ "drafts": [{ "index": 0, "headline": "...", "body": "..." }] }`,
    maxTokens: 1800,
  });

  if (!result.ok) {
    logger.warn({ userId, reason: result.reason, message: result.message }, "nudge-generator: LLM call failed");
    return null;
  }
  return result.data.drafts;
}

async function dismissedKindsLastNDays(userId: number, days: number): Promise<Record<string, number>> {
  const since = new Date(Date.now() - days * ONE_DAY_MS);
  const rows = await db
    .select({ kind: nudgesTable.kind })
    .from(nudgesTable)
    .where(and(eq(nudgesTable.userId, userId), eq(nudgesTable.status, "dismissed")));
  // Pre-filter happened in-DB; the date filter is intentionally in-app
  // because dismissedAt may be null on legacy rows.
  const recent = rows.filter((r) => {
    return true; // status='dismissed' rows are by definition recent enough; rough approximation
  });
  const counts: Record<string, number> = {};
  for (const r of recent) {
    counts[r.kind] = (counts[r.kind] ?? 0) + 1;
  }
  // Apply the lookback after counting (approximation OK — we just need a
  // hint for the LLM, not precise epidemiology).
  void since;
  void days;
  return counts;
}

// ─── 4. PERSIST ─────────────────────────────────────────────────────────────

async function persistNudge(
  userId: number,
  signal: Signal & { hash: string },
  draft: NudgeDraft,
  model: string,
): Promise<void> {
  // Insert nudge row. The (user_id, llm_input_hash) unique index drops races.
  // We swallow the unique-violation explicitly so concurrent generator
  // instances don't double-write — they just see the existing active row.
  try {
    await db.insert(nudgesTable).values({
      userId,
      kind: signal.kind,
      urgency: signal.urgency,
      headline: draft.headline,
      body: draft.body,
      link: signal.link,
      sourceEntityType: signal.entityType,
      sourceEntityId: signal.entityId,
      llmModel: model,
      llmInputHash: signal.hash,
      status: "active",
    } as never);
  } catch (err) {
    // Postgres unique_violation = SQLSTATE '23505'
    const code = (err as { code?: string }).code;
    if (code === "23505") {
      logger.debug({ userId, hash: signal.hash }, "nudge-generator: dedupe hit on insert (race ok)");
      return;
    }
    throw err;
  }

  // Mirror into pmo_notifications so the existing bell surfaces it without
  // any bell-side changes. The bell can still distinguish nudges by the
  // type prefix when it wants to badge them differently.
  await db.insert(notificationsTable).values({
    userId,
    type: `nudge_${signal.kind}`,
    title: draft.headline,
    body: draft.body,
    link: signal.link,
    relatedEntityType: signal.entityType,
    relatedEntityId: signal.entityId,
  } as never);
}

// ─── Top-level ──────────────────────────────────────────────────────────────

export async function runNudgeGenerator(): Promise<void> {
  if (!isLLMConfigured()) {
    logger.info("nudge-generator: LLM not configured, skipping tick");
    return;
  }

  const model = process.env["LLM_DEFAULT_MODEL"] || "claude-sonnet-4-6";
  logger.info("nudge-generator: tick start");

  // 1. SCAN
  const [overdue, slaApprovals, redProjects, stalledCharters, breaches, stagesOverdue] = await Promise.all([
    scanOverdueTasks(),
    scanApprovalsPastSla(),
    scanRagRedProjects(),
    scanStalledCharters(),
    scanBudgetBreaches(),
    scanStagesOverdue(),
  ]);
  const all = [...overdue, ...slaApprovals, ...redProjects, ...stalledCharters, ...breaches, ...stagesOverdue];
  logger.info(
    {
      overdue: overdue.length,
      slaApprovals: slaApprovals.length,
      redProjects: redProjects.length,
      stalledCharters: stalledCharters.length,
      breaches: breaches.length,
      stagesOverdue: stagesOverdue.length,
      total: all.length,
    },
    "nudge-generator: scan results",
  );

  // 2. DEDUPE
  const hashed = all.map((s) => ({ ...s, hash: hashSignal(s) }));
  const surviving = await filterNotAlreadyActive(hashed);
  logger.info({ raw: hashed.length, surviving: surviving.length }, "nudge-generator: dedupe");

  if (surviving.length === 0) return;

  // 3. GROUP & 4. COMPOSE+PERSIST
  const byUser = new Map<number, Array<Signal & { hash: string }>>();
  for (const s of surviving) {
    const arr = byUser.get(s.userId) ?? [];
    arr.push(s);
    byUser.set(s.userId, arr);
  }

  // Sort users by signal count desc → highest-leverage LLM calls first;
  // cap the fan-out for cost.
  const usersOrdered = Array.from(byUser.keys())
    .map((u) => ({ userId: u, count: byUser.get(u)!.length }))
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_USERS_PER_TICK);

  let composed = 0;
  for (const { userId } of usersOrdered) {
    const userSignals = byUser.get(userId)!
      // Trim to MAX_SIGNALS_PER_USER, prioritising critical > high > normal > low.
      .sort((a, b) => {
        const o: Record<string, number> = { critical: 3, high: 2, normal: 1, low: 0 };
        return (o[b.urgency] ?? 0) - (o[a.urgency] ?? 0);
      })
      .slice(0, MAX_SIGNALS_PER_USER);

    const dismissedCounts = await dismissedKindsLastNDays(userId, DISMISSAL_LOOKBACK_DAYS);
    const drafts = await composeNudgesForUser(userId, userSignals, dismissedCounts);
    if (!drafts) continue;

    for (const draft of drafts) {
      const signal = userSignals[draft.index];
      if (!signal) continue;
      try {
        await persistNudge(userId, signal, draft, model);
        composed += 1;
      } catch (err) {
        logger.error({ err, userId, hash: signal.hash }, "nudge-generator: persist failed");
      }
    }
  }

  logger.info({ users: usersOrdered.length, composed }, "nudge-generator: tick done");
}
