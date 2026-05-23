const TOKEN = {
  muted:        { color: "hsl(var(--muted-foreground))", bg: "hsl(var(--muted) / 0.5)" },
  success:      { color: "hsl(var(--success))",          bg: "hsl(var(--success) / 0.12)" },
  warn:         { color: "hsl(var(--warn))",             bg: "hsl(var(--warn) / 0.12)" },
  destructive:  { color: "hsl(var(--destructive))",      bg: "hsl(var(--destructive) / 0.12)" },
  primary:      { color: "hsl(var(--primary))",          bg: "hsl(var(--primary) / 0.12)" },
  accent:       { color: "hsl(var(--accent-foreground, var(--primary)))", bg: "hsl(var(--primary) / 0.08)" },
} as const;

export const TASK_STATUSES = [
  { value: "not_started", label: "To be Started", color: TOKEN.muted.color,       bg: TOKEN.muted.bg },
  { value: "in_progress", label: "In Progress",   color: TOKEN.success.color,     bg: TOKEN.success.bg },
  { value: "at_risk",     label: "At Risk",       color: TOKEN.warn.color,        bg: TOKEN.warn.bg },
  { value: "delayed",     label: "Delayed",       color: TOKEN.destructive.color, bg: TOKEN.destructive.bg },
  { value: "completed",   label: "Completed",     color: TOKEN.primary.color,     bg: TOKEN.primary.bg },
  { value: "on_hold",     label: "On-Hold",       color: TOKEN.accent.color,      bg: TOKEN.accent.bg },
] as const;

export type TaskStatusValue = (typeof TASK_STATUSES)[number]["value"];

export const TASK_PRIORITIES = [
  { value: "P0", label: "P0 Critical", color: TOKEN.destructive.color, bg: TOKEN.destructive.bg },
  { value: "P1", label: "P1 High",     color: TOKEN.warn.color,        bg: TOKEN.warn.bg },
  { value: "P2", label: "P2 Medium",   color: TOKEN.warn.color,        bg: TOKEN.warn.bg },
  { value: "P3", label: "P3 Low",      color: TOKEN.success.color,     bg: TOKEN.success.bg },
] as const;

export type TaskPriorityValue = (typeof TASK_PRIORITIES)[number]["value"];

export const RAG_OPTIONS = [
  { value: "green", label: "Green", color: TOKEN.success.color },
  { value: "amber", label: "Amber", color: TOKEN.warn.color },
  { value: "red",   label: "Red",   color: TOKEN.destructive.color },
] as const;

export const DEPARTMENTS = [
  "Engineering", "Product", "Design", "Finance", "Legal",
  "Marketing", "Sales", "HR", "Operations", "IT", "Procurement",
  "Supply Chain", "Quality", "R&D", "Strategy",
];

export function getStatusMeta(status: string) {
  return TASK_STATUSES.find(s => s.value === status) ?? { value: status, label: status, color: TOKEN.muted.color, bg: TOKEN.muted.bg };
}

export function getPriorityMeta(priority: string) {
  return TASK_PRIORITIES.find(p => p.value === priority) ?? { value: priority, label: priority, color: TOKEN.muted.color, bg: TOKEN.muted.bg };
}

export function getRagColor(rag: string) {
  return RAG_OPTIONS.find(r => r.value === rag)?.color ?? TOKEN.muted.color;
}

export function calcScheduleVariance(plannedEnd?: string | null, actualEnd?: string | null): number | null {
  if (!plannedEnd) return null;
  const planned = new Date(plannedEnd).getTime();
  const actual = actualEnd ? new Date(actualEnd).getTime() : null;
  if (!actual) return null;
  return Math.round((actual - planned) / 86_400_000);
}

export function fmtVariance(days: number | null | undefined): { text: string; color: string } {
  if (days == null) return { text: "—", color: TOKEN.muted.color };
  if (days === 0)   return { text: "On Time", color: TOKEN.success.color };
  if (days > 0)     return { text: `+${days} days`, color: TOKEN.destructive.color };
  return { text: `${Math.abs(days)} days early`, color: TOKEN.success.color };
}
