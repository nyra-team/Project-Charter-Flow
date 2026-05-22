import { useMemo, useState } from "react";
import {
  useListDocuments, useCreateDocument, useUpdateDocument, useDeleteDocument,
  useListDocumentVersions, useAddDocumentVersion, useListUsers,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Plus, FileText, Trash2, Lock, Unlock, History, Tag, Folder, Search, Upload, ChevronDown, ChevronRight } from "lucide-react";
import { formatDate } from "../lib/format";
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

const ACCESS_META: Record<string, { color: string; bg: string; icon: typeof Lock }> = {
  public: { color: "#15803D", bg: "#F0FDF4", icon: Unlock },
  team: { color: "#4338CA", bg: "#EEF2FF", icon: Folder },
  restricted: { color: "#B45309", bg: "#FFFBEB", icon: Lock },
  confidential: { color: "#991B1B", bg: "#FEE2E2", icon: Lock },
};

export function DocumentsTab({ projectId }: { projectId: number }) {
  const { toast } = useToast();
  const { data: docs = [], refetch } = useListDocuments(projectId);
  const { data: users = [] } = useListUsers();
  const createDoc = useCreateDocument();
  const updateDoc = useUpdateDocument();
  const deleteDoc = useDeleteDocument();

  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [view, setView] = useState<"folder" | "list">("folder");
  const [expandedStages, setExpandedStages] = useState<Set<string>>(new Set(["__unstaged__"]));
  const [versionDocId, setVersionDocId] = useState<number | null>(null);
  const [tagFilter, setTagFilter] = useState<string>("");
  const [accessFilter, setAccessFilter] = useState<string>("");
  const [form, setForm] = useState({
    name: "", stage: "", description: "", accessLevel: "team",
    fileUrl: "", fileType: "application/pdf", tags: [] as string[],
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

  const docsByStage = useMemo(() => {
    const g: Record<string, Doc[]> = {};
    for (const d of filtered) {
      const k = d.stage || "__unstaged__";
      if (!g[k]) g[k] = [];
      g[k].push(d);
    }
    return g;
  }, [filtered]);

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
        tags: form.tags,
      },
    }, {
      onSuccess: () => {
        toast({ title: "Document added" });
        setShowAdd(false);
        setForm({ name: "", stage: "", description: "", accessLevel: "team", fileUrl: "", fileType: "application/pdf", tags: [] });
        refetch();
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

  function DocCard({ d }: { d: Doc }) {
    const meta = ACCESS_META[d.accessLevel] ?? ACCESS_META.team;
    const Icon = meta.icon;
    const isLocked = d.approvalStatus === "checked_out";
    return (
      <div className="rounded-xl p-3 hover:shadow-sm transition-shadow" style={{ background: "white", border: "1px solid #E2E8F0" }}>
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "#EEF2FF" }}>
            <FileText size={16} className="text-indigo-500" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-semibold text-gray-900 truncate">{d.name}</p>
              <span className="text-xs font-bold text-indigo-500">v{d.version}</span>
              {isLocked && (
                <span className="text-xs font-bold px-1.5 py-0.5 rounded flex items-center gap-1" style={{ background: "#FEE2E2", color: "#991B1B" }}>
                  <Lock size={9} /> Locked
                </span>
              )}
            </div>
            {d.description && <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{d.description}</p>}
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className="text-xs font-semibold px-1.5 py-0.5 rounded flex items-center gap-1" style={{ background: meta.bg, color: meta.color }}>
                <Icon size={9} /> {d.accessLevel}
              </span>
              {(d.tags ?? []).map(t => (
                <span key={t} className="text-xs font-semibold px-1.5 py-0.5 rounded flex items-center gap-1" style={{ background: "#F1F5F9", color: "#475569" }}>
                  <Tag size={8} /> {t}
                </span>
              ))}
              <span className="text-xs text-gray-400">
                {userName(d.uploadedBy)} · {d.uploadedAt ? formatDate(d.uploadedAt) : "—"}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <select
              value={d.accessLevel}
              onChange={e => changeAccess(d, e.target.value)}
              className="text-xs border border-gray-200 rounded px-1.5 py-1 text-gray-600"
              title="Access level"
            >
              {ACCESS_LEVELS.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
            <button onClick={() => toggleLock(d)} className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-indigo-500" title={isLocked ? "Check in" : "Check out (lock)"}>
              {isLocked ? <Unlock size={13} /> : <Lock size={13} />}
            </button>
            <button onClick={() => setVersionDocId(d.id)} className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-indigo-500" title="Version history">
              <History size={13} />
            </button>
            <button onClick={() => handleDelete(d.id)} className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-red-500" title="Delete">
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="rounded-2xl p-4 flex flex-wrap items-center gap-3" style={{ background: "white", border: "1px solid #E2E8F0" }}>
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <Search size={14} className="text-gray-400" />
          <Input
            placeholder="Search documents by name, description, tag…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="border-0 shadow-none focus-visible:ring-0 px-0"
          />
        </div>
        <select value={tagFilter} onChange={e => setTagFilter(e.target.value)} className="text-sm border border-gray-200 rounded-lg px-3 py-2">
          <option value="">All tags</option>
          {CATEGORY_TAGS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={accessFilter} onChange={e => setAccessFilter(e.target.value)} className="text-sm border border-gray-200 rounded-lg px-3 py-2">
          <option value="">All access</option>
          {ACCESS_LEVELS.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <div className="flex gap-1 p-1 rounded-lg" style={{ background: "#F1F5F9" }}>
          {(["folder", "list"] as const).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className="px-3 py-1 rounded text-xs font-semibold transition-all"
              style={{
                background: view === v ? "white" : "transparent",
                color: view === v ? "#4338CA" : "#64748B",
                boxShadow: view === v ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
              }}
            >
              {v}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white"
          style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)" }}
        >
          <Upload size={14} /> Upload Document
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl p-10 text-center text-sm text-gray-400" style={{ background: "white", border: "1px solid #E2E8F0" }}>
          {allDocs.length === 0 ? "No documents yet. Click 'Upload Document' to add one." : "No documents match your filters."}
        </div>
      ) : view === "folder" ? (
        <div className="space-y-3">
          {LIFECYCLE_STAGES.map(s => {
            const stageDocs = docsByStage[s.key] ?? [];
            if (stageDocs.length === 0) return null;
            const expanded = expandedStages.has(s.key);
            return (
              <div key={s.key} className="rounded-2xl overflow-hidden" style={{ background: "white", border: "1px solid #E2E8F0" }}>
                <button
                  onClick={() => toggleStage(s.key)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50"
                >
                  {expanded ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
                  <Folder size={14} style={{ color: s.color }} />
                  <span className="text-sm font-semibold text-gray-800">{s.label}</span>
                  <span className="text-xs text-gray-400 ml-auto">{stageDocs.length} doc{stageDocs.length !== 1 ? "s" : ""}</span>
                </button>
                {expanded && (
                  <div className="px-4 pb-4 space-y-2">
                    {stageDocs.map(d => <DocCard key={d.id} d={d} />)}
                  </div>
                )}
              </div>
            );
          })}
          {(docsByStage["__unstaged__"] ?? []).length > 0 && (
            <div className="rounded-2xl overflow-hidden" style={{ background: "white", border: "1px solid #E2E8F0" }}>
              <button onClick={() => toggleStage("__unstaged__")} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
                {expandedStages.has("__unstaged__") ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
                <Folder size={14} className="text-gray-400" />
                <span className="text-sm font-semibold text-gray-800">Unassigned to a stage</span>
                <span className="text-xs text-gray-400 ml-auto">{docsByStage["__unstaged__"].length} doc{docsByStage["__unstaged__"].length !== 1 ? "s" : ""}</span>
              </button>
              {expandedStages.has("__unstaged__") && (
                <div className="px-4 pb-4 space-y-2">
                  {docsByStage["__unstaged__"].map(d => <DocCard key={d.id} d={d} />)}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(d => <DocCard key={d.id} d={d} />)}
        </div>
      )}

      {/* Upload modal */}
      <Dialog open={showAdd} onOpenChange={v => { if (!v) setShowAdd(false); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Upload size={16} className="text-indigo-500" /> Upload Document</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-gray-500">Name</label>
              <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. URS v1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-500">Stage</label>
                <select value={form.stage} onChange={e => setForm({ ...form, stage: e.target.value })} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 mt-1">
                  <option value="">— None —</option>
                  {LIFECYCLE_STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500">Access</label>
                <select value={form.accessLevel} onChange={e => setForm({ ...form, accessLevel: e.target.value })} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 mt-1">
                  {ACCESS_LEVELS.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500">File URL</label>
              <Input value={form.fileUrl} onChange={e => setForm({ ...form, fileUrl: e.target.value })} placeholder="https://…" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500">Description</label>
              <Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Short summary" rows={2} />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500">Tags</label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {CATEGORY_TAGS.map(t => {
                  const on = form.tags.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setForm({ ...form, tags: on ? form.tags.filter(x => x !== t) : [...form.tags, t] })}
                      className="text-xs font-semibold px-2 py-0.5 rounded-full"
                      style={{ background: on ? "#4338CA" : "#F1F5F9", color: on ? "white" : "#475569" }}
                    >{t}</button>
                  );
                })}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50">Cancel</button>
              <button onClick={handleAdd} className="px-4 py-2 text-sm font-semibold text-white rounded-lg" style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)" }}>
                <Plus size={12} className="inline mr-1" /> Add
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Version history modal */}
      {versionDocId !== null && (
        <VersionHistoryModal documentId={versionDocId} onClose={() => { setVersionDocId(null); refetch(); }} />
      )}
    </div>
  );
}

function VersionHistoryModal({ documentId, onClose }: { documentId: number; onClose: () => void }) {
  const { toast } = useToast();
  const { data: versions = [], refetch } = useListDocumentVersions(documentId);
  const addVersion = useAddDocumentVersion();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ fileUrl: "", notes: "" });

  const vs = (versions as DocVersion[]).slice().sort((a, b) => b.version - a.version);

  function submit() {
    addVersion.mutate({
      id: documentId,
      data: { fileUrl: form.fileUrl || undefined, notes: form.notes || undefined },
    }, {
      onSuccess: () => { setShowForm(false); setForm({ fileUrl: "", notes: "" }); refetch(); toast({ title: "New version added" }); },
      onError: () => toast({ title: "Failed to add version", variant: "destructive" }),
    });
  }

  return (
    <Dialog open={true} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><History size={16} className="text-indigo-500" /> Version History</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {vs.length === 0 ? (
            <p className="text-sm text-gray-400 italic">No prior versions logged. Current is v1.</p>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {vs.map(v => (
                <div key={v.id} className="rounded-lg p-3" style={{ background: "#F8FAFC", border: "1px solid #E2E8F0" }}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-indigo-600">v{v.version}</span>
                    <span className="text-xs text-gray-400">{v.uploadedAt ? formatDate(v.uploadedAt) : "—"}</span>
                  </div>
                  {v.notes && <p className="text-xs text-gray-600 mt-1">{v.notes}</p>}
                  {v.fileUrl && <a href={v.fileUrl} target="_blank" rel="noreferrer" className="text-xs text-indigo-500 hover:underline">Open file</a>}
                </div>
              ))}
            </div>
          )}

          {showForm ? (
            <div className="space-y-2 border-t pt-3">
              <Input value={form.fileUrl} onChange={e => setForm({ ...form, fileUrl: e.target.value })} placeholder="New file URL" />
              <Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Change notes" />
              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowForm(false)} className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 hover:bg-gray-50">Cancel</button>
                <button onClick={submit} className="px-3 py-1.5 text-sm font-semibold text-white rounded-lg" style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)" }}>Save</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setShowForm(true)} className="w-full py-2 text-sm font-semibold rounded-lg flex items-center justify-center gap-1 text-indigo-600 hover:bg-indigo-50">
              <Plus size={13} /> Check in new version
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
