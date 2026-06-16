import { Fragment, useMemo, useState } from "react";
import { useListProjects } from "@workspace/api-client-react";
import { DocumentsTab } from "../components/documents-tab";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";
import { FileText, FilePlus2, Files, FolderArchive, ChevronDown, ChevronRight, Upload } from "lucide-react";

type Project = { id: number; name: string; status: string; stage?: string | null };

// Top-level sub-section of the Document Repository.
type Section = "new-templates" | "project-documents";

// New Project Templates categories — empty placeholders for now.
const NEW_TEMPLATE_CATEGORIES = ["Capex", "NPL", "CIP", "IT"] as const;

export default function DocumentsPage() {
  const { data: projects = [] } = useListProjects();
  const projectsArr = projects as Project[];
  const [section, setSection] = useState<Section>("project-documents");

  const sorted = useMemo(
    () => [...projectsArr].sort((a, b) => a.name.localeCompare(b.name)),
    [projectsArr]
  );

  const selected = sorted[0];

  // Upload modal is owned here so the page-header button can trigger it inside DocumentsTab.
  const [uploadOpen, setUploadOpen] = useState(false);

  // New Project Templates category sections are collapsed by default; click to expand.
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());
  function toggleCat(k: string) {
    setExpandedCats(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }

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
              <h1 className="text-2xl font-bold text-foreground tracking-tight mt-0.5">Document Repository</h1>
              <p className="text-sm text-muted-foreground mt-1 max-w-2xl leading-relaxed">
                All project documents, organised by lifecycle stage. Versioning, check-out locking, access controls, and tags.
              </p>
            </div>
            {section === "project-documents" && selected && (
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
              { key: "new-templates", label: "New Project Templates", icon: FilePlus2 },
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

      {section === "new-templates" ? (
        <div className="glass-surface lift-card ph-rise ph-rise-2 rounded-2xl overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-10">Document</TableHead>
                <TableHead>Access</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead>Uploaded By</TableHead>
                <TableHead>Uploaded</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {NEW_TEMPLATE_CATEGORIES.map(cat => {
                const open = expandedCats.has(cat);
                return (
                  <Fragment key={cat}>
                    {/* Category section header — click to expand/collapse the templates inside */}
                    <TableRow className="bg-muted/40 hover:bg-muted/50 cursor-pointer border-t-2 border-border" onClick={() => toggleCat(cat)}>
                      <TableCell colSpan={6} className="py-2">
                        <div className="flex items-center gap-2">
                          {open ? <ChevronDown size={14} className="text-muted-foreground" /> : <ChevronRight size={14} className="text-muted-foreground" />}
                          <FolderArchive size={14} className="text-muted-foreground" />
                          <span className="text-sm font-semibold text-foreground">{cat}</span>
                          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">0 docs</span>
                        </div>
                      </TableCell>
                    </TableRow>
                    {open && (
                      <TableRow>
                        <TableCell colSpan={6} className="pl-10 text-xs text-muted-foreground italic">No templates yet.</TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="ph-rise ph-rise-2">
          {sorted.length === 0 ? (
            <div className="glass-surface rounded-2xl p-10 text-center text-sm text-muted-foreground">
              No projects yet.
            </div>
          ) : selected ? (
            <DocumentsTab
              projectId={selected.id}
              uploadOpen={uploadOpen}
              onUploadOpenChange={setUploadOpen}
              showUploadButton={false}
              showSearch={false}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}
