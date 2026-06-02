import { useQuery } from "@tanstack/react-query";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Zap, Mail, Briefcase, Hash, AlertCircle } from "lucide-react";

// ─── Types — mirror routes/employees.ts wire shape ──────────────────────────

export type SpeedChampionRecord = {
  id: string;
  fullName: string;
  designation: string | null;
  officeEmail: string | null;
  employeeCode: string | null;
  photoUrl: string | null;
};

// ─── Data fetch (TanStack-Query-cached) ─────────────────────────────────────
//
// Cached by exact-name key so the same name resolved in 20 places only fires
// ONE network call per session. staleTime is high (15 min) because employee
// master data rarely changes during a working session.

async function lookupEmployee(name: string): Promise<SpeedChampionRecord | null> {
  const res = await fetch(`/api/employees/lookup?name=${encodeURIComponent(name)}`, {
    credentials: "include",
  });
  if (!res.ok) return null;
  return (await res.json()) as SpeedChampionRecord | null;
}

function useSpeedChampion(name: string | null | undefined) {
  return useQuery({
    queryKey: ["employee-lookup", (name ?? "").trim().toLowerCase()],
    queryFn: () => lookupEmployee(name!.trim()),
    enabled: !!name && name.trim().length >= 2,
    staleTime: 15 * 60 * 1000,
    retry: 1,
  });
}

// ─── Initials helper for avatar fallback ────────────────────────────────────

function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return ((parts[0]![0] ?? "") + (parts[parts.length - 1]![0] ?? "")).toUpperCase();
}

// ─── <SpeedChampion> — main chip ────────────────────────────────────────────
//
// Drop-in replacement for plain employee-name text rendering anywhere in the
// PMO. Auto-resolves the name against the master DB, renders:
//   - a circular avatar (photo if present, else initials)
//   - the full name as a clickable chip
//   - the "⚡ Speed Champion" badge
//   - on click → popover with designation / email / employee code
//
// Falls back to plain text (no chip, no badge) when no match — keeps the
// existing surface readable instead of swallowing unknown names.

export function SpeedChampion({
  name,
  showBadge = true,
  size = "md",
}: {
  name: string | null | undefined;
  showBadge?: boolean;
  size?: "sm" | "md";
}) {
  const { data, isLoading, isError } = useSpeedChampion(name);
  const trimmed = (name ?? "").trim();
  if (!trimmed) return <span className="text-muted-foreground italic">—</span>;

  // Pre-resolve / mid-flight render: show the name in a muted tone so the UI
  // doesn't flicker.
  if (isLoading) {
    return (
      <span className="inline-flex items-center gap-1.5 align-middle">
        <span className={`${avatarSize(size)} rounded-full bg-muted animate-pulse`} />
        <span className="text-muted-foreground">{trimmed}</span>
      </span>
    );
  }

  // Lookup errored — render plain text so a flaky master DB call doesn't
  // hide the underlying owner name.
  if (isError || !data) {
    return (
      <span className="inline-flex items-center gap-1.5 align-middle">
        <span className={`${avatarSize(size)} rounded-full bg-muted text-muted-foreground inline-flex items-center justify-center text-[10px] font-semibold`}>
          {initials(trimmed)}
        </span>
        <span>{trimmed}</span>
      </span>
    );
  }

  // Resolved — full Speed Champion treatment.
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 align-middle group hover:bg-accent/60 rounded-md px-1 py-0.5 -my-0.5 transition-colors"
          data-testid={`speed-champion-${data.id}`}
        >
          {data.photoUrl ? (
            <img
              src={data.photoUrl}
              alt={data.fullName}
              className={`${avatarSize(size)} rounded-full object-cover border border-border`}
            />
          ) : (
            <span
              className={`${avatarSize(size)} rounded-full bg-primary text-primary-foreground inline-flex items-center justify-center text-[10px] font-bold border border-primary/40`}
            >
              {initials(data.fullName)}
            </span>
          )}
          <span className="font-medium text-foreground group-hover:underline">{data.fullName}</span>
          {showBadge && (
            <span className="inline-flex items-center gap-0.5 text-[9px] font-mono uppercase tracking-wider px-1 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
              <Zap size={9} className="fill-current" />
              Speed Champion
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <div className="p-3 border-b border-border bg-gradient-to-br from-amber-500/5 to-primary/5">
          <div className="flex items-center gap-3">
            {data.photoUrl ? (
              <img src={data.photoUrl} alt={data.fullName} className="w-12 h-12 rounded-full object-cover border-2 border-amber-500/40" />
            ) : (
              <span className="w-12 h-12 rounded-full bg-primary text-primary-foreground inline-flex items-center justify-center text-sm font-bold border-2 border-amber-500/40">
                {initials(data.fullName)}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground truncate">{data.fullName}</p>
              <p className="text-[10px] font-mono uppercase tracking-wider text-amber-600 dark:text-amber-400 mt-0.5 inline-flex items-center gap-1">
                <Zap size={10} className="fill-current" />
                Speed Champion
              </p>
            </div>
          </div>
        </div>
        <div className="p-3 space-y-1.5 text-xs">
          {data.designation && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Briefcase size={11} className="shrink-0" />
              <span className="truncate">{data.designation}</span>
            </div>
          )}
          {data.officeEmail && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Mail size={11} className="shrink-0" />
              <a href={`mailto:${data.officeEmail}`} className="truncate hover:text-foreground hover:underline">
                {data.officeEmail}
              </a>
            </div>
          )}
          {data.employeeCode && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Hash size={11} className="shrink-0" />
              <span className="font-mono">{data.employeeCode}</span>
            </div>
          )}
          {!data.designation && !data.officeEmail && !data.employeeCode && (
            <div className="flex items-center gap-2 text-muted-foreground italic">
              <AlertCircle size={11} className="shrink-0" />
              No extra master-DB fields populated for this employee.
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function avatarSize(size: "sm" | "md"): string {
  return size === "sm" ? "w-4 h-4" : "w-5 h-5";
}

// ─── <RichDescription> — auto-wraps "Owner: NAME" lines with chips ──────────
//
// Drop into any project / charter / milestone description block to surface
// owner names as resolved Speed Champion chips. Recognises a handful of
// "Role: Name" labels emitted by the import scripts:
//   Owner, Project Owner, Portfolio Owner, Sponsor, Project Manager,
//   HOD, Approver, Assigned To, Department Head
//
// Lines that don't match the pattern render as plain muted text (unchanged
// styling) so existing layouts don't shift.

const OWNER_LABEL_RE =
  /^(Owner|Project Owner|Portfolio Owner|Sponsor|Project Sponsor|Project Manager|HOD|Department Head|Approver|Assigned To|Created by|Submitted by|Responsible|Responsible Owner|Milestone Owner|Business Owner)\s*:\s*(.+)$/i;

export function RichDescription({ text, className = "" }: { text: string | null | undefined; className?: string }) {
  if (!text) return null;
  const lines = text.split(/\r?\n/);
  return (
    <div className={`space-y-1 ${className}`}>
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={i} className="h-2" />; // blank line spacer
        const m = trimmed.match(OWNER_LABEL_RE);
        if (m) {
          // Multiple names separated by commas → render one chip per name.
          const names = m[2].split(/,\s*/).map((n) => n.trim()).filter(Boolean);
          return (
            <div key={i} className="text-sm flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-muted-foreground font-medium">{m[1]}:</span>
              {names.map((n, j) => (
                <span key={j} className="inline-flex items-center">
                  <SpeedChampion name={n} size="sm" />
                  {j < names.length - 1 && <span className="text-muted-foreground/60 ml-0.5">,</span>}
                </span>
              ))}
            </div>
          );
        }
        return (
          <p key={i} className="text-sm text-muted-foreground">{trimmed}</p>
        );
      })}
    </div>
  );
}
