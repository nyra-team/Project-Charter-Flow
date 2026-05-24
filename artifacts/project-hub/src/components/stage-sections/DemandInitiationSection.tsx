import { useEffect, useState } from "react";
import { useListProjectStages, useUpdateProjectStage } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, AlertCircle } from "lucide-react";
import { AiButton } from "../ai-button";

type DemandPayload = {
 businessJustification?: string;
 scopeSummary?: string;
 expectedOutcomes?: string;
 sponsor?: string;
 capexEstimate?: number;
 opexEstimate?: number;
 savedAt?: string;
};

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

 const [bj, setBj] = useState(saved.businessJustification ?? "");
 const [scope, setScope] = useState(saved.scopeSummary ?? "");
 const [outcomes, setOutcomes] = useState(saved.expectedOutcomes ?? "");
 const [sponsor, setSponsor] = useState(saved.sponsor ?? "");
 const [capex, setCapex] = useState<string>(saved.capexEstimate?.toString() ?? "");
 const [opex, setOpex] = useState<string>(saved.opexEstimate?.toString() ?? "");

 useEffect(() => {
 setBj(saved.businessJustification ?? "");
 setScope(saved.scopeSummary ?? "");
 setOutcomes(saved.expectedOutcomes ?? "");
 setSponsor(saved.sponsor ?? "");
 setCapex(saved.capexEstimate?.toString() ?? "");
 setOpex(saved.opexEstimate?.toString() ?? "");
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [stageRecord?.id]);

 const bjOk = bj.length >= 100;
 const scopeOk = scope.length >= 50;
 const outcomesOk = outcomes.length > 0;
 const budgetOk = (Number(capex) || 0) + (Number(opex) || 0) > 0;

 function save() {
 if (!stageRecord?.id) {
 toast({ title: "Initialise the Project Case stage first", variant: "destructive" });
 return;
 }
 const payload: DemandPayload = {
 businessJustification: bj, scopeSummary: scope, expectedOutcomes: outcomes,
 sponsor, capexEstimate: Number(capex) || 0, opexEstimate: Number(opex) || 0,
 savedAt: new Date().toISOString(),
 };
 updateStage.mutate(
 { id: stageRecord.id, data: { notes: JSON.stringify({ ...parsed, __demand_initiation: payload }) } },
 {
 onSuccess: () => toast({ title: "Project Case saved" }),
 onError: () => toast({ title: "Failed to save Project Case", variant: "destructive" }),
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
 <div className="rounded-2xl p-4 space-y-3">
 <div className="flex items-center justify-between">
 <div>
 <p className="text-sm font-bold text-foreground">Project Case Form</p>
 <p className="text-[11px] text-primary">FR-01 · captures business justification, scope, outcomes and preliminary budget</p>
 </div>
 <div className="flex items-center gap-2">
 <AiButton
 label="AI Draft"
 endpoint="/api/ai/demand/draft"
 payload={{ projectId, hint: bj || scope || outcomes || undefined }}
 size="sm"
 variant="subtle"
 onResult={(d) => {
 const r = d as { businessJustification?: string; scopeSummary?: string; expectedOutcomes?: string; sponsor?: string };
 if (r.businessJustification) setBj(r.businessJustification);
 if (r.scopeSummary) setScope(r.scopeSummary);
 if (r.expectedOutcomes) setOutcomes(r.expectedOutcomes);
 if (r.sponsor && !sponsor) setSponsor(r.sponsor);
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

 <div>
 <div className="flex items-center justify-between mb-1">
 <label className="text-[11px] font-semibold text-foreground">Business Justification</label>
 <Counter ok={bjOk} count={bj.length} min={100} />
 </div>
 <textarea
 value={bj} onChange={(e) => setBj(e.target.value)}
 rows={3} placeholder="Why this project, why now, what business problem does it solve?"
 className="w-full text-xs border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary bg-card"
 />
 </div>

 <div>
 <div className="flex items-center justify-between mb-1">
 <label className="text-[11px] font-semibold text-foreground">Scope Summary</label>
 <Counter ok={scopeOk} count={scope.length} min={50} />
 </div>
 <textarea
 value={scope} onChange={(e) => setScope(e.target.value)}
 rows={2} placeholder="What is in scope, what is explicitly out of scope?"
 className="w-full text-xs border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary bg-card"
 />
 </div>

 <div>
 <label className="text-[11px] font-semibold text-foreground block mb-1">Expected Outcomes</label>
 <textarea
 value={outcomes} onChange={(e) => setOutcomes(e.target.value)}
 rows={2} placeholder="Measurable outcomes — KPIs, savings, capability"
 className="w-full text-xs border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary bg-card"
 />
 </div>

 <div className="grid grid-cols-3 gap-2">
 <div>
 <label className="text-[11px] font-semibold text-foreground block mb-1">Sponsor</label>
 <input
 value={sponsor} onChange={(e) => setSponsor(e.target.value)}
 placeholder="Name / role"
 className="w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-card focus:outline-none focus:ring-1 focus:ring-primary"
 />
 </div>
 <div>
 <label className="text-[11px] font-semibold text-foreground block mb-1">CapEx (₹)</label>
 <input
 type="number" value={capex} onChange={(e) => setCapex(e.target.value)}
 placeholder="0"
 className="w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-card focus:outline-none focus:ring-1 focus:ring-primary font-mono"
 />
 </div>
 <div>
 <label className="text-[11px] font-semibold text-foreground block mb-1">OpEx (₹)</label>
 <input
 type="number" value={opex} onChange={(e) => setOpex(e.target.value)}
 placeholder="0"
 className="w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-card focus:outline-none focus:ring-1 focus:ring-primary font-mono"
 />
 </div>
 </div>

 <div className="flex items-center justify-between pt-2 border-t border-border">
 <div className="text-[11px] text-foreground space-x-2">
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
 disabled={updateStage.isPending}
 className="bg-primary hover:bg-primary/90 text-xs font-semibold text-primary-foreground px-3 py-1.5 rounded-lg disabled:opacity-40"
 >
 {updateStage.isPending ? "Saving…" : "Save Project Case"}
 </button>
 </div>
 </div>
 );
}
