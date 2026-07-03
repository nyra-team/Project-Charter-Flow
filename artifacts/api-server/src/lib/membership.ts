// Membership-based access control for the "user" tier of Project Hub.
//
// Base PMO users (the "User role") may only VIEW projects they belong to and
// EDIT tasks assigned to them. Admins (super-admin / pmo_role='admin'), the
// see-all roles (chairman / executive_director / transformation), and the
// editor roles (pm / pmo / hod) are unaffected — they keep today's broad access.
//
// "Member of a project" mirrors the projects-list visibility rule exactly:
// the project's PM, or the linked charter's owner / sponsor / manager, or a
// charter squad member. "Assignee of a task" = its assignee_id or cft_owner.

import type { Request, Response, NextFunction, RequestHandler } from "express";
import { and, eq } from "drizzle-orm";
import { db, usersTable, projectsTable, chartersTable, squadMembersTable, tasksTable } from "@workspace/db";
import type { PmoUser } from "../middlewares/requireAuth";

const EDITOR_ROLES = new Set(["pm", "pmo", "hod"]);

/**
 * True when the caller is a base "User" — subject to membership gating.
 * False for admins, see-all roles, and the pm/pmo/hod editors (they keep
 * their existing broad access, so gating is a no-op for them).
 */
export function isRestrictedUser(user: PmoUser | undefined): boolean {
  if (!user) return false;
  if (user.isSuperAdmin || user.pmoRole === "admin") return false;
  if (user.seeAllProjects) return false;
  if (EDITOR_ROLES.has(user.pmoRole)) return false;
  return true;
}

/** Resolve the caller's local pmo_users.id from their office email. */
async function localUserId(email: string): Promise<number | null> {
  const [me] = await db.select({ id: usersTable.id }).from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase()));
  return me?.id ?? null;
}

/** Is the caller a member of this project (PM / charter role / squad)? */
export async function isProjectMember(email: string, projectId: number): Promise<boolean> {
  const meId = await localUserId(email);
  if (meId == null) return false;
  const [proj] = await db.select({
    charterId: projectsTable.charterId,
    projectManagerId: projectsTable.projectManagerId,
  }).from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!proj) return false;
  if (proj.projectManagerId === meId) return true;
  if (proj.charterId != null) {
    const [ch] = await db.select({
      owner: chartersTable.projectOwnerId,
      sponsor: chartersTable.projectSponsorId,
      manager: chartersTable.projectManagerId,
    }).from(chartersTable).where(eq(chartersTable.id, proj.charterId));
    if (ch && (ch.owner === meId || ch.sponsor === meId || ch.manager === meId)) return true;
    const [sq] = await db.select({ id: squadMembersTable.id }).from(squadMembersTable)
      .where(and(eq(squadMembersTable.charterId, proj.charterId), eq(squadMembersTable.userId, meId)));
    if (sq) return true;
  }
  return false;
}

/** Is the caller the assignee (or CFT owner) of this task / subtask? */
export async function isTaskAssignee(email: string, taskId: number): Promise<boolean> {
  const meId = await localUserId(email);
  if (meId == null) return false;
  const [t] = await db.select({ assignee: tasksTable.assigneeId, cft: tasksTable.cftOwner })
    .from(tasksTable).where(eq(tasksTable.id, taskId));
  if (!t) return false;
  return t.assignee === meId || t.cft === meId;
}

/** The project a task belongs to (for gating task-scoped reads). */
export async function taskProjectId(taskId: number): Promise<number | null> {
  const [t] = await db.select({ p: tasksTable.projectId }).from(tasksTable).where(eq(tasksTable.id, taskId));
  return t?.p ?? null;
}

/**
 * Guard a project-scoped READ. Restricted users may only view projects they're
 * a member of; everyone else passes through. Returns 404 (not 403) so a
 * non-member can't even confirm the project exists.
 */
export function requireProjectView(resolveProjectId: (req: Request) => number | null | Promise<number | null>): RequestHandler<any> {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) { res.status(401).json({ error: "Not authenticated." }); return; }
    if (!isRestrictedUser(req.user)) { next(); return; }
    const pid = await resolveProjectId(req);
    if (pid == null || !(await isProjectMember(req.user.email, pid))) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    next();
  };
}

/**
 * Guard a task WRITE. Editors (pm/pmo/hod) and admins pass; a restricted user
 * passes only for a task assigned to them. `taskIdParam` names the route param
 * holding the task id (default "id").
 */
export function requireTaskEdit(taskIdParam = "id"): RequestHandler<any> {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const user = req.user;
    if (!user) { res.status(401).json({ error: "Not authenticated." }); return; }
    if (user.isSuperAdmin || user.pmoRole === "admin" || EDITOR_ROLES.has(user.pmoRole)) { next(); return; }
    const taskId = Number(req.params[taskIdParam]);
    if (Number.isFinite(taskId) && await isTaskAssignee(user.email, taskId)) { next(); return; }
    res.status(403).json({ error: "You can only edit tasks assigned to you." });
  };
}
