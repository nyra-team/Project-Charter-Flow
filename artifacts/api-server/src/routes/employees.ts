import { Router, type IRouter } from "express";
import { getMasterDb } from "../lib/masterDb";

const router: IRouter = Router();

// ─── Types returned to the wire (camelCase, masked to safe fields) ──────────
type EmployeeCard = {
  id: string;
  fullName: string;
  designation: string | null;
  officeEmail: string | null;
  employeeCode: string | null;
  photoUrl: string | null;
};

interface EmployeeRow {
  id: string;
  employee_code: string | null;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  office_email: string | null;
  designation_text: string | null;
  photo_url: string | null;
}

function toCard(r: EmployeeRow): EmployeeCard {
  return {
    id: r.id,
    fullName: [r.first_name, r.middle_name, r.last_name].filter((s): s is string => !!s && s.trim().length > 0).join(" ").trim(),
    designation: r.designation_text ?? null,
    officeEmail: r.office_email ?? null,
    employeeCode: r.employee_code ?? null,
    photoUrl: r.photo_url ?? null,
  };
}

// ─── GET /api/employees/search?q=<text>&limit=5 ─────────────────────────────
//
// Fuzzy lookup against the master DB employees table by name. Tokenises the
// query on whitespace:
//   - one token  → ilike against first_name OR last_name (any hit)
//   - 2+ tokens  → ilike first token against first_name AND last token against
//                  last_name (the natural "Sreeram Prudhvi" pattern)
// Caps at 5 hits by default so a thin chip can pick the top candidate
// without dragging a 50-row dropdown of partial matches.

router.get("/employees/search", async (req, res): Promise<void> => {
  const raw = String(req.query.q ?? "").trim();
  if (!raw || raw.length < 2) {
    res.json([]);
    return;
  }
  const limit = Math.min(Number(req.query.limit) || 5, 20);
  const tokens = raw.split(/\s+/).filter(Boolean);

  let q;
  try {
    const masterDb = getMasterDb();
    q = masterDb
      .from("employees")
      .select("id, employee_code, first_name, middle_name, last_name, office_email, designation_text, photo_url");
  } catch (err) {
    res.status(503).json({ error: `Master DB unavailable: ${(err as Error).message}` });
    return;
  }

  if (tokens.length === 1) {
    q = q.or(`first_name.ilike.%${tokens[0]}%,last_name.ilike.%${tokens[0]}%,middle_name.ilike.%${tokens[0]}%`);
  } else {
    q = q.ilike("first_name", `%${tokens[0]}%`).ilike("last_name", `%${tokens[tokens.length - 1]}%`);
  }

  const { data, error } = await q.limit(limit);
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json(((data ?? []) as EmployeeRow[]).map(toCard));
});

// ─── GET /api/employees/lookup?name=<text> ──────────────────────────────────
//
// Single-best-match wrapper around /search — returns the top hit or null.
// Used by the <SpeedChampion> chip which only needs one resolved identity.

router.get("/employees/lookup", async (req, res): Promise<void> => {
  const raw = String(req.query.name ?? "").trim();
  if (!raw || raw.length < 2) {
    res.json(null);
    return;
  }
  const tokens = raw.split(/\s+/).filter(Boolean);

  let q;
  try {
    const masterDb = getMasterDb();
    q = masterDb
      .from("employees")
      .select("id, employee_code, first_name, middle_name, last_name, office_email, designation_text, photo_url");
  } catch (err) {
    res.status(503).json({ error: `Master DB unavailable: ${(err as Error).message}` });
    return;
  }
  if (tokens.length === 1) {
    q = q.or(`first_name.ilike.%${tokens[0]}%,last_name.ilike.%${tokens[0]}%,middle_name.ilike.%${tokens[0]}%`);
  } else {
    q = q.ilike("first_name", `%${tokens[0]}%`).ilike("last_name", `%${tokens[tokens.length - 1]}%`);
  }
  const { data, error } = await q.limit(1).maybeSingle();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json(data ? toCard(data as EmployeeRow) : null);
});

export default router;
