import { useMemo } from "react";

interface ProgressPanelProps {
  milestones: Array<{ status: string }>;
  tasks: Array<{ status: string; parentTaskId?: number | null }>;
  lastUpdated?: Date;
}

function ProgressRing({ pct, color, size = 80, stroke = 8, label, sublabel }: {
  pct: number; color: string; size?: number; stroke?: number; label: string; sublabel: string;
}) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - Math.min(pct, 100) / 100);

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#E2E8F0" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.6s ease" }}
        />
        <text
          x={size / 2} y={size / 2 + 5}
          textAnchor="middle"
          fontSize={size * 0.2}
          fontWeight={700}
          fill={color}
          style={{ transform: `rotate(90deg) translateX(0px)`, transformOrigin: `${size / 2}px ${size / 2}px` }}
        >
          {Math.round(pct)}%
        </text>
      </svg>
      <p className="text-xs font-semibold text-gray-700 text-center">{label}</p>
      <p className="text-xs text-gray-400 text-center">{sublabel}</p>
    </div>
  );
}

function fmtTimeAgo(d: Date): string {
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 5) return "just now";
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

export function ProgressTrackingPanel({ milestones, tasks, lastUpdated }: ProgressPanelProps) {
  const stats = useMemo(() => {
    const totalMilestones = milestones.length;
    const completedMilestones = milestones.filter(m => m.status === "completed").length;
    const milestonePct = totalMilestones > 0 ? (completedMilestones / totalMilestones) * 100 : 0;

    const topLevel = tasks.filter(t => !t.parentTaskId);
    const totalTasks = topLevel.length;
    const completedTasks = topLevel.filter(t => t.status === "completed").length;
    const taskPct = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

    const overallPct = (milestonePct * 0.4 + taskPct * 0.6);

    return {
      milestonePct,
      taskPct,
      overallPct,
      completedMilestones,
      totalMilestones,
      completedTasks,
      totalTasks,
    };
  }, [milestones, tasks]);

  return (
    <div className="rounded-2xl p-5" style={{ background: "white", border: "1px solid #E2E8F0" }}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-bold text-gray-800">Progress Tracking</h3>
          <p className="text-xs text-gray-400 mt-0.5">Milestone · Task · Overall (weighted 40/60)</p>
        </div>
        {lastUpdated && (
          <span className="text-xs text-gray-400">
            Updated {fmtTimeAgo(lastUpdated)}
          </span>
        )}
      </div>

      <div className="flex justify-around gap-4">
        <ProgressRing
          pct={stats.milestonePct}
          color="#6366F1"
          label="Milestone Completion"
          sublabel={`${stats.completedMilestones} / ${stats.totalMilestones}`}
        />
        <ProgressRing
          pct={stats.taskPct}
          color="#10B981"
          label="Task Completion Rate"
          sublabel={`${stats.completedTasks} / ${stats.totalTasks}`}
        />
        <ProgressRing
          pct={stats.overallPct}
          color="#F59E0B"
          size={96}
          stroke={10}
          label="Overall Progress"
          sublabel="Weighted 40/60"
        />
      </div>

      {/* Summary bars */}
      <div className="mt-5 space-y-2">
        {[
          { label: "Milestones", pct: stats.milestonePct, color: "#6366F1" },
          { label: "Tasks", pct: stats.taskPct, color: "#10B981" },
          { label: "Overall", pct: stats.overallPct, color: "#F59E0B" },
        ].map(item => (
          <div key={item.label} className="flex items-center gap-3">
            <span className="text-xs text-gray-500 w-20 text-right">{item.label}</span>
            <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${Math.min(item.pct, 100)}%`, background: item.color }}
              />
            </div>
            <span className="text-xs font-semibold text-gray-600 w-9 text-right">
              {Math.round(item.pct)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
