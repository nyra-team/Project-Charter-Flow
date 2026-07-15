import { Fragment, useEffect, useMemo, useState } from "react";
import { useListProjects, useListMilestones, useListTasks, useListDocuments } from "@workspace/api-client-react";
import { AttachmentPopover, useProjectAttachments, fmtAttSize, type AttachmentRow } from "./AttachmentPopover";
import { FilePreviewModal } from "./FilePreviewBody";
import { ChevronDown, ChevronRight, FolderKanban, Search, Files, Flag, ListChecks, CornerDownRight, FileText, Download, Eye } from "lucide-react";

type Project = { id: number; name: string; status: string };
type CountRow = { projectId: number; count: number };
type TaskLite = { id: number; name: string; milestoneId?: number | null; parentTaskId?: number | null };
type MilestoneLite = { id: number; name: string };
type DocLite = { id: number; name: string; fileUrl?: string | null; fileType?: string | null; version?: number };
type PreviewTarget = { name: string; url?: string | null; fileType?: string | null };

/**
 * Pull a private file's bytes through the token-injected window.fetch, then save
 * the blob. A bare <a download> to a storage URL 401s ("Missing bearer token").
 */
async function downloadViaFetch(url: string, name: string) {
  try {
    const res = await fetch(url);
    if (!res.ok) return;
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objUrl;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objUrl);
  } catch { /* ignore */ }
}

/**
 * "By Project" browser for the central Document Repository: a simple flat list of
 * projects. Expand one to see its project / milestone / task / subtask hierarchy,
 * where every node lists its uploaded documents (View + Download) and carries a
 * paperclip to attach a new file at that exact level. No filters, no upload button.
 */
export function DocumentsBrowseTree() {
  const { data: projects = [] } = useListProjects();
  const projectsArr = projects as Project[];
  const [counts, setCounts] = useState<Map<number, number>>(new Map());
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Set<number>>(() => new Set());

  // Per-project attachment tally drives the row badge. One cheap call.
  useEffect(() => {
    fetch("/api/attachments/counts")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: CountRow[]) => setCounts(new Map((Array.isArray(rows) ? rows : []).map((r) => [r.projectId, r.count]))))
      .catch(() => setCounts(new Map()));
  }, []);

  const sorted = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return [...projectsArr]
      .filter((p) => !needle || p.name.toLowerCase().includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [projectsArr, q]);

  const toggle = (id: number) =>
    setOpen((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div className="space-y-3">
      <div className="relative max-w-sm">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search projects…"
          className="w-full rounded-md border border-input bg-background pl-8 pr-3 py-1.5 text-sm"
        />
      </div>

      {sorted.length === 0 ? (
        <div className="glass-surface rounded-2xl p-10 text-center text-sm text-muted-foreground">
          {projectsArr.length === 0 ? "No projects yet." : "No projects match your search."}
        </div>
      ) : (
        <div className="glass-surface rounded-2xl border border-border/60 overflow-hidden divide-y divide-border/50">
          {sorted.map((p) => {
            const isOpen = open.has(p.id);
            const n = counts.get(p.id) ?? 0;
            return (
              <div key={p.id}>
                <button
                  type="button"
                  onClick={() => toggle(p.id)}
                  className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-accent/40 transition-colors"
                >
                  {isOpen ? <ChevronDown size={15} className="text-muted-foreground shrink-0" /> : <ChevronRight size={15} className="text-muted-foreground shrink-0" />}
                  <FolderKanban size={15} className="text-primary shrink-0" />
                  <span className="flex-1 text-left text-sm font-semibold text-foreground truncate">{p.name}</span>
                  {n > 0 && (
                    <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
                      <Files size={12} /> {n}
                    </span>
                  )}
                </button>
                {isOpen && (
                  <div className="px-4 pb-4 pt-1 bg-muted/20">
                    <ProjectAttachTree projectId={p.id} projectName={p.name} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * A project's collapsible hierarchy (project → milestone → task → subtask). Each
 * node lists its uploaded documents / attachments with View + Download buttons,
 * and shows a paperclip (<AttachmentPopover>) to attach a new file at that level.
 */
function ProjectAttachTree({ projectId, projectName }: { projectId: number; projectName: string }) {
  const { data: tasksData = [] } = useListTasks(projectId);
  const { data: msData = [] } = useListMilestones(projectId);
  const { data: attsData = [] } = useProjectAttachments(projectId);
  const { data: docsData = [] } = useListDocuments(projectId);
  const tasks = tasksData as TaskLite[];
  const milestones = msData as MilestoneLite[];
  const atts = attsData as AttachmentRow[];
  // Project-level repository documents that carry a file (uploaded documents).
  const repoDocs = (docsData as DocLite[]).filter((d) => d.fileUrl);

  const [openKeys, setOpenKeys] = useState<Set<string>>(() => new Set());
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  const toggle = (k: string) => setOpenKeys((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });

  const subsByParent = useMemo(() => {
    const m = new Map<number, TaskLite[]>();
    for (const t of tasks) {
      if (t.parentTaskId == null) continue;
      const arr = m.get(t.parentTaskId) ?? [];
      arr.push(t);
      m.set(t.parentTaskId, arr);
    }
    return m;
  }, [tasks]);
  const tasksByMs = useMemo(() => {
    const m = new Map<number, TaskLite[]>();
    for (const t of tasks) {
      if (t.parentTaskId != null) continue; // top-level only
      const key = t.milestoneId ?? -1; // -1 = tasks not under any milestone
      const arr = m.get(key) ?? [];
      arr.push(t);
      m.set(key, arr);
    }
    return m;
  }, [tasks]);

  const projAtts = atts.filter((a) => a.taskId == null && a.milestoneId == null);
  const msAtts = (mid: number) => atts.filter((a) => a.taskId == null && (a.milestoneId ?? null) === mid);
  const taskAtts = (tid: number) => atts.filter((a) => (a.taskId ?? null) === tid);

  // One file row: name + View (preview) + Download buttons.
  const fileRow = (key: string, name: string, viewUrl: string | null | undefined, fileType: string | null | undefined, downloadUrl: string, size?: number | null) => (
    <li key={key} className="flex items-center gap-2 text-[11px] py-0.5">
      <FileText size={11} className="text-muted-foreground shrink-0" />
      <span className="truncate flex-1 text-foreground/90">{name}</span>
      {size ? <span className="text-[9px] text-muted-foreground shrink-0">{fmtAttSize(size)}</span> : null}
      <button type="button" onClick={() => setPreview({ name, url: viewUrl ?? null, fileType: fileType ?? null })} className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors">
        <Eye size={11} /> View
      </button>
      <button type="button" onClick={() => void downloadViaFetch(downloadUrl, name)} className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors">
        <Download size={11} /> Download
      </button>
    </li>
  );

  // Inline file list for a node: repository documents first (project node only), then attachments.
  const fileList = (list: AttachmentRow[], indent: number, docs?: DocLite[]) => {
    if (list.length === 0 && (!docs || docs.length === 0)) return null;
    return (
      <ul className="space-y-0.5 py-0.5" style={{ paddingLeft: indent }}>
        {(docs ?? []).map((d) => fileRow(`doc-${d.id}`, `${d.name}${d.version ? ` (v${d.version})` : ""}`, `/api/documents/${d.id}/raw`, d.fileType, `/api/documents/${d.id}/raw`))}
        {list.map((a) => fileRow(`att-${a.id}`, a.fileName, a.fileUrl, a.fileType, a.fileUrl, a.fileSize))}
      </ul>
    );
  };

  // One task (and its subtasks) as collapsible rows.
  const renderTask = (t: TaskLite, mid: number | null, indent: number) => {
    const tKey = `t-${t.id}`;
    const tOpen = openKeys.has(tKey);
    const subs = subsByParent.get(t.id) ?? [];
    return (
      <Fragment key={tKey}>
        <div className="flex items-center gap-1.5 rounded px-1.5 py-1 hover:bg-accent/40 transition-colors" style={{ paddingLeft: indent }}>
          {subs.length > 0 ? (
            <button type="button" onClick={() => toggle(tKey)} className="shrink-0 text-muted-foreground hover:text-foreground">
              {tOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
          ) : <span className="w-3 shrink-0" />}
          <ListChecks size={12} className="text-muted-foreground shrink-0" />
          <span className="flex-1 truncate text-[13px] text-foreground/90">{t.name}</span>
          <AttachmentPopover projectId={projectId} taskId={t.id} milestoneId={mid ?? undefined} label={`${t.name} attachments`} />
        </div>
        {fileList(taskAtts(t.id), indent + 24)}
        {tOpen && subs.map((s) => (
          <Fragment key={`s-${s.id}`}>
            <div className="flex items-center gap-1.5 rounded px-1.5 py-1 hover:bg-accent/40 transition-colors" style={{ paddingLeft: indent + 16 }}>
              <span className="w-3 shrink-0" />
              <CornerDownRight size={12} className="text-muted-foreground/70 shrink-0" />
              <span className="flex-1 truncate text-[13px] text-foreground/90">{s.name}</span>
              <AttachmentPopover projectId={projectId} taskId={s.id} milestoneId={mid ?? undefined} label={`${s.name} attachments`} />
            </div>
            {fileList(taskAtts(s.id), indent + 40)}
          </Fragment>
        ))}
      </Fragment>
    );
  };

  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-1.5">
      {/* Project node */}
      <div className="flex items-center gap-1.5 rounded px-1.5 py-1 hover:bg-accent/40 transition-colors" style={{ paddingLeft: 4 }}>
        <FolderKanban size={13} className="text-primary shrink-0" />
        <span className="flex-1 truncate text-[13px] font-semibold text-foreground">{projectName}</span>
        <AttachmentPopover projectId={projectId} label={`${projectName} attachments`} />
      </div>
      {fileList(projAtts, 26, repoDocs)}

      {/* Milestones (collapsible) → tasks → subtasks */}
      {milestones.map((m) => {
        const mKey = `m-${m.id}`;
        const mOpen = openKeys.has(mKey);
        const mTasks = tasksByMs.get(m.id) ?? [];
        return (
          <Fragment key={mKey}>
            <div className="flex items-center gap-1.5 rounded px-1.5 py-1 hover:bg-accent/40 transition-colors" style={{ paddingLeft: 16 }}>
              <button type="button" onClick={() => toggle(mKey)} className="shrink-0 text-muted-foreground hover:text-foreground">
                {mOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </button>
              <Flag size={12} className="text-primary shrink-0" />
              <span className="flex-1 truncate text-[13px] font-medium text-foreground">{m.name}</span>
              <AttachmentPopover projectId={projectId} milestoneId={m.id} label={`${m.name} attachments`} />
            </div>
            {mOpen && (
              <>
                {fileList(msAtts(m.id), 44)}
                {mTasks.map((t) => renderTask(t, m.id, 32))}
              </>
            )}
          </Fragment>
        );
      })}

      {/* Tasks not assigned to any milestone */}
      {(tasksByMs.get(-1) ?? []).map((t) => renderTask(t, null, 16))}

      {milestones.length === 0 && tasks.length === 0 && projAtts.length === 0 && repoDocs.length === 0 && (
        <p className="px-2 py-3 text-xs text-muted-foreground">No milestones, tasks or documents yet. Use the paperclip on the project row to attach a project-level file.</p>
      )}

      {preview && (
        <FilePreviewModal name={preview.name} url={preview.url} fileType={preview.fileType} onClose={() => setPreview(null)} />
      )}
    </div>
  );
}
