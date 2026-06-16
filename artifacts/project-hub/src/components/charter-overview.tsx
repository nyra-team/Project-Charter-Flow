// Project Overview — a polished, document-style Project Charter for the selected
// project: a title block, an at-a-glance info table (filled from the charter AND
// the project's own fields), a lead summary, a delivery summary of milestones &
// tasks, and the conventional charter sections. Plain text (no boxes).
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { api } from "@/lib/extra-api";
import { formatCurrency } from "../lib/format";

type AnyRec = Record<string, unknown>;
type TaskLite = { name?: string; status: string; parentTaskId?: number | null; milestoneId?: number | null };
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
    ["Progress", `${tpct}%`],
    ["Sponsor", str(c, "projectSponsor") || "—"],
    ["Project Manager", pm || "—"],
    ownerName ? ["Project Owner", ownerName] : null,
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

  return (
    <article className="w-full max-w-none">
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

      {/* Narrative — conventional charter sections (only those with content) */}
      {hasCharter
        ? sec("Project Description", str(p, "description"))
        : (descQ.isLoading || descQ.data || str(p, "description")) && (
            <Section title="Project Description">
              {descQ.isLoading && !descQ.data
                ? <p className="text-[13px] text-muted-foreground italic">Generating a project description from the project's milestones and tasks…</p>
                : <Para>{descQ.data || str(p, "description")}</Para>}
            </Section>
          )}
      {sec("Executive Summary", str(c, "executiveSummary"))}
      {sec("Purpose / Business Justification", str(c, "description"))}
      {sec("Background", str(c, "background"))}
      {sec("Current State", str(c, "currentState"))}
      {sec("Business Drivers", str(c, "businessDrivers"))}
      {sec("In Scope", str(c, "scope"))}
      {sec("Out of Scope", str(c, "outOfScope"))}
      {sec("Scope Limitations", str(c, "scopeLimitations"))}
      {sec("Deliverables", str(c, "deliverables"))}
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
          ownerName ? ["Project Owner", ownerName] : null,
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
    </article>
  );
}
