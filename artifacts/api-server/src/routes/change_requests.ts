import { Router, type IRouter } from "express";
import { db, changeRequestsTable, baselinesTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { requireRole, pick } from "../lib/guard";

const router: IRouter = Router();

const RAISE_ROLES = ["pm", "pmo", "hod", "initiator"];
const DECIDE_ROLES = ["pmo", "hod", "cfo", "chairman"];
const BASELINE_ROLES = ["pm", "pmo"];

// Fields the raiser may set; status/decision/decidedAt are NOT in here.
const CR_BASE_FIELDS = [
  "title", "description", "rationale", "changeType",
  "scheduleImpactDays", "budgetImpact",
  "scopeImpactSummary", "riskImpactSummary",
  "priority", "baselineSnapshot", "proposedSnapshot",
] as const;

// Decision-only fields (DECIDE_ROLES path)
const CR_DECISION_FIELDS = ["status", "decisionNotes", "decidedById"] as const;

router.get("/projects/:id/change-requests", async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const rows = await db.select().from(changeRequestsTable)
    .where(eq(changeRequestsTable.projectId, projectId))
    .orderBy(desc(changeRequestsTable.createdAt));
  res.json(rows);
});

router.get("/change-requests/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db.select().from(changeRequestsTable).where(eq(changeRequestsTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.post("/projects/:id/change-requests", requireRole(...RAISE_ROLES), async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const data = pick<Record<string, unknown>>(req.body, CR_BASE_FIELDS) as Record<string, unknown>;
  const { raisedById, slaHours } = (req.body ?? {}) as { raisedById?: number; slaHours?: number };
  if (!data.title || !data.description || !data.rationale || !raisedById) {
    res.status(400).json({ error: "title, description, rationale, raisedById are required" });
    return;
  }
  const existing = await db.select().from(changeRequestsTable).where(eq(changeRequestsTable.projectId, projectId));
  const crNumber = `CR-PRJ${projectId}-${String(existing.length + 1).padStart(3, "0")}`;
  const sla = typeof slaHours === "number" && slaHours > 0 ? slaHours : 72;
  const dueAt = new Date(Date.now() + sla * 60 * 60 * 1000);

  const [row] = await db.insert(changeRequestsTable).values({
    projectId,
    crNumber,
    title: String(data.title),
    description: String(data.description),
    rationale: String(data.rationale),
    changeType: (data.changeType as string) ?? "scope",
    scheduleImpactDays: (data.scheduleImpactDays as number) ?? 0,
    budgetImpact: (data.budgetImpact as string) ?? "0",
    scopeImpactSummary: (data.scopeImpactSummary as string) ?? "",
    riskImpactSummary: (data.riskImpactSummary as string) ?? "",
    priority: (data.priority as string) ?? "medium",
    raisedById,
    baselineSnapshot: (data.baselineSnapshot as Record<string, unknown>) ?? {},
    proposedSnapshot: (data.proposedSnapshot as Record<string, unknown>) ?? {},
    status: "submitted",
    slaHours: sla,
    dueAt,
  }).returning();
  res.status(201).json(row);
});

// PATCH — supports two modes:
//   1. raiser edits non-decision fields while CR is still "submitted"
//   2. decider sets status=approved/rejected (decision-only role required)
router.patch("/change-requests/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const role = req.session?.simulatedRole;
  if (!role) { res.status(403).json({ error: "No role set in session." }); return; }

  const wantsDecision = typeof req.body?.status === "string"
    && ["approved", "rejected"].includes(req.body.status);

  // Load CR to enforce ownership / status invariants
  const [current] = await db.select().from(changeRequestsTable).where(eq(changeRequestsTable.id, id));
  if (!current) { res.status(404).json({ error: "Not found" }); return; }

  let updates: Record<string, unknown> = {};
  if (wantsDecision) {
    // Only "submitted" CRs may be decided; decided CRs are immutable.
    if (current.status !== "submitted") {
      res.status(409).json({ error: `Cannot change status of a CR that is already '${current.status}'.` });
      return;
    }
    if (!DECIDE_ROLES.includes(role)) {
      res.status(403).json({ error: `Role '${role}' is not authorized to decide CRs. Allowed: ${DECIDE_ROLES.join(", ")}.` });
      return;
    }
    updates = pick<Record<string, unknown>>(req.body, CR_DECISION_FIELDS) as Record<string, unknown>;
    updates.decidedAt = new Date();
  } else {
    if (!RAISE_ROLES.includes(role)) {
      res.status(403).json({ error: `Role '${role}' is not authorized to edit CRs.` });
      return;
    }
    // Only the original raiser, a PM, or PMO may edit the CR body.
    const editorId = (req.body?.editorId as number | undefined) ?? null;
    const isPrivileged = role === "pm" || role === "pmo";
    if (!isPrivileged && (editorId == null || editorId !== current.raisedById)) {
      res.status(403).json({ error: "Only the raiser (or PM/PMO) may edit this CR." });
      return;
    }
    // Decided CRs are locked from further body edits.
    if (current.status !== "submitted") {
      res.status(409).json({ error: `CR is '${current.status}' and is locked from further edits.` });
      return;
    }
    updates = pick<Record<string, unknown>>(req.body, CR_BASE_FIELDS) as Record<string, unknown>;
  }
  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "No editable fields provided" }); return; }

  const [row] = await db.update(changeRequestsTable).set(updates).where(eq(changeRequestsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

// Baselines ----------------------------------------------------------------

router.get("/projects/:id/baselines", async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const rows = await db.select().from(baselinesTable)
    .where(eq(baselinesTable.projectId, projectId))
    .orderBy(desc(baselinesTable.capturedAt));
  res.json(rows);
});

router.post("/projects/:id/baselines", requireRole(...BASELINE_ROLES), async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { baselineType, stage, snapshot, capturedById, notes } = (req.body ?? {}) as {
    baselineType?: string; stage?: string; snapshot?: Record<string, unknown>; capturedById?: number; notes?: string;
  };
  if (!baselineType || !stage) { res.status(400).json({ error: "baselineType and stage required" }); return; }
  const existing = await db.select().from(baselinesTable)
    .where(and(eq(baselinesTable.projectId, projectId), eq(baselinesTable.baselineType, baselineType)));
  const version = existing.length + 1;
  const [row] = await db.insert(baselinesTable).values({
    projectId, baselineType, stage, version,
    snapshot: snapshot ?? {}, capturedById, notes: notes ?? "",
  }).returning();
  res.status(201).json(row);
});

// Baselines are intentionally read-mostly. Only `notes` may be edited.
router.patch("/baselines/:id", requireRole(...BASELINE_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const updates = pick<Record<string, unknown>>(req.body, ["notes"] as const) as Record<string, unknown>;
  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "Only 'notes' is editable on a baseline" }); return; }
  const [row] = await db.update(baselinesTable).set(updates).where(eq(baselinesTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

export default router;
