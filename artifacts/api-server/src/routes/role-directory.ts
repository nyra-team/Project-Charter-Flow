import { Router, type IRouter } from "express";
import { db, roleDirectoryTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireRole } from "../lib/guard";

const router: IRouter = Router();

// List all org-role → person mappings, joined to the linked pmo_users row (name/email)
// so the admin page can show who is currently assigned.
router.get("/role-directory", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: roleDirectoryTable.id,
      role: roleDirectoryTable.role,
      label: roleDirectoryTable.label,
      userId: roleDirectoryTable.userId,
      email: roleDirectoryTable.email,
      isActive: roleDirectoryTable.isActive,
      userName: usersTable.name,
      userEmail: usersTable.email,
    })
    .from(roleDirectoryTable)
    .leftJoin(usersTable, eq(roleDirectoryTable.userId, usersTable.id))
    .orderBy(roleDirectoryTable.role);
  res.json(rows);
});

// Create a new role key (rarely needed — the migration seeds the standard set).
router.post("/role-directory", requireRole("pmo"), async (req, res): Promise<void> => {
  const { role, label, userId, email } = (req.body ?? {}) as { role?: string; label?: string; userId?: number; email?: string };
  if (!role) { res.status(400).json({ error: "role is required" }); return; }
  const [row] = await db.insert(roleDirectoryTable).values({
    role: role.trim().toLowerCase(),
    label: label ?? "",
    userId: userId ?? null,
    email: email ?? null,
  }).returning();
  res.status(201).json(row);
});

// Assign / clear the person (or group email) for a role.
router.patch("/role-directory/:role", requireRole("pmo"), async (req, res): Promise<void> => {
  const { role } = req.params;
  const body = (req.body ?? {}) as { userId?: number | null; email?: string | null; label?: string; isActive?: boolean };
  const update: Record<string, unknown> = {};
  if ("userId" in body) update.userId = body.userId ?? null;
  if ("email" in body) update.email = body.email ? String(body.email).trim() : null;
  if (body.label != null) update.label = body.label;
  if (body.isActive != null) update.isActive = !!body.isActive;
  if (Object.keys(update).length === 0) { res.status(400).json({ error: "Nothing to update" }); return; }
  const [row] = await db.update(roleDirectoryTable).set(update).where(eq(roleDirectoryTable.role, role.toLowerCase())).returning();
  if (!row) { res.status(404).json({ error: `Unknown role: ${role}` }); return; }
  res.json(row);
});

export default router;
