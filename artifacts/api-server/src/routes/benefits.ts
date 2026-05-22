import { Router, type IRouter } from "express";
import { db, benefitsReviewsTable, projectsTable, chartersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireRole, pick } from "../lib/guard";

const router: IRouter = Router();

const WRITE_ROLES = ["pm", "pmo", "hod", "finance"];

const BENEFIT_FIELDS = [
  "scheduledDate", "conductedDate", "status",
  "productivityActual", "complianceActual", "toplineActual", "bottomlineActual",
  "productivityProjected", "complianceProjected", "toplineProjected", "bottomlineProjected",
  "overallRealizationPct", "rag", "findings", "recommendations",
  "attachments", "conductedById", "signedOffById",
] as const;

router.get("/projects/:id/benefits-reviews", async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const rows = await db.select().from(benefitsReviewsTable)
    .where(eq(benefitsReviewsTable.projectId, projectId))
    .orderBy(benefitsReviewsTable.scheduledDate);
  res.json(rows);
});

router.post("/projects/:id/benefits-reviews/init", requireRole(...WRITE_ROLES), async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { goLiveDate } = (req.body ?? {}) as { goLiveDate?: string };
  if (!goLiveDate) { res.status(400).json({ error: "goLiveDate required (YYYY-MM-DD)" }); return; }
  const base = new Date(goLiveDate);
  if (isNaN(base.getTime())) { res.status(400).json({ error: "Invalid goLiveDate" }); return; }

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  const [charter] = project?.charterId
    ? await db.select().from(chartersTable).where(eq(chartersTable.id, project.charterId))
    : [null];

  const existing = await db.select().from(benefitsReviewsTable).where(eq(benefitsReviewsTable.projectId, projectId));
  const created: Array<typeof benefitsReviewsTable.$inferSelect> = [];
  for (const months of [3, 6, 12]) {
    const period = `${months}m`;
    if (existing.find((r) => r.reviewPeriod === period)) continue;
    const d = new Date(base);
    d.setMonth(d.getMonth() + months);
    const [row] = await db.insert(benefitsReviewsTable).values({
      projectId,
      reviewPeriod: period,
      scheduledDate: d.toISOString().slice(0, 10),
      status: "scheduled",
      productivityProjected: charter?.productivityImprovement ?? "",
      complianceProjected: charter?.complianceBenefits ?? "",
    }).returning();
    created.push(row);
  }
  res.status(201).json({ created: created.length, reviews: created });
});

router.patch("/benefits-reviews/:id", requireRole(...WRITE_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = pick<Record<string, unknown>>(req.body, BENEFIT_FIELDS) as Record<string, unknown>;
  if (body.status === "completed" && !body.conductedDate) {
    body.conductedDate = new Date().toISOString().slice(0, 10);
  }
  if (Object.keys(body).length === 0) { res.status(400).json({ error: "No editable fields provided" }); return; }
  const [row] = await db.update(benefitsReviewsTable).set(body).where(eq(benefitsReviewsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.get("/benefits-reviews/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db.select().from(benefitsReviewsTable).where(eq(benefitsReviewsTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

export default router;
