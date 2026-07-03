// Shared shapes for the cross-project work-management layer (My Tasks / Tasks /
// Milestones). Mirrors what api-server/src/routes/work.ts returns.

export type GateInfo = {
  approver: { id: number | null; name: string; role?: string } | null;
  waitingOn: { role: string; person: { id: number | null; name: string } | null } | null;
  slaDays: number | null;
  daysOverdue: number;
  daysPending: number;
  pendingApproval: boolean;
} | null;

export interface AggTask {
  id: number;
  projectId: number;
  projectName: string;
  milestoneId: number | null;
  milestoneName: string | null;
  parentTaskId: number | null;
  name: string;
  description?: string | null;
  status: string;
  priority: string;
  rag?: string | null;
  stage: string | null;
  phase: string | null;
  assigneeId: number | null;
  assigneeName: string | null;
  startDate: string | null;
  endDate: string | null;
  endDateHistory?: string | null;
  justification?: string | null;
  progressPct: number;
  predecessorIds: number[] | string;
  estimatedHours: number | null;
  actualHours: number | null;
  isCritical?: boolean;
  gate: GateInfo;
  // Completion-approval gate (see CompletionApproval.tsx). Set while a completion
  // is awaiting the approver's decision.
  completionRequestedBy?: number | null;
  completionApproverId?: number | null;
  completionReason?: string | null;
  completionRequestedByName?: string | null;
}

export interface MeTasks {
  myUserId: number | null;
  assignedToMe: AggTask[];
  dueToday: AggTask[];
  upcoming: AggTask[];
  overdue: AggTask[];
  waitingForApproval: AggTask[];
  completed: AggTask[];
}

export interface AggMilestone {
  id: number;
  projectId: number;
  projectName: string;
  name: string;
  description?: string | null;
  dueDate: string | null;
  startDate: string | null;
  status: string;
  priority: string;
  rag?: string | null;
  stage: string | null;
  phase: string | null;
  gateDecision: string | null;
  completionPct: number;
  taskCount: number;
  order: number;
  gate: GateInfo;
}

export interface TaskComment {
  id: number;
  taskId: number;
  senderId: number;
  senderName: string | null;
  body: string;
  attachments: Array<{ name?: string; url?: string } & Record<string, unknown>>;
  createdAt: string;
}
