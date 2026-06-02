import { db, usersTable, chartersTable, projectsTable, roleDirectoryTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

export type Recipient = { userId: number | null; name: string; email: string | null };

// Roles that are SPECIFIC to a project and therefore resolved from the charter/project,
// not the global role directory. Everything else (cfo, procurement_head, qa_lead,
// steering_committee, hod, …) is a global org role looked up in pmo_role_directory.
const PROJECT_SCOPED = new Set(["project_manager", "pm", "owner", "sponsor"]);

async function userById(id: number | null | undefined): Promise<Recipient | null> {
  if (!id) return null;
  const [u] = await db
    .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.id, id));
  if (!u) return null;
  return { userId: u.id, name: u.name, email: u.email ?? null };
}

/**
 * Resolve a governance role to the actual person/email(s) to notify.
 *
 *   - project_manager / owner → projects.projectManagerId, else charter.projectOwnerId
 *   - sponsor                 → charter.projectSponsorId
 *   - any other role          → pmo_role_directory (global; person via user_id or a
 *                               group email)
 *
 * Returns [] when the role can't be resolved (unmapped directory row, missing charter
 * field) — callers MUST tolerate empty and surface the gap rather than crash. Logged at
 * warn so admins can spot un-assigned roles.
 */
export async function resolveRole(role: string, projectId?: number): Promise<Recipient[]> {
  const key = role.trim().toLowerCase();

  if (PROJECT_SCOPED.has(key)) {
    if (!projectId) return [];
    const [project] = await db
      .select({ projectManagerId: projectsTable.projectManagerId, charterId: projectsTable.charterId })
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId));
    if (!project) return [];
    let charter: { sponsor: number | null; owner: number | null; manager: number | null } | null = null;
    if (project.charterId) {
      const [c] = await db
        .select({
          sponsor: chartersTable.projectSponsorId,
          owner: chartersTable.projectOwnerId,
          manager: chartersTable.projectManagerId,
        })
        .from(chartersTable)
        .where(eq(chartersTable.id, project.charterId));
      charter = c ?? null;
    }
    let targetId: number | null = null;
    if (key === "sponsor") targetId = charter?.sponsor ?? null;
    else targetId = project.projectManagerId ?? charter?.manager ?? charter?.owner ?? null; // pm / owner
    const r = await userById(targetId);
    if (!r) { logger.warn({ role: key, projectId }, "role-resolver: project-scoped role unresolved"); return []; }
    return [r];
  }

  // Global org role via the admin directory.
  const [row] = await db
    .select()
    .from(roleDirectoryTable)
    .where(eq(roleDirectoryTable.role, key));
  if (!row || !row.isActive) { logger.warn({ role: key }, "role-resolver: role not in directory / inactive"); return []; }

  // Prefer a linked pmo_users row (enables in-app notification); fall back to a
  // standalone email (e.g. a Steering Committee distribution list).
  if (row.userId) {
    const r = await userById(row.userId);
    if (r) return [{ ...r, name: r.name || row.label || key }];
  }
  if (row.email) {
    return [{ userId: null, name: row.label || key, email: row.email }];
  }
  logger.warn({ role: key }, "role-resolver: directory row has no person/email assigned");
  return [];
}
