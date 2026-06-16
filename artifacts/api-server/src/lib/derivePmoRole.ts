/**
 * derivePmoRole.ts
 *
 * Single source of truth for resolving a Project Hub user's functional role
 * from the master Employee DB. Replaces the old client-side useUserStore
 * role-picker (which was a persona simulator, not access control).
 *
 * ── Resolution order ──────────────────────────────────────────────────────
 *
 *   1. Explicit override on employee_auth.pmo_role
 *        ↳ Set by a PMO admin via the admin UI for edge cases the directory
 *          can't express (acting CFO, dotted-line PMO member, designation
 *          typo HR hasn't fixed). When non-null, it WINS — derivation is
 *          skipped. See migration 027 for the widened enum.
 *
 *   2. Directory derivation from employees.designation_text + .function
 *      + .grade_code. Order of precedence (most specific first):
 *
 *        chairman              designation matches "Chairman"
 *        executive_director    designation matches "Executive Director"
 *        cfo                   designation matches "CFO" / "Chief Financial Officer"
 *        pmo                   employee_auth.access_pmo + PMO-team designation
 *        pm                    designation matches "Project Manager" / "Project Lead"
 *        hod                   designation starts with "Head of " /
 *                              "Head, " / "Head -"
 *        scm                   function in {Supply Chain, SCM, Procurement} + senior band
 *        finance               function in {Finance, Finance & Accounts}   + senior band
 *        team_member           default fallback (no role matched)
 *
 * ── Why directory-first ────────────────────────────────────────────────────
 *
 * HR already maintains designation / function / grade for every employee.
 * Driving PMO roles from those columns means RBAC stays automatically in
 * sync with promotions, transfers, and leavers — no separate maintenance
 * burden. The explicit override is a release valve, not the primary control.
 *
 * ── Grade bands ────────────────────────────────────────────────────────────
 *
 * Granules grade codes use leading letter bands (C / D / E / F / G …).
 * Migration 007 documents C-and-above as Deputy Manager+; we treat D-and-
 * above as "senior" for the function-derived roles (finance / scm), which
 * keeps the list tight enough to be meaningful while still surfacing the
 * people who'd actually be approving things.
 */

export const PMO_ROLES = [
  "admin",               // platform admin — gates /admin/* routes (also via requireAdmin)
  "chairman",
  "executive_director",
  "cfo",
  "pmo",
  "pm",
  "hod",
  "scm",
  "finance",
  "team_member",
] as const;

export type PmoRole = (typeof PMO_ROLES)[number];

/** Subset of the master DB `employees` row needed for derivation. */
export interface DirectoryRow {
  designation_text: string | null;
  business_designation: string | null;
  function: string | null;
  sub_function: string | null;
  grade_code: string | null;
}

/** Subset of the master DB `employee_auth` row needed for derivation. */
export interface AuthRow {
  access_pmo: boolean | null;
  pmo_role: string | null;
}

const SENIOR_BANDS = new Set(["D", "E", "F", "G", "H"]);
const FINANCE_FUNCTIONS = new Set(["finance", "finance & accounts", "accounts"]);
const SCM_FUNCTIONS = new Set(["supply chain", "scm", "procurement", "supply chain management"]);

/** Pull the leading alphabetic band off a grade code ("C1" → "C", "F" → "F"). */
function gradeBand(grade: string | null): string | null {
  if (!grade) return null;
  const m = grade.trim().toUpperCase().match(/^[A-Z]+/);
  return m ? m[0]![0]! : null;
}

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

/**
 * Derive the user's Project Hub role.
 *
 * @param emp   the employees row (or relevant subset)
 * @param auth  the employee_auth row (or relevant subset)
 * @returns one of the 10 PmoRole values; never null.
 */
export function derivePmoRole(emp: DirectoryRow, auth: AuthRow): PmoRole {
  // 1. Explicit override wins. (Callers pass either employee_auth.pmo_role
  //    or a pmo_role_overrides row — see requireAuth.) Only the known role
  //    values are accepted; anything else is treated as if it weren't set,
  //    defending against a stale row from an older enum being mis-read.
  const stored = norm(auth.pmo_role);
  if (stored && stored !== "null") {
    if ((PMO_ROLES as readonly string[]).includes(stored)) {
      return stored as PmoRole;
    }
  }

  // 2. Directory derivation.
  //
  // Designation matches are checked first because they're the most specific
  // signal — "Chairman", "CFO" etc. are single-occupant roles whose holder
  // would never be misclassified by function/grade alone.
  const designation = norm(emp.designation_text) || norm(emp.business_designation);
  const fn          = norm(emp.function);
  const band        = gradeBand(emp.grade_code);

  // Chairman
  if (/\bchairman\b/.test(designation)) return "chairman";

  // Executive Director
  if (/\bexecutive\s+director\b/.test(designation)) return "executive_director";
  if (/^director\b/.test(designation) && band === "F") return "executive_director";

  // CFO
  if (/\bcfo\b/.test(designation)) return "cfo";
  if (/chief\s+financial\s+officer/.test(designation)) return "cfo";

  // PMO team — access_pmo flag + PMO-specific designation (or function),
  // BUT only if no more-specific role matched above. Many PMO-team members
  // will simply hold "Project Manager" as their designation; that flows to
  // `pm` below, which is the more accurate functional label.
  if (auth.access_pmo && (/\bpmo\b/.test(designation) || /project\s+management\s+office/.test(designation))) {
    return "pmo";
  }

  // Project Manager / Project Lead
  if (/\bproject\s+(manager|lead|director)\b/.test(designation)) return "pm";
  if (/\bprogramme?\s+manager\b/.test(designation)) return "pm";

  // Head of <function> — explicit HOD designation.
  if (/^head\s+(of|,|-|—)\s+/i.test(designation)) return "hod";
  if (/\bhead\s+of\s+\w+/.test(designation)) return "hod";

  // Function-derived roles (only if grade is senior enough to be a
  // genuine approver, not just any team member sitting in that function).
  if (band && SENIOR_BANDS.has(band)) {
    if (SCM_FUNCTIONS.has(fn)) return "scm";
    if (FINANCE_FUNCTIONS.has(fn)) return "finance";
  }

  // Fallthrough.
  return "team_member";
}

/**
 * Convenience: true if the resolved role is one that requires
 * `requireAdmin`-equivalent gating. Mirrors the existing semantics of
 * pmo_role='admin' but lets callers ask the question without leaking
 * the role string into call sites.
 */
export function isPmoPlatformAdmin(role: PmoRole): boolean {
  return role === "admin";
}
