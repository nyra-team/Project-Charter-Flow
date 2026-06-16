import {
  db,
  escalationRulesTable,
  projectsTable,
  budgetLinesTable,
  risksTable,
  issuesTable,
  milestonesTable,
  notificationsTable,
  usersTable,
} from "@workspace/db";
import { and, eq, gte, inArray } from "drizzle-orm";
import { logger } from "../lib/logger";
import { computeStageCriticalPath } from "../lib/critical-path";
import { notify } from "../lib/notify";
import { autoEscalationEmailsEnabled } from "../lib/escalation-email";

/**
 * Walks every active row in pmo_escalation_rules, evaluates its trigger
 * against current project state, and writes one notification per
 * `notify_user_ids` entry on breach. Dedupes per rule per day so the same
 * alarm doesn't repeat at every 5-min tick.
 *
 * Trigger types — keep in sync with the dropdown options in
 * components/escalation-rules-tab.tsx:
 *   - rag_change             → fires while project.ragStatus === 'red'
 *   - budget_overrun_pct     → fires when overrun% on project budget_lines
 *                              exceeds thresholdValue
 *   - schedule_slip_days     → fires when avg schedule_variance_days across
 *                              the project's milestones is past threshold
 *   - risk_score             → fires when an open risk on the project has
 *                              priority === 'high'
 *   - issue_open_days        → fires when any open issue on the project has
 *                              been open longer than thresholdValue days
 *   - stage_blocked_days     → fires when the current lifecycle stage is overdue
 *                              past thresholdValue days (stage-governance critical path)
 *
 * Unknown trigger types are logged once and skipped — they won't crash the
 * job so a typo in an admin form can't take down the entire pipeline.
 */

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

type EscalationRule = {
  id: number;
  projectId: number | null;
  triggerType: string;
  thresholdValue: string;
  notifyUserIds: unknown;
  isActive: boolean;
};

type ProjectRow = typeof projectsTable.$inferSelect;

async function alreadyNotifiedToday(ruleId: number): Promise<boolean> {
  const since = new Date(Date.now() - ONE_DAY_MS);
  const rows = await db
    .select({ id: notificationsTable.id })
    .from(notificationsTable)
    .where(
      and(
        eq(notificationsTable.relatedEntityType, "escalation_rule"),
        eq(notificationsTable.relatedEntityId, ruleId),
        gte(notificationsTable.createdAt, since),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

async function notifyRule(rule: EscalationRule, project: ProjectRow, reason: string): Promise<number> {
  const userIds = Array.isArray(rule.notifyUserIds)
    ? (rule.notifyUserIds as unknown[]).filter((x): x is number => typeof x === "number")
    : [];
  if (userIds.length === 0) return 0;
  if (await alreadyNotifiedToday(rule.id)) return 0;

  const users = await db
    .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
    .from(usersTable)
    .where(inArray(usersTable.id, userIds));
  // relatedEntityType/Id MUST stay "escalation_rule"/rule.id — alreadyNotifiedToday
  // keys its 24h dedup on them, which also gates the email/Teams sends below.
  const { notified } = await notify({
    projectId: project.id,
    type: `escalation_${rule.triggerType}`,
    title: `Escalation on "${project.name}"`,
    body: reason,
    relatedEntityType: "escalation_rule",
    relatedEntityId: rule.id,
    recipients: users.map((u) => ({ userId: u.id, name: u.name, email: u.email ?? null })),
    email: {
      enabled: autoEscalationEmailsEnabled(),
      banner: { emoji: "🚨", title: "Project escalation", color: "amber" },
    },
  });
  return notified;
}

async function evaluateForProject(rule: EscalationRule, project: ProjectRow): Promise<boolean> {
  const threshold = Number(rule.thresholdValue ?? 0);

  switch (rule.triggerType) {
    case "rag_change": {
      // Coarse but predictable: while the project is RAG=red, fire daily.
      // A truer "change" trigger needs a historical RAG ledger, which the
      // schema doesn't have today — that's a future refinement.
      if (project.ragStatus !== "red") return false;
      await notifyRule(rule, project, `Project RAG status is red.`);
      return true;
    }

    case "budget_overrun_pct": {
      const lines = await db
        .select()
        .from(budgetLinesTable)
        .where(eq(budgetLinesTable.projectId, project.id));
      if (lines.length === 0) return false;
      const baseline = lines.reduce((s, l) => s + Number(l.baselineAmount ?? 0), 0);
      const actual = lines.reduce((s, l) => s + Number(l.actualAmount ?? 0), 0);
      if (baseline === 0) return false;
      const overrunPct = ((actual - baseline) / baseline) * 100;
      if (overrunPct < threshold) return false;
      await notifyRule(
        rule,
        project,
        `Budget overrun ${overrunPct.toFixed(1)}% (threshold ${threshold}%) — actual ₹${actual.toLocaleString("en-IN")} vs baseline ₹${baseline.toLocaleString("en-IN")}.`,
      );
      return true;
    }

    case "schedule_slip_days": {
      const ms = await db
        .select({ scheduleVarianceDays: milestonesTable.scheduleVarianceDays })
        .from(milestonesTable)
        .where(eq(milestonesTable.projectId, project.id));
      if (ms.length === 0) return false;
      // Average absolute variance — positive = ahead, negative = behind. We
      // alarm on behind-only (negative beyond threshold) since "ahead" is
      // never an escalation.
      const avg = ms.reduce((s, m) => s + (m.scheduleVarianceDays ?? 0), 0) / ms.length;
      if (avg > -threshold) return false;
      await notifyRule(
        rule,
        project,
        `Schedule slip averaging ${Math.abs(avg).toFixed(0)} days across ${ms.length} milestones (threshold ${threshold}d).`,
      );
      return true;
    }

    case "risk_score": {
      const risks = await db
        .select()
        .from(risksTable)
        .where(and(eq(risksTable.charterId, project.charterId ?? -1), eq(risksTable.status, "open")));
      const high = risks.find((r) => r.priority === "high");
      if (!high) return false;
      await notifyRule(
        rule,
        project,
        `High-priority open risk: "${high.title ?? "(untitled)"}" — ${risks.length} open risks total.`,
      );
      return true;
    }

    case "issue_open_days": {
      const issues = await db
        .select()
        .from(issuesTable)
        .where(and(eq(issuesTable.projectId, project.id), eq(issuesTable.status, "open")));
      const now = Date.now();
      const stale = issues.filter((i) => {
        if (!i.createdAt) return false;
        const ageDays = (now - new Date(i.createdAt).getTime()) / ONE_DAY_MS;
        return ageDays >= threshold;
      });
      if (stale.length === 0) return false;
      await notifyRule(
        rule,
        project,
        `${stale.length} issue${stale.length === 1 ? "" : "s"} open longer than ${threshold} day${threshold === 1 ? "" : "s"}.`,
      );
      return true;
    }

    case "stage_blocked_days": {
      // Fire when the current lifecycle stage is overdue past the threshold (or the
      // gate is unmet and the stage is overdue at all). Reuses the same critical-path
      // computation the UI shows, so escalation matches what users see.
      const cp = await computeStageCriticalPath(project.id);
      if (!cp) return false;
      const current = cp.stages.find((s) => s.key === cp.currentStageKey);
      if (!current) return false;
      const overdueEnough = current.daysOverdue >= threshold;
      const blockedAndOverdue = cp.health === "blocked" && current.daysOverdue > 0;
      if (!overdueEnough && !blockedAndOverdue) return false;
      const why = current.blockingReasons.map((r) => r.detail ? `${r.label}: ${r.detail}` : r.label).join("; ") || "pending action";
      await notifyRule(
        rule,
        project,
        `Stage "${current.label}" is ${current.daysOverdue} day(s) overdue (threshold ${threshold}d) — ${why}.`,
      );
      return true;
    }

    default: {
      logger.warn({ rule: rule.id, triggerType: rule.triggerType }, "escalation: unknown triggerType, skipping");
      return false;
    }
  }
}

export async function runEscalationEvaluator(): Promise<void> {
  const rules = await db.select().from(escalationRulesTable).where(eq(escalationRulesTable.isActive, true));
  logger.info({ count: rules.length }, "escalation: evaluating active rules");

  let fired = 0;
  for (const rule of rules) {
    if (rule.projectId == null) continue;
    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, rule.projectId));
    if (!project) continue;
    try {
      const didFire = await evaluateForProject(rule as EscalationRule, project);
      if (didFire) fired += 1;
    } catch (err) {
      logger.error({ err, rule: rule.id }, "escalation: rule evaluation failed");
    }
  }

  logger.info({ rules: rules.length, fired }, "escalation: done");
}
