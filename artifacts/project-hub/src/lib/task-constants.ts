// Exact FRS-PM-001 (FR-26, FR-37) monday.com-style status & priority palette.
// Solid colored pills with white text — true monday look.

function withAlpha(hex: string, alphaHex: string) {
  return `${hex}${alphaHex}`;
}

// Monday-style distinct semantic colors per status
export const TASK_STATUSES = [
  { value: "not_started", label: "To be Started", color: "#FFFFFF", bg: "#9CA3AF", solid: "#9CA3AF" }, // grey
  { value: "in_progress", label: "In Progress",   color: "#FFFFFF", bg: "#F59E0B", solid: "#F59E0B" }, // orange (Working on it)
  { value: "delayed",     label: "Delayed",       color: "#FFFFFF", bg: "#DC2626", solid: "#DC2626" }, // red (Stuck)
  { value: "on_hold",     label: "On-Hold",       color: "#FFFFFF", bg: "#6366F1", solid: "#6366F1" }, // indigo
  { value: "completed",   label: "Completed",     color: "#FFFFFF", bg: "#10B981", solid: "#10B981" }, // green (Done)
] as const;

export type TaskStatusValue = (typeof TASK_STATUSES)[number]["value"];

// Single-hue progression (indigo/purple family) — darkest = critical, lightest = low.
// Labels are Critical/High/Medium/Low; the stored values stay P0–P3 so existing
// data and the DB default ("P2" = Medium) keep working without a migration.
export const TASK_PRIORITIES = [
  { value: "P0", label: "P0", color: "#FFFFFF", bg: "#312E81", solid: "#312E81" },
  { value: "P1", label: "P1", color: "#FFFFFF", bg: "#4F46E5", solid: "#4F46E5" },
  { value: "P2", label: "P2", color: "#FFFFFF", bg: "#818CF8", solid: "#818CF8" },
  { value: "P3", label: "P3", color: "#1F2937", bg: "#C7D2FE", solid: "#C7D2FE" },
] as const;

export type TaskPriorityValue = (typeof TASK_PRIORITIES)[number]["value"];

export const RAG_OPTIONS = [
  { value: "green", label: "Green", color: "#28A745" },
  { value: "amber", label: "Amber", color: "#FFC107" },
  { value: "red",   label: "Red",   color: "#DC3545" },
] as const;

// Default org departments — used by every project except CIP tracker imports.
export const DEPARTMENTS = [
  "Engineering", "Product", "Design", "Finance", "Legal",
  "Marketing", "Sales", "HR", "Operations", "IT", "Procurement",
  "Supply Chain", "Quality", "R&D", "Strategy",
];

// Departments as they appear in the CIP project-tracker sheets (Granules R&D) —
// only offered for CIP projects (detected from the departments their tasks use).
export const CIP_DEPARTMENTS = [
  "F R&D", "F AR&D", "PM", "QC 2 GGP", "SCM",
  "BE Study Coordinator", "AQA", "API", "RA",
];

const FALLBACK_META = { value: "", label: "—", color: "#FFFFFF", bg: "#808080", solid: "#808080" };

export function getStatusMeta(status: string) {
  return TASK_STATUSES.find(s => s.value === status) ?? { ...FALLBACK_META, value: status, label: status || "—" };
}

export function getPriorityMeta(priority: string) {
  return TASK_PRIORITIES.find(p => p.value === priority) ?? { ...FALLBACK_META, value: priority, label: priority || "—" };
}

export function getRagColor(rag: string) {
  return RAG_OPTIONS.find(r => r.value === rag)?.color ?? "#808080";
}

// Soft tint of a hex color (group section banding, hover backgrounds, etc.)
export function tintColor(hex: string, alpha = "1A") {
  return withAlpha(hex, alpha);
}

export function calcScheduleVariance(plannedEnd?: string | null, actualEnd?: string | null): number | null {
  if (!plannedEnd) return null;
  const planned = new Date(plannedEnd).getTime();
  const actual = actualEnd ? new Date(actualEnd).getTime() : null;
  if (!actual) return null;
  return Math.round((actual - planned) / 86_400_000);
}

export function fmtVariance(days: number | null | undefined): { text: string; color: string } {
  if (days == null) return { text: "—", color: "#808080" };
  if (days === 0)   return { text: "On Time", color: "#28A745" };
  if (days > 0)     return { text: `+${days} days`, color: "#DC3545" };
  return { text: `${Math.abs(days)} days early`, color: "#28A745" };
}

// Worst-case RAG aggregation across children (FR-24 portfolio rollup, FR-25 milestone rollup)
export function aggregateRag(values: Array<string | null | undefined>): "red" | "amber" | "green" {
  if (values.some(v => v === "red")) return "red";
  if (values.some(v => v === "amber")) return "amber";
  return "green";
}
