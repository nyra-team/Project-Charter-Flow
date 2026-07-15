import { Fragment, useEffect, useMemo, useState } from "react";
import {
  useListDocuments, useCreateDocument, useUpdateDocument, useDeleteDocument,
  useListDocumentVersions, useAddDocumentVersion, useListUsers,
  useListMilestones, useListTasks,
  getListProjectStagesQueryKey, getGetProjectQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useUserStore } from "../lib/store";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FileDropzone } from "@/components/ui/file-dropzone";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";
import { Plus, FileText, Trash2, Lock, Unlock, History, Tag, Folder, Search, Upload, Download, FileCheck2, Eye, Loader2, Sparkles, ChevronDown, ChevronRight, SlidersHorizontal, X } from "lucide-react";
import { FilePreviewBody } from "./FilePreviewBody";
import { formatDate } from "../lib/format";
import { LIFECYCLE_STAGES, canonicalStageKey, templateDocRank } from "../lib/lifecycle-config";
import { LIFECYCLE_PHASES } from "../lib/lifecycle-phases";
import { ProjectTemplatesTable } from "./project-templates";

type Doc = {
  id: number; projectId: number; stage?: string | null; name: string;
  fileUrl?: string | null; fileType?: string | null; fileSize?: number | null;
  version: number; uploadedBy?: number | null; uploadedAt?: string | null;
  approvalStatus: string; approvedBy?: number | null; approvedAt?: string | null;
  accessLevel: string; tags: string[]; description?: string | null;
};

type DocVersion = {
  id: number; documentId: number; version: number;
  fileUrl?: string | null; uploadedBy?: number | null; uploadedAt?: string | null; notes?: string | null;
};

const ACCESS_LEVELS = ["public", "team", "restricted", "confidential"] as const;
const CATEGORY_TAGS = ["URS", "RFP", "NFA", "Charter", "Contract", "UAT", "Closure", "Other"];

// Downloads go through the public /api/documents/:id/raw route (no bearer needed,
// unlike the raw /api/storage/objects path which 401s from a plain <a download>).
// The stored name often has no extension, so derive one from the MIME type.
const MIME_EXT: Record<string, string> = {
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "application/vnd.ms-powerpoint": ".ppt",
  "application/pdf": ".pdf",
  "text/html": ".html",
};
function dlName(name: string, fileType?: string | null): string {
  if (/\.[a-z0-9]{2,5}$/i.test(name)) return name;
  return name + (MIME_EXT[fileType ?? ""] ?? "");
}

const ACCESS_PILL: Record<string, { pill: string; icon: typeof Lock }> = {
  public:       { pill: "bg-success/10 text-success border-success/20",            icon: Unlock },
  team:         { pill: "bg-primary/10 text-primary border-primary/20",            icon: Folder },
  restricted:   { pill: "bg-warn/10 text-warn border-warn/20",                     icon: Lock },
  confidential: { pill: "bg-destructive/10 text-destructive border-destructive/20", icon: Lock },
};

export function DocumentsTab({
  projectId,
  uploadOpen,
  onUploadOpenChange,
  showUploadButton = true,
  showSearch = true,
}: {
  projectId: number;
  /** Controlled "upload modal open" state — lets a parent (e.g. the page header) trigger uploads. */
  uploadOpen?: boolean;
  onUploadOpenChange?: (open: boolean) => void;
  /** Set false to hide the toolbar's own Upload button (when the parent renders one). */
  showUploadButton?: boolean;
  /** Set false to hide the toolbar search box. */
  showSearch?: boolean;
}) {
  const { toast } = useToast();
  const { userId } = useUserStore();
  const queryClient = useQueryClient();
  const { data: docs = [], refetch } = useListDocuments(projectId);
  const { data: users = [] } = useListUsers();
  const createDoc = useCreateDocument();
  const updateDoc = useUpdateDocument();
  const deleteDoc = useDeleteDocument();

  // AI backfill — the upload route fires a fire-and-forget classification
  // job on the server. We surface a subtle pill in the header while it's
  // running, then refetch docs + lifecycle stages so newly-assigned stages,
  // ticked checklist items and auto-advanced stages appear without a reload.
  const [backfillingUntil, setBackfillingUntil] = useState<number | null>(null);
  const backfillActive = backfillingUntil != null && Date.now() < backfillingUntil;

  function announceBackfill() {
    setBackfillingUntil(Date.now() + 9000);
  }

  useEffect(() => {
    if (!backfillingUntil) return;
    const ms = Math.max(0, backfillingUntil - Date.now());
    const t = setTimeout(() => {
      refetch();
      queryClient.invalidateQueries({ queryKey: getListProjectStagesQueryKey(projectId) });
      queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
      setBackfillingUntil(null);
    }, ms);
    return () => clearTimeout(t);
  }, [backfillingUntil, projectId, queryClient, refetch]);

  const [search, setSearch] = useState("");
  const [internalShowAdd, setInternalShowAdd] = useState(false);
  const showAdd = uploadOpen ?? internalShowAdd;
  const setShowAdd = (v: boolean) => { if (onUploadOpenChange) onUploadOpenChange(v); else setInternalShowAdd(v); };
  const [versionDocId, setVersionDocId] = useState<number | null>(null);
  const [previewDoc, setPreviewDoc] = useState<Doc | null>(null);
  const [tagFilter, setTagFilter] = useState<string>("");
  const [accessFilter, setAccessFilter] = useState<string>("");
  const [form, setForm] = useState({
    name: "", msSel: "", taskSel: "", subSel: "", description: "",
    fileUrl: "", fileType: "application/pdf", fileSize: 0, fileName: "",
    tags: [] as string[],
  });

  // Cascading "Attach to" pickers in the upload modal: Milestone → Task →
  // Subtask, each defaulting to "General" (= attach one level up). With the
  // milestone on General the upload is a plain project document in the
  // repository (AI classifies its lifecycle stage — no manual Stage pick).
  const { data: rawMilestones = [] } = useListMilestones(projectId);
  const { data: rawTasks = [] } = useListTasks(projectId);
  const msList = useMemo(() =>
    (rawMilestones as Array<{ id: number; name: string; order?: number | null }>)
      .slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [rawMilestones]);
  const taskList = useMemo(() =>
    (rawTasks as Array<{ id: number; name: string; milestoneId?: number | null; parentTaskId?: number | null; order?: number | null }>)
      .slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [rawTasks]);
  const msTasks = form.msSel ? taskList.filter(t => (t.milestoneId ?? null) === Number(form.msSel) && t.parentTaskId == null) : [];
  const taskSubs = form.taskSel ? taskList.filter(s => s.parentTaskId === Number(form.taskSel)) : [];
  // Where the upload goes: null = general project document (repository row);
  // otherwise an attachment clipped to the deepest selected item.
  const attachTarget = (() => {
    if (!form.msSel) return null;
    const milestoneId = Number(form.msSel);
    if (!form.taskSel) {
      return { milestoneId, taskId: null as number | null, label: `Milestone · ${msList.find(m => m.id === milestoneId)?.name ?? milestoneId}` };
    }
    const sub = form.subSel ? taskList.find(t => t.id === Number(form.subSel)) : undefined;
    const task = taskList.find(t => t.id === Number(form.taskSel));
    const target = sub ?? task;
    return { milestoneId, taskId: target?.id ?? null, label: `${sub ? "Subtask" : "Task"} · ${target?.name ?? ""}` };
  })();

  const allDocs = docs as Doc[];
  const usersArr = users as Array<{ id: number; name: string }>;
  const userName = (id?: number | null) => id ? (usersArr.find(u => u.id === id)?.name ?? `#${id}`) : "—";

  const filtered = useMemo(() => {
    const term = search.toLowerCase().trim();
    return allDocs.filter(d => {
      if (tagFilter && !(d.tags ?? []).includes(tagFilter)) return false;
      if (accessFilter && d.accessLevel !== accessFilter) return false;
      if (!term) return true;
      const hay = `${d.name} ${d.description ?? ""} ${(d.tags ?? []).join(" ")} ${d.stage ?? ""}`.toLowerCase();
      return hay.includes(term);
    });
  }, [allDocs, search, tagFilter, accessFilter]);

  // Club docs under the 3 lifecycle phases (Plan / Execute / Close), and within
  // each phase keep them segregated by stage. Legacy stage keys fold into their
  // canonical home; anything unstaged goes in a trailing "Unassigned" group.
  const phaseGroups = useMemo(() => {
    const byStage: Record<string, Doc[]> = {};
    for (const d of filtered) {
      const k = canonicalStageKey(d.stage) || "__unstaged__";
      (byStage[k] ??= []).push(d);
    }
    const stageMeta = (key: string) => LIFECYCLE_STAGES.find(s => s.key === key);
    type StageGroup = { key: string; label: string; color: string | undefined; docs: Doc[] };
    type PhaseGroup = { key: string; label: string; color: string; count: number; stages: StageGroup[] };
    const phases: PhaseGroup[] = LIFECYCLE_PHASES.map(p => {
      const stages: StageGroup[] = p.stageKeys
        .filter(k => (byStage[k] ?? []).length > 0)
        .map(k => { const m = stageMeta(k); return { key: k, label: m?.label ?? k, color: m?.color as string | undefined, docs: byStage[k]!.sort((a, b) => templateDocRank(k, a.name) - templateDocRank(k, b.name)) }; });
      return { key: p.key, label: p.label, color: p.color, count: stages.reduce((s, g) => s + g.docs.length, 0), stages };
    }).filter(p => p.stages.length > 0);
    if ((byStage["__unstaged__"] ?? []).length > 0) {
      const docs = byStage["__unstaged__"];
      phases.push({ key: "__unstaged__", label: "Unassigned to a stage", color: "#94A3B8", count: docs.length, stages: [{ key: "__unstaged__", label: "Unassigned to a stage", color: undefined, docs }] });
    }
    return phases;
  }, [filtered]);

  // Stage sections are collapsed by default; clicking a header expands that section.
  const [expandedStages, setExpandedStages] = useState<Set<string>>(new Set());
  function toggleStage(k: string) {
    setExpandedStages(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }

  const [attaching, setAttaching] = useState(false);

  function resetForm() {
    setForm({ name: "", msSel: "", taskSel: "", subSel: "", description: "", fileUrl: "", fileType: "application/pdf", fileSize: 0, fileName: "", tags: [] });
  }

  async function handleAdd() {
    if (attachTarget) {
      // Clip the file onto the chosen milestone / task / subtask — it lands in
      // the attachments store and shows under "Attachments by milestone & task"
      // (and on that row's paperclip), not in the versioned repository table.
      if (!form.fileUrl) { toast({ title: "Choose a file to attach", variant: "destructive" }); return; }
      setAttaching(true);
      try {
        const r = await fetch(`/api/projects/${projectId}/attachments`, {
          method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            milestoneId: attachTarget.milestoneId, taskId: attachTarget.taskId,
            fileUrl: form.fileUrl, fileName: form.name || form.fileName,
            fileType: form.fileType || undefined, fileSize: form.fileSize || undefined,
            uploadedBy: userId ?? undefined,
          }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        toast({ title: "Attached", description: attachTarget.label });
        setShowAdd(false);
        resetForm();
        void queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "attachments"] });
        void queryClient.invalidateQueries({ queryKey: ["/api/attachments/counts"] });
      } catch {
        toast({ title: "Failed to attach", variant: "destructive" });
      } finally {
        setAttaching(false);
      }
      return;
    }
    if (!form.name) { toast({ title: "Name is required", variant: "destructive" }); return; }
    createDoc.mutate({
      id: projectId,
      data: {
        name: form.name,
        description: form.description || undefined,
        accessLevel: "team",
        fileUrl: form.fileUrl || undefined,
        fileType: form.fileType || undefined,
        fileSize: form.fileSize || undefined,
        uploadedBy: userId ?? undefined,
        tags: form.tags,
      },
    }, {
      onSuccess: () => {
        toast({ title: "Document added" });
        setShowAdd(false);
        resetForm();
        refetch();
        announceBackfill();
      },
      onError: (e: unknown) => {
        const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
        toast({ title: "Failed to add", description: msg, variant: "destructive" });
      },
    });
  }

  function toggleLock(d: Doc) {
    const isLocked = d.approvalStatus === "checked_out";
    updateDoc.mutate({
      id: d.id,
      data: { approvalStatus: isLocked ? "pending" : "checked_out" },
    }, { onSuccess: () => { refetch(); toast({ title: isLocked ? "Checked in" : "Checked out (locked)" }); } });
  }

  function changeAccess(d: Doc, level: string) {
    updateDoc.mutate({ id: d.id, data: { accessLevel: level } }, { onSuccess: () => refetch() });
  }

  function handleDelete(id: number) {
    if (!confirm("Delete this document?")) return;
    deleteDoc.mutate({ id }, { onSuccess: () => { refetch(); toast({ title: "Document deleted" }); } });
  }

  function DocRow({ d }: { d: Doc }) {
    const isLocked = d.approvalStatus === "checked_out";
    const isTemplate = (d.tags ?? []).includes("template");
    const visibleTags = (d.tags ?? []).filter(t => t !== "template");
    return (
      <TableRow className="group">
        {/* Document */}
        <TableCell className="align-top pl-10">
          <div className="flex items-start gap-2">
            <div className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 border ${isTemplate ? "bg-amber-accent/10 border-amber-accent/30" : "bg-primary/10 border-primary/20"}`}>
              {isTemplate ? <FileCheck2 size={12} className="text-amber-accent" /> : <FileText size={12} className="text-primary" />}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold text-foreground group-hover:text-primary transition-colors">{d.name}</span>
                <span className="text-[10px] font-mono font-semibold text-primary">v{d.version}</span>
                {isLocked && (
                  <span className="text-[10px] font-mono uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded-sm border bg-destructive/10 text-destructive border-destructive/20 inline-flex items-center gap-1">
                    <Lock size={9} /> Locked
                  </span>
                )}
              </div>
              {d.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1 max-w-md">{d.description}</p>}
            </div>
          </div>
        </TableCell>

        {/* Access */}
        <TableCell className="align-top">
          <select
            value={d.accessLevel}
            onChange={e => changeAccess(d, e.target.value)}
            className="text-xs border border-input bg-background rounded-md px-1.5 py-1 text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
            title="Access level"
          >
            {ACCESS_LEVELS.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </TableCell>

        {/* Tags */}
        <TableCell className="align-top">
          {visibleTags.length === 0 ? (
            <span className="text-xs text-muted-foreground/50">—</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {visibleTags.map(t => (
                <span key={t} className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-sm border bg-muted text-muted-foreground border-border inline-flex items-center gap-1">
                  <Tag size={8} /> {t}
                </span>
              ))}
            </div>
          )}
        </TableCell>

        {/* Uploaded By */}
        <TableCell className="align-top text-xs text-muted-foreground whitespace-nowrap">{userName(d.uploadedBy)}</TableCell>

        {/* Uploaded date */}
        <TableCell className="align-top text-xs text-muted-foreground font-mono whitespace-nowrap">{d.uploadedAt ? formatDate(d.uploadedAt) : "—"}</TableCell>

        {/* Actions */}
        <TableCell className="align-top">
          <div className="flex items-center justify-end gap-0.5">
            {d.fileUrl && (
              <button onClick={() => setPreviewDoc(d)} className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-primary transition-colors" title="Quick view">
                <Eye size={13} />
              </button>
            )}
            {d.fileUrl && (
              <a href={`/api/documents/${d.id}/raw`} download={dlName(d.name, d.fileType)} className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-primary transition-colors" title={isTemplate ? "Download template" : "Download"}>
                <Download size={13} />
              </a>
            )}
            <button onClick={() => toggleLock(d)} className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-primary transition-colors" title={isLocked ? "Check in" : "Check out (lock)"}>
              {isLocked ? <Unlock size={13} /> : <Lock size={13} />}
            </button>
            <button onClick={() => setVersionDocId(d.id)} className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-primary transition-colors" title="Version history">
              <History size={13} />
            </button>
            <button onClick={() => handleDelete(d.id)} className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-destructive transition-colors" title="Delete">
              <Trash2 size={13} />
            </button>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <div className="space-y-4">
      {backfillActive && (
        <div className="rounded-2xl px-4 py-2.5 flex items-center gap-3 border border-primary/30 bg-primary/5 text-primary">
          <Sparkles size={14} className="animate-pulse" />
          <p className="text-xs font-semibold">AI is reading your documents — classifying to stages, ticking checklist items, and advancing the lifecycle where gates clear…</p>
        </div>
      )}
      {/* Toolbar — search + always-visible Access/Tags filters + upload.
          The filters live here (not in the table header) so they stay visible
          and adjustable even when the current filter matches no documents. */}
      {(showSearch || showUploadButton || allDocs.length > 0) && (
        <div className="glass-surface rounded-2xl p-4 flex flex-wrap items-center gap-3">
          {showSearch && (
            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
              <Search size={14} className="text-muted-foreground" />
              <Input
                placeholder="Search documents by name, description, tag…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="border-0 shadow-none focus-visible:ring-0 px-0 bg-transparent"
              />
            </div>
          )}
          {allDocs.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <SlidersHorizontal size={13} /> Filter
              </span>
              <select
                value={accessFilter}
                onChange={e => setAccessFilter(e.target.value)}
                title="Filter by access level"
                className={`text-xs font-medium border rounded-md px-2 py-1 h-8 focus:outline-none focus:ring-2 focus:ring-ring/40 ${accessFilter ? "border-primary bg-primary/10 text-primary" : "border-input bg-background"}`}
              >
                <option value="">All access</option>
                {ACCESS_LEVELS.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
              <select
                value={tagFilter}
                onChange={e => setTagFilter(e.target.value)}
                title="Filter by tag"
                className={`text-xs font-medium border rounded-md px-2 py-1 h-8 focus:outline-none focus:ring-2 focus:ring-ring/40 ${tagFilter ? "border-primary bg-primary/10 text-primary" : "border-input bg-background"}`}
              >
                <option value="">All tags</option>
                {CATEGORY_TAGS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              {(accessFilter || tagFilter || search) && (
                <button
                  type="button"
                  onClick={() => { setAccessFilter(""); setTagFilter(""); setSearch(""); }}
                  title="Clear all filters"
                  className="inline-flex items-center gap-1 px-2 py-1 h-8 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                >
                  <X size={13} /> Clear
                </button>
              )}
            </div>
          )}
          {showUploadButton && (
            <button
              onClick={() => setShowAdd(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm ml-auto"
            >
              <Upload size={14} /> Upload Document
            </button>
          )}
        </div>
      )}

      {/* Project Templates — the same 5-type sections as the repository's
          templates tab, available inline within this project's documents. */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Project Templates</p>
        <ProjectTemplatesTable />
      </div>

      {filtered.length === 0 ? (
        <div className="glass-surface rounded-2xl p-10 text-center text-sm text-muted-foreground">
          {allDocs.length === 0 ? "No documents yet. Click 'Upload Document' to add one." : "No documents match your filters."}
        </div>
      ) : (
        <div className="glass-surface rounded-2xl overflow-hidden">
          <Table className="text-xs [&_th]:h-8 [&_th]:text-xs [&_td]:py-1.5">
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
              {phaseGroups.map(p => {
                const pOpen = expandedStages.has(p.key);
                return (
                  <Fragment key={p.key}>
                    {/* Phase header (Plan / Execute / Close) — click to expand its stages */}
                    <TableRow className="bg-muted/60 hover:bg-muted/70 cursor-pointer border-t-2 border-border" onClick={() => toggleStage(p.key)}>
                      <TableCell colSpan={6} className="py-2">
                        <div className="flex items-center gap-2">
                          {pOpen ? <ChevronDown size={13} className="text-muted-foreground" /> : <ChevronRight size={13} className="text-muted-foreground" />}
                          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
                          <span className="text-xs font-bold text-foreground uppercase tracking-wide">{p.label}</span>
                          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{p.count} doc{p.count !== 1 ? "s" : ""}</span>
                        </div>
                      </TableCell>
                    </TableRow>
                    {pOpen && p.stages.map(g => {
                      const open = expandedStages.has(g.key);
                      const countLabel = `${g.docs.length} doc${g.docs.length !== 1 ? "s" : ""}`;
                      return (
                        <Fragment key={g.key}>
                          {/* Stage subsection header — click to expand/collapse its documents */}
                          <TableRow className="bg-muted/30 hover:bg-muted/40 cursor-pointer" onClick={() => toggleStage(g.key)}>
                            <TableCell colSpan={6} className="py-1.5 pl-10">
                              <div className="flex items-center gap-2">
                                {open ? <ChevronDown size={12} className="text-muted-foreground" /> : <ChevronRight size={12} className="text-muted-foreground" />}
                                <Folder size={12} style={g.color ? { color: g.color } : undefined} className={g.color ? "" : "text-muted-foreground"} />
                                <span className="text-xs font-semibold text-foreground">{g.label}</span>
                                <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{countLabel}</span>
                              </div>
                            </TableCell>
                          </TableRow>
                          {open && g.docs.map(d => <DocRow key={d.id} d={d} />)}
                        </Fragment>
                      );
                    })}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Upload modal */}
      <Dialog open={showAdd} onOpenChange={v => { if (!v) setShowAdd(false); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 tracking-tight"><Upload size={16} className="text-primary" /> Upload Document</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Name</label>
              <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Requirements v1" className="mt-1" />
            </div>
            {/* Cascading placement pickers — each level defaults to General.
                Milestone on General = plain project document; picking deeper
                narrows the attachment to that milestone / task / subtask. */}
            <div className="space-y-2">
              <div>
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Milestone</label>
                <select
                  value={form.msSel}
                  onChange={e => setForm({ ...form, msSel: e.target.value, taskSel: "", subSel: "" })}
                  className="w-full text-sm border border-input bg-background rounded-md px-3 py-2 mt-1 focus:outline-none focus:ring-2 focus:ring-ring/40"
                >
                  <option value="">General (project document)</option>
                  {msList.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
              {form.msSel && (
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Task</label>
                  <select
                    value={form.taskSel}
                    onChange={e => setForm({ ...form, taskSel: e.target.value, subSel: "" })}
                    className="w-full text-sm border border-input bg-background rounded-md px-3 py-2 mt-1 focus:outline-none focus:ring-2 focus:ring-ring/40"
                  >
                    <option value="">General (whole milestone)</option>
                    {msTasks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              )}
              {form.taskSel && taskSubs.length > 0 && (
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Subtask</label>
                  <select
                    value={form.subSel}
                    onChange={e => setForm({ ...form, subSel: e.target.value })}
                    className="w-full text-sm border border-input bg-background rounded-md px-3 py-2 mt-1 focus:outline-none focus:ring-2 focus:ring-ring/40"
                  >
                    <option value="">General (whole task)</option>
                    {taskSubs.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              )}
              {attachTarget && (
                <p className="text-[11px] text-muted-foreground">
                  The file will be clipped to <span className="font-semibold text-foreground">{attachTarget.label}</span> — find it under "Attachments by milestone &amp; task" and on the item's paperclip.
                </p>
              )}
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">File</label>
              <div className="mt-1">
                <FileDropzone
                  accept=".pdf,.docx,.doc,.xlsx,.xls,.pptx,.ppt"
                  maxSizeMB={500}
                  currentFileName={form.fileName || null}
                  onUploaded={(meta) => setForm(prev => ({
                    ...prev,
                    fileUrl: meta.fileUrl,
                    fileType: meta.fileType,
                    fileSize: meta.fileSize,
                    fileName: meta.fileName,
                    name: prev.name || meta.fileName.replace(/\.[^.]+$/, ""),
                  }))}
                  onCleared={() => setForm(prev => ({ ...prev, fileUrl: "", fileType: "application/pdf", fileSize: 0, fileName: "" }))}
                />
              </div>
            </div>
            {/* Description + tags belong to repository documents only — the
                attachments store keeps just the file, so hide them when the
                upload is clipped to a milestone / task / subtask. */}
            {!attachTarget && (
              <>
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Description</label>
                  <Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Short summary" rows={2} className="mt-1" />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Tags</label>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {CATEGORY_TAGS.map(t => {
                      const on = form.tags.includes(t);
                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setForm({ ...form, tags: on ? form.tags.filter(x => x !== t) : [...form.tags, t] })}
                          className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border transition-colors ${
                            on
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-muted text-muted-foreground border-border hover:bg-accent"
                          }`}
                        >{t}</button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
            <div className="flex justify-end gap-2 pt-2 border-t border-border/60">
              <button onClick={() => setShowAdd(false)} className="px-3 py-1.5 text-sm rounded-md font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">Cancel</button>
              <button onClick={handleAdd} disabled={attaching || createDoc.isPending} className="px-3 py-1.5 text-sm font-semibold bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors shadow-sm inline-flex items-center gap-1.5 disabled:opacity-60">
                {attaching || createDoc.isPending ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} {attachTarget ? "Attach" : "Add"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Version history modal */}
      {versionDocId !== null && (
        <VersionHistoryModal documentId={versionDocId} onClose={() => { setVersionDocId(null); refetch(); }} onVersionAdded={announceBackfill} />
      )}

      {/* Quick-view preview modal */}
      {previewDoc && (
        <DocumentPreviewModal doc={previewDoc} onClose={() => setPreviewDoc(null)} />
      )}

    </div>
  );
}

function DocumentPreviewModal({ doc, onClose }: { doc: Doc; onClose: () => void }) {
  // All versions of this document, so the viewer can switch between them.
  // "current" = the live doc.fileUrl (latest); otherwise a specific version row.
  // The rendering itself lives in the shared <FilePreviewBody>.
  const { data: versions = [] } = useListDocumentVersions(doc.id);
  const vs = (versions as DocVersion[]).slice().sort((a, b) => b.version - a.version);
  const [activeVerId, setActiveVerId] = useState<number | "current">("current");
  const activeUrl = activeVerId === "current"
    ? doc.fileUrl
    : (vs.find(v => v.id === activeVerId)?.fileUrl ?? doc.fileUrl);

  return (
    <Dialog open={true} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-5xl w-[90vw] h-[88vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 py-3 border-b border-border/60 flex-shrink-0">
          <DialogTitle className="flex items-center gap-2 tracking-tight text-base pr-10">
            <FileText size={16} className="text-primary" />
            <span className="truncate">{doc.name}</span>
            <span className="text-[11px] font-mono font-semibold text-primary">
              v{activeVerId === "current" ? doc.version : (vs.find(v => v.id === activeVerId)?.version ?? doc.version)}
              {activeVerId !== "current" && <span className="text-muted-foreground font-normal"> (older)</span>}
            </span>
            <a
              href={activeUrl ?? "#"}
              download
              className="ml-auto mr-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold text-muted-foreground hover:text-primary hover:bg-accent transition-colors"
              title="Download this version"
            >
              <Download size={13} /> Download
            </a>
          </DialogTitle>
        </DialogHeader>

        {/* Version switcher — view any version of this document inline */}
        {vs.length > 0 && (
          <div className="px-5 py-2 border-b border-border/60 flex items-center gap-1.5 flex-wrap bg-muted/30 flex-shrink-0">
            <History size={13} className="text-muted-foreground" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mr-1">Versions</span>
            <button
              onClick={() => setActiveVerId("current")}
              className={`px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold border transition-colors ${activeVerId === "current" ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground border-border hover:border-primary/40"}`}
              title="Latest version"
            >
              Latest v{doc.version}
            </button>
            {vs.map(v => (
              <button
                key={v.id}
                onClick={() => setActiveVerId(v.id)}
                className={`px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold border transition-colors ${activeVerId === v.id ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground border-border hover:border-primary/40"}`}
                title={`${v.uploadedAt ? formatDate(v.uploadedAt) : ""}${v.notes ? ` — ${v.notes}` : ""}`}
              >
                v{v.version}
              </button>
            ))}
          </div>
        )}

        <FilePreviewBody
          key={String(activeUrl ?? "")}
          url={activeUrl}
          name={doc.name}
          fileType={doc.fileType}
          downloadHref={`/api/documents/${doc.id}/raw`}
          downloadName={dlName(doc.name, doc.fileType)}
        />
      </DialogContent>
    </Dialog>
  );
}


function VersionHistoryModal({ documentId, onClose, onVersionAdded }: { documentId: number; onClose: () => void; onVersionAdded?: () => void }) {
  const { toast } = useToast();
  const { data: versions = [], refetch } = useListDocumentVersions(documentId);
  const addVersion = useAddDocumentVersion();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ fileUrl: "", fileName: "", notes: "" });

  const vs = (versions as DocVersion[]).slice().sort((a, b) => b.version - a.version);

  function submit() {
    addVersion.mutate({
      id: documentId,
      data: { fileUrl: form.fileUrl || undefined, notes: form.notes || undefined },
    }, {
      onSuccess: () => { setShowForm(false); setForm({ fileUrl: "", fileName: "", notes: "" }); refetch(); toast({ title: "New version added" }); onVersionAdded?.(); },
      onError: () => toast({ title: "Failed to add version", variant: "destructive" }),
    });
  }

  return (
    <Dialog open={true} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 tracking-tight"><History size={16} className="text-primary" /> Version History</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {vs.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No prior versions logged. Current is v1.</p>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto scrollbar-thin">
              {vs.map(v => (
                <div key={v.id} className="rounded-md p-3 bg-muted/50 border border-border">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-mono font-semibold text-primary">v{v.version}</span>
                    <span className="text-[10px] font-mono text-muted-foreground">{v.uploadedAt ? formatDate(v.uploadedAt) : "—"}</span>
                  </div>
                  {v.notes && <p className="text-xs text-muted-foreground mt-1">{v.notes}</p>}
                  {v.fileUrl && <a href={v.fileUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">Open file →</a>}
                </div>
              ))}
            </div>
          )}

          {showForm ? (
            <div className="space-y-2 border-t border-border/60 pt-3">
              <FileDropzone
                accept=".pdf,.docx,.doc,.xlsx,.xls,.pptx,.ppt"
                maxSizeMB={25}
                currentFileName={form.fileName || null}
                onUploaded={(meta) => setForm(prev => ({ ...prev, fileUrl: meta.fileUrl, fileName: meta.fileName }))}
                onCleared={() => setForm(prev => ({ ...prev, fileUrl: "", fileName: "" }))}
              />
              <Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Change notes" />
              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowForm(false)} className="px-3 py-1.5 text-sm rounded-md font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">Cancel</button>
                <button onClick={submit} className="px-3 py-1.5 text-sm font-semibold bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors shadow-sm">Save</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setShowForm(true)} className="w-full py-2 text-sm font-semibold rounded-md flex items-center justify-center gap-1.5 text-primary hover:bg-primary/10 transition-colors">
              <Plus size={13} /> Check in new version
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
