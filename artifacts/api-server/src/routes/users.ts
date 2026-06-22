import { Router, type IRouter } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getMasterDb } from "../lib/masterDb";

const router: IRouter = Router();

function serializeUser(user: typeof usersTable.$inferSelect) {
  return {
    ...user,
    createdAt: user.createdAt instanceof Date ? user.createdAt.toISOString() : user.createdAt,
  };
}

/**
 * GET /api/users/me — resolve the local pmo_users row for the
 * currently-authenticated employee, auto-provisioning the row on first
 * sight.
 *
 * requireAuth has already validated the Bearer token against Master DB
 * and populated req.user with email + full name. We map that to a row
 * in the local pmo_users table by email; if no row exists we create one
 * so the rest of the app (which keys off numeric pmo_users.id) has
 * something real to attribute "created by" / "owner" to instead of
 * the seeded Alice/Bob/Carol mock users.
 */
router.get("/users/me", async (req, res): Promise<void> => {
  const me = req.user;
  if (!me?.email) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  // Overlay the master-DB-derived identity onto the local row so the
  // frontend has a single authoritative source for the user's real
  // functional role (resolved by requireAuth via derivePmoRole) plus the
  // app-access flags — distinct from the local pmo_users.role column, which
  // is just a default ("initiator") for "created by" attribution.
  const identity = {
    pmoRole: me.pmoRole,
    isAdmin: me.isAdmin,
    isSuperAdmin: me.isSuperAdmin,
    accessPmo: me.accessPmo,
    // Master-DB department/function — lets the frontend default the Projects
    // view to the signed-in user's own department.
    function: (me as { function?: string | null }).function ?? null,
  };

  const email = me.email.toLowerCase();
  const existing = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (existing[0]) {
    res.json({ ...serializeUser(existing[0]), ...identity });
    return;
  }
  // Auto-provision. onConflictDoNothing handles the race where two parallel
  // /me requests from a fresh login both try to insert the same email.
  await db
    .insert(usersTable)
    .values({
      name: me.fullName ?? email.split("@")[0] ?? "User",
      email,
      role: "initiator",
      department: "General",
    })
    .onConflictDoNothing({ target: usersTable.email });
  const [row] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (!row) {
    res.status(500).json({ error: "Failed to provision local user" });
    return;
  }
  res.json({ ...serializeUser(row), ...identity });
});

router.get("/users", async (_req, res): Promise<void> => {
  const users = await db.select().from(usersTable).orderBy(usersTable.name);
  // Enrich each user with their master-DB profile photo (matched by email).
  // Best-effort: if the master DB is unavailable, return users without photos.
  const photoByEmail = new Map<string, string>();
  const emails = users.map((u) => u.email?.toLowerCase()).filter((e): e is string => !!e);
  if (emails.length) {
    try {
      const masterDb = getMasterDb();
      // Case-insensitive match (pmo_users emails are lowercased; the master
      // directory may store original case). ilike with no wildcards = exact CI.
      const orFilter = emails.map((e) => `office_email.ilike.${e}`).join(",");
      const { data } = await masterDb
        .from("employees")
        .select("office_email, photo_url")
        .or(orFilter);
      for (const row of (data ?? []) as Array<{ office_email: string | null; photo_url: string | null }>) {
        if (row.office_email && row.photo_url) photoByEmail.set(row.office_email.toLowerCase(), row.photo_url);
      }
    } catch { /* master DB unavailable — fall back to no photos */ }
  }
  res.json(users.map((u) => ({ ...serializeUser(u), photoUrl: (u.email && photoByEmail.get(u.email.toLowerCase())) ?? null })));
});

// GET /api/departments — every department (master-DB employees.function),
// including those with no projects, so the department dropdowns can offer the
// full canonical list. Deduped + sorted. Best-effort: returns [] if master DB
// is unavailable so the frontend falls back to project-derived departments.
router.get("/departments", async (_req, res): Promise<void> => {
  try {
    const masterDb = getMasterDb();
    const { data, error } = await masterDb
      .from("employees")
      .select("function")
      .not("function", "is", null);
    if (error) throw error;
    const set = new Set<string>();
    for (const row of (data ?? []) as Array<{ function: string | null }>) {
      const f = (row.function ?? "").trim();
      if (f) set.add(f);
    }
    res.json([...set].sort((a, b) => a.localeCompare(b)));
  } catch {
    res.json([]);
  }
});

router.post("/users", async (req, res): Promise<void> => {
  const { name, email, role, department } = req.body;
  if (!name || !email || !role) {
    res.status(400).json({ error: "name, email and role are required" });
    return;
  }
  const [user] = await db.insert(usersTable).values({ name, email, role, department: department ?? "General" }).returning();
  res.status(201).json(serializeUser(user));
});

router.get("/users/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(serializeUser(user));
});

export default router;
