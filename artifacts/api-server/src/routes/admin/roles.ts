import { Router, type IRouter } from "express";
import { db, roleOverridesTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { getMasterDb } from "../../lib/masterDb";
import { derivePmoRole, PMO_ROLES, type PmoRole } from "../../lib/derivePmoRole";
import { recordRoleChange, getRecentRoleChanges } from "../../lib/approvalsAudit";

// Super-admin-only RBAC surface (mounted behind requireSuperAdmin in
// routes/index.ts). Lists every active employee from the master directory
// with their effective Project Hub role, and edits the role override +
// PMO access per employee.
//
// Write targets (see Step-0 probe / pmo_role_overrides schema comment):
//   access_pmo            → master DB employee_auth (plain boolean)
//   role override 'admin' → master DB employee_auth.pmo_role (the only
//                           value the live CHECK constraint accepts)
//   any other override    → Recruit DB pmo_role_overrides
// The two override stores are kept mutually exclusive on every PATCH.

const router: IRouter = Router();

const EMPLOYEE_COLS =
  "id, employee_code, first_name, middle_name, last_name, office_email, designation_text, business_designation, function, sub_function, grade_code, photo_url";
const AUTH_EMBED = "employee_auth(access_pmo, pmo_role, is_admin, is_super_admin)";
const AUTH_EMBED_INNER = "employee_auth!inner(access_pmo, pmo_role, is_admin, is_super_admin)";

interface MasterRow {
  id: string;
  employee_code: string | null;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  office_email: string | null;
  designation_text: string | null;
  business_designation: string | null;
  function: string | null;
  sub_function: string | null;
  grade_code: string | null;
  photo_url: string | null;
  employee_auth:
    | { access_pmo: boolean | null; pmo_role: string | null; is_admin: boolean | null; is_super_admin: boolean | null }
    | Array<{ access_pmo: boolean | null; pmo_role: string | null; is_admin: boolean | null; is_super_admin: boolean | null }>
    | null;
}

function authOf(row: MasterRow) {
  return (Array.isArray(row.employee_auth) ? row.employee_auth[0] : row.employee_auth) ?? null;
}

function fullName(row: MasterRow): string {
  return [row.first_name, row.middle_name, row.last_name]
    .filter((p): p is string => !!p && p.trim().length > 0)
    .join(" ")
    .trim();
}

/** Shape one wire row: effective role = override (recruit table > master col) or derived. */
function toWireRow(row: MasterRow, overrideRole: string | null) {
  const auth = authOf(row);
  const masterOverride = auth?.pmo_role && auth.pmo_role !== "null" ? auth.pmo_role : null;
  const effOverride = overrideRole ?? masterOverride;
  const effectiveRole = derivePmoRole(
    {
      designation_text: row.designation_text,
      business_designation: row.business_designation,
      function: row.function,
      sub_function: row.sub_function,
      grade_code: row.grade_code,
    },
    { access_pmo: !!auth?.access_pmo, pmo_role: effOverride },
  );
  return {
    employeeId: row.id,
    employeeCode: row.employee_code,
    fullName: fullName(row),
    designation: row.designation_text ?? row.business_designation ?? null,
    function: row.function ?? null,
    gradeCode: row.grade_code ?? null,
    officeEmail: row.office_email ?? null,
    photoUrl: row.photo_url ?? null,
    accessPmo: !!auth?.access_pmo,
    isSuperAdmin: !!auth?.is_super_admin,
    roleOverride: effOverride,
    effectiveRole,
    roleSource: effOverride ? ("override" as const) : ("derived" as const),
  };
}

/** Bulk-fetch recruit-DB overrides for a page of employee codes. */
async function fetchOverrides(codes: string[]): Promise<Map<string, string>> {
  if (!codes.length) return new Map();
  const rows = await db
    .select({ employeeCode: roleOverridesTable.employeeCode, pmoRole: roleOverridesTable.pmoRole })
    .from(roleOverridesTable)
    .where(inArray(roleOverridesTable.employeeCode, codes));
  return new Map(rows.map(r => [r.employeeCode, r.pmoRole]));
}

// ─── GET /api/admin/roles?search=&page=1&pageSize=50&filter=all|pmo_only ────

router.get("/", async (req, res): Promise<void> => {
  const search = String(req.query.search ?? "").trim();
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));
  const filter = req.query.filter === "pmo_only" ? "pmo_only" : "all";

  let masterDb;
  try {
    masterDb = getMasterDb();
  } catch (err) {
    res.status(503).json({ error: `Master DB unavailable: ${(err as Error).message}` });
    return;
  }

  // pmo_only needs an inner join so the embedded-column filter actually
  // narrows the employee rows; 'all' keeps a left join (employees without
  // an employee_auth row still show, as access_pmo=false).
  let q = masterDb
    .from("employees")
    .select(`${EMPLOYEE_COLS}, ${filter === "pmo_only" ? AUTH_EMBED_INNER : AUTH_EMBED}`, { count: "exact" })
    .eq("employment_status", "Active");
  if (filter === "pmo_only") q = q.eq("employee_auth.access_pmo", true);
  if (search) {
    const term = search.replace(/[%,()]/g, "");
    const tokens = term.split(/\s+/).filter(Boolean);
    if (tokens.length >= 2) {
      // "Sreeram Prudhvi" pattern — first token vs first_name, last vs
      // last_name (same tokenisation as routes/employees.ts).
      q = q.ilike("first_name", `%${tokens[0]}%`).ilike("last_name", `%${tokens[tokens.length - 1]}%`);
    } else {
      q = q.or(
        `first_name.ilike.%${term}%,last_name.ilike.%${term}%,employee_code.ilike.%${term}%,designation_text.ilike.%${term}%,office_email.ilike.%${term}%`,
      );
    }
  }

  const from = (page - 1) * pageSize;
  const { data, error, count } = await q.order("first_name").range(from, from + pageSize - 1);
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  const rows = (data ?? []) as unknown as MasterRow[];
  const codes = rows.map(r => r.employee_code).filter((c): c is string => !!c);
  let overrides: Map<string, string>;
  try {
    overrides = await fetchOverrides(codes);
  } catch (err) {
    req.log?.error({ err }, "pmo_role_overrides bulk lookup failed");
    overrides = new Map();
  }

  res.json({
    rows: rows.map(r => toWireRow(r, r.employee_code ? overrides.get(r.employee_code) ?? null : null)),
    total: count ?? rows.length,
    page,
    pageSize,
    roles: PMO_ROLES,
  });
});

// ─── GET /api/admin/roles/recent — audit-trail panel ────────────────────────

router.get("/recent", async (req, res): Promise<void> => {
  try {
    res.json(await getRecentRoleChanges(Math.min(100, Number(req.query.limit) || 25)));
  } catch (err) {
    req.log?.error({ err }, "recent role changes lookup failed");
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── PATCH /api/admin/roles/:employeeCode  { pmoRole?, accessPmo? } ─────────

router.patch("/:employeeCode", async (req, res): Promise<void> => {
  const employeeCode = String(req.params.employeeCode ?? "").trim();
  const body = (req.body ?? {}) as { pmoRole?: string | null; accessPmo?: boolean };
  const wantsRole = Object.prototype.hasOwnProperty.call(body, "pmoRole");
  const wantsAccess = Object.prototype.hasOwnProperty.call(body, "accessPmo");

  if (!employeeCode || (!wantsRole && !wantsAccess)) {
    res.status(400).json({ error: "Provide pmoRole and/or accessPmo" });
    return;
  }
  if (wantsRole && body.pmoRole !== null && !(PMO_ROLES as readonly string[]).includes(body.pmoRole as string)) {
    res.status(400).json({ error: `pmoRole must be null or one of: ${PMO_ROLES.join(", ")}` });
    return;
  }
  if (wantsAccess && typeof body.accessPmo !== "boolean") {
    res.status(400).json({ error: "accessPmo must be a boolean" });
    return;
  }

  let masterDb;
  try {
    masterDb = getMasterDb();
  } catch (err) {
    res.status(503).json({ error: `Master DB unavailable: ${(err as Error).message}` });
    return;
  }

  const { data: empData, error: empErr } = await masterDb
    .from("employees")
    .select(`${EMPLOYEE_COLS}, ${AUTH_EMBED}`)
    .eq("employee_code", employeeCode)
    .maybeSingle();
  if (empErr) {
    res.status(500).json({ error: empErr.message });
    return;
  }
  const emp = empData as unknown as MasterRow | null;
  if (!emp) {
    res.status(404).json({ error: `No employee with code ${employeeCode}` });
    return;
  }
  const auth = authOf(emp);

  let beforeOverride: string | null = null;
  try {
    beforeOverride = (await fetchOverrides([employeeCode])).get(employeeCode) ?? null;
  } catch { /* audit-only detail; proceed */ }
  const before = toWireRow(emp, beforeOverride);

  // ── access_pmo → master employee_auth ─────────────────────────────────────
  if (wantsAccess) {
    const { data: updated, error: updErr } = await masterDb
      .from("employee_auth")
      .update({ access_pmo: body.accessPmo })
      .eq("employee_id", emp.id)
      .select("id");
    if (updErr) {
      res.status(500).json({ error: `access_pmo update failed: ${updErr.message}` });
      return;
    }
    if (!updated?.length) {
      // No auth row yet (employee never enrolled in any app) — create one.
      const { error: insErr } = await masterDb
        .from("employee_auth")
        .insert({ employee_id: emp.id, access_pmo: body.accessPmo });
      if (insErr) {
        res.status(500).json({ error: `access_pmo insert failed: ${insErr.message}` });
        return;
      }
    }
  }

  // ── role override → split across the two stores ───────────────────────────
  if (wantsRole) {
    const role = body.pmoRole as PmoRole | null;
    const masterValue = role === "admin" ? "admin" : null;
    const { error: roleErr } = await masterDb
      .from("employee_auth")
      .update({ pmo_role: masterValue })
      .eq("employee_id", emp.id);
    if (roleErr) {
      res.status(500).json({ error: `pmo_role update failed: ${roleErr.message}` });
      return;
    }
    try {
      if (role && role !== "admin") {
        await db
          .insert(roleOverridesTable)
          .values({
            employeeCode,
            pmoRole: role,
            updatedBy: req.user?.employeeCode ?? null,
            updatedByName: req.user?.fullName ?? req.user?.email ?? null,
          })
          .onConflictDoUpdate({
            target: roleOverridesTable.employeeCode,
            set: {
              pmoRole: role,
              updatedBy: req.user?.employeeCode ?? null,
              updatedByName: req.user?.fullName ?? req.user?.email ?? null,
              updatedAt: new Date(),
            },
          });
      } else {
        await db.delete(roleOverridesTable).where(eq(roleOverridesTable.employeeCode, employeeCode));
      }
    } catch (err) {
      res.status(500).json({ error: `role override write failed: ${(err as Error).message}` });
      return;
    }
  }

  // Re-read both stores so the response reflects what actually landed.
  const { data: freshData } = await masterDb
    .from("employees")
    .select(`${EMPLOYEE_COLS}, ${AUTH_EMBED}`)
    .eq("employee_code", employeeCode)
    .maybeSingle();
  let afterOverride: string | null = null;
  try {
    afterOverride = (await fetchOverrides([employeeCode])).get(employeeCode) ?? null;
  } catch { /* non-fatal */ }
  const after = toWireRow((freshData as unknown as MasterRow) ?? emp, afterOverride);

  // Audit trail through the generic approval engine (auto-approved request,
  // per user decision). Fire-and-forget: an engine hiccup must not roll back
  // or fail the change itself.
  if (req.user) {
    void recordRoleChange({
      editor: req.user,
      targetEmployeeCode: employeeCode,
      targetName: after.fullName,
      before: { roleOverride: before.roleOverride, effectiveRole: before.effectiveRole, accessPmo: before.accessPmo },
      after: { roleOverride: after.roleOverride, effectiveRole: after.effectiveRole, accessPmo: after.accessPmo },
    }).catch(err => req.log?.error({ err }, "role-change audit record failed"));
  }

  res.json(after);
});

export default router;
