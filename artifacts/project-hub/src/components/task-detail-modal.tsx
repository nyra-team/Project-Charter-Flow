// Task detail modal — a faithful clone of Jira's issue view. Two columns:
//  • Left (main): breadcrumb, title, action row (Attach / Add child / Link / Create),
//    Start+Due dates, Description, Child issues (progress bar + per-row status), comments.
//  • Right (sidebar): Status + Actions, then a "Details" panel — Assignee, Labels,
//    Parent, Team, Priority, Time tracking, Original estimate, Development, Reporter.
// Wired to our data (pmo_tasks + pmo_messages); Jira-structural-only fields
// (Labels / Team / Original estimate / Development / Reporter) render as display rows
// to keep the structure identical.
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useListUsers } from "@workspace/api-client-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Link } from "wouter";
import {
  Paperclip, GitBranch, X, ChevronUp, Settings, Plus,
  CheckSquare, Sparkles, Send, MoreHorizontal, Lock, Eye, ThumbsUp, Share2,
} from "lucide-react";
import { api } from "@/lib/extra-api";
import { useToast } from "@/hooks/use-toast";
import { PersonAvatar } from "./person-avatar";
import { StatusSelect, PrioritySelect } from "./task-status-chip";
import { Skeleton } from "@/components/ui/skeleton";
import { FileDropzone, type UploadedFileMeta } from "@/components/ui/file-dropzone";
import type { AggTask, TaskComment } from "@/lib/work-types";

type AttView = { fileName?: string; name?: string; fileUrl?: string; url?: string } & Record<string, unknown>;
const attName = (a: AttView) => a.fileName ?? a.name ?? "file";
const codeOf = (id: number) => `TSK-${String(id).padStart(4, "0")}`;

// One label/value row in the right-hand Details panel (Jira's grid).
function SidebarRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-start gap-3 py-2.5">
      <span className="text-[13px] text-[#626f86] pt-0.5">{label}</span>
      <div className="min-w-0 text-[13px] text-[#172b4d]">{children}</div>
    </div>
  );
}

// Top action button (Attach / Add a child issue / Link issue / Create).
function ActionBtn({ icon, children, onClick }: { icon: React.ReactNode; children: React.ReactNode; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded text-[13px] font-medium text-[#44546f] bg-[#f1f2f4] hover:bg-[#dcdfe4] transition-colors"
    >
      {icon}{children}
    </button>
  );
}

export function TaskDetailModal({
  task, allTasks, onClose, onRefresh,
}: {
  task: AggTask;
  allTasks: AggTask[];
  onClose: () => void;
  onRefresh: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const [pendingAtts, setPendingAtts] = useState<UploadedFileMeta[]>([]);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const { data: people = [] } = useListUsers();

  const subtasks = allTasks.filter((t) => t.parentTaskId === task.id);
  const subDone = subtasks.filter((s) => s.status === "completed").length;
  const subPct = subtasks.length ? Math.round((subDone / subtasks.length) * 100) : 0;
  const deps = Array.isArray(task.predecessorIds) ? task.predecessorIds : [];
  const depTasks = allTasks.filter((t) => deps.includes(t.id));
  const parent = task.parentTaskId != null ? allTasks.find((t) => t.id === task.parentTaskId) : null;
  const code = codeOf(task.id);

  const comments = useQuery({
    queryKey: [`/api/tasks/${task.id}/comments`],
    queryFn: () => api.get<TaskComment[]>(`/api/tasks/${task.id}/comments`),
  });

  const patch = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.patch(`/api/tasks/${task.id}`, data),
    onSuccess: () => { onRefresh(); toast({ title: "Task updated" }); },
    onError: () => toast({ title: "Update failed", variant: "destructive" }),
  });

  const addComment = useMutation({
    mutationFn: (vars: { body: string; attachments: UploadedFileMeta[] }) =>
      api.post(`/api/tasks/${task.id}/comments`, {
        body: vars.body,
        attachments: vars.attachments.map((a) => ({ fileUrl: a.fileUrl, fileName: a.fileName, fileType: a.fileType, fileSize: a.fileSize })),
      }),
    onSuccess: () => { setDraft(""); setPendingAtts([]); qc.invalidateQueries({ queryKey: [`/api/tasks/${task.id}/comments`] }); },
    onError: () => toast({ title: "Couldn't post comment", variant: "destructive" }),
  });
  const submitComment = () => {
    const body = draft.trim();
    if (!body && pendingAtts.length === 0) return;
    addComment.mutate({ body, attachments: pendingAtts });
  };

  // Dependencies = Jira's "Link issue". POST/DELETE /api/tasks/:id/dependencies.
  const [depPick, setDepPick] = useState("");
  const addDep = useMutation({
    mutationFn: (predecessorId: number) => api.post(`/api/tasks/${task.id}/dependencies`, { predecessorId }),
    onSuccess: () => { setDepPick(""); onRefresh(); toast({ title: "Dependency added" }); },
    onError: (e) => toast({ title: (e as Error)?.message || "Couldn't add dependency", variant: "destructive" }),
  });
  const removeDep = useMutation({
    mutationFn: (predId: number) => api.del(`/api/tasks/${task.id}/dependencies/${predId}`),
    onSuccess: () => onRefresh(),
    onError: (e) => toast({ title: (e as Error)?.message || "Couldn't remove dependency", variant: "destructive" }),
  });

  const logged = task.actualHours ?? 0;
  const est = task.estimatedHours ?? 0;
  const timePct = est > 0 ? Math.min(100, Math.round((logged / est) * 100)) : (logged > 0 ? 100 : 0);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="w-[92vw] max-w-[860px] max-h-[92vh] p-0 gap-0 overflow-hidden flex flex-col bg-white">
        {/* Top bar — breadcrumb + right-side icon cluster (clone of Jira's header) */}
        <div className="flex items-center justify-between pl-5 pr-12 py-2.5 border-b border-[#dfe1e6] shrink-0">
          <div className="flex items-center gap-2 text-[13px] text-[#626f86] min-w-0">
            <Link href={`/projects/${task.projectId}?tab=grid`}>
              <span className="inline-flex items-center gap-1 hover:underline cursor-pointer truncate">
                <span className="w-4 h-4 rounded-sm bg-[#8270db] inline-flex items-center justify-center text-white text-[9px]">E</span>
                {task.projectName}
              </span>
            </Link>
            <span>/</span>
            <span className="inline-flex items-center gap-1 font-medium text-[#44546f]">
              <CheckSquare size={14} className="text-[#1868db]" /> {code}
            </span>
          </div>
          <div className="flex items-center gap-3 text-[#626f86] shrink-0">
            <Lock size={16} /> <span className="inline-flex items-center gap-1"><Eye size={16} />1</span>
            <ThumbsUp size={16} /> <Share2 size={16} /> <MoreHorizontal size={16} />
          </div>
        </div>

        {/* Two-column body */}
        <div className="flex-1 min-h-0 flex overflow-hidden">
          {/* ── LEFT (main) ── */}
          <div className="flex-1 min-w-0 px-5 pt-4 pb-6">
            <input
              defaultValue={task.name}
              onBlur={(e) => { if (e.target.value.trim() && e.target.value !== task.name) patch.mutate({ name: e.target.value.trim() }); }}
              className="w-full text-[19px] font-semibold text-[#172b4d] leading-tight mb-3 bg-transparent outline-none focus:bg-[#f7f8f9] rounded px-1 -ml-1"
            />

            {/* Action row */}
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <ActionBtn icon={<Paperclip size={15} />}>Attach</ActionBtn>
              <ActionBtn icon={<GitBranch size={15} />}>Add a child issue</ActionBtn>
            </div>

            {/* Linked issues (dependencies) — shown when any exist */}
            {depTasks.length > 0 && (
              <div className="mb-4">
                <div className="flex flex-wrap items-center gap-1.5">
                  {depTasks.map((d) => (
                    <span key={d.id} className="inline-flex items-center gap-1 text-[12px] pl-2 pr-1 py-0.5 rounded-full bg-[#f1f2f4] border border-[#dfe1e6] max-w-full">
                      <span className="truncate">{codeOf(d.id)} · {d.name}</span>
                      <button onClick={() => removeDep.mutate(d.id)} disabled={removeDep.isPending} className="text-[#626f86] hover:text-[#ae2e24] shrink-0"><X size={12} /></button>
                    </span>
                  ))}
                  <select
                    value={depPick}
                    onChange={(e) => { const id = Number(e.target.value); if (id) addDep.mutate(id); }}
                    disabled={addDep.isPending}
                    className="text-[12px] border border-dashed border-[#c1c7d0] rounded-full px-2 py-0.5 bg-white text-[#626f86] hover:border-[#1868db] outline-none"
                  >
                    <option value="">+ Link an issue…</option>
                    {allTasks
                      .filter((t) => t.projectId === task.projectId && t.id !== task.id && t.parentTaskId !== task.id && !deps.includes(t.id))
                      .map((t) => <option key={t.id} value={t.id}>{codeOf(t.id)} · {t.name}</option>)}
                  </select>
                </div>
              </div>
            )}

            {/* Start / Due dates */}
            <div className="space-y-1 mb-4">
              <div className="grid grid-cols-[120px_1fr] items-center">
                <span className="text-[13px] text-[#626f86]">Start date</span>
                <input type="date" defaultValue={task.startDate ?? ""}
                  onBlur={(e) => { if (e.target.value !== (task.startDate ?? "")) patch.mutate({ startDate: e.target.value || null }); }}
                  className="text-[13px] text-[#172b4d] bg-transparent rounded px-1 py-0.5 outline-none hover:bg-[#f1f2f4] focus:bg-[#f1f2f4] w-fit" />
              </div>
              <div className="grid grid-cols-[120px_1fr] items-center">
                <span className="text-[13px] text-[#626f86]">Due date</span>
                <input type="date" defaultValue={task.endDate ?? ""}
                  onBlur={(e) => { if (e.target.value !== (task.endDate ?? "")) patch.mutate({ endDate: e.target.value || null }); }}
                  className="text-[13px] text-[#172b4d] bg-transparent rounded px-1 py-0.5 outline-none hover:bg-[#f1f2f4] focus:bg-[#f1f2f4] w-fit" />
              </div>
            </div>

            {/* Description */}
            <div className="mb-4">
              <p className="text-[15px] font-semibold text-[#172b4d] mb-2">Description</p>
              <textarea
                defaultValue={task.description ?? ""}
                placeholder="Add a description…"
                rows={3}
                onBlur={(e) => { if (e.target.value !== (task.description ?? "")) patch.mutate({ description: e.target.value }); }}
                className="w-full text-[14px] text-[#172b4d] border border-transparent hover:border-[#dfe1e6] focus:border-[#1868db] bg-transparent rounded px-2 py-1.5 outline-none resize-y"
              />
            </div>

            {/* Child issues */}
            {subtasks.length > 0 && (
              <div className="mb-4 border border-[#dfe1e6] rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[15px] font-semibold text-[#172b4d]">Child issues</p>
                  <div className="flex items-center gap-2 text-[13px] text-[#44546f]">
                    <span className="inline-flex items-center gap-1 cursor-default">Order by</span>
                    <MoreHorizontal size={16} />
                    <Plus size={16} />
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#f1f2f4]"><Sparkles size={14} className="text-[#1868db]" /> Suggest subtasks</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="flex-1 h-2 rounded-full bg-[#dfe1e6] overflow-hidden">
                    <div className="h-full rounded-full bg-[#22a06b] transition-[width] duration-500" style={{ width: `${subPct}%` }} />
                  </div>
                  <span className="text-[12px] text-[#626f86] num-tabular shrink-0">{subPct}% Done</span>
                </div>
                <div>
                  {subtasks.map((s) => (
                    <div key={s.id} className="flex items-center gap-2 text-[13px] py-2 px-1 border-t border-[#f1f2f4] first:border-t-0">
                      <CheckSquare size={15} className="text-[#1868db] shrink-0" />
                      <span className="font-medium text-[#1868db] shrink-0 line-through-none hover:underline cursor-default">{codeOf(s.id)}</span>
                      <span className="flex-1 truncate text-[#172b4d]">{s.name}</span>
                      <PersonAvatar id={s.assigneeId} name={s.assigneeName ?? "Unassigned"} size={22} />
                      <div className="h-7 w-24 shrink-0 rounded overflow-hidden border border-[#dfe1e6]">
                        <StatusSelect value={s.status} onChange={(v) => api.patch(`/api/tasks/${s.id}`, { status: v }).then(onRefresh)} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Comments */}
            <div className="mb-2">
              {comments.isLoading ? (
                <Skeleton className="h-16 rounded-lg" />
              ) : (comments.data ?? []).length > 0 && (
                <div className="space-y-3 mb-3">
                  {comments.data!.map((c) => (
                    <div key={c.id} className="flex items-start gap-2">
                      <PersonAvatar id={c.senderId} name={c.senderName ?? "?"} size={28} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px]"><span className="font-medium text-[#172b4d]">{c.senderName ?? "User"}</span> <span className="text-[#626f86]">· {new Date(c.createdAt).toLocaleString()}</span></p>
                        {c.body && <p className="text-[13px] text-[#172b4d] whitespace-pre-wrap">{c.body}</p>}
                        {c.attachments?.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {c.attachments.map((a, i) => (
                              <span key={i} className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-[#f1f2f4] text-[#626f86]"><Paperclip size={9} />{attName(a as AttView)}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {pendingAtts.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {pendingAtts.map((a, i) => (
                    <span key={i} className="inline-flex items-center gap-1 text-[12px] pl-2 pr-1 py-0.5 rounded-full bg-[#e9f2ff] text-[#1868db] border border-[#cce0ff]">
                      <Paperclip size={10} /> <span className="truncate max-w-[160px]">{a.fileName}</span>
                      <button onClick={() => setPendingAtts((p) => p.filter((_, j) => j !== i))} className="hover:text-[#ae2e24] shrink-0"><X size={11} /></button>
                    </span>
                  ))}
                </div>
              )}

              <div className="flex items-start gap-2">
                <PersonAvatar id={task.assigneeId} name={task.assigneeName ?? "?"} size={28} />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <input
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") submitComment(); }}
                      placeholder="Add a comment…"
                      className="flex-1 text-[13px] border border-[#c1c7d0] bg-white rounded px-3 py-2 outline-none focus:border-[#1868db]"
                    />
                    <button
                      onClick={submitComment}
                      disabled={(!draft.trim() && pendingAtts.length === 0) || addComment.isPending}
                      className="inline-flex items-center gap-1.5 text-[13px] font-medium px-3 py-2 rounded bg-[#1868db] text-white hover:bg-[#1558bc] disabled:opacity-50"
                    >
                      <Send size={13} /> Post
                    </button>
                  </div>
                  <div className="mt-2"><FileDropzone compact onUploaded={(meta) => { setPendingAtts((p) => [...p, meta]); }} /></div>
                </div>
              </div>
            </div>
          </div>

          {/* ── RIGHT (sidebar) ── */}
          <div className="w-[290px] shrink-0 border-l border-[#dfe1e6] px-4 pt-4 pb-10 bg-white">
            {/* Status + Actions */}
            <div className="flex items-center gap-2 mb-5">
              <div className="h-8 min-w-[120px] rounded overflow-hidden border border-[#dfe1e6]">
                <StatusSelect value={task.status} onChange={(v) => patch.mutate({ status: v })} />
              </div>
            </div>

            {/* Details panel */}
            <div className="border border-[#dfe1e6] rounded-lg">
              <button
                onClick={() => setDetailsOpen((v) => !v)}
                className="w-full flex items-center justify-between px-4 py-2.5 text-[14px] font-semibold text-[#172b4d]"
              >
                Details
                <span className="flex items-center gap-2 text-[#626f86]">
                  <Settings size={15} />
                  <ChevronUp size={16} className={detailsOpen ? "" : "rotate-180"} />
                </span>
              </button>
              {detailsOpen && (
                <div className="px-4 pb-3 pt-1 border-t border-[#dfe1e6]">
                  <SidebarRow label="Assignee">
                    <div className="flex items-center gap-2 min-w-0">
                      <PersonAvatar id={task.assigneeId} name={task.assigneeName ?? "Unassigned"} size={24} />
                      <select
                        value={task.assigneeId ?? ""}
                        onChange={(e) => { const v = e.target.value; patch.mutate({ assigneeId: v ? Number(v) : null }); }}
                        className="flex-1 min-w-0 truncate text-[13px] bg-transparent border border-transparent hover:bg-[#f1f2f4] rounded pl-1 pr-5 py-0.5 outline-none cursor-pointer"
                      >
                        <option value="">Unassigned</option>
                        {people.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                      </select>
                    </div>
                  </SidebarRow>
                  <SidebarRow label="Labels"><span className="text-[#626f86]">None</span></SidebarRow>
                  <SidebarRow label="Parent">
                    {parent ? <span className="truncate text-[#1868db]">{codeOf(parent.id)} · {parent.name}</span> : <span className="text-[#626f86]">None</span>}
                  </SidebarRow>
                  <SidebarRow label="Team"><span className="text-[#626f86]">None</span></SidebarRow>
                  <SidebarRow label="Priority">
                    <div className="h-7 -ml-1 w-fit rounded overflow-hidden"><PrioritySelect value={task.priority} onChange={(v) => patch.mutate({ priority: v })} /></div>
                  </SidebarRow>
                  <SidebarRow label="Time tracking">
                    <div>
                      <div className="h-1.5 rounded-full bg-[#dfe1e6] overflow-hidden mb-1"><div className="h-full bg-[#1868db]" style={{ width: `${timePct}%` }} /></div>
                      <span className="text-[12px] text-[#626f86] num-tabular">{logged}h logged{est > 0 ? ` / ${est}h est` : ""}</span>
                    </div>
                  </SidebarRow>
                  <SidebarRow label="Original estimate"><span className="num-tabular">{est > 0 ? `${est}h` : "0m"}</span></SidebarRow>
                  <SidebarRow label="Development">
                    <div className="space-y-1 text-[13px] text-[#1868db]">
                      <span className="flex items-center gap-1.5"><GitBranch size={14} /> Create branch</span>
                      <span className="flex items-center gap-1.5"><Plus size={14} /> Create commit</span>
                    </div>
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
