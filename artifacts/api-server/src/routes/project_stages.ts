import { Router, type IRouter } from "express";
import { db, projectStagesTable, projectsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router: IRouter = Router();

router.get("/projects/:id/stages", async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const stages = await db.select().from(projectStagesTable).where(eq(projectStagesTable.projectId, projectId)).orderBy(projectStagesTable.createdAt);
  res.json(stages);
});

router.post("/projects/:id/stages", async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { stage, status, notes } = req.body as { stage: string; status?: string; notes?: string };
  if (!stage) { res.status(400).json({ error: "stage is required" }); return; }
  const [projectStage] = await db.insert(projectStagesTable).values({
    projectId,
    stage,
    status: status ?? "not_started",
    notes,
    enteredAt: status === "in_progress" ? new Date() : undefined,
  }).returning();
  res.status(201).json(projectStage);
});

router.get("/project-stages/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [stage] = await db.select().from(projectStagesTable).where(eq(projectStagesTable.id, id));
  if (!stage) { res.status(404).json({ error: "Project stage not found" }); return; }
  res.json(stage);
});

router.patch("/project-stages/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { status, notes, enteredAt, completedAt } = req.body as { status?: string; notes?: string; enteredAt?: string; completedAt?: string };
  const updateData: Record<string, unknown> = {};
  if (status !== undefined) updateData.status = status;
  if (notes !== undefined) updateData.notes = notes;
  if (enteredAt !== undefined) updateData.enteredAt = new Date(enteredAt);
  if (completedAt !== undefined) updateData.completedAt = new Date(completedAt);
  if (status === "complete" && completedAt === undefined) updateData.completedAt = new Date();
  if (status === "in_progress" && enteredAt === undefined) updateData.enteredAt = new Date();
  const [projectStage] = await db.update(projectStagesTable).set(updateData).where(eq(projectStagesTable.id, id)).returning();
  if (!projectStage) { res.status(404).json({ error: "Project stage not found" }); return; }
  res.json(projectStage);
});

router.post("/projects/:id/stages/:stage/advance", async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { stage } = req.params;

  const lifecycleStages = [
    "project_case", "urs", "rfp", "vendor_evaluation", "commercial",
    "charter", "nfa", "pr_po", "kickoff", "development",
    "implementation_plan", "uat", "go_live", "closure_readiness", "project_closure"
  ];

  const stageIdx = lifecycleStages.indexOf(stage);
  if (stageIdx === -1) { res.status(400).json({ error: "Invalid stage name" }); return; }

  await db.update(projectStagesTable)
    .set({ status: "complete", completedAt: new Date() })
    .where(and(eq(projectStagesTable.projectId, projectId), eq(projectStagesTable.stage, stage)));

  const nextStage = lifecycleStages[stageIdx + 1];
  if (nextStage) {
    const existing = await db.select().from(projectStagesTable)
      .where(and(eq(projectStagesTable.projectId, projectId), eq(projectStagesTable.stage, nextStage)));

    if (existing.length === 0) {
      await db.insert(projectStagesTable).values({ projectId, stage: nextStage, status: "in_progress", enteredAt: new Date() });
    } else {
      await db.update(projectStagesTable)
        .set({ status: "in_progress", enteredAt: new Date() })
        .where(and(eq(projectStagesTable.projectId, projectId), eq(projectStagesTable.stage, nextStage)));
    }

    await db.update(projectsTable).set({ stage: nextStage, updatedAt: new Date() }).where(eq(projectsTable.id, projectId));
  }

  const stages = await db.select().from(projectStagesTable).where(eq(projectStagesTable.projectId, projectId)).orderBy(projectStagesTable.createdAt);
  res.json({ projectId, stages, advancedTo: nextStage ?? null });
});

router.delete("/project-stages/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(projectStagesTable).where(eq(projectStagesTable.id, id));
  res.sendStatus(204);
});

export default router;
