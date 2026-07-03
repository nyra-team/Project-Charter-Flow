// Task detail modal — an exact clone of Jira's issue view (Kevin-Stratvert layout).
// Left column: breadcrumb header, title, +/settings actions, Description (click to
// edit a draggable text field), Subtasks (with an "Add subtask" dropdown), Linked
// work items, and an Activity block with All / Comments / History / Work log tabs.
// Right sidebar: status + lightning + Improve Task, a dismissable "Pinned fields"
// panel, and the "Details" panel (Assignee, Priority, Parent, Due date, Labels,
// Team, Start date, Development, Reporter). Wired to pmo_tasks + pmo_messages.
import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useListUsers, useCreateTask } from "@workspace/api-client-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Link } from "wouter";
import {
  Paperclip, X, ChevronUp, ChevronDown, Plus, Pencil, Copy,
  CheckSquare, MoreHorizontal, Eye, Share2,
  Bold, Italic, List, ListOrdered, ListChecks, Table,
  AtSign, Smile, Check, FolderKanban, Flag, CornerDownRight,
} from "lucide-react";
import { api } from "@/lib/extra-api";
import { CompletionApprovalBanner, useReasonPrompt } from "./CompletionApproval";
import { useDateJustify } from "@/components/date-justify";
import { parentEndToExtend } from "@/lib/cascadeParentEnd";
import { buildWbsCodes, wbsLabel } from "@/lib/wbs";
import { useToast } from "@/hooks/use-toast";
import { useUserStore } from "@/lib/store";
import { PersonAvatar } from "./person-avatar";
import { StatusSelect, PrioritySelect } from "./task-status-chip";
import { Skeleton } from "@/components/ui/skeleton";
import { FileDropzone } from "@/components/ui/file-dropzone";
import type { AggTask, TaskComment } from "@/lib/work-types";

// Broad emoji set for the editor picker.
const EMOJIS = "😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤨 🧐 🤓 😎 🥳 🤩 😏 😒 😞 😔 😟 😕 🙁 ☹️ 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🤗 🤔 🤭 🤫 🤥 😬 🙄 😯 😦 😧 😮 😲 🥱 😴 🤤 😪 😵 🤐 🥴 🤢 🤮 🤧 😷 🤒 🤕 🤑 🤠 👍 👎 👌 ✌️ 🤞 🤟 🤘 👏 🙌 👐 🤝 🙏 💪 👀 🎉 🎊 ✅ ❌ ⭐ 🌟 🔥 💯 ✨ ⚡ 💡 📌 📎 📝 ✏️ 📅 ⏰ ✔️ ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🚀 🎯 🏆 ⚠️ ℹ️".split(" ");

type AttView = { fileName?: string; name?: string; fileUrl?: string; url?: string } & Record<string, unknown>;
const attName = (a: AttView) => a.fileName ?? a.name ?? "file";

// Editor toolbar bits. onMouseDown+preventDefault keeps the contentEditable
// selection so execCommand applies to the highlighted text.
function ToolBtn({ children, onClick, title }: { children: React.ReactNode; onClick?: () => void; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => { e.preventDefault(); onClick?.(); }}
      className="inline-flex items-center h-7 px-1.5 rounded text-[#44546f] hover:bg-[#f1f2f4]"
    >
      {children}
    </button>
  );
}
function Divider() {
  return <span className="w-px h-5 bg-[#dfe1e6] mx-1" />;
}

// One label/value row in the right-hand Details panel (Jira's grid).
function SidebarRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-start gap-3 py-1.5">
      <span className="text-[12px] text-[#626f86] pt-0.5">{label}</span>
      <div className="min-w-0 text-[12px] text-[#172b4d]">{children}</div>
    </div>
  );
}

// Searchable assignee popup — used for the task's Assignee and each subtask's
// assignee. Portals to <body> with fixed coords so it isn't clipped by the
// dialog's overflow; closes on outside-click / scroll. `children` is the trigger.
function AssigneePicker({ value, people, onPick, children, title = "Assign" }: {
  value: number | null | undefined;
  people: Array<{ id: number; name: string }>;
  onPick: (id: number | null) => void;
  children: React.ReactNode;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const place = () => { const r = btnRef.current?.getBoundingClientRect(); if (r) setPos({ left: r.left, top: r.bottom + 4 }); };
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { const t = e.target as Node; if (!btnRef.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false); };
    const onScroll = () => setOpen(false);
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => { document.removeEventListener("mousedown", onDoc); window.removeEventListener("scroll", onScroll, true); window.removeEventListener("resize", onScroll); };
  }, [open]);
  const needle = q.trim().toLowerCase();
  const list = needle ? people.filter((u) => u.name?.toLowerCase().includes(needle)) : people;
  const pick = (id: number | null) => { setOpen(false); setQ(""); if (id !== (value ?? null)) onPick(id); };
  return (
    <>
      <button ref={btnRef} type="button" title={title} onClick={(e) => { e.stopPropagation(); if (!open) place(); setOpen((o) => !o); }} className="inline-flex items-center gap-2 min-w-0 cursor-pointer hover:opacity-80">
        {children}
      </button>
      {open && pos && createPortal(
        <div ref={menuRef} style={{ position: "fixed", left: pos.left, top: pos.top }} className="z-[400] w-56 rounded-lg bg-white border border-[#dfe1e6] shadow-xl py-1" onClick={(e) => e.stopPropagation()}>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people…" className="w-[calc(100%-12px)] mx-1.5 mb-1 px-2 py-1 text-xs border border-[#c1c7d0] rounded outline-none focus:border-[#1868db]" />
          <div className="max-h-56 overflow-y-auto">
            <button type="button" onClick={() => pick(null)} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-[#f1f2f4] text-[#626f86]">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[9px] bg-gray-100 text-gray-400 border border-gray-200">—</span> Unassigned
            </button>
            {list.map((u) => (
              <button key={u.id} type="button" onClick={() => pick(u.id)} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-[#f1f2f4]">
                <PersonAvatar id={u.id} name={u.name} size={20} />
                <span className="text-[#172b4d] truncate">{u.name}</span>
                {u.id === value && <Check size={12} className="ml-auto text-[#626f86]" />}
              </button>
            ))}
            {list.length === 0 && <div className="px-3 py-2 text-xs text-gray-400">No matches</div>}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

// Atlassian-style rich-text editor — the SAME toolbar/options used by the task
// Description (text styles, bold/italic/more, colour, lists, action item,
// @mention, emoji, attach, table, divider). Shared so the comment composer has
// every option the description has. Self-contained (owns its own menu state +
// contentEditable); `onSave` receives the HTML.
export function RichEditor({
  people, initialHTML = "", placeholder, autoFocus, minHeight = 64,
  onSave, onCancel, saveLabel = "Save", saving, clearOnSave,
}: {
  people: Array<{ id: number; name: string }>;
  initialHTML?: string;
  placeholder?: string;
  autoFocus?: boolean;
  minHeight?: number;
  onSave: (html: string) => void;
  onCancel?: () => void;
  saveLabel?: string;
  saving?: boolean;
  clearOnSave?: boolean;
}) {
  const [menu, setMenu] = useState<"" | "style" | "color" | "mention" | "emoji" | "attach" | "more">("");
  const [mentionQ, setMentionQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);

  // Seed once on mount; optionally focus.
  useEffect(() => { if (ref.current) { ref.current.innerHTML = initialHTML; if (autoFocus) ref.current.focus(); } /* eslint-disable-next-line */ }, []);
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => { if (!toolbarRef.current?.contains(e.target as Node)) setMenu(""); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menu]);

  const exec = (cmd: string, val?: string) => { document.execCommand(cmd, false, val); ref.current?.focus(); };
  const appendToEditor = (html: string) => { const el = ref.current; if (!el) return; el.focus(); el.innerHTML += html; };
  const saveRange = () => { const s = window.getSelection(); if (s && s.rangeCount && ref.current?.contains(s.anchorNode)) savedRange.current = s.getRangeAt(0).cloneRange(); };
  const insertMention = (name: string) => {
    const el = ref.current; if (!el) return;
    el.focus();
    const s = window.getSelection();
    if (savedRange.current && s) { s.removeAllRanges(); s.addRange(savedRange.current); }
    document.execCommand("insertText", false, `@${name} `);
    setMenu(""); setMentionQ("");
  };
  const isEmpty = () => !(ref.current?.textContent?.trim()) && !ref.current?.querySelector("img,table,hr,a");
  const handleSave = () => {
    const html = ref.current?.innerHTML ?? "";
    if (isEmpty()) return;
    onSave(html);
    if (clearOnSave && ref.current) ref.current.innerHTML = "";
  };

  return (
    <div>
      <div className="border border-[#dfe1e6] rounded-t-lg bg-white">
        <div ref={toolbarRef} className="flex items-center gap-0.5 px-2 py-1.5 text-[#44546f] flex-wrap">
          <div className="relative">
            <ToolBtn title="Text styles" onClick={() => setMenu((m) => m === "style" ? "" : "style")}><span className="inline-flex items-center text-[12px] font-medium">Tt</span><ChevronDown size={12} /></ToolBtn>
            {menu === "style" && (
              <div className="absolute z-30 mt-1 w-40 rounded-lg border border-[#dfe1e6] bg-white shadow-lg py-1">
                {([["p", "Normal text"], ["h1", "Heading 1"], ["h2", "Heading 2"], ["h3", "Heading 3"], ["blockquote", "Quote"]] as const).map(([tag, lbl]) => (
                  <button key={tag} type="button" onMouseDown={(e) => { e.preventDefault(); exec("formatBlock", tag); setMenu(""); }} className="w-full text-left px-3 py-1.5 text-[12px] hover:bg-[#f1f2f4]">{lbl}</button>
                ))}
              </div>
            )}
          </div>
          <Divider />
          <ToolBtn title="Bold" onClick={() => exec("bold")}><Bold size={16} /></ToolBtn>
          <ToolBtn title="Italic" onClick={() => exec("italic")}><Italic size={16} /></ToolBtn>
          <div className="relative">
            <ToolBtn title="More formatting" onClick={() => setMenu((m) => m === "more" ? "" : "more")}><MoreHorizontal size={16} /></ToolBtn>
            {menu === "more" && (
              <div className="absolute z-30 mt-1 w-44 rounded-lg border border-[#dfe1e6] bg-white shadow-lg py-1">
                {([["underline", "Underline"], ["strikeThrough", "Strikethrough"], ["subscript", "Subscript"], ["superscript", "Superscript"], ["removeFormat", "Clear formatting"]] as const).map(([cmd, lbl]) => (
                  <button key={cmd} type="button" onMouseDown={(e) => { e.preventDefault(); exec(cmd); setMenu(""); }} className="w-full text-left px-3 py-1.5 text-[12px] hover:bg-[#f1f2f4]">{lbl}</button>
                ))}
              </div>
            )}
          </div>
          <Divider />
          <div className="relative">
            <ToolBtn title="Text color" onClick={() => setMenu((m) => m === "color" ? "" : "color")}><span className="text-[12px] font-medium underline decoration-[#ae2e24] decoration-2">A</span><ChevronDown size={12} /></ToolBtn>
            {menu === "color" && (
              <div className="absolute z-30 mt-1 p-2 rounded-lg border border-[#dfe1e6] bg-white shadow-lg grid grid-cols-5 gap-1.5">
                {["#172b4d", "#ae2e24", "#216e4e", "#0055cc", "#a54800", "#5e4db2", "#206a83", "#943d73", "#626f86", "#e56910"].map((c) => (
                  <button key={c} type="button" onMouseDown={(e) => { e.preventDefault(); exec("foreColor", c); setMenu(""); }} className="w-5 h-5 rounded-full border border-black/10" style={{ background: c }} />
                ))}
              </div>
            )}
          </div>
          <Divider />
          <ToolBtn title="Bulleted list" onClick={() => exec("insertUnorderedList")}><List size={16} /></ToolBtn>
          <ToolBtn title="Numbered list" onClick={() => exec("insertOrderedList")}><ListOrdered size={16} /></ToolBtn>
          <Divider />
          <ToolBtn title="Action item" onClick={() => exec("insertHTML", '<label style="display:flex;align-items:flex-start;gap:6px"><input type="checkbox" style="margin-top:3px"/><span>&nbsp;</span></label>')}><ListChecks size={16} /></ToolBtn>
          <div className="relative">
            <ToolBtn title="Mention" onClick={() => { saveRange(); setMentionQ(""); setMenu((m) => m === "mention" ? "" : "mention"); }}><AtSign size={16} /></ToolBtn>
            {menu === "mention" && (
              <div className="absolute z-30 mt-1 w-56 rounded-lg border border-[#dfe1e6] bg-white shadow-lg p-1">
                <input
                  autoFocus
                  value={mentionQ}
                  onChange={(e) => setMentionQ(e.target.value)}
                  placeholder="Search people…"
                  className="w-full text-[12px] border border-[#dfe1e6] rounded px-2 py-1 outline-none focus:border-[#1868db] mb-1"
                />
                <div className="max-h-48 overflow-y-auto">
                  {people.filter((u) => u.name?.toLowerCase().includes(mentionQ.toLowerCase())).slice(0, 30).map((u) => (
                    <button key={u.id} type="button" onMouseDown={(e) => { e.preventDefault(); insertMention(u.name); }} className="w-full flex items-center gap-2 text-left px-2 py-1.5 text-[12px] rounded hover:bg-[#f1f2f4]">
                      <PersonAvatar id={u.id} name={u.name} size={20} /> <span className="truncate">{u.name}</span>
                    </button>
                  ))}
                  {people.filter((u) => u.name?.toLowerCase().includes(mentionQ.toLowerCase())).length === 0 && (
                    <p className="px-2 py-1.5 text-[12px] text-[#626f86]">No matches</p>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="relative">
            <ToolBtn title="Emoji" onClick={() => setMenu((m) => m === "emoji" ? "" : "emoji")}><Smile size={16} /></ToolBtn>
            {menu === "emoji" && (
              <div className="absolute z-30 mt-1 w-[268px] max-h-52 overflow-y-auto p-2 rounded-lg border border-[#dfe1e6] bg-white shadow-lg grid grid-cols-8 gap-0.5">
                {EMOJIS.map((e, i) => (
                  <button key={i} type="button" onMouseDown={(ev) => { ev.preventDefault(); exec("insertText", e); }} className="h-7 w-7 flex items-center justify-center text-[16px] rounded hover:bg-[#f1f2f4]">{e}</button>
                ))}
              </div>
            )}
          </div>
          <div className="relative">
            <ToolBtn title="Attach" onClick={() => setMenu((m) => m === "attach" ? "" : "attach")}><Paperclip size={16} /></ToolBtn>
            {menu === "attach" && (
              <div className="absolute z-30 mt-1 w-64 p-2 rounded-lg border border-[#dfe1e6] bg-white shadow-lg">
                <FileDropzone compact onUploaded={(m) => {
                  const isImg = (m.fileType || "").startsWith("image/");
                  appendToEditor(isImg
                    ? `<div><img src="${m.fileUrl}" alt="${m.fileName}" style="max-width:100%"/></div>`
                    : `<div>📎 <a href="${m.fileUrl}" target="_blank" rel="noreferrer">${m.fileName}</a></div>`);
                  setMenu("");
                }} />
              </div>
            )}
          </div>
          <ToolBtn title="Insert table" onClick={() => { const cell = "<td style='border:1px solid #c1c7d0;padding:6px;min-width:60px'>&nbsp;</td>"; const row = `<tr>${cell}${cell}${cell}</tr>`; exec("insertHTML", `<table style='border-collapse:collapse;width:100%;border:1px solid #c1c7d0'><tbody>${row}${row}</tbody></table><p><br/></p>`); }}><Table size={16} /></ToolBtn>
          <ToolBtn title="Divider" onClick={() => exec("insertHorizontalRule")}><Plus size={16} /></ToolBtn>
        </div>
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        data-ph={placeholder}
        className="w-full text-[12px] text-[#172b4d] border border-t-0 border-[#dfe1e6] bg-white rounded-b-lg px-3 py-1.5 outline-none resize-y overflow-auto empty:before:content-[attr(data-ph)] empty:before:text-[#626f86] [&_h1]:text-[17px] [&_h1]:font-semibold [&_h2]:text-[17px] [&_h2]:font-semibold [&_h3]:text-[15px] [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_blockquote]:border-l-2 [&_blockquote]:border-[#dfe1e6] [&_blockquote]:pl-3 [&_blockquote]:text-[#626f86] [&_pre]:bg-[#f1f2f4] [&_pre]:rounded [&_pre]:p-2 [&_a]:text-[#1868db] [&_a]:underline [&_table]:border-collapse [&_td]:border [&_td]:border-[#c1c7d0] [&_td]:p-1.5"
        style={{ resize: "vertical", minHeight }}
      />
      <div className="flex items-center gap-2 mt-2.5">
        <button type="button" onClick={handleSave} disabled={saving} className="text-[12px] font-medium px-4 py-1.5 rounded bg-[#1868db] text-white hover:bg-[#1558bc] disabled:opacity-50">{saveLabel}</button>
        {onCancel && <button type="button" onClick={onCancel} className="text-[12px] px-3 py-1.5 rounded text-[#44546f] hover:bg-[#f1f2f4]">Cancel</button>}
      </div>
    </div>
  );
}

export function TaskDetailModal({
  task, allTasks, onClose, onRefresh, onOpenTask,
}: {
  task: AggTask;
  allTasks: AggTask[];
  onClose: () => void;
  onRefresh: () => void;
  /** Switch the modal to another task (used by the breadcrumb's parent-task link). */
  onOpenTask?: (id: number) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { userId } = useUserStore();
  // Project-local WBS codes (1, 2, 2.1 …) — shared with the task table so a
  // subtask shows its parent task's number, not the raw DB id.
  const wbsCodes = useMemo(() => buildWbsCodes(allTasks), [allTasks]);
  const codeOf = useCallback((id: number) => wbsLabel(wbsCodes, id), [wbsCodes]);
  const [draft, setDraft] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [editingDesc, setEditingDesc] = useState(false);
  const [descMenu, setDescMenu] = useState<"" | "style" | "color" | "mention" | "emoji" | "attach" | "more">("");
  const [mentionQ, setMentionQ] = useState("");
  const descRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);
  // Close any open toolbar dropdown when clicking outside the toolbar.
  useEffect(() => {
    if (!descMenu) return;
    const onDown = (e: MouseEvent) => { if (!toolbarRef.current?.contains(e.target as Node)) setDescMenu(""); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [descMenu]);
  // Wire toolbar → contentEditable via execCommand (no extra dependency).
  const exec = (cmd: string, val?: string) => { document.execCommand(cmd, false, val); descRef.current?.focus(); };
  const appendToEditor = (html: string) => { const el = descRef.current; if (!el) return; el.focus(); el.innerHTML += html; };
  const saveRange = () => { const s = window.getSelection(); if (s && s.rangeCount && descRef.current?.contains(s.anchorNode)) savedRange.current = s.getRangeAt(0).cloneRange(); };
  // Insert an @mention at the saved caret position (the people dropdown stole focus).
  const insertMention = (name: string) => {
    const el = descRef.current; if (!el) return;
    el.focus();
    const s = window.getSelection();
    if (savedRange.current && s) { s.removeAllRanges(); s.addRange(savedRange.current); }
    document.execCommand("insertText", false, `@${name} `);
    setDescMenu(""); setMentionQ("");
  };
  // Seed the editor with the saved HTML each time it opens.
  useEffect(() => { if (editingDesc && descRef.current) descRef.current.innerHTML = task.description ?? ""; }, [editingDesc, task.description]);
  const [subName, setSubName] = useState("");
  const [subOpen, setSubOpen] = useState(false);
  // Live value while dragging the no-subtask progress slider (null = use stored).
  const [progressDraft, setProgressDraft] = useState<number | null>(null);
  useEffect(() => { setProgressDraft(null); }, [task.id, task.progressPct]);
  const { data: people = [] } = useListUsers();
  const createTask = useCreateTask();

  const subtasks = allTasks.filter((t) => t.parentTaskId === task.id);
  const subDone = subtasks.filter((s) => s.status === "completed").length;
  const subPct = subtasks.length ? Math.round((subDone / subtasks.length) * 100) : 0;
  const deps = Array.isArray(task.predecessorIds) ? task.predecessorIds : [];
  const depTasks = allTasks.filter((t) => deps.includes(t.id));
  const parent = task.parentTaskId != null ? allTasks.find((t) => t.id === task.parentTaskId) : null;

  const comments = useQuery({
    queryKey: [`/api/tasks/${task.id}/comments`],
    queryFn: () => api.get<TaskComment[]>(`/api/tasks/${task.id}/comments`),
  });

  const patch = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.patch(`/api/tasks/${task.id}`, data),
    onSuccess: () => { onRefresh(); toast({ title: "Task updated" }); },
    onError: () => toast({ title: "Update failed", variant: "destructive" }),
  });
  // Date changes are gated behind a mandatory justification (same modal as the
  // task table). Routes the start/due edits below through requestDateChange.
  const { requestDateChange, dateJustifyModal } = useDateJustify();

  // Status changes for a task OR subtask. Completing needs a justification and
  // (unless you're the approver) goes to the approver for accept/reject — the
  // backend gates it; here we just collect the reason.
  const { ask: askComplete, node: completeNode } = useReasonPrompt();
  const changeStatus = async (taskId: number, v: string) => {
    if (v !== "completed") { await api.patch(`/api/tasks/${taskId}`, { status: v }); onRefresh(); return; }
    const reason = await askComplete({ title: "Mark complete — sent to the approver", label: "Justification for completing this task", confirmText: "Request completion" });
    if (reason == null) return;
    await api.patch(`/api/tasks/${taskId}`, { status: v, completionReason: reason });
    onRefresh();
  };

  const addComment = useMutation({
    mutationFn: (body: string) => api.post(`/api/tasks/${task.id}/comments`, { body, attachments: [] }),
    onSuccess: () => { setDraft(""); qc.invalidateQueries({ queryKey: [`/api/tasks/${task.id}/comments`] }); },
    onError: () => toast({ title: "Couldn't post comment", variant: "destructive" }),
  });
  const submitComment = () => {
    const body = draft.trim();
    if (!body) return;
    addComment.mutate(body);
  };

  // Dependencies = Jira's "Linked work items". POST/DELETE /api/tasks/:id/dependencies.
  const [depPick, setDepPick] = useState("");
  const addDep = useMutation({
    mutationFn: (predecessorId: number) => api.post(`/api/tasks/${task.id}/dependencies`, { predecessorId }),
    onSuccess: () => { setDepPick(""); onRefresh(); toast({ title: "Linked work item added" }); },
    onError: (e) => toast({ title: (e as Error)?.message || "Couldn't link item", variant: "destructive" }),
  });
  const removeDep = useMutation({
    mutationFn: (predId: number) => api.del(`/api/tasks/${task.id}/dependencies/${predId}`),
    onSuccess: () => onRefresh(),
    onError: (e) => toast({ title: (e as Error)?.message || "Couldn't remove link", variant: "destructive" }),
  });

  // Add subtask (Jira's inline "Add subtask" → a dropdown composer here).
  function addSubtask() {
    const name = subName.trim();
    if (!name) return;
    createTask.mutate(
      {
        id: task.projectId,
        data: {
          name, parentTaskId: task.id,
          milestoneId: task.milestoneId ?? undefined,
          priority: task.priority ?? "P2",
          status: "not_started", rag: "green",
        },
      } as never,
      { onSuccess: () => { setSubName(""); onRefresh(); } },
    );
  }

  // Rename — inline-editable title, saved via the same PATCH used everywhere.
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(task.name);
  useEffect(() => { setNameDraft(task.name); }, [task.name]);
  const saveName = () => {
    const n = nameDraft.trim();
    setEditingName(false);
    if (n && n !== task.name) patch.mutate({ name: n });
    else setNameDraft(task.name);
  };

  // Clone — duplicate this task as a new "… (copy)", then close and refresh.
  function cloneTask() {
    const preds = Array.isArray(task.predecessorIds) ? task.predecessorIds : [];
    createTask.mutate(
      { id: task.projectId, data: {
        name: `${task.name} (copy)`,
        description: task.description ?? undefined,
        milestoneId: task.milestoneId ?? undefined,
        parentTaskId: task.parentTaskId ?? undefined,
        assigneeId: task.assigneeId ?? undefined,
        priority: task.priority ?? "P2",
        rag: task.rag ?? "green",
        stage: task.stage ?? undefined,
        startDate: task.startDate ?? undefined,
        endDate: task.endDate ?? undefined,
        estimatedHours: task.estimatedHours ?? undefined,
        predecessorIds: preds,
      } } as never,
      { onSuccess: () => { toast({ title: "Task cloned" }); onRefresh(); onClose(); } },
    );
  }

  const logged = task.actualHours ?? 0;
  const est = task.estimatedHours ?? 0;
  const timePct = est > 0 ? Math.min(100, Math.round((logged / est) * 100)) : (logged > 0 ? 100 : 0);
  const linkable = allTasks.filter((t) => t.projectId === task.projectId && t.id !== task.id && t.parentTaskId !== task.id && !deps.includes(t.id));

  return (
    <>
    {dateJustifyModal}
    {completeNode}
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="w-[95vw] max-w-[1240px] max-h-[92vh] p-0 gap-0 overflow-hidden flex flex-col bg-white">
        {/* Top bar — Add epic / code  +  right-side icon cluster */}
        <div className="flex items-center justify-between pl-5 pr-12 py-1.5 border-b border-[#dfe1e6] shrink-0">
          {/* Breadcrumb — Project / Milestone / Task[ / Subtask], each navigable.
              Full names wrap to the next line rather than truncating. */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-[#626f86] min-w-0 flex-1">
            <Link href={`/projects/${task.projectId}?view=table`}>
              <span onClick={() => onClose()} className="inline-flex items-center gap-1 hover:underline cursor-pointer break-words">
                <FolderKanban size={13} className="text-[#8270db] shrink-0" /> {task.projectName || "Project"}
              </span>
            </Link>
            {task.milestoneId != null && (
              <>
                <span>/</span>
                <Link href={`/projects/${task.projectId}?view=table&milestone=${task.milestoneId}`}>
                  <span onClick={() => onClose()} className="inline-flex items-center gap-1 hover:underline cursor-pointer break-words">
                    <Flag size={12} className="text-[#e2750c] shrink-0" /> {task.milestoneName || "Milestone"}
                  </span>
                </Link>
              </>
            )}
            <span>/</span>
            {parent ? (
              <>
                <button
                  type="button"
                  onClick={() => onOpenTask?.(parent.id)}
                  className="inline-flex items-center gap-1 hover:underline cursor-pointer text-left break-words"
                >
                  <CheckSquare size={13} className="text-[#1868db] shrink-0" /> {parent.name}
                </button>
                <span>/</span>
                <span className="inline-flex items-center gap-1 font-medium text-[#44546f] break-words">
                  <CornerDownRight size={13} className="text-[#4688ec] shrink-0" /> {task.name}
                </span>
              </>
            ) : (
              <span className="inline-flex items-center gap-1 font-medium text-[#44546f] break-words">
                <CheckSquare size={14} className="text-[#1868db] shrink-0" /> {task.name}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2.5 text-[#626f86] shrink-0">
            <button
              type="button"
              onClick={cloneTask}
              disabled={createTask.isPending}
              title="Clone this task"
              className="inline-flex items-center gap-1 px-1.5 h-7 rounded border border-[#dfe1e6] hover:border-[#1868db] hover:text-[#1868db] disabled:opacity-50 transition-colors"
            >
              <Copy size={14} /> Clone
            </button>
            <span className="inline-flex items-center gap-1 px-1.5 h-7 rounded border border-[#1868db] text-[#1868db]"><Eye size={15} />1</span>
            <Share2 size={16} />
          </div>
        </div>

        {/* Two-column body */}
        <div className="flex-1 min-h-0 flex">
          {/* ── LEFT (main) — narrower ── */}
          <div className="w-[42%] shrink-0 min-w-0 px-5 pt-3 pb-4 overflow-y-auto">
            <CompletionApprovalBanner task={task} currentUserId={userId ?? null} onDone={onRefresh} />
            {editingName ? (
              <input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={saveName}
                onKeyDown={(e) => { if (e.key === "Enter") saveName(); if (e.key === "Escape") { setNameDraft(task.name); setEditingName(false); } }}
                className="w-full text-[17px] font-semibold text-[#172b4d] leading-tight mb-3 px-1 -ml-1 border border-[#1868db] rounded outline-none"
              />
            ) : (
              <h1 className="group/title w-full flex items-center gap-1.5 text-[17px] font-semibold text-[#172b4d] leading-tight mb-3 px-1 -ml-1">
                <span className="min-w-0">{task.name}</span>
                <button
                  type="button"
                  onClick={() => setEditingName(true)}
                  title="Rename task"
                  className="shrink-0 opacity-0 group-hover/title:opacity-100 p-0.5 rounded text-[#626f86] hover:text-[#1868db] hover:bg-blue-50 transition"
                >
                  <Pencil size={14} />
                </button>
              </h1>
            )}

            {/* Description — click to reveal the Atlassian-style rich-text editor */}
            <div className="mb-3">
              <p className="text-[12px] font-semibold text-[#172b4d] mb-2">Description</p>
              {editingDesc ? (
                <div>
                  <div className="border border-[#dfe1e6] rounded-t-lg bg-white">
                    {/* Toolbar — wired to the contentEditable via execCommand */}
                    <div ref={toolbarRef} className="flex items-center gap-0.5 px-2 py-1.5 text-[#44546f] flex-wrap">
                      <div className="relative">
                        <ToolBtn title="Text styles" onClick={() => setDescMenu((m) => m === "style" ? "" : "style")}><span className="inline-flex items-center text-[12px] font-medium">Tt</span><ChevronDown size={12} /></ToolBtn>
                        {descMenu === "style" && (
                          <div className="absolute z-30 mt-1 w-40 rounded-lg border border-[#dfe1e6] bg-white shadow-lg py-1">
                            {([["p", "Normal text"], ["h1", "Heading 1"], ["h2", "Heading 2"], ["h3", "Heading 3"], ["blockquote", "Quote"]] as const).map(([tag, lbl]) => (
                              <button key={tag} type="button" onMouseDown={(e) => { e.preventDefault(); exec("formatBlock", tag); setDescMenu(""); }} className="w-full text-left px-3 py-1.5 text-[12px] hover:bg-[#f1f2f4]">{lbl}</button>
                            ))}
                          </div>
                        )}
                      </div>
                      <Divider />
                      <ToolBtn title="Bold" onClick={() => exec("bold")}><Bold size={16} /></ToolBtn>
                      <ToolBtn title="Italic" onClick={() => exec("italic")}><Italic size={16} /></ToolBtn>
                      <div className="relative">
                        <ToolBtn title="More formatting" onClick={() => setDescMenu((m) => m === "more" ? "" : "more")}><MoreHorizontal size={16} /></ToolBtn>
                        {descMenu === "more" && (
                          <div className="absolute z-30 mt-1 w-44 rounded-lg border border-[#dfe1e6] bg-white shadow-lg py-1">
                            {([["underline", "Underline"], ["strikeThrough", "Strikethrough"], ["subscript", "Subscript"], ["superscript", "Superscript"], ["removeFormat", "Clear formatting"]] as const).map(([cmd, lbl]) => (
                              <button key={cmd} type="button" onMouseDown={(e) => { e.preventDefault(); exec(cmd); setDescMenu(""); }} className="w-full text-left px-3 py-1.5 text-[12px] hover:bg-[#f1f2f4]">{lbl}</button>
                            ))}
                          </div>
                        )}
                      </div>
                      <Divider />
                      <div className="relative">
                        <ToolBtn title="Text color" onClick={() => setDescMenu((m) => m === "color" ? "" : "color")}><span className="text-[12px] font-medium underline decoration-[#ae2e24] decoration-2">A</span><ChevronDown size={12} /></ToolBtn>
                        {descMenu === "color" && (
                          <div className="absolute z-30 mt-1 p-2 rounded-lg border border-[#dfe1e6] bg-white shadow-lg grid grid-cols-5 gap-1.5">
                            {["#172b4d", "#ae2e24", "#216e4e", "#0055cc", "#a54800", "#5e4db2", "#206a83", "#943d73", "#626f86", "#e56910"].map((c) => (
                              <button key={c} type="button" onMouseDown={(e) => { e.preventDefault(); exec("foreColor", c); setDescMenu(""); }} className="w-5 h-5 rounded-full border border-black/10" style={{ background: c }} />
                            ))}
                          </div>
                        )}
                      </div>
                      <Divider />
                      <ToolBtn title="Bulleted list" onClick={() => exec("insertUnorderedList")}><List size={16} /></ToolBtn>
                      <ToolBtn title="Numbered list" onClick={() => exec("insertOrderedList")}><ListOrdered size={16} /></ToolBtn>
                      <Divider />
                      <ToolBtn title="Action item" onClick={() => exec("insertHTML", '<label style="display:flex;align-items:flex-start;gap:6px"><input type="checkbox" style="margin-top:3px"/><span>&nbsp;</span></label>')}><ListChecks size={16} /></ToolBtn>
                      <div className="relative">
                        <ToolBtn title="Mention" onClick={() => { saveRange(); setMentionQ(""); setDescMenu((m) => m === "mention" ? "" : "mention"); }}><AtSign size={16} /></ToolBtn>
                        {descMenu === "mention" && (
                          <div className="absolute z-30 mt-1 w-56 rounded-lg border border-[#dfe1e6] bg-white shadow-lg p-1">
                            <input
                              autoFocus
                              value={mentionQ}
                              onChange={(e) => setMentionQ(e.target.value)}
                              placeholder="Search people…"
                              className="w-full text-[12px] border border-[#dfe1e6] rounded px-2 py-1 outline-none focus:border-[#1868db] mb-1"
                            />
                            <div className="max-h-48 overflow-y-auto">
                              {people.filter((u) => u.name?.toLowerCase().includes(mentionQ.toLowerCase())).slice(0, 30).map((u) => (
                                <button key={u.id} type="button" onMouseDown={(e) => { e.preventDefault(); insertMention(u.name); }} className="w-full flex items-center gap-2 text-left px-2 py-1.5 text-[12px] rounded hover:bg-[#f1f2f4]">
                                  <PersonAvatar id={u.id} name={u.name} size={20} /> <span className="truncate">{u.name}</span>
                                </button>
                              ))}
                              {people.filter((u) => u.name?.toLowerCase().includes(mentionQ.toLowerCase())).length === 0 && (
                                <p className="px-2 py-1.5 text-[12px] text-[#626f86]">No matches</p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="relative">
                        <ToolBtn title="Emoji" onClick={() => setDescMenu((m) => m === "emoji" ? "" : "emoji")}><Smile size={16} /></ToolBtn>
                        {descMenu === "emoji" && (
                          <div className="absolute z-30 mt-1 w-[268px] max-h-52 overflow-y-auto p-2 rounded-lg border border-[#dfe1e6] bg-white shadow-lg grid grid-cols-8 gap-0.5">
                            {EMOJIS.map((e, i) => (
                              <button key={i} type="button" onMouseDown={(ev) => { ev.preventDefault(); exec("insertText", e); }} className="h-7 w-7 flex items-center justify-center text-[16px] rounded hover:bg-[#f1f2f4]">{e}</button>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="relative">
                        <ToolBtn title="Attach" onClick={() => setDescMenu((m) => m === "attach" ? "" : "attach")}><Paperclip size={16} /></ToolBtn>
                        {descMenu === "attach" && (
                          <div className="absolute z-30 mt-1 w-64 p-2 rounded-lg border border-[#dfe1e6] bg-white shadow-lg">
                            <FileDropzone compact onUploaded={(m) => {
                              const isImg = (m.fileType || "").startsWith("image/");
                              appendToEditor(isImg
                                ? `<div><img src="${m.fileUrl}" alt="${m.fileName}" style="max-width:100%"/></div>`
                                : `<div>📎 <a href="${m.fileUrl}" target="_blank" rel="noreferrer">${m.fileName}</a></div>`);
                              setDescMenu("");
                            }} />
                          </div>
                        )}
                      </div>
                      <ToolBtn title="Insert table" onClick={() => { const cell = "<td style='border:1px solid #c1c7d0;padding:6px;min-width:60px'>&nbsp;</td>"; const row = `<tr>${cell}${cell}${cell}</tr>`; exec("insertHTML", `<table style='border-collapse:collapse;width:100%;border:1px solid #c1c7d0'><tbody>${row}${row}</tbody></table><p><br/></p>`); }}><Table size={16} /></ToolBtn>
                      <ToolBtn title="Divider" onClick={() => exec("insertHorizontalRule")}><Plus size={16} /></ToolBtn>
                    </div>
                  </div>
                  <div
                    ref={descRef}
                    contentEditable
                    suppressContentEditableWarning
                    data-ph="Type /ai for Atlassian Intelligence or @ to mention and notify someone."
                    className="w-full text-[12px] text-[#172b4d] border border-t-0 border-[#dfe1e6] bg-white rounded-b-lg px-3 py-1.5 outline-none resize-y overflow-auto min-h-[64px] empty:before:content-[attr(data-ph)] empty:before:text-[#626f86] [&_h1]:text-[17px] [&_h1]:font-semibold [&_h2]:text-[17px] [&_h2]:font-semibold [&_h3]:text-[15px] [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_blockquote]:border-l-2 [&_blockquote]:border-[#dfe1e6] [&_blockquote]:pl-3 [&_blockquote]:text-[#626f86] [&_pre]:bg-[#f1f2f4] [&_pre]:rounded [&_pre]:p-2 [&_a]:text-[#1868db] [&_a]:underline [&_table]:border-collapse [&_td]:border [&_td]:border-[#c1c7d0] [&_td]:p-1.5"
                    style={{ resize: "vertical" }}
                  />
                  <div className="flex items-center gap-2 mt-3">
                    <button type="button" onClick={() => { const html = descRef.current?.innerHTML ?? ""; if (html !== (task.description ?? "")) patch.mutate({ description: html }); setEditingDesc(false); setDescMenu(""); }} className="text-[12px] font-medium px-4 py-1.5 rounded bg-[#1868db] text-white hover:bg-[#1558bc]">Save</button>
                    <button type="button" onClick={() => { setEditingDesc(false); setDescMenu(""); }} className="text-[12px] px-3 py-1.5 rounded text-[#44546f] hover:bg-[#f1f2f4]">Cancel</button>
                  </div>
                </div>
              ) : (
                <div
                  onClick={() => setEditingDesc(true)}
                  className="text-[12px] rounded px-2 py-1.5 -mx-2 cursor-text hover:bg-[#f1f2f4] min-h-[34px] [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:text-[#1868db] [&_a]:underline [&_table]:border-collapse [&_td]:border [&_td]:border-[#c1c7d0] [&_td]:p-1.5"
                >
                  {task.description
                    ? <div className="text-[#172b4d]" dangerouslySetInnerHTML={{ __html: task.description }} />
                    : <span className="text-[#626f86]">Add a description…</span>}
                </div>
              )}
            </div>

            {/* Progress slider — only when the task has no subtasks. With subtasks,
                progress is derived (rolled up) and shown read-only inside Subtasks. */}
            {subtasks.length === 0 && (() => {
              const stored = task.status === "completed" ? 100 : Math.max(0, Math.min(100, task.progressPct ?? 0));
              const shown = task.status === "completed" ? 100 : (progressDraft ?? stored);
              const commit = (v: number) => { if (v !== stored) patch.mutate({ progressPct: v }); };
              return (
                <div className="mb-3">
                  <p className="text-[12px] font-semibold text-[#172b4d] mb-2">Progress</p>
                  <div className="flex items-center gap-3">
                    {/* Uncontrolled: the browser owns the thumb during drag (a controlled
                        value re-rendered from react-query can stick). Remounts via key when
                        the server value changes; the % label tracks the live draft. */}
                    <input
                      key={`${task.id}:${stored}`}
                      type="range" min={0} max={100} step={5}
                      defaultValue={stored}
                      disabled={task.status === "completed"}
                      onClick={(e) => e.stopPropagation()}
                      onInput={(e) => setProgressDraft(Number((e.target as HTMLInputElement).value))}
                      onChange={(e) => setProgressDraft(Number(e.target.value))}
                      onPointerUp={(e) => commit(Number((e.target as HTMLInputElement).value))}
                      onKeyUp={(e) => commit(Number((e.target as HTMLInputElement).value))}
                      className="flex-1 h-1.5 accent-[#22a06b] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                    <span className="text-[12px] text-[#626f86] num-tabular shrink-0 w-10 text-right">{shown}%</span>
                  </div>
                  {task.status === "completed" && <p className="text-[11px] text-[#626f86] mt-1">Completed — fixed at 100%.</p>}
                </div>
              );
            })()}

            {/* Subtasks + Linked work items — hidden when this task is itself a
                subtask (no nesting / cross-links from a subtask's own popup). */}
            {task.parentTaskId == null && <>
            {/* Subtasks — in-flow collapsible dropdown (not a floating popup) */}
            <div className="mb-3">
              <button type="button" onClick={() => setSubOpen((v) => !v)} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#172b4d] mb-2">
                Subtasks {subtasks.length > 0 && <span className="text-[12px] font-normal text-[#626f86]">({subDone}/{subtasks.length})</span>}
                <ChevronDown size={14} className={`text-[#626f86] transition-transform ${subOpen ? "rotate-180" : ""}`} />
              </button>

              {subOpen && <>
              {subtasks.length > 0 && (
                <>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="flex-1 h-2 rounded-full bg-[#dfe1e6] overflow-hidden">
                      <div className="h-full rounded-full bg-[#22a06b] transition-[width] duration-500" style={{ width: `${subPct}%` }} />
                    </div>
                    <span className="text-[12px] text-[#626f86] num-tabular shrink-0">{subPct}% Done</span>
                  </div>
                  <div className="mb-2">
                    {subtasks.map((s) => (
                      <div key={s.id} className="flex items-center gap-2 text-[12px] py-2 px-1 border-t border-[#f1f2f4] first:border-t-0">
                        <CheckSquare size={15} className="text-[#1868db] shrink-0" />
                        <span className="font-medium text-[#1868db] shrink-0 hover:underline cursor-default">{codeOf(s.id)}</span>
                        <span className="flex-1 whitespace-normal break-words text-[#172b4d]">{s.name}</span>
                        <AssigneePicker value={s.assigneeId} people={people} onPick={(id) => api.patch(`/api/tasks/${s.id}`, { assigneeId: id }).then(onRefresh)} title="Assign subtask">
                          <PersonAvatar id={s.assigneeId} name={s.assigneeName ?? "Unassigned"} size={22} />
                        </AssigneePicker>
                        <div className="h-7 w-24 shrink-0 rounded overflow-hidden border border-[#dfe1e6]">
                          <StatusSelect value={s.status} onChange={(v) => void changeStatus(s.id, v)} />
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* Inline add row */}
              <div className="flex items-center gap-2">
                <input
                  value={subName}
                  onChange={(e) => setSubName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") addSubtask(); }}
                  placeholder="What needs to be done?"
                  className="flex-1 text-[12px] border border-[#c1c7d0] rounded px-2.5 py-1.5 outline-none focus:border-[#1868db]"
                />
                <button type="button" onClick={addSubtask} disabled={!subName.trim() || createTask.isPending} className="text-[12px] px-3 py-1.5 rounded bg-[#1868db] text-white hover:bg-[#1558bc] disabled:opacity-50">Add</button>
              </div>
              </>}
            </div>

            {/* Linked work items */}
            <div className="mb-3">
              <p className="text-[12px] font-semibold text-[#172b4d] mb-2">Linked work items</p>
              {depTasks.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 mb-2">
                  {depTasks.map((d) => (
                    <span key={d.id} className="inline-flex items-center gap-1 text-[12px] pl-2 pr-1 py-0.5 rounded-full bg-[#f1f2f4] border border-[#dfe1e6] max-w-full">
                      <span className="truncate">{codeOf(d.id)} · {d.name}</span>
                      <button onClick={() => removeDep.mutate(d.id)} disabled={removeDep.isPending} className="text-[#626f86] hover:text-[#ae2e24] shrink-0"><X size={12} /></button>
                    </span>
                  ))}
                </div>
              )}
              <select
                value={depPick}
                onChange={(e) => { const id = Number(e.target.value); if (id) addDep.mutate(id); }}
                disabled={addDep.isPending || linkable.length === 0}
                className="text-[12px] text-[#44546f] bg-transparent outline-none cursor-pointer hover:underline"
              >
                <option value="">+ Add linked work item</option>
                {linkable.map((t) => <option key={t.id} value={t.id}>{codeOf(t.id)} · {t.name}</option>)}
              </select>
            </div>
            </>}

            {/* Details — moved to the left column (the right is comments-only now) */}
            <div className="border border-[#dfe1e6] rounded-lg">
              <button
                onClick={() => setDetailsOpen((v) => !v)}
                className="w-full flex items-center justify-between px-4 py-1.5 text-[12px] font-semibold text-[#172b4d]"
              >
                Details
                <span className="flex items-center gap-2 text-[#626f86]">
                  <ChevronUp size={16} className={detailsOpen ? "" : "rotate-180"} />
                </span>
              </button>
              {detailsOpen && (
                <div className="px-4 pb-3 pt-1 border-t border-[#dfe1e6]">
                  <SidebarRow label="Assignee">
                    <AssigneePicker value={task.assigneeId} people={people} onPick={(id) => patch.mutate({ assigneeId: id })} title="Assign">
                      <PersonAvatar id={task.assigneeId} name={task.assigneeName ?? "Unassigned"} size={24} />
                      <span className="flex-1 min-w-0 truncate text-[12px] text-[#172b4d] hover:bg-[#f1f2f4] rounded px-1 py-0.5">{task.assigneeName ?? "Unassigned"}</span>
                    </AssigneePicker>
                    {task.assigneeId == null && (
                      <button type="button" onClick={() => patch.mutate({ assigneeId: userId })} className="text-[12px] text-[#1868db] hover:underline mt-1 ml-8">Assign to me</button>
                    )}
                  </SidebarRow>
                  <SidebarRow label="Parent">
                    {parent ? <span className="truncate text-[#1868db]">{codeOf(parent.id)} · {parent.name}</span> : <span className="text-[#626f86]">None</span>}
                  </SidebarRow>
                  <SidebarRow label="Due date">
                    <input type="date" defaultValue={(task.endDate ?? "").slice(0, 10)}
                      onBlur={(e) => requestDateChange({
                        taskId: task.id,
                        // First-time set of a previously-undefined due date skips the
                        // prompt; only an edit to an already-defined date asks WHY.
                        firstAssignment: !task.endDate,
                        changes: [{ label: "Due", from: task.endDate ?? null, to: e.target.value || null }],
                        apply: (reason) => {
                          const newEnd = e.target.value || null;
                          patch.mutate({ endDate: newEnd, justification: reason || undefined });
                          // If this subtask now ends after its parent, stretch the parent.
                          const ext = parent && parentEndToExtend(parent.endDate, newEnd);
                          if (parent && ext) {
                            api.patch(`/api/tasks/${parent.id}`, { endDate: ext }).then(onRefresh);
                          }
                        },
                      })}
                      className="text-[12px] text-[#172b4d] bg-transparent rounded px-1 py-0.5 outline-none hover:bg-[#f1f2f4] focus:bg-[#f1f2f4] w-fit" />
                  </SidebarRow>
                  <SidebarRow label="Start date">
                    <input type="date" defaultValue={(task.startDate ?? "").slice(0, 10)}
                      onBlur={(e) => requestDateChange({
                        taskId: task.id,
                        // First-time set of a previously-undefined start date skips the
                        // prompt; only an edit to an already-defined date asks WHY.
                        firstAssignment: !task.startDate,
                        changes: [{ label: "Start", from: task.startDate ?? null, to: e.target.value || null }],
                        apply: (reason) => patch.mutate({ startDate: e.target.value || null, justification: reason || undefined }),
                      })}
                      className="text-[12px] text-[#172b4d] bg-transparent rounded px-1 py-0.5 outline-none hover:bg-[#f1f2f4] focus:bg-[#f1f2f4] w-fit" />
                  </SidebarRow>
                  <SidebarRow label="Reporter">
                    {task.assigneeName
                      ? <span className="flex items-center gap-2"><PersonAvatar id={task.assigneeId} name={task.assigneeName} size={24} />{task.assigneeName}</span>
                      : <span className="text-[#626f86]">None</span>}
                  </SidebarRow>
                </div>
              )}
            </div>
          </div>

          {/* ── RIGHT (main) — Comments, the bigger half ── */}
          <div className="flex-1 min-w-0 border-l border-[#dfe1e6] px-4 pt-3 pb-4 bg-white overflow-y-auto flex flex-col">
            {/* Status + Priority */}
            <div className="flex items-center gap-2 mb-4">
              <div className="relative h-8 w-[130px] rounded border border-[#dfe1e6] overflow-hidden [&_select]:!text-left [&_select]:!pr-6">
                <StatusSelect value={task.status} onChange={(v) => void changeStatus(task.id, v)} />
                <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none opacity-70" />
              </div>
              <div className="relative h-8 w-[110px] rounded border border-[#dfe1e6] overflow-hidden [&_select]:!text-left [&_select]:!pr-6">
                <PrioritySelect value={task.priority} onChange={(v) => patch.mutate({ priority: v })} />
                <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none opacity-70" />
              </div>
            </div>

            {/* Comments — composer (full rich editor, same options as Description)
                + thread, the whole conversation lives here */}
            <p className="text-[12px] font-semibold text-[#172b4d] mb-2">Comments</p>
            <div className="flex items-start gap-2 mb-4">
              <PersonAvatar id={task.assigneeId} name={task.assigneeName ?? "?"} size={28} />
              <div className="flex-1 min-w-0">
                <RichEditor
                  people={people}
                  placeholder="Add a comment…"
                  saveLabel="Comment"
                  clearOnSave
                  saving={addComment.isPending}
                  onSave={(html) => addComment.mutate(html)}
                />
              </div>
            </div>

            <div className="flex-1 min-h-0 space-y-3 overflow-y-auto">
              {(comments.data ?? []).length === 0 ? (
                <p className="text-[12px] text-[#626f86]">No comments yet. Start the conversation above.</p>
              ) : (
                comments.data!.map((c) => (
                  <div key={c.id} className="flex items-start gap-2">
                    <PersonAvatar id={c.senderId} name={c.senderName ?? "?"} size={24} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px]"><span className="font-medium text-[#172b4d]">{c.senderName ?? "User"}</span> <span className="text-[#626f86]">· {new Date(c.createdAt).toLocaleString()}</span></p>
                      {c.body && <div className="text-[12px] text-[#172b4d] whitespace-pre-wrap [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:text-[#1868db] [&_a]:underline [&_img]:max-w-full [&_table]:border-collapse [&_td]:border [&_td]:border-[#c1c7d0] [&_td]:p-1.5" dangerouslySetInnerHTML={{ __html: c.body }} />}
                      {c.attachments?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {c.attachments.map((a, i) => (
                            <span key={i} className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-[#f1f2f4] text-[#626f86]"><Paperclip size={9} />{attName(a as AttView)}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}
