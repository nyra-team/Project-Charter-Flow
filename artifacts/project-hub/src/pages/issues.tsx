import { useQuery } from "@tanstack/react-query";
import { useListProjects, useListUsers } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, Clock } from "lucide-react";

// Read-only register of issues individuals have raised against projects.
type Issue = {
  id: number; projectId: number; title: string; description?: string | null;
  status?: string | null; raisedBy?: number | null; blockingOwnerId?: number | null;
  createdAt?: string;
};

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  open: { label: "Open", color: "hsl(var(--warn))", bg: "hsl(var(--warn) / 0.10)" },
  in_progress: { label: "In Progress", color: "hsl(var(--primary))", bg: "hsl(var(--primary) / 0.10)" },
  resolved: { label: "Resolved", color: "hsl(var(--success))", bg: "hsl(var(--success) / 0.10)" },
};

export default function IssuesList() {
  const { toast } = useToast();
  const { data: projects = [] } = useListProjects();
  const { data: users = [] } = useListUsers();

  const projectsArr = projects as Array<{ id: number; name?: string }>;
  const usersArr = users as Array<{ id: number; name?: string }>;
  const usersById = new Map(usersArr.map(u => [u.id, u]));
  const userName = (id?: number | null) => (id ? (usersById.get(id)?.name ?? `User ${id}`) : "—");
  const projName = (id: number) => projectsArr.find(p => p.id === id)?.name ?? `Project #${id}`;

  const { data: issues = [], refetch, isLoading } = useQuery({
    queryKey: ["all-issues", projectsArr.map(p => p.id).join(",")],
    enabled: projectsArr.length > 0,
    // Always pull fresh so issues registered elsewhere (project Issues popup,
    // task grid) appear the moment this page is opened.
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const lists = await Promise.all(projectsArr.map(p =>
        fetch(`/api/projects/${p.id}/issues`, { credentials: "include" }).then(r => (r.ok ? r.json() : [])),
      ));
      return (lists.flat() as Issue[]).sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    },
  });

  async function resolve(id: number) {
    const res = await fetch(`/api/issues/${id}`, {
      method: "PATCH", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "resolved" }),
    });
    if (res.ok) { toast({ title: "Marked resolved" }); void refetch(); }
    else toast({ title: "Action failed", variant: "destructive" });
  }

  // Open issues a person actually raised (have a raisedBy) — excludes resolved
  // and any system / auto-generated entries.
  const open = (issues as Issue[]).filter(i => i.raisedBy != null && (i.status ?? "open") !== "resolved");

  const card = (i: Issue) => {
    const st = STATUS_META[i.status ?? "open"] ?? STATUS_META.open;
    return (
      <div key={i.id} className="glass-surface lift-card rounded-2xl p-3 flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">{i.title}</p>
          {i.description && <p className="text-[12px] text-muted-foreground line-clamp-2">{i.description}</p>}
          <p className="text-[11px] text-muted-foreground mt-1">
            {projName(i.projectId)} · raised by {userName(i.raisedBy)} → to {userName(i.blockingOwnerId)}
            {i.createdAt ? ` · ${new Date(i.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ color: st.color, background: st.bg }}>{st.label}</span>
          <button onClick={() => resolve(i.id)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-success/10 text-success border border-success/20 hover:bg-success/20 transition-colors">
            <CheckCircle2 size={13} /> Resolve
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-bold text-foreground">Risks / Issues</h2>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading issues…</p>
      ) : (
        <div>
          <h3 className="text-sm font-bold text-foreground mb-2 flex items-center gap-2"><Clock size={15} className="text-warn" /> Open <span className="text-xs font-normal text-muted-foreground">({open.length})</span></h3>
          {open.length === 0 ? <p className="text-sm text-muted-foreground">No open issues.</p> : <div className="space-y-2">{open.map(card)}</div>}
        </div>
      )}
    </div>
  );
}
