import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Paperclip, FileText, Trash2, Flag, ListChecks, CornerDownRight, FolderKanban, ChevronDown, ChevronRight, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useProjectAttachments, fmtAttSize, type AttachmentRow } from "./AttachmentPopover";
import { FilePreviewModal } from "./FilePreviewBody";

type TaskLite = { id: number; name: string; milestoneId?: number | null; parentTaskId?: number | null };
type MilestoneLite = { id: number; name: string };

const taskCode = (id: number) => `TSK-${String(id).padStart(4, "0")}`;

/** Thin Dialog wrapper around <AttachmentsTree>. Kept for any standalone callers;
 *  the project header now embeds the tree as a tab inside the Documents modal. */
export function AttachmentsTreeModal({
  open, onClose, projectId, projectName, projectCode, tasks, milestones,
}: {
  open: boolean;
  onClose: () => void;
  projectId: number;
  projectName?: string;
  projectCode?: string;
  tasks: TaskLite[];
  milestones: MilestoneLite[];
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[15px]">
            <Paperclip size={16} className="text-primary" /> Attachments
          </DialogTitle>
          <DialogDescription className="text-[11px]">
            {projectCode ? `${projectCode} · ` : ""}{projectName ?? "Project"} — organised by milestone → task → subtask
          </DialogDescription>
        </DialogHeader>
        <AttachmentsTree projectId={projectId} tasks={tasks} milestones={milestones} />
      </DialogContent>
    </Dialog>
  );
}

/** All of a project's attachments, organised systematically: milestone → task →
 *  subtask (with a project-level bucket on top). Embedded in the Documents modal. */
export function AttachmentsTree({
  projectId, tasks, milestones,
}: {
  projectId: number;
  tasks: TaskLite[];
  milestones: MilestoneLite[];
}) {
  const { data: all = [] } = useProjectAttachments(projectId);
  const qc = useQueryClient();
  const { toast } = useToast();
  const remove = async (id: number) => {
    const r = await fetch(`/api/attachments/${id}`, { method: "DELETE", credentials: "include" });
    if (r.ok) void qc.invalidateQueries({ queryKey: ["/api/projects", projectId, "attachments"] });
    else toast({ title: "Delete failed", variant: "destructive" });
  };

  const tasksById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const msName = useMemo(() => new Map(milestones.map((m) => [m.id, m.name])), [milestones]);
  const msOrder = useMemo(() => new Map(milestones.map((m, i) => [m.id, i])), [milestones]);

  const projectLevel = all.filter((a) => a.taskId == null && a.milestoneId == null);

  type SubNode = { code: string; name: string; atts: AttachmentRow[] };
  type TaskNode = { code: string; name: string; atts: AttachmentRow[]; subs: Map<number, SubNode> };
  type MsNode = { key: string; name: string; order: number; atts: AttachmentRow[]; tasks: Map<number, TaskNode> };

  const tree = useMemo(() => {
    const ms = new Map<string, MsNode>();
    const ensureMs = (mid: number | null) => {
      const key = mid == null ? "none" : String(mid);
      if (!ms.has(key)) ms.set(key, { key, name: mid == null ? "No milestone" : (msName.get(mid) ?? `Milestone ${mid}`), order: mid == null ? 1e9 : (msOrder.get(mid) ?? 1e8), atts: [], tasks: new Map() });
      return ms.get(key)!;
    };
    const ensureTask = (g: MsNode, id: number, name: string) => {
      if (!g.tasks.has(id)) g.tasks.set(id, { code: taskCode(id), name, atts: [], subs: new Map() });
      return g.tasks.get(id)!;
    };

    for (const a of all) {
      if (a.taskId == null) {
        // Milestone-general attachment (no task): list it directly under its
        // milestone; fully-general rows are handled by projectLevel above.
        if (a.milestoneId != null) ensureMs(a.milestoneId).atts.push(a);
        continue;
      }
      const t = tasksById.get(a.taskId);
      if (t && t.parentTaskId != null) {
        // Subtask: nest under its parent task, under the parent's milestone.
        const parent = tasksById.get(t.parentTaskId);
        const mid = parent?.milestoneId ?? t.milestoneId ?? null;
        const g = ensureMs(mid ?? null);
        const tn = ensureTask(g, parent?.id ?? t.parentTaskId, parent?.name ?? `Task ${t.parentTaskId}`);
        if (!tn.subs.has(t.id)) tn.subs.set(t.id, { code: taskCode(t.id), name: t.name, atts: [] });
        tn.subs.get(t.id)!.atts.push(a);
      } else {
        const mid = t?.milestoneId ?? null;
        const g = ensureMs(mid ?? null);
        ensureTask(g, t?.id ?? a.taskId, t?.name ?? `Task ${a.taskId}`).atts.push(a);
      }
    }
    return [...ms.values()].sort((x, y) => x.order - y.order);
  }, [all, tasksById, msName, msOrder]);

  // Accordion open-state — milestones + tasks collapse independently.
  const [openMs, setOpenMs] = useState<Set<string>>(() => new Set());
  const [preview, setPreview] = useState<AttachmentRow | null>(null);
  const [openTasks, setOpenTasks] = useState<Set<string>>(() => new Set());
  const toggle = (set: React.Dispatch<React.SetStateAction<Set<string>>>, k: string) =>
    set((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const subCount = (tn: TaskNode) => tn.atts.length + [...tn.subs.values()].reduce((z, sn) => z + sn.atts.length, 0);
  const msCount = (g: MsNode) => g.atts.length + [...g.tasks.values()].reduce((z, tn) => z + subCount(tn), 0);

  const CountPill = ({ n }: { n: number }) => (
    <span className="shrink-0 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-primary/10 text-primary text-[10px] font-semibold tabular-nums">{n}</span>
  );

  const AttRow = ({ a }: { a: AttachmentRow }) => (
    <li className="flex items-center gap-1.5 text-[11px] group py-0.5">
      <FileText size={12} className="text-muted-foreground shrink-0" />
      <button type="button" onClick={() => setPreview(a)} className="truncate flex-1 text-left hover:text-primary hover:underline" title={`Preview ${a.fileName}`}>{a.fileName}</button>
      {a.fileSize ? <span className="text-[9px] text-muted-foreground shrink-0">{fmtAttSize(a.fileSize)}</span> : null}
      <a href={a.fileUrl} download={a.fileName} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary shrink-0" title="Download"><Download size={11} /></a>
      <button type="button" onClick={() => void remove(a.id)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive shrink-0" title="Remove attachment"><Trash2 size={11} /></button>
    </li>
  );

  return (
    all.length === 0 ? (
      <p className="text-xs text-muted-foreground text-center py-10">No attachments yet. Use the paperclip icon beside any project, task or subtask code to add one.</p>
    ) : (
      <div className="space-y-2">
        {/* Project-level accordion */}
        {projectLevel.length > 0 && (() => {
          const open = openMs.has("__project__");
          return (
            <div className="rounded-lg border border-border/60 overflow-hidden">
              <button type="button" onClick={() => toggle(setOpenMs, "__project__")} className="w-full flex items-center gap-1.5 px-2.5 py-2 hover:bg-accent/40 transition-colors">
                {open ? <ChevronDown size={13} className="text-muted-foreground shrink-0" /> : <ChevronRight size={13} className="text-muted-foreground shrink-0" />}
                <FolderKanban size={13} className="text-primary shrink-0" />
                <span className="flex-1 text-left text-[12px] font-semibold text-card-foreground truncate">Project-level</span>
                <CountPill n={projectLevel.length} />
              </button>
              {open && <ul className="px-2.5 pb-2 pl-8">{projectLevel.map((a) => <AttRow key={a.id} a={a} />)}</ul>}
            </div>
          );
        })()}

        {/* Milestone accordion → Task accordion → subtask list */}
        {tree.map((g) => {
          const msOpen = openMs.has(g.key);
          return (
            <div key={g.key} className="rounded-lg border border-border/60 overflow-hidden">
              <button type="button" onClick={() => toggle(setOpenMs, g.key)} className="w-full flex items-center gap-1.5 px-2.5 py-2 hover:bg-accent/40 transition-colors">
                {msOpen ? <ChevronDown size={13} className="text-muted-foreground shrink-0" /> : <ChevronRight size={13} className="text-muted-foreground shrink-0" />}
                <Flag size={13} className="text-warn shrink-0" />
                <span className="flex-1 text-left text-[12px] font-semibold text-card-foreground truncate">{g.name}</span>
                <CountPill n={msCount(g)} />
              </button>
              {msOpen && (
                <div className="px-2 pb-2 space-y-1.5">
                  {g.atts.length > 0 && <ul className="pl-8">{g.atts.map((a) => <AttRow key={a.id} a={a} />)}</ul>}
                  {[...g.tasks.values()].map((tn) => {
                    const tKey = `${g.key}:${tn.code}`;
                    const tOpen = openTasks.has(tKey);
                    return (
                      <div key={tn.code} className="rounded-md border border-border/40 overflow-hidden">
                        <button type="button" onClick={() => toggle(setOpenTasks, tKey)} className="w-full flex items-center gap-1.5 px-2 py-1.5 hover:bg-accent/30 transition-colors">
                          {tOpen ? <ChevronDown size={12} className="text-muted-foreground shrink-0" /> : <ChevronRight size={12} className="text-muted-foreground shrink-0" />}
                          <ListChecks size={12} className="text-muted-foreground shrink-0" />
                          <span className="font-mono text-[10px] text-muted-foreground shrink-0">{tn.code}</span>
                          <span className="flex-1 text-left text-[11.5px] font-medium text-card-foreground truncate">{tn.name}</span>
                          <CountPill n={subCount(tn)} />
                        </button>
                        {tOpen && (
                          <div className="px-2 pb-1.5">
                            {tn.atts.length > 0 && <ul className="pl-6">{tn.atts.map((a) => <AttRow key={a.id} a={a} />)}</ul>}
                            {[...tn.subs.values()].map((sn) => (
                              <div key={sn.code} className="pl-6 mt-1">
                                <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                  <CornerDownRight size={11} />
                                  <span className="font-mono text-[10px]">{sn.code}</span>
                                  <span className="truncate">{sn.name}</span>
                                </p>
                                <ul className="pl-6">{sn.atts.map((a) => <AttRow key={a.id} a={a} />)}</ul>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {/* In-app quick view — same renderer as the documents repository. */}
        {preview && (
          <FilePreviewModal
            name={preview.fileName}
            url={preview.fileUrl}
            fileType={preview.fileType}
            onClose={() => setPreview(null)}
          />
        )}
      </div>
    )
  );
}
