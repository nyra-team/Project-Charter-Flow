import { Fragment, useEffect, useMemo, useState } from "react";
import { useListProjects } from "@workspace/api-client-react";
import { DocumentsTab } from "../components/documents-tab";
import { DocumentsBrowseTree } from "../components/documents-browse-tree";
import { ProjectTemplatesTable, TEMPLATE_TYPES, TYPE_COLOR, projectTemplateType } from "../components/project-templates";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";
import { FileText, FilePlus2, ChevronDown, ChevronRight, Upload, Download, FileCheck2, Folder, ListTree } from "lucide-react";
import { formatDate } from "../lib/format";
import { LIFECYCLE_STAGES, canonicalStageKey, templateDocRank } from "../lib/lifecycle-config";
import { LIFECYCLE_PHASES } from "../lib/lifecycle-phases";

type Project = { id: number; name: string; status: string; stage?: string | null };

type CentralDoc = {
  id: number; projectId: number; projectName: string | null; name: string;
  stage?: string | null; fileUrl?: string | null; fileType?: string | null;
  version: number; uploadedAt?: string | null; accessLevel: string; tags: string[];
};

// Top-level sub-section of the Document Repository.
type Section = "browse" | "templates" | "project-documents";

// Sentinel for the project picker's "show every project's documents" option.
const ALL_PROJECTS = -1;

export default function DocumentsPage() {
  const { data: projects = [] } = useListProjects();
  const projectsArr = projects as Project[];
  const [section, setSection] = useState<Section>("browse");

  const sorted = useMemo(
    () => [...projectsArr].sort((a, b) => a.name.localeCompare(b.name)),
    [projectsArr]
  );

  // Which project's documents to show. Defaults to "All Projects" so the page
  // opens as a true central repo, not stuck on the first project.
  const [selectedId, setSelectedId] = useState<number>(ALL_PROJECTS);
  useEffect(() => {
    // Keep the selection valid if a specific project disappears.
    if (selectedId !== ALL_PROJECTS && !sorted.some(p => p.id === selectedId)) {
      setSelectedId(ALL_PROJECTS);
    }
  }, [sorted, selectedId]);

  // Cross-project document feed for the "All Projects" central view.
  const [centralDocs, setCentralDocs] = useState<CentralDoc[]>([]);
  useEffect(() => {
    if (section !== "project-documents" || selectedId !== ALL_PROJECTS) return;
    fetch("/api/documents")
      .then(r => (r.ok ? r.json() : []))
      .then((d: CentralDoc[]) => setCentralDocs(Array.isArray(d) ? d : []))
      .catch(() => setCentralDocs([]));
  }, [section, selectedId]);

  // Upload modal is owned here so the page-header button can trigger it inside DocumentsTab.
  const [uploadOpen, setUploadOpen] = useState(false);

  const showUploadButton = section === "project-documents" && selectedId !== ALL_PROJECTS;

  return (
    <div className="space-y-5">
      <div className="glass-surface lift-card rounded-2xl ph-rise overflow-hidden">
        <div className="px-4 pt-3">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md flex items-center justify-center bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 flex-shrink-0">
              <FileText size={13} className="text-primary" />
            </div>
            <div className="min-w-0 flex-1 flex items-baseline gap-2">
              <h1 data-tour="doc-title" className="text-base font-bold text-foreground tracking-tight whitespace-nowrap">Central Document Repository</h1>
            </div>
            {section === "project-documents" && (
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Project</span>
                <select
                  value={selectedId}
                  onChange={e => setSelectedId(Number(e.target.value))}
                  className="text-xs border border-input bg-background rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-ring/40 max-w-[200px]"
                >
                  <option value={ALL_PROJECTS}>All Projects (central feed)</option>
                  {sorted.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            )}
            {showUploadButton && (
              <button
                onClick={() => setUploadOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-all shadow-sm hover:shadow flex-shrink-0"
              >
                <Upload size={13} /> Upload Document
              </button>
            )}
          </div>

          {/* Sub-section tabs — underline style */}
          <div data-tour="doc-tabs" className="flex items-center gap-1 mt-2">
            {([
              { key: "browse", label: "Documents", icon: ListTree },
              { key: "templates", label: "Project Templates", icon: FilePlus2 },
            ] as const).map(t => {
              const active = section === t.key;
              const Icon = t.icon;
              return (
                <button
                  key={t.key}
                  onClick={() => setSection(t.key)}
                  className={`relative flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold transition-colors border-b-2 -mb-px ${
                    active
                      ? "text-primary border-primary"
                      : "text-muted-foreground border-transparent hover:text-foreground"
                  }`}
                >
                  <Icon size={14} className="flex-shrink-0" />
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="h-px bg-border/60" />
      </div>

      {section === "browse" ? (
        <div className="ph-rise ph-rise-2">
          <DocumentsBrowseTree />
        </div>
      ) : section === "templates" ? (
        <ProjectTemplatesTable />
      ) : (
        <div className="ph-rise ph-rise-2 space-y-4">
          {sorted.length === 0 ? (
            <div className="glass-surface rounded-2xl p-10 text-center text-sm text-muted-foreground">No projects yet.</div>
          ) : selectedId === ALL_PROJECTS ? (
            <AllProjectsTable docs={centralDocs} onPickProject={setSelectedId} />
          ) : (
            <DocumentsTab
              projectId={selectedId}
              uploadOpen={uploadOpen}
              onUploadOpenChange={setUploadOpen}
              showUploadButton={false}
              showSearch
            />
          )}
        </div>
      )}
    </div>
  );
}

// Flat, newest-first feed of every project's documents — the "per project → PMO"
// central reflection. Click a row's project to drill into that project's tab.
function AllProjectsTable({ docs, onPickProject }: { docs: CentralDoc[]; onPickProject: (id: number) => void }) {
  // Top-level sections mirror the Project Templates tab — the same 5 project
  // types (CAPEX / OPEX / NPL / CIP / IT), always shown even when empty.
  // Within each type, docs stay segregated by lifecycle stage in template
  // order; legacy stage keys fold to their canonical home; anything unstaged
  // goes in a trailing "Unassigned" group.
  const typeGroups = useMemo(() => {
    const stageOrder = LIFECYCLE_PHASES.flatMap(p => p.stageKeys as string[]);
    const stageMeta = (key: string) => LIFECYCLE_STAGES.find(s => s.key === key);
    type StageGroup = { key: string; label: string; color: string | undefined; docs: CentralDoc[] };
    type TypeGroup = { key: string; label: string; color: string; count: number; stages: StageGroup[] };

    const byType: Record<string, CentralDoc[]> = {};
    for (const d of docs) {
      (byType[projectTemplateType(d.projectName)] ??= []).push(d);
    }

    const groups: TypeGroup[] = TEMPLATE_TYPES.map(type => {
      const byStage: Record<string, CentralDoc[]> = {};
      for (const d of byType[type] ?? []) {
        const k = canonicalStageKey(d.stage) || "__unstaged__";
        (byStage[k] ??= []).push(d);
      }
      const stages: StageGroup[] = stageOrder
        .filter(k => (byStage[k] ?? []).length > 0)
        .map(k => { const m = stageMeta(k); return { key: `${type}:${k}`, label: m?.label ?? k, color: m?.color as string | undefined, docs: byStage[k]!.sort((a, b) => templateDocRank(k, a.name) - templateDocRank(k, b.name)) }; });
      if ((byStage["__unstaged__"] ?? []).length > 0) {
        stages.push({ key: `${type}:__unstaged__`, label: "Unassigned to a stage", color: undefined, docs: byStage["__unstaged__"] });
      }
      return { key: type, label: type, color: TYPE_COLOR[type], count: stages.reduce((s, g) => s + g.docs.length, 0), stages };
    });
    return groups;
  }, [docs]);

  // Phases + their stages collapsed by default; click a header to expand it.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setExpanded(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });

  if (docs.length === 0) {
    return <div className="glass-surface rounded-2xl p-10 text-center text-sm text-muted-foreground">No documents across any project yet.</div>;
  }

  const docRow = (d: CentralDoc) => {
    const isTemplate = (d.tags ?? []).includes("template");
    return (
      <TableRow key={d.id} className="group">
        <TableCell className="pl-6">
          <div className="flex items-center gap-2">
            <div className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 border ${isTemplate ? "bg-amber-accent/10 border-amber-accent/30" : "bg-primary/10 border-primary/20"}`}>
              {isTemplate ? <FileCheck2 size={12} className="text-amber-accent" /> : <FileText size={12} className="text-primary" />}
            </div>
            <div className="min-w-0">
              <span className="text-xs font-semibold text-foreground">{d.name}</span>
              <span className="ml-2 text-[10px] font-mono font-semibold text-primary">v{d.version}</span>
            </div>
          </div>
        </TableCell>
        <TableCell>
          <button onClick={() => onPickProject(d.projectId)} className="text-xs font-semibold text-primary hover:underline">
            {d.projectName ?? `#${d.projectId}`}
          </button>
        </TableCell>
        <TableCell className="text-xs text-muted-foreground font-mono whitespace-nowrap">{d.uploadedAt ? formatDate(d.uploadedAt) : "—"}</TableCell>
        <TableCell className="text-right">
          {d.fileUrl ? (
            <a href={d.fileUrl} download className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold text-muted-foreground hover:text-primary hover:bg-accent transition-colors">
              <Download size={13} /> Download
            </a>
          ) : <span className="text-xs text-muted-foreground/50">—</span>}
        </TableCell>
      </TableRow>
    );
  };

  return (
    <div className="glass-surface lift-card rounded-2xl overflow-hidden">
      <Table className="text-xs [&_th]:h-8 [&_th]:text-xs [&_td]:py-1.5">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-6">Document</TableHead>
            <TableHead>Project</TableHead>
            <TableHead>Uploaded</TableHead>
            <TableHead className="text-right">Download</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {typeGroups.map(p => {
            const pOpen = expanded.has(p.key);
            return (
              <Fragment key={p.key}>
                {/* Project-type header (CAPEX / OPEX / NPL / CIP / IT) — same sections as the Project Templates tab */}
                <TableRow className="bg-muted/60 hover:bg-muted/70 cursor-pointer border-t-2 border-border" onClick={() => toggle(p.key)}>
                  <TableCell colSpan={4} className="py-2">
                    <div className="flex items-center gap-2">
                      {pOpen ? <ChevronDown size={13} className="text-muted-foreground" /> : <ChevronRight size={13} className="text-muted-foreground" />}
                      <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
                      <span className="text-xs font-bold text-foreground uppercase tracking-wide">{p.label}</span>
                      <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{p.count} doc{p.count !== 1 ? "s" : ""}</span>
                    </div>
                  </TableCell>
                </TableRow>
                {pOpen && p.stages.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="pl-10 py-3 text-xs text-muted-foreground">No documents yet.</TableCell>
                  </TableRow>
                )}
                {pOpen && p.stages.map(g => {
                  const open = expanded.has(g.key);
                  return (
                    <Fragment key={g.key}>
                      {/* Stage subsection header */}
                      <TableRow className="bg-muted/30 hover:bg-muted/40 cursor-pointer" onClick={() => toggle(g.key)}>
                        <TableCell colSpan={4} className="py-1.5 pl-10">
                          <div className="flex items-center gap-2">
                            {open ? <ChevronDown size={12} className="text-muted-foreground" /> : <ChevronRight size={12} className="text-muted-foreground" />}
                            <Folder size={12} style={g.color ? { color: g.color } : undefined} className={g.color ? "" : "text-muted-foreground"} />
                            <span className="text-xs font-semibold text-foreground">{g.label}</span>
                            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{g.docs.length} doc{g.docs.length !== 1 ? "s" : ""}</span>
                          </div>
                        </TableCell>
                      </TableRow>
                      {open && g.docs.map(docRow)}
                    </Fragment>
                  );
                })}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
