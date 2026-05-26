import { useEffect, useState } from "react";
import { useListProjectStages, useUpdateProjectStage } from "@workspace/api-client-react";
import { useUserStore } from "../../lib/store";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, AlertCircle, Scale } from "lucide-react";
import { AutoTextarea } from "../ui/auto-textarea";

type LegalPayload = {
 contractNumber?: string;
 vendorName?: string;
 contractValue?: number;
 complianceNotes?: string;
 ndaSigned?: boolean;
 legalReviewer?: string;
 legalApproved?: boolean;
 legalApprovedAt?: string;
 savedAt?: string;
};

export function LegalSection({ projectId }: { projectId: number }) {
 const { data: stages = [] } = useListProjectStages(projectId);
 const updateStage = useUpdateProjectStage();
 const { role } = useUserStore();
 const { toast } = useToast();

 const stageRecord = (stages as Array<{ id: number; stage: string; notes?: string | null }>)
 .find((s) => s.stage === "legal");
 const parsed: Record<string, unknown> = (() => {
 try { return JSON.parse(stageRecord?.notes ?? "{}"); } catch { return {}; }
 })();
 const saved: LegalPayload = (parsed.__legal as LegalPayload) ?? {};

 const [contractNo, setContractNo] = useState(saved.contractNumber ?? "");
 const [vendor, setVendor] = useState(saved.vendorName ?? "");
 const [value, setValue] = useState<string>(saved.contractValue?.toString() ?? "");
 const [notes, setNotes] = useState(saved.complianceNotes ?? "");
 const [nda, setNda] = useState(!!saved.ndaSigned);
 const [reviewer, setReviewer] = useState(saved.legalReviewer ?? "");

 useEffect(() => {
 setContractNo(saved.contractNumber ?? "");
 setVendor(saved.vendorName ?? "");
 setValue(saved.contractValue?.toString() ?? "");
 setNotes(saved.complianceNotes ?? "");
 setNda(!!saved.ndaSigned);
 setReviewer(saved.legalReviewer ?? "");
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [stageRecord?.id]);

 const contractOk = contractNo.length > 0 && vendor.length > 0;
 const reviewOk = notes.length >= 30;
 const canApprove = role === "legal" || role === "pmo" || role === "hod";

 function persist(extra: Partial<LegalPayload> = {}) {
 if (!stageRecord?.id) {
 toast({ title: "Initialise the Legal stage first", variant: "destructive" });
 return;
 }
 const payload: LegalPayload = {
 contractNumber: contractNo, vendorName: vendor,
 contractValue: Number(value) || 0, complianceNotes: notes,
 ndaSigned: nda, legalReviewer: reviewer,
 legalApproved: saved.legalApproved, legalApprovedAt: saved.legalApprovedAt,
 ...extra, savedAt: new Date().toISOString(),
 };
 updateStage.mutate(
 { id: stageRecord.id, data: { notes: JSON.stringify({ ...parsed, __legal: payload }) } },
 {
 onSuccess: () => toast({ title: "Legal review saved" }),
 onError: () => toast({ title: "Failed to save Legal review", variant: "destructive" }),
 },
 );
 }

 function approveLegal() {
 if (!canApprove) {
 toast({ title: "Requires Legal / PMO / HOD role", variant: "destructive" });
 return;
 }
 persist({ legalApproved: true, legalApprovedAt: new Date().toISOString() });
 }
 function revokeLegal() {
 persist({ legalApproved: false, legalApprovedAt: undefined });
 }

 return (
 <div className="rounded-2xl p-4 space-y-3">
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-2">
 <Scale size={16} className="text-primary" />
 <div>
 <p className="text-sm font-bold text-foreground">Legal & Documentation Review</p>
 <p className="text-[11px] text-primary">FR-12 · vendor contract review, NDA and statutory sign-off</p>
 </div>
 </div>
 {saved.savedAt && (
 <span className="text-[10px] font-mono text-primary bg-primary/10 rounded-full px-2 py-0.5">
 Saved {new Date(saved.savedAt).toLocaleDateString()}
 </span>
 )}
 </div>

 <div className="grid grid-cols-3 gap-2">
 <div>
 <label className="text-[11px] font-semibold text-foreground block mb-1">Contract / Agreement No.</label>
 <input value={contractNo} onChange={(e) => setContractNo(e.target.value)} placeholder="e.g. GRA-VC-2026-012"
 className="w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-card focus:outline-none focus:ring-1 focus:ring-primary font-mono" />
 </div>
 <div>
 <label className="text-[11px] font-semibold text-foreground block mb-1">Vendor</label>
 <input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Vendor legal entity"
 className="w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-card focus:outline-none focus:ring-1 focus:ring-primary" />
 </div>
 <div>
 <label className="text-[11px] font-semibold text-foreground block mb-1">Contract Value (₹)</label>
 <input type="number" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0"
 className="w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-card focus:outline-none focus:ring-1 focus:ring-primary font-mono" />
 </div>
 </div>

 <div>
 <div className="flex items-center justify-between mb-1">
 <label className="text-[11px] font-semibold text-foreground">Legal Review & Compliance Notes</label>
 <span className={`text-[10px] font-mono inline-flex items-center gap-1 ${reviewOk ? "text-success" : "text-warn"}`}>
 {reviewOk ? <CheckCircle2 size={10} /> : <AlertCircle size={10} />} {notes.length}/30
 </span>
 </div>
 <AutoTextarea value={notes} onChange={(e) => setNotes(e.target.value)} minRows={3}
 placeholder="Statutory compliance findings, contract terms reviewed, risk flags, indemnity clauses…"
 className="w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-card focus:outline-none focus:ring-1 focus:ring-primary" />
 </div>

 <div className="grid grid-cols-2 gap-2 items-center">
 <div>
 <label className="text-[11px] font-semibold text-foreground block mb-1">Legal Reviewer</label>
 <input value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="Name / role"
 className="w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-card focus:outline-none focus:ring-1 focus:ring-primary" />
 </div>
 <label className="flex items-center gap-2 mt-4 text-[12px] text-foreground cursor-pointer">
 <input type="checkbox" checked={nda} onChange={(e) => setNda(e.target.checked)} className="accent-violet-600" />
 NDA executed (if applicable)
 </label>
 </div>

 <div className="flex items-center justify-between pt-2 border-t border-border">
 <div className="text-[11px] text-foreground space-x-2">
 <span className={`text-[10px] font-mono inline-flex items-center gap-1 ${contractOk ? "text-success" : "text-warn"}`}>
 {contractOk ? <CheckCircle2 size={10} /> : <AlertCircle size={10} />} Contract
 </span>
 <span className="opacity-30">·</span>
 <span className={`text-[10px] font-mono inline-flex items-center gap-1 ${reviewOk ? "text-success" : "text-warn"}`}>
 {reviewOk ? <CheckCircle2 size={10} /> : <AlertCircle size={10} />} Review
 </span>
 <span className="opacity-30">·</span>
 <span className={`text-[10px] font-mono inline-flex items-center gap-1 ${saved.legalApproved ? "text-success" : "text-warn"}`}>
 {saved.legalApproved ? <CheckCircle2 size={10} /> : <AlertCircle size={10} />} Sign-off
 </span>
 </div>
 <div className="flex items-center gap-2">
 <button onClick={() => persist()} disabled={updateStage.isPending}
 className="text-xs font-semibold text-primary border border-border px-3 py-1.5 rounded-lg disabled:opacity-40 bg-card">
 {updateStage.isPending ? "Saving…" : "Save Review"}
 </button>
 {saved.legalApproved ? (
 canApprove && (
 <button onClick={revokeLegal} className="text-xs font-semibold text-destructive underline">Revoke sign-off</button>
 )
 ) : (
 <button onClick={approveLegal} disabled={!canApprove || !contractOk || !reviewOk}
 className="bg-primary hover:bg-primary/90 text-xs font-semibold text-primary-foreground px-3 py-1.5 rounded-lg disabled:opacity-40">
 {canApprove ? "Sign Off Legal Review" : "Requires Legal / PMO role"}
 </button>
 )}
 </div>
 </div>

 {saved.legalApproved && (
 <div className="rounded-xl p-2 text-center">
 <p className="text-xs font-bold text-success">
 ✓ Legal sign-off received{saved.legalApprovedAt ? ` on ${new Date(saved.legalApprovedAt).toLocaleDateString()}` : ""} — PR/PO may be initiated
 </p>
 </div>
 )}
 </div>
 );
}
