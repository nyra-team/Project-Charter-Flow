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
      <div className="rounded-2xl p-6" style={{ background: "white", border: "1px solid #E2E8F0" }}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "#EEF2FF" }}>
            <FileText size={18} className="text-indigo-500" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Document Repository</h1>
            <p className="text-xs text-gray-400 mt-0.5">All project documents, organised by lifecycle stage. Includes versioning, check-out locking, access controls, and tags.</p>
          </div>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="rounded-2xl p-10 text-center text-sm text-gray-400" style={{ background: "white", border: "1px solid #E2E8F0" }}>
          No projects yet.
        </div>
      ) : (
        <div className="grid grid-cols-12 gap-4">
          {/* Project sidebar */}
          <div className="col-span-12 md:col-span-3">
            <div className="rounded-2xl p-3" style={{ background: "white", border: "1px solid #E2E8F0" }}>
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide px-2 py-1.5">Projects</p>
              <div className="space-y-1">
                {sorted.map(p => {
                  const isSel = selected?.id === p.id;
                  return (
                    <button
                      key={p.id}
                      onClick={() => setSelectedId(p.id)}
                      className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left transition-colors"
                      style={{
                        background: isSel ? "#EEF2FF" : "transparent",
                        color: isSel ? "#4338CA" : "#475569",
                      }}
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

          {/* Documents for selected project */}
          <div className="col-span-12 md:col-span-9">
            {selected && (
              <>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-gray-700">
                    Documents in <span className="text-indigo-600">{selected.name}</span>
                  </h2>
                  <Link href={`/projects/${selected.id}`}>
                    <button className="text-xs font-semibold text-indigo-600 hover:text-indigo-800">
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
