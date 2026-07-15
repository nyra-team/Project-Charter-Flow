// Issues workspace — the body of the project's Issues dialog.
//
// Two panes: a sidebar that lists every project with issues (plus an "All
// issues" scope) so the consolidated picture is one click away without leaving
// the project you're in, and a main pane with the status tiles, filters and the
// issue list for whatever scope is selected. Raising an issue always targets the
// selected project.
//
// One /api/all-issues call feeds both panes — the sidebar counts and the list are
// derived from the same array, so they can never disagree.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useListProjects, useListUsers, useUpdateIssue, useDeleteIssue } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertCircle, CheckCircle2, Clock, Trash2, Search, X, Plus, Layers, FolderOpen, Inbox,
} from "lucide-react";
import { formatDate } from "../lib/format";
import { RaiseIssueForm, ISSUE_TYPES, SEVERITIES } from "./raise-issue-form";

export type Issue = {
  id: number; projectId: number; taskId?: number | null; milestoneId?: number | null;
  title: string; description?: string | null;
  issueType?: string | null; severity?: string | null; priority?: string | null; dueDate?: string | null;
  dependencyType?: string | null; blockingOwnerId?: number | null; blockingDept?: string | null;
  originalDeadline?: string | null; proposedRevisedDeadline?: string | null;
  status: string; raisedBy?: number | null; resolvedAt?: string | null; resolutionNotes?: string | null;
  createdAt?: string;
};

const STATUSES = ["open", "in_progress", "resolved", "closed"] as const;
type IssueStatus = (typeof STATUSES)[number];

const STATUS_META: Record<string, { label: string; color: string; bg: string; icon: typeof Clock }> = {
  open:        { label: "Open",        color: "hsl(var(--warn))",             bg: "hsl(var(--warn) / 0.10)",    icon: AlertCircle },
  in_progress: { label: "In Progress", color: "hsl(var(--primary))",          bg: "hsl(var(--primary) / 0.10)", icon: Clock },
  resolved:    { label: "Resolved",    color: "hsl(var(--success))",          bg: "hsl(var(--success) / 0.10)", icon: CheckCircle2 },
  closed:      { label: "Closed",      color: "hsl(var(--muted-foreground))", bg: "hsl(var(--muted))",          icon: CheckCircle2 },
};
const metaOf = (status: string) => STATUS_META[status] ?? STATUS_META.open;

// Severity drives the card's left rail — the one thing you should be able to
// read across a long list without stopping to parse it.
const SEVERITY_COLOR: Record<string, string> = {
  Critical: "#DC2626", High: "#F97316", Medium: "#F59E0B", Low: "#94A3B8",
};

// An issue still needing attention (what the sidebar counts).
const isOpen = (i: Issue) => i.status !== "resolved" && i.status !== "closed";

// Radix Select rejects an empty item value, so "no filter" travels as a sentinel.
const ANY = "__any";

export function IssuesPanel({ projectId }: { projectId: number }) {
  const { toast } = useToast();
  const { data: projects = [] } = useListProjects();
  const { data: users = [] } = useListUsers();
  const updateIssue = useUpdateIssue();
  const deleteIssue = useDeleteIssue();

  // Every issue in one call — the sidebar's per-project counts need them all
  // anyway, and the per-project list is just a filter over the same array.
  const { data: allIssues = [], refetch, isLoading } = useQuery({
    queryKey: ["all-issues"],
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      const r = await fetch("/api/all-issues", { credentials: "include" });
      return r.ok ? ((await r.json()) as Issue[]) : [];
    },
  });

  // Sidebar scope: this project (default), another project, or everything.
  const [scope, setScope] = useState<number | "all">(projectId);
  const [projectSearch, setProjectSearch] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [severityFilter, setSeverityFilter] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [raising, setRaising] = useState(false);

  const projectsArr = projects as Array<{ id: number; name?: string }>;
  const usersArr = users as Array<{ id: number; name?: string }>;
  const projName = (id: number) => projectsArr.find((p) => p.id === id)?.name ?? `Project #${id}`;
  const userName = (id?: number | null) => (id ? (usersArr.find((u) => u.id === id)?.name ?? `User ${id}`) : "—");

  // Sidebar rows — projects that have issues, busiest first. The project you're
  // in is always listed, even with none, so the scope you're on is never missing.
  const sidebarProjects = useMemo(() => {
    const counts = new Map<number, { total: number; open: number }>();
    for (const i of allIssues) {
      const c = counts.get(i.projectId) ?? { total: 0, open: 0 };
      c.total++;
      if (isOpen(i)) c.open++;
      counts.set(i.projectId, c);
    }
    if (!counts.has(projectId)) counts.set(projectId, { total: 0, open: 0 });
    const q = projectSearch.trim().toLowerCase();
    return [...counts.entries()]
      .map(([id, c]) => ({ id, name: projName(id), ...c }))
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .sort((a, b) => (b.open - a.open) || (b.total - a.total) || a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allIssues, projects, projectId, projectSearch]);

  const totals = useMemo(() => ({
    total: allIssues.length,
    open: allIssues.filter(isOpen).length,
  }), [allIssues]);

  // The scope's issues, before the filter row is applied — the status tiles count
  // these, so the tiles keep showing the full picture while a filter narrows the list.
  const scoped = useMemo(
    () => (scope === "all" ? allIssues : allIssues.filter((i) => i.projectId === scope)),
    [allIssues, scope],
  );

  const byStatus = useMemo(() => {
    const m: Record<string, number> = { open: 0, in_progress: 0, resolved: 0, closed: 0 };
    for (const i of scoped) m[i.status] = (m[i.status] ?? 0) + 1;
    return m;
  }, [scoped]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scoped.filter((i) =>
      (!statusFilter || i.status === statusFilter) &&
      (!typeFilter || i.issueType === typeFilter) &&
      (!severityFilter || i.severity === severityFilter) &&
      (!ownerFilter || String(i.blockingOwnerId ?? "") === ownerFilter) &&
      (!q || `${i.title} ${i.description ?? ""}`.toLowerCase().includes(q))
    );
  }, [scoped, statusFilter, typeFilter, severityFilter, ownerFilter, search]);

  const activeFilters = [statusFilter, typeFilter, severityFilter, ownerFilter, search.trim()].filter(Boolean).length;
  const clearFilters = () => { setStatusFilter(""); setTypeFilter(""); setSeverityFilter(""); setOwnerFilter(""); setSearch(""); };

  function changeStatus(id: number, status: string) {
    updateIssue.mutate(
      { id, data: { status, ...(status === "resolved" || status === "closed" ? { resolvedAt: new Date().toISOString() } : {}) } },
      {
        onSuccess: () => { void refetch(); toast({ title: `Marked ${STATUS_META[status]?.label.toLowerCase() ?? status}` }); },
        onError: () => toast({ title: "Update failed", variant: "destructive" }),
      },
    );
  }

  function handleDelete(id: number) {
    if (!window.confirm("Delete this issue?")) return;
    deleteIssue.mutate({ id }, {
      onSuccess: () => { void refetch(); toast({ title: "Issue deleted" }); },
      onError: () => toast({ title: "Delete failed", variant: "destructive" }),
    });
  }

  const scopeLabel = scope === "all" ? "All issues" : projName(scope);
  // Raising is always against a real project — offer it on any project scope.
  const raiseTarget = scope === "all" ? null : scope;

  return (
    <div className="flex h-full min-h-0">
      {/* ── Sidebar — consolidated view: every project's issues, one click away ── */}
      <aside className="w-60 shrink-0 flex flex-col border-r border-border/60 bg-muted/30">
        <div className="p-2 border-b border-border/60">
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={projectSearch}
              onChange={(e) => setProjectSearch(e.target.value)}
              placeholder="Find a project…"
              className="h-7 pl-7 text-[11px]"
            />
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin p-1.5 space-y-0.5">
          <button
            type="button"
            onClick={() => setScope("all")}
            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors ${
              scope === "all" ? "bg-primary/10 text-primary" : "hover:bg-accent/60"
            }`}
          >
            <Layers size={13} className="shrink-0" />
            <span className="flex-1 min-w-0 truncate text-[12px] font-medium">All issues</span>
            <CountBadge open={totals.open} total={totals.total} />
          </button>

          <div className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            By project
          </div>

          {sidebarProjects.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setScope(p.id)}
              title={p.name}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors ${
                scope === p.id ? "bg-primary/10 text-primary" : "hover:bg-accent/60"
              }`}
            >
              <FolderOpen size={13} className="shrink-0 opacity-70" />
              <span className="flex-1 min-w-0">
                <span className="block truncate text-[12px] font-medium">{p.name}</span>
                {p.id === projectId && (
                  <span className="block text-[9px] uppercase tracking-wide text-muted-foreground">This project</span>
                )}
              </span>
              <CountBadge open={p.open} total={p.total} />
            </button>
          ))}
          {sidebarProjects.length === 0 && (
            <p className="px-2 py-3 text-[11px] text-muted-foreground text-center">No projects match.</p>
          )}
        </div>
      </aside>

      {/* ── Main pane ───────────────────────────────────────────────────────── */}
      <section className="flex-1 min-w-0 flex flex-col">
        {/* Scope title + raise */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border/60">
          <h3 className="text-sm font-semibold text-foreground truncate">{scopeLabel}</h3>
          <span className="text-[11px] text-muted-foreground">
            {filtered.length}{filtered.length !== scoped.length && ` of ${scoped.length}`} issue{scoped.length === 1 ? "" : "s"}
          </span>
          {raiseTarget != null && (
            <button
              type="button"
              onClick={() => setRaising((r) => !r)}
              className="ml-auto inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] font-semibold text-primary-foreground bg-primary hover:bg-primary/90 transition-colors"
            >
              {raising ? <X size={13} /> : <Plus size={13} />}
              {raising ? "Close form" : "Raise issue"}
            </button>
          )}
        </div>

        {/* Status tiles — click to filter the list by that status */}
        <div className="grid grid-cols-4 gap-1.5 px-3 pt-2">
          {STATUSES.map((s) => {
            const m = STATUS_META[s];
            const on = statusFilter === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(on ? "" : s)}
                className="rounded-lg px-2.5 py-1.5 text-left transition-all flex items-center justify-between gap-1 bg-card"
                style={{ border: `1px solid ${on ? m.color : "hsl(var(--border))"}`, background: on ? m.bg : undefined }}
              >
                <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: m.color }}>{m.label}</span>
                <span className="text-sm font-bold leading-none tabular-nums" style={{ color: m.color }}>{byStatus[s] ?? 0}</span>
              </button>
            );
          })}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-1.5 px-3 py-2">
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search issues…"
              className="h-7 w-48 pl-7 text-[11px]"
            />
          </div>
          <FilterSelect value={typeFilter} onChange={setTypeFilter} placeholder="Any type" options={ISSUE_TYPES.map((t) => ({ value: t, label: t }))} />
          <FilterSelect value={severityFilter} onChange={setSeverityFilter} placeholder="Any severity" options={SEVERITIES.map((s) => ({ value: s, label: s }))} />
          <FilterSelect
            value={ownerFilter}
            onChange={setOwnerFilter}
            placeholder="Any SPOC"
            options={usersArr.map((u) => ({ value: String(u.id), label: u.name ?? `User ${u.id}` }))}
          />
          {activeFilters > 0 && (
            <button type="button" onClick={clearFilters} className="text-[11px] font-medium text-primary hover:underline">
              Clear filters
            </button>
          )}
        </div>

        {/* Raise form — targets the selected project */}
        {raising && raiseTarget != null && (
          <div className="px-3 pb-2">
            <RaiseIssueForm projectId={raiseTarget} onRaised={() => { void refetch(); setRaising(false); }} />
          </div>
        )}

        {/* List */}
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-3 pb-3 space-y-1.5">
          {isLoading ? (
            <p className="py-10 text-center text-xs text-muted-foreground">Loading issues…</p>
          ) : filtered.length === 0 ? (
            <div className="py-12 flex flex-col items-center gap-2 text-muted-foreground">
              <Inbox size={22} className="opacity-40" />
              <p className="text-xs">
                {scoped.length === 0 ? "No issues raised on this project." : "No issues match your filters."}
              </p>
              {scoped.length > 0 && activeFilters > 0 && (
                <button type="button" onClick={clearFilters} className="text-[11px] font-medium text-primary hover:underline">
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            filtered.map((i) => {
              const m = metaOf(i.status);
              const Icon = m.icon;
              return (
                <div
                  key={i.id}
                  className="rounded-lg border border-border/70 bg-card hover:border-border transition-colors overflow-hidden flex"
                >
                  {/* Severity rail */}
                  <span className="w-1 shrink-0" style={{ background: SEVERITY_COLOR[i.severity ?? ""] ?? "hsl(var(--border))" }} />
                  <div className="flex-1 min-w-0 p-2.5">
                    <div className="flex items-start gap-2">
                      <span className="w-7 h-7 rounded-md flex items-center justify-center shrink-0" style={{ background: m.bg }}>
                        <Icon size={13} style={{ color: m.color }} />
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[10px] font-mono text-muted-foreground">I-{i.id}</span>
                          <p className="text-xs font-semibold text-foreground">{i.title}</p>
                          {scope === "all" && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">{projName(i.projectId)}</span>
                          )}
                          {i.issueType && <Tag>{i.issueType}</Tag>}
                          {i.severity && <Tag color={SEVERITY_COLOR[i.severity]}>{i.severity}</Tag>}
                          {i.priority && <Tag>Pri: {i.priority}</Tag>}
                          {i.dependencyType && <Tag>{i.dependencyType}</Tag>}
                        </div>
                        {i.description && <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{i.description}</p>}
                        <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground flex-wrap">
                          {i.blockingOwnerId != null && <span>SPOC: <b className="text-foreground/80">{userName(i.blockingOwnerId)}</b></span>}
                          {i.blockingDept && <span>Dept: <b className="text-foreground/80">{i.blockingDept}</b></span>}
                          {i.dueDate && <span>Due: {formatDate(i.dueDate)}</span>}
                          {i.originalDeadline && <span>Original: {formatDate(i.originalDeadline)}</span>}
                          {i.proposedRevisedDeadline && <span>Revised: {formatDate(i.proposedRevisedDeadline)}</span>}
                          <span>Raised by {userName(i.raisedBy)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Select value={i.status as IssueStatus} onValueChange={(v) => changeStatus(i.id, v)}>
                          <SelectTrigger className="h-7 w-[120px] text-[11px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {STATUSES.map((s) => (
                              <SelectItem key={s} value={s} className="text-[11px]">{STATUS_META[s].label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <button
                          type="button"
                          onClick={() => handleDelete(i.id)}
                          title="Delete issue"
                          className="p-1.5 rounded-md text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 transition-colors"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}

// Sidebar count — open issues stand out; the total is the quieter number beside it.
function CountBadge({ open, total }: { open: number; total: number }) {
  return (
    <span className="shrink-0 flex items-baseline gap-1 tabular-nums">
      <span className={`text-[11px] font-semibold ${open > 0 ? "text-destructive" : "text-muted-foreground/50"}`}>{open}</span>
      <span className="text-[10px] text-muted-foreground/50">/ {total}</span>
    </span>
  );
}

function Tag({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <span
      className="text-[10px] px-1.5 py-0.5 rounded font-medium"
      style={color ? { background: `${color}1a`, color } : { background: "hsl(var(--muted))", color: "hsl(var(--foreground))" }}
    >
      {children}
    </span>
  );
}

// A filter dropdown with an "any" reset row. "" = filter off.
function FilterSelect({ value, onChange, placeholder, options }: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: { value: string; label: string }[];
}) {
  return (
    <Select value={value || ANY} onValueChange={(v) => onChange(v === ANY ? "" : v)}>
      <SelectTrigger className={`h-7 w-36 text-[11px] ${value ? "border-primary/40 text-primary" : ""}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        <SelectItem value={ANY} className="text-[11px]">{placeholder}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} className="text-[11px]">{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
