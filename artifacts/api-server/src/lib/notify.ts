import { db, notificationsTable, projectsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import type { Recipient } from "./role-resolver";
import { sendBrandedEmail, sendPlainEmail, type EmailBanner } from "./mailer";

/**
 * One call fans an event out to every channel: in-app bell notifications (primary,
 * per recipient with a pmo_users row), branded email per recipient with an email,
 * and ONE plain email to the project's Teams channel address (Teams renders it as
 * a channel post). Email/Teams are best-effort — notify() never throws.
 *
 * Route handlers should use notifyDetached() AFTER res.json(...) so sends never
 * block the API response; background jobs may await notify() directly.
 */

export type NotifyOptions = {
  projectId: number;
  /** pmo_notifications.type, e.g. "task_added" | "task_completed" | "effort_overrun" */
  type: string;
  /** In-app title AND email subject AND Teams post title. */
  title: string;
  body: string;
  /** In-app relative link; defaults to `/projects/${projectId}`. */
  link?: string;
  relatedEntityType?: string;
  relatedEntityId?: number;
  recipients?: Recipient[];
  email?: {
    /** Default true. Jobs pass autoEscalationEmailsEnabled(). */
    enabled?: boolean;
    banner?: EmailBanner;
    /** Override the default title+body email HTML. */
    bodyHtml?: string;
  };
  teams?: {
    /** Default true. */
    enabled?: boolean;
    /** Override; default = the project's teams_channel_email column. */
    channelEmail?: string | null;
  };
};

/** Absolute link base for email/Teams (relative links don't resolve there). */
function absoluteLink(link: string): string {
  const base = (process.env.PMO_BASE_URL ?? "https://pmo.granulesrecruit.com").replace(/\/$/, "");
  return link.startsWith("http") ? link : `${base}${link}`;
}

/** Dedup by userId, then by email (same policy as critical-path-actions). */
function dedupe(recipients: Recipient[]): Recipient[] {
  const map = new Map<string, Recipient>();
  for (const r of recipients) {
    const key = r.userId != null ? `u${r.userId}` : r.email ? `e${r.email.toLowerCase()}` : null;
    if (key) map.set(key, r);
  }
  return [...map.values()];
}

export async function notify(
  o: NotifyOptions,
): Promise<{ notified: number; emailed: number; teams: boolean }> {
  const link = o.link ?? `/projects/${o.projectId}`;
  const recipients = dedupe(o.recipients ?? []);
  let notified = 0;
  let emailed = 0;
  let teams = false;

  // 1. In-app bell — the primary channel.
  for (const r of recipients) {
    if (r.userId == null) continue;
    try {
      await db.insert(notificationsTable).values({
        userId: r.userId,
        type: o.type,
        title: o.title,
        body: o.body,
        link,
        relatedEntityType: o.relatedEntityType ?? "project",
        relatedEntityId: o.relatedEntityId ?? o.projectId,
      } as never);
      notified++;
    } catch (err) {
      logger.warn({ err: String(err), userId: r.userId }, "notify: in-app insert failed");
    }
  }

  // 2. Branded email per recipient.
  if (o.email?.enabled !== false) {
    const href = absoluteLink(link);
    for (const r of recipients) {
      if (!r.email) continue;
      const bodyHtml =
        o.email?.bodyHtml ??
        `<p>Hi ${r.name},</p><p><strong>${o.title}</strong></p><p>${o.body}</p>` +
          `<p><a href="${href}">Open the project</a> to review.</p>`;
      if (
        await sendBrandedEmail({
          to: r.email,
          subject: o.title,
          bodyHtml,
          text: `${o.title}\n\n${o.body}\n\n${href}`,
          banner: o.email?.banner,
        })
      )
        emailed++;
    }
  }

  // 3. One plain email to the project's Teams channel address.
  if (o.teams?.enabled !== false) {
    try {
      let channelEmail = o.teams?.channelEmail;
      if (channelEmail === undefined) {
        const [p] = await db
          .select({ teamsChannelEmail: projectsTable.teamsChannelEmail })
          .from(projectsTable)
          .where(eq(projectsTable.id, o.projectId));
        channelEmail = p?.teamsChannelEmail ?? null;
      }
      if (channelEmail) {
        const href = absoluteLink(link);
        teams = await sendPlainEmail({
          to: channelEmail,
          subject: o.title,
          html: `<p><strong>${o.title}</strong></p><p>${o.body}</p><p><a href="${href}">Open in Project Hub</a></p>`,
          text: `${o.title}\n\n${o.body}\n\n${href}`,
        });
      }
    } catch (err) {
      logger.warn({ err: String(err), projectId: o.projectId }, "notify: teams mirror failed");
    }
  }

  return { notified, emailed, teams };
}

/** Fire-and-forget wrapper for route handlers — call after res.json(...). */
export function notifyDetached(o: NotifyOptions): void {
  void notify(o).catch((err) => logger.warn({ err: String(err), type: o.type }, "notify: failed"));
}
