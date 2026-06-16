import { logger } from "./logger";

/**
 * Bridge to the shared backend mailer (backend/shared/mailer.js) — the single
 * cross-tree import in this app. Reads SMTP_* / FROM_* from process env (sourced
 * from apps/pmo/.env by start_app.sh), sends as nyra@granulesindia.com.
 *
 * Bundling note: esbuild inlines the mailer into dist/index.mjs, so its
 * __dirname-relative logo path resolves to apps/pmo/artifacts/public/ — the
 * GRANULES.White.email.png copy there is required for branded sends (build.mjs
 * copies it). NEVER throws — email/Teams are opportunistic channels; in-app
 * notifications are the primary delivery.
 */

type SharedMailer = {
  hasEmailConfig?: () => boolean;
  sendMail?: (a: {
    to: string;
    subject: string;
    html?: string;
    text?: string;
    fromName?: string;
  }) => Promise<unknown>;
  wrapHtml?: (body: string, opts?: { appLabel?: string }) => string;
  bannerBlock?: (o: { emoji?: string; title?: string; subtitle?: string; color?: string }) => string;
};

async function getMailer(): Promise<SharedMailer | null> {
  try {
    // src/lib → repo root is six levels up. Cross-tree JS module with no .d.ts.
    // @ts-expect-error - backend/shared/mailer.js is a plain ESM JS module outside this project's rootDir
    const mod = (await import("../../../../../../backend/shared/mailer.js")) as SharedMailer;
    if (!mod?.hasEmailConfig?.() || !mod.sendMail) return null;
    return mod;
  } catch (err) {
    logger.warn({ err: String(err) }, "mailer: shared mailer unavailable");
    return null;
  }
}

export type EmailBanner = { emoji?: string; title?: string; subtitle?: string; color?: string };

/**
 * Branded mail to a person: Granules template (logo header + footer) with an
 * optional colored banner. Returns false (never throws) when unconfigured/failed.
 */
export async function sendBrandedEmail(o: {
  to: string;
  subject: string;
  bodyHtml: string;
  text: string;
  banner?: EmailBanner;
}): Promise<boolean> {
  try {
    const m = await getMailer();
    if (!m?.sendMail) return false;
    const banner = o.banner && m.bannerBlock ? m.bannerBlock(o.banner) : "";
    const html = m.wrapHtml ? m.wrapHtml(banner + o.bodyHtml, { appLabel: "PMO Project Hub" }) : o.bodyHtml;
    await m.sendMail({ to: o.to, subject: o.subject, html, text: o.text, fromName: "Granules PMO" });
    return true;
  } catch (err) {
    logger.warn({ err: String(err), to: o.to }, "mailer: branded send skipped/failed");
    return false;
  }
}

/**
 * Plain short HTML mail — for Teams channel addresses, which render the email as
 * a channel post (the 600px branded table + inline-image attachment render badly
 * there). Returns false (never throws) when unconfigured/failed.
 */
export async function sendPlainEmail(o: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<boolean> {
  try {
    const m = await getMailer();
    if (!m?.sendMail) return false;
    await m.sendMail({ to: o.to, subject: o.subject, html: o.html, text: o.text, fromName: "Granules PMO" });
    return true;
  } catch (err) {
    logger.warn({ err: String(err), to: o.to }, "mailer: plain send skipped/failed");
    return false;
  }
}
