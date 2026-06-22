import { useEffect, useMemo, useState } from "react";
import {
  useListProjectTeamMembers, useCreateProjectTeamMember,
  useUpdateProjectTeamMember, useDeleteProjectTeamMember,
  useListProjectTeamRaci, useCreateProjectTeamRaci, useDeleteProjectTeamRaci,
  useListUsers,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Users, Building2, Plus, Trash2, Download, UserCheck, Check, X, ChevronDown, Info } from "lucide-react";

// ── Domain types (mirror the generated API shapes; kept local so the table code
//    reads cleanly, same convention as resource-tab.tsx / raci-tab.tsx). ───────
type Member = {
  id: number;
  projectId: number;
  memberType: "internal" | "external";
  userId?: number | null;
  externalName?: string | null;
  externalOrg?: string | null;
  externalEmail?: string | null;
  externalKind?: string | null;
  role?: string | null;
  responsibilities?: string | null;
  approval?: string | null;
};
type RaciCell = { id: number; projectId: number; memberId: number; deliverable: string; raciType: string };
type User = { id: number; name: string; role?: string; department?: string; photoUrl?: string | null };

const EXTERNAL_KINDS = ["vendor", "partner", "consultant", "contractor"] as const;

// Per-member approval status — set inline via the Approval column.
const APPROVAL_OPTS = ["pending", "approved", "rejected"] as const;
const APPROVAL_META: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: "Pending", color: "hsl(var(--warn))", bg: "hsl(var(--warn) / 0.10)" },
  approved: { label: "Approved", color: "hsl(var(--success))", bg: "hsl(var(--success) / 0.10)" },
  rejected: { label: "Rejected", color: "hsl(var(--destructive))", bg: "hsl(var(--destructive) / 0.10)" },
};

// RASCI legend — identical palette to the per-task RACI matrix (raci-tab.tsx) so
// the two surfaces read the same across the app.
const RACI_OPTS = ["R", "A", "C", "I"] as const;
const RACI_META: Record<string, { color: string; bg: string; label: string }> = {
  R: { color: "hsl(var(--primary))", bg: "hsl(var(--primary) / 0.10)", label: "Responsible" },
  A: { color: "hsl(var(--success))", bg: "hsl(var(--success) / 0.10)", label: "Accountable" },
  S: { color: "#0d9488", bg: "rgba(13,148,136,0.10)", label: "Support" },
  C: { color: "hsl(var(--warn))", bg: "hsl(var(--warn) / 0.10)", label: "Consulted" },
  I: { color: "hsl(var(--muted-foreground))", bg: "hsl(var(--border))", label: "Informed" },
};

// Detailed per-role explanation — shown in the RACI header info popover.
const RACI_DESC: Record<string, string> = {
  R: "Does the actual work to produce the deliverable. Can be several people.",
  A: "Ultimately answerable — approves and signs off. Exactly one per deliverable.",
  C: "Consulted for input or expertise before decisions are made (two-way dialogue).",
  I: "Kept informed of progress and outcomes after the fact (one-way updates).",
};

// Solid cell fills for the matrix letters (the bold colored look of the reference).

// Info "i" with a styled hover card detailing what each RACI letter means.
function RaciInfo() {
  return (
    <span className="relative inline-flex group/raci align-middle">
      <Info size={13} className="text-muted-foreground hover:text-primary cursor-help transition-colors" aria-label="What is RACI?" />
      <span className="pointer-events-none absolute left-1/2 bottom-full z-50 mb-2 w-60 -translate-x-1/4 origin-bottom scale-95 opacity-0 transition-all duration-150 group-hover/raci:scale-100 group-hover/raci:opacity-100">
        <span className="block rounded-lg border border-border bg-popover/95 backdrop-blur p-2.5 text-left shadow-xl ring-1 ring-black/5">
          <span className="block text-[10px] font-bold text-foreground mb-1.5">RACI — who does what per deliverable</span>
          <ul className="space-y-1">
            {RACI_OPTS.map(k => (
              <li key={k} className="flex gap-1.5 text-[10px] leading-snug">
                <span className="mt-0.5 inline-flex items-center justify-center w-3.5 h-3.5 rounded text-[8px] font-bold shrink-0" style={{ color: RACI_META[k].color, background: RACI_META[k].bg }}>{k}</span>
                <span className="text-muted-foreground"><b className="text-foreground">{RACI_META[k].label}</b> — {RACI_DESC[k]}</span>
              </li>
            ))}
          </ul>
          <span className="block mt-1.5 pt-1.5 border-t border-border/60 text-[9px] text-muted-foreground">
            Exactly one <b className="text-foreground">Accountable</b> per deliverable; R / C / I may each have several.
          </span>
        </span>
      </span>
    </span>
  );
}

function nameInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return ((parts[0]![0] ?? "") + (parts[parts.length - 1]![0] ?? "")).toUpperCase();
}

// Draft row state — one new (unsaved) member being filled inline in the table.
type Draft = {
  memberType: "internal" | "external";
  userId: string;
  externalName: string;
  externalOrg: string;
  externalEmail: string;
  externalKind: string;
  role: string;
  responsibilities: string;
  approval: string;
};
const emptyDraft = (memberType: "internal" | "external"): Draft => ({
  memberType, userId: "", externalName: "", externalOrg: "",
  externalEmail: "", externalKind: "vendor", role: "", responsibilities: "", approval: "pending",
});

// Per-table column widths + a drag-to-resize handler (in-memory, per instance).
function useColWidths(initial: Record<string, number>) {
  const [w, setW] = useState<Record<string, number>>(initial);
  const startResize = (key: string) => (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX;
    const startW = w[key] ?? 120;
    const onMove = (ev: MouseEvent) => setW(prev => ({ ...prev, [key]: Math.max(48, startW + (ev.clientX - startX)) }));
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = ""; document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize"; document.body.style.userSelect = "none";
  };
  return { w, startResize };
}

// A header cell with a drag handle on its right edge.
function ResizableTh({ children, onResize, className }: { children: React.ReactNode; onResize: (e: React.MouseEvent) => void; className?: string }) {
  return (
    <th className={`relative ${className ?? ""}`}>
      {children}
      <span onMouseDown={onResize} title="Drag to resize" aria-hidden className="absolute top-0 right-0 h-full w-1.5 translate-x-1/2 cursor-col-resize hover:bg-primary/40 active:bg-primary/60 z-10" />
    </th>
  );
}

export function TeamTab({ projectId }: { projectId: number }) {
  const { toast } = useToast();
  const { data: rawMembers = [], refetch } = useListProjectTeamMembers(projectId);
  const { data: rawRaci = [], refetch: refetchRaci } = useListProjectTeamRaci(projectId);
  const { data: users = [] } = useListUsers();
  const createMember = useCreateProjectTeamMember();
  const updateMember = useUpdateProjectTeamMember();
  const deleteMember = useDeleteProjectTeamMember();
  const createRaci = useCreateProjectTeamRaci();
  const deleteRaci = useDeleteProjectTeamRaci();

  const members = rawMembers as Member[];
  const cells = rawRaci as RaciCell[];
  const usersArr = users as User[];
  const usersById = useMemo(() => new Map(usersArr.map(u => [u.id, u])), [usersArr]);

  const internal = members.filter(m => m.memberType === "internal");
  const external = members.filter(m => m.memberType === "external");

  // Resolve a member's display name + sub-label (department / org).
  const memberName = (m: Member) =>
    m.memberType === "internal" ? (usersById.get(m.userId ?? -1)?.name ?? `User ${m.userId}`) : (m.externalName ?? "—");
  const memberSub = (m: Member) =>
    m.memberType === "internal" ? (usersById.get(m.userId ?? -1)?.department ?? null) : (m.externalOrg ?? null);

  // ── Inline add (draft row) + inline edit (per-cell) ──────────────────────────
  // Per-type drafts so BOTH tables can carry their own default "to-be-added" row.
  const [internalDraft, setInternalDraft] = useState<Draft | null>(null);
  const [externalDraft, setExternalDraft] = useState<Draft | null>(null);

  function saveDraft(draft: Draft, clear: () => void) {
    if (draft.memberType === "internal" && !draft.userId) { toast({ title: "Select an employee", variant: "destructive" }); return; }
    if (draft.memberType === "external" && !draft.externalName.trim()) { toast({ title: "Enter the member's name", variant: "destructive" }); return; }

    const data: any = draft.memberType === "internal"
      ? { memberType: "internal", userId: parseInt(draft.userId), role: draft.role || undefined, responsibilities: draft.responsibilities || undefined, approval: draft.approval }
      : {
          memberType: "external", externalName: draft.externalName, externalOrg: draft.externalOrg || undefined,
          externalEmail: draft.externalEmail || undefined, externalKind: draft.externalKind || undefined,
          role: draft.role || undefined, responsibilities: draft.responsibilities || undefined, approval: draft.approval,
        };
    createMember.mutate({ id: projectId, data }, {
      onSuccess: () => { toast({ title: "Member added" }); clear(); refetch(); },
      onError: () => toast({ title: "Failed to save member", variant: "destructive" }),
    });
  }

  // Inline per-cell edit of an existing member.
  function updateField(m: Member, patch: Record<string, unknown>) {
    updateMember.mutate({ id: m.id, data: patch as any }, {
      onSuccess: () => refetch(),
      onError: () => toast({ title: "Failed to update member", variant: "destructive" }),
    });
  }

  function handleDelete(m: Member) {
    if (!confirm(`Remove ${memberName(m)} from the team? Their RACI assignments will be removed too.`)) return;
    deleteMember.mutate({ id: m.id }, { onSuccess: () => { refetch(); refetchRaci(); toast({ title: "Member removed" }); } });
  }

  // ── RACI matrix — ROLES (columns) × deliverables (rows). Assignment is to the
  //    ROLE, not an individual. The backend keys cells by memberId, so each role
  //    column is persisted against every member holding that role (so it round-trips).
  const [extraDeliverables, setExtraDeliverables] = useState<string[]>([]);
  const [raciOpen, setRaciOpen] = useState(true);
  const [newDeliverable, setNewDeliverable] = useState<string | null>(null);

  const deliverables = useMemo(() => {
    const set = new Set<string>();
    for (const c of cells) set.add(c.deliverable);
    for (const d of extraDeliverables) set.add(d);
    return Array.from(set);
  }, [cells, extraDeliverables]);

  // The matrix renders only the project's own deliverables — no prefilled
  // defaults. It stays empty until the user adds rows manually.
  const displayDeliverables = deliverables;

  // Distinct roles on the team → one column each, in first-seen order.
  const roles = useMemo(() => {
    const seen: string[] = [];
    for (const m of members) { const r = (m.role ?? "").trim(); if (r && !seen.includes(r)) seen.push(r); }
    return seen;
  }, [members]);

  // role -> every member id holding it (a letter is written to all of them).
  const roleMemberIds = useMemo(() => {
    const m = new Map<string, number[]>();
    for (const mem of members) {
      const r = (mem.role ?? "").trim();
      if (!r) continue;
      const arr = m.get(r) ?? []; arr.push(mem.id); m.set(r, arr);
    }
    return m;
  }, [members]);

  const cellMap = useMemo(() => {
    const m: Record<string, RaciCell | undefined> = {};
    for (const c of cells) m[`${c.memberId}__${c.deliverable}`] = c;
    return m;
  }, [cells]);

  // Current letter for a (deliverable, role) cell — read off any member of the role.
  const letterFor = (deliverable: string, role: string): string => {
    for (const mid of roleMemberIds.get(role) ?? []) {
      const c = cellMap[`${mid}__${deliverable}`];
      if (c) return c.raciType;
    }
    return "";
  };

  // Persist a letter for (role, deliverable). Writes to all members of that role;
  // "" clears it. Enforces a single Accountable per deliverable (clears other A's).
  function setRoleCell(role: string, deliverable: string, type: string) {
    const mids = roleMemberIds.get(role) ?? [];
    if (mids.length === 0) return;
    const toDelete: number[] = [];
    for (const mid of mids) { const ex = cellMap[`${mid}__${deliverable}`]; if (ex) toDelete.push(ex.id); }
    if (type === "A") {
      for (const c of cells) if (c.deliverable === deliverable && c.raciType === "A" && !mids.includes(c.memberId)) toDelete.push(c.id);
    }
    Promise.all(toDelete.map(id => deleteRaci.mutateAsync({ id })))
      .then(() => type
        ? Promise.all(mids.map(mid => createRaci.mutateAsync({ id: projectId, data: { memberId: mid, deliverable, raciType: type } }))).then(() => refetchRaci())
        : refetchRaci());
  }

  // Click a cell to cycle —  ·  → R → A → C → I →  ·
  const CYCLE = ["", "R", "A", "C", "I"] as const;
  function cycleCell(role: string, deliverable: string) {
    const cur = letterFor(deliverable, role);
    setRoleCell(role, deliverable, CYCLE[(CYCLE.indexOf(cur as never) + 1 + CYCLE.length) % CYCLE.length]);
  }

  function addDeliverable() {
    const d = (newDeliverable ?? "").trim();
    if (!d) { setNewDeliverable(null); return; }
    if (deliverables.includes(d)) { toast({ title: "That deliverable already exists", variant: "destructive" }); return; }
    setExtraDeliverables(prev => [...prev, d]);
    setNewDeliverable(null);
  }
  function removeDeliverable(d: string) {
    if (!confirm(`Remove the "${d}" row and its RACI assignments?`)) return;
    const ids = cells.filter(c => c.deliverable === d).map(c => c.id);
    Promise.all(ids.map(id => deleteRaci.mutateAsync({ id }))).then(() => refetchRaci());
    setExtraDeliverables(prev => prev.filter(x => x !== d));
  }

  function exportCsv() {
    const headers = ["Task / Deliverable", ...roles];
    const rows = displayDeliverables.map(d => [d, ...roles.map(r => letterFor(d, r))]);
    const csv = [headers, ...rows]
      .map(row => row.map(c => `"${(c ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `project-${projectId}-team-raci.csv`; a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Team RACI exported (CSV)" });
  }

  // Avatar bubble for a member (photo for internal employees, initials otherwise).
  const Avatar = ({ m }: { m: Member }) => {
    const photo = m.memberType === "internal" ? usersById.get(m.userId ?? -1)?.photoUrl : null;
    const name = memberName(m);
    if (photo) return <img src={photo} alt={name} className="w-6 h-6 rounded-full object-cover border border-border" />;
    return (
      <span
        className="inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-semibold text-white shrink-0"
        style={{ background: m.memberType === "internal" ? "hsl(var(--primary))" : "#0d9488" }}
      >
        {nameInitials(name)}
      </span>
    );
  };

  return (
    <div className="space-y-2">
      {/* Internal Team */}
      <MemberSection
        title="Internal Team" subtitle="Employees and resources from within the organization."
        icon={<Users size={15} className="text-primary" />} members={internal} type="internal"
        usersArr={usersArr} Avatar={Avatar} memberName={memberName} memberSub={memberSub}
        onUpdateField={updateField} onDelete={handleDelete}
        draft={internalDraft} onDraftChange={setInternalDraft} onDraftSave={() => internalDraft && saveDraft(internalDraft, () => setInternalDraft(null))} onDraftCancel={() => setInternalDraft(null)}
        emptyHint='No internal members yet. Click "Add internal" to add a row.'
      />

      {/* External Team */}
      <MemberSection
        title="External Team" subtitle="Vendor, partner, consultant or contractor resources on this project."
        icon={<Building2 size={15} style={{ color: "#0d9488" }} />} members={external} type="external"
        usersArr={usersArr} Avatar={Avatar} memberName={memberName} memberSub={memberSub}
        onUpdateField={updateField} onDelete={handleDelete} showKind
        draft={externalDraft} onDraftChange={setExternalDraft} onDraftSave={() => externalDraft && saveDraft(externalDraft, () => setExternalDraft(null))} onDraftCancel={() => setExternalDraft(null)}
        emptyHint='No external members yet. Click "Add external" to add a row.'
      />

      {/* RASCI — inline table (deliverable × role), same pattern as the member tables.
          No overflow-hidden so the header info popover isn't clipped; header gets its
          own rounded top to keep the corners clean. */}
      <div className="rounded-lg border border-border border-l-4" style={{ borderLeftColor: "#8b5cf6" }}>
        <div className="px-2.5 py-1 border-b border-border bg-muted/50 rounded-t-[6px] flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-1 min-w-0">
            <button onClick={() => setRaciOpen(o => !o)} className="flex items-center gap-1 min-w-0 text-left">
              <ChevronDown size={12} className={`text-muted-foreground transition-transform ${raciOpen ? "" : "-rotate-90"}`} />
              <h4 className="text-xs font-bold text-foreground flex items-center gap-1"><UserCheck size={12} className="text-primary" /> Team RACI Matrix</h4>
            </button>
            <RaciInfo />
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => { setRaciOpen(true); setNewDeliverable(""); }} className="flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded-lg text-primary-foreground bg-primary hover:bg-primary/90">
              <Plus size={12} /> Add task / deliverable
            </button>
            <button onClick={exportCsv} className="flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded-lg border border-border hover:bg-muted/40">
              <Download size={12} /> CSV
            </button>
          </div>
        </div>

      {raciOpen && (<>
        {roles.length === 0 && (
          <div className="px-3 py-1.5 border-b border-border bg-amber-50 text-[11px] text-amber-700">
            Assign a <b>Role</b> to team members above — each distinct role becomes a column here. You can still add deliverables now.
          </div>
        )}
        <div className="overflow-x-auto p-2">
          <table className="w-full text-sm border-collapse table-fixed [&_th]:border [&_th]:border-border [&_td]:border [&_td]:border-border">
            <thead>
              <tr>
                <th className="w-44 text-center px-2 py-2 text-[11px] font-bold text-foreground">Tasks / Deliverables</th>
                {roles.map(r => (
                  <th key={r} className="text-center px-2 py-2 text-[11px] font-bold text-foreground whitespace-nowrap">{r}</th>
                ))}
                <th className="w-9" />
              </tr>
            </thead>
            <tbody>
              {displayDeliverables.length === 0 && (
                <tr>
                  <td colSpan={roles.length + 2} className="px-3 py-3 text-center text-[11px] text-muted-foreground">
                    No tasks / deliverables yet — use <b>Add task / deliverable</b> to start the matrix.
                  </td>
                </tr>
              )}
              {displayDeliverables.map(d => (
                <tr key={d} className="group/row">
                  <td className="px-3 py-0.5 text-[12px] font-medium text-foreground bg-white text-center align-middle leading-snug">{d}</td>
                  {roles.map(r => {
                    const letter = letterFor(d, r);
                    return (
                      <td key={r} className="p-0.5 text-center align-middle">
                        <button
                          type="button"
                          onClick={() => cycleCell(r, d)}
                          title={letter ? `${RACI_META[letter]?.label ?? letter} — click to change` : "Click to assign R / A / C / I"}
                          className="w-full h-full min-h-[22px] flex items-center justify-center text-[12px] font-bold text-foreground transition-colors hover:bg-muted/30"
                        >
                          {letter || <span className="text-base font-normal text-muted-foreground/30">+</span>}
                        </button>
                      </td>
                    );
                  })}
                  <td className="px-1 text-center align-middle">
                    <button onClick={() => removeDeliverable(d)} className="text-muted-foreground/50 hover:text-destructive transition-colors" title="Remove deliverable"><Trash2 size={13} /></button>
                  </td>
                </tr>
              ))}

              {/* New-deliverable draft row */}
              {newDeliverable !== null && (
                <tr>
                  <td className="px-2 py-1 bg-white">
                    <input
                      value={newDeliverable}
                      onChange={e => setNewDeliverable(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") addDeliverable(); if (e.key === "Escape") setNewDeliverable(null); }}
                      placeholder="Task / deliverable name"
                      autoFocus
                      className="w-full min-w-0 text-xs border border-border rounded px-2 py-1 bg-card outline-none focus:ring-1 focus:ring-primary/40"
                    />
                  </td>
                  <td colSpan={roles.length} className="px-3 text-[11px] text-muted-foreground">Add the row, then click each role's cell to assign R / A / C / I.</td>
                  <td className="px-1 text-center whitespace-nowrap">
                    <button onClick={addDeliverable} className="text-success hover:opacity-80 transition" title="Add"><Check size={15} /></button>
                    <button onClick={() => setNewDeliverable(null)} className="text-muted-foreground/70 hover:text-destructive transition ml-1" title="Cancel"><X size={15} /></button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>

        </div>
      </>)}
      </div>
    </div>
  );
}

// Approval status dropdown — shared by existing rows and the draft row.
function ApprovalSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const v = APPROVAL_META[value] ? value : "pending";
  const meta = APPROVAL_META[v]!;
  return (
    <select
      value={v}
      onChange={e => onChange(e.target.value)}
      className="text-xs font-medium bg-transparent px-2 py-0.5 outline-none border-0 cursor-pointer"
      style={{ color: meta.color }}
    >
      {APPROVAL_OPTS.map(o => (
        <option key={o} value={o} style={{ color: "hsl(var(--foreground))", background: "hsl(var(--card))" }}>{APPROVAL_META[o].label}</option>
      ))}
    </select>
  );
}

// Uncontrolled inline text cell for an existing member — saves on blur, only if
// the value actually changed. key={value} remounts it when a refetch brings a new
// server value so the defaultValue stays in sync.
function CellInput({ value, placeholder, onSave, multiline }: { value: string; placeholder?: string; onSave: (v: string) => void; multiline?: boolean }) {
  if (multiline) {
    // Auto-grow textarea so a long responsibility wraps onto further lines in full.
    const grow = (el: HTMLTextAreaElement) => { el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; };
    return (
      <textarea
        key={value}
        defaultValue={value}
        placeholder={placeholder}
        rows={1}
        ref={el => { if (el) grow(el); }}
        onInput={e => grow(e.currentTarget)}
        onBlur={e => { const next = e.target.value.trim(); if (next !== value) onSave(next); }}
        className="w-full bg-transparent text-xs px-2 py-0.5 outline-none border-0 resize-none leading-snug whitespace-pre-wrap break-words overflow-hidden"
      />
    );
  }
  return (
    <input
      key={value}
      defaultValue={value}
      placeholder={placeholder}
      onBlur={e => { const next = e.target.value.trim(); if (next !== value) onSave(next); }}
      className="w-full bg-transparent text-xs px-2 py-0.5 outline-none border-0"
    />
  );
}

// A single category table (Internal or External). Rows are inline-editable and a
// blank draft row is appended when the user clicks Add internal / Add external.
function MemberSection({
  title, subtitle, icon, members, type, usersArr, Avatar, memberName, memberSub,
  onUpdateField, onDelete, draft, onDraftChange, onDraftSave, onDraftCancel, emptyHint, showKind,
}: {
  title: string; subtitle: string; icon: React.ReactNode; members: Member[];
  type: "internal" | "external"; usersArr: User[];
  Avatar: (p: { m: Member }) => JSX.Element;
  memberName: (m: Member) => string; memberSub: (m: Member) => string | null;
  onUpdateField: (m: Member, patch: Record<string, unknown>) => void; onDelete: (m: Member) => void;
  draft: Draft | null; onDraftChange: (d: Draft) => void; onDraftSave: () => void; onDraftCancel: () => void;
  emptyHint: string; showKind?: boolean;
}) {
  const colCount = showKind ? 6 : 5;
  const [open, setOpen] = useState(true);
  const accent = type === "internal" ? "#3b82f6" : "#10b981";
  const cols = [
    { key: "member", label: "Member", w: 240 },
    ...(showKind ? [{ key: "type", label: "Type", w: 100 }] : []),
    { key: "role", label: "Role", w: 150 },
    { key: "resp", label: "Responsibility", w: 220 },
    { key: "approval", label: "Approval", w: 110 },
    { key: "actions", label: "", w: 48 },
  ];
  const { w, startResize } = useColWidths(Object.fromEntries(cols.map(c => [c.key, c.w])));
  // Empty table → show a default blank "to-be-added" row by default.
  useEffect(() => {
    if (members.length === 0 && !draft) onDraftChange(emptyDraft(type));
  }, [members.length, draft, type]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="rounded-lg border border-border border-l-4 overflow-hidden" style={{ borderLeftColor: accent }}>
      <div className="px-2.5 py-1 border-b border-border bg-muted/50 flex items-center justify-between gap-2">
        <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1 min-w-0 text-left" title={subtitle}>
          <ChevronDown size={12} className={`text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`} />
          <h4 className="text-xs font-bold text-foreground flex items-center gap-1">{icon} {title} <span className="text-[10px] font-normal text-muted-foreground">({members.length})</span></h4>
        </button>
        <button
          onClick={() => { setOpen(true); onDraftChange(emptyDraft(type)); }}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold text-primary-foreground bg-primary hover:bg-primary/90"
        >
          <Plus size={12} /> Add {type}
        </button>
      </div>
      {open && (
      <div className="overflow-x-auto">
        <table className="w-full text-sm table-fixed border-collapse [&_th]:border [&_th]:border-border [&_td]:border [&_td]:border-border">
          <colgroup>
            {cols.map(c => <col key={c.key} style={{ width: w[c.key] }} />)}
          </colgroup>
          <thead>
            <tr>
              {cols.map((c, i) => (
                i < cols.length - 1
                  ? <ResizableTh key={c.key} onResize={startResize(c.key)} className="text-left px-2 py-1 text-[10px] font-bold text-muted-foreground uppercase tracking-wide">{c.label}</ResizableTh>
                  : <th key={c.key} className="px-2 py-1" />
              ))}
            </tr>
          </thead>
          <tbody>
            {members.length === 0 && !draft && (
              <tr><td colSpan={colCount} className="p-4 text-center text-xs text-muted-foreground">{emptyHint}</td></tr>
            )}

            {members.map(m => (
              <tr key={m.id} className="align-top">
                {/* Member identity */}
                <td className="px-2 py-0.5">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Avatar m={m} />
                    {type === "internal" ? (
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-foreground truncate">{memberName(m)}</p>
                        {memberSub(m) && <p className="text-[11px] text-muted-foreground truncate">{memberSub(m)}</p>}
                      </div>
                    ) : (
                      <div className="grid grid-cols-3 gap-1 min-w-[230px]">
                        <CellInput value={m.externalName ?? ""} placeholder="Name" onSave={v => onUpdateField(m, { externalName: v || null })} />
                        <CellInput value={m.externalOrg ?? ""} placeholder="Organisation" onSave={v => onUpdateField(m, { externalOrg: v || null })} />
                        <CellInput value={m.externalEmail ?? ""} placeholder="Email" onSave={v => onUpdateField(m, { externalEmail: v || null })} />
                      </div>
                    )}
                  </div>
                </td>

                {/* Type (external only) */}
                {showKind && (
                  <td className="px-2 py-0.5">
                    <select
                      value={m.externalKind ?? "vendor"}
                      onChange={e => onUpdateField(m, { externalKind: e.target.value })}
                      className="w-full min-w-0 text-xs border border-border rounded px-1.5 py-0.5 capitalize bg-card"
                    >
                      {EXTERNAL_KINDS.map(k => <option key={k} value={k} className="capitalize">{k}</option>)}
                    </select>
                  </td>
                )}

                {/* Role */}
                <td className="px-2 py-0.5 min-w-[80px]">
                  <CellInput value={m.role ?? ""} placeholder="e.g. Project Manager" onSave={v => onUpdateField(m, { role: v || null })} />
                </td>

                {/* Responsibility */}
                <td className="px-2 py-0.5 min-w-[110px]">
                  <CellInput multiline value={m.responsibilities ?? ""} placeholder="What they own on this project" onSave={v => onUpdateField(m, { responsibilities: v || null })} />
                </td>

                {/* Approval */}
                <td className="px-2 py-0.5">
                  <ApprovalSelect value={m.approval ?? "pending"} onChange={v => onUpdateField(m, { approval: v })} />
                </td>

                {/* Actions */}
                <td className="px-3 py-0.5 text-right whitespace-nowrap">
                  <button onClick={() => onDelete(m)} className="text-muted-foreground/70 hover:text-destructive transition-colors" title="Remove member"><Trash2 size={14} /></button>
                </td>
              </tr>
            ))}

            {/* Draft (new member) row */}
            {draft && (
              <tr className="align-top">
                <td className="px-2 py-0.5">
                  {type === "internal" ? (
                    <select
                      value={draft.userId}
                      onChange={e => onDraftChange({ ...draft, userId: e.target.value })}
                      className="w-full text-xs border border-border rounded px-2 py-0.5 bg-card"
                      autoFocus
                    >
                      <option value="">Select employee…</option>
                      {usersArr.map(u => <option key={u.id} value={u.id}>{u.name}{u.role ? ` (${u.role})` : ""}</option>)}
                    </select>
                  ) : (
                    <div className="grid grid-cols-3 gap-1 min-w-[230px]">
                      <input value={draft.externalName} onChange={e => onDraftChange({ ...draft, externalName: e.target.value })} placeholder="Name" autoFocus className="w-full min-w-0 text-xs border border-border rounded px-2 py-0.5 bg-card outline-none" />
                      <input value={draft.externalOrg} onChange={e => onDraftChange({ ...draft, externalOrg: e.target.value })} placeholder="Organisation" className="w-full min-w-0 text-xs border border-border rounded px-2 py-0.5 bg-card outline-none" />
                      <input type="email" value={draft.externalEmail} onChange={e => onDraftChange({ ...draft, externalEmail: e.target.value })} placeholder="Email" className="w-full min-w-0 text-xs border border-border rounded px-2 py-0.5 bg-card outline-none" />
                    </div>
                  )}
                </td>
                {showKind && (
                  <td className="px-2 py-0.5">
                    <select
                      value={draft.externalKind}
                      onChange={e => onDraftChange({ ...draft, externalKind: e.target.value })}
                      className="w-full min-w-0 text-xs border border-border rounded px-1.5 py-0.5 capitalize bg-card"
                    >
                      {EXTERNAL_KINDS.map(k => <option key={k} value={k} className="capitalize">{k}</option>)}
                    </select>
                  </td>
                )}
                <td className="px-2 py-0.5 min-w-[80px]">
                  <input value={draft.role} onChange={e => onDraftChange({ ...draft, role: e.target.value })} placeholder="e.g. Project Manager" className="w-full bg-transparent text-xs px-2 py-0.5 outline-none border-0" />
                </td>
                <td className="px-2 py-0.5 min-w-[110px]">
                  <textarea value={draft.responsibilities} onChange={e => { e.currentTarget.style.height = "auto"; e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`; onDraftChange({ ...draft, responsibilities: e.target.value }); }} placeholder="What they own on this project" rows={1} className="w-full bg-transparent text-xs px-2 py-0.5 outline-none border-0 resize-none leading-snug whitespace-pre-wrap break-words overflow-hidden" />
                </td>
                <td className="px-2 py-0.5">
                  <ApprovalSelect value={draft.approval} onChange={v => onDraftChange({ ...draft, approval: v })} />
                </td>
                <td className="px-3 py-0.5 text-right whitespace-nowrap">
                  <button onClick={onDraftSave} className="text-success hover:opacity-80 transition mr-2" title="Save member"><Check size={16} /></button>
                  <button onClick={onDraftCancel} className="text-muted-foreground/70 hover:text-destructive transition" title="Cancel"><X size={16} /></button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}
