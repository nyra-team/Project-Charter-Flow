import { Router, type IRouter } from "express";
import { getMasterDb } from "../lib/masterDb";
import { CMD, CMD_REPORTS, type LeaderSeed } from "../lib/cmdReports";

const router: IRouter = Router();

// Shape returned to the wire (camelCase, masked to safe fields).
type LeaderCard = {
  code: string;
  name: string;
  role: string;
  designation: string | null;
  officeEmail: string | null;
  photoUrl: string | null;
};

interface EmpRow {
  employee_code: string | null;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  office_email: string | null;
  designation_text: string | null;
  photo_url: string | null;
}

const fullName = (r: EmpRow) =>
  [r.first_name, r.middle_name, r.last_name]
    .filter((s): s is string => !!s && s.trim().length > 0)
    .join(" ")
    .trim();

// ─── GET /api/leadership/cmd-reports ────────────────────────────────────────
//
// Returns the CMD plus the 13 leaders who report to them, each enriched from
// the master DB (designation / office email / photo) where available. The
// canonical name + role always come from the seed list, so the roster renders
// even if the DB enrichment is partially or fully unavailable.
router.get("/leadership/cmd-reports", async (_req, res): Promise<void> => {
  const seeds: LeaderSeed[] = [CMD, ...CMD_REPORTS];
  const allCodes = seeds.map((s) => s.code);

  // code → enriched master-DB row (best-effort; never fatal).
  const byCode = new Map<string, EmpRow>();

  try {
    const masterDb = getMasterDb();
    const cols = "employee_code, first_name, middle_name, last_name, office_email, designation_text, photo_url";

    const { data: emp } = await masterDb
      .from("employees")
      .select(cols)
      .in("employee_code", allCodes);
    for (const r of (emp ?? []) as EmpRow[]) {
      if (r.employee_code) byCode.set(String(r.employee_code), r);
    }

    // CS-prefixed codes live in contractual_employees. Best-effort, guarded —
    // a missing table / column must not break the roster.
    const csCodes = allCodes.filter((c) => /^CS/i.test(c));
    if (csCodes.length > 0) {
      try {
        const { data: con } = await masterDb
          .from("contractual_employees")
          .select(cols)
          .in("employee_code", csCodes);
        for (const r of (con ?? []) as EmpRow[]) {
          if (r.employee_code) byCode.set(String(r.employee_code), r);
        }
      } catch {
        /* contractual_employees unavailable — fall back to seed values */
      }
    }
  } catch {
    /* master DB unavailable — return seed values with null enrichment */
  }

  const enrich = (s: LeaderSeed): LeaderCard => {
    const r = byCode.get(s.code);
    const dbName = r ? fullName(r) : "";
    return {
      code: s.code,
      // Prefer the live master-DB name when present; fall back to the seed.
      name: dbName || s.name,
      role: s.role,
      designation: r?.designation_text ?? null,
      officeEmail: r?.office_email ?? null,
      photoUrl: r?.photo_url ?? null,
    };
  };

  res.json({
    cmd: enrich(CMD),
    reports: CMD_REPORTS.map(enrich),
  });
});

export default router;
