import { useMemo, useState, useEffect } from "react";
import { useListProjects } from "@workspace/api-client-react";
import { formatDate } from "../lib/format";
import { StatusBadge } from "../components/status-badge";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { BarChart2, Calendar, CheckCircle2, Clock, ArrowUpRight, Search } from "lucide-react";
import { ViewsMenu } from "../components/views-menu";
import { JiraImportButton } from "../components/jira-sync";
import { useUserView } from "../hooks/use-user-view";

// Project List filter shape — stored per saved view.
type ProjectsViewConfig = {
  search: string;
  status: string;           // "" | "active" | "planning" | "completed" | "on_hold"
  sort: "updated" | "name" | "progress";
};

const FALLBACK: ProjectsViewConfig = { search: "", status: "", sort: "updated" };

const STATUS_CHIPS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "active", label: "Active" },
  { value: "planning", label: "Planning" },
  { value: "on_hold", label: "On hold" },
  { value: "completed", label: "Completed" },
];

const SORT_OPTIONS: { value: ProjectsViewConfig["sort"]; label: string }[] = [
  { value: "updated", label: "Recently updated" },
  { value: "name", label: "Name (A–Z)" },
  { value: "progress", label: "Progress (high → low)" },
];

export default function ProjectsList() {
  const { data: projects, isLoading, refetch } = useListProjects();

  // ── Saved views (Stage 3 — Customization)
  const views = useUserView<ProjectsViewConfig>({ scope: "project_list", fallback: FALLBACK });
  const [search, setSearch] = useState(FALLBACK.search);
  const [status, setStatus] = useState(FALLBACK.status);
  const [sort, setSort] = useState<ProjectsViewConfig["sort"]>(FALLBACK.sort);

  // Sync active view → local state when the user picks a different view.
  useEffect(() => {
    if (views.activeId == null) return;
    setSearch(views.activeConfig.search ?? "");
    setStatus(views.activeConfig.status ?? "");
    setSort((views.activeConfig.sort as ProjectsViewConfig["sort"]) ?? "updated");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [views.activeId]);

  // ── Filter + sort pipeline (memoized once on each input change)
  const filtered = useMemo(() => {
    const list = projects ?? [];
    const q = search.trim().toLowerCase();
    const matched = list.filter((p) => {
      if (status && p.status !== status) return false;
      if (q && !`${p.name} ${p.description ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
    const sorted = [...matched].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "progress") return (b.progress ?? 0) - (a.progress ?? 0);
      // "updated" — backend already returns by createdAt desc; mirror that.
      return 0;
    });
    return sorted;
  }, [projects, search, status, sort]);

  const active = (projects ?? []).filter((p) => p.status === "active");
  const completed = (projects ?? []).filter((p) => p.status === "completed");

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between ph-rise">
        <div>
          <h2 className="text-xl font-bold text-foreground">Projects</h2>
          <p className="text-sm text-muted-foreground mt-0.5">All projects in execution and planning</p>
        </div>
        <div className="flex items-center gap-3">
          {projects && projects.length > 0 && (
            <div className="flex gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><Clock size={11} className="text-primary" />{active.length} active</span>
              <span className="flex items-center gap-1"><CheckCircle2 size={11} className="text-success" />{completed.length} completed</span>
            </div>
          )}
          <JiraImportButton onDone={() => { void refetch(); }} />
        </div>
      </div>

      {/* ── Filter bar + saved views (Stage 3) ───────────────────────────── */}
      <div className="glass-surface lift-card ph-rise rounded-2xl px-4 py-3 flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name or description…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {STATUS_CHIPS.map((c) => (
            <button
              key={c.value || "all"}
              onClick={() => setStatus(c.value)}
              className={`px-3 h-7 rounded-full text-xs font-medium transition-colors ${
                status === c.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/60 text-muted-foreground hover:bg-muted"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as ProjectsViewConfig["sort"])}
          className="h-9 rounded-md border border-border bg-card px-3 text-sm"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <div className="ml-auto">
          <ViewsMenu
            views={views.views}
            activeView={views.activeView}
            setActive={views.setActive}
            setDefault={views.setDefault}
            deleteView={views.deleteView}
            saveAs={views.saveAs}
            currentConfig={{ search, status, sort }}
          />
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-52 rounded-2xl" />)}
        </div>
      ) : filtered.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 stagger-children">
          {filtered.map(project => {
            const progress = project.progress ?? 0;
            const isActive = project.status === "active";
            return (
              <Link key={project.id} href={`/projects/${project.id}`}>
                <div className="glass-surface lift-card rounded-2xl p-5 cursor-pointer h-full flex flex-col">
                  <div className="flex items-start justify-between mb-3">
                    <StatusBadge status={project.status} />
                    <ArrowUpRight size={15} className="text-muted-foreground/50" />
                  </div>

                  <div className="flex items-start gap-3 mb-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 border ${
                      isActive
                        ? "bg-primary/10 border-primary/20 text-primary"
                        : "bg-muted border-border text-muted-foreground"
                    }`}>
                      <BarChart2 size={18} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-foreground leading-tight">{project.name}</h3>
                      {project.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 leading-relaxed">
                          {project.description}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="mt-auto">
                    <div className="flex justify-between text-xs mb-1.5">
                      <span className="font-medium text-muted-foreground">Progress</span>
                      <span className="font-bold text-foreground tabular-nums">{progress}%</span>
                    </div>
                    <div className="h-1.5 bg-muted/60 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          progress >= 80 ? "bg-success" :
                          progress >= 40 ? "bg-primary" : "bg-warn"
                        }`}
                        style={{ width: `${progress}%` }}
                      />
                    </div>

                    {(project.startDate || project.endDate) && (
                      <div className="flex items-center gap-1 mt-3 text-xs text-muted-foreground/80">
                        <Calendar size={11} />
                        {formatDate(project.startDate)}
                        {project.endDate && <> — {formatDate(project.endDate)}</>}
                      </div>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        // ── Glassmorphic empty-state surface — frosted panel + ambient mesh
        //    + ghost project-card silhouettes so the white space reads as
        //    "this is where projects will live", not "the page is broken".
        <div className="relative overflow-hidden rounded-2xl ph-rise ph-rise-2 min-h-[440px] glass-surface">
          {/* Layer 1 — soft animated gradient mesh */}
          <div
            className="absolute inset-0 opacity-80 pointer-events-none"
            style={{
              background: `
                radial-gradient(at 18% 22%, hsl(var(--primary) / 0.18) 0px, transparent 55%),
                radial-gradient(at 80% 18%, hsl(var(--primary) / 0.10) 0px, transparent 50%),
                radial-gradient(at 50% 95%, hsl(var(--primary) / 0.14) 0px, transparent 60%),
                radial-gradient(at 88% 78%, hsl(217 91% 60% / 0.10) 0px, transparent 55%)
              `,
            }}
          />
          {/* Layer 2 — fine grid pattern, very faint */}
          <div
            className="absolute inset-0 opacity-[0.04] pointer-events-none"
            style={{
              backgroundImage:
                "linear-gradient(hsl(var(--foreground)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--foreground)) 1px, transparent 1px)",
              backgroundSize: "32px 32px",
            }}
          />
          {/* Layer 3 — ghost project cards arranged behind the message */}
          <div className="absolute inset-x-8 bottom-6 grid grid-cols-1 md:grid-cols-3 gap-4 pointer-events-none">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="rounded-2xl p-4 border border-border/40 bg-card/30 backdrop-blur-md"
                style={{
                  opacity: 0.35 - i * 0.08,
                  transform: `translateY(${i * 6}px)`,
                }}
              >
                <div className="h-3 w-16 rounded bg-muted-foreground/30 mb-3" />
                <div className="h-4 w-3/4 rounded bg-muted-foreground/40 mb-2" />
                <div className="h-3 w-full rounded bg-muted-foreground/20 mb-1" />
                <div className="h-3 w-5/6 rounded bg-muted-foreground/20" />
                <div className="mt-4 pt-3 border-t border-border/30 flex justify-between items-center">
                  <div className="h-2 w-12 rounded bg-muted-foreground/20" />
                  <div className="h-2 w-8 rounded bg-muted-foreground/20" />
                </div>
                <div className="mt-2 h-1.5 w-full rounded bg-muted-foreground/15 overflow-hidden">
                  <div className="h-full bg-primary/40 rounded" style={{ width: `${30 + i * 20}%` }} />
                </div>
              </div>
            ))}
          </div>
          {/* Layer 4 — frosted message panel, centred */}
          <div className="relative z-10 flex flex-col items-center text-center px-8 pt-16 pb-10">
            <div className="relative">
              {/* Glow halo behind the icon */}
              <div className="absolute inset-0 -m-4 rounded-full bg-primary/20 blur-xl" aria-hidden />
              <div className="relative w-16 h-16 rounded-2xl border border-primary/30 bg-card/60 backdrop-blur-md flex items-center justify-center shadow-lg">
                <BarChart2 size={28} className="text-primary" />
              </div>
            </div>
            <h3 className="mt-6 text-xl font-semibold tracking-tight text-foreground">
              {projects && projects.length > 0 ? "No projects match these filters" : "No projects yet"}
            </h3>
            <p className="mt-2 max-w-md text-sm text-muted-foreground leading-relaxed">
              {projects && projects.length > 0
                ? "Try clearing the search, switching status, or picking the All chip — your saved view might be too tight for what's loaded."
                : "Approve a charter and create a project to get started. Once projects land, this page becomes your portfolio at a glance."}
            </p>
            {(!projects || projects.length === 0) && (
              <div className="mt-6 flex items-center gap-2">
                <Link href="/charters">
                  <button className="inline-flex items-center gap-1.5 px-4 h-9 rounded-md text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm">
                    Go to Charters
                  </button>
                </Link>
                <Link href="/pifs/new">
                  <button className="inline-flex items-center gap-1.5 px-4 h-9 rounded-md text-sm font-medium border border-border bg-card/70 backdrop-blur-md hover:bg-accent transition-colors">
                    Start a PIF
                  </button>
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
