import { sendBrandedEmail } from "./mailer";

/**
 * Best-effort branded email via the shared backend mailer (see lib/mailer.ts for
 * the cross-tree/bundling details). NEVER throws — in-app notifications are the
 * primary delivery channel; email is opportunistic.
 *
 * Shared by manual Remind/Escalate (critical-path-actions.ts) and the automated
 * ladder (jobs/stage-escalation-ladder.ts).
 */
export async function sendEscalationEmail(opts: {
  to: string;
  subject: string;
  bodyHtml: string;
  text: string;
}): Promise<boolean> {
  return sendBrandedEmail({
    to: opts.to,
    subject: opts.subject,
    bodyHtml: opts.bodyHtml,
    text: opts.text,
    banner: { emoji: "🚩", title: opts.subject, color: "amber" },
  });
}

/**
 * Master switch for AUTOMATED escalation emails (the hourly ladder). Manual
 * Remind/Escalate buttons ALWAYS email and ignore this flag. Default OFF so a fresh
 * deploy never surprises executives with mail until an admin opts in.
 * Set AUTO_ESCALATION_EMAILS=on (or true/1) in the api-server env.
 */
export function autoEscalationEmailsEnabled(): boolean {
  const v = (process.env.AUTO_ESCALATION_EMAILS ?? "").trim().toLowerCase();
  return v === "on" || v === "true" || v === "1" || v === "yes";
}
