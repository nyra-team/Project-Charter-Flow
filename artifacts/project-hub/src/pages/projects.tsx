import { useListProjects } from "@workspace/api-client-react";
import { formatDate } from "../lib/format";
import { StatusBadge } from "../components/status-badge";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart2, Calendar, CheckCircle2, Clock, ArrowUpRight } from "lucide-react";

export default function ProjectsList() {
  const { data: projects, isLoading } = useListProjects();

  const active = projects?.filter(p => p.status === "active") ?? [];
  const others = projects?.filter(p => p.status !== "active") ?? [];
  const all = [...active, ...others];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between ph-rise">
        <div>
          <h2 className="text-xl font-bold text-foreground">Projects</h2>
          <p className="text-sm text-muted-foreground mt-0.5">All projects in execution and planning</p>
        </div>
        {projects && projects.length > 0 && (
          <div className="flex gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Clock size={11} className="text-primary" />{active.length} active</span>
            <span className="flex items-center gap-1"><CheckCircle2 size={11} className="text-success" />{others.filter(p => p.status === "completed").length} completed</span>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-52 rounded-2xl" />)}
        </div>
      ) : all.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 stagger-children">
          {all.map(project => {
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
        <div className="glass-surface rounded-2xl p-12 text-center ph-rise ph-rise-2">
          <BarChart2 size={32} className="text-muted-foreground/40 mx-auto mb-3" />
          <p className="font-medium text-muted-foreground mb-1">No projects yet</p>
          <p className="text-sm text-muted-foreground/70">
            Approve a charter and create a project to get started.
          </p>
        </div>
      )}
    </div>
  );
}
