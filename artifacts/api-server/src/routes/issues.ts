import { Router, type IRouter } from "express";
import { db, issuesTable, projectsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireRole } from "../lib/guard";

const router: IRouter = Router();

const WRITE_ROLES = ["pm", "pmo", "hod", "initiator"];

// GET /api/all-issues — every issue across all projects, one query.
// ponytail: replaces the Issues page's N+1 (one fetch per project).
router.get("/all-issues", async (_req, res): Promise<void> => {
  const issues = await db.select().from(issuesTable).orderBy(desc(issuesTable.createdAt));
  res.json(issues);
});

router.get("/projects/:id/issues", async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const issues = await db.select().from(issuesTable).where(eq(issuesTable.projectId, projectId)).orderBy(desc(issuesTable.createdAt));
  res.json(issues);
});

router.post("/projects/:id/issues", requireRole(...WRITE_ROLES), async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [projI] = await db.select({ status: projectsTable.status }).from(projectsTable).where(eq(projectsTable.id, projectId));
  if (projI?.status === "closed") { res.status(409).json({ error: "Project is closed. Issues cannot be raised." }); return; }
  const { title, description, taskId, milestoneId, dependencyType, blockingOwnerId, blockingDept, originalDeadline, proposedRevisedDeadline, raisedBy } = req.body as {
    title: string; description?: string; taskId?: number; milestoneId?: number; dependencyType?: string;
    blockingOwnerId?: number; blockingDept?: string; originalDeadline?: string; proposedRevisedDeadline?: string; raisedBy?: number;
  };
  if (!title) { res.status(400).json({ error: "title is required" }); return; }
  const [issue] = await db.insert(issuesTable).values({
    projectId, title, description, taskId, milestoneId, dependencyType,
    blockingOwnerId, blockingDept, originalDeadline, proposedRevisedDeadline, raisedBy,
  }).returning();
  res.status(201).json(issue);
});

router.get("/issues/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [issue] = await db.select().from(issuesTable).where(eq(issuesTable.id, id));
  if (!issue) { res.status(404).json({ error: "Issue not found" }); return; }
  res.json(issue);
});

router.patch("/issues/:id", requireRole(...WRITE_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [existingIssue] = await db.select({ projectId: issuesTable.projectId }).from(issuesTable).where(eq(issuesTable.id, id));
  if (existingIssue) {
    const [projIssue] = await db.select({ status: projectsTable.status }).from(projectsTable).where(eq(projectsTable.id, existingIssue.projectId));
    if (projIssue?.status === "closed") { res.status(409).json({ error: "Project is closed. Issues cannot be updated." }); return; }
  }
  const updateData: Record<string, unknown> = {};
  const fields = ["title", "description", "dependencyType", "blockingOwnerId", "blockingDept", "originalDeadline", "proposedRevisedDeadline", "status", "resolutionNotes"];
  for (const f of fields) {
    if (req.body[f] !== undefined) updateData[f] = req.body[f];
  }
  if (req.body.status === "resolved" && !updateData.resolvedAt) {
    updateData.resolvedAt = new Date();
  }
  const [issue] = await db.update(issuesTable).set(updateData).where(eq(issuesTable.id, id)).returning();
  if (!issue) { res.status(404).json({ error: "Issue not found" }); return; }
  res.json(issue);
});

router.delete("/issues/:id", requireRole("pmo", "pm"), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(issuesTable).where(eq(issuesTable.id, id));
  res.sendStatus(204);
});

export default router;
