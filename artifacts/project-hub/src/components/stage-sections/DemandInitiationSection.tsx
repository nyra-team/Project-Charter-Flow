import { useEffect, useState } from "react";
import { useListProjectStages, useUpdateProjectStage } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, AlertCircle } from "lucide-react";
import { AiButton } from "../ai-button";
import { AutoTextarea } from "../ui/auto-textarea";
import { useUserStore } from "../../lib/store";
import { formatDate } from "../../lib/format";

type DemandPayload = {
  problemStatement?: string;
  businessJustification?: string;
  strategicAlignment?: string;
  scopeSummary?: string;
  outOfScope?: string;
  expectedOutcomes?: string;
  successCriteria?: string;
  stakeholders?: string;
  alternatives?: string;
  assumptions?: string;
  constraints?: string;
  keyRisks?: string;
  sponsor?: string;
  capexEstimate?: number;
  opexEstimate?: number;
  recommendation?: string;
  // BRD additions
  businessRequirements?: string;
  asIsProcess?: string;
  toBeProcess?: string;
  businessRules?: string;
  impactAnalysis?: string;
  processOwners?: string;
  dataNeeds?: string;
  reportingNeeds?: string;
  complianceNeeds?: string;
  changeManagement?: string;
  savedAt?: string;
};

const STRATEGIC_TAGS = [
  "Cost Reduction",
  "Revenue Growth",
  "Compliance / Regulatory",
  "Productivity / Efficiency",
  "Customer Experience",
  "Risk Mitigation",
  "Digital Transformation",
  "Capacity Expansion",
];

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

const ta = "w-full text-xs border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary bg-card";

export function DemandInitiationSection({ projectId }: { projectId: number }) {
  const { data: stages = [] } = useListProjectStages(projectId);
  const updateStage = useUpdateProjectStage();
  const { toast } = useToast();
  const { role } = useUserStore();

  const stageRecord = (stages as Array<{ id: number; stage: string; notes?: string | null }>)
    .find((s) => s.stage === "initiation");

  const parsed: Record<string, unknown> = (() => {
    try { return JSON.parse(stageRecord?.notes ?? "{}"); } catch { return {}; }
  })();
  const saved: DemandPayload = (parsed.__demand_initiation as DemandPayload) ?? {};

  const [problem, setProblem] = useState(saved.problemStatement ?? "");
  const [bj, setBj] = useState(saved.businessJustification ?? "");
  const [strategic, setStrategic] = useState(saved.strategicAlignment ?? "");
  const [scope, setScope] = useState(saved.scopeSummary ?? "");
  const [outScope, setOutScope] = useState(saved.outOfScope ?? "");
  const [outcomes, setOutcomes] = useState(saved.expectedOutcomes ?? "");
  const [success, setSuccess] = useState(saved.successCriteria ?? "");
  const [stakeholders, setStakeholders] = useState(saved.stakeholders ?? "");
  const [alternatives, setAlternatives] = useState(saved.alternatives ?? "");
  const [assumptions, setAssumptions] = useState(saved.assumptions ?? "");
  const [constraints, setConstraints] = useState(saved.constraints ?? "");
  const [risks, setRisks] = useState(saved.keyRisks ?? "");
  const [sponsor, setSponsor] = useState(saved.sponsor ?? "");
  const [capex, setCapex] = useState<string>(saved.capexEstimate?.toString() ?? "");
  const [opex, setOpex] = useState<string>(saved.opexEstimate?.toString() ?? "");
  const [recommendation, setRecommendation] = useState(saved.recommendation ?? "");
  const [bizReqs, setBizReqs] = useState(saved.businessRequirements ?? "");
  const [asIs, setAsIs] = useState(saved.asIsProcess ?? "");
  const [toBe, setToBe] = useState(saved.toBeProcess ?? "");
  const [bizRules, setBizRules] = useState(saved.businessRules ?? "");
  const [impact, setImpact] = useState(saved.impactAnalysis ?? "");
  const [procOwners, setProcOwners] = useState(saved.processOwners ?? "");
  const [dataNeeds, setDataNeeds] = useState(saved.dataNeeds ?? "");
  const [reportNeeds, setReportNeeds] = useState(saved.reportingNeeds ?? "");
  const [complNeeds, setComplNeeds] = useState(saved.complianceNeeds ?? "");
  const [changeMgmt, setChangeMgmt] = useState(saved.changeManagement ?? "");

  useEffect(() => {
    setProblem(saved.problemStatement ?? "");
    setBj(saved.businessJustification ?? "");
    setStrategic(saved.strategicAlignment ?? "");
    setScope(saved.scopeSummary ?? "");
    setOutScope(saved.outOfScope ?? "");
    setOutcomes(saved.expectedOutcomes ?? "");
    setSuccess(saved.successCriteria ?? "");
    setStakeholders(saved.stakeholders ?? "");
    setAlternatives(saved.alternatives ?? "");
    setAssumptions(saved.assumptions ?? "");
    setConstraints(saved.constraints ?? "");
    setRisks(saved.keyRisks ?? "");
    setSponsor(saved.sponsor ?? "");
    setCapex(saved.capexEstimate?.toString() ?? "");
    setOpex(saved.opexEstimate?.toString() ?? "");
    setRecommendation(saved.recommendation ?? "");
    setBizReqs(saved.businessRequirements ?? "");
    setAsIs(saved.asIsProcess ?? "");
    setToBe(saved.toBeProcess ?? "");
    setBizRules(saved.businessRules ?? "");
    setImpact(saved.impactAnalysis ?? "");
    setProcOwners(saved.processOwners ?? "");
    setDataNeeds(saved.dataNeeds ?? "");
    setReportNeeds(saved.reportingNeeds ?? "");
    setComplNeeds(saved.complianceNeeds ?? "");
    setChangeMgmt(saved.changeManagement ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageRecord?.id]);

  const bjOk = bj.length >= 100;
  const problemOk = problem.length >= 50;
  // scopeOk dropped (2026-06-02) — URS owns scope, BC no longer gates on it.
  const outcomesOk = outcomes.length > 0;
  const budgetOk = (Number(capex) || 0) + (Number(opex) || 0) > 0;

  function toggleStrategic(tag: string) {
    const current = strategic.split(",").map(s => s.trim()).filter(Boolean);
    const next = current.includes(tag) ? current.filter(t => t !== tag) : [...current, tag];
    setStrategic(next.join(", "));
  }
  const strategicSelected = strategic.split(",").map(s => s.trim()).filter(Boolean);

  function save() {
    if (!stageRecord?.id) {
      toast({ title: "Initialise the Business Case stage first", variant: "destructive" });
      return;
    }
    if (!problemOk) {
      toast({ title: "Problem Statement is required (min 50 characters)", variant: "destructive" });
      return;
    }
    if (!bjOk) {
      toast({ title: "Business Justification is required (min 100 characters)", variant: "destructive" });
      return;
    }
    if (!outcomesOk) {
      toast({ title: "Expected Outcomes is required", variant: "destructive" });
      return;
    }
    const payload: DemandPayload = {
      problemStatement: problem,
      businessJustification: bj,
      strategicAlignment: strategic,
      scopeSummary: scope,
      outOfScope: outScope,
      expectedOutcomes: outcomes,
      successCriteria: success,
      stakeholders,
      alternatives,
      assumptions,
      constraints,
      keyRisks: risks,
      sponsor,
      capexEstimate: Number(capex) || 0,
      opexEstimate: Number(opex) || 0,
      recommendation,
      businessRequirements: bizReqs,
      asIsProcess: asIs,
      toBeProcess: toBe,
      businessRules: bizRules,
      impactAnalysis: impact,
      processOwners: procOwners,
      dataNeeds,
      reportingNeeds: reportNeeds,
      complianceNeeds: complNeeds,
      changeManagement: changeMgmt,
      savedAt: new Date().toISOString(),
    };
    updateStage.mutate(
      { id: stageRecord.id, data: { notes: JSON.stringify({ ...parsed, __demand_initiation: payload }) } },
      {
        onSuccess: () => toast({ title: "Business Case saved" }),
        onError: () => toast({ title: "Failed to save Business Case", variant: "destructive" }),
      },
    );
  }

  // ── Business Case approval (sub-gate) ───────────────────────────────────────
  // Distinct, audited go/no-go on the Business Case. Gates URS sign-off + stage
  // advance (Option D). Requires the BC blocking checklist to be complete first.
  const bcApproved = parsed.__bc_approved === true;
  const bcApprovedAt = parsed.__bc_approved_at as string | undefined;
  const bcApprover = parsed.__bc_approver as string | undefined;
  // BC checklist used to require scopeOk too — dropped (2026-06-02) when
  // the duplicate scope input moved to URS only. BC now gates on the
  // business-side artifacts; URS gates on its own dual-approval.
  const bcChecklistOk = bjOk && outcomesOk && budgetOk;
  const canApproveBC = role === "hod" || role === "executive_director" || role === "pmo";

  function approveBC() {
    if (!stageRecord?.id) { toast({ title: "Initialise the stage first", variant: "destructive" }); return; }
    const now = new Date().toISOString();
    updateStage.mutate(
      { id: stageRecord.id, data: { notes: JSON.stringify({ ...parsed, __bc_approved: true, __bc_approved_at: now, __bc_approver: role ?? "hod" }) } },
      { onSuccess: () => toast({ title: "Business Case approved" }), onError: () => toast({ title: "Failed to approve", variant: "destructive" }) },
    );
  }
  function revokeBC() {
    if (!stageRecord?.id) return;
    updateStage.mutate(
      { id: stageRecord.id, data: { notes: JSON.stringify({ ...parsed, __bc_approved: false, __bc_approved_at: null, __bc_approver: null }) } },
      { onError: () => toast({ title: "Failed to revoke", variant: "destructive" }) },
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
        <div>
          <p className="text-sm font-bold text-foreground">Business Case / BRD</p>
          <p className="text-[11px] text-primary">Combined Business Case + BRD — justification, business requirements, As-Is / To-Be, impact, recommendation</p>
        </div>
        <div className="flex items-center gap-2">
          <AiButton
            label="AI Draft"
            endpoint="/api/ai/demand/draft"
            payload={{ projectId, hint: bj || scope || outcomes || problem || undefined }}
            size="sm"
            variant="subtle"
            onResult={(d) => {
              const r = d as Partial<DemandPayload>;
              if (r.problemStatement) setProblem(r.problemStatement);
              if (r.businessJustification) setBj(r.businessJustification);
              if (r.scopeSummary) setScope(r.scopeSummary);
              if (r.expectedOutcomes) setOutcomes(r.expectedOutcomes);
              if (r.sponsor && !sponsor) setSponsor(r.sponsor);
              if (typeof r.capexEstimate === "number" && !capex) setCapex(String(Math.round(r.capexEstimate)));
              if (typeof r.opexEstimate === "number" && !opex) setOpex(String(Math.round(r.opexEstimate)));
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

      {/* Problem & Justification */}
      <div className="space-y-3">
        <Field label="Problem Statement" required hint="What business problem exists today?">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-muted-foreground">Describe the pain point or opportunity</span>
            <Counter ok={problemOk} count={problem.length} min={50} />
          </div>
          <AutoTextarea value={problem} onChange={(e) => setProblem(e.target.value)} minRows={3}
            placeholder="Current state, pain points, missed opportunities, regulatory gaps…" className={ta} />
        </Field>

        <Field label="Business Justification" required hint="Why this project, why now?">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-muted-foreground">Quantify the impact of not doing this</span>
            <Counter ok={bjOk} count={bj.length} min={100} />
          </div>
          <AutoTextarea value={bj} onChange={(e) => setBj(e.target.value)} minRows={3}
            placeholder="Cost of inaction, market urgency, compliance deadline, strategic imperative…" className={ta} />
        </Field>

        <Field label="Strategic Alignment" hint="Select all that apply">
          <div className="flex flex-wrap gap-1.5">
            {STRATEGIC_TAGS.map(tag => {
              const on = strategicSelected.includes(tag);
              return (
                <button key={tag} type="button" onClick={() => toggleStrategic(tag)}
                  className={`text-[10px] font-semibold px-2 py-1 rounded-full border ${on ? "bg-primary text-primary-foreground border-primary" : "bg-card text-foreground border-border hover:border-primary"}`}>
                  {tag}
                </button>
              );
            })}
          </div>
        </Field>
      </div>

      {/* Scope / Out-of-Scope removed (2026-06-02) — duplicated the URS
          "In Scope" + "Out of Scope" fields below. URS is the canonical
          source for scope boundaries. The legacy scopeSummary / outOfScope
          values still flow through the saved payload for back-compat. */}

      {/* Outcomes / Success / Stakeholders */}
      <div className="grid grid-cols-2 gap-3 pt-3 border-t border-border">
        <Field label="Expected Outcomes" required>
          <AutoTextarea value={outcomes} onChange={(e) => setOutcomes(e.target.value)} minRows={3}
            placeholder="Measurable business benefits — savings, capability, KPIs" className={ta} />
        </Field>
        <Field label="Success Criteria / KPIs" hint="How will we know it succeeded?">
          <AutoTextarea value={success} onChange={(e) => setSuccess(e.target.value)} minRows={3}
            placeholder="Quantifiable targets, acceptance thresholds" className={ta} />
        </Field>
      </div>

      <Field label="Key Stakeholders" hint="Name · Role · Interest (one per line)">
        <AutoTextarea value={stakeholders} onChange={(e) => setStakeholders(e.target.value)} minRows={3}
          placeholder="e.g. Mr. Sharma · Plant Head · Approves CapEx&#10;Ms. Iyer · QA Lead · Defines acceptance" className={ta} />
      </Field>

      {/* BRD Block — business process detail (the "what we do today vs
          tomorrow" half). Business Requirements list itself moved out
          (2026-06-02) — URS "Functional Requirements" is the canonical
          source. The legacy businessRequirements value still flows through
          the saved payload for back-compat. */}
      <p className="text-xs font-bold text-foreground pt-3 border-t border-border">BRD — Business Process Detail</p>

      <div className="grid grid-cols-2 gap-3">
        <Field label="As-Is Process" hint="How the business operates today">
          <AutoTextarea value={asIs} onChange={(e) => setAsIs(e.target.value)} minRows={4}
            placeholder="Step 1 → Step 2 → Step 3 — current pain points highlighted" className={ta} />
        </Field>
        <Field label="To-Be Process" hint="How the business will operate after the project">
          <AutoTextarea value={toBe} onChange={(e) => setToBe(e.target.value)} minRows={4}
            placeholder="Step 1 → Step 2 → Step 3 — improvements highlighted" className={ta} />
        </Field>
      </div>

      <Field label="Business Rules" hint="Policies, validations, calculations the business enforces">
        <AutoTextarea value={bizRules} onChange={(e) => setBizRules(e.target.value)} minRows={3}
          placeholder="• Batch can only be released after QA sign-off&#10;• Material code must follow X format&#10;• Discount cannot exceed Y% without HOD approval" className={ta} />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Process Owners" hint="Department · Owner · Function">
          <AutoTextarea value={procOwners} onChange={(e) => setProcOwners(e.target.value)} minRows={3}
            placeholder="QA · Ms. Iyer · Owns batch release process&#10;Production · Mr. Rao · Owns batch execution" className={ta} />
        </Field>
        <Field label="Impact Analysis" hint="Departments / systems / SOPs affected">
          <AutoTextarea value={impact} onChange={(e) => setImpact(e.target.value)} minRows={3}
            placeholder="Departments: QA, Production, Warehouse&#10;Systems: SAP, LIMS&#10;SOPs to revise: SOP-QA-014, SOP-PR-022" className={ta} />
        </Field>
      </div>

      {/* Data Needs / Reporting Needs removed (2026-06-02) — duplicated
          the URS "Data Requirements" + "Reporting Requirements" fields.
          URS is the canonical source. Legacy dataNeeds / reportingNeeds
          values still flow through the saved payload for back-compat. */}

      <Field label="Compliance Needs (Business View)" hint="Regulatory or policy obligations the business must meet">
        <AutoTextarea value={complNeeds} onChange={(e) => setComplNeeds(e.target.value)} minRows={2}
          placeholder="e.g. GxP, 21 CFR Part 11, EU Annex 11, internal SOP-IT-007 audit trail" className={ta} />
      </Field>

      <Field label="Change Management & Training" hint="Who needs training, communication plan, adoption">
        <AutoTextarea value={changeMgmt} onChange={(e) => setChangeMgmt(e.target.value)} minRows={2}
          placeholder="Roles to train, channels (classroom / e-learning), comms plan, adoption KPIs" className={ta} />
      </Field>

      {/* Alternatives & Risks */}
      <div className="grid grid-cols-2 gap-3 pt-3 border-t border-border">
        <Field label="Alternatives Considered" hint="Other options & why rejected">
          <AutoTextarea value={alternatives} onChange={(e) => setAlternatives(e.target.value)} minRows={3}
            placeholder="Option A: …, rejected because …&#10;Option B: …, rejected because …" className={ta} />
        </Field>
        <Field label="Key Risks" hint="Top 3-5 risks with mitigation">
          <AutoTextarea value={risks} onChange={(e) => setRisks(e.target.value)} minRows={3}
            placeholder="Risk: …  → Mitigation: …" className={ta} />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Assumptions">
          <AutoTextarea value={assumptions} onChange={(e) => setAssumptions(e.target.value)} minRows={2}
            placeholder="What must be true for this to work" className={ta} />
        </Field>
        <Field label="Constraints" hint="Time, budget, regulatory, technical">
          <AutoTextarea value={constraints} onChange={(e) => setConstraints(e.target.value)} minRows={2}
            placeholder="Hard limits that bound the project" className={ta} />
        </Field>
      </div>

      {/* Sponsor & Budget */}
      <div className="grid grid-cols-3 gap-2 pt-3 border-t border-border">
        <Field label="Sponsor">
          <input value={sponsor} onChange={(e) => setSponsor(e.target.value)} placeholder="Name / role"
            className={ta} />
        </Field>
        <Field label="CapEx (₹)">
          <input type="number" value={capex} onChange={(e) => setCapex(e.target.value)} placeholder="0"
            className={`${ta} font-mono`} />
        </Field>
        <Field label="OpEx (₹)">
          <input type="number" value={opex} onChange={(e) => setOpex(e.target.value)} placeholder="0"
            className={`${ta} font-mono`} />
        </Field>
      </div>

      <Field label="Recommendation" hint="Proceed / Defer / Reject — with rationale">
        <AutoTextarea value={recommendation} onChange={(e) => setRecommendation(e.target.value)} minRows={2}
          placeholder="Recommended path forward and rationale for governance forum" className={ta} />
      </Field>

      <div className="flex items-center justify-between pt-3 border-t border-border">
        <div className="text-[11px] text-foreground flex items-center gap-2 flex-wrap">
          <Counter ok={problemOk} count={problem.length} min={50} /> <span className="opacity-50">Problem</span>
          <span className="opacity-30">·</span>
          <Counter ok={bjOk} count={bj.length} min={100} /> <span className="opacity-50">Justification</span>
          <span className="opacity-30">·</span>
          {/* Scope chip removed (2026-06-02) — URS owns scope now. */}
          <span className={`text-[10px] font-mono inline-flex items-center gap-1 ${outcomesOk ? "text-success" : "text-warn"}`}>
            {outcomesOk ? <CheckCircle2 size={10} /> : <AlertCircle size={10} />} Outcomes
          </span>
          <span className="opacity-30">·</span>
          <span className={`text-[10px] font-mono inline-flex items-center gap-1 ${budgetOk ? "text-success" : "text-warn"}`}>
            {budgetOk ? <CheckCircle2 size={10} /> : <AlertCircle size={10} />} Budget
          </span>
        </div>
        <button
          onClick={save}
          disabled={updateStage.isPending || !problemOk || !bjOk || !outcomesOk}
          title={!problemOk ? "Problem statement needs at least 50 characters" : !bjOk ? "Business Justification needs at least 100 characters" : !outcomesOk ? "Expected Outcomes is required" : undefined}
          className="bg-primary hover:bg-primary/90 text-xs font-semibold text-primary-foreground px-3 py-1.5 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {updateStage.isPending ? "Saving…" : "Save Business Case"}
        </button>
      </div>

      {/* Business Case approval — the go/no-go gate before URS sign-off */}
      <div className={`rounded-xl p-3 border-2 ${bcApproved ? "border-success/40 bg-card" : "border-border bg-card"}`}>
        <p className="text-sm font-bold mb-1" style={{ color: bcApproved ? "hsl(var(--success) / 1)" : "hsl(var(--warn) / 1)" }}>
          Business Case Approval
        </p>
        {bcApproved ? (
          <>
            <p className="text-xs text-success">✓ Approved by <strong>{bcApprover}</strong>{bcApprovedAt ? ` · ${formatDate(bcApprovedAt)}` : ""}</p>
            <p className="text-[11px] text-muted-foreground mt-1">URS sign-off and stage advance are now unlocked.</p>
            {canApproveBC && <button onClick={revokeBC} className="mt-2 text-xs text-destructive underline">Revoke</button>}
          </>
        ) : (
          <>
            <p className="text-xs text-warn mb-2">Pending approval — this is the go/no-go before requirements (URS) are signed off.</p>
            {!bcChecklistOk ? (
              <p className="text-xs text-muted-foreground italic">Complete the Business Case (justification, outcomes, budget) before it can be approved.</p>
            ) : canApproveBC ? (
              <button onClick={approveBC} disabled={updateStage.isPending}
                className="bg-primary hover:bg-primary/90 text-xs font-semibold text-primary-foreground px-3 py-1.5 rounded-lg disabled:opacity-50">
                Approve Business Case
              </button>
            ) : (
              <p className="text-xs text-muted-foreground italic">Requires PMO / HOD / Exec Director role</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
