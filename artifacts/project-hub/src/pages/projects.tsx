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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Projects</h2>
          <p className="text-sm text-gray-500 mt-0.5">All projects in execution and planning</p>
        </div>
        {projects && projects.length > 0 && (
          <div className="flex gap-3 text-xs text-gray-500">
            <span className="flex items-center gap-1"><Clock size={11} className="text-indigo-400" />{active.length} active</span>
            <span className="flex items-center gap-1"><CheckCircle2 size={11} className="text-emerald-400" />{others.filter(p => p.status === "completed").length} completed</span>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-52 rounded-2xl" />)}
        </div>
      ) : all.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {all.map(project => {
            const progress = project.progress ?? 0;
            const isActive = project.status === "active";
            return (
              <Link key={project.id} href={`/projects/${project.id}`}>
                <div
                  className="rounded-2xl p-5 cursor-pointer transition-all hover:shadow-md hover:-translate-y-0.5 h-full flex flex-col"
                  style={{ background: "white", border: "1px solid #E2E8F0" }}
                >
                  {/* Top row */}
                  <div className="flex items-start justify-between mb-3">
                    <StatusBadge status={project.status} />
                    <ArrowUpRight size={15} className="text-gray-300" />
                  </div>

                  {/* Icon + Name */}
                  <div className="flex items-start gap-3 mb-3">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{
                        background: isActive
                          ? "linear-gradient(135deg, #6366F1, #8B5CF6)"
                          : "linear-gradient(135deg, #94A3B8, #64748B)",
                      }}
                    >
                      <BarChart2 size={18} className="text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-gray-900 leading-tight">{project.name}</h3>
                      {project.description && (
                        <p className="text-xs text-gray-400 mt-0.5 line-clamp-2 leading-relaxed">
                          {project.description}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Progress */}
                  <div className="mt-auto">
                    <div className="flex justify-between text-xs text-gray-500 mb-1.5">
                      <span className="font-medium">Progress</span>
                      <span className="font-bold text-gray-700">{progress}%</span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${progress}%`,
                          background: progress >= 80
                            ? "linear-gradient(90deg, #10B981, #059669)"
                            : progress >= 40
                              ? "linear-gradient(90deg, #6366F1, #8B5CF6)"
                              : "linear-gradient(90deg, #F59E0B, #D97706)",
                        }}
                      />
                    </div>

                    {/* Dates */}
                    {(project.startDate || project.endDate) && (
                      <div className="flex items-center gap-1 mt-3 text-xs text-gray-400">
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
        <div
          className="rounded-2xl p-12 text-center"
          style={{ background: "white", border: "1px solid #E2E8F0" }}
        >
          <BarChart2 size={32} className="text-gray-200 mx-auto mb-3" />
          <p className="font-medium text-gray-500 mb-1">No projects yet</p>
          <p className="text-sm text-gray-400">
            Approve a charter and create a project to get started.
          </p>
        </div>
      )}
    </div>
  );
}
