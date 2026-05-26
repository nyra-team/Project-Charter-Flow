import { useState, useEffect, useMemo } from "react";
import { useListProjectStages, useUpdateProjectStage } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, Plus, Trash2, Pencil, X, Globe, Phone, IndianRupee } from "lucide-react";
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

type Vendor = {
 id: string;
 name: string;
 description?: string;
 contact?: string;
 website?: string;
 pricing?: string;
 notes?: string;
 scores?: ScoreMap;
 scoredAt?: string;
};

function weightedScore(scores: ScoreMap): number {
 return Math.round(
 CRITERIA.reduce((sum, c) => sum + (scores[c.id] ?? 0) * (c.weight / 100), 0),
 );
}

function newId() {
 return `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function VendorEvalScorecard({ projectId }: { projectId: number }) {
 const { data: stages = [] } = useListProjectStages(projectId);
 const updateStage = useUpdateProjectStage();
 const { toast } = useToast();

 const evalRecord = (
 stages as Array<{ id: number; stage: string; notes?: string | null }>
 ).find((s) => s.stage === "vendor_evaluation");

 const parsedNotes: Record<string, unknown> = useMemo(() => {
 try { return JSON.parse(evalRecord?.notes ?? "{}"); }
 catch { return {}; }
 }, [evalRecord?.notes]);

 // Migrate legacy single-vendor shape into vendor list, if needed.
 // The migrated vendor's id must be stable (derived from name) so repeat renders
 // don't recreate it with a fresh id and orphan the selection.
 const initialVendors = useMemo<Vendor[]>(() => {
 const list = parsedNotes.__vendors as Vendor[] | undefined;
 if (Array.isArray(list) && list.length > 0) return list;
 const legacyName = parsedNotes.__vendor_name as string | undefined;
 const legacyScores = parsedNotes.__vendor_scores as ScoreMap | undefined;
 if (legacyName) {
 return [{
 id: `legacy_${legacyName.toLowerCase().replace(/[^a-z0-9]/g, "_")}`,
 name: legacyName,
 scores: legacyScores,
 scoredAt: parsedNotes.__vendor_scored_at as string | undefined,
 }];
 }
 return [];
 }, [parsedNotes]);

 const [vendors, setVendors] = useState<Vendor[]>(initialVendors);
 const [selectedId, setSelectedId] = useState<string | null>(initialVendors[0]?.id ?? null);
 const [showAddForm, setShowAddForm] = useState(false);
 const [editingId, setEditingId] = useState<string | null>(null);
 const [draft, setDraft] = useState<Vendor>({ id: "", name: "" });
 const [aiResult, setAiResult] = useState<AiScoreResult | null>(null);
 // Slider edits live here as an unsaved draft for the currently selected vendor.
 // They are only merged into `vendors` and persisted when `Save Scorecard` is clicked.
 const [draftScores, setDraftScores] = useState<ScoreMap>({});

 useEffect(() => {
 setVendors(initialVendors);
 setSelectedId((prev) => {
 if (prev && initialVendors.some((v) => v.id === prev)) return prev;
 return initialVendors[0]?.id ?? null;
 });
 setDraftScores({});
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [evalRecord?.id]);

 // When the user switches selected vendor, reset the draft slider state
 // to whatever is currently saved on that vendor.
 useEffect(() => {
 const v = vendors.find((x) => x.id === selectedId);
 setDraftScores(v?.scores ?? {});
 setAiResult(null);
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [selectedId]);

 const selected = vendors.find((v) => v.id === selectedId) ?? null;
 const selectedScores = draftScores;
 const totalWeighted = weightedScore(selectedScores);
 const allScored = selected ? CRITERIA.every((c) => selectedScores[c.id] !== undefined) : false;
 const qualified = allScored && totalWeighted >= 60;
 const scoresDirty = selected
 ? CRITERIA.some((c) => (selected.scores?.[c.id] ?? null) !== (selectedScores[c.id] ?? null))
 : false;

 // Persist a list of vendors. Score edits in `draftScores` are NEVER auto-merged here —
 // only `saveScorecard` is allowed to commit slider changes for the selected vendor.
 function persistVendors(next: Vendor[], opts?: { silent?: boolean; selectedOverride?: string | null }) {
 if (!evalRecord?.id) {
 toast({ title: "Initialise the Vendor Evaluation stage first", variant: "destructive" });
 return;
 }
 // Legacy keys mirror the explicitly selected vendor (not the auto-ranked top score),
 // so the derived checklist in stage-panel.tsx reflects business intent.
 const selId = opts?.selectedOverride !== undefined ? opts.selectedOverride : selectedId;
 const sel = next.find((v) => v.id === selId) ?? next[0] ?? null;
 updateStage.mutate(
 {
 id: evalRecord.id,
 data: {
 notes: JSON.stringify({
 ...parsedNotes,
 __vendors: next,
 __vendor_name: sel?.name ?? "",
 __vendor_scores: sel?.scores ?? {},
 __vendor_scored_at: sel?.scoredAt ?? "",
 }),
 },
 },
 {
 onSuccess: () => { if (!opts?.silent) toast({ title: "Vendor list saved" }); },
 onError: () => toast({ title: "Failed to save vendors", variant: "destructive" }),
 },
 );
 }

 function startAddVendor() {
 setDraft({ id: newId(), name: "" });
 setEditingId(null);
 setShowAddForm(true);
 }

 function startEditVendor(v: Vendor) {
 setDraft({ ...v });
 setEditingId(v.id);
 setShowAddForm(true);
 }

 function saveDraft() {
 if (!draft.name.trim()) {
 toast({ title: "Vendor name is required", variant: "destructive" });
 return;
 }
 let next: Vendor[];
 if (editingId) {
 next = vendors.map((v) => (v.id === editingId ? { ...v, ...draft } : v));
 } else {
 next = [...vendors, draft];
 setSelectedId(draft.id);
 }
 setVendors(next);
 persistVendors(next);
 setShowAddForm(false);
 setEditingId(null);
 setDraft({ id: "", name: "" });
 }

 function deleteVendor(id: string) {
 const next = vendors.filter((v) => v.id !== id);
 const nextSelectedId = selectedId === id ? (next[0]?.id ?? null) : selectedId;
 setVendors(next);
 if (selectedId === id) setSelectedId(nextSelectedId);
 persistVendors(next, { selectedOverride: nextSelectedId });
 }

 function setSelectedScore(criterionId: string, value: number) {
 if (!selected) return;
 setDraftScores((prev) => ({ ...prev, [criterionId]: Math.min(100, Math.max(0, value)) }));
 }

 function saveScorecard() {
 if (!selected) return;
 const now = new Date().toISOString();
 const next = vendors.map((v) =>
 v.id === selected.id ? { ...v, scores: { ...draftScores }, scoredAt: now } : v,
 );
 setVendors(next);
 persistVendors(next);
 }

 return (
 <div className="rounded-2xl p-4 space-y-4">
 <div>
 <p className="text-sm font-bold text-foreground">Vendor Evaluation Scorecard</p>
 <p className="text-xs text-warn mt-0.5">
 Maintain your vendor shortlist with full details, then score each one.
 Weights: Functional 40% · Technical 20% · Commercial 25% · Track Record 15%. Qualifying: 60%.
 </p>
 </div>

 {/* Vendor list */}
 <div className="space-y-2">
 <div className="flex items-center justify-between">
 <p className="text-xs font-semibold text-foreground">Vendors ({vendors.length})</p>
 {!showAddForm && (
 <button
 onClick={startAddVendor}
 className="text-xs font-semibold text-primary inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-border hover:bg-card"
 >
 <Plus size={12} /> Add Vendor
 </button>
 )}
 </div>

 {vendors.length === 0 && !showAddForm && (
 <div className="rounded-xl p-4 border border-dashed border-border text-center text-xs text-muted-foreground">
 No vendors yet. Click <span className="font-semibold text-foreground">Add Vendor</span> to enter one manually.
 </div>
 )}

 {vendors.map((v) => {
 const isSelected = v.id === selectedId;
 const vScore = v.scores ? weightedScore(v.scores) : null;
 const vScored = v.scores && CRITERIA.every((c) => v.scores![c.id] !== undefined);
 return (
 <div
 key={v.id}
 className={`rounded-xl p-3 border transition-all ${
 isSelected ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40"
 }`}
 >
 <div className="flex items-start justify-between gap-2">
 <button onClick={() => setSelectedId(v.id)} className="flex-1 text-left min-w-0">
 <div className="flex items-center gap-2 flex-wrap">
 <p className="text-sm font-semibold text-foreground truncate">{v.name}</p>
 {vScored && (
 <span
 className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded"
 style={{
 background:
 vScore! >= 60 ? "hsl(var(--success) / 0.15)" : "hsl(var(--destructive) / 0.15)",
 color: vScore! >= 60 ? "hsl(var(--success))" : "hsl(var(--destructive))",
 }}
 >
 {vScore}%
 </span>
 )}
 {isSelected && (
 <span className="text-[10px] font-mono uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
 Selected
 </span>
 )}
 </div>
 {v.description && (
 <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{v.description}</p>
 )}
 <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground flex-wrap">
 {v.contact && (
 <span className="inline-flex items-center gap-1"><Phone size={10} /> {v.contact}</span>
 )}
 {v.website && (
 <span className="inline-flex items-center gap-1"><Globe size={10} /> {v.website}</span>
 )}
 {v.pricing && (
 <span className="inline-flex items-center gap-1"><IndianRupee size={10} /> {v.pricing}</span>
 )}
 </div>
 </button>
 <div className="flex items-center gap-1 flex-shrink-0">
 <button
 onClick={() => startEditVendor(v)}
 className="p-1 rounded hover:bg-card text-muted-foreground hover:text-foreground"
 title="Edit"
 >
 <Pencil size={12} />
 </button>
 <button
 onClick={() => deleteVendor(v.id)}
 className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
 title="Delete"
 >
 <Trash2 size={12} />
 </button>
 </div>
 </div>
 </div>
 );
 })}

 {showAddForm && (
 <div className="rounded-xl p-3 border border-primary/40 bg-primary/5 space-y-2">
 <div className="flex items-center justify-between">
 <p className="text-xs font-semibold text-foreground">
 {editingId ? "Edit Vendor" : "Add Vendor"}
 </p>
 <button
 onClick={() => { setShowAddForm(false); setEditingId(null); setDraft({ id: "", name: "" }); }}
 className="p-1 rounded hover:bg-card text-muted-foreground"
 >
 <X size={12} />
 </button>
 </div>
 <div>
 <label className="text-[11px] font-semibold text-foreground block mb-1">Vendor / Solution Name *</label>
 <input
 value={draft.name}
 onChange={(e) => setDraft({ ...draft, name: e.target.value })}
 placeholder="e.g. Acme ERP Solution"
 className="w-full text-sm border border-border rounded-lg px-3 py-1.5 bg-card outline-none focus:ring-1 focus:ring-primary"
 />
 </div>
 <div>
 <label className="text-[11px] font-semibold text-foreground block mb-1">Description</label>
 <AutoTextarea
 value={draft.description ?? ""}
 onChange={(e) => setDraft({ ...draft, description: e.target.value })}
 minRows={2}
 placeholder="What the vendor offers, key strengths, modules covered…"
 className="w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-card outline-none focus:ring-1 focus:ring-primary"
 />
 </div>
 <div className="grid grid-cols-2 gap-2">
 <div>
 <label className="text-[11px] font-semibold text-foreground block mb-1">Contact</label>
 <input
 value={draft.contact ?? ""}
 onChange={(e) => setDraft({ ...draft, contact: e.target.value })}
 placeholder="Name / email / phone"
 className="w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-card outline-none focus:ring-1 focus:ring-primary"
 />
 </div>
 <div>
 <label className="text-[11px] font-semibold text-foreground block mb-1">Website</label>
 <input
 value={draft.website ?? ""}
 onChange={(e) => setDraft({ ...draft, website: e.target.value })}
 placeholder="acme.com"
 className="w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-card outline-none focus:ring-1 focus:ring-primary"
 />
 </div>
 </div>
 <div>
 <label className="text-[11px] font-semibold text-foreground block mb-1">Indicative Pricing</label>
 <input
 value={draft.pricing ?? ""}
 onChange={(e) => setDraft({ ...draft, pricing: e.target.value })}
 placeholder="e.g. ₹45L CapEx + ₹8L/yr AMC"
 className="w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-card outline-none focus:ring-1 focus:ring-primary"
 />
 </div>
 <div>
 <label className="text-[11px] font-semibold text-foreground block mb-1">Internal Notes</label>
 <AutoTextarea
 value={draft.notes ?? ""}
 onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
 minRows={2}
 placeholder="References, demo feedback, risks, anything to remember"
 className="w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-card outline-none focus:ring-1 focus:ring-primary"
 />
 </div>
 <div className="flex items-center gap-2 pt-1">
 <button
 onClick={saveDraft}
 disabled={!draft.name.trim()}
 className="bg-primary hover:bg-primary/90 flex-1 py-1.5 rounded-lg text-xs font-semibold text-primary-foreground disabled:opacity-40"
 >
 {editingId ? "Save Changes" : "Add Vendor"}
 </button>
 <button
 onClick={() => { setShowAddForm(false); setEditingId(null); setDraft({ id: "", name: "" }); }}
 className="px-3 py-1.5 rounded-lg text-xs font-semibold text-muted-foreground border border-border hover:bg-card"
 >
 Cancel
 </button>
 </div>
 </div>
 )}
 </div>

 {/* Scorecard for selected vendor */}
 {selected && (
 <div className="space-y-3 pt-3 border-t border-border">
 <div className="flex items-center justify-between">
 <p className="text-xs font-semibold text-foreground">
 Scoring: <span className="text-primary">{selected.name}</span>
 </p>
 <AiButton
 label="AI Score Vendor"
 endpoint="/api/ai/vendors/score"
 payload={{ projectId, vendorName: selected.name, vendorNotes: selected.notes ?? selected.description ?? "" }}
 size="sm"
 variant="subtle"
 onResult={(d) => {
 const r = d as AiScoreResult;
 setAiResult(r);
 setDraftScores({ functional: r.functional, technical: r.technical, commercial: r.commercial, track_record: r.track_record });
 toast({ title: "AI scores applied — review and click Save Scorecard" });
 }}
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
 (selectedScores[c.id] ?? 0) >= 70
 ? "hsl(var(--success) / 0.15)"
 : (selectedScores[c.id] ?? 0) >= 50
 ? "hsl(var(--warn) / 0.15)"
 : "hsl(var(--destructive) / 0.15)",
 color:
 (selectedScores[c.id] ?? 0) >= 70
 ? "hsl(var(--success))"
 : (selectedScores[c.id] ?? 0) >= 50
 ? "hsl(var(--warn))"
 : "hsl(var(--destructive))",
 }}
 >
 {selectedScores[c.id] !== undefined ? `${selectedScores[c.id]}/100` : "—"}
 </span>
 </div>
 <input
 type="range"
 min={0}
 max={100}
 step={5}
 value={selectedScores[c.id] ?? 0}
 onChange={(e) => setSelectedScore(c.id, Number(e.target.value))}
 className="w-full h-2 rounded-full appearance-none cursor-pointer"
 style={{ accentColor: "hsl(var(--warn))" }}
 />
 </div>
 ))}
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
 onClick={saveScorecard}
 disabled={!allScored || !scoresDirty || updateStage.isPending}
 className="bg-primary hover:bg-primary/90 flex-1 py-2 rounded-xl text-sm font-semibold text-primary-foreground transition-all disabled:opacity-40"
 >
 {scoresDirty ? "Save Scorecard" : "Saved"}
 </button>
 {selected.scoredAt && (
 <span className="text-xs text-warn flex items-center gap-1">
 <CheckCircle2 size={11} />
 Saved {new Date(selected.scoredAt).toLocaleDateString()}
 </span>
 )}
 </div>
 </div>
 )}
 </div>
 );
}
