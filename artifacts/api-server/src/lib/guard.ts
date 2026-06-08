import type { Request, Response, NextFunction } from "express";

/**
 * Authorize a request against the caller's REAL Project Hub role
 * (req.user.pmoRole, resolved in requireAuth via derivePmoRole) rather than
 * the old self-selected session.simulatedRole. requireAuth must run before
 * this guard so req.user is populated.
 *
 * Rules:
 *  - No authenticated user            → 401.
 *  - Platform admin (is_super_admin or pmoRole==='admin') → always allowed.
 *  - "initiator" in the allowed list  → any authenticated Project Hub user
 *    is allowed. "initiator" is a per-project relationship (the person who
 *    raised the item), not a directory role, so it can't be derived; it maps
 *    to "any access_pmo user" to preserve the broad create/raise access the
 *    routes that include it (lessons, meetings, change-requests, benefits)
 *    have always had. The privileged paths (decision / baseline / admin
 *    lists) do NOT include "initiator", so they get genuine role enforcement.
 *  - Otherwise the user's role must be in the allowed list.
 */
export function requireRole(...allowed: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Not authenticated." });
      return;
    }

    // Platform admins bypass functional-role checks.
    if (user.isSuperAdmin || user.pmoRole === "admin") { next(); return; }

    // "initiator" = any authenticated Project Hub user (relationship, not role).
    if (allowed.includes("initiator")) { next(); return; }

    if (allowed.includes(user.pmoRole)) { next(); return; }

    res.status(403).json({
      error: `Role '${user.pmoRole}' is not authorized for this action. Allowed: ${allowed.join(", ")}.`,
    });
  };
}

export function requireSession(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }
  next();
}

export function pick<T extends Record<string, unknown>>(src: unknown, keys: readonly (keyof T)[]): Partial<T> {
  const out: Partial<T> = {};
  if (!src || typeof src !== "object") return out;
  const obj = src as Record<string, unknown>;
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, k as string)) {
      (out as Record<string, unknown>)[k as string] = obj[k as string];
    }
  }
  return out;
}
