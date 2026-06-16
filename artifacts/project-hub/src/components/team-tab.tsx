import { useMemo, useState } from "react";
import {
  useListProjectTeamMembers, useCreateProjectTeamMember,
  useUpdateProjectTeamMember, useDeleteProjectTeamMember,
  useListProjectTeamRaci, useCreateProjectTeamRaci, useDeleteProjectTeamRaci,
  useListUsers,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Users, Building2, Plus, Pencil, Trash2, Download, UserCheck } from "lucide-react";

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
};
type RaciCell = { id: number; projectId: number; memberId: number; deliverable: string; raciType: string };
type User = { id: number; name: string; role?: string; department?: string; photoUrl?: string | null };

const EXTERNAL_KINDS = ["vendor", "partner", "consultant", "contractor"] as const;

// RASCI legend — identical palette to the per-task RACI matrix (raci-tab.tsx) so
// the two surfaces read the same across the app.
const RACI_OPTS = ["R", "A", "S", "C", "I"] as const;
const RACI_META: Record<string, { color: string; bg: string; label: string }> = {
  R: { color: "hsl(var(--primary))", bg: "hsl(var(--primary) / 0.10)", label: "Responsible" },
  A: { color: "hsl(var(--success))", bg: "hsl(var(--success) / 0.10)", label: "Accountable" },
  S: { color: "#0d9488", bg: "rgba(13,148,136,0.10)", label: "Support" },
  C: { color: "hsl(var(--warn))", bg: "hsl(var(--warn) / 0.10)", label: "Consulted" },
  I: { color: "hsl(var(--muted-foreground))", bg: "hsl(var(--border))", label: "Informed" },
};

function nameInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return ((parts[0]![0] ?? "") + (parts[parts.length - 1]![0] ?? "")).toUpperCase();
}

type FormState = {
  memberType: "internal" | "external";
  userId: string;
  externalName: string;
  externalOrg: string;
  externalEmail: string;
  externalKind: string;
  role: string;
  responsibilities: string;
};
const EMPTY_FORM: FormState = {
  memberType: "internal", userId: "", externalName: "", externalOrg: "",
  externalEmail: "", externalKind: "vendor", role: "", responsibilities: "",
};

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

  // ── Add / edit modal ────────────────────────────────────────────────────────
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  function openAdd(memberType: "internal" | "external") {
    setEditId(null);
    setForm({ ...EMPTY_FORM, memberType });
    setShowForm(true);
  }
  function openEdit(m: Member) {
    setEditId(m.id);
    setForm({
      memberType: m.memberType,
      userId: m.userId != null ? String(m.userId) : "",
      externalName: m.externalName ?? "",
      externalOrg: m.externalOrg ?? "",
      externalEmail: m.externalEmail ?? "",
      externalKind: m.externalKind ?? "vendor",
      role: m.role ?? "",
      responsibilities: m.responsibilities ?? "",
    });
    setShowForm(true);
  }

  function handleSubmit() {
    if (form.memberType === "internal" && !form.userId) { toast({ title: "Select an employee", variant: "destructive" }); return; }
    if (form.memberType === "external" && !form.externalName.trim()) { toast({ title: "Enter the member's name", variant: "destructive" }); return; }

    const onDone = (msg: string) => {
      toast({ title: msg });
      setShowForm(false);
      setForm(EMPTY_FORM);
      setEditId(null);
      refetch();
    };
    const onErr = () => toast({ title: "Failed to save member", variant: "destructive" });

    if (editId != null) {
      // Edit only touches the editable fields (memberType is fixed once created).
      const data = form.memberType === "internal"
        ? { userId: parseInt(form.userId), role: form.role || undefined, responsibilities: form.responsibilities || undefined }
        : {
            externalName: form.externalName, externalOrg: form.externalOrg || undefined,
            externalEmail: form.externalEmail || undefined, externalKind: form.externalKind || undefined,
            role: form.role || undefined, responsibilities: form.responsibilities || undefined,
          };
      updateMember.mutate({ id: editId, data }, { onSuccess: () => onDone("Member updated"), onError: onErr });
    } else {
      const data = form.memberType === "internal"
        ? { memberType: "internal", userId: parseInt(form.userId), role: form.role || undefined, responsibilities: form.responsibilities || undefined }
        : {
            memberType: "external", externalName: form.externalName, externalOrg: form.externalOrg || undefined,
            externalEmail: form.externalEmail || undefined, externalKind: form.externalKind || undefined,
            role: form.role || undefined, responsibilities: form.responsibilities || undefined,
          };
      createMember.mutate({ id: projectId, data }, { onSuccess: () => onDone("Member added"), onError: onErr });
    }
  }

  function handleDelete(m: Member) {
    if (!confirm(`Remove ${memberName(m)} from the team? Their RACI assignments will be removed too.`)) return;
    deleteMember.mutate({ id: m.id }, { onSuccess: () => { refetch(); refetchRaci(); toast({ title: "Member removed" }); } });
  }

  // ── RACI matrix (members × deliverables) ──────────────────────────────────────
  const [extraDeliverables, setExtraDeliverables] = useState<string[]>([]);
  const deliverables = useMemo(() => {
    const set = new Set<string>();
    for (const c of cells) set.add(c.deliverable);
    for (const d of extraDeliverables) set.add(d);
    return Array.from(set);
  }, [cells, extraDeliverables]);

  const cellMap = useMemo(() => {
    const m: Record<string, RaciCell | undefined> = {};
    for (const c of cells) m[`${c.memberId}__${c.deliverable}`] = c;
    return m;
  }, [cells]);

  function setCell(memberId: number, deliverable: string, type: string) {
    const existing = cellMap[`${memberId}__${deliverable}`];
    if (type === "") {
      if (existing) deleteRaci.mutate({ id: existing.id }, { onSuccess: () => refetchRaci() });
      return;
    }
    if (existing) {
      // No PATCH endpoint — delete + recreate, same as the per-task RACI tab.
      deleteRaci.mutate({ id: existing.id }, {
        onSuccess: () => createRaci.mutate({ id: projectId, data: { memberId, deliverable, raciType: type } }, { onSuccess: () => refetchRaci() }),
      });
    } else {
      createRaci.mutate({ id: projectId, data: { memberId, deliverable, raciType: type } }, { onSuccess: () => refetchRaci() });
    }
  }

  function addDeliverable() {
    const name = prompt("Deliverable / workstream name (e.g. Plan, Build, Test, Deploy):")?.trim();
    if (!name) return;
    if (deliverables.includes(name)) { toast({ title: "That column already exists" }); return; }
    setExtraDeliverables(prev => [...prev, name]);
  }

  function exportCsv() {
    const headers = ["Member", "Type", "Role", ...deliverables];
    const rows = members.map(m => {
      const raci = deliverables.map(d => cellMap[`${m.id}__${d}`]?.raciType ?? "");
      return [memberName(m), m.memberType, m.role ?? "", ...raci];
    });
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
    if (photo) return <img src={photo} alt={name} className="w-7 h-7 rounded-full object-cover border border-border" />;
    return (
      <span
        className="inline-flex items-center justify-center w-7 h-7 rounded-full text-[10px] font-semibold text-white shrink-0"
        style={{ background: m.memberType === "internal" ? "hsl(var(--primary))" : "#0d9488" }}
      >
        {nameInitials(name)}
      </span>
    );
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="glass-surface lift-card ph-rise rounded-2xl p-5 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="font-semibold text-foreground flex items-center gap-2">
            <Users size={16} className="text-primary" /> Project Team Management
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {internal.length} internal · {external.length} external — all participants in one place
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => openAdd("internal")}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold text-primary-foreground bg-primary hover:bg-primary/90"
          >
            <Plus size={14} /> Add internal
          </button>
          <button
            onClick={() => openAdd("external")}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold border border-border hover:bg-muted/40"
            style={{ color: "#0d9488" }}
          >
            <Plus size={14} /> Add external
          </button>
        </div>
      </div>

      {/* Internal Team */}
      <MemberSection
        title="Internal Team" subtitle="Employees and resources from within the organization."
        icon={<Users size={15} className="text-primary" />} members={internal}
        Avatar={Avatar} memberName={memberName} memberSub={memberSub}
        onEdit={openEdit} onDelete={handleDelete}
        emptyHint='No internal members yet. Click "Add internal" to assign employees.'
      />

      {/* External Team */}
      <MemberSection
        title="External Team" subtitle="Vendor, partner, consultant or contractor resources on this project."
        icon={<Building2 size={15} style={{ color: "#0d9488" }} />} members={external}
        Avatar={Avatar} memberName={memberName} memberSub={memberSub}
        onEdit={openEdit} onDelete={handleDelete} showKind
        emptyHint='No external members yet. Click "Add external" to add a vendor or consultant.'
      />

      {/* RACI matrix */}
      <div className="glass-surface lift-card ph-rise rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-border/60 flex items-center justify-between flex-wrap gap-2">
          <div>
            <h4 className="text-sm font-bold text-foreground flex items-center gap-2"><UserCheck size={15} className="text-primary" /> Team RACI Matrix</h4>
            <p className="text-xs text-muted-foreground mt-0.5">Who is Responsible / Accountable / Support / Consulted / Informed for each deliverable.</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={addDeliverable} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-lg border border-border hover:bg-muted/40">
              <Plus size={13} /> Deliverable
            </button>
            <button onClick={exportCsv} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-lg border border-border hover:bg-muted/40">
              <Download size={13} /> CSV
            </button>
          </div>
        </div>

        {/* Legend */}
        <div className="px-5 py-2.5 border-b border-border/60 flex items-center gap-3 flex-wrap">
          <span className="text-xs font-semibold text-muted-foreground">LEGEND:</span>
          {RACI_OPTS.map(k => (
            <span key={k} className="text-xs flex items-center gap-1.5">
              <span className="w-5 h-5 rounded text-[10px] font-bold flex items-center justify-center" style={{ background: RACI_META[k].bg, color: RACI_META[k].color }}>{k}</span>
              {RACI_META[k].label}
            </span>
          ))}
        </div>

        {members.length === 0 || deliverables.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            {members.length === 0 ? "Add team members first, then map their RACI." : 'Add a deliverable column to start mapping RACI.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead style={{ background: "hsl(var(--muted) / 0.40)" }}>
                <tr>
                  <th className="text-left px-4 py-2 text-xs font-bold text-muted-foreground uppercase sticky left-0 z-10" style={{ background: "hsl(var(--muted) / 0.40)" }}>Member</th>
                  {deliverables.map(d => (
                    <th key={d} className="text-center px-2 py-2 text-xs font-bold text-muted-foreground uppercase whitespace-nowrap">{d}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {members.map(m => (
                  <tr key={m.id} className="border-t border-border/60">
                    <td className="px-4 py-2 sticky left-0 bg-card">
                      <div className="flex items-center gap-2 min-w-0">
                        <Avatar m={m} />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground truncate">{memberName(m)}</p>
                          <p className="text-[11px] text-muted-foreground truncate">
                            {m.memberType === "external" ? "External" : "Internal"}{m.role ? ` · ${m.role}` : ""}
                          </p>
                        </div>
                      </div>
                    </td>
                    {deliverables.map(d => {
                      const v = cellMap[`${m.id}__${d}`]?.raciType ?? "";
                      const meta = v ? RACI_META[v] : null;
                      return (
                        <td key={d} className="px-1 py-1 text-center">
                          <select
                            value={v}
                            onChange={e => setCell(m.id, d, e.target.value)}
                            className="w-12 h-7 text-xs font-bold rounded text-center border"
                            style={{
                              background: meta?.bg ?? "hsl(var(--card))",
                              color: meta?.color ?? "hsl(var(--muted-foreground))",
                              borderColor: meta?.color ?? "hsl(var(--border))",
                            }}
                          >
                            <option value="">—</option>
                            {RACI_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
                          </select>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / edit modal */}
      <Dialog open={showForm} onOpenChange={v => { if (!v) { setShowForm(false); setEditId(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {form.memberType === "internal"
                ? <><Users size={16} className="text-primary" /> {editId != null ? "Edit" : "Add"} internal member</>
                : <><Building2 size={16} style={{ color: "#0d9488" }} /> {editId != null ? "Edit" : "Add"} external member</>}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {form.memberType === "internal" ? (
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Employee</label>
                <select
                  value={form.userId}
                  onChange={e => setForm({ ...form, userId: e.target.value })}
                  className="w-full text-sm border border-border rounded-lg px-3 py-2 mt-1"
                >
                  <option value="">Select employee…</option>
                  {usersArr.map(u => <option key={u.id} value={u.id}>{u.name}{u.role ? ` (${u.role})` : ""}</option>)}
                </select>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">Name</label>
                    <Input value={form.externalName} onChange={e => setForm({ ...form, externalName: e.target.value })} placeholder="e.g. Priya Nair" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">Organisation</label>
                    <Input value={form.externalOrg} onChange={e => setForm({ ...form, externalOrg: e.target.value })} placeholder="e.g. Acme Consulting" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">Type</label>
                    <select
                      value={form.externalKind}
                      onChange={e => setForm({ ...form, externalKind: e.target.value })}
                      className="w-full text-sm border border-border rounded-lg px-3 py-2 mt-1 capitalize"
                    >
                      {EXTERNAL_KINDS.map(k => <option key={k} value={k} className="capitalize">{k}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">Email</label>
                    <Input type="email" value={form.externalEmail} onChange={e => setForm({ ...form, externalEmail: e.target.value })} placeholder="name@vendor.com" />
                  </div>
                </div>
              </>
            )}
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Role</label>
              <Input value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} placeholder="e.g. Project Manager, Security Consultant" />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Responsibilities</label>
              <textarea
                value={form.responsibilities}
                onChange={e => setForm({ ...form, responsibilities: e.target.value })}
                placeholder="What this person is responsible for on the project…"
                rows={3}
                className="w-full text-sm border border-border rounded-lg px-3 py-2 mt-1 resize-y"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => { setShowForm(false); setEditId(null); }} className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted/40">Cancel</button>
              <button onClick={handleSubmit} className="px-4 py-2 text-sm font-semibold text-primary-foreground rounded-lg bg-primary hover:bg-primary/90">
                {editId != null ? "Save" : "Add member"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// A single category table (Internal or External). Kept as a small local
// component so both sections share exactly one layout.
function MemberSection({
  title, subtitle, icon, members, Avatar, memberName, memberSub, onEdit, onDelete, emptyHint, showKind,
}: {
  title: string; subtitle: string; icon: React.ReactNode; members: Member[];
  Avatar: (p: { m: Member }) => JSX.Element;
  memberName: (m: Member) => string; memberSub: (m: Member) => string | null;
  onEdit: (m: Member) => void; onDelete: (m: Member) => void; emptyHint: string; showKind?: boolean;
}) {
  return (
    <div className="glass-surface lift-card ph-rise rounded-2xl overflow-hidden">
      <div className="px-5 py-3 border-b border-border/60">
        <h4 className="text-sm font-bold text-foreground flex items-center gap-2">{icon} {title} <span className="text-xs font-normal text-muted-foreground">({members.length})</span></h4>
        <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
      </div>
      {members.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">{emptyHint}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead style={{ background: "hsl(var(--muted) / 0.40)" }}>
              <tr>
                <th className="text-left px-4 py-2 text-xs font-bold text-muted-foreground uppercase tracking-wide">Member</th>
                {showKind && <th className="text-left px-4 py-2 text-xs font-bold text-muted-foreground uppercase tracking-wide">Type</th>}
                <th className="text-left px-4 py-2 text-xs font-bold text-muted-foreground uppercase tracking-wide">Role</th>
                <th className="text-left px-4 py-2 text-xs font-bold text-muted-foreground uppercase tracking-wide">Responsibilities</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {members.map(m => (
                <tr key={m.id} className="border-t border-border/60 hover:bg-primary/5">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Avatar m={m} />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">{memberName(m)}</p>
                        {memberSub(m) && <p className="text-[11px] text-muted-foreground truncate">{memberSub(m)}{m.externalEmail ? ` · ${m.externalEmail}` : ""}</p>}
                        {!memberSub(m) && m.externalEmail && <p className="text-[11px] text-muted-foreground truncate">{m.externalEmail}</p>}
                      </div>
                    </div>
                  </td>
                  {showKind && <td className="px-4 py-2.5 text-xs text-foreground capitalize">{m.externalKind ?? "—"}</td>}
                  <td className="px-4 py-2.5 text-sm text-foreground">{m.role || <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-xs">{m.responsibilities || <span className="text-muted-foreground/60">—</span>}</td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    <button onClick={() => onEdit(m)} className="text-muted-foreground/70 hover:text-primary transition-colors mr-2" title="Edit member"><Pencil size={14} /></button>
                    <button onClick={() => onDelete(m)} className="text-muted-foreground/70 hover:text-destructive transition-colors" title="Remove member"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
