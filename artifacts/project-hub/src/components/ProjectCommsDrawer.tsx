import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import { X, Paperclip, Send, FileText, Download, Loader2, MessageSquare, AtSign, Search, Check } from "lucide-react";
import { FileDropzone, type UploadedFileMeta } from "@/components/ui/file-dropzone";
import { useToast } from "@/hooks/use-toast";

// Which surface the drawer shows. `null` = closed.
export type ProjectCommsTab = "communication" | "attachments";

type Attachment = { fileUrl: string; fileName: string; fileType?: string; fileSize?: number };
type Msg = {
  id: number;
  taskId?: number | null;
  senderId: number;
  body: string;
  attachments?: Attachment[];
  taggedUserIds?: number[];
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

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Render a message body with each tagged person's "@<full name>" in blue.
// Names come from the message's taggedUserIds (resolved), so multi-word names
// match in full — longest first so a full name wins over a shorter one.
const renderBody = (text: string, taggedUserIds: number[], resolveName: (id: number) => string) => {
  const names = taggedUserIds.map(resolveName).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!names.length) return text;
  const re = new RegExp(`(@(?:${names.map(escapeRe).join("|")}))`, "g");
  return text.split(re).map((p, i) =>
    p.startsWith("@") && names.includes(p.slice(1))
      ? <span key={i} className="font-semibold text-blue-600">{p}</span>
      : p,
  );
};

// Detect an in-progress "@mention" immediately before the caret. Returns the
// query text typed after "@" and the index of the "@" so it can be replaced.
function detectMention(text: string, caret: number): { query: string; start: number } | null {
  const upto = text.slice(0, caret);
  const m = upto.match(/(?:^|\s)@([\w.\-]*)$/);
  if (!m) return null;
  const query = m[1] ?? "";
  return { query, start: caret - query.length - 1 };
}

/**
 * Project-level right-side slide-over with two surfaces:
 *   • Communication — a project-wide discussion thread + composer.
 *   • Attachments   — every file shared on the project, with upload.
 *
 * Backed by the existing `pmo_messages` table using PROJECT-scoped rows
 * (taskId == null), parallel to the task-scoped TaskCommsDrawer. Shares the
 * React Query key ["project-messages", projectId] so posting here keeps the
 * page's per-task badge counts in sync.
 */
export function ProjectCommsDrawer({
  projectId,
  projectCode,
  projectName,
  tab,
  onTabChange,
  onClose,
  senderId,
  resolveName,
  people,
}: {
  projectId: number;
  projectCode: string;
  projectName: string;
  /** Open when non-null; closed when null. (Both surfaces — the communication
      thread and the Attachments section — render together inside the drawer.) */
  tab: ProjectCommsTab | null;
  /** Accepted for API compatibility; the drawer no longer switches tabs. */
  onTabChange?: (t: ProjectCommsTab) => void;
  onClose: () => void;
  senderId: number;
  resolveName: (id: number) => string;
  /** Directory of taggable people for the composer's @-mention picker. */
  people: { id: number; name: string }[];
}) {
  const open = tab !== null;
  const { toast } = useToast();
  const qc = useQueryClient();

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

  // Composer state.
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  // Which sidebar section is shown — Communication or Attachments. Seeded from
  // the `tab` prop and re-synced whenever the parent opens the drawer on a tab,
  // but switchable in-place via the section tabs.
  const [view, setView] = useState<ProjectCommsTab>(tab ?? "communication");
  useEffect(() => { if (tab) setView(tab); }, [tab]);

  // People tagging.
  const [tagged, setTagged] = useState<number[]>([]);
  const [tagOpen, setTagOpen] = useState(false);
  const [tagQuery, setTagQuery] = useState("");
  const tagRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!tagOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (tagRef.current && !tagRef.current.contains(e.target as Node)) setTagOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [tagOpen]);
  const filteredPeople = useMemo(() => {
    const q = tagQuery.trim().toLowerCase();
    return people.filter((p) => !q || p.name.toLowerCase().includes(q)).slice(0, 50);
  }, [people, tagQuery]);

  // Inline "@" mention autocomplete in the message box.
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionStart, setMentionStart] = useState(0);
  const [mentionIndex, setMentionIndex] = useState(0);
  const mentionMatches = useMemo(() => {
    if (!mentionOpen) return [] as { id: number; name: string }[];
    const q = mentionQuery.trim().toLowerCase();
    return people.filter((p) => !q || p.name.toLowerCase().includes(q)).slice(0, 8);
  }, [mentionOpen, mentionQuery, people]);

  const onBodyChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setBody(text);
    const caret = e.target.selectionStart ?? text.length;
    const mention = detectMention(text, caret);
    if (mention) {
      setMentionOpen(true);
      setMentionQuery(mention.query);
      setMentionStart(mention.start);
      setMentionIndex(0);
    } else {
      setMentionOpen(false);
    }
  };

  const selectMention = (p: { id: number; name: string }) => {
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? body.length;
    const before = body.slice(0, mentionStart);
    const after = body.slice(caret);
    const insert = `@${p.name} `;
    setBody(before + insert + after);
    setTagged((t) => (t.includes(p.id) ? t : [...t, p.id]));
    setMentionOpen(false);
    const pos = (before + insert).length;
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (ta) { ta.focus(); ta.setSelectionRange(pos, pos); }
    });
  };

  const onBodyKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionOpen && mentionMatches.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setMentionIndex((i) => (i + 1) % mentionMatches.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setMentionIndex((i) => (i - 1 + mentionMatches.length) % mentionMatches.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); selectMention(mentionMatches[mentionIndex] ?? mentionMatches[0]!); return; }
      if (e.key === "Escape") { e.preventDefault(); setMentionOpen(false); return; }
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void send(); }
  };

  const { data: allMsgs = [], isLoading } = useQuery({
    queryKey: ["project-messages", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/messages`);
      if (!r.ok) throw new Error("Failed to load messages");
      return (await r.json()) as Msg[];
    },
    // projectId 0 = the workspace-wide "All Projects" global thread.
    enabled: render && projectId >= 0,
  });

  // Project-level rows only (taskId null) — task threads live in TaskCommsDrawer.
  const msgs = useMemo(
    () =>
      (allMsgs as Msg[])
        .filter((m) => m.taskId == null)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    [allMsgs],
  );

  // Flat list of every attachment shared on the project thread (newest first).
  const attachments = useMemo(() => {
    const out: { att: Attachment; senderId: number; createdAt: string }[] = [];
    for (const m of msgs) for (const att of m.attachments ?? []) out.push({ att, senderId: m.senderId, createdAt: m.createdAt });
    return out.reverse();
  }, [msgs]);

  const post = async (text: string, atts: Attachment[], tags: number[] = []) => {
    const r = await fetch(`/api/projects/${projectId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        senderId,
        taskId: null, // project-scoped
        body: text || `Shared ${atts.length} attachment${atts.length === 1 ? "" : "s"}`,
        attachments: atts,
        taggedUserIds: tags,
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
      await post(text, [], tagged);
      setBody("");
      setTagged([]);
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

  // Attachments are auth-gated, so stream through the authed fetch then preview
  // viewable types / download the rest (raw <a href> would 401).
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

  if (!render) return null;

  const TabButton = ({ id, label, Icon, count }: { id: ProjectCommsTab; label: string; Icon: typeof MessageSquare; count: number }) => (
    <button
      type="button"
      onClick={() => { setView(id); onTabChange?.(id); }}
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
            <div className="font-mono text-[11px] text-muted-foreground">{projectCode}</div>
            <h3 className="text-sm font-semibold text-foreground truncate" title={projectName}>{projectName}</h3>
            <p className="text-[11px] text-muted-foreground">Project communication &amp; attachments</p>
          </div>
          <button type="button" onClick={onClose} title="Close" className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0">
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
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
                  <p className="text-sm">No messages yet</p>
                  <p className="text-[11px]">Start the project conversation or attach a file below.</p>
                </div>
              ) : (
                msgs.map((m) => (
                  <div key={m.id} className="rounded-lg border border-border bg-muted/20 px-3 py-2">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-[11px] font-semibold text-foreground truncate">{resolveName(m.senderId)}</span>
                      <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">{fmtTime(m.createdAt)}</span>
                    </div>
                    {m.body && <p className="text-[12px] text-foreground/90 whitespace-pre-wrap break-words">{renderBody(m.body, m.taggedUserIds ?? [], resolveName)}</p>}
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

            {/* Composer */}
            <div className="border-t border-border px-4 py-3 space-y-2">
              {/* Tagged people — chips + add picker */}
              <div className="flex flex-wrap items-center gap-1.5">
                {tagged.map((uid) => (
                  <span key={uid} className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2 h-6 text-[11px] font-medium">
                    <AtSign size={10} />{resolveName(uid)}
                    <button type="button" onClick={() => setTagged((t) => t.filter((x) => x !== uid))} className="ml-0.5 text-primary/60 hover:text-primary" title="Remove">
                      <X size={11} />
                    </button>
                  </span>
                ))}
                <div className="relative" ref={tagRef}>
                  <button
                    type="button"
                    onClick={() => setTagOpen((o) => !o)}
                    title="Tag people"
                    className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 h-6 text-[11px] font-medium text-muted-foreground hover:text-primary hover:border-primary/50 transition-colors"
                  >
                    <AtSign size={11} /> Tag people
                  </button>
                  {tagOpen && (
                    <div className="absolute left-0 bottom-full mb-1.5 z-50 w-60 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg">
                      <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-border">
                        <Search size={12} className="text-muted-foreground shrink-0" />
                        <input
                          autoFocus
                          value={tagQuery}
                          onChange={(e) => setTagQuery(e.target.value)}
                          placeholder="Search people…"
                          className="w-full bg-transparent text-[12px] outline-none placeholder:text-muted-foreground/60"
                        />
                      </div>
                      <div className="max-h-56 overflow-y-auto py-1">
                        {filteredPeople.length === 0 ? (
                          <div className="px-3 py-3 text-[11px] text-muted-foreground text-center">No people found</div>
                        ) : (
                          filteredPeople.map((p) => {
                            const on = tagged.includes(p.id);
                            return (
                              <button
                                key={p.id}
                                type="button"
                                onClick={() => setTagged((t) => (on ? t.filter((x) => x !== p.id) : [...t, p.id]))}
                                className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 text-[12px] text-left transition-colors ${on ? "bg-primary/10 text-primary" : "hover:bg-accent"}`}
                              >
                                <span className="truncate">{p.name}</span>
                                {on && <Check size={13} className="shrink-0" />}
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className="relative">
                {mentionOpen && mentionMatches.length > 0 && (
                  <div className="absolute left-0 bottom-full mb-1.5 z-50 w-60 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg py-1 max-h-56 overflow-y-auto">
                    <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Tag a person</div>
                    {mentionMatches.map((p, i) => (
                      <button
                        key={p.id}
                        type="button"
                        onMouseDown={(e) => { e.preventDefault(); selectMention(p); }}
                        onMouseEnter={() => setMentionIndex(i)}
                        className={`w-full flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-left transition-colors ${i === mentionIndex ? "bg-primary/10 text-primary" : "hover:bg-accent"}`}
                      >
                        <AtSign size={11} className="shrink-0 text-muted-foreground" />
                        <span className="truncate">{p.name}</span>
                      </button>
                    ))}
                  </div>
                )}
                <textarea
                  ref={textareaRef}
                  value={body}
                  onChange={onBodyChange}
                  onKeyDown={onBodyKeyDown}
                  placeholder="Write a message…  (@ to tag · Ctrl+Enter to send)"
                  rows={2}
                  className="w-full resize-none rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary/40"
                />
              </div>
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
                  <p className="text-[11px]">Upload a file below to share it on this project.</p>
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
