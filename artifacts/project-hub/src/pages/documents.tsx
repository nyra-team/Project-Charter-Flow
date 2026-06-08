import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useListProjects } from "@workspace/api-client-react";
import { DocumentsTab } from "../components/documents-tab";
import { DocumentTemplatesPanel, TEMPLATE_COUNT } from "../components/document-templates-panel";
import { FileText, Folder, ChevronRight, FolderArchive } from "lucide-react";

type Project = { id: number; name: string; status: string; stage?: string | null };

type View = "project" | "templates";

export default function DocumentsPage() {
  const { data: projects = [] } = useListProjects();
  const projectsArr = projects as Project[];
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [view, setView] = useState<View>("project");

  const sorted = useMemo(
    () => [...projectsArr].sort((a, b) => a.name.localeCompare(b.name)),
    [projectsArr]
  );

  const selected = sorted.find(p => p.id === selectedId) ?? sorted[0];

  return (
    <div className="space-y-5">
      <div className="glass-surface lift-card rounded-2xl p-6 ph-rise">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-primary/10 border border-primary/20">
            <FileText size={18} className="text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Document Repository</h1>
            <p className="text-xs text-muted-foreground mt-0.5">All project documents, organised by lifecycle stage — plus the official Granules document templates. Versioning, check-out locking, access controls, and tags.</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
        {/* Left column — Templates option + project list */}
        <div className="col-span-12 md:col-span-3 ph-rise ph-rise-2">
          <div className="glass-surface rounded-2xl p-3">
            <button
              onClick={() => setView("templates")}
              className={`w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left transition-colors ${
                view === "templates"
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              }`}
            >
              <FolderArchive size={14} className="flex-shrink-0" />
              <span className="text-sm font-semibold truncate flex-1">Templates</span>
              <span className="text-[10px] tabular-nums opacity-60">{TEMPLATE_COUNT}</span>
            </button>

            <div className="my-2 h-px bg-border/60" />

            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide px-2 py-1.5">Projects</p>
            {sorted.length === 0 ? (
              <p className="px-2 py-2 text-xs text-muted-foreground/70">No projects yet.</p>
            ) : (
              <div className="space-y-1">
                {sorted.map(p => {
                  const isSel = view === "project" && selected?.id === p.id;
                  return (
                    <button
                      key={p.id}
                      onClick={() => { setSelectedId(p.id); setView("project"); }}
                      className={`w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left transition-colors ${
                        isSel
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                      }`}
                    >
                      <Folder size={13} className="flex-shrink-0" />
                      <span className="text-sm font-medium truncate flex-1">{p.name}</span>
                      <ChevronRight size={12} className="flex-shrink-0 opacity-50" />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right column — templates library OR the selected project's documents */}
        <div className="col-span-12 md:col-span-9 ph-rise ph-rise-3">
          {view === "templates" ? (
            <>
              <div className="mb-3">
                <h2 className="text-sm font-semibold text-foreground">Document Templates</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  The {TEMPLATE_COUNT} official Granules mandatory deliverables, organised by lifecycle phase.
                  Download a blank template, fill it in, then upload the completed copy on the project's stage Documents tab.
                </p>
              </div>
              <DocumentTemplatesPanel />
            </>
          ) : selected ? (
            <>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-foreground">
                  Documents in <span className="text-primary">{selected.name}</span>
                </h2>
                <Link href={`/projects/${selected.id}`}>
                  <button className="text-xs font-semibold text-primary hover:text-primary/80 transition-colors">
                    Open project →
                  </button>
                </Link>
              </div>
              <DocumentsTab projectId={selected.id} />
            </>
          ) : (
            <div className="glass-surface rounded-2xl p-10 text-center text-sm text-muted-foreground">
              No projects yet — select <span className="font-semibold text-foreground">Templates</span> to browse the document templates.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
