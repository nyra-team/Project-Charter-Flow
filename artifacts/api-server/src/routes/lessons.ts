import { Router, type IRouter } from "express";
import { db, lessonsLearnedTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireRole, pick } from "../lib/guard";

const router: IRouter = Router();

const WRITE_ROLES = ["pm", "pmo", "hod", "initiator"];
const ADMIN_ROLES = ["pmo", "chairman"];

const LESSON_FIELDS = [
  "title", "description", "category", "whatWorked", "whatDidnt",
  "recommendation", "tags", "stage",
] as const;

router.get("/lessons-learned", async (req, res): Promise<void> => {
  const q = (req.query.q as string | undefined)?.trim();
  const category = req.query.category as string | undefined;
  let rows = await db.select().from(lessonsLearnedTable).orderBy(desc(lessonsLearnedTable.createdAt));
  if (category && category !== "all") rows = rows.filter((r) => r.category === category);
  if (q) {
    const ql = q.toLowerCase();
    rows = rows.filter(
      (r) =>
        r.title.toLowerCase().includes(ql) ||
        r.description.toLowerCase().includes(ql) ||
        (r.whatWorked ?? "").toLowerCase().includes(ql) ||
        (r.whatDidnt ?? "").toLowerCase().includes(ql) ||
        (r.recommendation ?? "").toLowerCase().includes(ql) ||
        ((r.tags as string[]) ?? []).some((t) => t.toLowerCase().includes(ql)),
    );
  }
  res.json(rows);
});

router.get("/projects/:id/lessons-learned", async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const rows = await db.select().from(lessonsLearnedTable)
    .where(eq(lessonsLearnedTable.projectId, projectId))
    .orderBy(desc(lessonsLearnedTable.createdAt));
  res.json(rows);
});

router.post("/projects/:id/lessons-learned", requireRole(...WRITE_ROLES), async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const data = pick<Record<string, unknown>>(req.body, LESSON_FIELDS);
  if (!data.title || !data.description) { res.status(400).json({ error: "title and description required" }); return; }
  const [row] = await db.insert(lessonsLearnedTable).values({
    projectId,
    title: String(data.title),
    description: String(data.description),
    category: (data.category as string) ?? "general",
    whatWorked: (data.whatWorked as string) ?? "",
    whatDidnt: (data.whatDidnt as string) ?? "",
    recommendation: (data.recommendation as string) ?? "",
    tags: (data.tags as string[]) ?? [],
    stage: (data.stage as string) ?? "",
    capturedById: (req.body?.capturedById as number) ?? null,
  }).returning();
  res.status(201).json(row);
});

router.patch("/lessons-learned/:id", requireRole(...WRITE_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const data = pick<Record<string, unknown>>(req.body, LESSON_FIELDS);
  if (Object.keys(data).length === 0) { res.status(400).json({ error: "No editable fields provided" }); return; }
  const [row] = await db.update(lessonsLearnedTable).set(data).where(eq(lessonsLearnedTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.delete("/lessons-learned/:id", requireRole(...ADMIN_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(lessonsLearnedTable).where(eq(lessonsLearnedTable.id, id));
  res.status(204).send();
});

export default router;
