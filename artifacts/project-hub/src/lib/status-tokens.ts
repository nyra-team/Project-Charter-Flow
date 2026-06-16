// ───────────────────────────────────────────────────────────────────────────
// Centralized status / health → token classes.
//
// Single source of truth for every status surface (chips, dots, rails, cards).
// Uses ONLY the existing PMO theme tokens (--success / --warn / --destructive /
// --primary / --muted) so the look stays consistent in light + dark and we never
// scatter raw `green-100` / `amber-100` / `rose-500` across components again.
//
// Monday-style "instantly readable" status: every entry resolves to a soft tinted
// surface (`wrap`), a solid dot (`dot`), a solid fill (`solid`) for emphasis, and
// a bare text color (`text`). Pick the shape that fits the surface.
// ───────────────────────────────────────────────────────────────────────────

export type Tone = "success" | "warn" | "danger" | "primary" | "muted" | "info";

export interface ToneClasses {
  /** Soft tinted pill surface: bg + text + border. */
  wrap: string;
  /** Solid dot color (bg-*). */
  dot: string;
  /** Solid filled surface for emphasis (bg + foreground text). */
  solid: string;
  /** Bare text color. */
  text: string;
  /** Ring color for dots-with-ring. */
  ring: string;
}

export const TONES: Record<Tone, ToneClasses> = {
  success: {
    wrap: "bg-success/10 text-success border-success/20",
    dot: "bg-success",
    solid: "bg-success text-success-foreground",
    text: "text-success",
    ring: "ring-success/30",
  },
  warn: {
    wrap: "bg-warn/10 text-warn border-warn/20",
    dot: "bg-warn",
    solid: "bg-warn text-warn-foreground",
    text: "text-warn",
    ring: "ring-warn/30",
  },
  danger: {
    wrap: "bg-destructive/10 text-destructive border-destructive/20",
    dot: "bg-destructive",
    solid: "bg-destructive text-destructive-foreground",
    text: "text-destructive",
    ring: "ring-destructive/30",
  },
  primary: {
    wrap: "bg-primary/10 text-primary border-primary/20",
    dot: "bg-primary",
    solid: "bg-primary text-primary-foreground",
    text: "text-primary",
    ring: "ring-primary/30",
  },
  info: {
    wrap: "bg-chart-5/10 text-chart-5 border-chart-5/20",
    dot: "bg-chart-5",
    solid: "bg-chart-5 text-white",
    text: "text-chart-5",
    ring: "ring-chart-5/30",
  },
  muted: {
    wrap: "bg-muted text-muted-foreground border-border",
    dot: "bg-muted-foreground/50",
    solid: "bg-muted text-muted-foreground",
    text: "text-muted-foreground",
    ring: "ring-border",
  },
};

// ── Health (critical-path / project RAG) ────────────────────────────────────
export type Health = "on_track" | "at_risk" | "blocked" | string;

const HEALTH_TONE: Record<string, Tone> = {
  on_track: "success",
  at_risk: "warn",
  blocked: "danger",
};

const HEALTH_LABEL: Record<string, string> = {
  on_track: "On Track",
  at_risk: "At Risk",
  blocked: "Blocked",
};

export function healthTone(health?: string | null): Tone {
  return HEALTH_TONE[(health ?? "").toLowerCase()] ?? "muted";
}
export function healthLabel(health?: string | null): string {
  const key = (health ?? "").toLowerCase();
  return HEALTH_LABEL[key] ?? (health ? prettify(health) : "Unknown");
}
export function healthClasses(health?: string | null): ToneClasses {
  return TONES[healthTone(health)];
}

// ── Stage status (lifecycle stop state) ─────────────────────────────────────
export type StageStatus = "complete" | "active" | "blocked" | "upcoming" | "skipped" | string;

const STAGE_TONE: Record<string, Tone> = {
  complete: "success",
  active: "primary",
  blocked: "danger",
  upcoming: "muted",
  skipped: "muted",
};

const STAGE_LABEL: Record<string, string> = {
  complete: "Complete",
  active: "Active",
  blocked: "Blocked",
  upcoming: "Upcoming",
  skipped: "Skipped",
};

export function stageTone(status?: string | null): Tone {
  return STAGE_TONE[(status ?? "").toLowerCase()] ?? "muted";
}
export function stageLabel(status?: string | null): string {
  const key = (status ?? "").toLowerCase();
  return STAGE_LABEL[key] ?? prettify(status ?? "");
}
export function stageClasses(status?: string | null): ToneClasses {
  return TONES[stageTone(status)];
}

// ── Approval status ──────────────────────────────────────────────────────────
const APPROVAL_TONE: Record<string, Tone> = {
  approved: "success",
  pending: "warn",
  rejected: "danger",
  escalated: "danger",
  breached: "danger",
};

export function approvalTone(status?: string | null): Tone {
  return APPROVAL_TONE[(status ?? "").toLowerCase()] ?? "muted";
}

// ── Generic project / task status (the old StatusBadge surface) ──────────────
const GENERIC_TONE: Record<string, Tone> = {
  approved: "success",
  active: "success",
  completed: "success",
  green: "success",
  rejected: "danger",
  cancelled: "danger",
  delayed: "danger",
  blocked: "danger",
  red: "danger",
  on_hold: "muted",
  postponed: "warn",
  draft: "muted",
  new: "muted",
  planning: "muted",
  not_started: "muted",
  grey: "muted",
  pending: "warn",
  in_progress: "warn",
  parallel_review: "warn",
  scm_review: "warn",
  chairman_review: "warn",
  finance_review: "warn",
  pmo_review: "warn",
  submitted: "warn",
  amber: "warn",
};

export function genericTone(status?: string | null): Tone {
  return GENERIC_TONE[(status ?? "").toLowerCase()] ?? "muted";
}
export function genericClasses(status?: string | null): ToneClasses {
  return TONES[genericTone(status)];
}

// ── Helpers ───────────────────────────────────────────────────────────────--
export function prettify(s: string): string {
  return s
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// PROJECT-status labels in lifecycle vocabulary (Plan → Execute → Close).
// Scoped to project surfaces only — do NOT apply to task / charter / PIF
// statuses, which legitimately use "Active" / "Completed".
const PROJECT_STATUS_LABEL: Record<string, string> = {
  planning: "Plan",
  active: "Execute",
  on_hold: "On Hold",
  completed: "Closed",
  closed: "Closed",
};
export function projectStatusLabel(status?: string | null): string {
  const k = (status ?? "").toLowerCase();
  return PROJECT_STATUS_LABEL[k] ?? prettify(status ?? "");
}
