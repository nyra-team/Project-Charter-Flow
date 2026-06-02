// ───────────────────────────────────────────────────────────────────────────
// Standard gate milestones → lifecycle stage mapping (SSOT, server side).
//
// These are the 7 governance gate-milestones every project can carry. Each maps
// to a lifecycle stage so the work-management layer (tasks/milestones) lines up
// with the PMO lifecycle (Initiate → Procure → Execute → Release & Close).
//
// Mirror of artifacts/project-hub/src/lib/gate-milestones.ts (keep in sync).
// ───────────────────────────────────────────────────────────────────────────
import { db, milestonesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export interface GateMilestoneDef {
  name: string;
  stage: string; // one of the 9 LIFECYCLE_STAGES keys
  order: number;
}

export const GATE_MILESTONES: GateMilestoneDef[] = [
  { name: "BC Approved", stage: "initiation", order: 0 },
  { name: "URS Approved", stage: "initiation", order: 1 },
  { name: "IA Approved", stage: "investment_authorization", order: 2 },
  { name: "Contract Signed", stage: "contract_po", order: 3 },
  { name: "UAT Sign-off", stage: "uat", order: 4 },
  { name: "Go Live", stage: "go_live", order: 5 },
  { name: "Closure", stage: "closure", order: 6 },
];

/**
 * Create the standard gate milestones for a project. Idempotent — skips any gate
 * whose name already exists on the project (so re-running, or running after some
 * gates were added manually, never duplicates). Returns the number created.
 */
export async function generateGateMilestones(projectId: number): Promise<number> {
  const existing = await db
    .select({ name: milestonesTable.name })
    .from(milestonesTable)
    .where(eq(milestonesTable.projectId, projectId));
  const have = new Set(existing.map((m) => m.name.trim().toLowerCase()));

  let created = 0;
  for (const gate of GATE_MILESTONES) {
    if (have.has(gate.name.toLowerCase())) continue;
    await db.insert(milestonesTable).values({
      projectId,
      name: gate.name,
      stage: gate.stage,
      order: gate.order,
    });
    created++;
  }
  return created;
}

/**
 * Ensure a project has its catch-all "Unscheduled" milestone and return its id.
 * Used to soft-enforce "every task belongs to a milestone" — tasks created
 * without a milestone land here (user re-files them into the WBS later).
 */
export async function ensureUnscheduledMilestone(projectId: number): Promise<number> {
  const rows = await db
    .select({ id: milestonesTable.id, name: milestonesTable.name })
    .from(milestonesTable)
    .where(eq(milestonesTable.projectId, projectId));
  const hit = rows.find((r) => r.name.trim().toLowerCase() === "unscheduled");
  if (hit) return hit.id;
  const [created] = await db
    .insert(milestonesTable)
    .values({ projectId, name: "Unscheduled", order: 9999 })
    .returning({ id: milestonesTable.id });
  return created.id;
}

/** Resolve the stage for a milestone name if it is a known gate (else null). */
export function gateStageForName(name: string): string | null {
  const g = GATE_MILESTONES.find((m) => m.name.toLowerCase() === name.trim().toLowerCase());
  return g?.stage ?? null;
}

// ── Milestone name → lifecycle stage (SSOT for migration + auto-tagging) ──────
// Ordered specific→general; first matching substring wins. Covers the standard
// gate names plus the common custom milestone names seen across live PMO data.
// Unmatched → null (rendered under "Unassigned Stage", user-editable).
const STAGE_NAME_PATTERNS: Array<[patterns: string[], stage: string]> = [
  [["user requirement", "urs", "business case", "brd", "bc approved"], "initiation"],
  [["rfp", "request for proposal", "vendor demo", "vendor short", "vendor eval", "vendor selection",
    "commercial negotiation", "negotiation", "comparison matrix", "functional assessment",
    "technical assessment", "functional evaluation", "technical evaluation", "proposal", "evaluation"], "vendor_selection"],
  [["charter", "note for approval", "nfa", "investment", "budget approval", "ia approved"], "investment_authorization"],
  [["po release", "purchase order", "p.o", "contract", "legal", "pr release", "agreement"], "contract_po"],
  [["technical design", "functional design", "business blue print", "business blueprint", "bbp",
    "architecture", "kickoff", "kick off", "design"], "design"],
  [["unit testing", "development", "build", "implementation", "configuration", "coding"], "build"],
  [["uat", "user acceptance", "sit", "system integration test"], "uat"],
  [["go live", "go-live", "golive", "deployment", "cutover", "training", "rollout"], "go_live"],
  [["closure", "csat", "handover", "hand over", "lessons", "project close", "sign off", "sign-off"], "closure"],
];

/**
 * Best-effort lifecycle stage for an arbitrary milestone name. Gate names match
 * first (exact), then the ordered substring patterns. Returns null when no
 * confident match — caller treats that as "Unassigned Stage".
 */
export function milestoneStageFromName(name: string): string | null {
  const gate = gateStageForName(name);
  if (gate) return gate;
  const n = name.trim().toLowerCase();
  for (const [patterns, stage] of STAGE_NAME_PATTERNS) {
    if (patterns.some((p) => n.includes(p))) return stage;
  }
  return null;
}
