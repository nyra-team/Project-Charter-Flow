import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  useListDocuments, useCreateDocument, useUpdateDocument, useDeleteDocument,
  useListDocumentVersions, useAddDocumentVersion, useListUsers,
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
import { Plus, FileText, Trash2, Lock, Unlock, History, Tag, Folder, Search, Upload, Download, FileCheck2, Eye, Loader2, ExternalLink, Sparkles, ChevronDown, ChevronRight, Share2 } from "lucide-react";
import { formatDate } from "../lib/format";
import { ShareDialog } from "./ShareDialog";
import { LIFECYCLE_STAGES } from "../lib/lifecycle-config";

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
  const [shareDoc, setShareDoc] = useState<Doc | null>(null);
  const [tagFilter, setTagFilter] = useState<string>("");
  const [accessFilter, setAccessFilter] = useState<string>("");
  const [form, setForm] = useState({
    name: "", stage: "", description: "", accessLevel: "team",
    fileUrl: "", fileType: "application/pdf", fileSize: 0, fileName: "",
    tags: [] as string[],
  });

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

  // Group the filtered docs by lifecycle stage, ordered by the canonical stage
  // sequence, with anything unstaged appended last.
  const stageGroups = useMemo(() => {
    const byStage: Record<string, Doc[]> = {};
    for (const d of filtered) {
      const k = d.stage || "__unstaged__";
      (byStage[k] ??= []).push(d);
    }
    type StageGroup = { key: string; label: string; color: string | undefined; docs: Doc[] };
    const groups: StageGroup[] = LIFECYCLE_STAGES
      .filter(s => (byStage[s.key] ?? []).length > 0)
      .map(s => ({ key: s.key, label: s.label, color: s.color as string | undefined, docs: byStage[s.key]! }));
    if ((byStage["__unstaged__"] ?? []).length > 0) {
      groups.push({ key: "__unstaged__", label: "Unassigned to a stage", color: undefined, docs: byStage["__unstaged__"] });
    }
    return groups;
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

  function handleAdd() {
    if (!form.name) { toast({ title: "Name is required", variant: "destructive" }); return; }
    createDoc.mutate({
      id: projectId,
      data: {
        name: form.name,
        stage: form.stage || undefined,
        description: form.description || undefined,
        accessLevel: form.accessLevel,
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
        setForm({ name: "", stage: "", description: "", accessLevel: "team", fileUrl: "", fileType: "application/pdf", fileSize: 0, fileName: "", tags: [] });
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
          <div className="flex items-start gap-2.5">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 border ${isTemplate ? "bg-amber-accent/10 border-amber-accent/30" : "bg-primary/10 border-primary/20"}`}>
              {isTemplate ? <FileCheck2 size={15} className="text-amber-accent" /> : <FileText size={15} className="text-primary" />}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">{d.name}</span>
                <span className="text-[11px] font-mono font-semibold text-primary">v{d.version}</span>
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

        {/* Public Link — opens the Drive-style Share dialog (copyable link + upload-new-version) */}
        <TableCell className="align-top">
          <button
            onClick={() => setShareDoc(d)}
            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-semibold border border-border text-muted-foreground hover:text-primary hover:border-primary/40 hover:bg-primary/5 transition-colors"
            title="Share — get public link & upload new version"
          >
            <Share2 size={12} /> Share
          </button>
        </TableCell>

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
              <a href={d.fileUrl} download className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-primary transition-colors" title={isTemplate ? "Download template" : "Download"}>
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
      {/* Toolbar */}
      {(showSearch || showUploadButton) && (
        <div className="glass-surface lift-card ph-rise rounded-2xl p-4 flex flex-wrap items-center gap-3">
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

      {filtered.length === 0 ? (
        <div className="glass-surface lift-card ph-rise rounded-2xl p-10 text-center text-sm text-muted-foreground">
          {allDocs.length === 0 ? "No documents yet. Click 'Upload Document' to add one." : "No documents match your filters."}
        </div>
      ) : (
        <div className="glass-surface lift-card ph-rise rounded-2xl overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-10">Document</TableHead>
                <TableHead>
                  <select
                    value={accessFilter}
                    onChange={e => setAccessFilter(e.target.value)}
                    className="text-xs font-medium border border-input bg-background rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-ring/40"
                    title="Filter by access level"
                  >
                    <option value="">All access</option>
                    {ACCESS_LEVELS.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </TableHead>
                <TableHead>
                  <select
                    value={tagFilter}
                    onChange={e => setTagFilter(e.target.value)}
                    className="text-xs font-medium border border-input bg-background rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-ring/40"
                    title="Filter by tag"
                  >
                    <option value="">All tags</option>
                    {CATEGORY_TAGS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </TableHead>
                <TableHead>Uploaded By</TableHead>
                <TableHead>Public Link</TableHead>
                <TableHead>Uploaded</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stageGroups.map(g => {
                const open = expandedStages.has(g.key);
                const countLabel = `${g.docs.length} doc${g.docs.length !== 1 ? "s" : ""}`;
                return (
                  <Fragment key={g.key}>
                    {/* Stage section header — click to expand/collapse the documents inside */}
                    <TableRow className="bg-muted/40 hover:bg-muted/50 cursor-pointer border-t-2 border-border" onClick={() => toggleStage(g.key)}>
                      <TableCell colSpan={7} className="py-2">
                        <div className="flex items-center gap-2">
                          {open ? <ChevronDown size={14} className="text-muted-foreground" /> : <ChevronRight size={14} className="text-muted-foreground" />}
                          <Folder size={14} style={g.color ? { color: g.color } : undefined} className={g.color ? "" : "text-muted-foreground"} />
                          <span className="text-sm font-semibold text-foreground">{g.label}</span>
                          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{countLabel}</span>
                        </div>
                      </TableCell>
                    </TableRow>
                    {open && g.docs.map(d => <DocRow key={d.id} d={d} />)}
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
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Stage</label>
                <select value={form.stage} onChange={e => setForm({ ...form, stage: e.target.value })} className="w-full text-sm border border-input bg-background rounded-md px-3 py-2 mt-1 focus:outline-none focus:ring-2 focus:ring-ring/40">
                  <option value="">— None —</option>
                  {LIFECYCLE_STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Access</label>
                <select value={form.accessLevel} onChange={e => setForm({ ...form, accessLevel: e.target.value })} className="w-full text-sm border border-input bg-background rounded-md px-3 py-2 mt-1 focus:outline-none focus:ring-2 focus:ring-ring/40">
                  {ACCESS_LEVELS.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
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
            <div className="flex justify-end gap-2 pt-2 border-t border-border/60">
              <button onClick={() => setShowAdd(false)} className="px-3 py-1.5 text-sm rounded-md font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">Cancel</button>
              <button onClick={handleAdd} className="px-3 py-1.5 text-sm font-semibold bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors shadow-sm inline-flex items-center gap-1.5">
                <Plus size={12} /> Add
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

      {/* Drive-style share dialog — copyable public link + upload new version */}
      {shareDoc && (
        <ShareDialog
          docId={shareDoc.id}
          docName={shareDoc.name}
          onClose={() => setShareDoc(null)}
        />
      )}
    </div>
  );
}

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function kindOf(doc: Doc): "docx" | "pdf" | "image" | "text" | "other" {
  const url = (doc.fileUrl ?? "").toLowerCase().split("?")[0];
  const type = (doc.fileType ?? "").toLowerCase();
  if (type === DOCX_MIME || url.endsWith(".docx")) return "docx";
  if (type === "application/pdf" || url.endsWith(".pdf")) return "pdf";
  if (type.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg|bmp)$/.test(url)) return "image";
  if (type.startsWith("text/") || /\.(txt|md|csv|json|log)$/.test(url)) return "text";
  return "other";
}

function DocumentPreviewModal({ doc, onClose }: { doc: Doc; onClose: () => void }) {
  // All versions of this document, so the viewer can switch between them.
  // "current" = the live doc.fileUrl (latest); otherwise a specific version row.
  const { data: versions = [] } = useListDocumentVersions(doc.id);
  const vs = (versions as DocVersion[]).slice().sort((a, b) => b.version - a.version);
  const [activeVerId, setActiveVerId] = useState<number | "current">("current");
  const activeUrl = activeVerId === "current"
    ? doc.fileUrl
    : (vs.find(v => v.id === activeVerId)?.fileUrl ?? doc.fileUrl);
  const kind = kindOf({ ...doc, fileUrl: activeUrl ?? doc.fileUrl });
  const docxRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errMsg, setErrMsg] = useState<string>("");
  const [blobUrl, setBlobUrl] = useState<string>("");
  const [textContent, setTextContent] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";

    async function load() {
      if (!activeUrl) { setStatus("error"); setErrMsg("This document has no file attached."); return; }
      if (kind === "other") { setStatus("error"); setErrMsg("In-browser preview isn't supported for this file type."); return; }
      setStatus("loading");
      try {
        const res = await fetch(activeUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (cancelled) return;

        if (kind === "docx") {
          // Wait a tick so the modal's container ref is mounted.
          const container = docxRef.current;
          if (!container) throw new Error("Preview container unavailable");
          container.innerHTML = "";
          const { renderAsync } = await import("docx-preview");
          if (cancelled) return;
          await renderAsync(blob, container, undefined, {
            className: "docx-preview",
            inWrapper: true,
            ignoreWidth: false,
            ignoreHeight: false,
            breakPages: true,
            useBase64URL: true,
          });
        } else if (kind === "text") {
          const txt = await blob.text();
          if (cancelled) return;
          setTextContent(txt);
        } else {
          objectUrl = URL.createObjectURL(blob);
          if (cancelled) { URL.revokeObjectURL(objectUrl); return; }
          setBlobUrl(objectUrl);
        }
        if (!cancelled) setStatus("ready");
      } catch (e) {
        if (cancelled) return;
        setStatus("error");
        setErrMsg(e instanceof Error ? e.message : "Failed to load preview");
      }
    }

    // Defer one frame so the docx container is in the DOM before render.
    const t = setTimeout(load, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeUrl]);

  return (
    <Dialog open={true} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-5xl w-[90vw] h-[88vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 py-3 border-b border-border/60 flex-shrink-0">
          <DialogTitle className="flex items-center gap-2 tracking-tight text-base">
            <FileText size={16} className="text-primary" />
            <span className="truncate">{doc.name}</span>
            <span className="text-[11px] font-mono font-semibold text-primary">
              v{activeVerId === "current" ? doc.version : (vs.find(v => v.id === activeVerId)?.version ?? doc.version)}
              {activeVerId !== "current" && <span className="text-muted-foreground font-normal"> (older)</span>}
            </span>
            <a
              href={activeUrl ?? "#"}
              download
              className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold text-muted-foreground hover:text-primary hover:bg-accent transition-colors"
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

        <div className="flex-1 min-h-0 overflow-auto scrollbar-thin bg-muted/40">
          {status === "loading" && (
            <div className="h-full flex items-center justify-center text-muted-foreground gap-2">
              <Loader2 size={18} className="animate-spin" /> <span className="text-sm">Loading preview…</span>
            </div>
          )}

          {status === "error" && (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-6">
              <FileText size={32} className="text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground max-w-md">{errMsg}</p>
              {doc.fileUrl && (
                <div className="flex items-center gap-2">
                  <a href={doc.fileUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold bg-muted text-foreground hover:bg-accent transition-colors">
                    <ExternalLink size={13} /> Open in new tab
                  </a>
                  <a href={doc.fileUrl} download className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
                    <Download size={13} /> Download
                  </a>
                </div>
              )}
            </div>
          )}

          {/* DOCX always-mounted target (rendered into even while "loading") */}
          <div className={kind === "docx" && status !== "error" ? "flex justify-center py-4" : "hidden"}>
            <div ref={docxRef} className="docx-preview-host" />
          </div>

          {kind === "pdf" && status === "ready" && blobUrl && (
            <iframe src={blobUrl} title={doc.name} className="w-full h-full border-0" />
          )}

          {kind === "image" && status === "ready" && blobUrl && (
            <div className="h-full flex items-center justify-center p-4">
              <img src={blobUrl} alt={doc.name} className="max-w-full max-h-full object-contain rounded-md shadow-sm" />
            </div>
          )}

          {kind === "text" && status === "ready" && (
            <pre className="text-xs font-mono whitespace-pre-wrap p-5 text-foreground">{textContent}</pre>
          )}
        </div>
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
