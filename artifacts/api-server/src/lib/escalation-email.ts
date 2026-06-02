import { logger } from "./logger";

/**
 * Best-effort branded email via the shared backend mailer. The mailer self-loads
 * backend/.env (its own SMTP config), so this works regardless of the api-server
 * process env. Path is resolved relative to this module (cwd-independent, works under
 * both tsx `src/` and compiled `dist/`). NEVER throws — in-app notifications are the
 * primary delivery channel; email is opportunistic.
 *
 * Shared by manual Remind/Escalate (critical-path-actions.ts) and the automated ladder
 * (jobs/stage-escalation-ladder.ts).
 */
export async function sendEscalationEmail(opts: {
  to: string;
  subject: string;
  bodyHtml: string;
  text: string;
}): Promise<boolean> {
  try {
    // src/lib → repo root is six levels up. Cross-tree JS module with no .d.ts —
    // resolved at runtime by tsx; suppress the type-only error.
    // @ts-expect-error - backend/mailer.js is a plain ESM JS module outside this project's rootDir
    const mod = (await import("../../../../../../backend/mailer.js")) as {
      hasEmailConfig?: boolean;
      sendMail?: (a: { to: string; subject: string; html: string; text: string }) => Promise<void>;
      wrapHtml?: (b: string) => string;
    };
    if (!mod?.hasEmailConfig || !mod.sendMail) return false;
    const html = mod.wrapHtml ? mod.wrapHtml(opts.bodyHtml) : opts.bodyHtml;
    await mod.sendMail({ to: opts.to, subject: opts.subject, html, text: opts.text });
    return true;
  } catch (err) {
    logger.warn({ err: String(err) }, "escalation-email: send skipped/failed (notifications still delivered)");
    return false;
  }
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
