// Work Breakdown Structure tree — Stage → Milestone → Task → Subtask.
// One project's hierarchy: expand/collapse each level, progress rolls up
// (subtask→task→milestone→stage), task rows carry owner/status/priority/due/
// SLA/approval, and drag-and-drop reparents work across the hierarchy
// (task→milestone, milestone→stage, subtask→task). Row click opens the
// shared TaskDetailModal (handled by the parent page).
import { useState, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  DndContext, DragEndEvent, DragStartEvent, PointerSensor, useSensor, useSensors,
  useDroppable, useDraggable,
} from "@dnd-kit/core";
import { useUpdateTask, useUpdateMilestone, useCreateTask, useCreateMilestone } from "@workspace/api-client-react";
import { ChevronRight, Plus, GripVertical, GitBranch, Stamp, Flag } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { applicableStageKeys, getStageConfig, canonicalStageKey } from "@/lib/lifecycle-config";
import { TaskStatusChip, PriorityChip } from "./task-status-chip";
import { PersonAvatar } from "./person-avatar";

// ── Minimal shapes (superset-compatible with AggTask / project task rows) ─────
export interface WbsTask {
  id: number; name: string; milestoneId: number | null; parentTaskId: number | null;
  stage: string | null; status: string; priority: string; progressPct: number;
  assigneeId: number | null; assigneeName: string | null; endDate: string | null;
  predecessorIds?: number[] | string; isCritical?: boolean;
  gate?: { approver?: { name: string } | null; daysOverdue?: number; pendingApproval?: boolean } | null;
}
export interface WbsMilestone {
  id: number; name: string; stage: string | null; status: string;
  dueDate: string | null; gateDecision: string | null; order?: number;
}

const UNASSIGNED = "__unassigned__";

function depCount(p: WbsTask["predecessorIds"]): number {
  if (Array.isArray(p)) return p.length;
  try { return (JSON.parse((p as string) || "[]") as number[]).length; } catch { return 0; }
}

function ProgressBar({ pct, className = "" }: { pct: number; className?: string }) {
  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      </div>
      <span className="text-[10px] text-muted-foreground font-mono w-7 text-right">{Math.round(pct)}%</span>
    </div>
  );
}

export function WbsTree({
  projectId, projectType, milestones, tasks, onOpenTask, onRefresh,
}: {
  projectId: number;
  projectType?: string | null;
  milestones: WbsMilestone[];
  tasks: WbsTask[];
  onOpenTask: (t: WbsTask) => void;
  onRefresh: () => void;
}) {
  const { toast } = useToast();
  const updateTask = useUpdateTask();
  const updateMilestone = useUpdateMilestone();
  const createTask = useCreateTask();
  const createMilestone = useCreateMilestone();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try { const raw = localStorage.getItem(`wbs:${projectId}`); if (raw) return new Set(JSON.parse(raw)); } catch { /* ignore */ }
    // First open (no saved state): expand every stage that has milestones so the
    // breakdown shows all milestones under each stage right away — no need to
    // click each collapsed stage open.
    const def = new Set<string>();
    for (const m of milestones) def.add(`stage:${canonicalStageKey(m.stage) ?? UNASSIGNED}`);
    return def;
  });
  const toggle = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      try { localStorage.setItem(`wbs:${projectId}`, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }, [projectId]);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");

  // ── Build the nested model ──────────────────────────────────────────────
  const subtasksByParent = new Map<number, WbsTask[]>();
  for (const t of tasks) if (t.parentTaskId != null) (subtasksByParent.get(t.parentTaskId) ?? subtasksByParent.set(t.parentTaskId, []).get(t.parentTaskId)!).push(t);
  const tasksByMs = new Map<number, WbsTask[]>();
  for (const t of tasks) if (t.parentTaskId == null && t.milestoneId != null) (tasksByMs.get(t.milestoneId) ?? tasksByMs.set(t.milestoneId, []).get(t.milestoneId)!).push(t);
  const msByStage = new Map<string, WbsMilestone[]>();
  for (const m of milestones) {
    // Fold deprecated stage keys into their canonical home (e.g. legacy
    // "design" → "solution_design") so post-redesign milestones still group
    // under the stage the user expects instead of vanishing into a deprecated
    // box that the canonical flow no longer renders.
    const key = canonicalStageKey(m.stage) ?? UNASSIGNED;
    (msByStage.get(key) ?? msByStage.set(key, []).get(key)!).push(m);
  }

  const stageKeys = [...applicableStageKeys(projectType)];
  if (msByStage.has(UNASSIGNED)) stageKeys.push(UNASSIGNED);

  // ── Rollups ───────────────────────────────────────────────────────────────
  const taskProgress = (t: WbsTask): number => {
    const subs = subtasksByParent.get(t.id) ?? [];
    return subs.length ? subs.reduce((s, x) => s + (x.progressPct ?? 0), 0) / subs.length : (t.progressPct ?? 0);
  };
  const msProgress = (m: WbsMilestone): number => {
    const ts = tasksByMs.get(m.id) ?? [];
    return ts.length ? ts.reduce((s, t) => s + taskProgress(t), 0) / ts.length : 0;
  };
  const stageProgress = (key: string): number => {
    const ms = msByStage.get(key) ?? [];
    return ms.length ? ms.reduce((s, m) => s + msProgress(m), 0) / ms.length : 0;
  };

  // ── DnD reparent ────────────────────────────────────────────────────────
  const [dragLabel, setDragLabel] = useState<string | null>(null);
  function onDragStart(e: DragStartEvent) {
    const id = String(e.active.id);
    setDragLabel(id);
  }
  function onDragEnd(e: DragEndEvent) {
    setDragLabel(null);
    const { active, over } = e;
    if (!over) return;
    const a = String(active.id), o = String(over.id);
    // task:<id> dropped on drop-ms:<id> → move task to milestone (+inherit stage)
    if (a.startsWith("task:") && o.startsWith("drop-ms:")) {
      const taskId = Number(a.slice(5)); const msId = Number(o.slice(8));
      const t = tasks.find((x) => x.id === taskId);
      if (!t || t.milestoneId === msId) return;
      const m = milestones.find((x) => x.id === msId);
      updateTask.mutate({ id: taskId, data: { milestoneId: msId, ...(m?.stage ? { stage: m.stage } : {}) } }, {
        onSuccess: () => { toast({ title: `Moved to ${m?.name ?? "milestone"}` }); onRefresh(); },
        onError: () => toast({ title: "Move failed", variant: "destructive" }),
      });
    } else if (a.startsWith("ms:") && o.startsWith("drop-stage:")) {
      const msId = Number(a.slice(3)); const stage = o.slice(11);
      const m = milestones.find((x) => x.id === msId);
      if (!m || (m.stage ?? UNASSIGNED) === stage) return;
      updateMilestone.mutate({ id: msId, data: { stage: stage === UNASSIGNED ? "" : stage } }, {
        onSuccess: () => { toast({ title: `Moved to ${getStageConfig(stage)?.label ?? "stage"}` }); onRefresh(); },
        onError: () => toast({ title: "Move failed", variant: "destructive" }),
      });
    } else if (a.startsWith("sub:") && o.startsWith("drop-task:")) {
      const subId = Number(a.slice(4)); const parentId = Number(o.slice(10));
      const sub = tasks.find((x) => x.id === subId);
      if (!sub || sub.parentTaskId === parentId || subId === parentId) return;
      const parent = tasks.find((x) => x.id === parentId);
      updateTask.mutate({ id: subId, data: { parentTaskId: parentId, milestoneId: parent?.milestoneId ?? undefined } }, {
        onSuccess: () => { toast({ title: "Subtask moved" }); onRefresh(); },
        onError: () => toast({ title: "Move failed", variant: "destructive" }),
      });
    }
  }

  // ── Inline create ─────────────────────────────────────────────────────────
  function submitAdd() {
    const name = draftName.trim();
    const target = addingTo;
    if (!name || !target) { setAddingTo(null); setDraftName(""); return; }
    const done = { onSuccess: () => { setAddingTo(null); setDraftName(""); onRefresh(); }, onError: () => toast({ title: "Create failed", variant: "destructive" }) };
    if (target.startsWith("stage:")) {
      const stage = target.slice(6);
      createMilestone.mutate({ id: projectId, data: { name, ...(stage !== UNASSIGNED ? { stage } : {}) } } as never, done);
    } else if (target.startsWith("ms:")) {
      const msId = Number(target.slice(3));
      const m = milestones.find((x) => x.id === msId);
      createTask.mutate({ id: projectId, data: { name, milestoneId: msId, priority: "P2", ...(m?.stage ? { stage: m.stage } : {}) } } as never, done);
    } else if (target.startsWith("task:")) {
      const parentId = Number(target.slice(5));
      const p = tasks.find((x) => x.id === parentId);
      createTask.mutate({ id: projectId, data: { name, parentTaskId: parentId, milestoneId: p?.milestoneId ?? undefined, priority: "P2" } } as never, done);
    }
  }

  const setAll = useCallback((next: Set<string>) => {
    setExpanded(next);
    try { localStorage.setItem(`wbs:${projectId}`, JSON.stringify([...next])); } catch { /* ignore */ }
  }, [projectId]);
  const stagesWithMs = stageKeys.filter((k) => (msByStage.get(k)?.length ?? 0) > 0);

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="space-y-2">
        <div className="flex items-center gap-2 justify-end">
          <button
            onClick={() => setAll(new Set(stagesWithMs.map((k) => `stage:${k}`)))}
            className="text-[11px] px-2 py-1 rounded-md border border-border bg-background hover:bg-accent/40 text-muted-foreground hover:text-foreground"
          >Expand all</button>
          <button
            onClick={() => setAll(new Set())}
            className="text-[11px] px-2 py-1 rounded-md border border-border bg-background hover:bg-accent/40 text-muted-foreground hover:text-foreground"
          >Collapse all</button>
        </div>
        {stageKeys.map((stageKey) => {
          const cfg = stageKey === UNASSIGNED ? null : getStageConfig(stageKey);
          const ms = (msByStage.get(stageKey) ?? []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
          const sExpanded = expanded.has(`stage:${stageKey}`);
          const color = cfg?.color ?? "#94A3B8";
          return (
            <StageDrop key={stageKey} stageKey={stageKey}>
              <div className="rounded-xl border border-card-border bg-card glass-surface overflow-hidden">
                {/* Stage header */}
                <div className="flex items-center gap-2 px-3 py-2.5" style={{ background: `linear-gradient(90deg, ${color}14, transparent)` }}>
                  <button onClick={() => toggle(`stage:${stageKey}`)} className="flex items-center gap-2 min-w-0 flex-1 text-left">
                    <ChevronRight size={15} className={`text-muted-foreground transition-transform ${sExpanded ? "rotate-90" : ""}`} />
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
                    <span className="text-sm font-semibold text-foreground truncate">{cfg?.label ?? "Unassigned Stage"}</span>
                    <span className="text-[11px] text-muted-foreground">· {ms.length} milestone{ms.length === 1 ? "" : "s"}</span>
                  </button>
                  <ProgressBar pct={stageProgress(stageKey)} />
                  <button onClick={() => { setAddingTo(`stage:${stageKey}`); setDraftName(""); }} className="p-1 rounded text-muted-foreground hover:text-primary hover:bg-accent/50" title="Add milestone"><Plus size={14} /></button>
                </div>

                <Collapsible open={sExpanded}>
                  <div className="pl-3 pr-2 pb-2 space-y-1.5">
                    {addingTo === `stage:${stageKey}` && <AddRow placeholder="New milestone name…" onSubmit={submitAdd} onCancel={() => setAddingTo(null)} value={draftName} setValue={setDraftName} />}
                    {ms.map((m) => {
                      const mTasks = (tasksByMs.get(m.id) ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
                      const mExpanded = expanded.has(`ms:${m.id}`);
                      const doneTasks = mTasks.filter((t) => t.status === "completed").length;
                      return (
                        <MilestoneDrop key={m.id} msId={m.id}>
                          <div className="rounded-lg border border-border/60 bg-muted/20">
                            {/* Milestone row */}
                            <div className="flex items-center gap-2 px-2.5 py-2">
                              <DragHandle id={`ms:${m.id}`} />
                              <button onClick={() => toggle(`ms:${m.id}`)} className="flex items-center gap-1.5 min-w-0 flex-1 text-left">
                                <ChevronRight size={13} className={`text-muted-foreground transition-transform ${mExpanded ? "rotate-90" : ""}`} />
                                <Flag size={12} className="text-primary flex-shrink-0" />
                                <span className="text-[13px] font-medium text-foreground truncate">{m.name}</span>
                                <span className="text-[10px] text-muted-foreground">· {doneTasks}/{mTasks.length}</span>
                                {m.gateDecision && <span className="text-[9px] uppercase font-semibold px-1 rounded bg-muted text-muted-foreground">{m.gateDecision.replace("_", "-")}</span>}
                              </button>
                              <ProgressBar pct={msProgress(m)} />
                              <TaskStatusChip status={m.status} />
                              <button onClick={() => { setAddingTo(`ms:${m.id}`); setDraftName(""); }} className="p-1 rounded text-muted-foreground hover:text-primary hover:bg-accent/50" title="Add task"><Plus size={13} /></button>
                            </div>

                            <Collapsible open={mExpanded}>
                              <div className="pl-6 pr-2 pb-2 space-y-1">
                                {addingTo === `ms:${m.id}` && <AddRow placeholder="New task name…" onSubmit={submitAdd} onCancel={() => setAddingTo(null)} value={draftName} setValue={setDraftName} />}
                                {mTasks.map((t) => {
                                  const subs = (subtasksByParent.get(t.id) ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
                                  const tExpanded = expanded.has(`task:${t.id}`);
                                  const deps = depCount(t.predecessorIds);
                                  return (
                                    <TaskDrop key={t.id} taskId={t.id}>
                                      <div className="rounded-md border border-border/50 bg-card">
                                        <div className="flex items-center gap-2 px-2 py-1.5">
                                          <DragHandle id={`task:${t.id}`} />
                                          <button onClick={() => subs.length ? toggle(`task:${t.id}`) : onOpenTask(t)} className="flex items-center gap-1 flex-shrink-0">
                                            {subs.length > 0 ? <ChevronRight size={12} className={`text-muted-foreground transition-transform ${tExpanded ? "rotate-90" : ""}`} /> : <span className="w-3" />}
                                          </button>
                                          <button onClick={() => onOpenTask(t)} className="text-[13px] text-foreground hover:text-primary truncate flex-1 text-left">{t.name}</button>
                                          {deps > 0 && <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground" title={`${deps} dependency(ies)`}><GitBranch size={10} />{deps}</span>}
                                          {t.gate?.pendingApproval && <Stamp size={12} className="text-warn flex-shrink-0" aria-label="Awaiting approval" />}
                                          {(t.gate?.daysOverdue ?? 0) > 0 && <span className="text-[10px] font-bold text-destructive">{t.gate!.daysOverdue}d</span>}
                                          {t.assigneeName && <PersonAvatar id={t.assigneeId} name={t.assigneeName} size={18} />}
                                          <PriorityChip priority={t.priority} />
                                          <ProgressBar pct={taskProgress(t)} />
                                          <TaskStatusChip status={t.status} />
                                          <button onClick={() => { setAddingTo(`task:${t.id}`); setDraftName(""); }} className="p-1 rounded text-muted-foreground hover:text-primary hover:bg-accent/50" title="Add subtask"><Plus size={12} /></button>
                                        </div>
                                        <Collapsible open={tExpanded}>
                                          <div className="pl-7 pr-2 pb-1.5 space-y-1">
                                            {addingTo === `task:${t.id}` && <AddRow placeholder="New subtask name…" onSubmit={submitAdd} onCancel={() => setAddingTo(null)} value={draftName} setValue={setDraftName} />}
                                            {subs.map((s) => (
                                              <div key={s.id} className="flex items-center gap-2 px-2 py-1 rounded bg-muted/30">
                                                <DragHandle id={`sub:${s.id}`} />
                                                <button onClick={() => onOpenTask(s)} className="text-xs text-foreground hover:text-primary truncate flex-1 text-left">{s.name}</button>
                                                {s.assigneeName && <PersonAvatar id={s.assigneeId} name={s.assigneeName} size={16} />}
                                                <ProgressBar pct={s.progressPct ?? 0} />
                                                <TaskStatusChip status={s.status} />
                                              </div>
                                            ))}
                                          </div>
                                        </Collapsible>
                                      </div>
                                    </TaskDrop>
                                  );
                                })}
                                {mTasks.length === 0 && addingTo !== `ms:${m.id}` && <p className="text-[11px] text-muted-foreground/60 italic py-1">No tasks — drag one here or click +</p>}
                              </div>
                            </Collapsible>
                          </div>
                        </MilestoneDrop>
                      );
                    })}
                    {ms.length === 0 && addingTo !== `stage:${stageKey}` && <p className="text-[11px] text-muted-foreground/60 italic py-1">No milestones in this stage</p>}
                  </div>
                </Collapsible>
              </div>
            </StageDrop>
          );
        })}
      </div>
      {dragLabel && <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 text-[11px] px-3 py-1.5 rounded-full bg-foreground text-background shadow-lg">Drop on a milestone / stage / task to move</div>}
    </DndContext>
  );
}

// Smooth Monday.com-style expand/collapse: animates height 0↔auto + opacity.
// Uses framer-motion (already a dependency). overflow:hidden so the parent
// clips children during the transition; the ease matches Monday's snappy feel.
function Collapsible({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="c"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
          style={{ overflow: "hidden" }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── DnD primitives ────────────────────────────────────────────────────────
function DragHandle({ id }: { id: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id });
  return (
    <span ref={setNodeRef} {...listeners} {...attributes} className={`cursor-grab text-muted-foreground/40 hover:text-muted-foreground flex-shrink-0 ${isDragging ? "opacity-50" : ""}`} title="Drag to move">
      <GripVertical size={13} />
    </span>
  );
}
function StageDrop({ stageKey, children }: { stageKey: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `drop-stage:${stageKey}` });
  return <div ref={setNodeRef} className={isOver ? "ring-2 ring-primary/40 rounded-xl" : ""}>{children}</div>;
}
function MilestoneDrop({ msId, children }: { msId: number; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `drop-ms:${msId}` });
  return <div ref={setNodeRef} className={isOver ? "ring-2 ring-primary/40 rounded-lg" : ""}>{children}</div>;
}
function TaskDrop({ taskId, children }: { taskId: number; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `drop-task:${taskId}` });
  return <div ref={setNodeRef} className={isOver ? "ring-2 ring-primary/40 rounded-md" : ""}>{children}</div>;
}
function AddRow({ placeholder, value, setValue, onSubmit, onCancel }: { placeholder: string; value: string; setValue: (v: string) => void; onSubmit: () => void; onCancel: () => void }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <input
        autoFocus value={value} onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") onSubmit(); if (e.key === "Escape") onCancel(); }}
        onBlur={onSubmit} placeholder={placeholder}
        className="flex-1 text-xs border border-input bg-background rounded-md px-2.5 py-1.5 outline-none focus:ring-2 focus:ring-ring/40"
      />
    </div>
  );
}
