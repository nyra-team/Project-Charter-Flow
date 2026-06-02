import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { db, userPreferencesTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";

const router: IRouter = Router();

// ─── Validation ─────────────────────────────────────────────────────────────

// Fixed scope taxonomy — widen here when a new surface adopts saved views.
const SCOPE_VALUES = ["task_grid", "project_list", "portfolio_dashboard", "exec_dashboard", "sidebar"] as const;
const Scope = z.enum(SCOPE_VALUES);

const UpsertBody = z.object({
  scope: Scope,
  key: z.string().min(1).max(80),
  // jsonb passthrough — shape is owned by the calling surface.
  config: z.record(z.string(), z.unknown()).optional().default({}),
  isDefault: z.boolean().optional(),
  sharedWithRole: z.string().nullable().optional(),
});

const PatchBody = UpsertBody.partial();

// ─── Auth helper ────────────────────────────────────────────────────────────

function getUserId(req: import("express").Request, res: import("express").Response): string | null {
  const uid = req.user?.employeeId;
  if (!uid) {
    res.status(401).json({ error: "Not authenticated" });
    return null;
  }
  return uid;
}

// ─── GET /api/user-preferences?scope=task_grid ───────────────────────────────
// Lists every saved view the current user has for the given scope, default
// first then most-recently-updated.

router.get("/user-preferences", async (req, res): Promise<void> => {
  const userId = getUserId(req, res);
  if (!userId) return;
  const scope = typeof req.query.scope === "string" ? req.query.scope : undefined;
  if (!scope || !Scope.options.includes(scope as (typeof SCOPE_VALUES)[number])) {
    res.status(400).json({ error: `scope must be one of: ${SCOPE_VALUES.join(", ")}` });
    return;
  }
  const rows = await db
    .select()
    .from(userPreferencesTable)
    .where(and(eq(userPreferencesTable.userId, userId), eq(userPreferencesTable.scope, scope)))
    .orderBy(desc(userPreferencesTable.isDefault), desc(userPreferencesTable.updatedAt));
  res.json(rows);
});

// ─── GET /api/user-preferences/default?scope=task_grid ──────────────────────
// Returns the default view for the user+scope, or 204 if none.

router.get("/user-preferences/default", async (req, res): Promise<void> => {
  const userId = getUserId(req, res);
  if (!userId) return;
  const scope = typeof req.query.scope === "string" ? req.query.scope : undefined;
  if (!scope || !Scope.options.includes(scope as (typeof SCOPE_VALUES)[number])) {
    res.status(400).json({ error: `scope must be one of: ${SCOPE_VALUES.join(", ")}` });
    return;
  }
  const [row] = await db
    .select()
    .from(userPreferencesTable)
    .where(
      and(
        eq(userPreferencesTable.userId, userId),
        eq(userPreferencesTable.scope, scope),
        eq(userPreferencesTable.isDefault, true),
      ),
    )
    .limit(1);
  if (!row) {
    res.status(204).end();
    return;
  }
  res.json(row);
});

// ─── POST /api/user-preferences ─────────────────────────────────────────────
// Upsert by (userId, scope, key). If isDefault=true is set, clears the flag
// on every other row in the same (userId, scope) so there's only ever one
// default per surface.

router.post("/user-preferences", async (req, res): Promise<void> => {
  const userId = getUserId(req, res);
  if (!userId) return;
  const parsed = UpsertBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { scope, key, config, isDefault, sharedWithRole } = parsed.data;

  // Upsert via "try update, then insert" — `onConflictDoUpdate` would also
  // work, but the explicit branch keeps the activity audit trail readable
  // (create vs save).
  const [existing] = await db
    .select()
    .from(userPreferencesTable)
    .where(and(eq(userPreferencesTable.userId, userId), eq(userPreferencesTable.scope, scope), eq(userPreferencesTable.key, key)));

  let row;
  if (existing) {
    [row] = await db
      .update(userPreferencesTable)
      .set({
        config,
        ...(isDefault != null ? { isDefault } : {}),
        ...(sharedWithRole !== undefined ? { sharedWithRole } : {}),
      })
      .where(eq(userPreferencesTable.id, existing.id))
      .returning();
  } else {
    [row] = await db
      .insert(userPreferencesTable)
      .values({
        userId,
        scope,
        key,
        config,
        isDefault: isDefault ?? false,
        sharedWithRole: sharedWithRole ?? null,
      } as never)
      .returning();
  }

  if (isDefault) {
    // Clear isDefault on every other row in this (user, scope).
    await db
      .update(userPreferencesTable)
      .set({ isDefault: false })
      .where(
        and(
          eq(userPreferencesTable.userId, userId),
          eq(userPreferencesTable.scope, scope),
          // Use a raw NOT EQUAL via drizzle's sql; cheaper than reading and
          // batch-updating individual rows.
        ),
      );
    // Re-set this row's flag (the bulk update above cleared it too).
    [row] = await db
      .update(userPreferencesTable)
      .set({ isDefault: true })
      .where(eq(userPreferencesTable.id, row.id))
      .returning();
  }

  res.status(existing ? 200 : 201).json(row);
});

// ─── PATCH /api/user-preferences/:id ────────────────────────────────────────
// Light-touch update — typically used to flip isDefault without re-sending
// the whole config blob.

router.patch("/user-preferences/:id", async (req, res): Promise<void> => {
  const userId = getUserId(req, res);
  if (!userId) return;
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = PatchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Enforce ownership — block one user from poking at another's saved views.
  const [existing] = await db
    .select()
    .from(userPreferencesTable)
    .where(and(eq(userPreferencesTable.id, id), eq(userPreferencesTable.userId, userId)));
  if (!existing) {
    res.status(404).json({ error: "Preference not found" });
    return;
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.config !== undefined) updates.config = parsed.data.config;
  if (parsed.data.isDefault !== undefined) updates.isDefault = parsed.data.isDefault;
  if (parsed.data.sharedWithRole !== undefined) updates.sharedWithRole = parsed.data.sharedWithRole;
  if (parsed.data.key) updates.key = parsed.data.key;

  // If we're flipping isDefault=true, clear it elsewhere in the same scope first.
  if (parsed.data.isDefault === true) {
    await db
      .update(userPreferencesTable)
      .set({ isDefault: false })
      .where(and(eq(userPreferencesTable.userId, userId), eq(userPreferencesTable.scope, existing.scope)));
  }

  const [row] = await db.update(userPreferencesTable).set(updates).where(eq(userPreferencesTable.id, id)).returning();
  res.json(row);
});

// ─── DELETE /api/user-preferences/:id ───────────────────────────────────────

router.delete("/user-preferences/:id", async (req, res): Promise<void> => {
  const userId = getUserId(req, res);
  if (!userId) return;
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [existing] = await db
    .select({ id: userPreferencesTable.id })
    .from(userPreferencesTable)
    .where(and(eq(userPreferencesTable.id, id), eq(userPreferencesTable.userId, userId)));
  if (!existing) {
    res.status(404).json({ error: "Preference not found" });
    return;
  }
  await db.delete(userPreferencesTable).where(eq(userPreferencesTable.id, id));
  res.json({ success: true });
});

export default router;
