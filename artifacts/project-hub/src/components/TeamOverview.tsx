import { Fragment, useState } from "react";
import { Link } from "wouter";
import { ChevronRight, ChevronDown, FolderKanban, CheckCircle2, AlertTriangle, BarChart3, ListTree, Crown } from "lucide-react";
import type { OverviewPerson, OverviewProject, OverviewItem } from "@/lib/teamOverviewData";

export type { OverviewPerson } from "@/lib/teamOverviewData";

const ITEM_TONE: Record<string, string> = {
  task: "bg-slate-100 text-slate-600",
  subtask: "bg-slate-50 text-slate-500",
};

function initialsOf(name: string) {
  return (name || "?").trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase() || "?";
}

// Per-item status → label + colour, so "overdue / in progress / done" reads at a
// glance in either view. Overdue wins over the raw status (a late in-progress
// task is shown as Overdue).
function statusMeta(it: OverviewItem): { label: string; cls: string } {
  if (it.status === "completed") return { label: "Completed", cls: "bg-emerald-50 text-emerald-700" };
  if (it.overdue) return { label: "Overdue", cls: "bg-red-50 text-red-600" };
  if (it.status === "in_progress") return { label: "In progress", cls: "bg-blue-50 text-blue-600" };
  if (it.status === "on_hold") return { label: "On hold", cls: "bg-amber-50 text-amber-700" };
  return { label: "Not started", cls: "bg-slate-100 text-slate-500" };
}

/** Completed / in-progress / overdue stacked bar for one project. */
function StatusBar({ g }: { g: OverviewProject }) {
  const t = Math.max(g.total, 1);
  const seg = (n: number, cls: string, title: string) =>
    n > 0 ? <div className={cls} style={{ width: `${(n / t) * 100}%` }} title={title} /> : null;
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
      {seg(g.done, "bg-emerald-500", `${g.done} completed`)}
      {seg(g.ongoing, "bg-blue-400", `${g.ongoing} in progress`)}
      {seg(g.overdue, "bg-red-500", `${g.overdue} overdue`)}
    </div>
  );
}

const todayIso = () => new Date().toISOString().slice(0, 10);
const daysLate = (due: string | null) => {
  if (!due) return 0;
  const d = Math.floor((Date.parse(todayIso()) - Date.parse(due.slice(0, 10))) / 86400000);
  return d > 0 ? d : 0;
};

/** The person's tasks / subtasks in one project — one clear line each: a
 *  colour dot, a type tag, the task name, a "Nd late" flag for overdue work,
 *  and the status pill. Rows are divided for scannability. */
export function ItemList({ g }: { g: OverviewProject }) {
  if (g.items.length === 0) {
    return <p className="px-4 py-2.5 text-[11.5px] text-slate-400 italic">{g.owns ? "They own this project — no tasks assigned to them here." : "No tasks assigned to them here."}</p>;
  }
  return (
    <ul className="divide-y divide-slate-300">
      {g.items.map((it) => {
        const done = it.status === "completed";
        const meta = statusMeta(it);
        const late = it.overdue && !done ? daysLate(it.dueDate) : 0;
        const dotColor = it.overdue && !done ? "bg-red-500" : done ? "bg-emerald-500" : it.status === "in_progress" ? "bg-blue-500" : "bg-slate-300";
        return (
          <li key={`${it.type}-${it.id}`} className="flex items-center gap-2 px-4 py-1.5 hover:bg-white/70 transition-colors">
            <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
            <span className={`text-[9px] font-bold uppercase tracking-wide px-1 py-0.5 rounded shrink-0 ${ITEM_TONE[it.type]}`}>{it.type}</span>
            <span className={`min-w-0 flex-1 truncate text-[12.5px] ${done ? "text-slate-400 line-through decoration-slate-300" : "text-slate-700 font-medium"}`} title={it.name}>{it.name}</span>
            <span className="shrink-0 flex items-center gap-6">
              {late > 0 && (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-600 tabular-nums">
                  <AlertTriangle className="w-3 h-3" /> {late}d late
                </span>
              )}
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${meta.cls}`}>{meta.label}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

const numCell = (n: number, cls: string) =>
  n > 0 ? <span className={`font-semibold ${cls}`}>{n}</span> : <span className="text-slate-300">0</span>;

/** All of a person's projects as one plain table (no separate boxes). Rows show
 *  the project name (a link into it) + the completed / in-progress / overdue /
 *  total counts, plus a status bar column in chart mode. Clicking a row (other
 *  than the name) expands it to the person's tasks in that project. Shared by
 *  the Team Overview and the standalone person-projects page. */
export function ProjectTable({ projects, mode }: { projects: OverviewProject[]; mode: "list" | "chart" }) {
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const toggle = (pid: number) =>
    setOpen((prev) => { const n = new Set(prev); n.has(pid) ? n.delete(pid) : n.add(pid); return n; });
  const colCount = mode === "chart" ? 6 : 5;

  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-50 text-slate-500 text-[11px] uppercase tracking-wide border-b border-slate-200">
            <th className="text-left font-semibold px-3 py-2">Project</th>
            {mode === "chart" && <th className="text-left font-semibold px-3 py-2 w-56">Progress</th>}
            <th className="text-center font-semibold px-2 py-2 w-24">Completed</th>
            <th className="text-center font-semibold px-2 py-2 w-28">In progress</th>
            <th className="text-center font-semibold px-2 py-2 w-20">Overdue</th>
            <th className="text-center font-semibold px-2 py-2 w-16">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {projects.map((g) => {
            const isOpen = open.has(g.projectId);
            const Chevron = isOpen ? ChevronDown : ChevronRight;
            return (
              <Fragment key={g.projectId}>
                <tr className="hover:bg-slate-50 cursor-pointer" onClick={() => toggle(g.projectId)}>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Chevron className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      {g.owns ? <Crown className="w-3.5 h-3.5 text-amber-500 shrink-0" /> : <FolderKanban className="w-3.5 h-3.5 text-violet-500 shrink-0" />}
                      <Link
                        href={`/projects/${g.projectId}`}
                        onClick={(e) => e.stopPropagation()}
                        className="min-w-0 truncate font-semibold text-slate-800 hover:text-primary hover:underline text-[12.5px]"
                        title={`Open ${g.project}`}
                      >
                        {g.project}
                      </Link>
                    </div>
                  </td>
                  {mode === "chart" && (
                    <td className="px-3 py-2"><StatusBar g={g} /></td>
                  )}
                  <td className="px-2 py-2 text-center tabular-nums">{numCell(g.done, "text-emerald-600")}</td>
                  <td className="px-2 py-2 text-center tabular-nums">{numCell(g.ongoing, "text-blue-600")}</td>
                  <td className="px-2 py-2 text-center tabular-nums">{numCell(g.overdue, "text-red-600")}</td>
                  <td className="px-2 py-2 text-center tabular-nums font-semibold text-slate-700">{g.total}</td>
                </tr>
                {isOpen && (
                  <tr className="bg-slate-50/60">
                    <td colSpan={colCount} className="p-0"><ItemList g={g} /></td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Team Overview — the flat, chart-able companion to the org-chart view of My
 * Team Actions. Lists every team member (the caller's manager + downward
 * subtree); each is an accordion row. Expanding one shows every project under
 * them. The List / Chart toggle only changes the project header (counts vs a
 * status bar + legend); in both, each project expands to its tasks and its name
 * links into the project.
 */
export function TeamOverview({ people }: { people: OverviewPerson[] }) {
  const [mode, setMode] = useState<"list" | "chart">("list");
  const [open, setOpen] = useState<Set<number>>(() => new Set());

  const toggle = (id: number) =>
    setOpen((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const ToggleBtn = ({ m, Icon, label }: { m: "list" | "chart"; Icon: typeof ListTree; label: string }) => (
    <button
      type="button"
      onClick={() => setMode(m)}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-semibold transition-colors ${mode === m ? "bg-white text-primary shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
    >
      <Icon className="w-3.5 h-3.5" /> {label}
    </button>
  );

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-3">
        <p className="text-[11px] font-heading font-bold uppercase tracking-wider text-muted-foreground/60">
          {people.length} {people.length === 1 ? "person" : "people"}
        </p>
        <div className="inline-flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5">
          <ToggleBtn m="list" Icon={ListTree} label="List" />
          <ToggleBtn m="chart" Icon={BarChart3} label="Chart" />
        </div>
      </div>

      {people.length === 0 ? (
        <p className="text-[12px] text-slate-400 text-center py-10">No one in your team is working on a project yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {people.map((p) => {
            const isOpen = open.has(p.id);
            return (
              <div key={p.id} className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggle(p.id)}
                  className="w-full flex items-center gap-3 px-3.5 py-2.5 hover:bg-slate-50 transition-colors text-left"
                >
                  {isOpen ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />}
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-slate-800 to-slate-600 text-white text-[11px] font-bold shrink-0 overflow-hidden">
                    {p.photoUrl ? <img src={p.photoUrl} alt={p.name} className="w-full h-full object-cover" /> : initialsOf(p.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold text-slate-800 truncate leading-tight">{p.name}</span>
                    <span className="block text-[11px] text-slate-400 truncate">
                      {p.department || "—"} · {p.projects.length} project{p.projects.length === 1 ? "" : "s"}
                    </span>
                  </span>
                  <span className="flex items-center gap-2 shrink-0 text-[11px]">
                    {p.overdue > 0 && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-50 text-red-600 font-semibold">
                        <AlertTriangle className="w-3 h-3" /> {p.overdue}
                      </span>
                    )}
                    <span className="text-slate-400 tabular-nums">{p.done}/{p.total} completed</span>
                  </span>
                </button>

                {isOpen && (
                  <div className="border-t border-slate-100 bg-slate-50/60 px-3.5 py-3">
                    {p.projects.length === 0 ? (
                      <div className="py-6 text-center">
                        <CheckCircle2 className="w-6 h-6 text-emerald-500 mx-auto mb-1.5" />
                        <p className="text-[12px] text-slate-400">No projects on their plate.</p>
                      </div>
                    ) : (
                      <ProjectTable projects={p.projects} mode={mode} />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
