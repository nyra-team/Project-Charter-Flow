import type { Request, Response, NextFunction } from "express";
import { db, roleOverridesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getMasterDb } from "../lib/masterDb";
import { derivePmoRole, type PmoRole } from "../lib/derivePmoRole";
import { recordMcpWrite } from "../lib/mcpActivity";

export interface PmoUser {
  authUserId: string;
  email: string;
  employeeId: string | null;
  employeeCode: string | null;
  fullName: string | null;
  /** Master-DB org-unit short code (e.g. "F1"/"A1"/"GLS") of the employee's
   *  plant/site — lets the frontend default the "Plant" picker to the creator's
   *  own plant. Null when the master record has no unit. Matches org_units.code
   *  (the same source /api/plants serves). */
  unitCode: string | null;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  accessPmo: boolean;
  /** Functional Project Hub role, resolved in requireAuth via
   *  derivePmoRole(): an explicit employee_auth.pmo_role override wins,
   *  else it's derived from the master directory (designation / function /
   *  grade). 'admin' still gates /api/admin/* via requireAdmin; the other
   *  values (chairman, executive_director, cfo, pmo, pm, hod, scm, finance,
   *  team_member) drive requireRole() on functional routes. */
  pmoRole: PmoRole;
  /** True ⇒ this user sees EVERY project (Chairman / Executive Director /
   *  Transformation team / platform admin). False ⇒ scoped to own projects.
   *  Resolved from the master employee DB (designation + function). */
  seeAllProjects: boolean;
  /** True when resolved via the PMO_MCP service token (act-as path) rather
   *  than a real JWT login. Routes can treat it as a normal user; this flag
   *  exists for auditing / future restrictions. */
  viaServiceToken?: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: PmoUser;
    }
  }
}

type LogLike = { error: (obj: unknown, msg?: string) => void } | undefined;

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
 * Master-DB `employees.function` values whose holders see EVERY project (the
 * Transformation Division / PMO team). Lowercased. Extend here if HR adds
 * sibling function labels (e.g. a "Transformation Office").
 */
const SEE_ALL_FUNCTIONS = new Set<string>(["transformation"]);

/**
 * Resolve a master-DB employee (by office email OR employee code) into a fully
 * populated PmoUser — the per-app access gate, functional pmoRole (override →
 * derived), and portfolio visibility. Shared by the JWT-bearer path and the
 * PMO_MCP service-token "act-as" path so both produce identical identities.
 */
async function resolvePmoUser(
  masterDb: ReturnType<typeof getMasterDb>,
  filter: { email: string } | { code: string },
  authUserId: string,
  log: LogLike,
  viaServiceToken: boolean,
): Promise<{ user: PmoUser } | { error: { status: number; message: string } }> {
  const base = masterDb
    .from("employees")
    .select("id, employee_code, first_name, middle_name, last_name, office_email, designation_text, business_designation, function, sub_function, grade_code, unit_code, employee_auth!inner(access_pmo, pmo_role, is_admin, is_super_admin)");
  const { data: employee, error: empError } = await (
    "code" in filter ? base.eq("employee_code", filter.code) : base.ilike("office_email", filter.email)
  ).maybeSingle();

  if (empError) {
    log?.error({ err: empError }, "Employee lookup failed");
    return { error: { status: 500, message: "Profile lookup failed" } };
  }
  if (!employee) {
    return { error: { status: 403, message: "No employee record for this account" } };
  }

  const authRow = Array.isArray(employee.employee_auth) ? employee.employee_auth[0] : employee.employee_auth;
  const accessPmo: boolean = !!authRow?.access_pmo;
  const isSuperAdmin: boolean = !!authRow?.is_super_admin;
  const isAdmin: boolean = !!authRow?.is_admin;

  // Functional role override (Recruit DB pmo_role_overrides wins; falls back to
  // master employee_auth.pmo_role). A Recruit-DB hiccup must not break auth.
  let overrideRole: string | null = null;
  if (employee.employee_code) {
    try {
      const [row] = await db.select({ pmoRole: roleOverridesTable.pmoRole })
        .from(roleOverridesTable)
        .where(eq(roleOverridesTable.employeeCode, employee.employee_code));
      overrideRole = row?.pmoRole ?? null;
    } catch (err) {
      log?.error({ err }, "pmo_role_overrides lookup failed; using master pmo_role only");
    }
  }

  const pmoRole: PmoRole = derivePmoRole(
    {
      designation_text: employee.designation_text ?? null,
      business_designation: employee.business_designation ?? null,
      function: employee.function ?? null,
      sub_function: employee.sub_function ?? null,
      grade_code: employee.grade_code ?? null,
    },
    {
      access_pmo: accessPmo,
      pmo_role: overrideRole ?? authRow?.pmo_role ?? null,
    },
  );

  if (!accessPmo && !isSuperAdmin) {
    return { error: { status: 403, message: "Project Hub access not granted" } };
  }

  const fn = (employee.function ?? "").trim().toLowerCase();
  const seeAllProjects =
    isSuperAdmin ||
    pmoRole === "admin" ||
    pmoRole === "chairman" ||
    pmoRole === "executive_director" ||
    SEE_ALL_FUNCTIONS.has(fn);

  const composedFullName = [employee.first_name, employee.middle_name, employee.last_name]
    .filter((p): p is string => !!p && p.trim().length > 0)
    .join(" ")
    .trim() || null;

  return {
    user: {
      authUserId,
      email: employee.office_email ?? ("email" in filter ? filter.email : ""),
      employeeId: employee.id ?? null,
      employeeCode: employee.employee_code ?? null,
      fullName: composedFullName,
      unitCode: (employee.unit_code ?? "").trim() || null,
      isAdmin,
      isSuperAdmin,
      accessPmo,
      pmoRole,
      seeAllProjects,
      viaServiceToken,
    },
  };
}

/**
 * JWT-bearer auth middleware against the Master Employee DB.
 *
 *   1. PMO_MCP service-token "act-as" path (X-PMO-Service-Token + X-PMO-Actor) —
 *      a trusted server (the PMO MCP) writes as a real employee; attribution stays
 *      truthful. Gated by the shared secret + optional PMO_MCP_ACTORS allowlist.
 *   2. Otherwise read Bearer token → masterDb.auth.getUser → resolve employee.
 *
 * Returns 401 on missing/invalid token so the frontend fetch interceptor
 * can fire the 'granules:session-expired' event.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (isPublic(req.path)) { next(); return; }

  // ── (1) Service-token "act-as" path (PMO MCP / automation) ────────────────
  const serviceToken = req.header("x-pmo-service-token");
  const expectedServiceToken = process.env["PMO_MCP_TOKEN"];
  if (serviceToken && expectedServiceToken && serviceToken === expectedServiceToken) {
    const actor = (req.header("x-pmo-actor") || "").trim();
    if (!actor) { res.status(401).json({ error: "X-PMO-Actor (employee code or office email) required with service token" }); return; }
    // Fail CLOSED: the service token may only act as employees listed in
    // PMO_MCP_ACTORS (comma-separated employee codes, or "*" for any). Empty/unset
    // ⇒ refuse. Even with "*", resolvePmoUser still enforces access_pmo below, so a
    // non-PMO employee can never be impersonated.
    const allow = (process.env["PMO_MCP_ACTORS"] || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!allow.length) {
      res.status(503).json({ error: "PMO service token is configured but PMO_MCP_ACTORS allowlist is empty — refusing to act as any employee." });
      return;
    }
    const wildcardActors = allow.includes("*");
    let masterDb;
    try { masterDb = getMasterDb(); } catch (err) {
      req.log?.error({ err }, "Master DB client misconfigured");
      res.status(500).json({ error: "Auth backend not configured" });
      return;
    }
    const resolved = await resolvePmoUser(
      masterDb,
      actor.includes("@") ? { email: actor.toLowerCase() } : { code: actor },
      `service:${actor}`,
      req.log,
      true,
    );
    if ("error" in resolved) { res.status(resolved.error.status).json({ error: resolved.error.message }); return; }
    if (!wildcardActors && !(resolved.user.employeeCode && allow.includes(resolved.user.employeeCode))) {
      res.status(403).json({ error: "Actor not in PMO_MCP_ACTORS allowlist" });
      return;
    }
    req.user = resolved.user;
    if (req.method === "POST" || req.method === "PUT" || req.method === "PATCH" || req.method === "DELETE") {
      recordMcpWrite(resolved.user.employeeCode, resolved.user.fullName, req.method, req.path);
    }
    next();
    return;
  }

  // ── (2) Standard JWT-bearer path ──────────────────────────────────────────
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

  const resolved = await resolvePmoUser(masterDb, { email: emailLower }, authUser.id, req.log, false);
  if ("error" in resolved) { res.status(resolved.error.status).json({ error: resolved.error.message }); return; }
  req.user = resolved.user;
  next();
}

/**
 * Companion middleware for admin-only routes. Mirrors the ADMIN_ROUTES
 * pattern in backend/recruit/server.js — must run AFTER requireAuth, so
 * `req.user` is already populated.
 *
 * Allows the request through if the user is either a super-admin
 * (cross-app) or has pmo_role === 'admin'. Otherwise 403.
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

/**
 * Stricter companion for the RBAC surface itself (/admin/roles): only
 * cross-app super-admins (employee_auth.is_super_admin) may view or edit
 * employee roles/access. pmo_role='admin' or is_admin is deliberately NOT
 * enough here. Must run AFTER requireAuth.
 */
export function requireSuperAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  if (req.user.isSuperAdmin) {
    next();
    return;
  }
  res.status(403).json({ error: "Super admin required" });
}
