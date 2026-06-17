import { createHmac, timingSafeEqual } from "node:crypto";

// Per-document share token = HMAC(secret, doc id). Stateless (no DB column):
// anyone holding `/api/documents/:id/raw?t=<token>` can WRITE a new version,
// exactly like a Google-Drive "anyone with the link can edit" share. Only a
// logged-in PMO user can mint the token (GET /api/documents/:id/share), then
// shares the link. Rotating PMO_DOC_PUSH_TOKEN revokes every editor link.
function shareSecret(): string {
  return process.env.PMO_DOC_PUSH_TOKEN || "";
}

export function docShareToken(id: number): string {
  const secret = shareSecret();
  if (!secret) return "";
  return createHmac("sha256", secret).update(`doc:${id}`).digest("hex").slice(0, 32);
}

/** Constant-time check that a presented token matches the doc's share token. */
export function isValidShareToken(id: number, presented: string | undefined): boolean {
  const expected = docShareToken(id);
  if (!expected || !presented || presented.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(presented), Buffer.from(expected));
  } catch {
    return false;
  }
}
