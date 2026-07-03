import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useListProjects, useListUsers, useListCharters } from "@workspace/api-client-react";
import { StatusChip } from "@/components/ui-kit";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Search, Users, FolderOpen, Layers, UserCheck, AlertCircle, ChevronDown } from "lucide-react";
import { projectCode } from "./projects";

// Resource Management — group every project under its OWNER (charter.projectOwnerId,
// resolved via project.charterId), so you can see who owns how many / which projects.
// Pure client-side rollup over existing hooks; no backend change. ponytail: this exists.

type ProjectRow = { id: number; name: string; status: string; charterId?: number | null; jiraKey?: string | null };

type OwnerGroup = { key: number | "none"; name: string; photoUrl?: string | null; projects: ProjectRow[] };

function StatTile({ icon: Icon, label, value, accent }: { icon: typeof Users; label: string; value: number; accent: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2">
      <div className={`h-7 w-7 rounded-md grid place-items-center ${accent}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <div className="text-lg font-bold leading-none text-foreground">{value}</div>
        <div className="text-[11px] text-muted-foreground mt-0.5">{label}</div>
      </div>
    </div>
  );
}

export default function ResourceManagement() {
  const { data: projects, isLoading } = useListProjects();
  const { data: users = [] } = useListUsers();
  const { data: charters = [] } = useListCharters();
  const [q, setQ] = useState("");

  const usersById = useMemo(() => {
    const m = new Map<number, { name: string; photoUrl?: string | null }>();
    for (const u of users) m.set(u.id, { name: u.name, photoUrl: (u as Record<string, unknown>).photoUrl as string | null });
    return m;
  }, [users]);

  // charterId -> projectOwnerId
  const ownerByCharter = useMemo(() => {
    const m = new Map<number, number | null>();
    for (const c of charters as Array<{ id: number; projectOwnerId?: number | null }>) m.set(c.id, c.projectOwnerId ?? null);
    return m;
  }, [charters]);

  // Group projects by owner id (null = Unassigned).
  const realOwners = useMemo<OwnerGroup[]>(() => {
    const groups = new Map<number | "none", ProjectRow[]>();
    for (const p of (projects ?? []) as ProjectRow[]) {
      const oid = p.charterId != null ? ownerByCharter.get(p.charterId) ?? null : null;
      const key = oid ?? "none";
      const arr = groups.get(key) ?? [];
      arr.push(p);
      groups.set(key, arr);
    }
    return Array.from(groups.entries())
      .map(([key, projs]) => ({
        key,
        name: key === "none" ? "Unassigned" : usersById.get(key)?.name ?? `User #${key}`,
        photoUrl: key === "none" ? null : usersById.get(key)?.photoUrl ?? null,
        projects: projs.sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => (a.key === "none" ? 1 : b.key === "none" ? -1 : b.projects.length - a.projects.length));
  }, [projects, ownerByCharter, usersById]);

  const owners = realOwners;

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return owners;
    return owners
      .map((o) => ({ ...o, projects: o.name.toLowerCase().includes(t) ? o.projects : o.projects.filter((p) => p.name.toLowerCase().includes(t)) }))
      .filter((o) => o.name.toLowerCase().includes(t) || o.projects.length > 0);
  }, [owners, q]);

  const totalOwners = owners.filter((o) => o.key !== "none").length;
  const unassigned = owners.find((o) => o.key === "none")?.projects.length ?? 0;
  const totalProjects = owners.reduce((n, o) => n + o.projects.length, 0);
  const avg = totalOwners ? Math.round((totalProjects - unassigned) / totalOwners) : 0;

  return (
    <div className="-mx-4 sm:-mx-6 lg:-mx-8 -mt-3 -mb-6 lg:-mb-8 min-h-full bg-muted/30">
      {/* Header band — full bleed gradient */}
      <div className="border-b border-border">
        <div className="px-6 lg:px-10 py-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                <Users className="h-3 w-3" /> Resource Management
              </div>
              <h1 data-tour="res-title" className="text-xl font-bold text-foreground mt-0.5 flex items-center gap-2">
                Project Owners
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Who owns what — every project grouped by its accountable owner.
              </p>
            </div>
            <div className="relative w-60">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input className="pl-8 h-8 text-sm bg-card" placeholder="Search owner or project…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>

          {/* Stat strip */}
          <div data-tour="res-stats" className="grid grid-cols-2 lg:grid-cols-4 gap-2 mt-4">
            <StatTile icon={UserCheck} label="Owners" value={totalOwners} accent="bg-primary/10 text-primary" />
            <StatTile icon={Layers} label="Projects" value={totalProjects} accent="bg-blue-500/10 text-blue-600" />
            <StatTile icon={FolderOpen} label="Avg per owner" value={avg} accent="bg-emerald-500/10 text-emerald-600" />
            <StatTile icon={AlertCircle} label="Unassigned" value={unassigned} accent="bg-amber-500/10 text-amber-600" />
          </div>
        </div>
      </div>

      {/* Owner accordions — full-width rows stacked vertically */}
      <div className="px-6 lg:px-10 py-6">
        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-muted-foreground py-24">No matching owners or projects.</div>
        ) : (
          <div className="divide-y divide-border rounded-xl border border-border bg-card overflow-hidden">
            {filtered.map((o) => (
              <details key={String(o.key)} className="group">
                {/* Accordion header — full width, toggle on the left */}
                <summary className="flex items-center gap-3 px-4 py-3 cursor-pointer list-none select-none">
                  <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0 transition-transform group-open:rotate-180" />
                  {o.photoUrl ? (
                    <img src={o.photoUrl} alt="" className="h-8 w-8 rounded-full object-cover ring-2 ring-card shrink-0" />
                  ) : (
                    <div className={`h-8 w-8 rounded-full grid place-items-center text-sm font-semibold shrink-0 ${o.key === "none" ? "text-amber-600" : "text-primary"}`}>
                      {o.name.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <span className="text-sm font-semibold text-foreground truncate flex-1">{o.name}</span>
                  <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">{o.projects.length} project{o.projects.length === 1 ? "" : "s"}</span>
                </summary>
                {/* Project list */}
                <ul className="px-4 pb-3 pt-1 space-y-0.5 border-t border-border">
                  {o.projects.map((p) => (
                    <li key={p.id}>
                      <Link href={`/projects/${p.id}`} className="flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors group/row">
                        <span className="text-[10px] font-mono text-muted-foreground shrink-0 w-16 truncate">{projectCode(p)}</span>
                        <span className="text-sm text-foreground truncate flex-1 group-hover/row:text-primary">{p.name}</span>
                        <StatusChip status={p.status} size="sm" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
