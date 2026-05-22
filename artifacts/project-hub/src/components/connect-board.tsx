import { useState } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
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
import { Calendar, Layers } from "lucide-react";

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
}: {
  task: { id: number; name: string; status: string; priority: string; rag?: string | null; assigneeName?: string | null; endDate?: string | null; dueDate?: string | null; isCritical?: boolean; subtaskCount?: number; isSubtask?: boolean };
  isDragging?: boolean;
  isMilestone?: boolean;
  onClick?: () => void;
}) {
  const priMeta = getPriorityMeta(task.priority);
  const ragColor = getRagColor(task.rag ?? "green");
  const dueDate = task.endDate ?? task.dueDate;

  return (
    <div
      className="rounded-xl p-3 space-y-2 select-none"
      style={{
        background: task.isSubtask ? "#FAFBFF" : "white",
        border: `1px solid ${isDragging ? "#6366F1" : isMilestone ? "#E0E7FF" : task.isSubtask ? "#C7D2FE" : "#E2E8F0"}`,
        boxShadow: isDragging ? "0 8px 25px rgba(99,102,241,0.2)" : "0 1px 3px rgba(0,0,0,0.06)",
        opacity: isDragging ? 0.85 : 1,
        transform: isDragging ? "rotate(2deg)" : undefined,
        cursor: isDragging ? "grabbing" : "grab",
        marginLeft: task.isSubtask ? 8 : 0,
      }}
      onClick={!isDragging ? onClick : undefined}
    >
      <div className="flex items-start gap-2">
        <span
          className="rounded-full flex-shrink-0 self-stretch"
          style={{ background: ragColor, minHeight: 14, minWidth: 3, width: 3 }}
        />
        {isMilestone && (
          <span
            className="text-xs px-1 py-0 rounded font-bold flex-shrink-0"
            style={{ background: "#EEF2FF", color: "#4F46E5", fontSize: 9 }}
          >
            M
          </span>
        )}
        {task.isSubtask && (
          <span
            className="text-xs px-1 py-0 rounded font-bold flex-shrink-0"
            style={{ background: "#EDE9FE", color: "#7C3AED", fontSize: 9 }}
          >
            Sub
          </span>
        )}
        <p className="text-xs font-semibold text-gray-800 flex-1 leading-4" style={{ wordBreak: "break-word" }}>
          {task.name}
        </p>
        {task.isCritical && !isMilestone && (
          <span
            className="text-xs px-1 rounded font-bold flex-shrink-0"
            style={{ background: "#FEE2E2", color: "#991B1B", fontSize: 9 }}
          >
            CP
          </span>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <span
          className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold"
          style={{ background: priMeta.bg, color: priMeta.color, fontSize: 9 }}
        >
          {priMeta.value}
        </span>
        <div className="flex items-center gap-1.5">
          {(task.subtaskCount ?? 0) > 0 && (
            <span
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs"
              style={{ background: "#EEF2FF", color: "#4F46E5", fontSize: 9 }}
            >
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

      <div className="flex items-center justify-between text-xs text-gray-400">
        {task.assigneeName ? (
          <span className="flex items-center gap-1 truncate">
            <div
              className="w-4 h-4 rounded-full bg-indigo-100 flex items-center justify-center font-bold flex-shrink-0"
              style={{ fontSize: 8, color: "#4F46E5" }}
            >
              {task.assigneeName.charAt(0).toUpperCase()}
            </div>
            <span className="truncate max-w-[70px]">{task.assigneeName}</span>
          </span>
        ) : (
          <span className="text-gray-300 text-xs">—</span>
        )}
        {dueDate && (
          <span className="flex items-center gap-0.5 flex-shrink-0">
            <Calendar size={9} />
            {new Date(dueDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
          </span>
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
    <div className="flex flex-col flex-shrink-0" style={{ minWidth: 220, width: 220 }}>
      <div
        className="rounded-t-xl px-3 py-2.5 flex items-center gap-2"
        style={{ background: bg, borderBottom: `2px solid ${color}` }}
      >
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
        <span className="text-xs font-bold flex-1" style={{ color }}>
          {label}
        </span>
        <span
          className="text-xs font-bold px-1.5 py-0.5 rounded-full"
          style={{ background: color + "20", color }}
        >
          {count}
        </span>
      </div>
      <div
        ref={setNodeRef}
        className="flex-1 p-2 space-y-2 rounded-b-xl transition-colors"
        style={{
          background: isOver ? bg : "#F8FAFC",
          minHeight: 120,
          border: `1px solid ${isOver ? color : "#E2E8F0"}`,
          borderTop: "none",
        }}
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
}: {
  dragId: string;
  task: Parameters<typeof TaskCard>[0]["task"];
  isMilestone?: boolean;
  onTaskClick?: (id: number) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: dragId });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{ opacity: isDragging ? 0.4 : 1, touchAction: "none" }}
    >
      <TaskCard
        task={task}
        isMilestone={isMilestone}
        onClick={!isMilestone ? () => onTaskClick?.(task.id) : undefined}
      />
    </div>
  );
}

export function ConnectBoard({ tasks, milestones, projectId: _projectId, onRefresh, onTaskClick }: ConnectBoardProps) {
  const { toast } = useToast();
  const updateTask = useUpdateTask();
  const updateMilestone = useUpdateMilestone();
  const [activeDrag, setActiveDrag] = useState<DragData | null>(null);

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
  // Keep topLevelTasks reference for drag overlay lookup
  const topLevelTasks = allBoardTasks.filter(t => !t.parentTaskId);

  function handleDragStart(event: DragStartEvent) {
    const decoded = decodeId(event.active.id);
    if (!decoded) return;
    const { kind, id } = decoded;
    if (kind === "task") {
      // Search all tasks (including subtasks) for the dragged card
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

      <DragOverlay>
        {activeDrag && (() => {
          if (activeDrag.kind === "task") {
            const t = topLevelTasks.find(x => x.id === activeDrag.id);
            if (!t) return null;
            return <TaskCard task={t} isDragging />;
          } else {
            const m = milestones.find(x => x.id === activeDrag.id);
            if (!m) return null;
            return <TaskCard task={{ ...m, endDate: m.dueDate }} isMilestone isDragging />;
          }
        })()}
      </DragOverlay>
    </DndContext>
  );
}
