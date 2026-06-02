import { Router, type IRouter } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

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
  const email = me.email.toLowerCase();
  const existing = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (existing[0]) {
    res.json(serializeUser(existing[0]));
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
  res.json(serializeUser(row));
});

router.get("/users", async (_req, res): Promise<void> => {
  const users = await db.select().from(usersTable).orderBy(usersTable.name);
  res.json(users.map(serializeUser));
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
