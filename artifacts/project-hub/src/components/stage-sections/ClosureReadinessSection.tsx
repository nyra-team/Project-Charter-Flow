import { useState, useEffect } from "react";
import { useListProjectStages, useUpdateProjectStage } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, Circle } from "lucide-react";

interface HandoverItem {
 id: string;
 label: string;
}

const HANDOVER_ITEMS: HandoverItem[] = [
 { id: "training_complete", label: "End-user training delivered" },
 { id: "runbooks_handed", label: "Runbooks & admin guides handed over" },
 { id: "support_transitioned", label: "Support transitioned to BAU team" },
 { id: "data_migrated", label: "Data migration signed off" },
 { id: "vendor_warranties", label: "Vendor warranty documents filed" },
];

export function ClosureReadinessSection({ projectId }: { projectId: number }) {
 const { data: stages = [] } = useListProjectStages(projectId);
 const updateStage = useUpdateProjectStage();
 const { toast } = useToast();

 const readinessRecord = (
 stages as Array<{ id: number; stage: string; notes?: string | null }>
 ).find((s) => s.stage === "closure_readiness");

 const parsedNotes: Record<string, unknown> = (() => {
 try { return JSON.parse(readinessRecord?.notes ?? "{}"); }
 catch { return {}; }
 })();

 const savedHandover = (parsedNotes.__handover_items as Record<string, boolean> | undefined) ?? {};
 const savedCsatScore = (parsedNotes.__csat_score as number | undefined) ?? 0;
 const savedCsatComplete = (parsedNotes.__csat_survey_complete as boolean | undefined) ?? false;
 const savedCsatResponses = (parsedNotes.__csat_response_count as number | undefined) ?? 0;
 const savedAt = parsedNotes.__closure_readiness_saved_at as string | undefined;

 const [handover, setHandover] = useState<Record<string, boolean>>(savedHandover);
 const [csatScore, setCsatScore] = useState(savedCsatScore);
 const [csatComplete, setCsatComplete] = useState(savedCsatComplete);
 const [csatResponses, setCsatResponses] = useState(savedCsatResponses);

 useEffect(() => {
 if (readinessRecord?.notes) {
 try {
 const p = JSON.parse(readinessRecord.notes) as Record<string, unknown>;
 if (p.__handover_items) setHandover(p.__handover_items as Record<string, boolean>);
 if (p.__csat_score !== undefined) setCsatScore(p.__csat_score as number);
 if (p.__csat_survey_complete !== undefined) setCsatComplete(p.__csat_survey_complete as boolean);
 if (p.__csat_response_count !== undefined) setCsatResponses(p.__csat_response_count as number);
 } catch {}
 }
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [readinessRecord?.id]);

 const completedCount = HANDOVER_ITEMS.filter((i) => handover[i.id]).length;
 const allHandoverDone = completedCount === HANDOVER_ITEMS.length;
 const readyToClose = allHandoverDone && csatComplete && csatScore >= 3;

 function toggleHandover(id: string) {
 setHandover((prev) => ({ ...prev, [id]: !prev[id] }));
 }

 function save() {
 if (!readinessRecord?.id) {
 toast({ title: "Initialise the Closure Readiness stage first", variant: "destructive" });
 return;
 }
 updateStage.mutate(
 {
 id: readinessRecord.id,
 data: {
 notes: JSON.stringify({
 ...parsedNotes,
 __handover_items: handover,
 __csat_score: csatScore,
 __csat_survey_complete: csatComplete,
 __csat_response_count: csatResponses,
 __closure_readiness_saved_at: new Date().toISOString(),
 }),
 },
 },
 {
 onSuccess: () => toast({ title: "Closure readiness status saved" }),
 onError: () => toast({ title: "Failed to save closure readiness", variant: "destructive" }),
 },
 );
 }

 const csatColor = csatScore >= 4 ? "hsl(var(--success) )" : csatScore >= 3 ? "hsl(var(--warn) )" : "hsl(var(--destructive) )";

 return (
 <div
 className="rounded-2xl p-4 space-y-4"
 >
 <div>
 <p className="text-sm font-bold text-foreground">Closure Readiness Assessment</p>
 <p className="text-xs text-primary mt-0.5">
 Confirm handover activities and customer satisfaction before advancing to Project Closure.
 </p>
 </div>

 <div>
 <p className="text-xs font-bold text-foreground mb-2">Handover Checklist</p>
 <div className="space-y-2">
 {HANDOVER_ITEMS.map((item) => (
 <button
 key={item.id}
 onClick={() => toggleHandover(item.id)}
 className="w-full flex items-center gap-2.5 p-2.5 rounded-xl text-left transition-all"
 style={{
 background: handover[item.id] ? "hsl(var(--success) / 0.12)" : "hsl(var(--card))",
 border: `1px solid ${handover[item.id] ? "hsl(var(--success) / 0.12)" : "hsl(var(--primary) / 0.12)"}`,
 }}
 >
 {handover[item.id] ? (
 <CheckCircle2 size={14} className="text-success flex-shrink-0" />
 ) : (
 <Circle size={14} className="text-primary flex-shrink-0" />
 )}
 <span
 className={`text-xs flex-1 ${handover[item.id] ? "text-foreground line-through" : "text-muted-foreground"}`}
 >
 {item.label}
 </span>
 </button>
 ))}
 </div>
 <p className="text-xs text-primary mt-2 font-medium">
 {completedCount}/{HANDOVER_ITEMS.length} complete
 </p>
 </div>

 <div>
 <p className="text-xs font-bold text-foreground mb-2">Customer Satisfaction (CSAT)</p>
 <div className="space-y-2">
 <div className="flex items-center gap-3">
 <label className="flex items-center gap-2 cursor-pointer">
 <input
 type="checkbox"
 checked={csatComplete}
 onChange={(e) => setCsatComplete(e.target.checked)}
 className="rounded"
 />
 <span className="text-xs text-muted-foreground">CSAT survey distributed and complete</span>
 </label>
 </div>

 <div className="flex items-center gap-3">
 <label className="text-xs text-muted-foreground w-32 flex-shrink-0">Response count</label>
 <input
 type="number"
 min={0}
 value={csatResponses}
 onChange={(e) => setCsatResponses(Math.max(0, Number(e.target.value)))}
 className="w-20 text-sm border border-border rounded-lg px-2 py-1 bg-card outline-none focus:ring-1 focus:ring-primary"
 />
 </div>

 <div>
 <div className="flex items-center justify-between mb-1">
 <label className="text-xs text-muted-foreground">Average CSAT score</label>
 <span
 className="text-sm font-bold"
 style={{ color: csatColor }}
 >
 {csatScore > 0 ? `${csatScore}/5` : "—"}
 </span>
 </div>
 <input
 type="range"
 min={1}
 max={5}
 step={0.5}
 value={csatScore}
 onChange={(e) => setCsatScore(Number(e.target.value))}
 className="w-full h-2 rounded-full appearance-none cursor-pointer"
 style={{ accentColor: csatColor }}
 />
 <div className="flex justify-between text-xs text-muted-foreground mt-0.5">
 <span>Poor (1)</span>
 <span>Average (3)</span>
 <span>Excellent (5)</span>
 </div>
 </div>
 </div>
 </div>

 {readyToClose ? (
 <div className="rounded-xl p-3 text-center">
 <p className="text-sm font-bold text-success">
 ✓ All handover activities complete and CSAT ≥ 3 — ready for Project Closure
 </p>
 </div>
 ) : (
 <div className="rounded-xl p-3" style={{ background: "hsl(var(--warn) / 0.12)", border: "1px solid hsl(var(--warn) / 0.3)" }}>
 <p className="text-xs font-semibold text-foreground">Not yet ready for closure:</p>
 <ul className="text-xs text-warn mt-1 space-y-0.5 list-disc list-inside">
 {!allHandoverDone && <li>{HANDOVER_ITEMS.length - completedCount} handover item(s) outstanding</li>}
 {!csatComplete && <li>CSAT survey not yet marked complete</li>}
 {csatComplete && csatScore < 3 && <li>CSAT score below minimum threshold (3/5)</li>}
 </ul>
 </div>
 )}

 <div className="flex items-center gap-3">
 <button
 onClick={save}
 disabled={updateStage.isPending}
 className="bg-primary hover:bg-primary/90 flex-1 py-2 rounded-xl text-sm font-semibold text-primary-foreground transition-all disabled:opacity-40"
 >
 Save Assessment
 </button>
 {savedAt && (
 <span className="text-xs text-primary flex items-center gap-1">
 <CheckCircle2 size={11} />
 Saved {new Date(savedAt).toLocaleDateString()}
 </span>
 )}
 </div>
 </div>
 );
}
