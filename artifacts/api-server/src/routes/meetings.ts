import { Router, type IRouter } from "express";
import { db, meetingsTable, meetingItemsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireRole, pick } from "../lib/guard";
import { syncMomItemToCxo, deleteCxoMirror, shouldMirror } from "../lib/cxoActionSync";

const router: IRouter = Router();

const WRITE_ROLES = ["pm", "pmo", "hod", "initiator"];

// Mirror a MOM item row into the CXO Action Center (best-effort, fire-and-forget).
// Loads the item's parent meeting for project_id + title, which the item lacks.
function mirrorMomItem(item: typeof meetingItemsTable.$inferSelect): void {
  void (async () => {
    const [meeting] = await db.select().from(meetingsTable).where(eq(meetingsTable.id, item.meetingId));
    if (!meeting) return;
    if (shouldMirror(meeting)) await syncMomItemToCxo(item, meeting);
    else if (item.execActionItemId != null) await deleteCxoMirror(item.execActionItemId); // meeting lost its project
  })().catch(() => {});
}

const MEETING_FIELDS = [
  "title", "type", "projectId", "scheduledDate", "scheduledTime",
  "status", "location", "agenda", "notes", "isFlashMode",
] as const;

const ITEM_FIELDS = [
  "description", "assignedToUserId", "dueDate",
  "percentComplete", "status", "notes", "category",
] as const;

router.get("/meetings", async (_req, res): Promise<void> => {
  const rows = await db.select().from(meetingsTable).orderBy(desc(meetingsTable.scheduledDate));
  res.json(rows);
});

router.get("/projects/:id/meetings", async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const rows = await db.select().from(meetingsTable)
    .where(eq(meetingsTable.projectId, projectId))
    .orderBy(desc(meetingsTable.scheduledDate));
  res.json(rows);
});

router.post("/meetings", requireRole(...WRITE_ROLES), async (req, res): Promise<void> => {
  const data = pick<Record<string, unknown>>(req.body, MEETING_FIELDS) as Record<string, unknown>;
  if (!data.title || !data.scheduledDate) { res.status(400).json({ error: "title and scheduledDate required" }); return; }
  const [row] = await db.insert(meetingsTable).values({
    title: String(data.title),
    type: (data.type as string) ?? "other",
    projectId: data.projectId as number | undefined,
    scheduledDate: String(data.scheduledDate),
    scheduledTime: data.scheduledTime as string | undefined,
    status: (data.status as string) ?? "planned",
    location: (data.location as string) ?? "",
    agenda: (data.agenda as string) ?? "",
    notes: (data.notes as string) ?? "",
    createdById: (req.body?.createdById as number) ?? null,
    isFlashMode: !!data.isFlashMode,
  }).returning();
  res.status(201).json(row);
});

router.get("/meetings/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [meeting] = await db.select().from(meetingsTable).where(eq(meetingsTable.id, id));
  if (!meeting) { res.status(404).json({ error: "Not found" }); return; }
  const items = await db.select().from(meetingItemsTable).where(eq(meetingItemsTable.meetingId, id)).orderBy(meetingItemsTable.id);
  res.json({ ...meeting, items });
});

router.patch("/meetings/:id", requireRole(...WRITE_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const updates = pick<Record<string, unknown>>(req.body, MEETING_FIELDS) as Record<string, unknown>;
  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "No editable fields provided" }); return; }
  const [row] = await db.update(meetingsTable).set(updates).where(eq(meetingsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  // A meeting's project drives whether its items mirror to CXO. If projectId
  // was touched, reconcile every item's mirror (create when a project is added,
  // delete when removed). Re-mirroring is idempotent.
  if ("projectId" in updates) {
    void (async () => {
      const items = await db.select().from(meetingItemsTable).where(eq(meetingItemsTable.meetingId, id));
      for (const it of items) {
        if (shouldMirror(row)) await syncMomItemToCxo(it, row);
        else await deleteCxoMirror(it.execActionItemId);
      }
    })().catch(() => {});
  }
  res.json(row);
});

router.delete("/meetings/:id", requireRole("pmo", "pm"), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [meeting] = await db.select().from(meetingsTable).where(eq(meetingsTable.id, id));
  if (!meeting) { res.status(404).json({ error: "Not found" }); return; }
  // The synthetic "CXO Action Center" container is managed by the sync, not by
  // hand — deleting it from PMO would orphan a project's mirrored items.
  if (meeting.isCxoContainer) { res.status(409).json({ error: "This is an auto-managed CXO Action Center meeting and cannot be deleted here." }); return; }
  // Bulk-deleting items bypasses the per-item delete hook, so tear down their
  // CXO mirrors first.
  const items = await db.select().from(meetingItemsTable).where(eq(meetingItemsTable.meetingId, id));
  for (const it of items) await deleteCxoMirror(it.execActionItemId);
  await db.delete(meetingItemsTable).where(eq(meetingItemsTable.meetingId, id));
  await db.delete(meetingsTable).where(eq(meetingsTable.id, id));
  res.status(204).send();
});

router.get("/meetings/:id/items", async (req, res): Promise<void> => {
  const meetingId = parseInt(req.params.id);
  if (isNaN(meetingId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const items = await db.select().from(meetingItemsTable).where(eq(meetingItemsTable.meetingId, meetingId)).orderBy(meetingItemsTable.id);
  res.json(items);
});

router.post("/meetings/:id/items", requireRole(...WRITE_ROLES), async (req, res): Promise<void> => {
  const meetingId = parseInt(req.params.id);
  if (isNaN(meetingId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const data = pick<Record<string, unknown>>(req.body, ITEM_FIELDS) as Record<string, unknown>;
  if (!data.description) { res.status(400).json({ error: "description required" }); return; }
  const [row] = await db.insert(meetingItemsTable).values({
    meetingId,
    description: String(data.description),
    assignedToUserId: data.assignedToUserId as number | undefined,
    dueDate: data.dueDate as string | undefined,
    percentComplete: (data.percentComplete as number) ?? 0,
    status: (data.status as string) ?? "open",
    notes: (data.notes as string) ?? "",
    category: (data.category as string) ?? "action_item",
  }).returning();
  mirrorMomItem(row); // mirror into CXO Action Center if the meeting has a project
  res.status(201).json(row);
});

router.patch("/meeting-items/:id", requireRole(...WRITE_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const updates = pick<Record<string, unknown>>(req.body, ITEM_FIELDS) as Record<string, unknown>;
  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "No editable fields provided" }); return; }
  const [row] = await db.update(meetingItemsTable).set(updates).where(eq(meetingItemsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  mirrorMomItem(row); // propagate the edit to the CXO mirror (or create it lazily)
  res.json(row);
});

router.delete("/meeting-items/:id", requireRole(...WRITE_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [existing] = await db.select().from(meetingItemsTable).where(eq(meetingItemsTable.id, id));
  await db.delete(meetingItemsTable).where(eq(meetingItemsTable.id, id));
  if (existing?.execActionItemId != null) void deleteCxoMirror(existing.execActionItemId).catch(() => {});
  res.status(204).send();
});

export default router;
