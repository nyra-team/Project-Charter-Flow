import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { db, projectsTable, chartersTable, tasksTable, usersTable, projectJustificationsTable } from "@workspace/db";
import { eq, desc, inArray, or } from "drizzle-orm";
import { logActivity } from "./activity";
import { notify } from "../lib/notify";
import { resolveRole } from "../lib/role-resolver";

const router: IRouter = Router();

type Kind = "delayed" | "off_track";

// Resolve the current user's local pmo_users.id from their authenticated email.
async function resolveMeId(email?: string | null): Promise<number | null> {
  if (!email) return null;
  const [me] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email.toLowerCase()));
  return me?.id ?? null;
}

// Project ids the user is the OWNER / PM of — the "respective owner" who must
// justify. Charter owner or charter/project manager only (NOT sponsor/squad),
// so we never lock someone out over a project they merely have visibility into.
async function ownedProjectIds(meId: number): Promise<number[]> {
  const ledCharters = await db.select({ id: chartersTable.id }).from(chartersTable)
    .where(or(eq(chartersTable.projectOwnerId, meId), eq(chartersTable.projectManagerId, meId)));
  const charterIds = ledCharters.map((c) => c.id).filter((x): x is number => x != null);
  const where = charterIds.length
    ? or(eq(projectsTable.projectManagerId, meId), inArray(projectsTable.charterId, charterIds))!
    : eq(projectsTable.projectManagerId, meId);
  const rows = await db.select({ id: projectsTable.id }).from(projectsTable).where(where);
  return rows.map((r) => r.id);
}

// Schedule health — IDENTICAL rule to the Delivery bar (deliveryHealthKey) and
// the dashboard: delayed = past end date & not complete; off_track = completion
// >15 pts behind the elapsed timeline. Returns null when no justification is due.
function deliveryKind(
  p: { status: string | null; startDate: string | null; endDate: string | null; progress: number | null },
  agg: { total: number; done: number },
): Kind | null {
  const status = (p.status ?? "").toLowerCase();
  if (status === "cancelled" || status === "postponed" || status === "completed") return null;
  const now = Date.now();
  const actualPct = agg.total > 0 ? (agg.done / agg.total) * 100 : (p.progress ?? 0);
  const start = p.startDate ? new Date(p.startDate.slice(0, 10)).getTime() : null;
  const end = p.endDate ? new Date(p.endDate.slice(0, 10)).getTime() : null;
  if (end != null && end < now) return "delayed";
  let expectedPct = 0;
  if (start != null && end != null && end > start) expectedPct = Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100));
  if (expectedPct - actualPct > 15) return "off_track";
  return null;
}

// Per-project task aggregate (done = status "completed"), matching the dashboard.
async function aggByProject(projectIds: number[]): Promise<Map<number, { total: number; done: number }>> {
  const m = new Map<number, { total: number; done: number }>();
  if (!projectIds.length) return m;
  const tasks = await db.select({ projectId: tasksTable.projectId, status: tasksTable.status }).from(tasksTable)
    .where(inArray(tasksTable.projectId, projectIds));
  for (const t of tasks) {
    const e = m.get(t.projectId) ?? { total: 0, done: 0 };
    e.total++;
    if (t.status === "completed") e.done++;
    m.set(t.projectId, e);
  }
  return m;
}

// Latest justification per project (over the given ids).
async function latestByProject(projectIds: number[]): Promise<Map<number, { kind: string; justification: string; createdAt: Date; userId: number }>> {
  const m = new Map<number, { kind: string; justification: string; createdAt: Date; userId: number }>();
  if (!projectIds.length) return m;
  const rows = await db.select().from(projectJustificationsTable)
    .where(inArray(projectJustificationsTable.projectId, projectIds))
    .orderBy(desc(projectJustificationsTable.createdAt));
  for (const r of rows) {
    if (!m.has(r.projectId)) m.set(r.projectId, { kind: r.kind, justification: r.justification, createdAt: r.createdAt, userId: r.userId });
  }
  return m;
}

// GET /api/projects/justifications/required
// The owner's projects that are CURRENTLY delayed/off-track and whose current
// kind has no matching justification yet. Drives the mandatory blocking modal.
router.get("/projects/justifications/required", async (req, res): Promise<void> => {
  const meId = await resolveMeId(req.user?.email);
  if (!meId) { res.json([]); return; }
  const ids = await ownedProjectIds(meId);
  if (!ids.length) { res.json([]); return; }
  const projects = await db.select({
    id: projectsTable.id, name: projectsTable.name, status: projectsTable.status,
    startDate: projectsTable.startDate, endDate: projectsTable.endDate, progress: projectsTable.progress,
  }).from(projectsTable).where(inArray(projectsTable.id, ids));
  const aggs = await aggByProject(ids);
  const latest = await latestByProject(ids);
  const due = projects.flatMap((p) => {
    const kind = deliveryKind(p, aggs.get(p.id) ?? { total: 0, done: 0 });
    if (!kind) return [];
    const last = latest.get(p.id);
    if (last && last.kind === kind) return []; // already justified for this kind/episode
    return [{ projectId: p.id, name: p.name, kind }];
  });
  res.json(due);
});

// GET /api/project-justifications/latest — latest per project (for the column).
router.get("/project-justifications/latest", async (_req, res): Promise<void> => {
  const rows = await db.select().from(projectJustificationsTable).orderBy(desc(projectJustificationsTable.createdAt));
  const seen = new Set<number>();
  const out: Array<{ projectId: number; kind: string; justification: string; createdAt: Date; by: string | null }> = [];
  const userIds = [...new Set(rows.map((r) => r.userId))];
  const users = userIds.length
    ? await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(inArray(usersTable.id, userIds))
    : [];
  const nameById = new Map(users.map((u) => [u.id, u.name]));
  for (const r of rows) {
    if (seen.has(r.projectId)) continue;
    seen.add(r.projectId);
    out.push({ projectId: r.projectId, kind: r.kind, justification: r.justification, createdAt: r.createdAt, by: nameById.get(r.userId) ?? null });
  }
  res.json(out);
});

const CreateBody = z.object({
  projectId: z.number().int(),
  kind: z.enum(["delayed", "off_track"]),
  justification: z.string().trim().min(10).max(2000),
});

// POST /api/project-justifications — only the project's owner/PM may submit.
router.post("/project-justifications", async (req, res): Promise<void> => {
  const parsed = CreateBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { projectId, kind, justification } = parsed.data;
  const meId = await resolveMeId(req.user?.email);
  if (!meId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const owned = await ownedProjectIds(meId);
  if (!owned.includes(projectId)) { res.status(403).json({ error: "Only the project owner can submit a justification" }); return; }
  const [row] = await db.insert(projectJustificationsTable).values({ projectId, userId: meId, kind, justification }).returning();
  await logActivity("justification_submitted", `Delay/off-track justification submitted (${kind})`, projectId, "project", meId);
  res.status(201).json(row);
});

// POST /api/project-justifications/request  { projectId }
// Nudge the project's OWNER/PM to record a delay/off-track justification. Fans
// out via notify(): in-app bell (primary) + branded email (best-effort). Only
// allowed while the project is actually delayed/off-track and still unjustified
// for the current episode — mirrors the blocking modal's own gate.
const RequestBody = z.object({ projectId: z.number().int() });

router.post("/project-justifications/request", async (req, res): Promise<void> => {
  const parsed = RequestBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { projectId } = parsed.data;
  const meId = await resolveMeId(req.user?.email);
  if (!meId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const [p] = await db.select({
    id: projectsTable.id, name: projectsTable.name, status: projectsTable.status,
    startDate: projectsTable.startDate, endDate: projectsTable.endDate, progress: projectsTable.progress,
  }).from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!p) { res.status(404).json({ error: "Project not found" }); return; }

  // Only request when the project is genuinely delayed / off-track right now.
  const aggs = await aggByProject([projectId]);
  const kind = deliveryKind(p, aggs.get(projectId) ?? { total: 0, done: 0 });
  if (!kind) { res.status(409).json({ error: "Project is on track — no justification needed." }); return; }

  // Already justified for this exact episode? Then there's nothing to chase.
  const latest = await latestByProject([projectId]);
  const last = latest.get(projectId);
  if (last && last.kind === kind) { res.status(409).json({ error: "A justification has already been recorded." }); return; }

  // Resolve the owner/PM — the "respective owner" who must justify.
  const recipients = await resolveRole("owner", projectId);
  if (!recipients.length) { res.status(409).json({ error: "This project has no owner/PM to notify." }); return; }

  const kindLabel = kind === "delayed" ? "Delayed" : "Off Track";
  const kindLine = kind === "delayed" ? "is past its target end date and not yet complete" : "has fallen behind its schedule";
  const link = `/projects/${projectId}`;

  const result = await notify({
    projectId,
    type: "justification_requested",
    title: `Justification requested — ${p.name}`,
    body: `Your project “${p.name}” is ${kindLabel} — it ${kindLine}. Please record the reason for the delay/off-track status and your recovery plan in the Project Hub.`,
    link,
    relatedEntityType: "project",
    relatedEntityId: projectId,
    recipients,
    email: {
      banner: {
        emoji: "⚠️",
        title: "Justification required",
        subtitle: `${p.name} — ${kindLabel}`,
        color: kind === "delayed" ? "#DC2626" : "#D97706",
      },
    },
  });

  await logActivity("justification_requested", `Justification requested for ${kindLabel} project`, projectId, "project", meId);
  res.json({ ok: true, kind, notified: result.notified, emailed: result.emailed, owner: recipients[0]?.name ?? null });
});

export default router;
