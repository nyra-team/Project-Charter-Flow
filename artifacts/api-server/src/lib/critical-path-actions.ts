import { db, notificationsTable, usersTable, escalationLogTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { logger } from "./logger";
import { computeStageCriticalPath } from "./critical-path";
import { resolveRole, type Recipient } from "./role-resolver";
import { sendEscalationEmail } from "./escalation-email";
import { logActivity } from "../routes/activity";

export type EscalateAction = "escalate" | "remind";

/**
 * Escalate or remind on a project's blocked/at-risk stage. Writes in-app
 * notifications (the established PMO bell channel) to the pending approver / owner /
 * responsible, logs an audit entry + an escalation-log row, and sends a branded email.
 *
 * Recipients come from two sources, merged: (1) the concrete people on the stage
 * (owner / pending approver / responsible) and (2) the stage's owner ROLE resolved
 * through the directory/charter — so an escalate still reaches e.g. the CFO or a
 * Steering Committee inbox even when no pmo_approvals row exists. Manual actions
 * ALWAYS email (they ignore the AUTO_ESCALATION_EMAILS master switch).
 */
export async function runCriticalPathAction(
  projectId: number,
  stageKey: string,
  action: EscalateAction,
  subGateKey?: string,
): Promise<{ ok: boolean; notified: number; emailed: number; error?: string }> {
  const cp = await computeStageCriticalPath(projectId);
  if (!cp) return { ok: false, notified: 0, emailed: 0, error: "Project not found" };
  const stage = cp.stages.find((s) => s.key === stageKey);
  if (!stage) return { ok: false, notified: 0, emailed: 0, error: `Unknown stage: ${stageKey}` };
  // For sub-gated stages (Initiation), scope the message to the blocking sub-gate.
  const subGate = subGateKey ? stage.subGates?.find((g) => g.key === subGateKey) : undefined;
  const focusLabel = subGate ? `${stage.label} · ${subGate.label}` : stage.label;
  const focusOverdue = subGate ? subGate.daysOverdue : stage.daysOverdue;
  const focusReasons = subGate ? subGate.blockingReasons : stage.blockingReasons;

  // --- Build the merged recipient set (dedup by userId, then by email) ---------
  const recipients = new Map<string, Recipient>();
  const add = (r: Recipient | null | undefined) => {
    if (!r) return;
    const key = r.userId != null ? `u${r.userId}` : r.email ? `e${r.email.toLowerCase()}` : null;
    if (key) recipients.set(key, r);
  };

  // Concrete people on the stage (id-only — emails fetched below).
  const idOnly = new Set<number>();
  if (action === "escalate" && stage.pendingApprover?.id != null) idOnly.add(stage.pendingApprover.id);
  if (stage.owner?.id != null) idOnly.add(stage.owner.id);
  if (action === "remind" && stage.responsible?.id != null) idOnly.add(stage.responsible.id);
  if (idOnly.size) {
    const rows = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
      .from(usersTable).where(inArray(usersTable.id, [...idOnly]));
    for (const u of rows) add({ userId: u.id, name: u.name, email: u.email ?? null });
  }

  // Role-resolved recipient (covers directory people + group emails, e.g. CFO / SteerCo).
  // On escalate we chase the stage's primary owner role; on remind we also include it so a
  // role-directory person who isn't a pmo_users owner still gets nudged.
  const targetRole = stage.waitingOn?.role ?? "";
  if (targetRole) for (const r of await resolveRole(targetRole, projectId)) add(r);

  const all = [...recipients.values()];
  if (all.length === 0) return { ok: false, notified: 0, emailed: 0, error: "No owner/approver/role to notify" };

  const overdue = focusOverdue > 0 ? ` — ${focusOverdue} day(s) overdue` : "";
  const reasonText = focusReasons.map((r) => (r.detail ? `${r.label}: ${r.detail}` : r.label)).join("; ") || "Pending action";
  const title = action === "escalate"
    ? `Escalation: "${cp.projectName}" blocked at ${focusLabel}`
    : `Reminder: "${cp.projectName}" — ${focusLabel} needs action`;
  const body = `${focusLabel}${overdue}. ${reasonText}.`;
  const link = `/projects/${projectId}`;

  // In-app notifications — only for recipients backed by a pmo_users row.
  const notifiedIds: number[] = [];
  for (const r of all) {
    if (r.userId == null) continue;
    await db.insert(notificationsTable).values({
      userId: r.userId,
      type: action === "escalate" ? "critical_path_escalation" : "critical_path_reminder",
      title,
      body,
      link,
      relatedEntityType: "project",
      relatedEntityId: projectId,
    } as never);
    notifiedIds.push(r.userId);
  }

  // Branded email — manual actions always send (best-effort).
  let emailed = 0;
  for (const r of all) {
    if (!r.email) continue;
    const html = `<p>Hi ${r.name},</p><p><strong>${title}</strong></p><p>${body}</p>` +
      `<p><a href="${link}">Open the project</a> to review and act.</p>`;
    if (await sendEscalationEmail({ to: r.email, subject: title, bodyHtml: html, text: `${title}\n\n${body}\n\n${link}` })) emailed++;
  }

  await logActivity(
    action === "escalate" ? "critical_path_escalated" : "critical_path_reminded",
    `${action === "escalate" ? "Escalated" : "Reminder sent"} on "${cp.projectName}" — "${focusLabel}"${overdue} to ${all.length} recipient(s)`,
    projectId,
    "project",
  );

  // History row (source=manual, tier 0) — powers the SLA-performance dashboard.
  await db.insert(escalationLogTable).values({
    projectId,
    stage: stageKey,
    subGateKey: subGateKey ?? null,
    tier: 0,
    action,
    targetRole,
    recipientIds: notifiedIds,
    emailed,
    source: "manual",
  } as never);

  return { ok: true, notified: notifiedIds.length, emailed };
}
