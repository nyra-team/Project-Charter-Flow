// Project Overview — a polished, document-style Project Charter for the selected
// project: a title block, an at-a-glance info table (filled from the charter AND
// the project's own fields), a lead summary, a delivery summary of milestones &
// tasks, and the conventional charter sections. Plain text (no boxes).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Download, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
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
      <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary mb-2 flex items-center gap-2">
        <span className="inline-block w-4 h-px bg-primary/50" />{title}
      </h3>
      {children}
    </section>
  );
}
const Para = ({ children }: { children: React.ReactNode }) => (
  <p className="text-[13.5px] leading-7 text-foreground/85 whitespace-pre-wrap break-words">{children}</p>
);
function FactList({ rows }: { rows: Array<[string, React.ReactNode] | null> }) {
  const items = rows.filter(Boolean) as Array<[string, React.ReactNode]>;
  return (
    <dl className="grid grid-cols-[150px_1fr] sm:grid-cols-[180px_1fr] gap-x-5 gap-y-1.5">
      {items.map(([label, value], i) => (
        <div key={i} className="contents">
          <dt className="text-[12px] font-medium text-muted-foreground pt-0.5">{label}</dt>
          <dd className="text-[13px] text-foreground/90 break-words">{value}</dd>
        </div>
      ))}
    </dl>
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
  const [detailedOpen, setDetailedOpen] = useState(false);

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
  const tpct = total ? Math.round((tdone / total) * 100) : (pnum("progress") ?? 0);
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

  // RAG health for the right-hand blinking indicator.
  const rag = (str(p, "ragStatus") || "green").toLowerCase();
  const RAG_UI: Record<string, { c: string; label: string }> = {
    green:  { c: "#16a34a", label: "Green" },
    amber:  { c: "#f59e0b", label: "Amber" },
    yellow: { c: "#f59e0b", label: "Amber" },
    red:    { c: "#dc2626", label: "Red" },
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

  // ── e-NFAs for this project — kept here so they can be downloaded (.docx)
  //    from the overview. "Draft demo e-NFA" seeds one (with a vendor-evaluation
  //    checkpoint) linked to this project so the flow can be demoed end-to-end.
  const { toast } = useToast();
  const { data: nfas = [], refetch: refetchNfas } = useQuery({
    queryKey: ["project-nfas", projId],
    queryFn: () => api.get<Array<{ id: number; noteNo: string; subject: string; status: string }>>(`/api/nfas?projectId=${projId}`),
    enabled: projId > 0,
  });
  // Download via fetch (the global interceptor attaches the bearer the .docx
  // route requires) → blob → save. A plain <a href> would 401 (no bearer).
  async function downloadNfaDocx(id: number, name: string) {
    try {
      const res = await fetch(`/api/nfas/${id}/docx`);
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(name || "e-nfa").replace(/[^\w.-]+/g, "_")}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Download failed", variant: "destructive" });
    }
  }

  const [demoBusy, setDemoBusy] = useState(false);
  async function draftDemoNfa() {
    if (!projId) return;
    setDemoBusy(true);
    try {
      await api.post("/api/nfas", {
        projectId: projId,
        subject: `${projectName || str(p, "name") || "Project"} — Vendor Procurement Approval (Demo)`,
        department: str(p, "function"),
        functionDept: str(p, "function"),
        background: "Demo e-NFA generated for this project to seek approval for vendor procurement, ahead of floating an RFP.",
        requirements: "Procure the systems / services scoped in the project charter.",
        justification: "Required to deliver the project objectives within the approved timeline and budget.",
        vendorDetails: "Vendor evaluation checkpoint — RFP to be floated to vendors; the comparison matrix will be filled from the vendors' submitted data via the RFP evaluation.",
        modeOfProcurement: "RFP / competitive bidding",
        financialImplication: "As per the approved project budget.",
        recommendation: "Recommended for approval to proceed with the RFP for vendor selection.",
        signatories: [],
      });
      toast({ title: "Demo e-NFA drafted", description: "Download it below or open to edit." });
      void refetchNfas();
    } catch {
      toast({ title: "Could not draft demo e-NFA", variant: "destructive" });
    } finally {
      setDemoBusy(false);
    }
  }
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
    ["Progress", `${tpct}%`],
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
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8 items-start">
    {/* ── LEFT half — the complete project overview document ─────────────── */}
    <article className="w-full max-w-none min-w-0">
      {/* Title block */}
      <header>
        <p className="text-[10px] font-mono tracking-[0.22em] uppercase text-muted-foreground">Project Charter · Overview</p>
        <h2 className="mt-0.5 text-[26px] font-bold text-foreground tracking-tight leading-tight">{title}</h2>
        <div className="mt-1.5 flex items-center gap-2 flex-wrap text-[11px]">
          {pcRef && <span className="font-mono font-semibold text-primary">{pcRef}</span>}
          {category && <span className="text-muted-foreground">{category}</span>}
          {hasCharter && <Link href={`/charters/${charterId}`} className="text-primary hover:underline ml-auto">Open full charter →</Link>}
        </div>
        <div className="mt-3 h-px w-full bg-gradient-to-r from-primary/40 via-border to-transparent" />
      </header>

      {/* ── Core overview — Project Name (above) · Description · Scope ·
          Business Case · Deliverables. Always visible. ───────────────────── */}
      {coreSec("Project Description", descriptionNode)}
      {coreSec("Scope", str(c, "scope"))}
      {coreSec("Business Case", businessCase)}
      {coreSec("Project Deliverables", deliverablesNode)}

      {/* ── Detailed view — the full charter, revealed by the button below ── */}
      {detailedOpen && (<>
      {/* Lead summary */}
      {lead && <p className="mt-4 text-[15px] leading-7 text-foreground/90 font-medium">{lead}</p>}

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
              {milestones.slice(0, 10).map((m) => {
                const all = (tasksByMs.get(m.id) ?? []).map((t) => t.name?.trim()).filter(Boolean) as string[];
                const shown = all.slice(0, 4);
                return (
                  <li key={m.id} className="text-[13px] leading-6 text-foreground/90">
                    <span className="font-semibold text-foreground">{m.name}</span>
                    {shown.length ? <span className="text-foreground/75"> — {shown.join(", ")}{all.length > shown.length ? ", and more" : ""}</span> : <span className="text-muted-foreground"> — no tasks yet</span>}
                  </li>
                );
              })}
              {milestones.length > 10 && <li className="text-[12.5px] text-muted-foreground italic">…and more milestones</li>}
            </ul>
          ) : total > 0 ? (
            <ul className="space-y-1">
              {(top.map((t) => t.name?.trim()).filter(Boolean) as string[]).slice(0, 10).map((n, i) => <li key={i} className="text-[13px] leading-6 text-foreground/90">{n}</li>)}
              {top.length > 10 && <li className="text-[12.5px] text-muted-foreground italic">…and more tasks</li>}
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

      {/* Show / hide the full detailed charter */}
      <button
        type="button"
        onClick={() => setDetailedOpen((o) => !o)}
        className="mt-6 inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/5 px-4 py-2 text-[13px] font-semibold text-primary hover:bg-primary/10 hover:border-primary/60 transition-colors"
      >
        {detailedOpen ? "Hide the detailed view" : "Click to show the detailed view"}
      </button>
    </article>

    {/* ── RIGHT half — the SAME fields as the overview, but the content is the
        project's current status. ─────────────────────────────────────────── */}
    <aside className="w-full max-w-none min-w-0 lg:border-l lg:border-border lg:pl-8">
      <header>
        <p className="text-[10px] font-mono tracking-[0.22em] uppercase text-muted-foreground">Project Charter · Current Status</p>
        <h2 className="mt-0.5 text-[26px] font-bold text-foreground tracking-tight leading-tight">Current Status</h2>
        {/* Blinking RAG health — does not alter the fields below */}
        <div className="mt-1.5 flex items-center gap-1.5 text-[12px]">
          <span className="relative inline-flex h-2.5 w-2.5 items-center justify-center">
            <span className="absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping" style={{ background: ragUi.c }} />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: ragUi.c }} />
          </span>
          <span className="font-semibold" style={{ color: ragUi.c }}>{ragUi.label} RAG</span>
        </div>
        <div className="mt-3 h-px w-full bg-gradient-to-r from-primary/40 via-border to-transparent" />
      </header>

      {/* Task & subtask insights — analysis, not a per-task list */}
      <Section title="Task & Subtask Insights">
        {/* Summary — overall progress + status counts + milestone roll-up */}
        <div className="rounded-lg border border-border/60 bg-card/50 p-2.5 mb-3">
          <div className="flex items-center gap-2 mb-2">
            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${rollupPct}%` }} />
            </div>
            <span className="text-[12px] font-bold tabular-nums text-foreground">{rollupPct}%</span>
          </div>
          <div className="flex flex-wrap gap-x-2.5 gap-y-1 text-[10.5px]">
            <span className="inline-flex items-center gap-1"><span className="text-muted-foreground">Total</span><b className="text-foreground tabular-nums">{total}</b></span>
            {([["Done", tdone, "completed"], ["In Progress", tinprog, "in_progress"], ["Delayed", tdelayed, "delayed"], ["On Hold", tonhold, "on_hold"], ["Not Started", tnot, "not_started"]] as const).map(([l, v, st]) => (
              <span key={l} className="inline-flex items-center gap-1"><StatusDot status={st} size={7} /><span className="text-muted-foreground">{l}</span><b className="text-foreground tabular-nums">{v}</b></span>
            ))}
          </div>
          <div className="mt-1.5 pt-1.5 border-t border-border/50 text-[10.5px] text-muted-foreground">
            <b className="text-foreground tabular-nums">{milestones.length}</b> milestone{milestones.length === 1 ? "" : "s"}
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
            <div className="rounded-lg border border-border/60 bg-card/40 p-3">
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

      {/* Approval Notes (e-NFA) — this project's notes, downloadable as .docx */}
      <Section title="Approval Notes (e-NFA)">
        {nfas.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">No e-NFA for this project yet.</p>
        ) : (
          <div className="space-y-1.5">
            {nfas.map((n) => (
              <div key={n.id} className="flex items-center justify-between gap-2">
                <Link href={`/nfas/${n.id}`}>
                  <span className="inline-flex items-center gap-1.5 text-[12px] text-foreground hover:text-primary truncate cursor-pointer">
                    <FileText size={12} className="text-primary shrink-0" />
                    {n.subject || n.noteNo}
                  </span>
                </Link>
                <button onClick={() => downloadNfaDocx(n.id, n.subject || n.noteNo)} className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline" title="Download .docx">
                  <Download size={11} /> .docx
                </button>
              </div>
            ))}
          </div>
        )}
        <button onClick={draftDemoNfa} disabled={demoBusy || !projId} className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline disabled:opacity-50 disabled:cursor-not-allowed">
          {demoBusy ? "Drafting…" : "+ Draft demo e-NFA"}
        </button>
      </Section>
    </aside>
    </div>
  );
}
