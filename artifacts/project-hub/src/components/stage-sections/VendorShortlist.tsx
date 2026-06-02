import { useState, useMemo, useEffect } from "react";
import { useListProjectStages, useUpdateProjectStage } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Pencil, X, Globe, Phone, IndianRupee, Sparkles, Building2 } from "lucide-react";
import { AiButton } from "../ai-button";
import { AutoTextarea } from "../ui/auto-textarea";
import { api } from "../../lib/extra-api";

export type Vendor = {
 id: string;
 name: string;
 description?: string;
 contact?: string;
 website?: string;
 pricing?: string;
 notes?: string;
 /**
  * Pointer into pmo_vendor_master. Set when this row was picked from the
  * vendor master (post-2026-05). Legacy rows have this null until the
  * migrate-vendor-json-to-master.ts script backfills them.
  */
 masterVendorId?: number;
};

type VendorMasterRow = {
 id: number;
 name: string;
 segment: string;
 riskStatus: string;
 category: string | null;
 region: string | null;
 email: string | null;
};

function newId() {
 return `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

type AiSuggestedVendor = {
 name: string;
 description?: string;
 contact?: string;
 website?: string;
 pricing?: string;
 notes?: string;
};

export function VendorShortlist({ projectId }: { projectId: number }) {
 const { data: stages = [] } = useListProjectStages(projectId);
 const updateStage = useUpdateProjectStage();
 const queryClient = useQueryClient();
 const { toast } = useToast();

 const rfpRecord = (
 stages as Array<{ id: number; stage: string; notes?: string | null }>
 ).find((s) => s.stage === "vendor_selection");

 const parsedNotes: Record<string, unknown> = useMemo(() => {
 try { return JSON.parse(rfpRecord?.notes ?? "{}"); }
 catch { return {}; }
 }, [rfpRecord?.notes]);

 const vendors: Vendor[] = useMemo(() => {
 const list = parsedNotes.__vendors as Vendor[] | undefined;
 return Array.isArray(list) ? list : [];
 }, [parsedNotes]);

 const [showAddForm, setShowAddForm] = useState(false);
 const [editingId, setEditingId] = useState<string | null>(null);
 const [draft, setDraft] = useState<Vendor>({ id: "", name: "" });
 const [showPicker, setShowPicker] = useState(false);
 const [masterRows, setMasterRows] = useState<VendorMasterRow[]>([]);
 const [pickerSearch, setPickerSearch] = useState("");

 useEffect(() => {
  if (!showPicker) return;
  api.get<VendorMasterRow[]>("/api/vendors").then(setMasterRows).catch(() => {
   toast({ title: "Could not load vendor master", variant: "destructive" });
  });
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [showPicker]);

 function persist(next: Vendor[], successMsg?: string) {
 if (!rfpRecord?.id) {
 toast({ title: "Initialise the RFP stage first", variant: "destructive" });
 return;
 }
 updateStage.mutate(
 {
 id: rfpRecord.id,
 data: { notes: JSON.stringify({ ...parsedNotes, __vendors: next }) },
 },
 {
 onSuccess: () => {
 void queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/stages`] });
 if (successMsg) toast({ title: successMsg });
 },
 onError: () => toast({ title: "Failed to save vendors", variant: "destructive" }),
 },
 );
 }

 function startAdd() {
 setDraft({ id: newId(), name: "" });
 setEditingId(null);
 setShowAddForm(true);
 }
 function startEdit(v: Vendor) {
 setDraft({ ...v });
 setEditingId(v.id);
 setShowAddForm(true);
 }
 function cancelForm() {
 setShowAddForm(false);
 setEditingId(null);
 setDraft({ id: "", name: "" });
 }
 function saveDraft() {
 if (!draft.name.trim()) {
 toast({ title: "Vendor name is required", variant: "destructive" });
 return;
 }
 const next = editingId
 ? vendors.map((v) => (v.id === editingId ? { ...v, ...draft } : v))
 : [...vendors, draft];
 persist(next, editingId ? "Vendor updated" : "Vendor added");
 cancelForm();
 }
 function deleteVendor(id: string) {
 persist(vendors.filter((v) => v.id !== id), "Vendor removed");
 }

 return (
 <div className="rounded-2xl p-4 space-y-3 border border-border bg-card/40">
 <div>
 <p className="text-sm font-bold text-foreground">Vendor Shortlist</p>
 <p className="text-xs text-muted-foreground mt-0.5">
 Add the vendors who received this RFP. They will appear automatically in the Vendor
 Evaluation stage for scoring.
 </p>
 </div>

 <div className="flex items-center justify-between">
 <p className="text-xs font-semibold text-foreground">Vendors ({vendors.length})</p>
 <div className="flex items-center gap-2">
 <AiButton
 label="AI Suggest Vendors"
 endpoint="/api/ai/vendors/suggest-list"
 payload={{ projectId }}
 size="sm"
 variant="subtle"
 onResult={(d) => {
 const suggestions = (d as { vendors?: AiSuggestedVendor[] }).vendors ?? [];
 if (suggestions.length === 0) {
 toast({ title: "AI returned no suggestions", variant: "destructive" });
 return;
 }
 const added: Vendor[] = suggestions.map((s) => ({
 id: newId(),
 name: s.name,
 description: s.description,
 contact: s.contact,
 website: s.website,
 pricing: s.pricing,
 notes: s.notes,
 }));
 persist([...vendors, ...added], `Added ${added.length} sample vendors`);
 }}
 />
 {!showAddForm && (
 <button
 onClick={() => setShowPicker(true)}
 className="text-xs font-semibold text-primary inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-border hover:bg-card"
 title="Pick from the vendor master — pre-qualified suppliers"
 >
 <Building2 size={12} /> Pick from master
 </button>
 )}
 {!showAddForm && (
 <button
 onClick={startAdd}
 className="text-xs font-semibold text-primary inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-border hover:bg-card"
 >
 <Plus size={12} /> Add Vendor
 </button>
 )}
 </div>
 </div>

 {vendors.length === 0 && !showAddForm && (
 <div className="rounded-xl p-4 border border-dashed border-border text-center text-xs text-muted-foreground">
 No vendors yet. Click <span className="font-semibold text-foreground">Add Vendor</span> to
 enter one manually, or <span className="font-semibold text-foreground">AI Suggest Vendors</span>{" "}
 <Sparkles size={10} className="inline" /> to fill sample vendors for testing.
 </div>
 )}

 <div className="space-y-2">
 {vendors.map((v) => (
 <div key={v.id} className="rounded-xl p-3 border border-border bg-card">
 <div className="flex items-start justify-between gap-2">
 <div className="flex-1 min-w-0">
 <p className="text-sm font-semibold text-foreground truncate">{v.name}</p>
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
 </div>
 <div className="flex items-center gap-1 flex-shrink-0">
 <button
 onClick={() => startEdit(v)}
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
 ))}

 {showAddForm && (
 <div className="rounded-xl p-3 border border-primary/40 bg-primary/5 space-y-2">
 <div className="flex items-center justify-between">
 <p className="text-xs font-semibold text-foreground">
 {editingId ? "Edit Vendor" : "Add Vendor"}
 </p>
 <button onClick={cancelForm} className="p-1 rounded hover:bg-card text-muted-foreground">
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
 onClick={cancelForm}
 className="px-3 py-1.5 rounded-lg text-xs font-semibold text-muted-foreground border border-border hover:bg-card"
 >
 Cancel
 </button>
 </div>
 </div>
 )}
 </div>

 {showPicker && (
 <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setShowPicker(false)}>
 <div className="bg-background rounded-2xl shadow-xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
 <div className="p-4 border-b border-border flex items-center justify-between">
 <div>
 <p className="text-sm font-bold">Pick from vendor master</p>
 <p className="text-xs text-muted-foreground mt-0.5">Pre-qualified suppliers across all charters. Blocked vendors are hidden.</p>
 </div>
 <button onClick={() => setShowPicker(false)} className="p-1 rounded hover:bg-card text-muted-foreground"><X size={14} /></button>
 </div>
 <div className="p-3 border-b border-border">
 <input
 value={pickerSearch}
 onChange={(e) => setPickerSearch(e.target.value)}
 placeholder="Search by name / category / region"
 className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-card outline-none focus:ring-1 focus:ring-primary"
 />
 </div>
 <div className="flex-1 overflow-y-auto p-3 space-y-1">
 {masterRows.filter(r => r.segment !== "blocked" && (
 !pickerSearch.trim() || [r.name, r.category, r.region].some(x => x?.toLowerCase().includes(pickerSearch.toLowerCase()))
 )).map(r => {
 const already = vendors.some(v => v.masterVendorId === r.id);
 return (
 <button
 key={r.id}
 disabled={already}
 onClick={() => {
 const next: Vendor = {
 id: newId(),
 name: r.name,
 description: r.category || undefined,
 contact: r.email || undefined,
 masterVendorId: r.id,
 };
 persist([...vendors, next], `Added ${r.name} from master`);
 setShowPicker(false);
 }}
 className={`w-full text-left rounded-lg p-2.5 border border-border ${already ? "opacity-40 cursor-not-allowed" : "hover:border-primary/40 hover:bg-card"}`}
 >
 <div className="flex items-center justify-between gap-2">
 <span className="text-sm font-semibold">{r.name}</span>
 <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{r.segment}</span>
 </div>
 <p className="text-[11px] text-muted-foreground">
 {[r.category, r.region].filter(Boolean).join(" • ")}
 {already ? " • already added" : ""}
 </p>
 </button>
 );
 })}
 {masterRows.length === 0 && <p className="text-xs text-muted-foreground text-center p-4">No vendors in master. Register one at /vendors first.</p>}
 </div>
 </div>
 </div>
 )}
 </div>
 );
}
