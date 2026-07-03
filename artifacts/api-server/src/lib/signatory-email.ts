import { getMasterDb } from "./masterDb";

type Sig = { role?: string; name?: string; email?: string; empCode?: string };

/**
 * Fill in the office email for any DOA signatory that has an employee code but
 * no email yet — so a note whose approvers were picked from the directory (which
 * carries a code, not always an email) still routes the Documenso signing mail.
 * Looks up master-DB `employees` then `contractual_employees` by employee_code.
 * Best-effort: a signatory whose email can't be resolved is left as-is (the
 * e-sign path then reports it in the "no email" 422, same as before).
 */
export async function enrichSignatoryEmails<T extends Sig>(sigs: T[]): Promise<T[]> {
  const needing = sigs.filter((s) => !s.email && !s.name?.includes("@") && s.empCode?.trim());
  if (needing.length === 0) return sigs;

  const codes = [...new Set(needing.map((s) => s.empCode!.trim()))];
  const byCode = new Map<string, string>();
  try {
    const masterDb = getMasterDb();
    for (const table of ["employees", "contractual_employees"]) {
      const missing = codes.filter((c) => !byCode.has(c));
      if (missing.length === 0) break;
      const { data } = await masterDb
        .from(table)
        .select("employee_code, office_email")
        .in("employee_code", missing);
      for (const r of (data ?? []) as Array<{ employee_code?: string; office_email?: string }>) {
        if (r.employee_code && r.office_email) byCode.set(r.employee_code, r.office_email);
      }
    }
  } catch {
    return sigs; // master DB unreachable → leave untouched, caller handles missing email
  }

  return sigs.map((s) =>
    !s.email && s.empCode && byCode.has(s.empCode.trim())
      ? { ...s, email: byCode.get(s.empCode.trim()) }
      : s,
  );
}
