import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ShieldCheck, Save, Search, ChevronLeft, ChevronRight, History } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { DashboardCard } from "../components/dashboard/primitives";
import { useAuth } from "../auth/context";

// Super-admin-only RBAC page: every active employee's effective Project Hub
// role (derived from the master directory, or an explicit override) + the
// access_pmo gate. Edits apply immediately; each save is recorded as an
// auto-approved pmo_role_change request in the shared approval engine
// (the "Recent changes" panel below reads that audit trail).

type WireRow = {
  employeeId: string;
  employeeCode: string | null;
  fullName: string;
  designation: string | null;
  function: string | null;
  gradeCode: string | null;
  officeEmail: string | null;
  photoUrl: string | null;
  accessPmo: boolean;
  isSuperAdmin: boolean;
  roleOverride: string | null;
  effectiveRole: string;
  roleSource: "override" | "derived";
};

type RolesResponse = { rows: WireRow[]; total: number; page: number; pageSize: number; roles: string[] };

type AuditEntry = {
  id: string;
  entity_id: string;
  requester_id: string;
  created_at: string;
  metadata?: {
    editor?: { fullName?: string | null; employeeCode?: string | null };
    target?: { employeeCode?: string | null; name?: string | null };
    before?: { roleOverride: string | null; effectiveRole: string; accessPmo: boolean };
    after?: { roleOverride: string | null; effectiveRole: string; accessPmo: boolean };
  };
};

const AUTO = "__auto__"; // Radix Select can't carry an empty-string value

function roleLabel(role: string): string {
  if (role === "pmo") return "PMO";
  if (role === "cfo") return "CFO";
  if (role === "scm") return "SCM";
  if (role === "hod") return "HOD";
  if (role === "pm") return "PM";
  return role.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

const ROLE_BADGE: Record<string, string> = {
  admin: "bg-violet-500/10 text-violet-600 border-violet-500/25",
  chairman: "bg-amber-500/10 text-amber-600 border-amber-500/25",
  executive_director: "bg-amber-500/10 text-amber-600 border-amber-500/25",
  cfo: "bg-emerald-500/10 text-emerald-600 border-emerald-500/25",
  pmo: "bg-primary/10 text-primary border-primary/25",
  pm: "bg-sky-500/10 text-sky-600 border-sky-500/25",
  hod: "bg-rose-500/10 text-rose-600 border-rose-500/25",
  scm: "bg-orange-500/10 text-orange-600 border-orange-500/25",
  finance: "bg-teal-500/10 text-teal-600 border-teal-500/25",
  team_member: "bg-muted text-muted-foreground border-border",
};

function RoleBadge({ role, source }: { role: string; source: "override" | "derived" }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${ROLE_BADGE[role] ?? ROLE_BADGE["team_member"]}`}>
      {roleLabel(role)}
      <span className="text-[9px] uppercase tracking-wide opacity-60">{source === "override" ? "set" : "auto"}</span>
    </span>
  );
}

const PAGE_SIZE = 50;

export default function AdminRoles() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"pmo_only" | "all">("pmo_only");
  const [page, setPage] = useState(1);
  // Pending (unsaved) edits keyed by employeeCode.
  const [edits, setEdits] = useState<Record<string, { pmoRole?: string | null; accessPmo?: boolean }>>({});

  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const isSuperAdmin = !!profile?.is_super_admin;

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["/api/admin/roles", { search, filter, page }],
    queryFn: async () => {
      const qs = new URLSearchParams({ search, filter, page: String(page), pageSize: String(PAGE_SIZE) });
      const r = await fetch(`/api/admin/roles?${qs}`);
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? "Failed to load employees");
      return r.json() as Promise<RolesResponse>;
    },
    enabled: isSuperAdmin,
    placeholderData: prev => prev,
  });

  const { data: recent } = useQuery({
    queryKey: ["/api/admin/roles/recent"],
    queryFn: async () => {
      const r = await fetch("/api/admin/roles/recent");
      if (!r.ok) throw new Error("Failed to load audit trail");
      return r.json() as Promise<AuditEntry[]>;
    },
    enabled: isSuperAdmin,
  });

  const save = useMutation({
    mutationFn: async ({ employeeCode, patch }: { employeeCode: string; patch: { pmoRole?: string | null; accessPmo?: boolean } }) => {
      const r = await fetch(`/api/admin/roles/${encodeURIComponent(employeeCode)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? "Failed");
      return r.json() as Promise<WireRow>;
    },
    onSuccess: (row, vars) => {
      toast({ title: "Saved", description: `${row.fullName}: ${roleLabel(row.effectiveRole)}${row.accessPmo ? "" : " (no PMO access)"}` });
      setEdits(e => { const n = { ...e }; delete n[vars.employeeCode]; return n; });
      void qc.invalidateQueries({ queryKey: ["/api/admin/roles"] });
      void qc.invalidateQueries({ queryKey: ["/api/admin/roles/recent"] });
    },
    onError: (err: unknown) =>
      toast({ title: "Save failed", description: err instanceof Error ? err.message : "Try again", variant: "destructive" }),
  });

  // Defense in depth — the API 403s regardless, but don't render the surface.
  if (!isSuperAdmin) {
    return (
      <div className="max-w-xl mx-auto mt-16 text-center space-y-2">
        <ShieldCheck size={32} className="mx-auto text-muted-foreground/50" />
        <h2 className="text-lg font-semibold text-foreground">Super admin only</h2>
        <p className="text-sm text-muted-foreground">Employee roles &amp; access can only be viewed and edited by a super admin.</p>
      </div>
    );
  }

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const roles = data?.roles ?? [];
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-primary/10 border border-primary/20">
          <ShieldCheck size={18} className="text-primary" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-foreground">Employee Roles &amp; Access</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Set each employee's Project Hub role and access. "Auto" follows the HR directory (designation / function / grade); picking a role overrides it. Changes apply immediately and are recorded in the audit trail.
          </p>
        </div>
      </div>

      <DashboardCard
        title="Role Assignments"
        subtitle={`${total.toLocaleString()} ${filter === "pmo_only" ? "employees with PMO access" : "active employees"}`}
      >
        {/* Controls */}
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <div className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1.5 flex-1 min-w-[220px] max-w-sm">
            <Search size={13} className="text-muted-foreground" />
            <input
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder="Search name, code, designation, email…"
              className="w-full text-xs bg-transparent focus:outline-none text-foreground"
            />
          </div>
          <div className="flex rounded-md border border-border overflow-hidden text-xs">
            {([["pmo_only", "PMO users"], ["all", "All employees"]] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => { setFilter(key); setPage(1); }}
                className={`px-3 py-1.5 font-medium transition-colors ${filter === key ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-accent"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <Skeleton className="h-72 rounded-xl" />
        ) : rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No employees match.</p>
        ) : (
          <div className={`space-y-1.5 ${isFetching ? "opacity-60" : ""}`}>
            {rows.map(r => {
              const code = r.employeeCode ?? "";
              const edit = edits[code] ?? {};
              const pendingRole = "pmoRole" in edit ? edit.pmoRole : r.roleOverride;
              const pendingAccess = "accessPmo" in edit ? edit.accessPmo! : r.accessPmo;
              const dirty = ("pmoRole" in edit && (edit.pmoRole ?? null) !== (r.roleOverride ?? null))
                || ("accessPmo" in edit && edit.accessPmo !== r.accessPmo);
              return (
                <div key={r.employeeId} className="flex items-center gap-3 p-2.5 rounded-lg bg-muted/40 flex-wrap">
                  <div className="flex-1 min-w-[180px]">
                    <span className="text-sm font-medium text-foreground">{r.fullName}</span>
                    <span className="block text-[10px] text-muted-foreground truncate">
                      <span className="font-mono">{code}</span>
                      {r.designation ? ` · ${r.designation}` : ""}
                      {r.function ? ` · ${r.function}` : ""}
                    </span>
                  </div>

                  <RoleBadge role={r.effectiveRole} source={r.roleSource} />

                  <Select
                    value={pendingRole ?? AUTO}
                    onValueChange={v => setEdits(e => ({ ...e, [code]: { ...e[code], pmoRole: v === AUTO ? null : v } }))}
                  >
                    <SelectTrigger className="w-[150px] h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={AUTO} className="text-xs">Auto (derived)</SelectItem>
                      {roles.map(role => (
                        <SelectItem key={role} value={role} className="text-xs">{roleLabel(role)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Switch
                      checked={pendingAccess}
                      onCheckedChange={v => setEdits(e => ({ ...e, [code]: { ...e[code], accessPmo: v } }))}
                    />
                    PMO access
                  </label>

                  <button
                    onClick={() => {
                      const patch: { pmoRole?: string | null; accessPmo?: boolean } = {};
                      if ("pmoRole" in edit) patch.pmoRole = edit.pmoRole ?? null;
                      if ("accessPmo" in edit) patch.accessPmo = edit.accessPmo;
                      save.mutate({ employeeCode: code, patch });
                    }}
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

        {/* Pagination */}
        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
            <span>
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total.toLocaleString()}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="p-1.5 rounded-md border border-border hover:bg-accent disabled:opacity-40"
                aria-label="Previous page"
              >
                <ChevronLeft size={14} />
              </button>
              <span className="px-2">Page {page} / {lastPage}</span>
              <button
                onClick={() => setPage(p => Math.min(lastPage, p + 1))}
                disabled={page >= lastPage}
                className="p-1.5 rounded-md border border-border hover:bg-accent disabled:opacity-40"
                aria-label="Next page"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </DashboardCard>

      <DashboardCard title="Recent changes" subtitle="Audit trail — every edit is recorded through the approval engine.">
        {!recent?.length ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No role changes recorded yet.</p>
        ) : (
          <div className="space-y-1.5">
            {recent.map(entry => {
              const m = entry.metadata ?? {};
              const editor = m.editor?.fullName ?? entry.requester_id;
              const target = m.target?.name ?? entry.entity_id;
              const bits: string[] = [];
              if (m.before && m.after) {
                if (m.before.effectiveRole !== m.after.effectiveRole || (m.before.roleOverride ?? null) !== (m.after.roleOverride ?? null)) {
                  bits.push(`role ${roleLabel(m.before.effectiveRole)} → ${roleLabel(m.after.effectiveRole)}${m.after.roleOverride ? "" : " (auto)"}`);
                }
                if (m.before.accessPmo !== m.after.accessPmo) {
                  bits.push(`PMO access ${m.after.accessPmo ? "granted" : "revoked"}`);
                }
              }
              return (
                <div key={entry.id} className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg bg-muted/30 text-xs">
                  <History size={13} className="text-muted-foreground/60 shrink-0" />
                  <span className="text-foreground">
                    <span className="font-medium">{editor}</span> changed <span className="font-medium">{target}</span>
                    {bits.length ? `: ${bits.join(", ")}` : ""}
                  </span>
                  <span className="ml-auto text-muted-foreground whitespace-nowrap">
                    {new Date(entry.created_at).toLocaleString()}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </DashboardCard>
    </div>
  );
}
