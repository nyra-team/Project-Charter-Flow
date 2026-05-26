import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  DragEndEvent,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
} from "@dnd-kit/core";
import { useUpdateTask, useUpdateMilestone } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { TASK_STATUSES, getStatusMeta, getPriorityMeta, getRagColor } from "../lib/task-constants";
import { Calendar, Clock, Layers } from "lucide-react";
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
}

interface ConnectBoardProps {
  tasks: BoardTask[];
  milestones: Array<{ id: number; name: string; status: string; priority: string; rag?: string | null; dueDate?: string | null }>;
  projectId: number;
  onRefresh: () => void;
  onTaskClick?: (taskId: number) => void;
}

type DragKind = "task" | "milestone";
interface DragData {
  kind: DragKind;
  id: number;
  status: string;
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
  task: { id: number; name: string; status: string; priority: string; rag?: string | null; assigneeName?: string | null; endDate?: string | null; dueDate?: string | null; isCritical?: boolean; subtaskCount?: number; isSubtask?: boolean };
  isDragging?: boolean;
  isMilestone?: boolean;
  onClick?: () => void;
  onLogTime?: (taskId: number, taskName: string) => void;
}) {
  const priMeta = getPriorityMeta(task.priority);
  const ragColor = getRagColor(task.rag ?? "green");
  const dueDate = task.endDate ?? task.dueDate;

  return (
    <div
      className={`p-3 space-y-2 select-none border transition-all ${
        isDragging
          ? "border-primary shadow-[0_8px_25px_hsl(var(--primary)/0.25)] opacity-90 cursor-grabbing"
          : task.isSubtask
          ? "bg-primary/5 border-primary/20 cursor-grab"
          : isMilestone
          ? "bg-card border-primary/20 cursor-grab"
          : "bg-card border-border cursor-grab shadow-sm hover:border-primary/30"
      }`}
      style={{ marginLeft: task.isSubtask ? 8 : 0 }}
      onClick={!isDragging ? onClick : undefined}
    >
      <div className="flex items-start gap-2">
        <span
          className="rounded-full flex-shrink-0 self-stretch"
          style={{ background: ragColor, minHeight: 14, minWidth: 3, width: 3 }}
        />
        {isMilestone && (
          <span className="text-[9px] font-mono uppercase tracking-wider px-1 py-0 rounded-sm border bg-primary/10 text-primary border-primary/20 font-semibold flex-shrink-0">
            M
          </span>
        )}
        {task.isSubtask && (
          <span className="text-[9px] font-mono uppercase tracking-wider px-1 py-0 rounded-sm border bg-primary/10 text-primary border-primary/20 font-semibold flex-shrink-0">
            Sub
          </span>
        )}
        <p className="text-xs font-semibold text-foreground flex-1 leading-4" style={{ wordBreak: "break-word" }}>
          {task.name}
        </p>
        {task.isCritical && !isMilestone && (
          <span className="text-[9px] font-mono uppercase tracking-wider px-1 rounded-sm border bg-destructive/10 text-destructive border-destructive/20 font-semibold flex-shrink-0">
            CP
          </span>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <span
          className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-[9px] font-mono uppercase tracking-wider font-semibold border"
          style={{ background: priMeta.bg, color: priMeta.color, borderColor: priMeta.color }}
        >
          {priMeta.value}
        </span>
        <div className="flex items-center gap-1.5">
          {(task.subtaskCount ?? 0) > 0 && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-sm text-[9px] font-mono border bg-primary/10 text-primary border-primary/20">
              <Layers size={8} />
              {task.subtaskCount}
            </span>
          )}
          <span
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ background: ragColor }}
            title={task.rag ?? "green"}
          />
        </div>
      </div>

      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        {task.assigneeName ? (
          <span className="flex items-center gap-1 truncate">
            <div className="w-4 h-4 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold font-mono flex-shrink-0 text-[8px]">
              {task.assigneeName.charAt(0).toUpperCase()}
            </div>
            <span className="truncate max-w-[70px]">{task.assigneeName}</span>
          </span>
        ) : (
          <span className="text-muted-foreground/50">—</span>
        )}
        <div className="flex items-center gap-1.5">
          {dueDate && (
            <span className="flex items-center gap-0.5 flex-shrink-0 font-mono">
              <Calendar size={9} />
              {new Date(dueDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
            </span>
          )}
          {!isMilestone && onLogTime && (
            <button
              onClick={e => { e.stopPropagation(); onLogTime(task.id, task.name); }}
              className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-sm text-[9px] font-mono uppercase tracking-wider text-primary hover:bg-primary/10 transition-colors"
              title="Log time"
            >
              <Clock size={9} /> Log
            </button>
          )}
        </div>
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
    <div className="flex flex-col flex-shrink-0 glass-surface rounded-xl" style={{ minWidth: 220, width: 220 }}>
      <div
        className="px-3 py-2.5 flex items-center gap-2 border-b-2"
        style={{ background: bg, borderBottomColor: color }}
      >
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
        <span className="text-[11px] font-mono uppercase tracking-wider font-semibold flex-1" style={{ color }}>
          {label}
        </span>
        <span
          className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded-sm border"
          style={{ background: bg, color, borderColor: color }}
        >
          {count}
        </span>
      </div>
      <div
        ref={setNodeRef}
        className={`flex-1 p-2 space-y-2 transition-colors border-t-0 border ${isOver ? "border-primary" : "border-border"}`}
        style={{ minHeight: 120 }}
      >
        {children}
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
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: dragId });

  // Move the card itself with the cursor (no DragOverlay — the canvas iframe
  // wraps this in a scaled transform, which offsets DragOverlay's portal
  // coordinates and makes the preview drift away from the cursor).
  const style: React.CSSProperties = {
    touchAction: "none",
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    zIndex: isDragging ? 9999 : undefined,
    position: isDragging ? "relative" : undefined,
    pointerEvents: isDragging ? "none" : undefined,
  };

  return (
    <div ref={setNodeRef} {...listeners} {...attributes} style={style}>
      <TaskCard
        task={task}
        isMilestone={isMilestone}
        isDragging={isDragging}
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
      if (t) setActiveDrag({ kind, id, status: t.status });
    } else {
      const m = milestones.find(x => x.id === id);
      if (m) setActiveDrag({ kind, id, status: m.status });
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
      updateTask.mutate(
        { id, data: { status: newStatus } },
        {
          onSuccess: () => onRefresh(),
          onError: () => { toast({ title: "Failed to update status", variant: "destructive" }); onRefresh(); },
        }
      );
    } else {
      const current = milestones.find(m => m.id === id);
      if (!current || current.status === newStatus) return;
      updateMilestone.mutate(
        { id, data: { status: newStatus } },
        {
          onSuccess: () => onRefresh(),
          onError: () => { toast({ title: "Failed to update milestone status", variant: "destructive" }); onRefresh(); },
        }
      );
    }
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex gap-4 overflow-x-auto pb-4" style={{ minHeight: 400 }}>
        {TASK_STATUSES.map(s => {
          const msItems = milestones.filter(m => m.status === s.value);
          const colTaskCount = allBoardTasks.filter(t => t.status === s.value).length;
          const totalCount = colTaskCount + msItems.length;

          return (
            <DroppableColumn
              key={s.value}
              status={s.value}
              label={s.label}
              color={s.color}
              bg={s.bg}
              count={totalCount}
            >
              {allBoardTasks.filter(t => t.status === s.value).map(task => (
                <DraggableCard
                  key={`t-${task.id}`}
                  dragId={encodeId("task", task.id)}
                  task={{ ...task, isSubtask: !!task.parentTaskId }}
                  onTaskClick={onTaskClick}
                  onLogTime={(id, name) => setTimelogModal({ taskId: id, taskName: name })}
                />
              ))}
              {msItems.map(ms => (
                <DraggableCard
                  key={`m-${ms.id}`}
                  dragId={encodeId("milestone", ms.id)}
                  task={{ ...ms, endDate: ms.dueDate, subtaskCount: tasks.filter(t => (t as { milestoneId?: number | null }).milestoneId === ms.id && !t.parentTaskId).length }}
                  isMilestone
                />
              ))}
            </DroppableColumn>
          );
        })}
      </div>

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
