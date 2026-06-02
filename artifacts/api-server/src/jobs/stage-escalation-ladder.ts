import {
  db,
  projectsTable,
  stageEscalationPolicyTable,
  escalationLogTable,
  notificationsTable,
} from "@workspace/db";
import { and, eq, gte, ne } from "drizzle-orm";
import { logger } from "../lib/logger";
import { computeStageCriticalPath, type CriticalPathStage } from "../lib/critical-path";
import { resolveRole } from "../lib/role-resolver";
import { sendEscalationEmail, autoEscalationEmailsEnabled } from "../lib/escalation-email";

/**
 * Global per-stage escalation LADDER (jobs/stage-escalation-ladder.ts).
 *
 * For every active project, computes the stage-governance critical path and, for the
 * single active/blocked stage, fires any pmo_stage_escalation_policy tier whose
 * `afterDays` threshold the stage has now crossed (measured as days pending since stage
 * entry). Each fire writes in-app notifications to the resolved role's people and — when
 * the AUTO_ESCALATION_EMAILS master switch is on — a branded email, then logs a
 * pmo_escalation_log row.
 *
 * Dedup: a (project, stage, tier) already logged in the last 24h is skipped, so the same
 * rung can't re-fire every hour. Unrecognized / legacy-stage projects are skipped
 * gracefully. Distinct from the per-project pmo_escalation_rules engine
 * (jobs/escalation-evaluator.ts) — this is the org-wide stage default.
 */

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

async function alreadyFiredToday(projectId: number, stage: string, tier: number): Promise<boolean> {
  const since = new Date(Date.now() - ONE_DAY_MS);
  const rows = await db
    .select({ id: escalationLogTable.id })
    .from(escalationLogTable)
    .where(
      and(
        eq(escalationLogTable.projectId, projectId),
        eq(escalationLogTable.stage, stage),
        eq(escalationLogTable.tier, tier),
        gte(escalationLogTable.sentAt, since),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

type PolicyRow = typeof stageEscalationPolicyTable.$inferSelect;

async function fireTier(
  projectName: string,
  projectId: number,
  stage: CriticalPathStage,
  tier: PolicyRow,
): Promise<boolean> {
  // Sub-gate-scoped tier: only fire if that sub-gate is the (unsatisfied) blocker.
  let focusLabel = stage.label;
  let focusOverdue = stage.daysOverdue;
  if (tier.subGateKey) {
    const sg = stage.subGates?.find((g) => g.key === tier.subGateKey);
    if (!sg || sg.satisfied) return false;
    focusLabel = `${stage.label} · ${sg.label}`;
    focusOverdue = sg.daysOverdue;
  }

  const recipients = await resolveRole(tier.targetRole, projectId);
  if (recipients.length === 0) {
    logger.warn({ projectId, stage: stage.key, tier: tier.tier, role: tier.targetRole }, "ladder: target role unresolved — skipping (assign in /admin/role-directory)");
    return false;
  }

  const overdue = focusOverdue > 0 ? ` — ${focusOverdue} day(s) overdue` : "";
  const reasonText = stage.blockingReasons.map((r) => (r.detail ? `${r.label}: ${r.detail}` : r.label)).join("; ") || "Pending action";
  const isEscalate = tier.action === "escalate";
  const title = isEscalate
    ? `Escalation: "${projectName}" blocked at ${focusLabel}`
    : `Reminder: "${projectName}" — ${focusLabel} needs action`;
  const body = `${focusLabel}${overdue} (pending ${stage.daysPending} day(s)). ${reasonText}.`;
  const link = `/projects/${projectId}`;

  const notifiedIds: number[] = [];
  for (const r of recipients) {
    if (r.userId == null) continue;
    await db.insert(notificationsTable).values({
      userId: r.userId,
      type: isEscalate ? "critical_path_escalation" : "critical_path_reminder",
      title,
      body,
      link,
      relatedEntityType: "project",
      relatedEntityId: projectId,
    } as never);
    notifiedIds.push(r.userId);
  }

  let emailed = 0;
  if (autoEscalationEmailsEnabled()) {
    for (const r of recipients) {
      if (!r.email) continue;
      const html = `<p>Hi ${r.name},</p><p><strong>${title}</strong></p><p>${body}</p>` +
        `<p><a href="${link}">Open the project</a> to review and act.</p>`;
      if (await sendEscalationEmail({ to: r.email, subject: title, bodyHtml: html, text: `${title}\n\n${body}\n\n${link}` })) emailed++;
    }
  }

  await db.insert(escalationLogTable).values({
    projectId,
    stage: stage.key,
    subGateKey: tier.subGateKey ?? null,
    tier: tier.tier,
    action: tier.action,
    targetRole: tier.targetRole,
    recipientIds: notifiedIds,
    emailed,
    source: "ladder",
  } as never);

  logger.info({ projectId, stage: stage.key, tier: tier.tier, action: tier.action, role: tier.targetRole, notified: notifiedIds.length, emailed }, "ladder: tier fired");
  return true;
}

export async function runStageEscalationLadder(): Promise<void> {
  const policy = await db.select().from(stageEscalationPolicyTable).where(eq(stageEscalationPolicyTable.isActive, true));
  if (policy.length === 0) { logger.info("ladder: no active policy tiers, skipping"); return; }

  // Index policy tiers by stage for quick lookup.
  const byStage = new Map<string, PolicyRow[]>();
  for (const p of policy) {
    const list = byStage.get(p.stage) ?? [];
    list.push(p);
    byStage.set(p.stage, list);
  }

  const projects = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(ne(projectsTable.status, "closed"));

  let fired = 0;
  for (const { id } of projects) {
    try {
      const cp = await computeStageCriticalPath(id);
      if (!cp || !cp.currentStageRecognized) continue;
      const stage = cp.stages.find((s) => s.status === "blocked") ?? cp.stages.find((s) => s.status === "active");
      if (!stage) continue;

      const tiers = byStage.get(stage.key);
      if (!tiers) continue;

      // Only nudge when something is genuinely pending (gate unmet) or overdue.
      const hasPendingWork = stage.blockingReasons.length > 0 || stage.daysOverdue > 0;
      if (!hasPendingWork) continue;

      for (const tier of tiers) {
        if (stage.daysPending < tier.afterDays) continue;
        if (await alreadyFiredToday(id, stage.key, tier.tier)) continue;
        if (await fireTier(cp.projectName, id, stage, tier)) fired += 1;
      }
    } catch (err) {
      logger.error({ err, projectId: id }, "ladder: project evaluation failed");
    }
  }

  logger.info({ projects: projects.length, fired }, "ladder: done");
}
