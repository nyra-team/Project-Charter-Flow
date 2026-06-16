import { useListProjects } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles, ArrowUpRight, Clock, Layers, AlertCircle } from "lucide-react";
import { getStageConfig } from "../lib/lifecycle-config";
import { formatDate } from "../lib/format";
import { Drillable } from "../components/dashboard/primitives";

const DEMAND_STAGES = ["initiation", "vendor_selection"] as const;

export default function DemandsList() {
  const { data: projects, isLoading } = useListProjects();

  const demands = (projects ?? []).filter(
    (p) => DEMAND_STAGES.includes((p.stage ?? "initiation") as typeof DEMAND_STAGES[number]),
  );

  const byStage = DEMAND_STAGES.map((key, idx) => ({
    key,
    idx,
    cfg: getStageConfig(key)!,
    items: demands.filter((d) => (d.stage ?? "initiation") === key),
  }));

  return (
    <div className="space-y-6">
      <div className="relative rounded-2xl overflow-hidden ph-rise glass-surface">
        <div className="absolute inset-0 ambient-mesh opacity-70 pointer-events-none" />
        <div className="relative flex items-start justify-between flex-wrap gap-4 p-6 lg:p-8">
          <div className="min-w-0">
            <p className="text-[10px] font-mono tracking-[0.22em] uppercase text-muted-foreground mb-2">
              Pre-Charter Pipeline · Stages 1–4
            </p>
            <h2 className="text-3xl lg:text-4xl font-bold tracking-tight text-card-foreground">
              Active Demands
            </h2>
            <p className="text-sm text-muted-foreground mt-2 max-w-xl">
              All initiatives in <span className="font-mono text-card-foreground font-semibold">Business Case</span>,{" "}
              <span className="font-mono text-card-foreground font-semibold">Requirements</span>,{" "}
              <span className="font-mono text-card-foreground font-semibold">RFP</span>, or{" "}
              <span className="font-mono text-card-foreground font-semibold">Vendor Evaluation</span> —
              before a Charter is approved.
            </p>
          </div>
          <Link href="/demands/new">
            <button className="btn-glossy-cta flex items-center gap-2 px-4 h-9 rounded-md text-[13px] font-semibold">
              <Sparkles size={14} />
              <span>Business Case</span>
            </button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {byStage.map(({ key, idx, cfg, items }) => (
          <Drillable
            key={key}
            className="glass-surface rounded-2xl p-4"
            drill={{
              title: cfg.label,
              subtitle: `Demands at the ${cfg.shortLabel} stage`,
              columns: [
                { key: "name", label: "Demand" },
                { key: "priority", label: "Priority" },
                { key: "created", label: "Created" },
              ],
              rows: items.map((p) => ({ name: p.name, priority: p.priority?.replace(/_/g, " ") ?? "—", created: p.createdAt ? formatDate(p.createdAt) : "—" })),
              linkHref: "/demands",
              linkLabel: "View all demands",
              emptyText: "No demands at this stage.",
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: cfg.color }} />
                <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">{cfg.shortLabel}</p>
              </div>
              <span className="text-[10px] text-muted-foreground">Stage {idx + 1}/4</span>
            </div>
            <p className="text-2xl font-mono font-semibold text-card-foreground num-tabular">{items.length}</p>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{cfg.label}</p>
          </Drillable>
        ))}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-48 rounded-2xl" />)}
        </div>
      ) : demands.length === 0 ? (
        <div className="glass-surface rounded-2xl p-12 text-center">
          <AlertCircle size={28} className="mx-auto text-muted-foreground mb-3" />
          <p className="text-base font-semibold text-card-foreground">No active demands yet</p>
          <p className="text-sm text-muted-foreground mt-1 mb-4">
            Start your governance lifecycle by initiating the first business case.
          </p>
          <Link href="/demands/new">
            <button className="btn-glossy-cta inline-flex items-center gap-2 px-4 h-9 rounded-md text-[13px] font-semibold">
              <Sparkles size={14} /> Create First Demand
            </button>
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          {byStage.filter((g) => g.items.length > 0).map(({ key, cfg, items }: typeof byStage[number]) => (
            <div key={key}>
              <div className="flex items-center gap-2 mb-3">
                <span className="w-3 h-3 rounded-full" style={{ background: cfg.color }} />
                <h3 className="text-sm font-semibold text-card-foreground">{cfg.label}</h3>
                <span className="text-[10px] font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{items.length}</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {items.map((p) => (
                  <Link key={p.id} href={`/projects/${p.id}?stage=${p.stage ?? "initiation"}`}>
                    <div className="glass-surface lift-card rounded-2xl p-5 cursor-pointer h-full flex flex-col">
                      <div className="flex items-start justify-between mb-3">
                        <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full"
                          style={{ background: `${cfg.color}1A`, color: cfg.color }}>
                          {cfg.shortLabel}
                        </span>
                        <ArrowUpRight size={15} className="text-muted-foreground/50" />
                      </div>
                      <h4 className="text-base font-semibold text-card-foreground truncate">{p.name}</h4>
                      {p.description && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{p.description}</p>
                      )}
                      <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-auto pt-3 font-mono">
                        <span className="flex items-center gap-1"><Layers size={10} /> {p.priority?.replace(/_/g, " ") ?? "—"}</span>
                        <span className="flex items-center gap-1"><Clock size={10} /> {p.createdAt ? formatDate(p.createdAt) : "—"}</span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
