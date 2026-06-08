// Shared project-health language — used by both the portfolio overview
// (`pages/portfolio-overview.tsx`) and the single-project overview
// (`components/project-overview.tsx`) so the two never drift.
//
// We split LIFECYCLE ("completed") from HEALTH ("on track / at risk / delayed").
// A project is first classified by lifecycle (done?), otherwise it inherits its
// RAG health. This keeps "where in its life" separate from "how healthy" — the
// one thing the source template (template22) muddled.

export type Health = "on_track" | "at_risk" | "delayed" | "completed";

export function classify(p: { status: string; ragStatus: string }): Health {
  if (p.status === "completed" || p.status === "closed") return "completed";
  if (p.ragStatus === "red") return "delayed";
  if (p.ragStatus === "amber") return "at_risk";
  return "on_track";
}

// RAG language shared across the app. "blue" = neutral/completed (a lifecycle
// state, not a health colour) so it never competes with green/amber/red bands.
export const HEALTH_HEX = {
  green: "#22C55E",
  amber: "#EAB308",
  red: "#EF4444",
  blue: "#3B82F6",
  grey: "#94A3B8",
} as const;

export const HEALTH_META: Record<Health, { label: string; color: string; desc: string }> = {
  on_track:  { label: "On Track",  color: HEALTH_HEX.green, desc: "On schedule and within budget" },
  at_risk:   { label: "At Risk",   color: HEALTH_HEX.amber, desc: "Needs attention — slipping or over-spend risk" },
  delayed:   { label: "Delayed",   color: HEALTH_HEX.red,   desc: "Behind schedule / over budget" },
  completed: { label: "Completed", color: HEALTH_HEX.blue,  desc: "Delivered and closed" },
};

// ── Single-project health "why" ──────────────────────────────────────────────
// Turns the raw signals (schedule, budget burn, open high-severity risks) into
// an overall RAG verdict plus the human-readable reasons behind it. Drives the
// "Health" card on the project overview — the answer to "why is this amber?".
export type RagTone = "green" | "amber" | "red";
export type HealthReason = { label: string; tone: RagTone };

const TONE_RANK: Record<RagTone, number> = { green: 0, amber: 1, red: 2 };

export function healthWhy(args: {
  status: string;
  endDate?: string | null;
  progress?: number | null;
  baselineSum: number;
  actualSum: number;
  openHighRisks: number;
  openIssues: number;
  /** Optional "now" override for deterministic tests; defaults to Date.now(). */
  now?: number;
}): { rag: RagTone; reasons: HealthReason[] } {
  const reasons: HealthReason[] = [];
  const done = args.status === "completed" || args.status === "closed";
  const now = args.now ?? Date.now();
  const progress = args.progress ?? 0;

  // Schedule
  if (!done && args.endDate) {
    const days = Math.round((new Date(args.endDate).getTime() - now) / 86_400_000);
    if (days < 0) reasons.push({ label: `Past due by ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"}`, tone: "red" });
    else if (days <= 14 && progress < 90) reasons.push({ label: `Due in ${days} day${days === 1 ? "" : "s"} · ${progress}% complete`, tone: "amber" });
    else reasons.push({ label: `On schedule · ${days} days to deadline`, tone: "green" });
  } else if (done) {
    reasons.push({ label: "Delivered", tone: "green" });
  } else {
    reasons.push({ label: "No deadline set", tone: "amber" });
  }

  // Budget burn
  if (args.baselineSum > 0) {
    const burn = Math.round((args.actualSum / args.baselineSum) * 100);
    if (burn > 100) reasons.push({ label: `Over budget — ${burn}% of baseline spent`, tone: "red" });
    else if (burn > 85) reasons.push({ label: `Budget tight — ${burn}% spent`, tone: "amber" });
    else reasons.push({ label: `Budget healthy — ${burn}% spent`, tone: "green" });
  } else {
    reasons.push({ label: "No budget baseline", tone: "amber" });
  }

  // Risk exposure
  if (args.openHighRisks > 0) reasons.push({ label: `${args.openHighRisks} open high-severity risk${args.openHighRisks === 1 ? "" : "s"}`, tone: "red" });
  else if (args.openIssues > 0) reasons.push({ label: `${args.openIssues} open issue${args.openIssues === 1 ? "" : "s"}`, tone: "amber" });
  else reasons.push({ label: "No open high risks", tone: "green" });

  const worst = reasons.reduce<RagTone>((acc, r) => (TONE_RANK[r.tone] > TONE_RANK[acc] ? r.tone : acc), "green");
  return { rag: worst, reasons };
}

// ─────────────────────────────────────────────────────────────────────────────
// LEADING INDICATORS — predictive signals that flag trouble *before* RAG turns
// red. These are deliberately cheap proxies for the EVM gold-standard (SPI/CPI):
// we don't have true Earned Value, but "% done vs % time elapsed" and "% done
// vs % budget burnt" capture the same trajectory signal from data we do have.
// Every helper returns { ...metric, tone, label } so the UI stays declarative.
// `now` is injectable for deterministic tests; defaults to Date.now().
// ─────────────────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const worstTone = (tones: RagTone[]): RagTone =>
  tones.reduce<RagTone>((acc, t) => (TONE_RANK[t] > TONE_RANK[acc] ? t : acc), "green");

/** Schedule pace = progress% − elapsed% (poor-man's SPI). Negative ⇒ behind. */
export function schedulePace(a: { startDate?: string | null; endDate?: string | null; progress?: number | null; status?: string; now?: number }): {
  gap: number | null; elapsedPct: number | null; tone: RagTone; label: string;
} {
  const now = a.now ?? Date.now();
  const done = a.status === "completed" || a.status === "closed";
  if (done) return { gap: 0, elapsedPct: 100, tone: "green", label: "Delivered" };
  if (!a.startDate || !a.endDate) return { gap: null, elapsedPct: null, tone: "amber", label: "No baseline dates" };
  const t0 = new Date(a.startDate).getTime(), t1 = new Date(a.endDate).getTime();
  if (!(t1 > t0)) return { gap: null, elapsedPct: null, tone: "amber", label: "Invalid dates" };
  const elapsedPct = Math.max(0, Math.min(100, Math.round(((now - t0) / (t1 - t0)) * 100)));
  const gap = (a.progress ?? 0) - elapsedPct;
  // >10pts behind = red, 0–10 behind = amber, on/ahead = green.
  const tone: RagTone = gap < -10 ? "red" : gap < 0 ? "amber" : "green";
  const label = gap < 0 ? `${Math.abs(gap)} pts behind pace` : gap > 0 ? `${gap} pts ahead` : "On pace";
  return { gap, elapsedPct, tone, label };
}

/** Cost efficiency = burn% vs progress% (poor-man's CPI). Burn ≫ progress ⇒ over-running. */
export function costEfficiency(a: { progress?: number | null; burnPct: number; hasBudget: boolean }): {
  delta: number | null; tone: RagTone; label: string;
} {
  if (!a.hasBudget) return { delta: null, tone: "amber", label: "No budget baseline" };
  const progress = a.progress ?? 0;
  const delta = a.burnPct - progress; // +ve ⇒ spending faster than delivering
  const tone: RagTone = delta > 15 ? "red" : delta > 5 ? "amber" : "green";
  const label = delta > 5 ? `Spending ${delta}pts ahead of delivery` : delta < -5 ? `Under-spending vs progress` : "Spend tracks delivery";
  return { delta, tone, label };
}

/** Milestone slippage — the "missing milestones while holding go-live" pattern. */
export function milestoneSlippage(milestones: Array<{ status: string; dueDate?: string | null; scheduleVarianceDays?: number | null }>, now = Date.now()): {
  slipped: number; worstDays: number; tone: RagTone; label: string;
} {
  let slipped = 0, worstDays = 0;
  for (const m of milestones) {
    const done = m.status === "completed" || m.status === "done" || m.status === "achieved";
    const sv = m.scheduleVarianceDays ?? 0;
    const overdue = !done && m.dueDate ? new Date(m.dueDate).getTime() < now : false;
    const days = sv > 0 ? sv : overdue && m.dueDate ? Math.round((now - new Date(m.dueDate).getTime()) / DAY_MS) : 0;
    if (days > 0) { slipped++; worstDays = Math.max(worstDays, days); }
  }
  const tone: RagTone = slipped === 0 ? "green" : worstDays > 14 || slipped >= 3 ? "red" : "amber";
  const label = slipped === 0 ? "No gates slipped" : `${slipped} slipped · worst ${worstDays}d`;
  return { slipped, worstDays, tone, label };
}

/** Aging blockers — open-issue age + cross-dept blockers (RAID quality signal). */
export function agingSummary(issues: Array<{ status: string; createdAt: string; blockingDept?: string | null; proposedRevisedDeadline?: string | null }>, now = Date.now()): {
  openCount: number; oldestDays: number; crossDept: number; revisions: number; tone: RagTone; label: string;
} {
  const open = issues.filter(i => i.status !== "resolved" && i.status !== "closed");
  let oldestDays = 0, crossDept = 0, revisions = 0;
  for (const i of open) {
    oldestDays = Math.max(oldestDays, Math.round((now - new Date(i.createdAt).getTime()) / DAY_MS));
    if (i.blockingDept) crossDept++;
    if (i.proposedRevisedDeadline) revisions++;
  }
  const tone: RagTone = open.length === 0 ? "green" : oldestDays > 21 || crossDept > 0 ? "red" : oldestDays > 7 ? "amber" : "green";
  const label = open.length === 0 ? "No open blockers" : `Oldest ${oldestDays}d${crossDept ? ` · ${crossDept} cross-dept` : ""}`;
  return { openCount: open.length, oldestDays, crossDept, revisions, tone, label };
}

/** Scope volatility — change-request rate + re-baselines (scope-creep signal). */
export function scopeVolatility(
  crs: Array<{ status: string; createdAt: string; decidedAt?: string | null; breachedAt?: string | null; dueAt?: string | null }>,
  baselines: Array<{ capturedAt: string }>,
  now = Date.now(),
): { recent: number; pending: number; rebaselines: number; tone: RagTone; label: string } {
  const PENDING = new Set(["submitted", "under_review"]);
  const recent = crs.filter(c => (now - new Date(c.createdAt).getTime()) / DAY_MS <= 30).length;
  const pending = crs.filter(c => PENDING.has(c.status) && !c.decidedAt).length;
  const rebaselines = Math.max(0, baselines.length - 1); // first baseline is normal; extras = re-baselining
  const tone: RagTone = recent >= 5 || rebaselines >= 2 ? "red" : recent >= 2 || rebaselines >= 1 ? "amber" : "green";
  const label = recent === 0 && rebaselines === 0 ? "Scope stable" : `${recent} CRs/30d${rebaselines ? ` · ${rebaselines} re-baselines` : ""}`;
  return { recent, pending, rebaselines, tone, label };
}

/** One-line "so what" verdict — the sentence a sponsor reads first. */
export function headlineVerdict(a: {
  health: Health;
  pace: ReturnType<typeof schedulePace>;
  cost: ReturnType<typeof costEfficiency>;
  slip: ReturnType<typeof milestoneSlippage>;
  aging: ReturnType<typeof agingSummary>;
  progress?: number | null;
  endDate?: string | null;
  status?: string;
  now?: number;
}): { rag: RagTone; sentence: string } {
  const now = a.now ?? Date.now();
  const clauses: string[] = [];
  if (a.status === "completed" || a.status === "closed") {
    return { rag: "green", sentence: "Delivered and closed." };
  }
  if (a.endDate) {
    const days = Math.round((new Date(a.endDate).getTime() - now) / DAY_MS);
    clauses.push(days < 0 ? `${Math.abs(days)} days overdue at ${a.progress ?? 0}% complete` : `${days} days to deadline at ${a.progress ?? 0}% complete`);
  } else {
    clauses.push(`${a.progress ?? 0}% complete`);
  }
  if (a.pace.gap != null && a.pace.gap < 0) clauses.push(`${Math.abs(a.pace.gap)} pts behind pace`);
  if (a.slip.slipped > 0) clauses.push(`${a.slip.slipped} gate${a.slip.slipped === 1 ? "" : "s"} slipped`);
  if (a.cost.delta != null && a.cost.delta > 5) clauses.push(`spend running ahead of delivery`);
  else if (a.cost.delta != null && a.cost.tone === "green") clauses.push(`budget healthy`);
  if (a.aging.crossDept > 0) clauses.push(`${a.aging.crossDept} cross-dept blocker${a.aging.crossDept === 1 ? "" : "s"}`);
  const rag = worstTone([a.pace.tone, a.cost.tone, a.slip.tone, a.aging.tone]);
  const head = HEALTH_META[a.health].label;
  return { rag, sentence: `${head} — ${clauses.join("; ")}.` };
}
