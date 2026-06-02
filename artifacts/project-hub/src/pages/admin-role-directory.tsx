import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Users, Save, Search, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { DashboardCard } from "../components/dashboard/primitives";
import { PersonAvatar } from "../components/person-avatar";

type RoleRow = {
  id: number; role: string; label: string;
  userId: number | null; email: string | null; isActive: boolean;
  userName: string | null; userEmail: string | null;
};
type User = { id: number; name: string; email: string | null };

function roleLabel(role: string): string {
  return role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Inline person picker — filter pmo_users and click to assign.
function PersonPicker({ users, onPick }: { users: User[]; onPick: (u: User) => void }) {
  const [q, setQ] = useState("");
  const matches = q.trim()
    ? users.filter((u) => u.name.toLowerCase().includes(q.toLowerCase()) || (u.email ?? "").toLowerCase().includes(q.toLowerCase())).slice(0, 8)
    : [];
  return (
    <div className="relative">
      <div className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1.5">
        <Search size={13} className="text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search people…"
          className="w-40 text-xs bg-transparent focus:outline-none text-foreground"
        />
      </div>
      {matches.length > 0 && (
        <div className="absolute z-20 mt-1 w-56 max-h-56 overflow-auto rounded-md border border-border bg-card shadow-lg">
          {matches.map((u) => (
            <button
              key={u.id}
              onClick={() => { onPick(u); setQ(""); }}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-accent"
            >
              <PersonAvatar id={u.id} name={u.name} size={20} />
              <span className="truncate">{u.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AdminRoleDirectory() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: roles, isLoading } = useQuery({
    queryKey: ["/api/role-directory"],
    queryFn: async () => { const r = await fetch("/api/role-directory"); if (!r.ok) throw new Error("Failed"); return r.json() as Promise<RoleRow[]>; },
  });
  const { data: users = [] } = useQuery({
    queryKey: ["/api/users"],
    queryFn: async () => { const r = await fetch("/api/users"); if (!r.ok) throw new Error("Failed"); return r.json() as Promise<User[]>; },
  });

  // Pending edits keyed by role.
  const [edits, setEdits] = useState<Record<string, { userId?: number | null; email?: string | null; userName?: string | null }>>({});

  const save = useMutation({
    mutationFn: async ({ role, userId, email }: { role: string; userId: number | null; email: string | null }) => {
      const r = await fetch(`/api/role-directory/${role}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, email }),
      });
      if (!r.ok) throw new Error((await r.json())?.error ?? "Failed");
      return r.json();
    },
    onSuccess: (_d, vars) => {
      toast({ title: "Role assignment saved", description: `${roleLabel(vars.role)} updated.` });
      setEdits((e) => { const n = { ...e }; delete n[vars.role]; return n; });
      qc.invalidateQueries({ queryKey: ["/api/role-directory"] });
    },
    onError: (err: unknown) => toast({ title: "Save failed", description: err instanceof Error ? err.message : "Try again", variant: "destructive" }),
  });

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-primary/10 border border-primary/20">
          <Users size={18} className="text-primary" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-foreground">Role Directory</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Who is the CFO, Procurement Head, QA Lead, etc. — drives person-based reminders &amp; escalations. (Sponsor &amp; Project Manager are read per-project from the charter.)</p>
        </div>
      </div>

      <DashboardCard title="Org Role Assignments" subtitle="Assign a person (preferred — enables in-app alerts) or a group email for each governance role.">
        {isLoading || !roles ? (
          <Skeleton className="h-64 rounded-xl" />
        ) : (
          <div className="space-y-2">
            {roles.map((r) => {
              const edit = edits[r.role];
              const pendingUserId = edit && "userId" in edit ? edit.userId : r.userId;
              const pendingUserName = edit?.userName ?? r.userName;
              const pendingEmail = edit && "email" in edit ? edit.email : r.email;
              const dirty = !!edit;
              return (
                <div key={r.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/40 flex-wrap">
                  <div className="flex-1 min-w-[140px]">
                    <span className="text-sm font-medium text-foreground">{r.label || roleLabel(r.role)}</span>
                    <span className="block text-[10px] font-mono uppercase tracking-wide text-muted-foreground">{r.role}</span>
                  </div>

                  {/* Current / pending assignee */}
                  <div className="flex items-center gap-1.5 min-w-[150px]">
                    {pendingUserId && pendingUserName ? (
                      <>
                        <PersonAvatar id={pendingUserId} name={pendingUserName} size={20} />
                        <span className="text-xs text-foreground truncate max-w-[120px]">{pendingUserName}</span>
                        <button onClick={() => setEdits((e) => ({ ...e, [r.role]: { userId: null, email: null, userName: null } }))} className="text-muted-foreground/60 hover:text-destructive" title="Clear"><X size={13} /></button>
                      </>
                    ) : pendingEmail ? (
                      <>
                        <span className="text-xs text-foreground truncate max-w-[150px]" title={pendingEmail}>{pendingEmail}</span>
                        <button onClick={() => setEdits((e) => ({ ...e, [r.role]: { userId: null, email: null, userName: null } }))} className="text-muted-foreground/60 hover:text-destructive" title="Clear"><X size={13} /></button>
                      </>
                    ) : (
                      <span className="text-muted-foreground/60 italic text-xs">Unassigned</span>
                    )}
                  </div>

                  <PersonPicker users={users} onPick={(u) => setEdits((e) => ({ ...e, [r.role]: { userId: u.id, userName: u.name, email: null } }))} />

                  <input
                    type="email"
                    placeholder="or group email…"
                    defaultValue={r.email ?? ""}
                    onChange={(ev) => setEdits((e) => ({ ...e, [r.role]: { userId: null, userName: null, email: ev.target.value || null } }))}
                    className="w-44 text-xs rounded-md px-2 py-1.5 bg-card text-card-foreground border border-border focus:outline-none focus:ring-2 focus:ring-ring/40"
                  />

                  <button
                    onClick={() => save.mutate({ role: r.role, userId: pendingUserId ?? null, email: pendingUserId ? null : (pendingEmail ?? null) })}
                    disabled={!dirty || save.isPending}
                    className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
                  >
                    <Save size={13} /> Save
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </DashboardCard>
    </div>
  );
}
