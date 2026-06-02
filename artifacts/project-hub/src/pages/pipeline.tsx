import { useListProjects } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sparkles, ArrowUpRight, ChevronDown, Workflow,
  FolderKanban, Ban, Clock, Stamp,
} from "lucide-react";
import { useMemo, useState } from "react";
import { LIFECYCLE_STAGES, getStageConfig } from "../lib/lifecycle-config";
import { LIFECYCLE_PHASES, type PhaseKey } from "../lib/lifecycle-phases";
import { PageHeader } from "@/components/ui-kit";
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

type PhaseRollup = { phaseKey: string; projects: number; blocked: number; overdue: number; activeApprovals: number };
type PortfolioCP = { byPhase?: PhaseRollup[] };
type SubgateAgg = { inInitiation: number; bcDone: number; ursDone: number };

// A "gate" inside a phase — the user-facing decision points. Every stage
// in every phase exposes itself as a single gate; labels are the full
// stage names (no abbreviations) per the 2026-06-02 naming pass.
type Gate = { id: string; label: string; shortLabel: string; stageKey: string; color: string };

function gatesForPhase(phaseKey: PhaseKey): Gate[] {
  const phase = LIFECYCLE_PHASES.find((p) => p.key === phaseKey)!;
  return phase.stageKeys.map((k) => {
    const s = getStageConfig(k)!;
    return { id: k, label: s.label, shortLabel: s.shortLabel, stageKey: k, color: s.color };
  });
}

export default function PipelinePage() {
  const { data: projects, isLoading } = useListProjects();
  const { data: portfolio } = useQuery<PortfolioCP>({
    queryKey: ["/api/dashboard/critical-path-portfolio"],
    queryFn: async () => { const r = await fetch("/api/dashboard/critical-path-portfolio"); if (!r.ok) throw new Error("Failed"); return r.json(); },
  });
  const { data: subgates } = useQuery<SubgateAgg>({
    queryKey: ["/api/dashboard/initiation-subgates"],
    queryFn: async () => { const r = await fetch("/api/dashboard/initiation-subgates"); if (!r.ok) throw new Error("Failed"); return r.json(); },
  });

  // Default: every phase expanded that has a blocked/overdue project, else collapsed.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggle = (k: string) => setExpanded((e) => ({ ...e, [k]: !e[k] }));

  const stageBuckets = useMemo(() => {
    const map = new Map<string, ProjectLite[]>();
    for (const s of LIFECYCLE_STAGES) map.set(s.key, []);
    for (const p of (projects ?? []) as ProjectLite[]) {
      const key = p.stage ?? "initiation";
      if (map.has(key)) map.get(key)!.push(p);
    }
    return map;
  }, [projects]);

  const phaseRollup = useMemo(() => {
    const m = new Map<string, PhaseRollup>();
    for (const r of portfolio?.byPhase ?? []) m.set(r.phaseKey, r);
    return m;
  }, [portfolio]);

  const totalProjects = (projects ?? []).length;
  const totalBlocked = (portfolio?.byPhase ?? []).reduce((s, p) => s + p.blocked, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Project Pipeline"
        subtitle={`${totalProjects} projects across 4 phases · ${totalBlocked} blocked`}
        icon={Workflow}
        actions={
          <Link href="/demands/new">
            <button className="btn-glossy-cta flex items-center gap-2 px-4 h-9 rounded-md text-[13px] font-semibold">
              <Sparkles size={14} /><span>New Demand</span>
            </button>
          </Link>
        }
      />

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 w-full rounded-2xl" />)}
        </div>
      ) : (
        <div className="space-y-4 stagger-children">
          {LIFECYCLE_PHASES.map((phase, idx) => {
            const roll = phaseRollup.get(phase.key);
            // Project count = projects sitting in any of this phase's stages.
            const projectCount = phase.stageKeys.reduce((sum, k) => sum + (stageBuckets.get(k)?.length ?? 0), 0);
            const blocked = roll?.blocked ?? 0;
            const overdue = roll?.overdue ?? 0;
            const approvals = roll?.activeApprovals ?? 0;
            const isOpen = expanded[phase.key] ?? false;
            return (
              <PhaseLane
                key={phase.key}
                index={idx + 1}
                phase={phase}
                projectCount={projectCount}
                blocked={blocked}
                overdue={overdue}
                approvals={approvals}
                open={isOpen}
                onToggle={() => toggle(phase.key)}
                stageBuckets={stageBuckets}
                subgates={subgates}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Phase lane (collapsed = summary + 4 counts; expanded = gate cards) ───────

function PhaseLane({
  index, phase, projectCount, blocked, overdue, approvals, open, onToggle, stageBuckets, subgates,
}: {
  index: number;
  phase: typeof LIFECYCLE_PHASES[number];
  projectCount: number;
  blocked: number;
  overdue: number;
  approvals: number;
  open: boolean;
  onToggle: () => void;
  stageBuckets: Map<string, ProjectLite[]>;
  subgates?: SubgateAgg;
}) {
  const gates = gatesForPhase(phase.key);
  return (
    <section className="rounded-2xl bg-card border border-card-border glass-surface overflow-hidden">
      {/* Header — clickable, shows the 4 phase metrics */}
      <button
        onClick={onToggle}
        className="w-full text-left flex items-center gap-4 px-5 py-4 hover:bg-accent/40 transition-colors"
      >
        <span className="w-1.5 self-stretch rounded-full flex-shrink-0" style={{ background: phase.color }} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: `${phase.color}26`, color: phase.color }}>
              Phase {index}
            </span>
            <h3 className="text-base font-semibold text-card-foreground truncate">{phase.label}</h3>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{phase.description}</p>
        </div>

        <div className="hidden sm:flex items-center gap-2 flex-shrink-0">
          <LaneStat icon={FolderKanban} label="Projects" value={projectCount} tone="muted" />
          <LaneStat icon={Ban} label="Blocked" value={blocked} tone="danger" dim={blocked === 0} />
          <LaneStat icon={Clock} label="Overdue" value={overdue} tone="warn" dim={overdue === 0} />
          <LaneStat icon={Stamp} label="Approvals" value={approvals} tone="primary" dim={approvals === 0} />
        </div>

        <ChevronDown size={18} className={`text-muted-foreground flex-shrink-0 transition-transform duration-300 ${open ? "rotate-180" : ""}`} />
      </button>

      {/* Mobile metrics row */}
      <div className="sm:hidden flex items-center gap-2 px-5 pb-3 flex-wrap">
        <LaneStat icon={FolderKanban} label="Projects" value={projectCount} tone="muted" />
        <LaneStat icon={Ban} label="Blocked" value={blocked} tone="danger" dim={blocked === 0} />
        <LaneStat icon={Clock} label="Overdue" value={overdue} tone="warn" dim={overdue === 0} />
        <LaneStat icon={Stamp} label="Approvals" value={approvals} tone="primary" dim={approvals === 0} />
      </div>

      {/* Expanded — gate cards */}
      {open && (
        <div className="border-t border-border/60 p-4 bg-muted/20">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {gates.map((gate) => (
              <GateCard
                key={gate.id}
                gate={gate}
                projects={stageBuckets.get(gate.stageKey) ?? []}
                approvedNote={
                  gate.id === "business_case" && subgates ? `${subgates.bcDone}/${subgates.inInitiation} approved`
                  : gate.id === "urs" && subgates ? `${subgates.ursDone}/${subgates.inInitiation} approved`
                  : undefined
                }
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function LaneStat({
  icon: Icon, label, value, tone, dim,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: number;
  tone: "muted" | "danger" | "warn" | "primary";
  dim?: boolean;
}) {
  const toneText =
    dim ? "text-muted-foreground/50"
    : tone === "danger" ? "text-destructive"
    : tone === "warn" ? "text-warn"
    : tone === "primary" ? "text-primary"
    : "text-foreground";
  const toneBg =
    dim ? "bg-muted/40"
    : tone === "danger" ? "bg-destructive/10"
    : tone === "warn" ? "bg-warn/10"
    : tone === "primary" ? "bg-primary/10"
    : "bg-muted";
  return (
    <div className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 ${toneBg}`} title={label}>
      <Icon size={13} className={toneText} />
      <span className={`text-sm font-semibold font-mono num-tabular ${toneText}`}>{value}</span>
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground hidden lg:inline">{label}</span>
    </div>
  );
}

function GateCard({ gate, projects, approvedNote }: { gate: Gate; projects: ProjectLite[]; approvedNote?: string }) {
  return (
    <div className="rounded-xl bg-card border border-border/70 overflow-hidden flex flex-col">
      <div className="px-3.5 py-2.5 flex items-center justify-between gap-2" style={{ background: `linear-gradient(135deg, ${gate.color}14, transparent)` }}>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: `${gate.color}26`, color: gate.color }}>
            {gate.shortLabel}
          </span>
          <h4 className="text-sm font-semibold text-card-foreground truncate">{gate.label}</h4>
        </div>
        <span className="text-[11px] font-semibold text-card-foreground bg-muted px-1.5 py-0.5 rounded-full flex-shrink-0">{projects.length}</span>
      </div>
      {approvedNote && (
        <p className="px-3.5 pt-2 text-[10px] uppercase tracking-wider text-success font-medium">{approvedNote}</p>
      )}
      <div className="p-2.5 space-y-1.5 flex-1 max-h-72 overflow-y-auto scrollbar-thin">
        {projects.length === 0 ? (
          <div className="text-center py-6 text-[11px] text-muted-foreground/70 italic">No projects here</div>
        ) : (
          projects.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}?stage=${gate.stageKey}`}>
              <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 cursor-pointer hover:border-foreground/30 hover:bg-muted/60 transition-colors group">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[13px] font-medium text-card-foreground truncate flex-1">{p.name}</p>
                  <ArrowUpRight size={12} className="text-muted-foreground/50 group-hover:text-foreground flex-shrink-0 mt-0.5" />
                </div>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                  {p.priority && <span className="capitalize">{p.priority.replace(/_/g, " ")}</span>}
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
