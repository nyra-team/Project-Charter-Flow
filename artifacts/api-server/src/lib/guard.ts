import type { Request, Response, NextFunction } from "express";

export function requireRole(...allowed: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const role = req.session?.simulatedRole;
    if (!role) {
      res.status(403).json({ error: "No role set in session. Select a role to perform this action." });
      return;
    }
    if (!allowed.includes(role)) {
      res.status(403).json({
        error: `Role '${role}' is not authorized for this action. Allowed: ${allowed.join(", ")}.`,
      });
      return;
    }
    next();
  };
}

export function requireSession(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.simulatedRole) {
    res.status(403).json({ error: "No role set in session." });
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
