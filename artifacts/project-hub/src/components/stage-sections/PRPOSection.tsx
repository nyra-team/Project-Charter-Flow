import { useEffect, useState } from "react";
import { useListProjectStages, useUpdateProjectStage } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, AlertCircle, Lock } from "lucide-react";

type PRPOPayload = {
 prNumber?: string;
 poNumber?: string;
 vendorName?: string;
 poAmount?: number;
 prDate?: string;
 poDate?: string;
 savedAt?: string;
};

export function PRPOSection({ projectId }: { projectId: number }) {
 const { data: stages = [] } = useListProjectStages(projectId);
 const updateStage = useUpdateProjectStage();
 const { toast } = useToast();

 const allStages = stages as Array<{ id: number; stage: string; status: string; notes?: string | null }>;
 const stageRecord = allStages.find((s) => s.stage === "pr_po");
 const nfaRecord = allStages.find((s) => s.stage === "legal");

 // Read Legal sign-off state (Legal is now the immediate hard gate before PR/PO)
 const nfaApproved = (() => {
 if (nfaRecord?.status === "complete") return true;
 try {
 const np = JSON.parse(nfaRecord?.notes ?? "{}") as Record<string, unknown>;
 const legal = np.__legal as { legalApproved?: boolean } | undefined;
 return !!legal?.legalApproved;
 } catch { return false; }
 })();

 const parsed: Record<string, unknown> = (() => {
 try { return JSON.parse(stageRecord?.notes ?? "{}"); } catch { return {}; }
 })();
 const saved: PRPOPayload = (parsed.__pr_po as PRPOPayload) ?? {};

 const [pr, setPr] = useState(saved.prNumber ?? "");
 const [po, setPo] = useState(saved.poNumber ?? "");
 const [vendor, setVendor] = useState(saved.vendorName ?? "");
 const [amount, setAmount] = useState<string>(saved.poAmount?.toString() ?? "");
 const [prDate, setPrDate] = useState(saved.prDate ?? "");
 const [poDate, setPoDate] = useState(saved.poDate ?? "");

 useEffect(() => {
 setPr(saved.prNumber ?? ""); setPo(saved.poNumber ?? "");
 setVendor(saved.vendorName ?? ""); setAmount(saved.poAmount?.toString() ?? "");
 setPrDate(saved.prDate ?? ""); setPoDate(saved.poDate ?? "");
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [stageRecord?.id]);

 function save() {
 if (!stageRecord?.id) {
 toast({ title: "Initialise the PR + PO stage first", variant: "destructive" });
 return;
 }
 const payload: PRPOPayload = {
 prNumber: pr, poNumber: po, vendorName: vendor,
 poAmount: Number(amount) || 0, prDate, poDate, savedAt: new Date().toISOString(),
 };
 updateStage.mutate(
 { id: stageRecord.id, data: { notes: JSON.stringify({ ...parsed, __pr_po: payload }) } },
 {
 onSuccess: () => toast({ title: "PR / PO details saved" }),
 onError: () => toast({ title: "Failed to save PR / PO", variant: "destructive" }),
 },
 );
 }

 return (
 <div className="rounded-2xl p-4 space-y-3">
 <div className="flex items-center justify-between">
 <div>
 <p className="text-sm font-bold text-foreground">PR + PO Release</p>
 <p className="text-[11px] text-destructive">FR-13 · Legal sign-off is a hard gate before releasing PO</p>
 </div>
 {saved.savedAt && (
 <span className="text-[10px] font-mono text-destructive bg-destructive/10 rounded-full px-2 py-0.5">
 Saved {new Date(saved.savedAt).toLocaleDateString()}
 </span>
 )}
 </div>

 {/* NFA gate banner */}
 <div className={`rounded-lg px-3 py-2 flex items-center gap-2 border ${nfaApproved ? "bg-card border-border" : "bg-card border-border"}`}>
 {nfaApproved ? <CheckCircle2 size={14} className="text-success" /> : <Lock size={14} className="text-warn" />}
 <span className={`text-xs font-semibold ${nfaApproved ? "text-foreground" : "text-foreground"}`}>
 Legal Gate: {nfaApproved ? "Signed off — PO release permitted" : "Pending — complete Legal sign-off to release PO"}
 </span>
 </div>

 <div className="grid grid-cols-2 gap-2">
 <div>
 <label className="text-[11px] font-semibold text-foreground block mb-1">PR Number</label>
 <input value={pr} onChange={(e) => setPr(e.target.value)} placeholder="PR-2026-001"
 className="w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-card focus:outline-none focus:ring-1 focus:ring-destructive font-mono" />
 </div>
 <div>
 <label className="text-[11px] font-semibold text-foreground block mb-1">PR Date</label>
 <input type="date" value={prDate} onChange={(e) => setPrDate(e.target.value)}
 className="w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-card focus:outline-none focus:ring-1 focus:ring-destructive font-mono" />
 </div>
 <div>
 <label className="text-[11px] font-semibold text-foreground block mb-1">PO Number</label>
 <input value={po} onChange={(e) => setPo(e.target.value)} placeholder="PO-2026-001"
 disabled={!nfaApproved}
 className="w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-card focus:outline-none focus:ring-1 focus:ring-destructive font-mono disabled:bg-muted/40 disabled:cursor-not-allowed" />
 </div>
 <div>
 <label className="text-[11px] font-semibold text-foreground block mb-1">PO Date</label>
 <input type="date" value={poDate} onChange={(e) => setPoDate(e.target.value)}
 disabled={!nfaApproved}
 className="w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-card focus:outline-none focus:ring-1 focus:ring-destructive font-mono disabled:bg-muted/40 disabled:cursor-not-allowed" />
 </div>
 <div>
 <label className="text-[11px] font-semibold text-foreground block mb-1">Vendor</label>
 <input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Selected vendor name"
 className="w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-card focus:outline-none focus:ring-1 focus:ring-destructive" />
 </div>
 <div>
 <label className="text-[11px] font-semibold text-foreground block mb-1">PO Amount (₹)</label>
 <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0"
 className="w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-card focus:outline-none focus:ring-1 focus:ring-destructive font-mono" />
 </div>
 </div>

 <div className="flex items-center justify-between pt-2 border-t border-border">
 <span className={`text-[11px] font-mono inline-flex items-center gap-1 ${pr && po ? "text-success" : "text-warn"}`}>
 {pr && po ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}
 {pr && po ? "PR & PO both recorded" : "PR + PO required to complete stage"}
 </span>
 <button onClick={save} disabled={updateStage.isPending}
 className="bg-primary hover:bg-primary/90 text-xs font-semibold text-primary-foreground px-3 py-1.5 rounded-lg disabled:opacity-40">
 {updateStage.isPending ? "Saving…" : "Save PR / PO"}
 </button>
 </div>
 </div>
 );
}
