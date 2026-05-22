export const TASK_STATUSES = [
  { value: "not_started", label: "To be Started", color: "#808080", bg: "#F2F2F2" },
  { value: "in_progress", label: "In Progress",   color: "#28A745", bg: "#E9F7ED" },
  { value: "at_risk",     label: "At Risk",        color: "#FFC107", bg: "#FFF8E1" },
  { value: "delayed",     label: "Delayed",        color: "#DC3545", bg: "#FDEDEE" },
  { value: "completed",   label: "Completed",      color: "#007BFF", bg: "#E7F3FF" },
  { value: "on_hold",     label: "On-Hold",        color: "#6F42C1", bg: "#F3EEFF" },
] as const;

export type TaskStatusValue = (typeof TASK_STATUSES)[number]["value"];

export const TASK_PRIORITIES = [
  { value: "P0", label: "P0 Critical", color: "#DC3545", bg: "#FDEDEE" },
  { value: "P1", label: "P1 High",     color: "#FD7E14", bg: "#FFF3E0" },
  { value: "P2", label: "P2 Medium",   color: "#FFC107", bg: "#FFF8E1" },
  { value: "P3", label: "P3 Low",      color: "#28A745", bg: "#E9F7ED" },
] as const;

export type TaskPriorityValue = (typeof TASK_PRIORITIES)[number]["value"];

export const RAG_OPTIONS = [
  { value: "green", label: "Green", color: "#28A745" },
  { value: "amber", label: "Amber", color: "#FFC107" },
  { value: "red",   label: "Red",   color: "#DC3545" },
] as const;

export const DEPARTMENTS = [
  "Engineering", "Product", "Design", "Finance", "Legal",
  "Marketing", "Sales", "HR", "Operations", "IT", "Procurement",
  "Supply Chain", "Quality", "R&D", "Strategy",
];

export function getStatusMeta(status: string) {
  return TASK_STATUSES.find(s => s.value === status) ?? { value: status, label: status, color: "#808080", bg: "#F2F2F2" };
}

export function getPriorityMeta(priority: string) {
  return TASK_PRIORITIES.find(p => p.value === priority) ?? { value: priority, label: priority, color: "#808080", bg: "#F2F2F2" };
}

export function getRagColor(rag: string) {
  return RAG_OPTIONS.find(r => r.value === rag)?.color ?? "#808080";
}

export function calcScheduleVariance(plannedEnd?: string | null, actualEnd?: string | null): number | null {
  if (!plannedEnd) return null;
  const planned = new Date(plannedEnd).getTime();
  const actual = actualEnd ? new Date(actualEnd).getTime() : null;
  if (!actual) return null;
  return Math.round((actual - planned) / 86_400_000);
}

export function fmtVariance(days: number | null | undefined): { text: string; color: string } {
  if (days == null) return { text: "—", color: "#94A3B8" };
  if (days === 0) return { text: "On Time", color: "#28A745" };
  if (days > 0) return { text: `+${days} days`, color: "#DC3545" };
  return { text: `${Math.abs(days)} days early`, color: "#28A745" };
}
