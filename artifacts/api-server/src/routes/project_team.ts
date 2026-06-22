import { Router, type IRouter } from "express";
import { db, projectTeamMembersTable, projectTeamRaciTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireRole } from "../lib/guard";

const router: IRouter = Router();

const WRITE_ROLES = ["pm", "pmo", "hod", "initiator"];

// RASCI allowlist — mirrors the per-task RACI matrix (routes/resources.ts):
// Responsible, Accountable, Support, Consulted, Informed.
const RACI_TYPES = ["R", "A", "S", "C", "I"];

// Per-member approval status, set inline in the Team table.
const APPROVAL_VALUES = ["pending", "approved", "rejected"];

// ── Team members ────────────────────────────────────────────────────────────

// Bulk list across all projects — feeds the Projects board "Team" column so it
// can render every project's roster without an N+1 of per-project requests.
router.get("/team-members", async (_req, res): Promise<void> => {
  const members = await db.select().from(projectTeamMembersTable);
  res.json(members);
});

router.get("/projects/:id/team-members", async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const members = await db.select().from(projectTeamMembersTable).where(eq(projectTeamMembersTable.projectId, projectId));
  res.json(members);
});

router.post("/projects/:id/team-members", requireRole(...WRITE_ROLES), async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { memberType, userId, externalName, externalOrg, externalEmail, externalKind, role, responsibilities, approval } = req.body as {
    memberType?: string; userId?: number; externalName?: string; externalOrg?: string;
    externalEmail?: string; externalKind?: string; role?: string; responsibilities?: string; approval?: string;
  };
  if (memberType !== "internal" && memberType !== "external") {
    res.status(400).json({ error: "memberType must be 'internal' or 'external'" }); return;
  }
  if (memberType === "internal" && !userId) { res.status(400).json({ error: "userId is required for an internal member" }); return; }
  if (memberType === "external" && !externalName) { res.status(400).json({ error: "externalName is required for an external member" }); return; }
  const [member] = await db.insert(projectTeamMembersTable).values({
    projectId,
    memberType,
    userId: memberType === "internal" ? userId : null,
    externalName: memberType === "external" ? externalName : null,
    externalOrg: memberType === "external" ? externalOrg : null,
    externalEmail: memberType === "external" ? externalEmail : null,
    externalKind: memberType === "external" ? externalKind : null,
    role,
    responsibilities,
    approval: APPROVAL_VALUES.includes(approval ?? "") ? approval : "pending",
  }).returning();
  res.status(201).json(member);
});

router.patch("/team-members/:id", requireRole(...WRITE_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const updateData: Record<string, unknown> = {};
  const fields = ["userId", "externalName", "externalOrg", "externalEmail", "externalKind", "role", "responsibilities", "approval"];
  for (const f of fields) {
    if (req.body[f] !== undefined) updateData[f] = req.body[f];
  }
  if (updateData.approval !== undefined && !APPROVAL_VALUES.includes(String(updateData.approval))) {
    res.status(400).json({ error: `Invalid approval '${updateData.approval}'. Allowed: ${APPROVAL_VALUES.join(", ")}.` }); return;
  }
  if (Object.keys(updateData).length === 0) { res.status(400).json({ error: "No editable fields supplied" }); return; }
  const [member] = await db.update(projectTeamMembersTable).set(updateData).where(eq(projectTeamMembersTable.id, id)).returning();
  if (!member) { res.status(404).json({ error: "Team member not found" }); return; }
  res.json(member);
});

router.delete("/team-members/:id", requireRole("pmo", "pm"), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  // Remove the member's RACI cells first so the matrix never references a ghost.
  await db.delete(projectTeamRaciTable).where(eq(projectTeamRaciTable.memberId, id));
  await db.delete(projectTeamMembersTable).where(eq(projectTeamMembersTable.id, id));
  res.sendStatus(204);
});

// ── Project-level RACI matrix (member x deliverable) ─────────────────────────

router.get("/projects/:id/team-raci", async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const cells = await db.select().from(projectTeamRaciTable).where(eq(projectTeamRaciTable.projectId, projectId));
  res.json(cells);
});

router.post("/projects/:id/team-raci", requireRole(...WRITE_ROLES), async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.id);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { memberId, deliverable, raciType } = req.body as { memberId?: number; deliverable?: string; raciType?: string };
  if (!memberId || !deliverable || !raciType) {
    res.status(400).json({ error: "memberId, deliverable and raciType are required" }); return;
  }
  if (!RACI_TYPES.includes(raciType)) {
    res.status(400).json({ error: `Invalid raciType '${raciType}'. Allowed: ${RACI_TYPES.join(", ")}.` }); return;
  }
  const [cell] = await db.insert(projectTeamRaciTable).values({ projectId, memberId, deliverable, raciType }).returning();
  res.status(201).json(cell);
});

router.delete("/team-raci/:id", requireRole("pmo", "pm"), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(projectTeamRaciTable).where(eq(projectTeamRaciTable.id, id));
  res.sendStatus(204);
});

export default router;
