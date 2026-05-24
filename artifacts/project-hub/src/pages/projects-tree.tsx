// Project Level View — Portfolio → Program → Project hierarchical drill-down (FR-24).
// Worst-case RAG roll-up at every level. Search + Person filter at the top.

import { useState, useMemo } from "react";
import { Link } from "wouter";
import {
  useListProjects, useListPortfolios, useListPrograms, useListUsers,
} from "@workspace/api-client-react";
import { Search, Users, ChevronRight, ChevronDown, FolderTree, Layers, Briefcase, ArrowUpRight } from "lucide-react";
import { aggregateRag, getRagColor } from "../lib/task-constants";
import { PersonAvatar } from "../components/person-avatar";
import { formatCurrency } from "../lib/format";

type Project = {
  id: number; name: string; status: string; priority?: string | null;
  ragStatus?: string | null; portfolioId?: number | null; programId?: number | null;
  projectManagerId?: number | null; capexBudget?: number | null; opexBudget?: number | null;
  progress?: number | null; endDate?: string | null;
};

function RagBadge({ rag }: { rag: "red" | "amber" | "green" }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-full"
      style={{ background: `${getRagColor(rag)}22`, color: getRagColor(rag), border: `1px solid ${getRagColor(rag)}55` }}>
      <span className="w-2 h-2 rounded-full" style={{ background: getRagColor(rag) }} />
      {rag.toUpperCase()}
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  const palette: Record<string, string> = {
    active: "#28A745", planning: "#6F42C1", completed: "#007BFF",
    on_hold: "#FFC107", closed: "#808080",
  };
  const c = palette[status] ?? "#808080";
  return (
    <span className="text-xs font-medium px-2 py-0.5 rounded-full capitalize"
      style={{ background: c, color: "#FFFFFF" }}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

export default function ProjectsTreeView() {
  const { data: projects = [], isLoading: lp } = useListProjects();
  const { data: portfolios = [], isLoading: lpf } = useListPortfolios();
  const { data: programs = [], isLoading: lpr } = useListPrograms();
  const { data: users = [] } = useListUsers();

  const [search, setSearch] = useState("");
  const [personFilter, setPersonFilter] = useState<number | "all">("all");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["portfolio-_unassigned"]));

  function toggle(k: string) {
    setExpanded(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });
  }

  // Filter projects by search + person
  const filteredProjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (projects as Project[]).filter(p => {
      if (q && !p.name.toLowerCase().includes(q)) return false;
      if (personFilter !== "all" && p.projectManagerId !== personFilter) return false;
      return true;
    });
  }, [projects, search, personFilter]);

  // Build hierarchy: portfolio -> program -> projects
  const tree = useMemo(() => {
    const byPortfolio: Record<string, {
      portfolio: { id: number | null; name: string };
      programs: Record<string, {
        program: { id: number | null; name: string };
        projects: Project[];
      }>;
    }> = {};

    const ensure = (pId: number | null, pName: string, prgId: number | null, prgName: string) => {
      const pk = String(pId ?? "_none");
      if (!byPortfolio[pk]) byPortfolio[pk] = { portfolio: { id: pId, name: pName }, programs: {} };
      const prk = String(prgId ?? "_none");
      if (!byPortfolio[pk].programs[prk]) byPortfolio[pk].programs[prk] = { program: { id: prgId, name: prgName }, projects: [] };
      return byPortfolio[pk].programs[prk];
    };

    for (const proj of filteredProjects) {
      const portfolio = portfolios.find(p => p.id === proj.portfolioId);
      const program = programs.find(p => p.id === proj.programId);
      const bucket = ensure(
        portfolio?.id ?? null,
        portfolio?.name ?? "Unassigned Portfolio",
        program?.id ?? null,
        program?.name ?? "Direct Projects",
      );
      bucket.projects.push(proj);
    }

    return Object.values(byPortfolio).map(p => ({
      ...p,
      programs: Object.values(p.programs),
    }));
  }, [filteredProjects, portfolios, programs]);

  const isLoading = lp || lpf || lpr;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
            <FolderTree size={22} className="text-primary" />
            Project Level View
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Portfolio → Program → Project drill-down with aggregated RAG roll-up (FR-24)
          </p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg border border-border bg-background">
          <Search size={13} className="text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search projects…"
            className="text-xs bg-transparent outline-none w-52 text-foreground placeholder:text-muted-foreground/60"
          />
        </div>
        <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg border border-border bg-background">
          <Users size={13} className="text-muted-foreground" />
          <select
            value={String(personFilter)}
            onChange={e => setPersonFilter(e.target.value === "all" ? "all" : Number(e.target.value))}
            className="text-xs bg-transparent outline-none text-foreground cursor-pointer"
          >
            <option value="all">All owners</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
        <button
          onClick={() => {
            const all = new Set<string>();
            tree.forEach(p => {
              all.add(`portfolio-${p.portfolio.id ?? "_none"}`);
              p.programs.forEach(pr => all.add(`program-${p.portfolio.id ?? "_none"}-${pr.program.id ?? "_none"}`));
            });
            setExpanded(all);
          }}
          className="text-xs px-2 py-1.5 rounded-lg border border-border bg-background hover:bg-accent/40 text-foreground"
        >
          Expand all
        </button>
        <button
          onClick={() => setExpanded(new Set())}
          className="text-xs px-2 py-1.5 rounded-lg border border-border bg-background hover:bg-accent/40 text-foreground"
        >
          Collapse all
        </button>
        <span className="text-xs text-muted-foreground ml-auto">
          {filteredProjects.length} project{filteredProjects.length !== 1 ? "s" : ""} across {tree.length} portfolio{tree.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Tree */}
      <div className="glass-surface rounded-2xl p-4 space-y-2">
        {isLoading ? (
          <div className="text-center py-10 text-muted-foreground text-sm">Loading hierarchy…</div>
        ) : tree.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground text-sm">No projects match the current filters.</div>
        ) : tree.map(pBucket => {
          const portfolioKey = `portfolio-${pBucket.portfolio.id ?? "_none"}`;
          const pOpen = expanded.has(portfolioKey);
          const allProjects = pBucket.programs.flatMap(prg => prg.projects);
          const portfolioRag = aggregateRag(allProjects.map(p => (p.ragStatus as "red" | "amber" | "green" | null) ?? "green"));
          const portfolioBudget = allProjects.reduce((s, p) => s + ((p.capexBudget ?? 0) + (p.opexBudget ?? 0)), 0);

          return (
            <div key={portfolioKey} className="border border-border/60 rounded-xl overflow-hidden bg-background/50">
              {/* Portfolio header */}
              <button
                onClick={() => toggle(portfolioKey)}
                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-accent/30 transition-colors text-left"
              >
                {pOpen ? <ChevronDown size={16} className="text-primary" /> : <ChevronRight size={16} className="text-primary" />}
                <Briefcase size={16} className="text-primary" />
                <span className="font-bold text-sm text-foreground">{pBucket.portfolio.name}</span>
                <span className="text-xs text-muted-foreground">
                  {pBucket.programs.length} program{pBucket.programs.length !== 1 ? "s" : ""} · {allProjects.length} project{allProjects.length !== 1 ? "s" : ""}
                </span>
                <span className="ml-auto flex items-center gap-2">
                  <span className="text-xs text-muted-foreground tabular-nums">{formatCurrency(portfolioBudget)}</span>
                  <RagBadge rag={portfolioRag} />
                </span>
              </button>

              {/* Programs */}
              {pOpen && (
                <div className="border-t border-border/40 bg-muted/20">
                  {pBucket.programs.map(prgBucket => {
                    const programKey = `program-${pBucket.portfolio.id ?? "_none"}-${prgBucket.program.id ?? "_none"}`;
                    const prgOpen = expanded.has(programKey);
                    const prgRag = aggregateRag(prgBucket.projects.map(p => (p.ragStatus as "red" | "amber" | "green" | null) ?? "green"));
                    const prgBudget = prgBucket.projects.reduce((s, p) => s + ((p.capexBudget ?? 0) + (p.opexBudget ?? 0)), 0);

                    return (
                      <div key={programKey} className="border-b border-border/30 last:border-0">
                        <button
                          onClick={() => toggle(programKey)}
                          className="w-full flex items-center gap-3 px-3 py-2 pl-8 hover:bg-accent/20 transition-colors text-left"
                        >
                          {prgOpen ? <ChevronDown size={14} className="text-muted-foreground" /> : <ChevronRight size={14} className="text-muted-foreground" />}
                          <Layers size={14} className="text-muted-foreground" />
                          <span className="font-semibold text-xs text-foreground">{prgBucket.program.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {prgBucket.projects.length} project{prgBucket.projects.length !== 1 ? "s" : ""}
                          </span>
                          <span className="ml-auto flex items-center gap-2">
                            <span className="text-xs text-muted-foreground tabular-nums">{formatCurrency(prgBudget)}</span>
                            <RagBadge rag={prgRag} />
                          </span>
                        </button>

                        {/* Projects */}
                        {prgOpen && (
                          <div className="pl-14 pr-3 pb-2 space-y-1">
                            {prgBucket.projects.length === 0 ? (
                              <div className="text-xs text-muted-foreground/60 italic py-2">No projects in this program.</div>
                            ) : prgBucket.projects.map(proj => {
                              const owner = users.find(u => u.id === proj.projectManagerId);
                              const budget = (proj.capexBudget ?? 0) + (proj.opexBudget ?? 0);
                              return (
                                <Link key={proj.id} href={`/projects/${proj.id}`}>
                                  <div className="flex items-center gap-3 px-3 py-2 rounded-lg border border-border/40 bg-background hover:border-primary/40 hover:bg-primary/5 cursor-pointer transition-colors group">
                                    <span className="font-medium text-sm text-foreground truncate flex-1 min-w-0" title={proj.name}>
                                      {proj.name}
                                    </span>
                                    <StatusPill status={proj.status} />
                                    {proj.priority && (
                                      <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                                        proj.priority === "P1" ? "bg-destructive/10 text-destructive border border-destructive/20"
                                        : proj.priority === "P2" ? "bg-warn/10 text-warn border border-warn/20"
                                        : "bg-muted text-muted-foreground border border-border"
                                      }`}>{proj.priority}</span>
                                    )}
                                    {owner && <PersonAvatar id={owner.id} name={owner.name} size={22} />}
                                    <div className="flex items-center gap-1.5 min-w-[110px]">
                                      <div className="flex-1 h-1.5 bg-muted/60 rounded-full overflow-hidden">
                                        <div className="h-full rounded-full bg-primary" style={{ width: `${proj.progress ?? 0}%` }} />
                                      </div>
                                      <span className="text-xs font-semibold text-foreground tabular-nums w-8">{proj.progress ?? 0}%</span>
                                    </div>
                                    <span className="text-xs text-muted-foreground tabular-nums w-20 text-right">{formatCurrency(budget)}</span>
                                    <RagBadge rag={(proj.ragStatus as "red" | "amber" | "green" | null) ?? "green"} />
                                    <ArrowUpRight size={14} className="text-muted-foreground group-hover:text-primary transition-colors" />
                                  </div>
                                </Link>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
