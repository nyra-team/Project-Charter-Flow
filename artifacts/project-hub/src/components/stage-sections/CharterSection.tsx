import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useGetProject, useGetCharter, useListProjectStages, useUpdateProjectStage } from "@workspace/api-client-react";
import { FileText, ExternalLink, CheckCircle2, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { AutoTextarea } from "../ui/auto-textarea";
import { AiButton } from "../ai-button";

type CharterPayload = {
  executiveSummary?: string;
  purpose?: string;
  businessObjectives?: string;
  scopeIn?: string;
  scopeOut?: string;
  deliverables?: string;
  milestones?: string;
  startDate?: string;
  endDate?: string;
  durationDays?: number;
  capex?: number;
  opex?: number;
  budgetBreakdown?: string;
  sponsor?: string;
  projectOwner?: string;
  projectManager?: string;
  teamRaci?: string;
  stakeholders?: string;
  assumptions?: string;
  constraints?: string;
  dependencies?: string;
  risks?: string;
  successCriteria?: string;
  toplineBenefits?: string;
  bottomLineBenefits?: string;
  complianceBenefits?: string;
  productivityBenefits?: string;
  strategicAlignment?: string;
  signOffs?: string;
  savedAt?: string;
};

const ta = "w-full text-xs border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary bg-card";

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[11px] font-semibold text-foreground block mb-1">
        {label}{required && <span className="text-destructive"> *</span>}
        {hint && <span className="ml-2 font-normal text-muted-foreground">{hint}</span>}
      </label>
      {children}
    </div>
  );
}

export function CharterSection({ projectId }: { projectId: number }) {
  const { data: project } = useGetProject(projectId);
  const { data: charter } = useGetCharter(project?.charterId ?? 0, {
    query: { enabled: !!project?.charterId },
  }) as { data?: { id: number; title?: string; status?: string; tentativeBudget?: number; function?: string } };
  const hasLinkedCharter = !!project?.charterId && !!charter;

  const { data: stages = [] } = useListProjectStages(projectId);
  const updateStage = useUpdateProjectStage();
  const { toast } = useToast();

  const stageRecord = (stages as Array<{ id: number; stage: string; notes?: string | null }>)
    .find((s) => s.stage === "investment_authorization");

  const parsed: Record<string, unknown> = (() => {
    try { return JSON.parse(stageRecord?.notes ?? "{}"); } catch { return {}; }
  })();
  const saved: CharterPayload = (parsed.__charter_form as CharterPayload) ?? {};

  const [execSummary, setExecSummary] = useState(saved.executiveSummary ?? "");
  const [purpose, setPurpose] = useState(saved.purpose ?? "");
  const [objectives, setObjectives] = useState(saved.businessObjectives ?? "");
  const [scopeIn, setScopeIn] = useState(saved.scopeIn ?? "");
  const [scopeOut, setScopeOut] = useState(saved.scopeOut ?? "");
  const [deliverables, setDeliverables] = useState(saved.deliverables ?? "");
  const [milestones, setMilestones] = useState(saved.milestones ?? "");
  const [startDate, setStartDate] = useState(saved.startDate ?? "");
  const [endDate, setEndDate] = useState(saved.endDate ?? "");
  const [duration, setDuration] = useState<string>(saved.durationDays?.toString() ?? "");
  const [capex, setCapex] = useState<string>(saved.capex?.toString() ?? "");
  const [opex, setOpex] = useState<string>(saved.opex?.toString() ?? "");
  const [budgetBreak, setBudgetBreak] = useState(saved.budgetBreakdown ?? "");
  const [sponsor, setSponsor] = useState(saved.sponsor ?? "");
  const [owner, setOwner] = useState(saved.projectOwner ?? "");
  const [manager, setManager] = useState(saved.projectManager ?? "");
  const [raci, setRaci] = useState(saved.teamRaci ?? "");
  const [stakeholders, setStakeholders] = useState(saved.stakeholders ?? "");
  const [assumptions, setAssumptions] = useState(saved.assumptions ?? "");
  const [constraints, setConstraints] = useState(saved.constraints ?? "");
  const [dependencies, setDependencies] = useState(saved.dependencies ?? "");
  const [risks, setRisks] = useState(saved.risks ?? "");
  const [successCriteria, setSuccessCriteria] = useState(saved.successCriteria ?? "");
  const [topline, setTopline] = useState(saved.toplineBenefits ?? "");
  const [bottomLine, setBottomLine] = useState(saved.bottomLineBenefits ?? "");
  const [compliance, setCompliance] = useState(saved.complianceBenefits ?? "");
  const [productivity, setProductivity] = useState(saved.productivityBenefits ?? "");
  const [strategic, setStrategic] = useState(saved.strategicAlignment ?? "");
  const [signOffs, setSignOffs] = useState(saved.signOffs ?? "");

  useEffect(() => {
    setExecSummary(saved.executiveSummary ?? "");
    setPurpose(saved.purpose ?? "");
    setObjectives(saved.businessObjectives ?? "");
    setScopeIn(saved.scopeIn ?? "");
    setScopeOut(saved.scopeOut ?? "");
    setDeliverables(saved.deliverables ?? "");
    setMilestones(saved.milestones ?? "");
    setStartDate(saved.startDate ?? "");
    setEndDate(saved.endDate ?? "");
    setDuration(saved.durationDays?.toString() ?? "");
    setCapex(saved.capex?.toString() ?? "");
    setOpex(saved.opex?.toString() ?? "");
    setBudgetBreak(saved.budgetBreakdown ?? "");
    setSponsor(saved.sponsor ?? "");
    setOwner(saved.projectOwner ?? "");
    setManager(saved.projectManager ?? "");
    setRaci(saved.teamRaci ?? "");
    setStakeholders(saved.stakeholders ?? "");
    setAssumptions(saved.assumptions ?? "");
    setConstraints(saved.constraints ?? "");
    setDependencies(saved.dependencies ?? "");
    setRisks(saved.risks ?? "");
    setSuccessCriteria(saved.successCriteria ?? "");
    setTopline(saved.toplineBenefits ?? "");
    setBottomLine(saved.bottomLineBenefits ?? "");
    setCompliance(saved.complianceBenefits ?? "");
    setProductivity(saved.productivityBenefits ?? "");
    setStrategic(saved.strategicAlignment ?? "");
    setSignOffs(saved.signOffs ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageRecord?.id]);

  const summaryOk = execSummary.length >= 80;
  const objectivesOk = objectives.length >= 50;
  const scopeOk = scopeIn.length >= 50;
  const deliverablesOk = deliverables.length >= 30;

  function save() {
    if (!stageRecord?.id) {
      toast({ title: "Initialise the Charter stage first", variant: "destructive" });
      return;
    }
    if (!summaryOk) {
      toast({ title: "Executive Summary is required (min 80 characters)", variant: "destructive" });
      return;
    }
    if (!objectivesOk) {
      toast({ title: "Business Objectives are required (min 50 characters)", variant: "destructive" });
      return;
    }
    const payload: CharterPayload = {
      executiveSummary: execSummary, purpose, businessObjectives: objectives,
      scopeIn, scopeOut, deliverables, milestones,
      startDate, endDate, durationDays: Number(duration) || undefined,
      capex: Number(capex) || 0, opex: Number(opex) || 0, budgetBreakdown: budgetBreak,
      sponsor, projectOwner: owner, projectManager: manager, teamRaci: raci, stakeholders,
      assumptions, constraints, dependencies, risks, successCriteria,
      toplineBenefits: topline, bottomLineBenefits: bottomLine,
      complianceBenefits: compliance, productivityBenefits: productivity,
      strategicAlignment: strategic, signOffs,
      savedAt: new Date().toISOString(),
    };
    updateStage.mutate(
      { id: stageRecord.id, data: { notes: JSON.stringify({ ...parsed, __charter_form: payload }) } },
      {
        onSuccess: () => toast({ title: "Charter saved" }),
        onError: () => toast({ title: "Failed to save Charter", variant: "destructive" }),
      },
    );
  }

  function Counter({ ok, count, min }: { ok: boolean; count: number; min: number }) {
    return (
      <span className={`text-[10px] font-mono inline-flex items-center gap-1 ${ok ? "text-success" : "text-warn"}`}>
        {ok ? <CheckCircle2 size={10} /> : <AlertCircle size={10} />} {count}/{min}
      </span>
    );
  }

  return (
    <div className="rounded-2xl p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText size={16} className="text-primary" />
          <div>
            <p className="text-sm font-bold text-foreground">Project Charter</p>
            <p className="text-[11px] text-primary">PMI-style charter — purpose, scope, deliverables, team, budget, risks, sign-off</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <AiButton
            label="AI Draft"
            endpoint="/api/ai/charter/draft"
            payload={{ projectId, hint: execSummary || objectives || purpose || undefined }}
            size="sm"
            variant="subtle"
            onResult={(d) => {
              const r = d as Partial<CharterPayload>;
              if (r.executiveSummary) setExecSummary(r.executiveSummary);
              if (r.purpose) setPurpose(r.purpose);
              if (r.businessObjectives) setObjectives(r.businessObjectives);
              if (r.scopeIn) setScopeIn(r.scopeIn);
              if (r.scopeOut) setScopeOut(r.scopeOut);
              if (r.deliverables) setDeliverables(r.deliverables);
              if (r.milestones) setMilestones(r.milestones);
              if (r.assumptions) setAssumptions(r.assumptions);
              if (r.risks) setRisks(r.risks);
              toast({ title: "AI draft applied — review and save" });
            }}
          />
          {saved.savedAt && (
            <span className="text-[10px] font-mono text-primary bg-primary/10 rounded-full px-2 py-0.5">
              Saved {new Date(saved.savedAt).toLocaleDateString()}
            </span>
          )}
        </div>
      </div>

      {/* Optional link to formal Charter entity (for governance workflow) */}
      {hasLinkedCharter && (
        <div className="rounded-xl p-2 border border-border bg-card flex items-center justify-between text-[11px]">
          <span className="text-foreground">
            Linked formal charter: <strong>{charter.title ?? `Charter #${charter.id}`}</strong> · <span className="capitalize">{charter.status ?? "draft"}</span>
          </span>
          <Link href={`/charters/${charter.id}`} className="inline-flex items-center gap-1 text-primary font-semibold hover:underline">
            Open for sign-off <ExternalLink size={11} />
          </Link>
        </div>
      )}

      <Field label="Executive Summary" required hint="2-3 sentence summary for governance forum">
        <div className="flex items-center justify-end mb-1"><Counter ok={summaryOk} count={execSummary.length} min={80} /></div>
        <AutoTextarea value={execSummary} onChange={(e) => setExecSummary(e.target.value)} minRows={3}
          placeholder="Brief, executive-friendly overview of what the project does and why" className={ta} />
      </Field>

      <Field label="Project Purpose" hint="The 'why' in one paragraph">
        <AutoTextarea value={purpose} onChange={(e) => setPurpose(e.target.value)} minRows={2}
          placeholder="The underlying purpose this charter authorises" className={ta} />
      </Field>

      <Field label="Business Objectives" required hint="Specific, measurable objectives">
        <div className="flex items-center justify-end mb-1"><Counter ok={objectivesOk} count={objectives.length} min={50} /></div>
        <AutoTextarea value={objectives} onChange={(e) => setObjectives(e.target.value)} minRows={3}
          placeholder="Obj 1: …&#10;Obj 2: …&#10;Obj 3: …" className={ta} />
      </Field>

      <div className="grid grid-cols-2 gap-3 pt-3 border-t border-border">
        <Field label="Scope — In" required>
          <div className="flex items-center justify-end mb-1"><Counter ok={scopeOk} count={scopeIn.length} min={50} /></div>
          <AutoTextarea value={scopeIn} onChange={(e) => setScopeIn(e.target.value)} minRows={3}
            placeholder="What the project will deliver" className={ta} />
        </Field>
        <Field label="Scope — Out">
          <AutoTextarea value={scopeOut} onChange={(e) => setScopeOut(e.target.value)} minRows={3}
            placeholder="Explicit exclusions" className={ta} />
        </Field>
      </div>

      <Field label="Key Deliverables" required hint="What will be handed over at the end">
        <div className="flex items-center justify-end mb-1"><Counter ok={deliverablesOk} count={deliverables.length} min={30} /></div>
        <AutoTextarea value={deliverables} onChange={(e) => setDeliverables(e.target.value)} minRows={3}
          placeholder="• Deliverable 1&#10;• Deliverable 2&#10;• Deliverable 3" className={ta} />
      </Field>

      <Field label="Key Milestones" hint="Milestone · Target date · Owner (one per line)">
        <AutoTextarea value={milestones} onChange={(e) => setMilestones(e.target.value)} minRows={3}
          placeholder="Kickoff · 15 Jun 2026 · PM&#10;Design freeze · 30 Jul 2026 · Lead Architect&#10;UAT complete · 30 Sep 2026 · QA" className={ta} />
      </Field>

      <div className="grid grid-cols-3 gap-2">
        <Field label="Start Date">
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={ta} />
        </Field>
        <Field label="End Date">
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={ta} />
        </Field>
        <Field label="Duration (days)">
          <input type="number" value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="0"
            className={`${ta} font-mono`} />
        </Field>
      </div>

      <p className="text-xs font-bold text-foreground pt-3 border-t border-border">Budget</p>
      <div className="grid grid-cols-2 gap-2">
        <Field label="CapEx (₹)">
          <input type="number" value={capex} onChange={(e) => setCapex(e.target.value)} placeholder="0"
            className={`${ta} font-mono`} />
        </Field>
        <Field label="OpEx (₹)">
          <input type="number" value={opex} onChange={(e) => setOpex(e.target.value)} placeholder="0"
            className={`${ta} font-mono`} />
        </Field>
      </div>
      <Field label="Budget Breakdown" hint="Category · Amount (₹) · Notes — one per line">
        <AutoTextarea value={budgetBreak} onChange={(e) => setBudgetBreak(e.target.value)} minRows={3}
          placeholder="Software licenses · 12,00,000 · 3-year subscription&#10;Hardware · 8,50,000 · servers + network&#10;Implementation · 25,00,000 · vendor SOW" className={ta} />
      </Field>

      <p className="text-xs font-bold text-foreground pt-3 border-t border-border">Team & Stakeholders</p>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Sponsor"><input value={sponsor} onChange={(e) => setSponsor(e.target.value)} placeholder="Name / role" className={ta} /></Field>
        <Field label="Project Owner"><input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Name / role" className={ta} /></Field>
        <Field label="Project Manager"><input value={manager} onChange={(e) => setManager(e.target.value)} placeholder="Name / role" className={ta} /></Field>
      </div>
      <Field label="Team RACI" hint="Name · Role · R/A/C/I (one per line)">
        <AutoTextarea value={raci} onChange={(e) => setRaci(e.target.value)} minRows={3}
          placeholder="Ms. Iyer · QA Lead · A&#10;Mr. Rao · Architect · R&#10;Plant Head · Sponsor · I" className={ta} />
      </Field>
      <Field label="Key Stakeholders">
        <AutoTextarea value={stakeholders} onChange={(e) => setStakeholders(e.target.value)} minRows={2}
          placeholder="Name · Role · Interest" className={ta} />
      </Field>

      <p className="text-xs font-bold text-foreground pt-3 border-t border-border">Risk & Governance</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Assumptions">
          <AutoTextarea value={assumptions} onChange={(e) => setAssumptions(e.target.value)} minRows={3}
            placeholder="What must be true for the plan to hold" className={ta} />
        </Field>
        <Field label="Constraints">
          <AutoTextarea value={constraints} onChange={(e) => setConstraints(e.target.value)} minRows={3}
            placeholder="Hard limits — time, budget, regulatory, technical" className={ta} />
        </Field>
        <Field label="Dependencies" hint="Other projects, vendors, approvals">
          <AutoTextarea value={dependencies} onChange={(e) => setDependencies(e.target.value)} minRows={3}
            placeholder="What this project depends on externally" className={ta} />
        </Field>
        <Field label="Top Risks" hint="Risk · Likelihood · Impact · Mitigation">
          <AutoTextarea value={risks} onChange={(e) => setRisks(e.target.value)} minRows={3}
            placeholder="Risk: …  → Likelihood: H/M/L · Impact: H/M/L · Mitigation: …" className={ta} />
        </Field>
      </div>

      <Field label="Success Criteria" hint="Quantifiable acceptance for the charter">
        <AutoTextarea value={successCriteria} onChange={(e) => setSuccessCriteria(e.target.value)} minRows={2}
          placeholder="The charter is considered successful when …" className={ta} />
      </Field>

      <p className="text-xs font-bold text-foreground pt-3 border-t border-border">Business Benefits</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Top-line Improvement" hint="Revenue / market / capacity">
          <AutoTextarea value={topline} onChange={(e) => setTopline(e.target.value)} minRows={2} className={ta}
            placeholder="Revenue uplift, new capability, market access" />
        </Field>
        <Field label="Bottom-line Optimization" hint="Cost / margin">
          <AutoTextarea value={bottomLine} onChange={(e) => setBottomLine(e.target.value)} minRows={2} className={ta}
            placeholder="Cost savings, margin improvement" />
        </Field>
        <Field label="Compliance Benefits">
          <AutoTextarea value={compliance} onChange={(e) => setCompliance(e.target.value)} minRows={2} className={ta}
            placeholder="Regulatory adherence, audit readiness, data integrity" />
        </Field>
        <Field label="Productivity Improvement">
          <AutoTextarea value={productivity} onChange={(e) => setProductivity(e.target.value)} minRows={2} className={ta}
            placeholder="Time saved, manual effort eliminated, throughput gain" />
        </Field>
      </div>

      <Field label="Strategic Alignment" hint="Which corporate goals / pillars this supports">
        <AutoTextarea value={strategic} onChange={(e) => setStrategic(e.target.value)} minRows={2}
          placeholder="e.g. Digital Transformation, Quality 4.0, Operational Excellence" className={ta} />
      </Field>

      <Field label="Sign-Off / Approvers" hint="Name · Role · Date (recorded once approved)">
        <AutoTextarea value={signOffs} onChange={(e) => setSignOffs(e.target.value)} minRows={2}
          placeholder="Sponsor — name, date&#10;Dept Head — name, date&#10;Finance — name, date" className={ta} />
      </Field>

      <div className="flex items-center justify-between pt-3 border-t border-border">
        <div className="text-[11px] text-foreground flex items-center gap-2 flex-wrap">
          <Counter ok={summaryOk} count={execSummary.length} min={80} /> <span className="opacity-50">Summary</span>
          <span className="opacity-30">·</span>
          <Counter ok={objectivesOk} count={objectives.length} min={50} /> <span className="opacity-50">Objectives</span>
          <span className="opacity-30">·</span>
          <Counter ok={scopeOk} count={scopeIn.length} min={50} /> <span className="opacity-50">Scope</span>
          <span className="opacity-30">·</span>
          <Counter ok={deliverablesOk} count={deliverables.length} min={30} /> <span className="opacity-50">Deliverables</span>
        </div>
        <button
          onClick={save}
          disabled={updateStage.isPending || !summaryOk || !objectivesOk}
          className="bg-primary hover:bg-primary/90 text-xs font-semibold text-primary-foreground px-3 py-1.5 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {updateStage.isPending ? "Saving…" : "Save Charter"}
        </button>
      </div>
    </div>
  );
}
