import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useListProjects } from "@workspace/api-client-react";
import { DocumentsTab } from "../components/documents-tab";
import { FileText, Folder, ChevronRight } from "lucide-react";

type Project = { id: number; name: string; status: string; stage?: string | null };

export default function DocumentsPage() {
  const { data: projects = [] } = useListProjects();
  const projectsArr = projects as Project[];
  const [selectedId, setSelectedId] = useState<number | null>(null);

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
            <p className="text-xs text-muted-foreground mt-0.5">All project documents, organised by lifecycle stage. Includes versioning, check-out locking, access controls, and tags.</p>
          </div>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="glass-surface rounded-2xl p-10 text-center text-sm text-muted-foreground ph-rise ph-rise-2">
          No projects yet.
        </div>
      ) : (
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-12 md:col-span-3 ph-rise ph-rise-2">
            <div className="glass-surface rounded-2xl p-3">
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide px-2 py-1.5">Projects</p>
              <div className="space-y-1">
                {sorted.map(p => {
                  const isSel = selected?.id === p.id;
                  return (
                    <button
                      key={p.id}
                      onClick={() => setSelectedId(p.id)}
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
            </div>
          </div>

          <div className="col-span-12 md:col-span-9 ph-rise ph-rise-3">
            {selected && (
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
            )}
          </div>
        </div>
      )}
    </div>
  );
}
