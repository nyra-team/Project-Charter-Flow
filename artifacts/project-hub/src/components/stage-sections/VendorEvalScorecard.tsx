import { useState, useEffect, useMemo } from "react";
import { useListProjectStages, useUpdateProjectStage } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, Plus, Trash2, Pencil, X, Sparkles, Lightbulb, ArrowRight } from "lucide-react";
import { AiButton } from "../ai-button";
import { AutoTextarea } from "../ui/auto-textarea";

type Vendor = {
 id: string;
 name: string;
 description?: string;
 contact?: string;
 website?: string;
 pricing?: string;
 notes?: string;
};

type Dimension = {
 id: string;
 label: string;
 kind: "technical" | "commercial";
 weight: number;
 description?: string;
};

type ScoreMap = Record<string, number>;
type ScoresByVendor = Record<string, ScoreMap>;

type AiSuggestedDimensions = { dimensions: Array<{ label: string; kind: "technical" | "commercial"; weight: number; description?: string }> };
type AiMatrixScore = { scores: ScoreMap; rationale: Record<string, string>; overallNote: string };
type AiInsights = {
 strongest: string;
 weakest: string;
 gaps: string[];
 recommendation: string;
 perVendor: Array<{ vendorId: string; whatTheyOffer: string; whatTheyMiss: string }>;
};

const DEFAULT_DIMENSIONS: Dimension[] = [
 { id: "d_functional", label: "Functional Fit to URS", kind: "technical", weight: 40, description: "How well the proposal covers required URS features." },
 { id: "d_technical", label: "Technical Architecture", kind: "technical", weight: 20, description: "Robustness, scalability, integration approach." },
 { id: "d_commercial", label: "Commercial Competitiveness", kind: "commercial", weight: 25, description: "CapEx, OpEx, payment terms, total cost of ownership." },
 { id: "d_track_record", label: "Vendor Track Record", kind: "commercial", weight: 15, description: "Past projects, references, financial stability." },
];

function newId(prefix: string) {
 return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function weightedScore(scores: ScoreMap, dims: Dimension[]): number {
 const totalWeight = dims.reduce((s, d) => s + d.weight, 0) || 1;
 return Math.round(
 dims.reduce((sum, d) => sum + (scores[d.id] ?? 0) * (d.weight / totalWeight), 0),
 );
}

export function VendorEvalScorecard({ projectId }: { projectId: number }) {
 const { data: stages = [] } = useListProjectStages(projectId);
 const updateStage = useUpdateProjectStage();
 const queryClient = useQueryClient();
 const { toast } = useToast();

 const evalRecord = (
 stages as Array<{ id: number; stage: string; notes?: string | null }>
 ).find((s) => s.stage === "vendor_evaluation");

 const rfpRecord = (
 stages as Array<{ id: number; stage: string; notes?: string | null }>
 ).find((s) => s.stage === "rfp");

 const parsedEvalNotes: Record<string, unknown> = useMemo(() => {
 try { return JSON.parse(evalRecord?.notes ?? "{}"); }
 catch { return {}; }
 }, [evalRecord?.notes]);

 const parsedRfpNotes: Record<string, unknown> = useMemo(() => {
 try { return JSON.parse(rfpRecord?.notes ?? "{}"); }
 catch { return {}; }
 }, [rfpRecord?.notes]);

 const vendors: Vendor[] = useMemo(() => {
 const list = parsedRfpNotes.__vendors as Vendor[] | undefined;
 return Array.isArray(list) ? list : [];
 }, [parsedRfpNotes]);

 const initialDimensions: Dimension[] = useMemo(() => {
 const list = parsedEvalNotes.__eval_dimensions as Dimension[] | undefined;
 if (Array.isArray(list) && list.length > 0) return list;
 return DEFAULT_DIMENSIONS;
 }, [parsedEvalNotes]);

 const initialScoresByVendor: ScoresByVendor = useMemo(() => {
 const map = parsedEvalNotes.__vendor_scores_by_id as ScoresByVendor | undefined;
 return map && typeof map === "object" ? map : {};
 }, [parsedEvalNotes]);

 const initialSelectedId: string | null = useMemo(() => {
 const stored = parsedEvalNotes.__selected_vendor_id as string | undefined;
 if (stored && vendors.some((v) => v.id === stored)) return stored;
 return vendors[0]?.id ?? null;
 }, [parsedEvalNotes, vendors]);

 const [dimensions, setDimensions] = useState<Dimension[]>(initialDimensions);
 const [scoresByVendor, setScoresByVendor] = useState<ScoresByVendor>(initialScoresByVendor);
 const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
 const [scoredAt, setScoredAt] = useState<Record<string, string>>(
 (parsedEvalNotes.__vendor_scored_at_by_id as Record<string, string> | undefined) ?? {},
 );

 const [showAddDim, setShowAddDim] = useState(false);
 const [editingDimId, setEditingDimId] = useState<string | null>(null);
 const [dimDraft, setDimDraft] = useState<Dimension>({ id: "", label: "", kind: "technical", weight: 10 });
 const [aiMatrixResult, setAiMatrixResult] = useState<Record<string, AiMatrixScore>>({});
 const [insights, setInsights] = useState<AiInsights | null>(null);

 // Reload when the underlying record changes (e.g. switching projects).
 useEffect(() => {
 setDimensions(initialDimensions);
 setScoresByVendor(initialScoresByVendor);
 setSelectedId(initialSelectedId);
 setScoredAt((parsedEvalNotes.__vendor_scored_at_by_id as Record<string, string> | undefined) ?? {});
 setAiMatrixResult({});
 setInsights(null);
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [evalRecord?.id]);

 // One-time migration of LEGACY single-vendor data:
 // If VE has the old __vendor_name + __vendor_scores keys but the new
 // __vendor_scores_by_id map is empty, map the legacy scores onto the
 // matching RFP vendor (by name match) using the default dimension IDs —
 // those default ids (d_functional / d_technical / d_commercial / d_track_record)
 // are intentionally a superset of the legacy 4 score keys.
 useEffect(() => {
 if (!evalRecord?.id) return;
 const alreadyMigrated = !!parsedEvalNotes.__legacy_migrated_at;
 const newMapEmpty = Object.keys(initialScoresByVendor).length === 0;
 const legacyName = (parsedEvalNotes.__vendor_name as string | undefined) ?? "";
 const legacyScores = (parsedEvalNotes.__vendor_scores as ScoreMap | undefined) ?? {};
 const hasLegacy = legacyName.trim().length > 0 || Object.keys(legacyScores).length > 0;
 if (alreadyMigrated || !newMapEmpty || !hasLegacy) return;

 const targetVendor =
 vendors.find((v) => v.name.trim().toLowerCase() === legacyName.trim().toLowerCase()) ??
 vendors[0];
 if (!targetVendor) return;

 const migratedScores: ScoreMap = {};
 for (const d of dimensions) {
 const legacyKey = d.id.replace(/^d_/, "");
 const v = legacyScores[legacyKey];
 if (typeof v === "number") migratedScores[d.id] = v;
 }
 if (Object.keys(migratedScores).length === 0) return;

 const nextScores: ScoresByVendor = { ...initialScoresByVendor, [targetVendor.id]: migratedScores };
 const legacyAt = (parsedEvalNotes.__vendor_scored_at as string | undefined) ?? "";
 const nextScoredAt = legacyAt ? { ...scoredAt, [targetVendor.id]: legacyAt } : scoredAt;
 setScoresByVendor(nextScores);
 setSelectedId(targetVendor.id);
 if (legacyAt) setScoredAt(nextScoredAt);

 // Persist with a migration marker so we never re-run this.
 if (!evalRecord?.id) return;
 updateStage.mutate({
 id: evalRecord.id,
 data: {
 notes: JSON.stringify({
 ...parsedEvalNotes,
 __eval_dimensions: dimensions,
 __vendor_scores_by_id: nextScores,
 __vendor_scored_at_by_id: nextScoredAt,
 __selected_vendor_id: targetVendor.id,
 __legacy_migrated_at: new Date().toISOString(),
 }),
 },
 });
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [evalRecord?.id, vendors.length]);

 // When the RFP vendor list changes (vendor added / removed), keep selection valid
 // without throwing away in-progress score edits.
 useEffect(() => {
 if (vendors.length === 0) {
 setSelectedId(null);
 return;
 }
 if (!selectedId || !vendors.some((v) => v.id === selectedId)) {
 setSelectedId(vendors[0].id);
 }
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [vendors.map((v) => v.id).join(",")]);

 const selected = vendors.find((v) => v.id === selectedId) ?? null;
 const selectedScores: ScoreMap = scoresByVendor[selectedId ?? ""] ?? {};
 const totalWeighted = weightedScore(selectedScores, dimensions);
 const allScored = selected && dimensions.length > 0
 ? dimensions.every((d) => selectedScores[d.id] !== undefined)
 : false;
 const qualified = allScored && totalWeighted >= 60;

 function persist(opts: {
 nextDimensions?: Dimension[];
 nextScores?: ScoresByVendor;
 nextSelectedId?: string | null;
 nextScoredAt?: Record<string, string>;
 silent?: boolean;
 successMsg?: string;
 }) {
 if (!evalRecord?.id) {
 toast({ title: "Initialise the Vendor Evaluation stage first", variant: "destructive" });
 return;
 }
 const dims = opts.nextDimensions ?? dimensions;
 const scores = opts.nextScores ?? scoresByVendor;
 const selId = opts.nextSelectedId !== undefined ? opts.nextSelectedId : selectedId;
 const scoredMap = opts.nextScoredAt ?? scoredAt;

 // Legacy mirror — keeps existing checklist + downstream code working until we
 // fully migrate. Mirror the selected vendor's name + a normalised score map
 // mapped to the legacy 4-key shape when those dimensions still exist.
 const sel = vendors.find((v) => v.id === selId) ?? null;
 const selScores = sel ? (scores[sel.id] ?? {}) : {};
 // Only mirror legacy keys for dimensions that have ACTUALLY been scored.
 // Defaulting to 0 would make downstream checklist think the eval is done.
 const legacyScores: ScoreMap = {};
 for (const d of dims) {
 const legacyKey = d.id.replace(/^d_/, "");
 if (!["functional", "technical", "commercial", "track_record"].includes(legacyKey)) continue;
 const v = selScores[d.id];
 if (typeof v === "number") legacyScores[legacyKey] = v;
 }

 updateStage.mutate(
 {
 id: evalRecord.id,
 data: {
 notes: JSON.stringify({
 ...parsedEvalNotes,
 __eval_dimensions: dims,
 __vendor_scores_by_id: scores,
 __vendor_scored_at_by_id: scoredMap,
 __selected_vendor_id: selId,
 // legacy mirror
 __vendor_name: sel?.name ?? "",
 __vendor_scores: legacyScores,
 __vendor_scored_at: sel ? scoredMap[sel.id] ?? "" : "",
 }),
 },
 },
 {
 onSuccess: () => {
 void queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/stages`] });
 if (!opts.silent && opts.successMsg) toast({ title: opts.successMsg });
 },
 onError: () => toast({ title: "Failed to save", variant: "destructive" }),
 },
 );
 }

 // ---- Dimension CRUD --------------------------------------------------------
 function startAddDim() {
 setDimDraft({ id: newId("d"), label: "", kind: "technical", weight: 10 });
 setEditingDimId(null);
 setShowAddDim(true);
 }
 function startEditDim(d: Dimension) {
 setDimDraft({ ...d });
 setEditingDimId(d.id);
 setShowAddDim(true);
 }
 function cancelDim() {
 setShowAddDim(false);
 setEditingDimId(null);
 }
 function saveDim() {
 if (!dimDraft.label.trim()) {
 toast({ title: "Dimension label is required", variant: "destructive" });
 return;
 }
 const w = Math.max(0, Math.min(100, Number(dimDraft.weight) || 0));
 const next = editingDimId
 ? dimensions.map((d) => (d.id === editingDimId ? { ...dimDraft, weight: w } : d))
 : [...dimensions, { ...dimDraft, weight: w }];
 setDimensions(next);
 persist({ nextDimensions: next, successMsg: editingDimId ? "Dimension updated" : "Dimension added" });
 cancelDim();
 }
 function deleteDim(id: string) {
 const next = dimensions.filter((d) => d.id !== id);
 setDimensions(next);
 // Clean up scores referencing the removed dimension
 const cleanScores: ScoresByVendor = {};
 for (const [vid, smap] of Object.entries(scoresByVendor)) {
 const copy: ScoreMap = { ...smap };
 delete copy[id];
 cleanScores[vid] = copy;
 }
 setScoresByVendor(cleanScores);
 persist({ nextDimensions: next, nextScores: cleanScores, successMsg: "Dimension removed" });
 }

 // ---- Scoring ---------------------------------------------------------------
 function setScore(dimId: string, value: number) {
 if (!selectedId) return;
 const v = Math.min(100, Math.max(0, value));
 const next: ScoresByVendor = {
 ...scoresByVendor,
 [selectedId]: { ...(scoresByVendor[selectedId] ?? {}), [dimId]: v },
 };
 setScoresByVendor(next);
 }

 function saveScores() {
 if (!selected) return;
 const now = new Date().toISOString();
 const nextScoredAt = { ...scoredAt, [selected.id]: now };
 setScoredAt(nextScoredAt);
 persist({ nextScoredAt, successMsg: "Scorecard saved" });
 }

 function selectVendor(id: string) {
 setSelectedId(id);
 persist({ nextSelectedId: id, silent: true });
 }

 const dimensionsKey = dimensions.map((d) => `${d.id}:${d.label}`).join("|");

 return (
 <div className="rounded-2xl p-4 space-y-4 border border-border bg-card/40">
 <div>
 <p className="text-sm font-bold text-foreground">Vendor Evaluation Matrix</p>
 <p className="text-xs text-muted-foreground mt-0.5">
 Vendors are managed in the <span className="font-semibold text-foreground">RFP stage</span>.
 Here you score each vendor against custom technical &amp; commercial dimensions.
 </p>
 </div>

 {/* Vendor list (read-only from RFP) */}
 <div className="space-y-2">
 <p className="text-xs font-semibold text-foreground">
 Vendors from RFP ({vendors.length})
 </p>
 {vendors.length === 0 ? (
 <div className="rounded-xl p-4 border border-dashed border-border text-center text-xs text-muted-foreground">
 No vendors yet. Go back to the <span className="font-semibold text-foreground">RFP stage</span> and add vendors there.
 They will appear here automatically.
 </div>
 ) : (
 <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
 {vendors.map((v) => {
 const s = scoresByVendor[v.id] ?? {};
 const vScored = dimensions.length > 0 && dimensions.every((d) => s[d.id] !== undefined);
 const vScore = vScored ? weightedScore(s, dimensions) : null;
 const isSelected = v.id === selectedId;
 return (
 <button
 key={v.id}
 onClick={() => selectVendor(v.id)}
 className={`text-left rounded-xl p-2.5 border transition-all ${
 isSelected ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40"
 }`}
 >
 <div className="flex items-center justify-between gap-2">
 <p className="text-sm font-semibold text-foreground truncate flex-1 min-w-0">{v.name}</p>
 {vScore !== null && (
 <span
 className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded flex-shrink-0"
 style={{
 background: vScore >= 60 ? "hsl(var(--success) / 0.15)" : "hsl(var(--destructive) / 0.15)",
 color: vScore >= 60 ? "hsl(var(--success))" : "hsl(var(--destructive))",
 }}
 >
 {vScore}%
 </span>
 )}
 </div>
 {v.description && (
 <p className="text-[11px] text-muted-foreground mt-1 line-clamp-1">{v.description}</p>
 )}
 </button>
 );
 })}
 </div>
 )}
 </div>

 {/* Evaluation dimensions */}
 <div className="space-y-2 pt-3 border-t border-border">
 <div className="flex items-center justify-between">
 <div>
 <p className="text-xs font-semibold text-foreground">
 Evaluation Dimensions ({dimensions.length})
 </p>
 <p className="text-[11px] text-muted-foreground">
 Edit, add or AI-suggest the criteria each vendor will be scored on.
 </p>
 </div>
 <div className="flex items-center gap-2">
 <AiButton
 label="AI Suggest Dimensions"
 endpoint="/api/ai/vendors/suggest-dimensions"
 payload={{ projectId, existing: dimensions.map((d) => d.label) }}
 size="sm"
 variant="subtle"
 onResult={(d) => {
 const sug = (d as AiSuggestedDimensions).dimensions ?? [];
 if (sug.length === 0) {
 toast({ title: "AI returned no suggestions", variant: "destructive" });
 return;
 }
 const added: Dimension[] = sug.map((s) => ({
 id: newId("d"),
 label: s.label,
 kind: s.kind,
 weight: s.weight,
 description: s.description,
 }));
 const next = [...dimensions, ...added];
 setDimensions(next);
 persist({ nextDimensions: next, successMsg: `Added ${added.length} AI dimensions` });
 }}
 />
 {!showAddDim && (
 <button
 onClick={startAddDim}
 className="text-xs font-semibold text-primary inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-border hover:bg-card"
 >
 <Plus size={12} /> Add Dimension
 </button>
 )}
 </div>
 </div>

 <div className="space-y-1.5">
 {dimensions.map((d) => (
 <div key={d.id} className="rounded-lg p-2 border border-border bg-card flex items-center gap-2">
 <div className="flex-1 min-w-0">
 <div className="flex items-center gap-2">
 <span className="text-xs font-semibold text-foreground truncate">{d.label}</span>
 <span className={`text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded ${
 d.kind === "technical" ? "bg-primary/10 text-primary" : "bg-warn/10 text-warn"
 }`}>
 {d.kind}
 </span>
 <span className="text-[10px] font-mono text-muted-foreground">{d.weight}%</span>
 </div>
 {d.description && (
 <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{d.description}</p>
 )}
 </div>
 <button onClick={() => startEditDim(d)} className="p-1 rounded hover:bg-card text-muted-foreground hover:text-foreground" title="Edit">
 <Pencil size={12} />
 </button>
 <button onClick={() => deleteDim(d.id)} className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive" title="Delete">
 <Trash2 size={12} />
 </button>
 </div>
 ))}

 {showAddDim && (
 <div className="rounded-lg p-2.5 border border-primary/40 bg-primary/5 space-y-2">
 <div className="flex items-center justify-between">
 <p className="text-xs font-semibold text-foreground">
 {editingDimId ? "Edit Dimension" : "Add Dimension"}
 </p>
 <button onClick={cancelDim} className="p-1 rounded hover:bg-card text-muted-foreground">
 <X size={12} />
 </button>
 </div>
 <input
 value={dimDraft.label}
 onChange={(e) => setDimDraft({ ...dimDraft, label: e.target.value })}
 placeholder="e.g. Data Migration Readiness"
 className="w-full text-sm border border-border rounded-lg px-2 py-1.5 bg-card outline-none focus:ring-1 focus:ring-primary"
 />
 <AutoTextarea
 value={dimDraft.description ?? ""}
 onChange={(e) => setDimDraft({ ...dimDraft, description: e.target.value })}
 minRows={2}
 placeholder="What this dimension means / how to judge it (optional)"
 className="w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-card outline-none focus:ring-1 focus:ring-primary"
 />
 <div className="grid grid-cols-2 gap-2">
 <div>
 <label className="text-[11px] font-semibold text-foreground block mb-1">Kind</label>
 <select
 value={dimDraft.kind}
 onChange={(e) => setDimDraft({ ...dimDraft, kind: e.target.value as "technical" | "commercial" })}
 className="w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-card outline-none focus:ring-1 focus:ring-primary"
 >
 <option value="technical">Technical</option>
 <option value="commercial">Commercial</option>
 </select>
 </div>
 <div>
 <label className="text-[11px] font-semibold text-foreground block mb-1">Weight %</label>
 <input
 type="number"
 min={0}
 max={100}
 value={dimDraft.weight}
 onChange={(e) => setDimDraft({ ...dimDraft, weight: Number(e.target.value) })}
 className="w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-card outline-none focus:ring-1 focus:ring-primary"
 />
 </div>
 </div>
 <div className="flex items-center gap-2">
 <button
 onClick={saveDim}
 disabled={!dimDraft.label.trim()}
 className="bg-primary hover:bg-primary/90 flex-1 py-1.5 rounded-lg text-xs font-semibold text-primary-foreground disabled:opacity-40"
 >
 {editingDimId ? "Save Changes" : "Add Dimension"}
 </button>
 <button onClick={cancelDim} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-muted-foreground border border-border hover:bg-card">
 Cancel
 </button>
 </div>
 </div>
 )}
 </div>

 {dimensions.length > 0 && (
 <p className="text-[11px] text-muted-foreground">
 Total weight: <span className="font-mono font-semibold text-foreground">
 {dimensions.reduce((s, d) => s + d.weight, 0)}%
 </span> (need not be exactly 100 — used as relative weights)
 </p>
 )}
 </div>

 {/* Scoring panel for selected vendor */}
 {selected && dimensions.length > 0 && (
 <div className="space-y-3 pt-3 border-t border-border">
 <div className="flex items-center justify-between">
 <p className="text-xs font-semibold text-foreground">
 Scoring: <span className="text-primary">{selected.name}</span>
 </p>
 <AiButton
 label="AI Score this Vendor"
 endpoint="/api/ai/vendors/score-matrix"
 payload={{
 projectId,
 vendorName: selected.name,
 vendorNotes: [selected.description, selected.notes, selected.pricing].filter(Boolean).join("\n"),
 dimensions: dimensions.map((d) => ({ id: d.id, label: d.label, kind: d.kind, description: d.description, weight: d.weight })),
 }}
 size="sm"
 variant="subtle"
 onResult={(d) => {
 const r = d as AiMatrixScore;
 setAiMatrixResult((prev) => ({ ...prev, [selected.id]: r }));
 // Apply AI scores as the current vendor's scores (user can save).
 const merged: ScoreMap = { ...(scoresByVendor[selected.id] ?? {}) };
 for (const dim of dimensions) {
 if (typeof r.scores?.[dim.id] === "number") merged[dim.id] = r.scores[dim.id];
 }
 setScoresByVendor((prev) => ({ ...prev, [selected.id]: merged }));
 toast({ title: "AI scores applied — review and click Save Scorecard" });
 }}
 />
 </div>

 {aiMatrixResult[selected.id] && (
 <div className="rounded-lg p-3 bg-card border border-border space-y-1 text-xs">
 <p className="font-semibold text-foreground">AI rationale</p>
 {dimensions.map((d) => {
 const r = aiMatrixResult[selected.id].rationale?.[d.id];
 if (!r) return null;
 return <p key={d.id}><span className="text-muted-foreground">{d.label}:</span> {r}</p>;
 })}
 {aiMatrixResult[selected.id].overallNote && (
 <p className="pt-1 border-t border-border text-foreground">
 <strong>Overall:</strong> {aiMatrixResult[selected.id].overallNote}
 </p>
 )}
 </div>
 )}

 <div className="space-y-3" key={dimensionsKey}>
 {dimensions.map((d) => {
 const v = selectedScores[d.id];
 return (
 <div key={d.id}>
 <div className="flex items-center justify-between mb-1">
 <label className="text-xs font-semibold text-muted-foreground">
 {d.label}
 <span className="ml-1 text-muted-foreground font-normal">({d.weight}%)</span>
 </label>
 <span
 className="text-xs font-bold px-2 py-0.5 rounded-full"
 style={{
 background:
 (v ?? 0) >= 70 ? "hsl(var(--success) / 0.15)"
 : (v ?? 0) >= 50 ? "hsl(var(--warn) / 0.15)"
 : "hsl(var(--destructive) / 0.15)",
 color:
 (v ?? 0) >= 70 ? "hsl(var(--success))"
 : (v ?? 0) >= 50 ? "hsl(var(--warn))"
 : "hsl(var(--destructive))",
 }}
 >
 {v !== undefined ? `${v}/100` : "—"}
 </span>
 </div>
 <input
 type="range"
 min={0}
 max={100}
 step={5}
 value={v ?? 0}
 onChange={(e) => setScore(d.id, Number(e.target.value))}
 className="w-full h-2 rounded-full appearance-none cursor-pointer"
 style={{ accentColor: "hsl(var(--warn))" }}
 />
 </div>
 );
 })}
 </div>

 {allScored && (
 <div
 className="rounded-xl p-3 text-center"
 style={{
 background: qualified ? "hsl(var(--success) / 0.12)" : "hsl(var(--destructive) / 0.12)",
 border: `1px solid ${qualified ? "hsl(var(--success) / 0.25)" : "hsl(var(--destructive) / 0.25)"}`,
 }}
 >
 <p className="text-2xl font-black" style={{ color: qualified ? "hsl(var(--success))" : "hsl(var(--destructive))" }}>
 {totalWeighted}%
 </p>
 <p className="text-xs font-semibold mt-0.5" style={{ color: qualified ? "hsl(var(--success))" : "hsl(var(--destructive))" }}>
 {qualified ? "✓ Qualifying score — vendor recommended" : "Below 60% threshold — not recommended"}
 </p>
 </div>
 )}

 <div className="flex items-center gap-3">
 <button
 onClick={saveScores}
 disabled={!allScored || updateStage.isPending}
 className="bg-primary hover:bg-primary/90 flex-1 py-2 rounded-xl text-sm font-semibold text-primary-foreground transition-all disabled:opacity-40"
 >
 Save Scorecard
 </button>
 {scoredAt[selected.id] && (
 <span className="text-xs text-warn flex items-center gap-1">
 <CheckCircle2 size={11} />
 Saved {new Date(scoredAt[selected.id]).toLocaleDateString()}
 </span>
 )}
 </div>
 </div>
 )}

 {/* AI Insights across vendors */}
 {vendors.length >= 1 && dimensions.length > 0 && (
 <div className="space-y-2 pt-3 border-t border-border">
 <div className="flex items-center justify-between">
 <div>
 <p className="text-xs font-semibold text-foreground inline-flex items-center gap-1">
 <Lightbulb size={12} /> AI Insights
 </p>
 <p className="text-[11px] text-muted-foreground">
 Gaps vs URS, what each vendor covers/misses, and which to pick.
 </p>
 </div>
 <AiButton
 label="Generate Insights"
 endpoint="/api/ai/vendors/insights"
 payload={{
 projectId,
 vendors: vendors.map((v) => ({ id: v.id, name: v.name, description: v.description, notes: v.notes, pricing: v.pricing })),
 dimensions: dimensions.map((d) => ({ id: d.id, label: d.label, kind: d.kind, weight: d.weight, description: d.description })),
 scores: scoresByVendor,
 }}
 size="sm"
 variant="subtle"
 onResult={(d) => {
 setInsights(d as AiInsights);
 toast({ title: "Insights generated" });
 }}
 />
 </div>

 {insights && (
 <div className="rounded-lg p-3 bg-card border border-border space-y-2 text-xs">
 <p>
 <span className="font-semibold text-success">Strongest:</span> {insights.strongest}
 </p>
 <p>
 <span className="font-semibold text-destructive">Weakest:</span> {insights.weakest}
 </p>
 {insights.gaps?.length > 0 && (
 <div>
 <p className="font-semibold text-foreground mb-1">Gaps vs URS:</p>
 <ul className="space-y-0.5">
 {insights.gaps.map((g, i) => (
 <li key={i} className="text-muted-foreground">• {g}</li>
 ))}
 </ul>
 </div>
 )}
 {insights.perVendor?.length > 0 && (
 <div className="space-y-1 pt-1 border-t border-border">
 <p className="font-semibold text-foreground">Per vendor:</p>
 {insights.perVendor.map((pv) => {
 const v = vendors.find((x) => x.id === pv.vendorId);
 if (!v) return null;
 return (
 <div key={pv.vendorId} className="rounded p-2 bg-background border border-border">
 <p className="font-semibold text-foreground">{v.name}</p>
 <p><span className="text-success">Offers:</span> {pv.whatTheyOffer}</p>
 <p><span className="text-destructive">Misses:</span> {pv.whatTheyMiss}</p>
 </div>
 );
 })}
 </div>
 )}
 <p className="pt-2 border-t border-border text-foreground inline-flex items-start gap-1">
 <ArrowRight size={11} className="mt-0.5 flex-shrink-0" />
 <span><strong>Recommendation:</strong> {insights.recommendation}</span>
 </p>
 </div>
 )}
 </div>
 )}

 {/* Marker so unused imports stay used at edge cases */}
 <span className="hidden"><Sparkles size={0} /></span>
 </div>
 );
}
