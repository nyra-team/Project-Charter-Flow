import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  DragOverlay,
  DragEndEvent,
  DragStartEvent,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
} from "@dnd-kit/core";
import { motion, AnimatePresence } from "framer-motion";
import { useUpdateTask, useUpdateMilestone } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { TASK_STATUSES, getStatusMeta, getPriorityMeta, getRagColor } from "../lib/task-constants";
import { Calendar, Clock, Layers, GripVertical, Flag } from "lucide-react";
import { LogTimeModal } from "./log-time-modal";

export interface BoardTask {
  id: number;
  name: string;
  status: string;
  priority: string;
  rag?: string | null;
  assigneeName?: string | null;
  endDate?: string | null;
  dueDate?: string | null;
  parentTaskId?: number | null;
  isCritical?: boolean;
  subtaskCount?: number;
  /** Shown on the card in global (cross-project) mode. */
  projectName?: string | null;
}

interface ConnectBoardProps {
  tasks: BoardTask[];
  milestones: Array<{ id: number; name: string; status: string; priority: string; rag?: string | null; dueDate?: string | null }>;
  projectId: number;
  onRefresh: () => void;
  onTaskClick?: (taskId: number) => void;
}

type DragKind = "task" | "milestone";
type CardData = Parameters<typeof TaskCard>[0]["task"];
interface DragData {
  kind: DragKind;
  id: number;
  status: string;
  card: CardData;
  isMilestone: boolean;
}

function encodeId(kind: DragKind, id: number) {
  return `${kind}-${id}`;
}

function decodeId(raw: string | number): { kind: DragKind; id: number } | null {
  const s = String(raw);
  if (s.startsWith("task-")) return { kind: "task", id: parseInt(s.slice(5)) };
  if (s.startsWith("milestone-")) return { kind: "milestone", id: parseInt(s.slice(10)) };
  return null;
}

function TaskCard({
  task,
  isDragging,
  isMilestone,
  onClick,
  onLogTime,
}: {
  task: { id: number; name: string; status: string; priority: string; rag?: string | null; assigneeName?: string | null; endDate?: string | null; dueDate?: string | null; isCritical?: boolean; subtaskCount?: number; isSubtask?: boolean; projectName?: string | null };
  isDragging?: boolean;
  isMilestone?: boolean;
  onClick?: () => void;
  onLogTime?: (taskId: number, taskName: string) => void;
}) {
  const priMeta = getPriorityMeta(task.priority);
  const ragColor = getRagColor(task.rag ?? "green");
  const dueDate = task.endDate ?? task.dueDate;
  const done = task.status === "completed";
  const overdue = !!dueDate && !done && new Date(dueDate) < new Date(new Date().toDateString());
  const initials = (task.assigneeName ?? "")
    .split(" ").map(s => s[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();

  return (
    <div
      onClick={!isDragging ? onClick : undefined}
      style={{ marginLeft: task.isSubtask ? 10 : 0 }}
      className={`group bg-card rounded-xl overflow-hidden border transition-[box-shadow,border-color] duration-150 select-none ${
        isDragging
          ? "ring-2 ring-primary/40 shadow-lg border-primary/30 cursor-grabbing"
          : "border-border shadow-sm hover:shadow-md hover:border-primary/30 cursor-grab"
      }`}
    >
      {/* RAG health accent bar (Planner-style) */}
      <div className="h-1 w-full" style={{ background: ragColor }} />

      <div className="p-3.5">
        {/* Top row — grip + priority + type badges */}
        <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
          <GripVertical className="w-3.5 h-3.5 -ml-1 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors flex-shrink-0" />
          <span
            className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider border px-1.5 py-0.5 rounded"
            style={{ background: priMeta.bg, color: priMeta.color, borderColor: `${priMeta.color}55` }}
          >
            <Flag className="w-2.5 h-2.5" /> {priMeta.value}
          </span>
          {isMilestone && (
            <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border bg-primary/10 text-primary border-primary/20">Milestone</span>
          )}
          {task.isSubtask && (
            <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border bg-muted text-muted-foreground border-border">Subtask</span>
          )}
          {task.isCritical && !isMilestone && (
            <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border bg-destructive/10 text-destructive border-destructive/20">Critical Path</span>
          )}
        </div>

        {/* Title */}
        <h4
          className={`text-[14px] leading-snug font-semibold ${done ? "line-through text-muted-foreground" : "text-foreground"}`}
          style={{ wordBreak: "break-word" }}
        >
          {task.name}
        </h4>
        {task.projectName && (
          <p className="text-[11px] text-muted-foreground mt-1 truncate">{task.projectName}</p>
        )}

        {/* Meta row — due date + subtask count */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2.5 text-[11px] font-medium">
          {dueDate && (
            <span className={`inline-flex items-center gap-1 ${overdue ? "text-destructive" : "text-muted-foreground"}`}>
              <Calendar className="w-3 h-3" />
              {new Date(dueDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}{overdue ? " · overdue" : ""}
            </span>
          )}
          {(task.subtaskCount ?? 0) > 0 && (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Layers className="w-3 h-3" /> {task.subtaskCount}
            </span>
          )}
        </div>

        {/* Footer — assignee + log time */}
        {(task.assigneeName || (!isMilestone && onLogTime)) && (
          <div className="mt-2.5 pt-2 border-t border-border/60 flex items-center justify-between">
            {task.assigneeName ? (
              <span className="flex items-center gap-1.5 min-w-0">
                <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-[9px] font-bold flex items-center justify-center flex-shrink-0">{initials}</span>
                <span className="text-[11px] font-medium text-muted-foreground truncate max-w-[100px]">{task.assigneeName}</span>
              </span>
            ) : (
              <span className="text-[11px] text-muted-foreground/40">Unassigned</span>
            )}
            {!isMilestone && onLogTime && (
              <button
                onClick={e => { e.stopPropagation(); onLogTime(task.id, task.name); }}
                title="Log time"
                className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-primary hover:bg-primary/10 rounded px-1.5 py-0.5 transition-colors opacity-0 group-hover:opacity-100"
              >
                <Clock className="w-3 h-3" /> Log
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function DroppableColumn({
  status,
  label,
  color,
  bg,
  children,
  count,
}: {
  status: string;
  label: string;
  color: string;
  bg: string;
  children: React.ReactNode;
  count: number;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col flex-shrink-0 rounded-2xl border transition-colors ${
        isOver ? "border-primary/50 bg-primary/5 ring-2 ring-primary/15" : "border-border/70 bg-muted/30"
      }`}
      style={{ minWidth: 340, width: 340 }}
    >
      {/* Bucket header — use the semantic status color (`bg`) for the dot + label.
          `color` is the white pill-foreground and would render invisible here. */}
      <div className="flex items-center gap-2 px-3.5 pt-3.5 pb-2.5">
        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: bg }} />
        <h3 className="text-[12px] font-bold uppercase tracking-wider flex-1 truncate" style={{ color: bg }}>
          {label}
        </h3>
        <span className="text-[11px] font-bold text-muted-foreground bg-card border border-border rounded-full min-w-[20px] text-center px-1.5">
          {count}
        </span>
      </div>

      {/* Card list (whole column is the drop target) */}
      <div className="px-2.5 pb-2.5 space-y-2.5 flex-1" style={{ minHeight: 140 }}>
        {children}
        {count === 0 && (
          <div className={`text-[12px] rounded-xl py-9 text-center border border-dashed transition-colors ${
            isOver ? "border-primary/40 text-primary bg-card/60" : "border-border text-muted-foreground/50"
          }`}>
            {isOver ? "Drop here" : "No tasks"}
          </div>
        )}
      </div>
    </div>
  );
}

function DraggableCard({
  dragId,
  task,
  isMilestone,
  onTaskClick,
  onLogTime,
}: {
  dragId: string;
  task: Parameters<typeof TaskCard>[0]["task"];
  isMilestone?: boolean;
  onTaskClick?: (id: number) => void;
  onLogTime?: (taskId: number, taskName: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: dragId });

  // The moving preview is rendered by <DragOverlay>; the original card simply
  // dims (and ignores pointer events) while it's being dragged.
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{ touchAction: "none" }}
      className={isDragging ? "opacity-40 pointer-events-none" : ""}
    >
      <TaskCard
        task={task}
        isMilestone={isMilestone}
        onClick={!isMilestone ? () => onTaskClick?.(task.id) : undefined}
        onLogTime={onLogTime}
      />
    </div>
  );
}

export function ConnectBoard({ tasks, milestones, projectId: _projectId, onRefresh, onTaskClick }: ConnectBoardProps) {
  const { toast } = useToast();
  const updateTask = useUpdateTask();
  const updateMilestone = useUpdateMilestone();
  const [activeDrag, setActiveDrag] = useState<DragData | null>(null);
  const [timelogModal, setTimelogModal] = useState<{ taskId: number; taskName: string } | null>(null);

  // Optimistic status overrides so a dropped card jumps to its new column
  // INSTANTLY, instead of waiting for the server round-trip + refetch.
  // Keyed "t-<id>" / "m-<id>". Pruned once the refreshed props catch up.
  const [optimistic, setOptimistic] = useState<Record<string, string>>({});
  useEffect(() => {
    setOptimistic(prev => {
      if (!Object.keys(prev).length) return prev;
      let changed = false;
      const next = { ...prev };
      for (const t of tasks) { const k = `t-${t.id}`; if (next[k] !== undefined && next[k] === t.status) { delete next[k]; changed = true; } }
      for (const m of milestones) { const k = `m-${m.id}`; if (next[k] !== undefined && next[k] === m.status) { delete next[k]; changed = true; } }
      return changed ? next : prev;
    });
  }, [tasks, milestones]);
  const taskStatus = (t: { id: number; status: string }) => optimistic[`t-${t.id}`] ?? t.status;
  const msStatus = (m: { id: number; status: string }) => optimistic[`m-${m.id}`] ?? m.status;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  // Subtask count per top-level task
  const subtaskCountMap: Record<number, number> = {};
  for (const t of tasks) {
    if (t.parentTaskId) {
      subtaskCountMap[t.parentTaskId] = (subtaskCountMap[t.parentTaskId] ?? 0) + 1;
    }
  }

  // Include ALL tasks (top-level + subtasks) on the board
  const allBoardTasks = tasks.map(t => ({ ...t, subtaskCount: subtaskCountMap[t.id] ?? 0 }));
  function handleDragStart(event: DragStartEvent) {
    const decoded = decodeId(event.active.id);
    if (!decoded) return;
    const { kind, id } = decoded;
    if (kind === "task") {
      const t = allBoardTasks.find(x => x.id === id);
      if (t) setActiveDrag({ kind, id, status: t.status, isMilestone: false, card: { ...t, isSubtask: !!t.parentTaskId } });
    } else {
      const m = milestones.find(x => x.id === id);
      if (m) setActiveDrag({ kind, id, status: m.status, isMilestone: true, card: { ...m, endDate: m.dueDate } });
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDrag(null);
    const { active, over } = event;
    if (!over) return;

    const decoded = decodeId(active.id);
    if (!decoded) return;
    const newStatus = over.id as string;
    const { kind, id } = decoded;

    if (kind === "task") {
      // Lookup from allBoardTasks so subtask drags are handled correctly
      const current = allBoardTasks.find(t => t.id === id);
      if (!current || current.status === newStatus) return;
      const key = `t-${id}`;
      setOptimistic(prev => ({ ...prev, [key]: newStatus })); // move instantly
      updateTask.mutate(
        { id, data: { status: newStatus } },
        {
          onSuccess: () => onRefresh(),
          onError: () => {
            setOptimistic(prev => { const n = { ...prev }; delete n[key]; return n; }); // snap back
            toast({ title: "Failed to update status", variant: "destructive" });
            onRefresh();
          },
        }
      );
    } else {
      const current = milestones.find(m => m.id === id);
      if (!current || current.status === newStatus) return;
      const key = `m-${id}`;
      setOptimistic(prev => ({ ...prev, [key]: newStatus })); // move instantly
      updateMilestone.mutate(
        { id, data: { status: newStatus } },
        {
          onSuccess: () => onRefresh(),
          onError: () => {
            setOptimistic(prev => { const n = { ...prev }; delete n[key]; return n; }); // snap back
            toast({ title: "Failed to update milestone status", variant: "destructive" });
            onRefresh();
          },
        }
      );
    }
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragCancel={() => setActiveDrag(null)} onDragEnd={handleDragEnd}>
      <div className="flex gap-4 overflow-x-auto pb-4" style={{ minHeight: 400 }}>
        {TASK_STATUSES.map(s => {
          const msItems = milestones.filter(m => msStatus(m) === s.value);
          const colTasks = allBoardTasks.filter(t => taskStatus(t) === s.value);
          const totalCount = colTasks.length + msItems.length;

          return (
            <DroppableColumn
              key={s.value}
              status={s.value}
              label={s.label}
              color={s.color}
              bg={s.bg}
              count={totalCount}
            >
              <AnimatePresence initial={false}>
                {colTasks.map(task => (
                  <motion.div
                    key={`t-${task.id}`}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.13 }}
                  >
                    <DraggableCard
                      dragId={encodeId("task", task.id)}
                      task={{ ...task, isSubtask: !!task.parentTaskId }}
                      onTaskClick={onTaskClick}
                      onLogTime={(id, name) => setTimelogModal({ taskId: id, taskName: name })}
                    />
                  </motion.div>
                ))}
                {msItems.map(ms => (
                  <motion.div
                    key={`m-${ms.id}`}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.13 }}
                  >
                    <DraggableCard
                      dragId={encodeId("milestone", ms.id)}
                      task={{ ...ms, endDate: ms.dueDate, subtaskCount: tasks.filter(t => (t as { milestoneId?: number | null }).milestoneId === ms.id && !t.parentTaskId).length }}
                      isMilestone
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            </DroppableColumn>
          );
        })}
      </div>

      {/* Drag preview — a Planner-style lifted card that follows the cursor.
          dropAnimation=null: the optimistic move already placed the real card,
          so the overlay vanishes instantly instead of flying in behind it. */}
      <DragOverlay dropAnimation={null}>
        {activeDrag ? (
          <div
            style={{ width: 248, transform: "rotate(3deg) scale(1.03)" }}
            className="cursor-grabbing rounded-xl shadow-[0_18px_40px_-12px_rgba(15,23,42,0.45)]"
          >
            <TaskCard task={activeDrag.card} isMilestone={activeDrag.isMilestone} isDragging />
          </div>
        ) : null}
      </DragOverlay>

      {timelogModal && (
        <LogTimeModal
          open={true}
          onClose={() => setTimelogModal(null)}
          taskId={timelogModal.taskId}
          taskName={timelogModal.taskName}
        />
      )}
    </DndContext>
  );
}
