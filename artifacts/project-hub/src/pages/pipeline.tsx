import { useListProjects } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles, ArrowUpRight, Layers, Workflow, Activity } from "lucide-react";
import { useMemo, useState } from "react";
import { LIFECYCLE_STAGES, getStageConfig } from "../lib/lifecycle-config";
import { LIFECYCLE_PHASES, type PhaseKey } from "../lib/lifecycle-phases";
import { formatDate } from "../lib/format";

type ProjectLite = {
  id: number;
  name: string;
  description?: string | null;
  stage?: string | null;
  status?: string | null;
  priority?: string | null;
  createdAt?: string | null;
  progress?: number | null;
};

export default function PipelinePage() {
  const { data: projects, isLoading } = useListProjects();
  const [activePhase, setActivePhase] = useState<PhaseKey | "all">("all");

  const stageBuckets = useMemo(() => {
    const map = new Map<string, ProjectLite[]>();
    for (const s of LIFECYCLE_STAGES) map.set(s.key, []);
    for (const p of (projects ?? []) as ProjectLite[]) {
      const key = p.stage ?? "project_case";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return map;
  }, [projects]);

  const visibleStages = useMemo(() => {
    if (activePhase === "all") return LIFECYCLE_STAGES;
    const phase = LIFECYCLE_PHASES.find((p) => p.key === activePhase)!;
    return LIFECYCLE_STAGES.filter((s) => (phase.stageKeys as readonly string[]).includes(s.key));
  }, [activePhase]);

  const totalProjects = (projects ?? []).length;
  const projectsInExecution = (projects ?? []).filter((p) => p.status === "active").length;

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="relative rounded-2xl overflow-hidden ph-rise glass-surface">
        <div className="absolute inset-0 ambient-mesh opacity-70 pointer-events-none" />
        <div className="relative flex items-start justify-between flex-wrap gap-4 p-6 lg:p-8">
          <div className="min-w-0">
            <p className="text-[10px] font-mono tracking-[0.22em] uppercase text-muted-foreground mb-2 flex items-center gap-2">
              <Workflow size={11} /> 16-Stage Lifecycle · Live Board
            </p>
            <h2 className="text-3xl lg:text-4xl font-bold tracking-tight text-card-foreground">
              Project Pipeline
            </h2>
            <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
              Every project across every stage — from <span className="font-mono text-card-foreground font-semibold">Project Case</span> to{" "}
              <span className="font-mono text-card-foreground font-semibold">Closure</span>.
              {" "}<span className="font-mono num-tabular text-card-foreground font-semibold">{totalProjects}</span> total ·
              {" "}<span className="font-mono num-tabular text-card-foreground font-semibold">{projectsInExecution}</span> in execution.
            </p>
          </div>
          <Link href="/demands/new">
            <button className="btn-glossy-cta flex items-center gap-2 px-4 h-9 rounded-md text-[13px] font-semibold">
              <Sparkles size={14} />
              <span>New Demand</span>
            </button>
          </Link>
        </div>
      </div>

      {/* Phase strip — funnel-style summary across the 5 phases */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <PhaseChip
          phaseKey="all"
          label="All Phases"
          shortLabel="ALL"
          color="#64748B"
          count={totalProjects}
          stageCount={LIFECYCLE_STAGES.length}
          active={activePhase === "all"}
          onClick={() => setActivePhase("all")}
        />
        {LIFECYCLE_PHASES.map((phase) => {
          const count = phase.stageKeys.reduce((sum, k) => sum + (stageBuckets.get(k)?.length ?? 0), 0);
          return (
            <PhaseChip
              key={phase.key}
              phaseKey={phase.key}
              label={phase.label}
              shortLabel={phase.shortLabel}
              color={phase.color}
              count={count}
              stageCount={phase.stageKeys.length}
              active={activePhase === phase.key}
              onClick={() => setActivePhase(phase.key)}
            />
          );
        })}
      </div>

      {/* Lifecycle funnel — compact heatmap of all 16 stages */}
      <div className="glass-surface rounded-2xl p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-card-foreground flex items-center gap-2">
              <Activity size={13} className="text-primary" /> Lifecycle Funnel
            </h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">Click any stage to scroll to it below</p>
          </div>
          <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{LIFECYCLE_STAGES.length} stages</p>
        </div>
        <div className="grid grid-cols-8 lg:grid-cols-16 gap-1.5">
          {LIFECYCLE_STAGES.map((s, idx) => {
            const count = stageBuckets.get(s.key)?.length ?? 0;
            const intensity = count === 0 ? 0.08 : Math.min(0.18 + count * 0.18, 0.85);
            return (
              <a key={s.key} href={`#stage-${s.key}`} title={`${s.label} · ${count}`}>
                <div
                  className="relative h-14 rounded-md border border-border flex flex-col items-center justify-center cursor-pointer hover:scale-[1.04] transition-transform"
                  style={{ background: `${s.color}${Math.round(intensity * 255).toString(16).padStart(2, "0")}` }}
                >
                  <span className="text-[9px] font-mono text-card-foreground/70 leading-none">{idx + 1}</span>
                  <span className="text-base font-mono font-semibold num-tabular text-card-foreground leading-tight">{count}</span>
                </div>
              </a>
            );
          })}
        </div>
      </div>

      {/* Kanban — horizontally scrollable columns, one per stage, grouped by phase */}
      {isLoading ? (
        <div className="flex gap-3 overflow-x-auto pb-3">
          {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="flex-shrink-0 w-72 h-96 rounded-2xl" />)}
        </div>
      ) : (
        LIFECYCLE_PHASES
          .filter((phase) => activePhase === "all" || phase.key === activePhase)
          .map((phase) => {
            const phaseStages = phase.stageKeys
              .map((k) => visibleStages.find((s) => s.key === k))
              .filter((s): s is typeof LIFECYCLE_STAGES[number] => Boolean(s));
            const phaseCount = phase.stageKeys.reduce((sum, k) => sum + (stageBuckets.get(k)?.length ?? 0), 0);
            return (
              <section key={phase.key} className="space-y-3">
                <div className="flex items-center gap-3">
                  <span className="w-3 h-3 rounded-full" style={{ background: phase.color }} />
                  <h3 className="text-base font-semibold text-card-foreground">{phase.label}</h3>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{phase.description}</span>
                  <span className="ml-auto text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                    {phaseCount} project{phaseCount === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="flex gap-3 overflow-x-auto pb-3 scrollbar-thin -mx-1 px-1">
                  {phaseStages.map((stage, idx) => (
                    <StageColumn
                      key={stage.key}
                      stage={stage}
                      globalIndex={LIFECYCLE_STAGES.findIndex((s) => s.key === stage.key) + 1}
                      phaseIndex={idx + 1}
                      phaseTotal={phaseStages.length}
                      projects={stageBuckets.get(stage.key) ?? []}
                    />
                  ))}
                </div>
              </section>
            );
          })
      )}
    </div>
  );
}

function PhaseChip({
  label, shortLabel, color, count, stageCount, active, onClick,
}: {
  phaseKey: PhaseKey | "all";
  label: string;
  shortLabel: string;
  color: string;
  count: number;
  stageCount: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-left rounded-2xl p-4 border transition-all ${
        active ? "border-foreground/30 shadow-sm" : "border-border hover:border-foreground/20"
      } glass-surface`}
      style={active ? { boxShadow: `inset 0 0 0 1px ${color}80` } : undefined}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{shortLabel}</span>
        </div>
        <span className="text-[10px] text-muted-foreground">{stageCount} stage{stageCount === 1 ? "" : "s"}</span>
      </div>
      <p className="text-2xl font-mono font-semibold text-card-foreground num-tabular">{count}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
    </button>
  );
}

function StageColumn({
  stage, globalIndex, phaseIndex, phaseTotal, projects,
}: {
  stage: typeof LIFECYCLE_STAGES[number];
  globalIndex: number;
  phaseIndex: number;
  phaseTotal: number;
  projects: ProjectLite[];
}) {
  return (
    <div
      id={`stage-${stage.key}`}
      className="flex-shrink-0 w-72 rounded-2xl border border-border bg-card flex flex-col overflow-hidden scroll-mt-24"
    >
      <div
        className="px-4 py-3 border-b border-border"
        style={{ background: `linear-gradient(135deg, ${stage.color}1F, transparent)` }}
      >
        <div className="flex items-center justify-between mb-1">
          <span
            className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded"
            style={{ background: `${stage.color}26`, color: stage.color }}
          >
            {stage.shortLabel}
          </span>
          <span className="text-[10px] font-mono text-muted-foreground">
            {phaseIndex}/{phaseTotal} · Stage {globalIndex}/{LIFECYCLE_STAGES.length}
          </span>
        </div>
        <h4 className="text-sm font-semibold text-card-foreground truncate">{stage.label}</h4>
        <div className="flex items-center justify-between mt-1.5">
          <p className="text-[10px] text-muted-foreground line-clamp-1">{stage.description}</p>
          <span className="ml-2 text-[10px] font-mono font-semibold text-card-foreground bg-muted px-1.5 py-0.5 rounded-full flex-shrink-0">
            {projects.length}
          </span>
        </div>
      </div>
      <div className="flex-1 p-3 space-y-2 max-h-[480px] overflow-y-auto scrollbar-thin">
        {projects.length === 0 ? (
          <div className="text-center py-8 text-[11px] text-muted-foreground italic">
            No projects in this stage
          </div>
        ) : (
          projects.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}?stage=${stage.key}`}>
              <div className="rounded-lg border border-border bg-muted/30 p-3 cursor-pointer hover:border-foreground/30 hover:bg-muted/60 transition-colors">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <p className="text-sm font-semibold text-card-foreground truncate flex-1">{p.name}</p>
                  <ArrowUpRight size={12} className="text-muted-foreground/60 flex-shrink-0 mt-0.5" />
                </div>
                {p.description && <p className="text-[11px] text-muted-foreground line-clamp-2 mb-1.5">{p.description}</p>}
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono">
                  {p.priority && <span className="flex items-center gap-1"><Layers size={9} />{p.priority.replace(/_/g, " ")}</span>}
                  {p.createdAt && <span>· {formatDate(p.createdAt)}</span>}
                  {typeof p.progress === "number" && p.progress > 0 && (
                    <span className="ml-auto font-semibold text-card-foreground">{Math.round(p.progress)}%</span>
                  )}
                </div>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
