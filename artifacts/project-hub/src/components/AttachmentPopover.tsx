import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { FileDropzone, type UploadedFileMeta } from "@/components/ui/file-dropzone";
import { Paperclip, Trash2, FileText } from "lucide-react";
import { useUserStore } from "../lib/store";
import { useToast } from "@/hooks/use-toast";

export type AttachmentRow = {
  id: number; projectId: number; milestoneId?: number | null; taskId?: number | null;
  fileUrl: string; fileName: string; fileType?: string | null; fileSize?: number | null;
  uploadedBy?: number | null; createdAt?: string;
};

export const fmtAttSize = (n?: number | null) =>
  !n ? "" : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

/** One shared query per project — every row's paperclip reads the same cache,
 *  so all the icons cost a single fetch. Pass enabled=false to defer the fetch
 *  (e.g. on the projects table, where the badge comes from a bulk counts call
 *  and the file list only loads when a row's popover is actually opened). */
export function useProjectAttachments(projectId: number, enabled = true) {
  return useQuery({
    queryKey: ["/api/projects", projectId, "attachments"],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/attachments`, { credentials: "include" });
      return r.ok ? ((await r.json()) as AttachmentRow[]) : [];
    },
    enabled: enabled && Number.isFinite(projectId),
  });
}

/** Paperclip icon + count badge that opens a small popover to upload + manage
 *  the files clipped onto one project / task / subtask. taskId null = project. */
export function AttachmentPopover({
  projectId, taskId = null, milestoneId = null, label, count,
}: {
  projectId: number;
  taskId?: number | null;
  milestoneId?: number | null;
  label?: string;
  /** Pre-computed badge count (from a bulk query). When provided, the per-entity
   *  file list is fetched lazily — only once the popover is opened. */
  count?: number;
}) {
  const [open, setOpen] = useState(false);
  // When a count is supplied, defer the file fetch until the popover opens.
  const { data: all = [], isFetched } = useProjectAttachments(projectId, count === undefined || open);
  const qc = useQueryClient();
  const { userId } = useUserStore();
  const { toast } = useToast();

  const mine = all.filter((a) => (a.taskId ?? null) === (taskId ?? null));
  const badge = isFetched ? mine.length : (count ?? 0);
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["/api/projects", projectId, "attachments"] });
    void qc.invalidateQueries({ queryKey: ["/api/attachments/counts"] });
  };

  const upload = async (meta: UploadedFileMeta) => {
    const r = await fetch(`/api/projects/${projectId}/attachments`, {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId, milestoneId, fileUrl: meta.fileUrl, fileName: meta.fileName,
        fileType: meta.fileType, fileSize: meta.fileSize, uploadedBy: userId,
      }),
    });
    if (r.ok) { toast({ title: "Attached" }); invalidate(); }
    else toast({ title: "Attach failed", variant: "destructive" });
  };

  const remove = async (id: number) => {
    const r = await fetch(`/api/attachments/${id}`, { method: "DELETE", credentials: "include" });
    if (r.ok) invalidate();
    else toast({ title: "Delete failed", variant: "destructive" });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          title={`Attachments${badge ? ` (${badge})` : ""}`}
          aria-label="Attachments"
          className="relative inline-flex items-center justify-center w-5 h-5 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors shrink-0"
        >
          <Paperclip size={12} className={badge ? "text-primary" : ""} />
          {badge > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[13px] h-[13px] px-0.5 rounded-full bg-primary text-primary-foreground text-[8px] font-bold flex items-center justify-center num-tabular leading-none">
              {badge}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3" onClick={(e) => e.stopPropagation()}>
        <p className="text-[11px] font-semibold text-foreground mb-2">{label ?? "Attachments"}</p>
        {mine.length > 0 && (
          <ul className="space-y-1 mb-2 max-h-44 overflow-y-auto">
            {mine.map((a) => (
              <li key={a.id} className="flex items-center gap-1.5 text-[11px] group">
                <FileText size={12} className="text-muted-foreground shrink-0" />
                <a href={a.fileUrl} target="_blank" rel="noreferrer" className="truncate flex-1 hover:text-primary hover:underline" title={a.fileName}>{a.fileName}</a>
                {a.fileSize ? <span className="text-[9px] text-muted-foreground shrink-0">{fmtAttSize(a.fileSize)}</span> : null}
                <button type="button" onClick={() => void remove(a.id)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive shrink-0" title="Remove attachment">
                  <Trash2 size={11} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <FileDropzone compact onUploaded={(m) => void upload(m)} />
      </PopoverContent>
    </Popover>
  );
}
