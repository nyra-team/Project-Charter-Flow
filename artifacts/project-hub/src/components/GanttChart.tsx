import { useMemo } from "react";

export interface GanttProject {
  id: string;
  pid: number;
  name: string;
  start: string; // YYYY-MM-DD
  end: string;
  progress: number;
  status: string; // On Track | At Risk | Delayed
  phase: string;
  manager: string;
}
export interface GanttMilestone {
  pid: number;
  name: string;
  date: string;
  status: string;
  rag: string;
}
export interface GanttDep {
  from: number;
  to: number;
}

const LABEL_W = 240;
const ROW_H = 46;
const HEAD_H = 40;

const d = (s: string) => new Date(s + "T00:00:00");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const STATUS_BAR: Record<string, { track: string; fill: string; text: string }> = {
  "On Track": { track: "bg-emerald-100", fill: "bg-emerald-500", text: "text-emerald-700" },
  "At Risk": { track: "bg-amber-100", fill: "bg-amber-500", text: "text-amber-700" },
  Delayed: { track: "bg-rose-100", fill: "bg-rose-500", text: "text-rose-700" },
};
const ragColor = (rag: string) =>
  rag === "red" ? "#f43f5e" : rag === "amber" ? "#f59e0b" : rag === "green" ? "#10b981" : "#94a3b8";

export default function GanttChart({
  projects,
  milestones,
  dependencies,
  onProjectClick,
}: {
  projects: GanttProject[];
  milestones: GanttMilestone[];
  dependencies: GanttDep[];
  onProjectClick?: (id: string) => void;
}) {
  const model = useMemo(() => {
    if (!projects.length) return null;
    const starts = projects.map((p) => d(p.start).getTime());
    const ends = projects.map((p) => d(p.end).getTime());
    const minT = Math.min(...starts);
    const maxT = Math.max(...ends);
    // pad to month boundaries
    const rs = new Date(minT);
    const rangeStart = new Date(rs.getFullYear(), rs.getMonth(), 1);
    const re = new Date(maxT);
    const rangeEnd = new Date(re.getFullYear(), re.getMonth() + 1, 0);
    const span = rangeEnd.getTime() - rangeStart.getTime();
    const pct = (t: number) => Math.max(0, Math.min(100, ((t - rangeStart.getTime()) / span) * 100));

    const months: { label: string; left: number }[] = [];
    const cur = new Date(rangeStart);
    while (cur <= rangeEnd) {
      months.push({
        label: `${MONTHS[cur.getMonth()]} '${String(cur.getFullYear()).slice(2)}`,
        left: pct(cur.getTime()),
      });
      cur.setMonth(cur.getMonth() + 1);
    }
    const today = Date.now();
    const todayPct = today >= rangeStart.getTime() && today <= rangeEnd.getTime() ? pct(today) : null;

    const msByPid = new Map<number, GanttMilestone[]>();
    for (const m of milestones) {
      if (!msByPid.has(m.pid)) msByPid.set(m.pid, []);
      msByPid.get(m.pid)!.push(m);
    }
    const rowIndex = new Map<number, number>();
    projects.forEach((p, i) => rowIndex.set(p.pid, i));

    return { pct, months, todayPct, msByPid, rowIndex, monthCount: months.length };
  }, [projects, milestones]);

  if (!model) {
    return (
      <div className="px-7 py-16 text-center text-slate-400 text-sm">
        No scheduled projects with start &amp; end dates to chart yet.
      </div>
    );
  }

  const minWidth = LABEL_W + Math.max(model.monthCount * 84, 560);
  const timelineH = projects.length * ROW_H;

  return (
    <div className="px-3 pb-5">
      {/* legend */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 pt-1 pb-4 text-[11px] font-semibold text-slate-500">
        <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm bg-emerald-500" />On Track</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm bg-amber-500" />At Risk</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm bg-rose-500" />Delayed</span>
        <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rotate-45 border-2 border-slate-400" />Milestone</span>
        <span className="flex items-center gap-1.5"><span className="w-0.5 h-3.5 bg-rose-500" />Today</span>
        <span className="ml-auto text-slate-400 font-medium">Bar fill = % complete</span>
      </div>

      <div className="overflow-x-auto">
        <div className="relative" style={{ minWidth }}>
          {/* header: month columns */}
          <div className="flex border-b border-slate-200" style={{ height: HEAD_H }}>
            <div className="shrink-0 sticky left-0 z-20 bg-white" style={{ width: LABEL_W }} />
            <div className="relative flex-1">
              {model.months.map((m, i) => (
                <div
                  key={i}
                  className="absolute top-0 bottom-0 flex items-center text-[11px] font-bold text-slate-500 uppercase tracking-wide border-l border-slate-100 pl-2"
                  style={{ left: `${m.left}%` }}
                >
                  {m.label}
                </div>
              ))}
            </div>
          </div>

          {/* rows */}
          {projects.map((p, i) => {
            const c = STATUS_BAR[p.status] ?? STATUS_BAR["On Track"];
            const left = model.pct(d(p.start).getTime());
            const right = model.pct(d(p.end).getTime());
            const width = Math.max(right - left, 0.6);
            const ms = model.msByPid.get(p.pid) ?? [];
            return (
              <div
                key={p.id}
                onClick={onProjectClick ? () => onProjectClick(p.id) : undefined}
                title={onProjectClick ? "Open in PMO Project Hub" : undefined}
                className={`flex items-center border-b border-slate-50 transition-colors hover:bg-slate-50/40 ${onProjectClick ? "cursor-pointer" : ""}`}
                style={{ height: ROW_H }}
              >
                {/* label */}
                <div className="shrink-0 sticky left-0 z-20 bg-white transition-colors group-hover:bg-slate-50 pr-3 pl-4 flex flex-col justify-center border-r border-slate-100" style={{ width: LABEL_W, height: ROW_H }}>
                  <span className="text-[13px] font-semibold text-slate-800 truncate" title={p.name}>{p.name}</span>
                  <span className="text-[10px] text-slate-400 truncate">{p.id} · {p.manager}</span>
                </div>
                {/* track */}
                <div className="relative flex-1 h-full">
                  {/* bar */}
                  <div
                    className={`absolute top-1/2 -translate-y-1/2 h-5 rounded-md ${c.track} overflow-hidden ring-1 ring-inset ring-black/5`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                    title={`${p.name} — ${p.phase} · ${p.progress}% · ${p.start} → ${p.end}`}
                  >
                    <div className={`h-full ${c.fill} rounded-md`} style={{ width: `${p.progress}%` }} />
                    <span className={`absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] font-bold ${c.text}`}>{p.progress}%</span>
                  </div>
                  {/* milestones */}
                  {ms.map((m, j) => (
                    <div
                      key={j}
                      className="absolute top-1/2 w-2.5 h-2.5 rotate-45 -translate-x-1/2 -translate-y-1/2 border border-white shadow-sm"
                      style={{
                        left: `${model.pct(d(m.date).getTime())}%`,
                        backgroundColor: m.status === "completed" ? ragColor(m.rag) : "#ffffff",
                        borderColor: ragColor(m.rag),
                      }}
                      title={`◆ ${m.name} — ${m.date} (${m.status})`}
                    />
                  ))}
                </div>
              </div>
            );
          })}

          {/* overlay: month gridlines + today marker + dependency arrows (over timeline column only) */}
          <div className="absolute top-0 pointer-events-none" style={{ left: LABEL_W, right: 0, height: HEAD_H + timelineH }}>
            {model.months.map((m, i) => (
              <div key={i} className="absolute top-0 bottom-0 border-l border-slate-100/70" style={{ left: `${m.left}%` }} />
            ))}
            {model.todayPct != null && (
              <div className="absolute top-0 bottom-0" style={{ left: `${model.todayPct}%` }}>
                <div className="w-px h-full bg-rose-500/80" />
                <span className="absolute -top-0.5 -translate-x-1/2 left-0 text-[9px] font-bold text-white bg-rose-500 px-1.5 py-0.5 rounded-full whitespace-nowrap">Today</span>
              </div>
            )}
            <svg className="absolute inset-0 w-full h-full" style={{ overflow: "visible" }}>
              {dependencies.map((dep, i) => {
                const fi = model.rowIndex.get(dep.from);
                const ti = model.rowIndex.get(dep.to);
                if (fi == null || ti == null) return null;
                const from = projects[fi];
                const to = projects[ti];
                const x1 = model.pct(d(from.end).getTime());
                const y1 = HEAD_H + fi * ROW_H + ROW_H / 2;
                const x2 = model.pct(d(to.start).getTime());
                const y2 = HEAD_H + ti * ROW_H + ROW_H / 2;
                return (
                  <line
                    key={i}
                    x1={`${x1}%`} y1={y1} x2={`${x2}%`} y2={y2}
                    stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="3 3" markerEnd="url(#arrow)"
                  />
                );
              })}
              <defs>
                <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                  <path d="M0,0 L6,3 L0,6 Z" fill="#94a3b8" />
                </marker>
              </defs>
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
