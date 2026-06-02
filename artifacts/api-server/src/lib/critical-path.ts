import { db, projectsTable, projectStagesTable, stageSlasTable, usersTable, raciMatrixTable, stageEscalationPolicyTable } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { applicableStages, evaluateStageGate, subGatesFor, STAGE_META, STAGE_OWNER_ROLE, VENDOR_PATH, type GateEvaluation } from "./stage-gates";
import { resolveRole } from "./role-resolver";

const DAY_MS = 86_400_000;

export type StageStatus = "complete" | "active" | "blocked" | "upcoming" | "skipped";
export type Health = "on_track" | "at_risk" | "blocked";

export type Person = { id: number; name: string } | null;

// Who the stage is currently waiting on (the bottleneck person). Prefers a concrete
// pending approver; falls back to the stage's primary owner role resolved through the
// role directory / charter — so EVERY recognized stage has a "Waiting On" person even
// when no pmo_approvals row exists.
export type WaitingOn = { role: string; person: { id: number | null; name: string } | null } | null;
// The next ladder rung that hasn't fired yet, for an at-a-glance "what's coming" hint.
export type NextEscalation = { role: string; action: string; inDays: number } | null;

export type BlockingReason = {
  type: "checklist" | "doc" | "approval" | "uat_defect" | "urs_approval";
  label: string;
  detail?: string;
  // raw ids/names so the client can prettify checklist labels from lifecycle-config
  items?: string[];
};

export type CriticalPathSubGate = {
  key: string;
  label: string;
  status: "complete" | "blocked" | "active" | "upcoming";
  satisfied: boolean;
  slaDays: number | null;
  daysOverdue: number;
  approvedAt: string | null;
  approverLabel: string | null;   // who still needs to approve (null when approved)
  blockingReasons: BlockingReason[];
};

export type CriticalPathStage = {
  key: string;
  label: string;
  shortLabel: string;
  phaseKey: string;
  color: string;
  status: StageStatus;
  enteredAt: string | null;
  completedAt: string | null;
  slaDays: number | null;
  dueDate: string | null;
  daysOverdue: number;
  owner: Person;
  responsible: Person;
  pendingApprover: (Person & { role?: string }) | { id: null; name: string; role?: string } | null;
  // Days the stage has been pending (now - enteredAt). Drives the escalation ladder
  // thresholds (distinct from daysOverdue, which is measured past the SLA due date).
  daysPending: number;
  // Bottleneck person + next ladder rung. Populated only for the active/blocked stage.
  waitingOn: WaitingOn;
  nextEscalation: NextEscalation;
  blockingReasons: BlockingReason[];
  // Present only for sub-gated stages (initiation): BC + URS tracked independently.
  subGates?: CriticalPathSubGate[];
};

export type CriticalPath = {
  projectId: number;
  projectName: string;
  projectType: string;
  currentStageKey: string;
  blockedStageKey: string | null;
  health: Health;
  // false when the project's current stage key is not one of the 9 Option B
  // stages (legacy data predating the lifecycle model). The lane shows an
  // informational note instead of a misleading all-upcoming row, and the
  // portfolio rollup counts these separately rather than as "on track".
  currentStageRecognized: boolean;
  stages: CriticalPathStage[];
};

function reasonsFromEval(ev: GateEvaluation): BlockingReason[] {
  const reasons: BlockingReason[] = [];
  if (ev.uncheckedChecklist.length > 0) {
    reasons.push({
      type: "checklist",
      label: `${ev.uncheckedChecklist.length} checklist item(s) pending`,
      items: ev.uncheckedChecklist,
    });
  }
  for (const doc of ev.missingDocs) {
    reasons.push({ type: "doc", label: "Missing document", detail: doc });
  }
  if (ev.ursDualApprovalMissing.length > 0) {
    reasons.push({
      type: "urs_approval",
      label: "URS dual-approval pending",
      detail: ev.ursDualApprovalMissing.join(" + "),
    });
  }
  if (ev.openUatDefects > 0) {
    reasons.push({ type: "uat_defect", label: `${ev.openUatDefects} open UAT defect(s)` });
  }
  for (const a of ev.pendingApprovals) {
    reasons.push({
      type: "approval",
      label: `Awaiting ${a.approverRole} approval`,
      detail: a.breached ? "SLA breached" : "pending",
    });
  }
  return reasons;
}

function reasonsFromSubGate(sg: import("./stage-gates").SubGateEvaluation): BlockingReason[] {
  const reasons: BlockingReason[] = [];
  if (sg.uncheckedChecklist.length > 0) {
    reasons.push({ type: "checklist", label: `${sg.uncheckedChecklist.length} checklist item(s) pending`, items: sg.uncheckedChecklist });
  }
  for (const doc of sg.missingDocs) {
    reasons.push({ type: "doc", label: "Missing document", detail: doc });
  }
  if (sg.approvalsMissing.length > 0) {
    const seq = sg.approvalBlockedBy.length ? ` (approve ${sg.approvalBlockedBy.join(", ")} first)` : "";
    reasons.push({
      type: sg.key === "urs" ? "urs_approval" : "approval",
      label: `${sg.label} approval pending`,
      detail: `${sg.approvalsMissing.join(" + ")}${seq}`,
    });
  }
  return reasons;
}

/**
 * Compute the stage-governance critical path for a single project.
 * Read-only. Reuses evaluateStageGate (the same gate logic the advance endpoint
 * enforces) so "what's blocked" can never drift from "what blocks an advance".
 */
export async function computeStageCriticalPath(projectId: number): Promise<CriticalPath | null> {
  const [project] = await db.select({
    id: projectsTable.id,
    name: projectsTable.name,
    stage: projectsTable.stage,
    status: projectsTable.status,
    projectType: projectsTable.projectType,
    projectManagerId: projectsTable.projectManagerId,
  }).from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) return null;

  const path = applicableStages(project.projectType);
  const currentStageKey = project.stage;
  const currentIdx = path.indexOf(currentStageKey);
  const currentStageRecognized = currentStageKey in STAGE_META;

  // Stage records (status / timestamps), keyed by stage.
  const stageRows = await db.select().from(projectStagesTable).where(eq(projectStagesTable.projectId, projectId));
  const stageMap = new Map(stageRows.map((r) => [r.stage, r]));

  // Active SLA targets keyed by stage.
  const slaRows = await db.select().from(stageSlasTable).where(eq(stageSlasTable.isActive, true));
  const slaMap = new Map(slaRows.map((r) => [r.stage, r.targetDays]));

  // Project-level Responsible (RACI R, no task/workstream scope).
  const [raciR] = await db.select().from(raciMatrixTable).where(and(
    eq(raciMatrixTable.projectId, projectId),
    eq(raciMatrixTable.raciType, "R"),
    isNull(raciMatrixTable.taskId),
  ));

  // Evaluate the current stage's gate once (the only in-progress stage).
  let currentEval: GateEvaluation | null = null;
  if (currentIdx >= 0 && stageMap.get(currentStageKey)?.status !== "complete" && project.status !== "closed") {
    currentEval = await evaluateStageGate(projectId, currentStageKey, project.projectType);
  }

  // Resolve the people we need in one batch.
  const pendingApproval = currentEval?.pendingApprovals.find((a) => a.breached) ?? currentEval?.pendingApprovals[0] ?? null;
  const userIds = [project.projectManagerId, raciR?.userId, pendingApproval?.approverId].filter((x): x is number => typeof x === "number");
  const userMap = new Map<number, { id: number; name: string }>();
  if (userIds.length) {
    const users = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable);
    for (const u of users) if (userIds.includes(u.id)) userMap.set(u.id, u);
  }
  const owner: Person = project.projectManagerId ? userMap.get(project.projectManagerId) ?? null : null;
  const responsible: Person = raciR?.userId ? userMap.get(raciR.userId) ?? null : owner;
  const pendingApprover = pendingApproval
    ? { id: pendingApproval.approverId, name: pendingApproval.approverId ? (userMap.get(pendingApproval.approverId)?.name ?? pendingApproval.approverRole) : pendingApproval.approverRole, role: pendingApproval.approverRole }
    : null;

  const now = Date.now();
  let blockedStageKey: string | null = null;
  let health: Health = "on_track";

  // Build every stage in canonical (vendor) order so skipped stages keep their slot.
  const stages: CriticalPathStage[] = VENDOR_PATH.map((key) => {
    const meta = STAGE_META[key];
    const rec = stageMap.get(key);
    const slaDays = slaMap.get(key) ?? null;
    const enteredAt = rec?.enteredAt ? new Date(rec.enteredAt).toISOString() : null;
    const completedAt = rec?.completedAt ? new Date(rec.completedAt).toISOString() : null;
    const inPath = path.includes(key);
    const idx = path.indexOf(key);

    let status: StageStatus;
    if (!inPath) status = "skipped";
    else if (rec?.status === "complete") status = "complete";
    else if (idx < currentIdx) status = "complete"; // historically passed
    else if (idx === currentIdx) status = "active";  // may upgrade to blocked below
    else status = "upcoming";

    // Days overdue + due date for an entered, not-complete stage.
    let dueDate: string | null = null;
    let daysOverdue = 0;
    let daysPending = 0;
    if (status !== "complete" && status !== "skipped" && rec?.enteredAt) {
      daysPending = Math.max(0, Math.floor((now - new Date(rec.enteredAt).getTime()) / DAY_MS));
      if (slaDays != null) {
        const due = new Date(rec.enteredAt).getTime() + slaDays * DAY_MS;
        dueDate = new Date(due).toISOString();
        daysOverdue = Math.max(0, Math.floor((now - due) / DAY_MS));
      }
    }

    let blockingReasons: BlockingReason[] = [];
    let subGates: CriticalPathSubGate[] | undefined;

    if (status === "active" && currentEval) {
      if (currentEval.subGates && rec?.enteredAt) {
        // Sub-gated stage (initiation): each sub-gate has its own SLA + overdue
        // clock (measured from stage entry) and its own blocking reasons.
        const entered = new Date(rec.enteredAt).getTime();
        subGates = currentEval.subGates.map((sg) => {
          const sgSla = slaMap.get(`${key}.${sg.key}`) ?? slaDays;
          let sgOverdue = 0;
          if (!sg.satisfied && sgSla != null) {
            sgOverdue = Math.max(0, Math.floor((now - (entered + sgSla * DAY_MS)) / DAY_MS));
          }
          const sgStatus: CriticalPathSubGate["status"] = sg.satisfied ? "complete" : sgOverdue > 0 ? "blocked" : "active";
          return {
            key: sg.key, label: sg.label, status: sgStatus, satisfied: sg.satisfied,
            slaDays: sgSla, daysOverdue: sgOverdue, approvedAt: sg.approvedAt,
            approverLabel: sg.approvalsMissing.length ? sg.approvalsMissing.join(" + ") : null,
            blockingReasons: reasonsFromSubGate(sg),
          };
        });
        // The stage chip reflects the worst sub-gate: max overdue across unsatisfied gates.
        daysOverdue = Math.max(0, ...subGates.filter((s) => !s.satisfied).map((s) => s.daysOverdue));
        blockingReasons = subGates.flatMap((s) => s.blockingReasons);
        if (!currentEval.satisfied && daysOverdue > 0) {
          status = "blocked";
          blockedStageKey = key;
        }
      } else {
        blockingReasons = reasonsFromEval(currentEval);
        // Blocked = gate unmet AND overdue. Otherwise stays active (open items surfaced as a soft warning).
        if (!currentEval.satisfied && daysOverdue > 0) {
          status = "blocked";
          blockedStageKey = key;
        }
      }
    }

    // Always expose the BC + URS sub-gates on the Initiation chip — even when the
    // stage is complete or upcoming — so the dashboard shows the internal structure
    // (not just a single INIT box). Active state is filled above; here we derive the
    // complete/upcoming cases (no per-sub-gate eval needed).
    if (!subGates && subGatesFor(key).length > 0 && status !== "skipped") {
      const sgStatus: CriticalPathSubGate["status"] = status === "complete" ? "complete" : "upcoming";
      subGates = subGatesFor(key).map((sg) => ({
        key: sg.key, label: sg.label, status: sgStatus, satisfied: status === "complete",
        slaDays: slaMap.get(`${key}.${sg.key}`) ?? slaDays, daysOverdue: 0,
        approvedAt: null, approverLabel: null, blockingReasons: [],
      }));
    }

    return {
      key, label: meta.label, shortLabel: meta.shortLabel, phaseKey: meta.phaseKey, color: meta.color,
      status, enteredAt, completedAt, slaDays, dueDate, daysOverdue, daysPending,
      owner, responsible,
      pendingApprover: status === "active" || status === "blocked" ? pendingApprover : null,
      waitingOn: null as WaitingOn,
      nextEscalation: null as NextEscalation,
      blockingReasons,
      ...(subGates ? { subGates } : {}),
    };
  });

  // Resolve "waiting on" + "next escalation" for the single active/blocked stage only
  // (one role resolution + one policy scan per project, not per stage). Wrapped so a
  // resolver/policy failure (e.g. the person-trigger tables not yet migrated) degrades
  // to null rather than breaking the critical-path view the rest of the UI depends on.
  const focusStage = stages.find((s) => s.status === "blocked") ?? stages.find((s) => s.status === "active");
  if (focusStage && focusStage.key in STAGE_META) try {
    // Prefer the concrete pending approver; else the stage's primary owner role.
    if (focusStage.pendingApprover && focusStage.pendingApprover.id != null) {
      focusStage.waitingOn = {
        role: focusStage.pendingApprover.role ?? STAGE_OWNER_ROLE[focusStage.key] ?? "owner",
        person: { id: focusStage.pendingApprover.id, name: focusStage.pendingApprover.name },
      };
    } else {
      const ownerRole = STAGE_OWNER_ROLE[focusStage.key];
      if (ownerRole) {
        const [r] = await resolveRole(ownerRole, project.id);
        focusStage.waitingOn = { role: ownerRole, person: r ? { id: r.userId, name: r.name } : null };
      }
    }

    // Next ladder rung: the lowest-threshold active policy tier not yet reached.
    const policyRows = await db.select().from(stageEscalationPolicyTable)
      .where(and(eq(stageEscalationPolicyTable.isActive, true), eq(stageEscalationPolicyTable.stage, focusStage.key)));
    const upcoming = policyRows
      .filter((p) => p.afterDays > focusStage.daysPending)
      .sort((a, b) => a.afterDays - b.afterDays)[0];
    if (upcoming) {
      focusStage.nextEscalation = {
        role: upcoming.targetRole,
        action: upcoming.action,
        inDays: upcoming.afterDays - focusStage.daysPending,
      };
    }
  } catch {
    // person-trigger tables absent / transient DB error — leave waitingOn/nextEscalation null.
  }

  // Health rollup.
  const activeStage = stages.find((s) => s.status === "active" || s.status === "blocked");
  if (blockedStageKey) health = "blocked";
  else if (activeStage && (activeStage.daysOverdue > 0 || activeStage.blockingReasons.length > 0)) health = "at_risk";
  else health = "on_track";

  return {
    projectId: project.id,
    projectName: project.name,
    projectType: project.projectType,
    currentStageKey,
    blockedStageKey,
    health,
    currentStageRecognized,
    stages,
  };
}
