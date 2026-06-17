import { Fragment, useEffect, useMemo, useState } from "react";
import { useListProjects } from "@workspace/api-client-react";
import { DocumentsTab } from "../components/documents-tab";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";
import { FileText, FilePlus2, Files, FolderArchive, ChevronDown, ChevronRight, Upload, Download, FileCheck2, Share2 } from "lucide-react";
import { formatDate } from "../lib/format";
import { ShareDialog } from "../components/ShareDialog";

type Project = { id: number; name: string; status: string; stage?: string | null };

type Template = { phase: string; name: string; file: string; stage: string; fileType: string; url: string };

type CentralDoc = {
  id: number; projectId: number; projectName: string | null; name: string;
  stage?: string | null; fileUrl?: string | null; fileType?: string | null;
  version: number; uploadedAt?: string | null; accessLevel: string; tags: string[];
};

// Top-level sub-section of the Document Repository.
type Section = "templates" | "project-documents";

const TEMPLATE_PHASES = ["Plan", "Execute", "Close"] as const;

// Sentinel for the project picker's "show every project's documents" option.
const ALL_PROJECTS = -1;

export default function DocumentsPage() {
  const { data: projects = [] } = useListProjects();
  const projectsArr = projects as Project[];
  const [section, setSection] = useState<Section>("project-documents");

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

  // Universal templates (Central Doc Repo header), fetched from the public list route.
  const [templates, setTemplates] = useState<Template[]>([]);
  useEffect(() => {
    fetch("/api/storage/templates")
      .then(r => (r.ok ? r.json() : []))
      .then((t: Template[]) => setTemplates(Array.isArray(t) ? t : []))
      .catch(() => setTemplates([]));
  }, []);

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

  // Template phase sections — collapsed by default; click to expand.
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set(["Plan"]));
  function togglePhase(k: string) {
    setExpandedPhases(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }

  const templatesByPhase = useMemo(() => {
    const by: Record<string, Template[]> = {};
    for (const t of templates) (by[t.phase] ??= []).push(t);
    return by;
  }, [templates]);

  const showUploadButton = section === "project-documents" && selectedId !== ALL_PROJECTS;

  return (
    <div className="space-y-5">
      <div className="glass-surface lift-card rounded-2xl ph-rise overflow-hidden">
        <div className="px-6 pt-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 shadow-sm flex-shrink-0">
              <FileText size={20} className="text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                <span>Workspace</span>
                <ChevronRight size={11} />
                <span className="text-primary">Documents</span>
              </div>
              <h1 className="text-2xl font-bold text-foreground tracking-tight mt-0.5">Central Document Repository</h1>
              <p className="text-sm text-muted-foreground mt-1 max-w-2xl leading-relaxed">
                Universal templates plus every project's documents, organised by lifecycle stage. Versioning, check-out locking, access controls, and tags.
              </p>
            </div>
            {showUploadButton && (
              <button
                onClick={() => setUploadOpen(true)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-all shadow-sm hover:shadow flex-shrink-0"
              >
                <Upload size={15} /> Upload Document
              </button>
            )}
          </div>

          {/* Sub-section tabs — underline style */}
          <div className="flex items-center gap-1 mt-6">
            {([
              { key: "templates", label: "Universal Templates", icon: FilePlus2 },
              { key: "project-documents", label: "Project Documents", icon: Files },
            ] as const).map(t => {
              const active = section === t.key;
              const Icon = t.icon;
              return (
                <button
                  key={t.key}
                  onClick={() => setSection(t.key)}
                  className={`relative flex items-center gap-2 px-4 py-2.5 text-sm font-semibold transition-colors border-b-2 -mb-px ${
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

      {section === "templates" ? (
        <div className="glass-surface lift-card ph-rise ph-rise-2 rounded-2xl overflow-hidden">
          {templates.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">No universal templates found.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-10">Template</TableHead>
                  <TableHead>Lifecycle stage</TableHead>
                  <TableHead className="text-right">Download</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {TEMPLATE_PHASES.filter(p => (templatesByPhase[p] ?? []).length > 0).map(phase => {
                  const open = expandedPhases.has(phase);
                  const rows = templatesByPhase[phase] ?? [];
                  return (
                    <Fragment key={phase}>
                      <TableRow className="bg-muted/40 hover:bg-muted/50 cursor-pointer border-t-2 border-border" onClick={() => togglePhase(phase)}>
                        <TableCell colSpan={3} className="py-2">
                          <div className="flex items-center gap-2">
                            {open ? <ChevronDown size={14} className="text-muted-foreground" /> : <ChevronRight size={14} className="text-muted-foreground" />}
                            <FolderArchive size={14} className="text-muted-foreground" />
                            <span className="text-sm font-semibold text-foreground">{phase}</span>
                            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{rows.length} template{rows.length !== 1 ? "s" : ""}</span>
                          </div>
                        </TableCell>
                      </TableRow>
                      {open && rows.map(t => (
                        <TableRow key={t.file} className="group">
                          <TableCell className="pl-10">
                            <div className="flex items-center gap-2.5">
                              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 border bg-amber-accent/10 border-amber-accent/30">
                                <FileCheck2 size={15} className="text-amber-accent" />
                              </div>
                              <span className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">{t.name}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{t.stage}</TableCell>
                          <TableCell className="text-right">
                            <a href={t.url} download className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold text-muted-foreground hover:text-primary hover:bg-accent transition-colors">
                              <Download size={13} /> Download
                            </a>
                          </TableCell>
                        </TableRow>
                      ))}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      ) : (
        <div className="ph-rise ph-rise-2 space-y-4">
          {/* Project picker — pick any project, or All Projects for the central feed. */}
          <div className="glass-surface lift-card rounded-2xl p-4 flex items-center gap-3">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Project</span>
            <select
              value={selectedId}
              onChange={e => setSelectedId(Number(e.target.value))}
              className="text-sm border border-input bg-background rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-ring/40 min-w-[240px]"
            >
              <option value={ALL_PROJECTS}>All Projects (central feed)</option>
              {sorted.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

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

// Drive-style Share button per document — opens a dialog with the copyable
// public link (always latest version) + upload-new-version (read/write).
function PublicLink({ docId, docName }: { docId: number; docName: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-semibold border border-border text-muted-foreground hover:text-primary hover:border-primary/40 hover:bg-primary/5 transition-colors"
        title="Share — get public link & upload new version"
      >
        <Share2 size={12} /> Share
      </button>
      {open && <ShareDialog docId={docId} docName={docName} onClose={() => setOpen(false)} />}
    </>
  );
}

// Flat, newest-first feed of every project's documents — the "per project → PMO"
// central reflection. Click a row's project to drill into that project's tab.
function AllProjectsTable({ docs, onPickProject }: { docs: CentralDoc[]; onPickProject: (id: number) => void }) {
  if (docs.length === 0) {
    return <div className="glass-surface rounded-2xl p-10 text-center text-sm text-muted-foreground">No documents across any project yet.</div>;
  }
  return (
    <div className="glass-surface lift-card rounded-2xl overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-6">Document</TableHead>
            <TableHead>Project</TableHead>
            <TableHead>Stage</TableHead>
            <TableHead>Uploaded</TableHead>
            <TableHead>Public Link</TableHead>
            <TableHead className="text-right">Download</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {docs.map(d => {
            const isTemplate = (d.tags ?? []).includes("template");
            return (
              <TableRow key={d.id} className="group">
                <TableCell className="pl-6">
                  <div className="flex items-center gap-2.5">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 border ${isTemplate ? "bg-amber-accent/10 border-amber-accent/30" : "bg-primary/10 border-primary/20"}`}>
                      {isTemplate ? <FileCheck2 size={15} className="text-amber-accent" /> : <FileText size={15} className="text-primary" />}
                    </div>
                    <div className="min-w-0">
                      <span className="text-sm font-semibold text-foreground">{d.name}</span>
                      <span className="ml-2 text-[11px] font-mono font-semibold text-primary">v{d.version}</span>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <button onClick={() => onPickProject(d.projectId)} className="text-xs font-semibold text-primary hover:underline">
                    {d.projectName ?? `#${d.projectId}`}
                  </button>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{d.stage ?? "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground font-mono whitespace-nowrap">{d.uploadedAt ? formatDate(d.uploadedAt) : "—"}</TableCell>
                <TableCell><PublicLink docId={d.id} docName={d.name} /></TableCell>
                <TableCell className="text-right">
                  {d.fileUrl ? (
                    <a href={d.fileUrl} download className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold text-muted-foreground hover:text-primary hover:bg-accent transition-colors">
                      <Download size={13} /> Download
                    </a>
                  ) : <span className="text-xs text-muted-foreground/50">—</span>}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
