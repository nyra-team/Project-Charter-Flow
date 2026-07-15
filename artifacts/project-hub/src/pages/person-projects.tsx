import { useMemo, useState } from "react";
import { useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useListProjects, useListUsers, useListCharters } from "@workspace/api-client-react";
import { ChevronLeft, ChevronRight, FolderKanban, AlertTriangle, ListTree, BarChart3 } from "lucide-react";
import { useGoBack } from "../lib/back";
import { buildTeamOverview } from "@/lib/teamOverviewData";
import { ProjectTable } from "@/components/TeamOverview";

/**
 * Person Projects — a dedicated page listing every project under one person
 * (the projects they own + the projects they hold tasks in), reached from the
 * redirect button on an org-chart person card. Rendered as one simple table:
 * a row per project (done / in progress / overdue / total), each expandable to
 * its tasks; the project name links into the project. Route: /people/:id
 * (id = pmo_users.id).
 */
export default function PersonProjects() {
  const [, params] = useRoute("/people/:id");
  const id = Number(params?.id ?? 0);
  const goBack = useGoBack();
  const [mode, setMode] = useState<"list" | "chart">("list");

  const { data: allProjects = [] } = useListProjects();
  const { data: allUsers = [] } = useListUsers();
  const { data: allCharters = [] } = useListCharters();
  const { data: allTasks = [] } = useQuery({
    queryKey: ["/api/tasks", "all"],
    queryFn: async () => {
      const r = await fetch("/api/tasks", { credentials: "include" });
      return r.ok ? await r.json() : [];
    },
  });

  const person = useMemo(() => {
    const rows = buildTeamOverview(allProjects as never[], allUsers as never[], allTasks as never[], allCharters as never[]);
    return rows.find((p) => p.id === id) ?? null;
  }, [allProjects, allUsers, allTasks, allCharters, id]);

  return (
    <div className="w-full pt-3 md:pt-4 space-y-4">
      {/* Header: back + person identity + list/chart toggle */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={() => goBack("/my-team-actions")}
          title="Back"
          className="w-8 h-8 rounded-lg border border-border bg-card/70 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
        >
          <ChevronLeft size={16} />
        </button>
        <div className="min-w-0">
          <div className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
            <span className="truncate">My Team Actions</span>
            <ChevronRight size={9} className="flex-shrink-0" />
            <span className="text-primary">Projects</span>
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <FolderKanban size={16} className="text-primary shrink-0" />
            <h1 className="text-base font-bold text-foreground tracking-tight truncate">{person ? person.name : "Person"}</h1>
          </div>
          {person && (
            <p className="text-sm text-muted-foreground mt-0.5">
              {person.department || "—"} · {person.projects.length} project{person.projects.length === 1 ? "" : "s"}
              {person.overdue > 0 && (
                <span className="inline-flex items-center gap-1 text-red-600 font-semibold ml-2">
                  <AlertTriangle className="w-3 h-3" /> {person.overdue} overdue
                </span>
              )}
            </p>
          )}
        </div>
      </div>
        {person && person.projects.length > 0 && (
          <div className="inline-flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5 shrink-0">
            {([
              { m: "list" as const, Icon: ListTree, label: "List" },
              { m: "chart" as const, Icon: BarChart3, label: "Chart" },
            ]).map(({ m, Icon, label }) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-semibold transition-colors ${mode === m ? "bg-white text-primary shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
              >
                <Icon className="w-3.5 h-3.5" /> {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {!person ? (
        <div className="rounded-xl border border-border/60 bg-card/60 p-10 text-center text-sm text-muted-foreground">
          No projects found for this person.
        </div>
      ) : person.projects.length === 0 ? (
        <div className="rounded-xl border border-border/60 bg-card/60 p-10 text-center text-sm text-muted-foreground">
          {person.name} isn't on any project yet.
        </div>
      ) : (
        <ProjectTable projects={person.projects} mode={mode} />
      )}
    </div>
  );
}
