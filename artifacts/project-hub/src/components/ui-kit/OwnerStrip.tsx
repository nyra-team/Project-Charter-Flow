// Consistent ownership row — Owner · Approver · Waiting On.
// Used on every stage / critical-path / approval surface so ownership is never
// hidden. Renders "—" for an empty slot. (No Backup Owner — per design decision.)

import { PersonAvatar } from "@/components/person-avatar";
import { prettify } from "@/lib/status-tokens";

export interface Person {
  id?: number | null;
  name?: string | null;
}

interface Slot {
  label: string;
  person?: Person | null;
  /** Optional role caption shown under the name (e.g. waiting-on role). */
  role?: string | null;
  /** Tint the label — use "danger" to flag the bottleneck slot. */
  accent?: "default" | "danger" | "primary";
}

function SlotCell({ label, person, role, accent = "default" }: Slot) {
  const has = person && person.name;
  const labelCls =
    accent === "danger" ? "text-destructive"
    : accent === "primary" ? "text-primary"
    : "text-muted-foreground";
  return (
    <div className="min-w-0 flex-1">
      <p className={`text-[10px] font-semibold uppercase tracking-[0.12em] ${labelCls}`}>{label}</p>
      <div className="flex items-center gap-1.5 mt-1 min-w-0">
        {has ? (
          <>
            <PersonAvatar id={person!.id} name={person!.name} size={20} />
            <div className="min-w-0">
              <p className="text-xs font-medium text-foreground truncate leading-tight">{person!.name}</p>
              {role && <p className="text-[10px] text-muted-foreground truncate leading-tight">{prettify(role)}</p>}
            </div>
          </>
        ) : (
          <span className="text-xs text-muted-foreground/50">{role ? prettify(role) : "—"}</span>
        )}
      </div>
    </div>
  );
}

export function OwnerStrip({
  owner,
  approver,
  waitingOn,
  className = "",
  compact,
}: {
  owner?: Person | null;
  approver?: (Person & { role?: string | null }) | null;
  waitingOn?: { role?: string | null; person?: Person | null } | null;
  className?: string;
  /** Tighter spacing for dense lists. */
  compact?: boolean;
}) {
  return (
    <div className={`flex items-stretch ${compact ? "gap-3" : "gap-4"} ${className}`}>
      <SlotCell label="Owner" person={owner} />
      <div className="w-px bg-border/60 flex-shrink-0" />
      <SlotCell label="Approver" person={approver} role={approver?.role} />
      <div className="w-px bg-border/60 flex-shrink-0" />
      <SlotCell
        label="Waiting On"
        person={waitingOn?.person}
        role={waitingOn?.role}
        accent={waitingOn?.person || waitingOn?.role ? "danger" : "default"}
      />
    </div>
  );
}
