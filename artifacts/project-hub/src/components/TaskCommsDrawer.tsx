import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import { X, Paperclip, Send, FileText, Download, Loader2, MessageSquare } from "lucide-react";
import { FileDropzone, type UploadedFileMeta } from "@/components/ui/file-dropzone";
import { useToast } from "@/hooks/use-toast";

// The work-item a drawer is opened for. Works for any task / subtask / milestone
// row — caller supplies a display code + name and the ids used to scope messages.
export type TaskCommsTarget = {
  id: number;
  code: string;
  name: string;
  milestoneId?: number | null;
};

// Which sidebar section is shown.
type TaskCommsView = "communication" | "attachments";

type Attachment = { fileUrl: string; fileName: string; fileType?: string; fileSize?: number };
type Msg = {
  id: number;
  taskId?: number | null;
  senderId: number;
  body: string;
  attachments?: Attachment[];
  createdAt: string;
};

const fmtSize = (n?: number) => {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};
const fmtTime = (s: string) =>
  new Date(s).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * Right-side slide-over giving every task/milestone two sidebar sections:
 *   • Communication — a discussion thread + text composer (NO attachments here).
 *   • Attachments   — every file shared on the item, with upload.
 *
 * Backed by the existing `pmo_messages` table (task-scoped rows) and the
 * presigned-upload storage flow — no per-task tables needed. The page and this
 * drawer share the React Query key ["project-messages", projectId] so posting
 * here refreshes both the thread and the per-row badge counts.
 */
export function TaskCommsDrawer({
  projectId,
  task,
  onClose,
  senderId,
  resolveName,
}: {
  projectId: number;
  task: TaskCommsTarget | null;
  onClose: () => void;
  senderId: number;
  resolveName: (id: number) => string;
}) {
  const open = !!task;
  const { toast } = useToast();
  const qc = useQueryClient();

  // Retain the last target through the close animation so content doesn't blank.
  const [cached, setCached] = useState<TaskCommsTarget | null>(task);
  useEffect(() => { if (task) setCached(task); }, [task]);

  // Enter / exit slide.
  const [render, setRender] = useState(open);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (open) {
      setRender(true);
      const r = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(r);
    }
    setShown(false);
    const t = setTimeout(() => setRender(false), 200);
    return () => clearTimeout(t);
  }, [open]);

  // Composer state — reset when a different work-item opens.
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const taskId = task?.id;
  useEffect(() => { setBody(""); }, [taskId]);

  // Which sidebar section is shown — Communication or Attachments.
  const [view, setView] = useState<TaskCommsView>("communication");
  useEffect(() => { setView("communication"); }, [taskId]);

  const { data: allMsgs = [], isLoading } = useQuery({
    queryKey: ["project-messages", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/messages`);
      if (!r.ok) throw new Error("Failed to load messages");
      return (await r.json()) as Msg[];
    },
    enabled: render && projectId > 0,
  });

  const msgs = useMemo(
    () =>
      (allMsgs as Msg[])
        .filter((m) => m.taskId === cached?.id)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    [allMsgs, cached],
  );

  // Flat list of every attachment shared on this item (newest first).
  const attachments = useMemo(() => {
    const out: { att: Attachment; senderId: number; createdAt: string }[] = [];
    for (const m of msgs) for (const att of m.attachments ?? []) out.push({ att, senderId: m.senderId, createdAt: m.createdAt });
    return out.reverse();
  }, [msgs]);

  const post = async (text: string, atts: Attachment[]) => {
    if (!cached) return;
    const r = await fetch(`/api/projects/${projectId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        senderId,
        taskId: cached.id,
        milestoneId: cached.milestoneId ?? undefined,
        body: text || `Shared ${atts.length} attachment${atts.length === 1 ? "" : "s"}`,
        attachments: atts,
      }),
    });
    if (!r.ok) throw new Error("Failed to post");
    qc.invalidateQueries({ queryKey: ["project-messages", projectId] });
  };

  const send = async () => {
    const text = body.trim();
    if (!text) return;
    setSending(true);
    try {
      // Communication is text-only — files are shared from the Attachments tab.
      await post(text, []);
      setBody("");
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Could not send", variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  // Upload from the Attachments tab posts an attachment-only message immediately.
  const uploadAttachment = async (meta: UploadedFileMeta) => {
    try {
      await post("", [{ fileUrl: meta.fileUrl, fileName: meta.fileName, fileType: meta.fileType, fileSize: meta.fileSize }]);
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Upload failed", variant: "destructive" });
    }
  };

  // Attachments are auth-gated (/api/storage/objects/*), so they must be fetched
  // through the app's authed fetch (raw <a href> would 401). Stream to a blob,
  // then preview viewable types in a new tab and download the rest.
  const openAttachment = async (att: Attachment) => {
    try {
      const r = await fetch(att.fileUrl);
      if (!r.ok) throw new Error("Could not open file");
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener";
      const viewable = /^(image\/|application\/pdf|text\/)/.test(att.fileType ?? "");
      if (!viewable) a.download = att.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Could not open file", variant: "destructive" });
    }
  };

  if (!render || !cached) return null;
  const t = cached;

  const TabButton = ({ id, label, Icon, count }: { id: TaskCommsView; label: string; Icon: typeof MessageSquare; count: number }) => (
    <button
      type="button"
      onClick={() => setView(id)}
      className={`flex-1 inline-flex items-center justify-center gap-1.5 h-9 text-[12px] font-semibold border-b-2 transition-colors ${
        view === id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon size={14} /> {label}
      {count > 0 && (
        <span className="min-w-[16px] h-4 px-1 rounded-full bg-muted text-[10px] font-bold text-muted-foreground flex items-center justify-center">{count}</span>
      )}
    </button>
  );

  return createPortal(
    <div className="fixed inset-0 z-[140]">
      <div
        className={`absolute inset-0 bg-black/30 transition-opacity duration-200 ${shown ? "opacity-100" : "opacity-0"}`}
        onClick={onClose}
      />
      <div
        className={`absolute top-0 right-0 h-full w-full max-w-md bg-card border-l border-border shadow-2xl flex flex-col transition-transform duration-200 ${shown ? "translate-x-0" : "translate-x-full"}`}
      >
        {/* Header */}
        <div className="flex items-start gap-3 px-4 py-3 border-b border-border">
          <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <MessageSquare size={15} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[11px] text-muted-foreground">{t.code}</div>
            <h3 className="text-sm font-semibold text-foreground truncate" title={t.name}>{t.name}</h3>
            <p className="text-[11px] text-muted-foreground">Communication &amp; attachments</p>
          </div>
          <button type="button" onClick={onClose} title="Close" className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0">
            <X size={16} />
          </button>
        </div>

        {/* Section tabs */}
        <div className="flex items-stretch border-b border-border">
          <TabButton id="communication" label="Communication" Icon={MessageSquare} count={msgs.length} />
          <TabButton id="attachments" label="Attachments" Icon={Paperclip} count={attachments.length} />
        </div>

        {view === "communication" ? (
          <>
            {/* Thread */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {isLoading ? (
                <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 size={18} className="animate-spin" /></div>
              ) : msgs.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-center py-10 gap-2 text-muted-foreground/70">
                  <MessageSquare size={22} className="text-muted-foreground/40" />
                  <p className="text-sm">No comments yet</p>
                  <p className="text-[11px]">Start the conversation below.</p>
                </div>
              ) : (
                msgs.map((m) => (
                  <div key={m.id} className="rounded-lg border border-border bg-muted/20 px-3 py-2">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-[11px] font-semibold text-foreground truncate">{resolveName(m.senderId)}</span>
                      <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">{fmtTime(m.createdAt)}</span>
                    </div>
                    {m.body && <p className="text-[12px] text-foreground/90 whitespace-pre-wrap break-words">{m.body}</p>}
                    {(m.attachments ?? []).length > 0 && (
                      <div className="mt-2 flex flex-col gap-1">
                        {(m.attachments ?? []).map((att, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => openAttachment(att)}
                            className="group flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1 text-left hover:border-primary/50 hover:bg-primary/5 transition-colors"
                          >
                            <FileText size={13} className="text-primary shrink-0" />
                            <span className="text-[11px] text-foreground truncate flex-1">{att.fileName}</span>
                            {att.fileSize ? <span className="text-[10px] text-muted-foreground shrink-0">{fmtSize(att.fileSize)}</span> : null}
                            <Download size={12} className="text-muted-foreground/50 group-hover:text-primary shrink-0" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Composer — text only (attachments live in the Attachments tab) */}
            <div className="border-t border-border px-4 py-3 space-y-2">
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void send(); } }}
                placeholder="Write a comment…  (Ctrl+Enter to send)"
                rows={2}
                className="w-full resize-none rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
              <div className="flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => void send()}
                  disabled={sending || !body.trim()}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[12px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                  {sending ? "Sending…" : "Send"}
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Attachments list */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
              {isLoading ? (
                <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 size={18} className="animate-spin" /></div>
              ) : attachments.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-center py-10 gap-2 text-muted-foreground/70">
                  <Paperclip size={22} className="text-muted-foreground/40" />
                  <p className="text-sm">No attachments yet</p>
                  <p className="text-[11px]">Upload a file below to share it on this item.</p>
                </div>
              ) : (
                attachments.map(({ att, senderId: sid, createdAt }, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => openAttachment(att)}
                    className="group flex items-center gap-2.5 w-full rounded-lg border border-border bg-muted/20 px-3 py-2 text-left hover:border-primary/50 hover:bg-primary/5 transition-colors"
                  >
                    <FileText size={16} className="text-primary shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] text-foreground truncate">{att.fileName}</span>
                      <span className="block text-[10px] text-muted-foreground truncate">
                        {resolveName(sid)} · {fmtTime(createdAt)}{att.fileSize ? ` · ${fmtSize(att.fileSize)}` : ""}
                      </span>
                    </span>
                    <Download size={14} className="text-muted-foreground/50 group-hover:text-primary shrink-0" />
                  </button>
                ))
              )}
            </div>

            {/* Upload */}
            <div className="border-t border-border px-4 py-3">
              <FileDropzone onUploaded={(meta: UploadedFileMeta) => void uploadAttachment(meta)} />
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
