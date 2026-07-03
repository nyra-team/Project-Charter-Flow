import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useListProjects } from "@workspace/api-client-react";
import { FlaskConical, Info } from "lucide-react";
import { DashboardCard } from "../components/dashboard/primitives";
import { MondayGantt, type GanttGroup, type GanttItem } from "../components/monday-gantt";
import { ExcelGroupTable, type ExcelCol } from "../components/excel-group-table";
import { CIP_DATA } from "../data/cip-data";

// CIP — Special Projects timelines. Read-only snapshot of the CIP tracker
// (formulation development → AMV → exhibit/stability → filing/approval) for
// the special pharma projects. Static data lives in data/cip-data.ts.

const { headers, sla, responsible, projects, notes, version } = CIP_DATA;

// Summary view: Metoprolol only, condensed columns. Index → header:
// 1 Project Name, 2 FD, 3 ADL, 6 QC (AMV full kit to QC), 11 Exhibit batch,
// 12 Stability, 15 Filing date, 16 Approval date.
const SUMMARY_COLS = [1, 2, 3, 6, 11, 12, 15, 16];
const SUMMARY_LABELS = ["Project", "FR&D", "AR&D", "QC", "Exhibit Batch", "Stability", "Filing Date", "Approval Date"];
// ExcelGroupTable columns (same table UI as the Projects table view). Key = the
// source column index so each cell reads row[Number(key)].
const SUMMARY_EXCEL_COLS: ExcelCol[] = SUMMARY_COLS.map((ci, i) => ({
  key: String(ci), header: SUMMARY_LABELS[i], width: i === 0 ? 300 : 120,
}));
// Full-table header indices clubbed into each summary column (for the per-header "i" tooltip).
const SUMMARY_GROUPS = [[1], [2], [3, 4], [5, 6, 7, 8, 9, 10], [11], [12, 13, 14], [15], [16]];
const clubbedInfo = (gi: number) => "Clubbed: " + SUMMARY_GROUPS[gi].map((idx) => (headers[idx] || "").replace(/\s+/g, " ").trim()).join(" · ");
const summaryRows = projects.filter((r) => /metoprolol/i.test(r[1]) && !/12\.5\s*mg/i.test(r[1]));

// RAG for summary cells: green = done, amber = in-progress/uncommitted, red = a target date already past.
// ponytail: text heuristic over the static snapshot — no per-cell status field exists to key off.
const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
function parseCellDate(s: string): Date | null {
  const m1 = s.match(/(\d{1,2})[-/]([A-Za-z]{3})[-/](\d{4})/); // 22-Jan-2027
  if (m1) return new Date(+m1[3], MONTHS[m1[2].toLowerCase()] ?? 0, +m1[1]);
  const m2 = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); // 30/06/2026
  if (m2) return new Date(+m2[3], +m2[2] - 1, +m2[1]);
  return null;
}
function ragClass(text: string, now: Date): string {
  const t = (text || "").toLowerCase();
  if (/complet|^\s*nil|\bdone\b/.test(t)) return "bg-green-100 text-green-900";
  if (/in-process|target|pending|tbd|under|not applicable|#/.test(t)) return "bg-amber-100 text-amber-900";
  const d = parseCellDate(text || "");
  if (d && d < now) return "bg-red-100 text-red-900";
  return "";
}
// Build PMO-style Gantt groups from the CIP timeline rows. Each CIP project is
// one bar (like the Projects-view Gantt); item id = the matching pmo_project id
// when found (so clicking navigates), else a negative synthetic id (no nav).
// Date columns per row: 5/6/10/11/12/13/15/16. ponytail: derived from the snapshot.
const fmt = (dt: Date) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
// Match a CIP row name to a real project id (prefix either way to tolerate the
// trailing "-"/suffix differences between the sheet and the project record).
function matchProjectId(name: string, list: Array<{ id: number; name: string }>): number {
  const c = norm(name);
  if (!c) return 0;
  for (const p of list) { const pn = norm(p.name); if (pn && (c.startsWith(pn) || pn.startsWith(c))) return p.id; }
  return 0;
}
// All milestone date columns (header index → short label) rendered as diamonds.
const MS_COLS: [number, string][] = [
  [5, "AMD completion"], [6, "AMV full kit to QC"], [7, "AMV exec start"],
  [8, "AMV exec end"], [9, "AMV review"], [10, "AMV approval"],
  [11, "Exhibit batch"], [12, "Stability in"], [13, "Stability pull-out"],
  [15, "Filing"], [16, "Approval"],
];
function buildGanttGroups(now: Date, list: Array<{ id: number; name: string }>): GanttGroup[] {
  const items: GanttItem[] = [];
  projects.forEach((row, i) => {
    if (!/metoprolol/i.test(row[1]) || /12\.5\s*mg/i.test(row[1])) return; // Metoprolol only
    const dates = [5, 6, 10, 11, 12, 13, 15, 16].map((c) => parseCellDate(row[c] || "")).filter(Boolean) as Date[];
    if (dates.length < 2) return;
    const start = new Date(Math.min(...dates.map((x) => x.getTime())));
    const end = new Date(Math.max(...dates.map((x) => x.getTime())));
    if (end <= start) return;
    const progress = Math.round(Math.max(0, Math.min(100, ((now.getTime() - start.getTime()) / (end.getTime() - start.getTime())) * 100)));
    const uncommitted = /#|pending|tbd|target|under/i.test(row.join(" "));
    const pid = matchProjectId(row[1], list);
    // All milestones as diamonds ON the bar — done (date passed) = solid green,
    // due (upcoming) = hollow.
    const markers = MS_COLS.map(([c, label]) => {
      const md = parseCellDate(row[c] || "");
      return md ? { date: fmt(md), done: md < now, label } : null;
    }).filter(Boolean) as { date: string; done: boolean; label: string }[];
    items.push({
      id: pid > 0 ? pid : -(i + 1),
      name: row[1], start: fmt(start), end: fmt(end), progress,
      color: uncommitted ? "#d97706" : "#16a34a", // amber = at risk, green = on track
      markers,
    });
  });
  return items.length ? [{ key: "cip", label: "CIP Special Projects", color: "#0ea5e9", items }] : [];
}
if (import.meta.env.DEV) {
  const REF = new Date(2026, 6, 1); // 2026-07-01
  console.assert(ragClass("Completed", REF).includes("green"), "rag: completed→green");
  console.assert(ragClass("#22/06/2026", REF).includes("amber"), "rag: # target→amber");
  console.assert(ragClass("22-Jan-2027", REF) === "", "rag: future date→none");
  console.assert(ragClass("09-Sep-2025", REF).includes("red"), "rag: past date→red");
}

export default function AdminCip() {
  const [view, setView] = useState<"full" | "summary" | "gantt">("full");
  const [, setLocation] = useLocation();
  const { data: allProjects = [] } = useListProjects();
  const projList = allProjects as Array<{ id: number; name: string }>;
  const ganttGroups = useMemo(() => buildGanttGroups(new Date(), projList), [projList]);
  // CIP row name → real project id (for the clickable project name in Summary).
  const openProject = (id: number) => { if (id > 0) setLocation(`/projects/${id}`); };
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-primary/10 border border-primary/20">
          <FlaskConical size={18} className="text-primary" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-foreground">CIP — Special Projects Timelines</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Formulation development, AMV, exhibit batches, stability and filing timelines for the CIP special projects. {version}.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1 rounded-lg bg-muted/60 p-1 w-fit">
        {(["full", "summary", "gantt"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-3 py-1 text-xs font-medium rounded-md capitalize transition-colors ${
              view === v ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {v}
          </button>
        ))}
      </div>

      {view === "gantt" ? (
        <DashboardCard title="Project Timeline (Gantt)" subtitle="CIP special-project schedules">
          {ganttGroups.length ? (
            <MondayGantt groups={ganttGroups} onOpen={openProject} labelWidth={340} labelHeader="Project" autoFitOnLoad flat />
          ) : (
            <div className="text-sm text-muted-foreground text-center py-10">No start / end dates to chart.</div>
          )}
        </DashboardCard>
      ) : view === "summary" ? (
        <ExcelGroupTable
          cols={SUMMARY_EXCEL_COLS}
          storageKey="ph:cip-summary:tbl"
          accent="#0ea5e9"
          renderHeaderLabel={(c) => (
            <span className="inline-flex items-center gap-1">
              {c.header}
              <span title={clubbedInfo(SUMMARY_COLS.indexOf(Number(c.key)))} className="cursor-help text-gray-400 pointer-events-auto">
                <Info size={10} />
              </span>
            </span>
          )}
        >
          {(orderedCols) => (
            <tbody>
              {summaryRows.map((row, ri) => {
                const pid = matchProjectId(row[1], projList);
                return (
                  <tr key={ri} className={ri % 2 ? "bg-white hover:bg-gray-50" : "bg-gray-50/40 hover:bg-gray-50"}>
                    {orderedCols.map((c) => {
                      const ci = Number(c.key);
                      return (
                        <td
                          key={c.key}
                          // AR&D (source col 3) is always shown green per requirement.
                          className={`border border-gray-200 px-2 py-0.5 align-top whitespace-pre-line break-words ${ci === 1 ? "font-medium" : ""} ${ci === 3 ? "bg-green-100 text-green-900" : ragClass(row[ci], new Date()) || "text-gray-800"}`}
                        >
                          {ci === 1 && pid > 0
                            ? <button type="button" onClick={() => openProject(pid)} className="text-left text-primary hover:underline underline-offset-2">{row[ci]}</button>
                            : row[ci]}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          )}
        </ExcelGroupTable>
      ) : (
      <DashboardCard title="Project Timelines" subtitle={`${projects.length} projects`}>
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-[11px] border-collapse">
            <thead>
              <tr className="bg-muted/60">
                {headers.map((h, i) => (
                  <th
                    key={i}
                    className="border border-border px-2 py-1.5 text-left font-semibold text-foreground align-top whitespace-pre-line min-w-[110px] first:min-w-[40px] [&:nth-child(2)]:min-w-[220px] last:min-w-[200px]"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="bg-amber-50/60">
                {sla.map((c, i) => (
                  <td key={i} className="border border-border px-2 py-1.5 align-top whitespace-pre-line text-muted-foreground italic">
                    {i === 0 ? <span className="font-semibold not-italic text-foreground">SLA</span> : c}
                  </td>
                ))}
              </tr>
              <tr className="bg-blue-50/50">
                {responsible.map((c, i) => (
                  <td key={i} className="border border-border px-2 py-1.5 align-top whitespace-pre-line text-muted-foreground">
                    {i === 0 ? <span className="font-semibold text-foreground">Primary responsible</span> : c}
                  </td>
                ))}
              </tr>
              {projects.map((row, ri) => (
                <tr key={ri} className={ri % 2 ? "bg-card" : "bg-muted/20"}>
                  {row.map((c, ci) => (
                    <td
                      key={ci}
                      className="border border-border px-2 py-1.5 align-top whitespace-pre-line text-foreground [&:nth-child(2)]:font-medium"
                    >
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DashboardCard>
      )}

      {view === "full" && notes.length > 0 && (
        <DashboardCard title="Notes & Legend">
          <ul className="space-y-1.5 text-xs text-muted-foreground list-disc pl-5">
            {notes.map((n, i) => (
              <li key={i} className="whitespace-pre-line">{n}</li>
            ))}
          </ul>
        </DashboardCard>
      )}
    </div>
  );
}
