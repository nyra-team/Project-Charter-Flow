import { Router, type IRouter } from "express";
import { db, projectStagesTable, projectsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logActivity } from "./activity";
import { STAGE_GATES, evaluateStageGate, nextStageFor } from "../lib/stage-gates";

const router: IRouter = Router();

// Lifecycle gate config + evaluation now live in ../lib/stage-gates.ts (the single
// source of truth shared by this advance endpoint and the read-only critical-path /
// portfolio / escalation consumers). Stage ordering and prerequisites are PATH-AWARE
// (vendor vs internal) via nextStageFor() / the evaluator's prerequisite check.

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
  // Role is read from the server-side session (set via POST /api/session/role when the
  // user switches role in the sidebar). This cannot be forged per-request by a client.
  const requestRole = req.session.simulatedRole;

  const gate = STAGE_GATES[stage];
  if (!gate) { res.status(400).json({ error: `Unknown stage: ${stage}` }); return; }

  // 0. Closed projects are read-only — no further stage advances are permitted
  const [project] = await db.select({ status: projectsTable.status, projectType: projectsTable.projectType })
    .from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }
  if (project.status === "closed") {
    res.status(409).json({ error: "Project is closed and archived. No further stage advances are permitted." });
    return;
  }

  // 1. Role authorization from server-side session
  if (!requestRole) {
    res.status(403).json({ error: "No role set in session. Please select a role before advancing a stage." });
    return;
  }
  if (!gate.advanceRoles.includes(requestRole)) {
    res.status(403).json({
      error: `Role '${requestRole}' is not authorized to advance stage '${stage}'. Allowed roles: ${gate.advanceRoles.join(", ")}`,
    });
    return;
  }

  // 2-5. All other gates (prerequisites, blocking checklist, URS dual-approval,
  // UAT defects, required docs) evaluated by the single shared evaluator — same
  // logic that powers the read-only critical-path view, so they never drift.
  // Prerequisites are path-aware (vendor vs internal) inside the evaluator.
  const ev = await evaluateStageGate(projectId, stage, project.projectType);
  if (ev.prerequisitesMissing.length > 0) {
    res.status(422).json({ error: `Prerequisites not yet complete: ${ev.prerequisitesMissing.join(", ")}` });
    return;
  }
  // Sub-gated stages (initiation): name the specific blocking sub-gate.
  if (ev.subGates) {
    const blocking = ev.subGates.find((s) => !s.satisfied);
    if (blocking) {
      const bits: string[] = [];
      if (blocking.uncheckedChecklist.length) bits.push(`${blocking.uncheckedChecklist.length} checklist item(s)`);
      if (blocking.missingDocs.length) bits.push(`missing document(s): ${blocking.missingDocs.join(", ")}`);
      if (blocking.approvalsMissing.length) bits.push(`approval pending (${blocking.approvalsMissing.join(", ")})`);
      const seq = blocking.approvalBlockedBy.length ? ` Approve ${blocking.approvalBlockedBy.join(", ")} first.` : "";
      res.status(422).json({
        error: `${blocking.label} not yet complete — ${bits.join("; ") || "pending"}.${seq}`,
        subGate: blocking.key,
        subGateDetail: { uncheckedChecklist: blocking.uncheckedChecklist, missingDocs: blocking.missingDocs, approvalsMissing: blocking.approvalsMissing },
      });
      return;
    }
  }
  if (ev.uncheckedChecklist.length > 0) {
    res.status(422).json({
      error: `${ev.uncheckedChecklist.length} blocking checklist item(s) not yet completed. Check all mandatory items before advancing.`,
      uncheckedItems: ev.uncheckedChecklist,
    });
    return;
  }
  if (ev.ursDualApprovalMissing.length > 0) {
    res.status(422).json({ error: `URS dual-approval required before advancing. Missing approvals: ${ev.ursDualApprovalMissing.join(", ")}.` });
    return;
  }
  if (ev.openUatDefects > 0) {
    res.status(422).json({
      error: `${ev.openUatDefects} unresolved UAT defect(s) must be closed before advancing to Go Live.`,
      openDefectCount: ev.openUatDefects,
    });
    return;
  }
  if (ev.missingDocs.length > 0) {
    res.status(422).json({
      error: `Required documents not yet uploaded: ${ev.missingDocs.join(", ")}`,
      missingDocs: ev.missingDocs,
    });
    return;
  }

  // All gates passed — complete the current stage and activate the next stage on
  // this project's path (vendor vs internal).
  await db.update(projectStagesTable)
    .set({ status: "complete", completedAt: new Date() })
    .where(and(eq(projectStagesTable.projectId, projectId), eq(projectStagesTable.stage, stage)));

  const nextStage = nextStageFor(stage, project.projectType);
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
  } else {
    // No next stage — this is project_closure being completed.
    // Archive the project: mark status "closed" (read-only operational state).
    await db.update(projectsTable)
      .set({ status: "closed", updatedAt: new Date() })
      .where(eq(projectsTable.id, projectId));
    await logActivity(
      "project_closed",
      `Project ${projectId} formally closed and archived. All stages complete.`,
      projectId,
      "project",
    );
  }

  // Audit log the transition
  await logActivity(
    "stage_advanced",
    `Project lifecycle advanced from "${stage}" to "${nextStage ?? "(final)"}"${requestRole ? ` by ${requestRole}` : ""}`,
    projectId,
    "project",
  );

  const stages = await db.select().from(projectStagesTable).where(eq(projectStagesTable.projectId, projectId)).orderBy(projectStagesTable.createdAt);
  res.json({ projectId, stages, advancedTo: nextStage ?? null });
});

// Test-only: bypass ALL gates (role, prerequisites, checklist, docs, dual
// approvals) and force the project's current stage to "complete" + activate
// the next stage. Restricted to the "initiator" session role for demo/testing.
// Records the simulated approver role in the activity log so the audit trail
// still tells the story of who "approved".
router.post("/projects/:id/stages/:stage/test-advance", async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { stage } = req.params;
  const requestRole = req.session.simulatedRole;

  if (requestRole !== "initiator") {
    res.status(403).json({ error: "Test-advance is only available in initiator (testing) role." });
    return;
  }

  const gate = STAGE_GATES[stage];
  if (!gate) { res.status(400).json({ error: `Unknown stage: ${stage}` }); return; }

  const [project] = await db.select({ status: projectsTable.status, projectType: projectsTable.projectType })
    .from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }
  if (project.status === "closed") {
    res.status(409).json({ error: "Project is closed and archived." });
    return;
  }

  const { simulatedApprover } = (req.body ?? {}) as { simulatedApprover?: string };

  // For the merged initiation stage: also auto-fill the URS dual-approval flags so the audit story is consistent.
  if (stage === "initiation") {
    const [ursRecord] = await db.select().from(projectStagesTable)
      .where(and(eq(projectStagesTable.projectId, projectId), eq(projectStagesTable.stage, "initiation")));
    if (ursRecord) {
      let notes: Record<string, unknown> = {};
      try { notes = JSON.parse(ursRecord.notes ?? "{}") as Record<string, unknown>; } catch { /* ignore */ }
      const now = new Date().toISOString();
      notes.__urs_biz_approved = true;
      notes.__urs_biz_approved_at = now;
      notes.__urs_biz_approver = notes.__urs_biz_approver ?? "hod (test)";
      notes.__urs_it_approved = true;
      notes.__urs_it_approved_at = now;
      notes.__urs_it_approver = notes.__urs_it_approver ?? "pmo (test)";
      await db.update(projectStagesTable).set({ notes: JSON.stringify(notes) })
        .where(eq(projectStagesTable.id, ursRecord.id));
    }
  }

  // Complete the current stage and activate the next stage on this project's path.
  await db.update(projectStagesTable)
    .set({ status: "complete", completedAt: new Date() })
    .where(and(eq(projectStagesTable.projectId, projectId), eq(projectStagesTable.stage, stage)));

  const nextStage = nextStageFor(stage, project.projectType);
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
  } else {
    await db.update(projectsTable)
      .set({ status: "closed", updatedAt: new Date() })
      .where(eq(projectsTable.id, projectId));
  }

  await logActivity(
    "stage_test_advanced",
    `[TEST] ${simulatedApprover ?? "initiator"} force-advanced "${stage}" → "${nextStage ?? "(closed)"}"`,
    projectId,
    "project",
  );

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
