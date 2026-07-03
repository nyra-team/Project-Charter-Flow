// Action-Centre kanban card — a faithful replica of the CXO Action Centre
// ReviewCard: same fields, the same blue priority ladder, the same slate
// palette and the same sizes (h-5 meta / h-[34px] 2-line title / h-6 footer /
// h-1.5 progress). Shared by the Projects and Tasks kanban boards; callers map
// their row → these resolved props.
import { useState, type ReactNode } from "react";
import { GripVertical, Pencil, CalendarDays, User } from "lucide-react";

// Blue priority ladder (P0 darkest → P3 lightest), identical to Action Centre.
const PRIO_BAND: Record<string, { label: string; cls: string }> = {
  P0: { label: "P0", cls: "bg-blue-900 text-white border-blue-900" },
  P1: { label: "P1", cls: "bg-blue-700 text-white border-blue-700" },
  P2: { label: "P2", cls: "bg-blue-500 text-white border-blue-500" },
  P3: { label: "P3", cls: "bg-blue-100 text-blue-700 border-blue-200" },
};

function fmtDate(d?: string | null) {
  return d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";
}
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "—";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return ((parts[0]![0] ?? "") + (parts[parts.length - 1]![0] ?? "")).toUpperCase();
}

// Owner avatar — ported from the Action Centre ProfileAvatar "onLight" variant.
function Avatar({ name, photoUrl, size = 20 }: { name: string; photoUrl?: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  const initials = initialsOf(name);
  return photoUrl && !broken ? (
    <img
      src={photoUrl} alt={name} onError={() => setBroken(true)} referrerPolicy="no-referrer" loading="eager" decoding="async"
      style={{ width: size, height: size }}
      className="block rounded-full object-cover bg-white ring-2 ring-white shadow-sm flex-shrink-0"
    />
  ) : (
    <span
      style={{ width: size, height: size, fontSize: Math.round(size * 0.34) }}
      className="rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white font-bold tracking-tight flex items-center justify-center ring-2 ring-white shadow-sm flex-shrink-0"
    >
      {initials && initials !== "—" ? initials : <User style={{ width: Math.round(size * 0.5), height: Math.round(size * 0.5) }} strokeWidth={2} />}
    </span>
  );
}

export function ActionCard({ meta, title, ownerName, ownerPhoto, priority, dueDate, progressPct, completed, overdue, ownerSlot }: {
  meta: string;
  title: string;
  ownerName: string | null;
  ownerPhoto?: string | null;
  priority: string;
  dueDate?: string | null;
  progressPct?: number | null;
  completed: boolean;
  overdue: boolean;
  /** Optional interactive owner control (e.g. a click-to-reassign picker). When
   *  provided it replaces the static avatar+name; the caller owns stopPropagation
   *  so the click doesn't start a drag or open the card. */
  ownerSlot?: ReactNode;
}) {
  const band = PRIO_BAND[priority];
  const pct = progressPct != null ? Math.max(0, Math.min(100, Math.round(progressPct))) : null;
  return (
    <div className={`border rounded-xl overflow-hidden shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group select-none ${overdue ? "border-red-500 bg-red-50" : "border-slate-200/70 bg-white"}`}>
      <div className="p-3.5 flex flex-col">
        {/* meta row */}
        <div className="flex items-center justify-between gap-2 h-5 flex-shrink-0">
          <span className="flex items-center gap-1 min-w-0">
            <GripVertical className="w-3.5 h-3.5 text-slate-300 -ml-1 flex-shrink-0" />
            <span className="text-[11px] text-slate-400 font-medium truncate tabular-nums" title={meta || undefined}>{meta}</span>
          </span>
          <Pencil className="w-3.5 h-3.5 text-slate-300 group-hover:text-blue-500 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0" />
        </div>
        {/* title — fixed 2-line clamp */}
        <h4 className={`mt-1 text-[14px] leading-snug line-clamp-2 ${completed ? "line-through font-bold text-slate-700" : "font-semibold text-slate-900"}`} title={title}>
          {title}
        </h4>
        {/* footer — owner left, priority + due right */}
        <div className="mt-3 flex items-center justify-between gap-2 h-6 flex-shrink-0">
          {ownerSlot ?? (
            <span className="flex items-center gap-1.5 min-w-0">
              <Avatar name={ownerName || ""} photoUrl={ownerPhoto} size={22} />
              <span className="text-[11px] font-medium text-slate-600 truncate max-w-[140px]" title={ownerName || undefined}>{ownerName || "—"}</span>
            </span>
          )}
          <span className="flex items-center gap-1.5 flex-shrink-0">
            {band && <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${band.cls}`}>{band.label}</span>}
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400">
              <CalendarDays className="w-3 h-3 flex-shrink-0" /> {fmtDate(dueDate)}
            </span>
          </span>
        </div>
        {/* progress — only when present, so cards collapse to content (Action Centre style) */}
        {pct != null && (
          <div className="mt-2.5 flex items-center gap-2">
            <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
              <div className={`h-full rounded-full ${completed ? "bg-green-500" : "bg-amber-500"}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="text-[9px] font-semibold text-slate-400 tabular-nums">{pct}%</span>
          </div>
        )}
      </div>
    </div>
  );
}
