import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { UserCheck, CalendarClock, CalendarDays, AlertOctagon, Stamp, CheckCircle2 } from "lucide-react";
import { api } from "@/lib/extra-api";
import { PageHeader, MetricCard } from "@/components/ui-kit";
import { TaskStatusChip, PriorityChip } from "@/components/task-status-chip";
import { PhaseChip } from "@/components/ui-kit";
import { TaskDetailModal } from "@/components/task-detail-modal";
import { Skeleton } from "@/components/ui/skeleton";
import type { AggTask, MeTasks } from "@/lib/work-types";

type BucketKey = "assignedToMe" | "dueToday" | "upcoming" | "overdue" | "waitingForApproval" | "completed";

const BUCKETS: Array<{ key: BucketKey; label: string; icon: typeof UserCheck; tone: "muted" | "warn" | "primary" | "danger" | "success" }> = [
  { key: "assignedToMe", label: "Assigned to Me", icon: UserCheck, tone: "primary" },
  { key: "dueToday", label: "Due Today", icon: CalendarClock, tone: "warn" },
  { key: "upcoming", label: "Upcoming", icon: CalendarDays, tone: "muted" },
  { key: "overdue", label: "Overdue", icon: AlertOctagon, tone: "danger" },
  { key: "waitingForApproval", label: "Waiting for Approval", icon: Stamp, tone: "warn" },
  { key: "completed", label: "Completed", icon: CheckCircle2, tone: "success" },
];

export default function MyTasksPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["/api/me/tasks"], queryFn: () => api.get<MeTasks>("/api/me/tasks") });
  const { data: allTasks } = useQuery({ queryKey: ["/api/tasks"], queryFn: () => api.get<AggTask[]>("/api/tasks") });
  const [active, setActive] = useState<BucketKey>("assignedToMe");
  const [openTask, setOpenTask] = useState<AggTask | null>(null);

  const refresh = () => { qc.invalidateQueries({ queryKey: ["/api/me/tasks"] }); qc.invalidateQueries({ queryKey: ["/api/tasks"] }); };
  const rows = data?.[active] ?? [];

  return (
    <div className="space-y-5">
      <PageHeader title="My Tasks" subtitle="Everything assigned to you, organized by what needs attention" icon={UserCheck} />

      {isLoading ? (
        <Skeleton className="h-24 w-full rounded-2xl" />
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            {BUCKETS.map((b) => (
              <MetricCard
                key={b.key}
                label={b.label}
                value={(data?.[b.key] ?? []).length}
                icon={b.icon}
                tone={b.tone}
                active={active === b.key}
                onClick={() => setActive(b.key)}
                highlight={b.key === "overdue" && (data?.overdue.length ?? 0) > 0}
              />
            ))}
          </div>

          <div className="rounded-2xl bg-card border border-card-border glass-surface overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border/60">
              <h2 className="text-sm font-semibold text-foreground">{BUCKETS.find((b) => b.key === active)!.label} · {rows.length}</h2>
            </div>
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-12">Nothing here.</p>
            ) : (
              <div className="divide-y divide-border/40">
                {rows.map((t) => (
                  <div key={t.id} onClick={() => setOpenTask(t)} className="flex items-center gap-3 px-4 py-3 hover:bg-accent/30 cursor-pointer transition-colors">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">{t.name}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <Link href={`/projects/${t.projectId}?tab=grid`}><span className="text-[11px] text-primary hover:underline" onClick={(e) => e.stopPropagation()}>{t.projectName}</span></Link>
                        {t.stage && <PhaseChip stageKey={t.stage} size="xs" />}
                        {t.milestoneName && <span className="text-[11px] text-muted-foreground">· {t.milestoneName}</span>}
                      </div>
                    </div>
                    <PriorityChip priority={t.priority} />
                    <TaskStatusChip status={t.status} />
                    <div className="text-right flex-shrink-0 w-20">
                      <p className="text-[11px] font-mono text-muted-foreground">{t.endDate ? new Date(t.endDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "—"}</p>
                      {(t.gate?.daysOverdue ?? 0) > 0 && <p className="text-[10px] font-bold text-destructive">{t.gate!.daysOverdue}d overdue</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {openTask && <TaskDetailModal task={openTask} allTasks={allTasks ?? []} onClose={() => setOpenTask(null)} onOpenTask={(id) => setOpenTask((allTasks ?? []).find((t) => t.id === id) ?? null)} onRefresh={refresh} />}
    </div>
  );
}
