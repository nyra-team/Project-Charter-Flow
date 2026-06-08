// Column cell renderers for MondayBoard. Thin wrappers over the existing
// project-hub chips / tokens (task-status-chip, person-avatar, task-constants)
// so every surface shows identical Monday-style Status / Owner / Priority /
// Due / Progress / Dependency cells. Each is presentational; inline-editable
// variants take an onChange and reuse the shared <StatusSelect>/<PrioritySelect>.
import type { ReactNode } from "react";
import { GitBranch, Stamp } from "lucide-react";
import { format, isValid, parseISO, differenceInCalendarDays } from "date-fns";
import { TaskStatusChip, PriorityChip, StatusSelect, PrioritySelect } from "../task-status-chip";
import { PersonAvatar } from "../person-avatar";

// ── Status ────────────────────────────────────────────────────────────────
export function StatusCell({ status }: { status: string }) {
  return <TaskStatusChip status={status} />;
}
export function StatusCellEditable({ status, onChange }: { status: string; onChange: (v: string) => void }) {
  return (
    <div className="h-7 min-w-[110px] overflow-hidden rounded-none" onClick={(e) => e.stopPropagation()}>
      <StatusSelect value={status} onChange={onChange} />
    </div>
  );
}

// ── Priority ──────────────────────────────────────────────────────────────
export function PriorityCell({ priority }: { priority: string }) {
  return <PriorityChip priority={priority} />;
}
export function PriorityCellEditable({ priority, onChange }: { priority: string; onChange: (v: string) => void }) {
  return (
    <div className="h-7 min-w-[90px] overflow-hidden rounded-none" onClick={(e) => e.stopPropagation()}>
      <PrioritySelect value={priority} onChange={onChange} />
    </div>
  );
}

// ── Owner ─────────────────────────────────────────────────────────────────
export function OwnerCell({ id, name }: { id?: number | null; name?: string | null }) {
  if (!name) return <span className="text-[11px] italic text-muted-foreground/50">Unassigned</span>;
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <PersonAvatar id={id} name={name} size={20} />
      <span className="hidden xl:inline truncate text-xs text-foreground/80 max-w-[120px]">{name}</span>
    </span>
  );
}

// ── Date / Due ──────────────────────────────────────────────────────────────
function toDate(v?: string | null): Date | null {
  if (!v) return null;
  const d = v.length <= 10 ? parseISO(v) : new Date(v);
  return isValid(d) ? d : null;
}
export function DateCell({ value, overdue }: { value?: string | null; overdue?: boolean }) {
  const d = toDate(value);
  if (!d) return <span className="text-[11px] text-muted-foreground/40">—</span>;
  const days = differenceInCalendarDays(d, new Date());
  const isLate = overdue ?? days < 0;
  const soon = !isLate && days <= 3;
  return (
    <span
      className={`text-[11px] font-medium whitespace-nowrap ${
        isLate ? "text-destructive" : soon ? "text-warn" : "text-muted-foreground"
      }`}
      title={format(d, "PPP")}
    >
      {format(d, "d MMM")}
    </span>
  );
}

// ── Progress ──────────────────────────────────────────────────────────────
export function ProgressCell({ pct }: { pct: number }) {
  const v = Math.min(100, Math.max(0, Math.round(pct)));
  return (
    <div className="flex items-center gap-1.5 min-w-[72px]">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${v}%`, background: v >= 100 ? "#10B981" : "hsl(var(--primary))" }}
        />
      </div>
      <span className="text-[10px] font-mono text-muted-foreground w-7 text-right">{v}%</span>
    </div>
  );
}

// ── Dependencies + gate flags ───────────────────────────────────────────────
function depCount(p?: number[] | string): number {
  if (p == null) return 0;
  if (Array.isArray(p)) return p.length;
  try { return (JSON.parse(p || "[]") as number[]).length; } catch { return 0; }
}
export function DependencyCell({
  predecessorIds, pendingApproval, daysOverdue,
}: { predecessorIds?: number[] | string; pendingApproval?: boolean; daysOverdue?: number }) {
  const deps = depCount(predecessorIds);
  if (!deps && !pendingApproval && !(daysOverdue && daysOverdue > 0)) {
    return <span className="text-[11px] text-muted-foreground/30">—</span>;
  }
  return (
    <span className="inline-flex items-center gap-2">
      {deps > 0 && (
        <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground" title={`${deps} dependency(ies)`}>
          <GitBranch size={10} /> {deps}
        </span>
      )}
      {pendingApproval && <Stamp size={12} className="text-warn" aria-label="Awaiting approval" />}
      {daysOverdue != null && daysOverdue > 0 && <span className="text-[10px] font-bold text-destructive">{daysOverdue}d</span>}
    </span>
  );
}

// ── Generic text / number ──────────────────────────────────────────────────
export function TextCell({ value }: { value?: ReactNode }) {
  return <span className="text-xs text-foreground/80 truncate">{value ?? <span className="text-muted-foreground/40">—</span>}</span>;
}
export function NumberCell({ value, suffix }: { value?: number | null; suffix?: string }) {
  if (value == null) return <span className="text-[11px] text-muted-foreground/40">—</span>;
  return <span className="text-xs font-mono text-foreground/80">{value}{suffix}</span>;
}
