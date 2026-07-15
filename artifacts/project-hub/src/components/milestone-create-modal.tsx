import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Check, ChevronsUpDown, Loader2, Milestone as MilestoneIcon, X, User, CalendarDays, AlignLeft } from "lucide-react";

export type NewMilestone = {
  name: string;
  startDate?: string;
  dueDate?: string;
  description?: string;
  /** Milestone owner (pmo_users id). Omitted = inherit the project's owner. */
  ownerId?: number;
};

export type OwnerOption = { id: number; name: string; photoUrl?: string | null };

/** Round avatar bubble — photo when we have one, else the person's initials. */
function Avatar({ name, photoUrl, size = 20 }: { name: string | null; photoUrl?: string | null; size?: number }) {
  const initials = (name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";
  if (photoUrl) {
    return <img src={photoUrl} alt={name || ""} width={size} height={size} className="rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <span
      className="inline-flex items-center justify-center rounded-full bg-primary/10 text-primary font-medium border border-primary/20"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {initials}
    </span>
  );
}

/**
 * Owner picker for the add-milestone form — a combobox. Type straight into the
 * field to filter people (no separate search box); an empty/unfocused field
 * means the milestone inherits the project's owner. The suggestion menu portals
 * to <body> so the dialog's `overflow-y-auto` body doesn't clip it.
 */
function OwnerPicker({
  value,
  users,
  onChange,
  projectOwnerName,
}: {
  value: number | null;
  users: OwnerOption[];
  onChange: (id: number | null) => void;
  projectOwnerName?: string | null;
}) {
  const [open, setOpen] = useState(false);
  // What's in the input. `typed` distinguishes a name typed by the user (filter)
  // from a name mirrored in from the current selection (show the whole list).
  const [q, setQ] = useState("");
  const [typed, setTyped] = useState(false);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; width: number; maxH: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const selected = value != null ? users.find((u) => u.id === value) ?? null : null;

  // Keep the input text in sync with the selection when the user isn't typing
  // (initial value, external reset, or a fresh pick).
  useEffect(() => {
    if (!typed) setQ(selected ? selected.name : "");
  }, [selected, typed]);

  const place = () => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return;
    const margin = 8;
    const spaceBelow = window.innerHeight - r.bottom - margin;
    const spaceAbove = r.top - margin;
    // Open upward when there's little room below and more above.
    const openUp = spaceBelow < 200 && spaceAbove > spaceBelow;
    const maxH = Math.max(140, Math.min(288, openUp ? spaceAbove : spaceBelow));
    setPos(openUp
      ? { left: r.left, bottom: window.innerHeight - r.top + 4, width: r.width, maxH }
      : { left: r.left, top: r.bottom + 4, width: r.width, maxH });
  };
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!wrapRef.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const needle = q.trim().toLowerCase();
  // Only filter by what was actually typed; a mirrored selection shows everyone.
  const list = typed && needle ? users.filter((u) => u.name.toLowerCase().includes(needle)) : users;
  const pick = (id: number | null) => { setOpen(false); setTyped(false); onChange(id); };

  return (
    <>
      <div ref={wrapRef} className="relative">
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => { setQ(e.target.value); setTyped(true); if (!open) place(); setOpen(true); }}
          onFocus={() => { place(); setOpen(true); }}
          placeholder={projectOwnerName ? `Inherits project owner (${projectOwnerName})` : "Inherits project owner"}
          className="w-full rounded-lg border border-input bg-background pl-3 pr-8 py-2 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
        />
        {selected && !typed ? (
          <button
            type="button"
            title="Clear — inherit the project owner"
            onClick={() => { pick(null); setQ(""); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X size={14} />
          </button>
        ) : (
          <ChevronsUpDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        )}
      </div>
      {open && pos && createPortal(
        <div
          ref={menuRef}
          style={{ position: "fixed", left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width }}
          className="z-[300] rounded-lg bg-white border border-gray-200 shadow-xl py-1 animate-in fade-in-0 zoom-in-95"
        >
          <div className="overflow-y-auto" style={{ maxHeight: pos.maxH }}>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { pick(null); setQ(""); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-50 text-gray-500">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[9px] bg-gray-100 text-gray-400 border border-gray-200">—</span>
              Inherit project owner
            </button>
            {list.map((u) => (
              <button key={u.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(u.id)} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-50">
                <Avatar name={u.name} photoUrl={u.photoUrl} />
                <span className="text-gray-700 truncate">{u.name}</span>
                {u.id === value && <Check size={12} className="ml-auto text-gray-500" />}
              </button>
            ))}
            {list.length === 0 && <div className="px-3 py-2 text-xs text-gray-400">No matches</div>}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

/**
 * "Add milestone" popup — the fields the create endpoint accepts
 * (POST /api/projects/:id/milestones → CreateMilestoneBody): name, start date,
 * end (due) date, description and owner. Name is the only required field; the
 * rest are refined inside the milestone afterwards. Priority is not set here —
 * milestones inherit their governance signal from the project. Owner defaults to
 * inheriting the project's owner; the project owner can assign a specific
 * milestone owner here.
 */
export function MilestoneCreateModal({
  open,
  onOpenChange,
  onSubmit,
  users = [],
  projectOwnerName,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSubmit: (data: NewMilestone) => Promise<void>;
  /** People the milestone can be assigned to (project team / PMO users). */
  users?: OwnerOption[];
  /** Name of the project owner the milestone inherits when no owner is set. */
  projectOwnerName?: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [description, setDescription] = useState("");
  const [ownerId, setOwnerId] = useState<number | null>(null);

  // A milestone can't finish before it starts.
  const datesInverted = !!startDate && !!endDate && endDate < startDate;
  const canSubmit = !!name.trim() && !datesInverted && !busy;

  function reset() {
    setName("");
    setStartDate("");
    setEndDate("");
    setDescription("");
    setOwnerId(null);
  }

  async function run() {
    if (!canSubmit) return;
    setBusy(true);
    try {
      await onSubmit({
        name: name.trim(),
        startDate: startDate || undefined,
        dueDate: endDate || undefined,
        description: description.trim() || undefined,
        ownerId: ownerId ?? undefined,
      });
      onOpenChange(false);
      reset();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="p-0 gap-0 overflow-hidden max-w-lg">
        {/* Soft, light header. */}
        <div className="border-b border-blue-100 bg-gradient-to-br from-blue-50 to-indigo-50 px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-blue-500 ring-1 ring-blue-100 shadow-sm">
              <MilestoneIcon size={22} />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-lg font-bold text-slate-800">Add Milestone</DialogTitle>
              <DialogDescription className="sr-only">Add a milestone to this project</DialogDescription>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="max-h-[58vh] overflow-y-auto px-6 py-5 space-y-4">
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-50 text-blue-500"><MilestoneIcon size={13} /></span>
              Milestone name <span className="text-rose-400">*</span>
            </label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void run(); } }}
              placeholder="e.g. URS Approved"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            />
          </div>

          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-50 text-blue-500"><User size={13} /></span>
              Owner
            </label>
            <OwnerPicker value={ownerId} users={users} onChange={setOwnerId} projectOwnerName={projectOwnerName} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-50 text-blue-500"><CalendarDays size={13} /></span>
                Start date <span className="text-muted-foreground font-normal text-[11px]">(optional)</span>
              </label>
              <input
                type="date"
                value={startDate}
                max={endDate || undefined}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-50 text-blue-500"><CalendarDays size={13} /></span>
                End date <span className="text-muted-foreground font-normal text-[11px]">(optional)</span>
              </label>
              <input
                type="date"
                value={endDate}
                min={startDate || undefined}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          </div>
          {datesInverted && (
            <p className="text-[11px] text-rose-500">End date can't be before the start date.</p>
          )}

          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-50 text-blue-500"><AlignLeft size={13} /></span>
              Description <span className="text-muted-foreground font-normal text-[11px]">(optional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does reaching this milestone mean?"
              rows={3}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm resize-y outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border bg-slate-50/60 px-6 py-3">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={run}
            disabled={!canSubmit}
            className="bg-blue-600 text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <MilestoneIcon className="h-4 w-4 mr-1.5" />} Add Milestone
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
