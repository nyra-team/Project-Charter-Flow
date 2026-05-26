import { useState, useEffect } from "react";
import { useListProjectStages, useUpdateProjectStage } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2 } from "lucide-react";
import { AiButton } from "../ai-button";
import { AutoTextarea } from "../ui/auto-textarea";

type AiScoreResult = {
 functional: number; technical: number; commercial: number; track_record: number;
 rationale: { functional: string; technical: string; commercial: string; track_record: string };
 overallNote: string;
};

interface Criterion {
 id: string;
 label: string;
 weight: number;
}

const CRITERIA: Criterion[] = [
 { id: "functional", label: "Functional Fit to URS", weight: 40 },
 { id: "technical", label: "Technical Architecture", weight: 20 },
 { id: "commercial", label: "Commercial Competitiveness", weight: 25 },
 { id: "track_record", label: "Vendor Track Record", weight: 15 },
];

type ScoreMap = Record<string, number>;

function weightedScore(scores: ScoreMap): number {
 return Math.round(
 CRITERIA.reduce((sum, c) => sum + (scores[c.id] ?? 0) * (c.weight / 100), 0),
 );
}

export function VendorEvalScorecard({ projectId }: { projectId: number }) {
 const { data: stages = [] } = useListProjectStages(projectId);
 const updateStage = useUpdateProjectStage();
 const { toast } = useToast();

 const evalRecord = (
 stages as Array<{ id: number; stage: string; notes?: string | null }>
 ).find((s) => s.stage === "vendor_evaluation");

 const parsedNotes: Record<string, unknown> = (() => {
 try { return JSON.parse(evalRecord?.notes ?? "{}"); }
 catch { return {}; }
 })();

 const savedScores = (parsedNotes.__vendor_scores as ScoreMap | undefined) ?? {};
 const savedVendor = (parsedNotes.__vendor_name as string | undefined) ?? "";
 const savedAt = parsedNotes.__vendor_scored_at as string | undefined;

 const [vendorName, setVendorName] = useState(savedVendor);
 const [scores, setScores] = useState<ScoreMap>(savedScores);
 const [vendorNotes, setVendorNotes] = useState("");
 const [aiResult, setAiResult] = useState<AiScoreResult | null>(null);

 useEffect(() => {
 if (evalRecord?.notes) {
 try {
 const p = JSON.parse(evalRecord.notes) as Record<string, unknown>;
 if (p.__vendor_name) setVendorName(p.__vendor_name as string);
 if (p.__vendor_scores) setScores(p.__vendor_scores as ScoreMap);
 } catch {}
 }
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [evalRecord?.id]);

 const totalWeighted = weightedScore(scores);
 const allScored = CRITERIA.every((c) => scores[c.id] !== undefined);
 const qualified = allScored && totalWeighted >= 60;

 function saveScorecard() {
 if (!evalRecord?.id) {
 toast({ title: "Initialise the Vendor Evaluation stage first", variant: "destructive" });
 return;
 }
 const now = new Date().toISOString();
 updateStage.mutate(
 {
 id: evalRecord.id,
 data: {
 notes: JSON.stringify({
 ...parsedNotes,
 __vendor_name: vendorName,
 __vendor_scores: scores,
 __vendor_scored_at: now,
 }),
 },
 },
 {
 onSuccess: () => toast({ title: "Vendor scorecard saved" }),
 onError: () => toast({ title: "Failed to save scorecard", variant: "destructive" }),
 },
 );
 }

 function setScore(criterionId: string, value: number) {
 setScores((prev) => ({ ...prev, [criterionId]: Math.min(100, Math.max(0, value)) }));
 }

 return (
 <div
 className="rounded-2xl p-4 space-y-4"
 >
 <div>
 <p className="text-sm font-bold text-foreground">Vendor Evaluation Scorecard</p>
 <p className="text-xs text-warn mt-0.5">
 Score each criterion 0–100. Minimum qualifying weighted score: 60%.
 Weights: Functional 40% · Technical 20% · Commercial 25% · Track Record 15%.
 </p>
 </div>

 <div>
 <label className="text-xs font-semibold text-foreground block mb-1">Vendor / Solution Name</label>
 <input
 value={vendorName}
 onChange={(e) => setVendorName(e.target.value)}
 placeholder="e.g. Acme ERP Solution"
 className="w-full text-sm border border-border rounded-lg px-3 py-1.5 bg-card outline-none focus:ring-1 focus:ring-warn"
 />
 </div>

 <div>
 <div className="flex items-center justify-between mb-1">
 <label className="text-xs font-semibold text-foreground">Proposal Notes (optional, for AI scoring)</label>
 <AiButton
 label="AI Score Vendor"
 endpoint="/api/ai/vendors/score"
 payload={{ projectId, vendorName, vendorNotes }}
 size="sm"
 variant="subtle"
 onResult={(d) => {
 const r = d as AiScoreResult;
 setAiResult(r);
 setScores({ functional: r.functional, technical: r.technical, commercial: r.commercial, track_record: r.track_record });
 toast({ title: "AI scores applied — review and save" });
 }}
 />
 </div>
 <AutoTextarea
 value={vendorNotes} onChange={(e) => setVendorNotes(e.target.value)}
 minRows={2} placeholder="Key proposal highlights, pricing, references known so far…"
 className="w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-card outline-none focus:ring-1 focus:ring-warn"
 disabled={!vendorName.trim()}
 />
 </div>

 {aiResult && (
 <div className="rounded-lg p-3 bg-card border border-border space-y-1 text-xs">
 <p className="font-semibold text-foreground">AI rationale</p>
 <p><span className="text-muted-foreground">Functional:</span> {aiResult.rationale.functional}</p>
 <p><span className="text-muted-foreground">Technical:</span> {aiResult.rationale.technical}</p>
 <p><span className="text-muted-foreground">Commercial:</span> {aiResult.rationale.commercial}</p>
 <p><span className="text-muted-foreground">Track record:</span> {aiResult.rationale.track_record}</p>
 <p className="pt-1 border-t border-border text-foreground"><strong>Overall:</strong> {aiResult.overallNote}</p>
 </div>
 )}

 <div className="space-y-3">
 {CRITERIA.map((c) => (
 <div key={c.id}>
 <div className="flex items-center justify-between mb-1">
 <label className="text-xs font-semibold text-muted-foreground">
 {c.label}
 <span className="ml-1 text-muted-foreground font-normal">({c.weight}%)</span>
 </label>
 <span
 className="text-xs font-bold px-2 py-0.5 rounded-full"
 style={{
 background:
 (scores[c.id] ?? 0) >= 70
 ? "hsl(var(--success))"
 : (scores[c.id] ?? 0) >= 50
 ? "hsl(var(--warn))"
 : "hsl(var(--destructive))",
 color:
 (scores[c.id] ?? 0) >= 70
 ? "hsl(var(--success) / 1)"
 : (scores[c.id] ?? 0) >= 50
 ? "hsl(var(--warn) / 1)"
 : "hsl(var(--destructive) / 1)",
 }}
 >
 {scores[c.id] !== undefined ? `${scores[c.id]}/100` : "—"}
 </span>
 </div>
 <input
 type="range"
 min={0}
 max={100}
 step={5}
 value={scores[c.id] ?? 0}
 onChange={(e) => setScore(c.id, Number(e.target.value))}
 className="w-full h-2 rounded-full appearance-none cursor-pointer"
 style={{ accentColor: "hsl(var(--warn) / 1)" }}
 />
 </div>
 ))}
 </div>

 {allScored && (
 <div
 className="rounded-xl p-3 text-center"
 style={{
 background: qualified ? "hsl(var(--success) / 0.12)" : "hsl(var(--destructive) / 0.12)",
 border: `1px solid ${qualified ? "hsl(var(--success) / 0.12)" : "hsl(var(--destructive) / 0.12)"}`,
 }}
 >
 <p
 className="text-2xl font-black"
 style={{ color: qualified ? "hsl(var(--success))" : "hsl(var(--destructive))" }}
 >
 {totalWeighted}%
 </p>
 <p
 className="text-xs font-semibold mt-0.5"
 style={{ color: qualified ? "hsl(var(--success) / 1)" : "hsl(var(--destructive) / 1)" }}
 >
 {qualified ? "✓ Qualifying score — vendor recommended" : "Below 60% threshold — not recommended"}
 </p>
 </div>
 )}

 <div className="flex items-center gap-3">
 <button
 onClick={saveScorecard}
 disabled={!vendorName.trim() || !allScored || updateStage.isPending}
 className="bg-primary hover:bg-primary/90 flex-1 py-2 rounded-xl text-sm font-semibold text-primary-foreground transition-all disabled:opacity-40"
 >
 Save Scorecard
 </button>
 {savedAt && (
 <span className="text-xs text-warn flex items-center gap-1">
 <CheckCircle2 size={11} />
 Saved {new Date(savedAt).toLocaleDateString()}
 </span>
 )}
 </div>
 </div>
 );
}
