import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import {
  db,
  pifsTable,
  projectsTable,
  chartersTable,
  notificationsTable,
  projectTemplatesTable,
  templateTasksTable,
  templateMilestonesTable,
  tasksTable,
  milestonesTable,
} from "@workspace/db";
import { eq, desc, asc, and, isNotNull } from "drizzle-orm";
import { seedProjectTemplateDocuments } from "../lib/templateDocuments";
import { logActivity } from "./activity";
import { requireRole } from "../lib/guard";

const router: IRouter = Router();

const WRITE_ROLES = ["pm", "pmo", "hod", "initiator"];
const DECIDE_ROLES = ["pmo", "hod", "cfo", "chairman", "executive_director", "scm", "finance"];

// ─── Validation schemas (inline; lift to api-zod in one harmonisation pass later) ─

const CreatePifBody = z.object({
  title: z.string().min(1),
  businessProblem: z.string().min(1),
  proposedSolution: z.string().min(1),
  sponsorId: z.number().int().optional(),
  hodId: z.number().int().optional(),
  targetOutcomes: z.array(z.string()).optional(),
  successMetrics: z.array(z.string()).optional(),
  dependencies: z.array(z.string()).optional(),
  topRisks: z.array(z.string()).optional(),
  estimatedCapex: z.number().nonnegative().optional(),
  estimatedOpex: z.number().nonnegative().optional(),
  estimatedDurationDays: z.number().int().positive().optional(),
  classification: z.string().optional(),
  urgency: z.string().optional(),
  createdById: z.number().int().optional(),
});

const UpdatePifBody = CreatePifBody.partial();

const DecideBody = z.object({
  decision: z.enum(["approve", "reject"]),
  note: z.string().optional(),
  decidedById: z.number().int().optional(),
});

const ConvertBody = z.object({
  templateId: z.number().int().optional(),
  projectName: z.string().min(1).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "startDate must be YYYY-MM-DD").optional(),
  projectManagerId: z.number().int().optional(),
});

// ─── Helper: serialise numeric() fields ─────────────────────────────────────
//
// Drizzle's numeric() column maps to a JS string at insert time. Centralise
// the casting so route bodies can stay typed as `number | undefined`.
function numericOrUndef(v: number | undefined | null): string | undefined {
  return v == null ? undefined : String(v);
}

function addDays(yyyyMmDd: string, days: number): string {
  const d = new Date(yyyyMmDd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ═══════════════════════════════════════════════════════════════════════════
// PIF — CRUD
// ═══════════════════════════════════════════════════════════════════════════

router.get("/pifs", async (req, res): Promise<void> => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const rows = status
    ? await db.select().from(pifsTable).where(eq(pifsTable.status, status)).orderBy(desc(pifsTable.updatedAt))
    : await db.select().from(pifsTable).orderBy(desc(pifsTable.updatedAt));
  res.json(rows);
});

router.get("/pifs/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [pif] = await db.select().from(pifsTable).where(eq(pifsTable.id, id));
  if (!pif) { res.status(404).json({ error: "PIF not found" }); return; }
  res.json(pif);
});

router.post("/pifs", requireRole(...WRITE_ROLES), async (req, res): Promise<void> => {
  const parsed = CreatePifBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { estimatedCapex, estimatedOpex, ...rest } = parsed.data;
  const [pif] = await db
    .insert(pifsTable)
    .values({
      ...rest,
      estimatedCapex: numericOrUndef(estimatedCapex),
      estimatedOpex: numericOrUndef(estimatedOpex),
    } as never)
    .returning();
  await logActivity("pif_created", `PIF "${pif.title}" created`, pif.id, "pif");
  res.status(201).json(pif);
});

router.patch("/pifs/:id", requireRole(...WRITE_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = UpdatePifBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  // Decided PIFs (approved / rejected / converted) are frozen — editing them
  // would silently break the decision audit trail. Force a clone via the UI
  // if the user wants to revise after sign-off.
  const [current] = await db.select({ status: pifsTable.status }).from(pifsTable).where(eq(pifsTable.id, id));
  if (!current) { res.status(404).json({ error: "PIF not found" }); return; }
  if (["approved", "rejected", "converted"].includes(current.status)) {
    res.status(409).json({ error: `PIF is ${current.status} and frozen. Clone it to make changes.` });
    return;
  }

  const { estimatedCapex, estimatedOpex, ...rest } = parsed.data;
  const updates: Record<string, unknown> = { ...rest };
  if (estimatedCapex !== undefined) updates.estimatedCapex = numericOrUndef(estimatedCapex);
  if (estimatedOpex !== undefined) updates.estimatedOpex = numericOrUndef(estimatedOpex);

  const [pif] = await db.update(pifsTable).set(updates).where(eq(pifsTable.id, id)).returning();
  res.json(pif);
});

router.delete("/pifs/:id", requireRole("pmo", "pm"), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  // Only drafts can be hard-deleted. Decided rows stay for audit.
  const [current] = await db.select({ status: pifsTable.status }).from(pifsTable).where(eq(pifsTable.id, id));
  if (!current) { res.status(404).json({ error: "PIF not found" }); return; }
  if (current.status !== "draft") {
    res.status(409).json({ error: "Only draft PIFs can be deleted. Submitted/decided PIFs are kept for audit." });
    return;
  }
  await db.delete(pifsTable).where(eq(pifsTable.id, id));
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// SUBMIT FOR APPROVAL — hands ownership to the HOD
// ═══════════════════════════════════════════════════════════════════════════

router.post("/pifs/:id/submit", requireRole(...WRITE_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [pif] = await db.select().from(pifsTable).where(eq(pifsTable.id, id));
  if (!pif) { res.status(404).json({ error: "PIF not found" }); return; }
  if (pif.status !== "draft") {
    res.status(409).json({ error: `PIF is ${pif.status}; only drafts can be submitted.` });
    return;
  }
  if (!pif.hodId) {
    res.status(400).json({ error: "PIF must have an hodId before submission" });
    return;
  }

  const [updated] = await db
    .update(pifsTable)
    .set({ status: "submitted" })
    .where(eq(pifsTable.id, id))
    .returning();

  // Notify the HOD so it shows up in the bell + nudges (mirrored as a
  // notification row — single source the bell already reads).
  await db.insert(notificationsTable).values({
    userId: pif.hodId,
    type: "pif_pending",
    title: `New PIF awaiting your review: "${pif.title}"`,
    body: "A new Project Initiation Form has been submitted for your sign-off.",
    link: `/pifs/${pif.id}`,
    relatedEntityType: "pif",
    relatedEntityId: pif.id,
  } as never);

  await logActivity("pif_submitted", `PIF "${pif.title}" submitted for HOD review`, pif.id, "pif");
  res.json(updated);
});

// ═══════════════════════════════════════════════════════════════════════════
// DECIDE — HOD approves or rejects
//
// Single-stage gate — kept inline rather than wired through the multi-stage
// approvals engine, because a single approver doesn't need the chain
// orchestration that engine provides. If PIF approval ever needs multi-level
// routing, lift into the engine then.
// ═══════════════════════════════════════════════════════════════════════════

router.post("/pifs/:id/decide", requireRole(...DECIDE_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = DecideBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [pif] = await db.select().from(pifsTable).where(eq(pifsTable.id, id));
  if (!pif) { res.status(404).json({ error: "PIF not found" }); return; }
  if (!["submitted", "under_review"].includes(pif.status)) {
    res.status(409).json({ error: `PIF is ${pif.status}; only submitted/under_review PIFs can be decided.` });
    return;
  }

  const newStatus = parsed.data.decision === "approve" ? "approved" : "rejected";
  const [updated] = await db
    .update(pifsTable)
    .set({
      status: newStatus,
      decidedAt: new Date(),
      decidedById: parsed.data.decidedById,
      decisionNote: parsed.data.note ?? null,
    } as never)
    .where(eq(pifsTable.id, id))
    .returning();

  // Notify the sponsor + originator so they hear about the verdict promptly.
  const recipients = new Set<number>();
  if (pif.sponsorId) recipients.add(pif.sponsorId);
  if (pif.createdById) recipients.add(pif.createdById);
  for (const userId of recipients) {
    await db.insert(notificationsTable).values({
      userId,
      type: newStatus === "approved" ? "pif_approved" : "pif_rejected",
      title:
        newStatus === "approved"
          ? `PIF approved: "${pif.title}"`
          : `PIF rejected: "${pif.title}"`,
      body: parsed.data.note?.trim() || null,
      link: `/pifs/${pif.id}`,
      relatedEntityType: "pif",
      relatedEntityId: pif.id,
    } as never);
  }

  await logActivity(
    `pif_${newStatus}`,
    `PIF "${pif.title}" ${newStatus}${parsed.data.note ? ` — ${parsed.data.note}` : ""}`,
    pif.id,
    "pif",
  );
  res.json(updated);
});

// ═══════════════════════════════════════════════════════════════════════════
// CONVERT TO PROJECT
//
// Spawns a real pmo_projects row + a charter shell from an approved PIF.
// Optionally accepts a templateId to chain through Stage 1's from-template
// expansion (so the spawned project arrives with tasks + milestones
// pre-populated). Marks the PIF status as `converted` and stamps the
// converted_project_id backlink.
// ═══════════════════════════════════════════════════════════════════════════

router.post("/pifs/:id/convert-to-project", requireRole(...WRITE_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = ConvertBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [pif] = await db.select().from(pifsTable).where(eq(pifsTable.id, id));
  if (!pif) { res.status(404).json({ error: "PIF not found" }); return; }
  if (pif.status !== "approved") {
    res.status(409).json({ error: "Only approved PIFs can be converted to a project." });
    return;
  }

  const projectName = parsed.data.projectName?.trim() || pif.title;
  const startDate = parsed.data.startDate || new Date().toISOString().slice(0, 10);

  // 1. Project shell — minimal fields. PM-set fields (budget, etc.) follow
  //    later through the project edit surface.
  const [project] = await db
    .insert(projectsTable)
    .values({
      name: projectName,
      description: pif.proposedSolution,
      projectManagerId: parsed.data.projectManagerId,
      capexBudget: pif.estimatedCapex ?? undefined,
      opexBudget: pif.estimatedOpex ?? undefined,
      startDate,
    } as never)
    .returning();

  // Attach the universal deliverable templates (idempotent, non-fatal).
  try { await seedProjectTemplateDocuments(project.id, null); } catch { /* non-fatal */ }

  // 2. Charter shell — pre-fills the BRD with the PIF's narrative so the
  //    initiator doesn't have to retype.
  await db.insert(chartersTable).values({
    projectId: project.id,
    title: projectName,
    description: pif.businessProblem,
    scope: pif.proposedSolution,
    status: "draft",
  } as never);

  // 3. Optional template expansion — same two-pass remap as
  //    routes/templates.ts to keep parent/predecessor wiring intact.
  if (parsed.data.templateId) {
    const [tpl] = await db
      .select()
      .from(projectTemplatesTable)
      .where(eq(projectTemplatesTable.id, parsed.data.templateId));
    if (tpl) {
      const tasksRows = await db
        .select()
        .from(templateTasksTable)
        .where(eq(templateTasksTable.templateId, tpl.id))
        .orderBy(asc(templateTasksTable.sortOrder));
      const milestonesRows = await db
        .select()
        .from(templateMilestonesTable)
        .where(eq(templateMilestonesTable.templateId, tpl.id))
        .orderBy(asc(templateMilestonesTable.sortOrder));

      for (const m of milestonesRows) {
        await db.insert(milestonesTable).values({
          projectId: project.id,
          name: m.name,
          description: m.description ?? "",
          dueDate: addDays(startDate, m.defaultDayOffset),
          gateDecision: m.gateDecision,
          readinessChecklist: (m.readinessChecklist as unknown[]) ?? [],
          order: m.sortOrder,
        } as never);
      }

      const idMap = new Map<number, number>();
      for (const t of tasksRows) {
        const start = addDays(startDate, t.defaultDayOffset);
        const end = addDays(start, t.defaultDurationDays);
        const [row] = await db
          .insert(tasksTable)
          .values({
            projectId: project.id,
            name: t.name,
            description: t.description ?? "",
            startDate: start,
            endDate: end,
            priority: t.defaultPriority,
            plannedEffortHours: t.defaultEffortHours ?? undefined,
            order: t.sortOrder,
          } as never)
          .returning();
        idMap.set(t.id, row.id);
      }
      for (const t of tasksRows) {
        const newId = idMap.get(t.id);
        if (!newId) continue;
        const updates: Record<string, unknown> = {};
        if (t.parentTaskId && idMap.has(t.parentTaskId)) {
          updates.parentTaskId = idMap.get(t.parentTaskId);
        }
        const preds = (t.predecessorOffsets as Array<{ templateTaskId: number; lagDays: number }>) || [];
        const newPreds = preds.map((p) => idMap.get(p.templateTaskId)).filter((x): x is number => x != null);
        if (newPreds.length) updates.predecessorIds = JSON.stringify(newPreds);
        if (Object.keys(updates).length) {
          await db.update(tasksTable).set(updates).where(eq(tasksTable.id, newId));
        }
      }
    }
  }

  // 4. Stamp the PIF row to record the conversion.
  await db
    .update(pifsTable)
    .set({ status: "converted", convertedProjectId: project.id, convertedAt: new Date() } as never)
    .where(eq(pifsTable.id, id));

  // 5. Notify the PM (if assigned) and originator that the project is live.
  const recipients = new Set<number>();
  if (parsed.data.projectManagerId) recipients.add(parsed.data.projectManagerId);
  if (pif.createdById) recipients.add(pif.createdById);
  for (const userId of recipients) {
    await db.insert(notificationsTable).values({
      userId,
      type: "project_created_from_pif",
      title: `New project ready: "${project.name}"`,
      body: parsed.data.templateId
        ? "Spawned from your PIF with a pre-populated task graph."
        : "Spawned from your PIF — add tasks and milestones to start.",
      link: `/projects/${project.id}`,
      relatedEntityType: "project",
      relatedEntityId: project.id,
    } as never);
  }

  await logActivity(
    "pif_converted",
    `PIF "${pif.title}" converted to project ${project.id}${parsed.data.templateId ? ` (template ${parsed.data.templateId})` : ""}`,
    pif.id,
    "pif",
  );
  res.status(201).json({ pif: { ...pif, status: "converted", convertedProjectId: project.id }, project });
});

// ═══════════════════════════════════════════════════════════════════════════
// HOD INBOX — convenience endpoint for the approvals UI
// ═══════════════════════════════════════════════════════════════════════════

router.get("/pifs/inbox/:hodId", async (req, res): Promise<void> => {
  const hodId = parseInt(req.params.hodId);
  if (isNaN(hodId)) { res.status(400).json({ error: "Invalid hodId" }); return; }
  const rows = await db
    .select()
    .from(pifsTable)
    .where(and(eq(pifsTable.hodId, hodId), isNotNull(pifsTable.status)))
    .orderBy(desc(pifsTable.updatedAt));
  res.json(rows.filter((p) => ["submitted", "under_review"].includes(p.status)));
});

export default router;
