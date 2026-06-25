// Project Overview — a polished, document-style Project Charter for the selected
// project: a title block, an at-a-glance info table (filled from the charter AND
// the project's own fields), a lead summary, a delivery summary of milestones &
// tasks, and the conventional charter sections. Plain text (no boxes).
import { useLayoutEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { FileText, Info } from "lucide-react";
import { HoverHint } from "./ui-kit/HoverHint";
import { api } from "@/lib/extra-api";
import { formatCurrency } from "../lib/format";
import { getStatusMeta } from "../lib/task-constants";

type AnyRec = Record<string, unknown>;
type TaskLite = { id?: number; name?: string; status: string; parentTaskId?: number | null; milestoneId?: number | null };
type MsLite = { id: number; name: string; dueDate?: string | null; status: string };

const str = (c: AnyRec, k: string): string => { const v = c[k]; return typeof v === "string" ? v.trim() : ""; };
const numOrNull = (c: AnyRec, k: string): number | null => { const v = c[k]; return v != null && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : null; };
const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const cap = (s?: string) => (s ? s.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()) : "—");

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 first:mt-0">
      <h3 className="mb-2.5 text-[16px] font-bold tracking-tight text-foreground">{title}</h3>
      {children}
    </section>
  );
}
// Clamps to 4 lines; shows a Show more/less toggle only when the text overflows.
const Para = ({ children }: { children: React.ReactNode }) => {
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) setOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [children]); // ponytail: measures once per content change; clamped height is stable
  return (
    <>
      <p ref={ref} className={`text-[13px] leading-[1.65] text-foreground/80 whitespace-pre-wrap break-words ${expanded ? "" : "line-clamp-4"}`}>{children}</p>
      {(overflows || expanded) && (
        <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-1 text-[12px] font-semibold text-primary hover:underline">
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </>
  );
};
function FactList({ rows }: { rows: Array<[string, React.ReactNode] | null> }) {
  const items = rows.filter(Boolean) as Array<[string, React.ReactNode]>;
  return (
    <dl className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
      {items.map(([label, value], i) => (
        <div key={i} className="grid grid-cols-[118px_1fr] gap-3 px-3 py-[7px] transition-colors hover:bg-accent/40 sm:grid-cols-[158px_1fr]">
          <dt className="self-center text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
          <dd className="self-center break-words text-[12.5px] text-foreground/90">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
function StatTile({ label, value, color, valueClass }: { label: string; value: React.ReactNode; color?: string; valueClass?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2.5 shadow-sm">
      <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className={`mt-1 text-[17px] font-bold leading-none tabular-nums ${valueClass ?? "text-foreground"}`} style={color ? { color } : undefined}>{value}</p>
    </div>
  );
}

// ── Status visuals for the right-side live updates ──────────────────────────
function StatusDot({ status, size = 8 }: { status: string; size?: number }) {
  const sm = getStatusMeta(status);
  return <span className="rounded-full shrink-0 inline-block" style={{ width: size, height: size, background: sm.solid }} />;
}
function StatusPill({ status }: { status: string }) {
  const sm = getStatusMeta(status);
  return <span className="text-[9.5px] font-semibold px-1.5 py-0.5 rounded shrink-0 whitespace-nowrap" style={{ background: `${sm.solid}1a`, color: sm.solid }}>{sm.label}</span>;
}
// One task row + its nested subtasks, each with a status dot + pill. Shows the
// subtask completion count when the task has subtasks.
function TaskUpdate({ t, subs }: { t: TaskLite; subs: TaskLite[] }) {
  const subDone = subs.filter((s) => s.status === "completed").length;
  return (
    <li>
      <div className="flex items-start gap-2 text-[13px]">
        <span className="mt-[5px]"><StatusDot status={t.status} /></span>
        <span className="flex-1 min-w-0 text-foreground/90 break-words">{t.name}</span>
        {subs.length > 0 && <span className="text-[10px] text-muted-foreground tabular-nums shrink-0 mt-0.5">{subDone}/{subs.length}</span>}
        <StatusPill status={t.status} />
      </div>
      {subs.length > 0 && (
        <ul className="mt-1 ml-3.5 space-y-1 border-l border-border/60 pl-3">
          {subs.map((s, j) => (
            <li key={s.id ?? j} className="flex items-start gap-2 text-[12px]">
              <span className="mt-[5px]"><StatusDot status={s.status} size={6} /></span>
              <span className="flex-1 min-w-0 text-muted-foreground break-words">{s.name}</span>
              <StatusPill status={s.status} />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

// Task Updates list — caps at 5 with a "View all" toggle to expand the rest.
function TaskUpdatesSection({ top, subsByParent }: { top: TaskLite[]; subsByParent: Map<number, TaskLite[]> }) {
  const [showAll, setShowAll] = useState(false);
  const rows = showAll ? top : top.slice(0, 5);
  return (
    <Section title="Task Updates">
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card px-3 [&>li]:py-2">
        {rows.map((t) => (
          <TaskUpdate key={t.id} t={t} subs={(t.id != null ? subsByParent.get(t.id) : undefined) ?? []} />
        ))}
      </ul>
      {top.length > 5 && (
        <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-2 text-[12px] font-semibold text-primary hover:underline">
          {showAll ? "Show less" : `View all (${top.length})`}
        </button>
      )}
    </Section>
  );
}

export function CharterOverview({
  project, projectName, pmName, ownerName, tasks = [], milestones = [],
}: {
  project: AnyRec | null | undefined;
  projectName?: string;
  pmName?: string | null;
  ownerName?: string | null;
  tasks?: TaskLite[];
  milestones?: MsLite[];
}) {
  const p = (project ?? {}) as AnyRec;
  const charterId = Number(p.charterId ?? 0);
  const { data: charter, isLoading } = useQuery({
    queryKey: [`/api/charters/${charterId}`],
    queryFn: () => api.get<AnyRec>(`/api/charters/${charterId}`),
    enabled: charterId > 0,
  });
  const c = (charter ?? {}) as AnyRec;
  const hasCharter = charterId > 0 && !!charter;
  // The left half shows only the core charter fields; the rest of the document
  // is revealed by the "show the detailed view" button at the bottom.

  const title = str(c, "title") || projectName || "Project";
  const status = str(c, "status") || str(p, "status");
  const category = str(c, "category") || str(p, "category");
  const tags = Array.isArray(c.strategicAlignmentTags) ? (c.strategicAlignmentTags as string[]) : [];
  const pcRef = tags.find((t) => t.startsWith("PC_ID:"))?.slice(6) ?? null;
  const displayTags = tags.filter((t) => !t.startsWith("PC_ID:"));
  const members = Array.isArray(c.keyProjectMembers) ? (c.keyProjectMembers as Array<{ name?: string }>) : [];
  const kpis = Array.isArray(c.kpis) ? (c.kpis as Array<{ kpi?: string; baseline?: string; goal?: string }>) : [];
  const pm = pmName || str(c, "pmName");
  const cnum = (k: string) => numOrNull(c, k);
  const pnum = (k: string) => numOrNull(p, k);
  const money = (n: number | null) => (n != null ? formatCurrency(n) : null);

  // ── Delivery summary (milestones & tasks) ────────────────────────────────
  const top = tasks.filter((t) => t.parentTaskId == null);
  const tcnt = (s: string) => top.filter((t) => t.status === s).length;
  const total = top.length;
  const tdone = tcnt("completed"), tinprog = tcnt("in_progress"), tdelayed = tcnt("delayed"), tonhold = tcnt("on_hold");
  const tnot = Math.max(0, total - tdone - tinprog - tdelayed - tonhold);
  const now = Date.now();
  const msDone = milestones.filter((m) => m.status === "completed").length;
  const msOverdue = milestones.filter((m) => m.status !== "completed" && m.dueDate && new Date(m.dueDate).getTime() < now).length;
  const tasksByMs = new Map<number, TaskLite[]>();
  for (const t of top) { if (t.milestoneId == null) continue; const a = tasksByMs.get(t.milestoneId) ?? []; a.push(t); tasksByMs.set(t.milestoneId, a); }
  // Subtasks grouped under their parent task id — drives the right-side updates.
  const subsByParent = new Map<number, TaskLite[]>();
  for (const t of tasks) { if (t.parentTaskId != null) { const a = subsByParent.get(t.parentTaskId) ?? []; a.push(t); subsByParent.set(t.parentTaskId, a); } }
  // Subtask roll-up + the nearest upcoming milestone + the milestone carrying
  // the most open work — feed the right-side "insights" (no per-task listing).
  let subTotal = 0, subDone = 0;
  for (const arr of subsByParent.values()) { subTotal += arr.length; subDone += arr.filter((s) => s.status === "completed").length; }
  // Proper completion roll-up across tasks AND subtasks: a parent task is
  // represented by its subtasks (3/4 subtasks done → 75%, not 0); a leaf task
  // with no subtasks counts as one unit. This drives the headline % + verdict.
  let unitTotal = 0, unitDone = 0;
  for (const t of top) {
    const subs = (t.id != null ? subsByParent.get(t.id) : undefined) ?? [];
    if (subs.length) { unitTotal += subs.length; unitDone += subs.filter((s) => s.status === "completed").length; }
    else { unitTotal += 1; if (t.status === "completed") unitDone += 1; }
  }
  const rollupPct = unitTotal ? Math.round((unitDone / unitTotal) * 100) : (pnum("progress") ?? 0);
  const upcomingMs = milestones
    .filter((m) => m.status !== "completed" && m.dueDate)
    .map((m) => ({ m, t: new Date(m.dueDate!).getTime() }))
    .sort((a, b) => a.t - b.t);
  const nextMs = (upcomingMs.find((x) => x.t >= Date.now()) ?? upcomingMs[0])?.m ?? null;
  let bottleneck: { name: string; open: number } | null = null;
  for (const m of milestones) {
    const open = (tasksByMs.get(m.id) ?? []).filter((t) => t.status !== "completed").length;
    if (open > 0 && (!bottleneck || open > bottleneck.open)) bottleneck = { name: m.name, open };
  }

  // RAG health for the right-hand blinking indicator. Projects rarely carry an
  // explicit ragStatus, so we compute it from schedule (same rule as the
  // portfolio Delivery health) and let a manually-set ragStatus win if present.
  const startMs = (() => { const s = str(p, "startDate"); return s ? new Date(s.slice(0, 10)).getTime() : null; })();
  const endMs = (() => { const e = str(p, "endDate"); return e ? new Date(e.slice(0, 10)).getTime() : null; })();
  const computedRag = (() => {
    // Use the PROJECT's own status (not the charter-preferring `status` above,
    // which can be a charter workflow state like "approved" that masks a
    // delayed project).
    const st = (str(p, "status") || status).toLowerCase();
    if (st === "cancelled" || st === "postponed" || st === "paused" || st === "deferred") return "grey";
    if (st === "completed" || st === "closed") return "green";
    if (st === "delayed" || st === "stuck") return "red"; // explicitly flagged delayed
    if (st === "on_hold") return "amber";
    if (endMs != null && endMs < now) return "red"; // past planned end date, not done
    let expected = 0; // % of timeline elapsed
    if (startMs != null && endMs != null && endMs > startMs)
      expected = Math.min(100, Math.max(0, ((now - startMs) / (endMs - startMs)) * 100));
    if (expected - rollupPct > 15 || msOverdue > 0) return "amber"; // behind pace / overdue milestone
    return "green";
  })();
  // computedRag (schedule + status) is authoritative — it matches how the
  // portfolio marks projects delayed/off-track. A stored ragStatus may only
  // ESCALATE a green (a manual flag), never downgrade a detected red/amber back
  // to green (which was masking delayed projects with a stale "green" flag).
  const storedRag = str(p, "ragStatus").toLowerCase();
  const rag = computedRag === "green" && (storedRag === "amber" || storedRag === "red")
    ? storedRag
    : computedRag;
  const RAG_UI: Record<string, { c: string; label: string }> = {
    green:  { c: "#16a34a", label: "Green" },
    amber:  { c: "#f59e0b", label: "Amber" },
    yellow: { c: "#f59e0b", label: "Amber" },
    red:    { c: "#dc2626", label: "Red" },
    grey:   { c: "#94a3b8", label: "N/A" },
  };
  const ragUi = RAG_UI[rag] ?? RAG_UI.green;

  // Task-status tiles for the left-hand summary.
  const statTiles = [
    { label: "Total",       value: total,    color: "#475569" },
    { label: "Done",        value: tdone,    color: "#16A34A" },
    { label: "In Progress", value: tinprog,  color: "#F59E0B" },
    { label: "Delayed",     value: tdelayed, color: "#DC2626" },
    { label: "On Hold",     value: tonhold,  color: "#6366F1" },
    { label: "Not Started", value: tnot,     color: "#94A3B8" },
  ];

  // ── AI summary — reads the milestones + tasks and explains the project ────
  const projId = Number(p.id ?? 0);

  const aiInput = (() => {
    const lines: string[] = [`Project: ${str(c, "title") || projectName || "Project"}`];
    if (str(p, "status")) lines.push(`Status: ${cap(str(p, "status"))}`);
    if (str(p, "description")) lines.push(`Description: ${str(p, "description")}`);
    if (str(c, "category") || str(p, "category")) lines.push(`Category: ${str(c, "category") || str(p, "category")}`);
    if (str(p, "function")) lines.push(`Function: ${str(p, "function")}`);
    if (milestones.length) {
      lines.push("Milestones and their tasks:");
      for (const m of milestones) {
        const ns = ((tasksByMs.get(m.id) ?? []).map((t) => t.name?.trim()).filter(Boolean) as string[]).slice(0, 15);
        lines.push(`- ${m.name} [${cap(m.status)}]: ${ns.join("; ") || "no tasks"}`);
      }
      const orphan = (top.filter((t) => t.milestoneId == null).map((t) => t.name?.trim()).filter(Boolean) as string[]).slice(0, 15);
      if (orphan.length) lines.push(`- Other tasks: ${orphan.join("; ")}`);
    } else if (top.length) {
      lines.push(`Tasks: ${(top.map((t) => t.name?.trim()).filter(Boolean) as string[]).slice(0, 40).join("; ")}`);
    }
    return lines.join("\n");
  })();
  const summaryQ = useQuery({
    queryKey: ["project-ai-summary", projId, total, milestones.length],
    queryFn: async () => {
      const r = await api.post<{ rewritten?: string }>("/api/ai/improve-text", {
        text: aiInput,
        instruction: "The text lists a project's milestones and the tasks under each. Write a clear, plain-English overview (6–10 sentences) explaining what this project is about, its objectives and scope, and how the work is organised across the milestones. Synthesise — do not just restate the list. Do not invent specifics that aren't implied by the tasks.",
        maxWords: 230,
      });
      return (r.rewritten ?? "").trim();
    },
    enabled: projId > 0 && (top.length > 0 || milestones.length > 0),
    staleTime: 5 * 60_000,
    retry: false,
  });

  // AI project description — generated when no structured charter is linked, so
  // the Overview still carries a written description of the project.
  const descQ = useQuery({
    queryKey: ["project-ai-description", projId, total, milestones.length],
    queryFn: async () => {
      const r = await api.post<{ rewritten?: string }>("/api/ai/improve-text", {
        text: aiInput,
        instruction: "Write a concise Project Description (3–5 sentences) in plain English explaining what this project is, the problem or opportunity it addresses, and its intended outcome. Base it strictly on the project's fields, milestones and tasks — do not invent specifics. Write it as a flowing description, not a list.",
        maxWords: 140,
      });
      return (r.rewritten ?? "").trim();
    },
    enabled: charterId === 0 && projId > 0 && (top.length > 0 || milestones.length > 0 || !!str(p, "description")),
    staleTime: 5 * 60_000,
    retry: false,
  });

  // Lead summary — the best one-paragraph description to open with.
  const lead = str(c, "executiveSummary") || str(p, "description") || str(c, "description") || str(c, "background");

  const benefits = ([
    ["Top-line improvement", str(c, "toplineImprovement")],
    ["Bottom-line optimisation", str(c, "bottomLineOptimization")],
    ["Compliance benefits", str(c, "complianceBenefits")],
    ["Productivity improvement", str(c, "productivityImprovement")],
  ] as Array<[string, string]>).filter(([, v]) => v);

  const budgetRows = ([
    ["Tentative / Approved Budget", money(cnum("tentativeBudget"))],
    ["CapEx", money(pnum("capexBudget") ?? cnum("capexAmount"))],
    ["OpEx", money(pnum("opexBudget") ?? cnum("opexAmount"))],
    ["Final Negotiated Budget", money(cnum("finalNegotiatedBudget"))],
    ["Latest Estimate (LE)", money(cnum("leAmount"))],
    ["Potential Additional Budget", money(cnum("potentialAdditionalBudget"))],
    ["ROI / annum", money(cnum("roiPerAnnum"))],
    ["Payback", cnum("paybackMonths") != null ? `${cnum("paybackMonths")} months` : null],
    ["NFA Threshold", money(cnum("nfaThreshold"))],
  ] as Array<[string, string | null]>).filter(([, v]) => v) as Array<[string, React.ReactNode]>;

  if (charterId > 0 && isLoading) {
    return <div className="space-y-2 max-w-3xl">{[1, 2, 3, 4].map((i) => <div key={i} className="h-5 rounded bg-muted/40 animate-pulse" style={{ width: `${90 - i * 12}%` }} />)}</div>;
  }

  const sec = (heading: string, body: string) => (body ? <Section title={heading}><Para>{body}</Para></Section> : null);

  const infoRows: Array<[string, React.ReactNode] | null> = [
    ["Status", cap(status)],
    ["Progress", `${rollupPct}%`],
    ["Sponsor", str(c, "projectSponsor") || "—"],
    ["Project Manager", pm || "—"],
    ownerName ? ["Project Owner", <span className="inline-flex items-center rounded px-1.5 py-0.5 bg-primary/10 text-primary font-semibold">{ownerName}</span>] : null,
    ["Category", category || "—"],
    ["Department / Function", str(c, "department") || str(p, "function") || "—"],
    str(p, "stage") ? ["Lifecycle Stage", cap(str(p, "stage"))] : null,
    str(p, "strategicTheme") ? ["Strategic Theme", str(p, "strategicTheme")] : null,
    str(p, "siteRegion") ? ["Site / Region", str(p, "siteRegion")] : null,
    ["Priority", str(p, "priority") ? str(p, "priority").toUpperCase() : "—"],
    ["Timeline", `${fmtDate(str(c, "startDate") || str(p, "startDate"))}  to  ${fmtDate(str(c, "endDate") || str(p, "endDate"))}`],
    str(c, "internalOrderNumber") ? ["Internal Order No.", str(c, "internalOrderNumber")] : null,
    str(c, "projectApprovalDate") ? ["Approval Date", fmtDate(str(c, "projectApprovalDate"))] : null,
    str(c, "entity") ? ["Entity", str(c, "entity")] : null,
  ];

  // ── Core charter fields shown on the left (Project Charter Excel layout):
  //    Project Name (title) · Project Description · Scope · Business Case ·
  //    Project Deliverables. A "Not specified" placeholder keeps each present.
  const coreSec = (heading: string, body: React.ReactNode) => (
    <Section title={heading}>
      {body
        ? (typeof body === "string" ? <Para>{body}</Para> : body)
        : <p className="text-[13px] text-muted-foreground italic">Not specified.</p>}
    </Section>
  );
  const descriptionNode: React.ReactNode = hasCharter
    ? (str(p, "description") || str(c, "description") || str(c, "executiveSummary"))
    : (descQ.isLoading && !descQ.data
        ? <p className="text-[13px] text-muted-foreground italic">Generating a project description from the project's milestones and tasks…</p>
        : (descQ.data || str(p, "description")));
  const businessCase = str(c, "businessCase") || str(c, "businessOutcome") || str(c, "businessDrivers");
  const deliverablesText = str(c, "deliverables");
  // Project Deliverables (Key Milestones) — rendered as a table, mirroring the
  // Project Charter Excel: Key Milestone · Target Date · Status.
  const deliverablesNode: React.ReactNode = milestones.length > 0
    ? (
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-[13px] border-collapse">
          <thead>
            <tr className="bg-muted/40 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2 font-semibold border-b border-border">Key Milestone</th>
              <th className="px-3 py-2 font-semibold border-b border-border whitespace-nowrap">Target Date</th>
              <th className="px-3 py-2 font-semibold border-b border-border">Status</th>
            </tr>
          </thead>
          <tbody>
            {milestones.map((m) => (
              <tr key={m.id} className="border-b border-border/50 last:border-0">
                <td className="px-3 py-2 align-top text-foreground/90">{m.name}</td>
                <td className="px-3 py-2 align-top whitespace-nowrap tabular-nums text-muted-foreground">{m.dueDate ? fmtDate(m.dueDate) : "—"}</td>
                <td className="px-3 py-2 align-top"><StatusPill status={m.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
    : (deliverablesText || null);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8 items-start mt-4">
    {/* ── LEFT half — the complete project overview document ─────────────── */}
    <article className="w-full max-w-none min-w-0">
      {/* Title block */}
      <header>
        <div className="flex min-h-[26px] flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-primary">
            <span className="h-1 w-1 rounded-full bg-primary" />Charter Overview
          </span>
          {pcRef && <span className="font-mono text-[10.5px] font-semibold text-muted-foreground">{pcRef}</span>}
          {hasCharter && (
            <Link href={`/charters/${charterId}`} className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90">
              <FileText size={12} /> View Charter
            </Link>
          )}
        </div>
        <h2 className="mt-2.5 text-[25px] font-bold leading-[1.1] tracking-tight text-foreground">{title}</h2>
        <p className="mt-1 text-[12px] text-muted-foreground">{category || " "}</p>
        <div className="mt-3.5 h-px w-full bg-border" />
      </header>

      {/* ── Core overview — Project Name (above) · Description · Scope ·
          Business Case · Deliverables. Always visible. ───────────────────── */}
      {coreSec("Project Description", descriptionNode)}
      {coreSec("Scope", str(c, "scope"))}
      {coreSec("Business Case", businessCase)}
      {coreSec("Project Deliverables", deliverablesNode)}

      {/* ── Detailed view — the full charter ── */}
      {(<>
      {/* Lead summary */}
      {lead && <p className="mt-3 text-[12.5px] leading-6 text-foreground/80 line-clamp-2">{lead}</p>}

      {/* AI-generated summary — synthesised from the milestones & tasks */}
      {(summaryQ.isLoading || summaryQ.data) && (
        <Section title="Summary">
          {summaryQ.isLoading
            ? <p className="text-[13px] text-muted-foreground italic">Generating a summary from the project's milestones and tasks…</p>
            : <Para>{summaryQ.data}</Para>}
        </Section>
      )}

      {/* At a glance */}
      <Section title="Project Information"><FactList rows={infoRows} /></Section>

      {/* Milestones & tasks — a 5–10 line summary: one line per milestone with
          a few representative tasks (no counts). */}
      {(total > 0 || milestones.length > 0) && (
        <Section title="Milestones & Tasks">
          {milestones.length > 0 ? (
            <ul className="space-y-1.5">
              {milestones.slice(0, 6).map((m) => {
                const all = (tasksByMs.get(m.id) ?? []).map((t) => t.name?.trim()).filter(Boolean) as string[];
                const shown = all.slice(0, 3);
                return (
                  <li key={m.id} className="text-[13px] leading-6 text-foreground/90">
                    <span className="font-semibold text-foreground">{m.name}</span>
                    {shown.length ? <span className="text-foreground/75"> — {shown.join(", ")}{all.length > shown.length ? ", and more" : ""}</span> : <span className="text-muted-foreground"> — no tasks yet</span>}
                  </li>
                );
              })}
              {milestones.length > 6 && <li className="text-[12.5px] text-muted-foreground italic">…and {milestones.length - 6} more milestones</li>}
            </ul>
          ) : total > 0 ? (
            <ul className="space-y-1">
              {(top.map((t) => t.name?.trim()).filter(Boolean) as string[]).slice(0, 6).map((n, i) => <li key={i} className="text-[13px] leading-6 text-foreground/90">{n}</li>)}
              {top.length > 6 && <li className="text-[12.5px] text-muted-foreground italic">…and {top.length - 6} more tasks</li>}
            </ul>
          ) : (
            <Para>No tasks defined yet.</Para>
          )}
        </Section>
      )}

      {/* Narrative — conventional charter sections (only those with content;
          Description / Scope / Deliverables already shown in the core above) */}
      {sec("Executive Summary", str(c, "executiveSummary"))}
      {sec("Purpose / Business Justification", str(c, "description"))}
      {sec("Background", str(c, "background"))}
      {sec("Current State", str(c, "currentState"))}
      {sec("Business Drivers", str(c, "businessDrivers"))}
      {sec("Out of Scope", str(c, "outOfScope"))}
      {sec("Scope Limitations", str(c, "scopeLimitations"))}
      {sec("Business Outcome / Benefits", str(c, "businessOutcome"))}

      {benefits.length > 0 && (
        <Section title="Benefits">
          <ul className="space-y-1">{benefits.map(([l, v]) => <li key={l} className="text-[13px] text-foreground/90"><span className="font-semibold text-foreground">{l}:</span> {v}</li>)}</ul>
        </Section>
      )}

      {sec("Solution Comparison", str(c, "solutionComparison"))}
      {sec("Assumptions", str(c, "assumptions"))}
      {sec("Constraints", str(c, "constraints"))}
      {sec("Risks", str(c, "risks"))}

      {kpis.length > 0 && (
        <Section title="Success Criteria / KPIs">
          <ul className="space-y-1">{kpis.filter((k) => k.kpi?.trim()).map((k, i) => <li key={i} className="text-[13px] text-foreground/90"><span className="font-medium">{k.kpi}</span>{(k.baseline || k.goal) && <span className="text-muted-foreground"> — {k.baseline || "?"} → {k.goal || "?"}</span>}</li>)}</ul>
        </Section>
      )}

      {budgetRows.length > 0 && <Section title="Budget & Investment"><FactList rows={budgetRows} /></Section>}

      <Section title="Stakeholders">
        <FactList rows={[
          ["Sponsor", str(c, "projectSponsor") || "—"],
          ["Project Manager", pm || "—"],
          ownerName ? ["Project Owner", <span className="inline-flex items-center rounded px-1.5 py-0.5 bg-primary/10 text-primary font-semibold">{ownerName}</span>] : null,
          members.length > 0 ? ["Key Members", members.filter((m) => m.name?.trim()).map((m) => m.name).join(", ") || "—"] : null,
        ]} />
      </Section>

      {displayTags.length > 0 && (
        <Section title="Strategic Alignment">
          <div className="flex flex-wrap gap-1.5">{displayTags.map((t, i) => <span key={i} className="inline-flex items-center rounded-full bg-primary/10 text-primary text-[11px] font-medium px-2 py-0.5">{t}</span>)}</div>
        </Section>
      )}

      {!hasCharter && (
        <p className="mt-6 text-[12px] text-muted-foreground italic border-t border-dashed border-gray-300 pt-3">No structured Project Charter is linked yet — the details above are the project's own. Link or create a charter to populate the full business case, scope and benefits.</p>
      )}
      </>)}

    </article>

    {/* ── RIGHT half — the SAME fields as the overview, but the content is the
        project's current status. ─────────────────────────────────────────── */}
    <aside className="w-full max-w-none min-w-0 lg:border-l lg:border-border lg:pl-8">
      <header>
        <div className="flex min-h-[26px] flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-primary">
            <span className="h-1 w-1 rounded-full bg-primary" />Current Status
          </span>
          {/* Live RAG health pill */}
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: `${ragUi.c}1a`, color: ragUi.c }}>
            <span className="relative inline-flex h-2 w-2 items-center justify-center">
              <span className="absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping" style={{ background: ragUi.c }} />
              <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: ragUi.c }} />
            </span>
            {ragUi.label}
          </span>
        </div>
        <h2 className="mt-2.5 text-[25px] font-bold leading-[1.1] tracking-tight text-foreground">Current Status</h2>
        <p className="mt-1 text-[12px] text-muted-foreground">Live delivery snapshot</p>
        <div className="mt-3.5 h-px w-full bg-border" />
        {/* KPI stat strip — the at-a-glance scorecard */}
        <div className="mt-3.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatTile label="Progress" value={`${rollupPct}%`} valueClass="text-primary" />
          <StatTile label="Tasks" value={`${tdone}/${total}`} />
          <StatTile label="Milestones" value={`${msDone}/${milestones.length}`} />
          <StatTile label="Health" value={ragUi.label} color={ragUi.c} />
        </div>
        <div className="mt-3.5 h-px w-full bg-border" />
      </header>

      {/* Task & subtask insights — analysis, not a per-task list */}
      <Section title="Task & Subtask Insights">
        {/* Summary — overall progress + status counts + milestone roll-up */}
        <div className="mb-3 rounded-xl border border-border bg-card p-3">
          <div className="mb-2.5 flex items-center gap-2">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-[width] duration-700" style={{ width: `${rollupPct}%` }} />
            </div>
            <span className="text-[12px] font-bold tabular-nums text-foreground">{rollupPct}%</span>
            <HoverHint
              className="!max-w-[170px]"
              title="Progress formula"
              rows={[
                { label: "Done units", value: "÷ total units" },
                { label: "Leaf", value: "1 unit" },
                { label: "Has subtasks", value: "subtasks = units" },
                { label: "Here", value: `${unitDone}/${unitTotal} = ${rollupPct}%` },
              ]}
              footer="Counts below = top-level tasks only."
            >
              <button type="button" className="shrink-0 text-muted-foreground hover:text-foreground" aria-label="How progress is calculated">
                <Info size={12} />
              </button>
            </HoverHint>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-[10.5px]"><span className="text-muted-foreground">Total</span><b className="tabular-nums text-foreground">{total}</b></span>
            {([["Done", tdone, "completed"], ["In Progress", tinprog, "in_progress"], ["Delayed", tdelayed, "delayed"], ["On Hold", tonhold, "on_hold"], ["Not Started", tnot, "not_started"]] as const).map(([l, v, st]) => (
              <span key={l} className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-[10.5px]"><StatusDot status={st} size={7} /><span className="text-muted-foreground">{l}</span><b className="tabular-nums text-foreground">{v}</b></span>
            ))}
          </div>
          <div className="mt-2 border-t border-border/50 pt-2 text-[10.5px] text-muted-foreground">
            <b className="tabular-nums text-foreground">{milestones.length}</b> milestone{milestones.length === 1 ? "" : "s"}
            {" · "}<b className="tabular-nums" style={{ color: "#16A34A" }}>{msDone}</b> done
            {" · "}<b className="tabular-nums" style={{ color: msOverdue ? "#DC2626" : undefined }}>{msOverdue}</b> overdue
          </div>
        </div>

        {/* Derived insights — a written summary, not a per-task list */}
        {total === 0 && milestones.length === 0 ? (
          <Para>No tasks yet — a summary will appear as work is added.</Para>
        ) : (() => {
          const behind = msOverdue > 0 || tdelayed > 0;
          const verdict = rollupPct >= 100 ? "fully delivered" : behind ? "running behind schedule" : "on track";
          const verdictTone = rollupPct >= 100 || !behind ? "#16A34A" : "#DC2626";
          const s: string[] = [];
          s.push(`The project is ${rollupPct}% complete across all tasks and subtasks.`);
          s.push(`${tdone} of ${total} top-level task${total === 1 ? "" : "s"} ${tdone === 1 ? "is" : "are"} done${subTotal ? `, and ${subDone} of ${subTotal} subtask${subTotal === 1 ? "" : "s"}` : ""}.`);
          const wip: string[] = [];
          if (tinprog) wip.push(`${tinprog} in progress`);
          if (tnot) wip.push(`${tnot} not started`);
          if (wip.length) s.push(`${wip.join(" and ")}${wip.length === 1 ? " remains" : " remain"}.`);
          if (tdelayed || tonhold) s.push(`${tdelayed + tonhold} task${tdelayed + tonhold === 1 ? "" : "s"} need attention (${tdelayed} delayed, ${tonhold} on hold).`);
          if (milestones.length) s.push(`${msDone} of ${milestones.length} milestone${milestones.length === 1 ? "" : "s"} ${msDone === 1 ? "is" : "are"} complete${msOverdue ? `, with ${msOverdue} overdue` : ""}.`);
          if (bottleneck) s.push(`Most of the remaining work is in “${bottleneck.name}” (${bottleneck.open} open).`);
          if (nextMs) s.push(`The next milestone is “${nextMs.name}”${nextMs.dueDate ? `, due ${fmtDate(nextMs.dueDate)}` : ""}.`);
          return (
            <div className="rounded-xl border border-border bg-card p-3">
              <p className="mb-1.5 inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide" style={{ color: verdictTone }}>
                <span className="w-2 h-2 rounded-full" style={{ background: verdictTone }} />
                Overall {verdict}
              </p>
              <p className="text-[13px] leading-7 text-foreground/85">{s.join(" ")}</p>
            </div>
          );
        })()}
      </Section>

      <Section title="Project Information"><FactList rows={infoRows} /></Section>

      {budgetRows.length > 0 && <Section title="Budget & Investment"><FactList rows={budgetRows} /></Section>}

      <Section title="Stakeholders">
        <FactList rows={[
          ["Sponsor", str(c, "projectSponsor") || "—"],
          ["Project Manager", pm || "—"],
          ownerName ? ["Project Owner", <span className="inline-flex items-center rounded px-1.5 py-0.5 bg-primary/10 text-primary font-semibold">{ownerName}</span>] : null,
          members.length > 0 ? ["Key Members", members.filter((m) => m.name?.trim()).map((m) => m.name).join(", ") || "—"] : null,
        ]} />
      </Section>

      {milestones.length > 0 && (
        <Section title="Milestones">
          <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {milestones.slice(0, 5).map((m) => {
              const overdue = m.status !== "completed" && !!m.dueDate && new Date(m.dueDate).getTime() < now;
              return (
                <div key={m.id} className="flex items-center gap-2 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-foreground/90">{m.name}</span>
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{m.dueDate ? fmtDate(m.dueDate) : "—"}</span>
                  {overdue && <span className="shrink-0 text-[10px] font-semibold" style={{ color: "#DC2626" }}>OVERDUE</span>}
                  <StatusPill status={m.status} />
                </div>
              );
            })}
            {milestones.length > 5 && <div className="px-3 py-1.5 text-[11px] italic text-muted-foreground">…and {milestones.length - 5} more</div>}
          </div>
        </Section>
      )}

      {top.length > 0 && <TaskUpdatesSection top={top} subsByParent={subsByParent} />}

    </aside>
    </div>
  );
}
