import type { Request, Response, NextFunction } from "express";
import { getMasterDb } from "../lib/masterDb";

export interface PmoUser {
  authUserId: string;
  email: string;
  employeeId: string | null;
  employeeCode: string | null;
  fullName: string | null;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  accessPmo: boolean;
  /** Per-app role from employee_auth.pmo_role. NULL = regular Project Hub
   *  user; 'admin' = PMO admin (grants access to /api/admin/* routes). */
  pmoRole: "admin" | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: PmoUser;
    }
  }
}

/**
 * Paths that bypass auth entirely. Mirrors the public-routes pattern from
 * backend/recruit/server.js. Anything not listed here requires a valid JWT
 * + access_pmo (or is_super_admin) to proceed.
 */
const PUBLIC_PATHS = new Set<string>([
  "/healthz",
]);

/**
 * Dev-only paths that stay open under NODE_ENV !== 'production' so the
 * simulated-role tooling in routes/session.ts keeps working during demos.
 */
const DEV_PUBLIC_PATHS = new Set<string>([
  "/session/role",
]);

function isPublic(path: string): boolean {
  if (PUBLIC_PATHS.has(path)) return true;
  if (process.env["NODE_ENV"] !== "production" && DEV_PUBLIC_PATHS.has(path)) return true;
  return false;
}

/**
 * JWT-bearer auth middleware against the Master Employee DB.
 *
 * Mirrors the pattern used by backend/recruit + backend/pms + backend/ohc:
 *   1. Read Bearer token from Authorization header.
 *   2. masterDb.auth.getUser(token) → validates signature/expiry, returns user.
 *   3. Join employees + employee_auth by email (case-insensitive) to resolve
 *      the employee profile + per-app access flags.
 *   4. Gate on access_pmo OR is_super_admin. Anything else → 403.
 *   5. Populate req.user with the resolved profile.
 *
 * Returns 401 on missing/invalid token so the frontend fetch interceptor
 * can fire the 'granules:session-expired' event.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (isPublic(req.path)) { next(); return; }

  const authHeader = req.header("authorization") ?? req.header("Authorization");
  const token = authHeader?.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : null;

  if (!token) {
    res.status(401).json({ error: "Missing bearer token" });
    return;
  }

  let masterDb;
  try {
    masterDb = getMasterDb();
  } catch (err) {
    req.log?.error({ err }, "Master DB client misconfigured");
    res.status(500).json({ error: "Auth backend not configured" });
    return;
  }

  const { data: authData, error: authError } = await masterDb.auth.getUser(token);
  if (authError || !authData?.user?.email) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }
  const authUser = authData.user;
  const emailLower = authUser.email!.toLowerCase();

  // Master DB `employees` table has split name columns (first_name /
  // middle_name / last_name), not a single full_name. Pull all three and
  // compose at use-time. The previous "full_name" select threw 42703 and
  // 500'd every auth-gated request.
  const { data: employee, error: empError } = await masterDb
    .from("employees")
    .select("id, employee_code, first_name, middle_name, last_name, office_email, employee_auth!inner(access_pmo, pmo_role, is_admin, is_super_admin)")
    .ilike("office_email", emailLower)
    .maybeSingle();

  if (empError) {
    req.log?.error({ err: empError }, "Employee lookup failed");
    res.status(500).json({ error: "Profile lookup failed" });
    return;
  }
  if (!employee) {
    res.status(403).json({ error: "No employee record for this account" });
    return;
  }

  const authRow = Array.isArray(employee.employee_auth)
    ? employee.employee_auth[0]
    : employee.employee_auth;
  const accessPmo: boolean = !!authRow?.access_pmo;
  const isSuperAdmin: boolean = !!authRow?.is_super_admin;
  const isAdmin: boolean = !!authRow?.is_admin;
  const pmoRole: "admin" | null = authRow?.pmo_role === "admin" ? "admin" : null;

  if (!accessPmo && !isSuperAdmin) {
    res.status(403).json({ error: "Project Hub access not granted" });
    return;
  }

  // Compose fullName from the split columns. Empty middle drops cleanly.
  const composedFullName = [employee.first_name, employee.middle_name, employee.last_name]
    .filter((p): p is string => !!p && p.trim().length > 0)
    .join(" ")
    .trim() || null;

  req.user = {
    authUserId: authUser.id,
    email: authUser.email!,
    employeeId: employee.id ?? null,
    employeeCode: employee.employee_code ?? null,
    fullName: composedFullName,
    isAdmin,
    isSuperAdmin,
    accessPmo,
    pmoRole,
  };
  next();
}

/**
 * Companion middleware for admin-only routes. Mirrors the ADMIN_ROUTES
 * pattern in backend/recruit/server.js — must run AFTER requireAuth, so
 * `req.user` is already populated.
 *
 * Allows the request through if the user is either a super-admin
 * (cross-app) or has pmo_role === 'admin'. Otherwise 403.
 *
 * Usage:
 *   router.use("/admin", requireAdmin);
 *   router.post("/admin/scoring", handler);
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  if (req.user.isSuperAdmin || req.user.pmoRole === "admin") {
    next();
    return;
  }
  res.status(403).json({ error: "Project Hub admin role required" });
}
