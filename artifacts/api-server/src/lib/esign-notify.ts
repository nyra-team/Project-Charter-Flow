import { db, usersTable, notificationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { sendBrandedEmail } from "./mailer";
import { logger } from "./logger";

/**
 * Tell one DOA signer it's their turn to e-sign: in-app bell (when the email
 * maps to a pmo_users row) + branded email with their direct Documenso signing
 * link. Documenso also emails signing links itself (its SMTP is configured) —
 * this is the in-app/PMO-branded duplicate so the request is visible on :5182.
 * Best-effort: never throws.
 */
export async function notifySignerTurn(o: {
  email: string;
  signingUrl?: string;
  kind: "charter" | "nfa";
  entityId: number;
  title: string;
}): Promise<void> {
  const email = o.email.trim().toLowerCase();
  if (!email) return;
  const link = o.kind === "charter" ? `/charters/${o.entityId}` : `/nfas/${o.entityId}`;
  const subject = `Signature requested: ${o.title}`;
  const body = `You are the current approver in the Delegation of Authority chain for "${o.title}". Please review and e-sign.`;

  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (user) {
      await db.insert(notificationsTable).values({
        userId: user.id,
        type: "esign_requested",
        title: subject,
        body,
        link,
        relatedEntityType: o.kind,
        relatedEntityId: o.entityId,
      } as never);
    }
  } catch (err) {
    logger.warn({ err: String(err), email }, "esign-notify: bell insert failed");
  }

  const cta = o.signingUrl
    ? `<p style="margin:16px 0"><a href="${o.signingUrl}" style="background:#0052CC;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">Review &amp; Sign</a></p>`
    : "";
  await sendBrandedEmail({
    to: email,
    subject,
    bodyHtml: `<p>Hi,</p><p><strong>${subject}</strong></p><p>${body}</p>${cta}`,
    text: `${body}${o.signingUrl ? `\n\nSign here: ${o.signingUrl}` : ""}`,
    banner: { emoji: "✍️", title: "e-Signature requested", subtitle: "Delegation of Authority" },
  });
}
