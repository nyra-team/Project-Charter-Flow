import { useEffect, useState } from "react";
import { useListProjectStages, useUpdateProjectStage } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, AlertCircle } from "lucide-react";
import { AiButton } from "../ai-button";
import { AutoTextarea } from "../ui/auto-textarea";

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

  const stageRecord = (stages as Array<{ id: number; stage: string; notes?: string | null }>)
    .find((s) => s.stage === "project_case");

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageRecord?.id]);

  const bjOk = bj.length >= 100;
  const problemOk = problem.length >= 50;
  const scopeOk = scope.length >= 50;
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
          <p className="text-sm font-bold text-foreground">Business Case</p>
          <p className="text-[11px] text-primary">Industry-standard template — problem, justification, scope, outcomes, risks, recommendation</p>
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

      {/* Scope */}
      <div className="grid grid-cols-2 gap-3 pt-3 border-t border-border">
        <Field label="In Scope" required>
          <div className="flex items-center justify-end mb-1">
            <Counter ok={scopeOk} count={scope.length} min={50} />
          </div>
          <AutoTextarea value={scope} onChange={(e) => setScope(e.target.value)} minRows={3}
            placeholder="What this project will deliver" className={ta} />
        </Field>
        <Field label="Out of Scope" hint="Be explicit to prevent scope creep">
          <AutoTextarea value={outScope} onChange={(e) => setOutScope(e.target.value)} minRows={3}
            placeholder="What this project will NOT cover" className={ta} />
        </Field>
      </div>

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
          <Counter ok={scopeOk} count={scope.length} min={50} /> <span className="opacity-50">Scope</span>
          <span className="opacity-30">·</span>
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
    </div>
  );
}
