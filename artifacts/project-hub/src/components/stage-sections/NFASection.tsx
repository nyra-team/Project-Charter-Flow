import { useEffect, useState } from "react";
import { useListProjectStages, useUpdateProjectStage } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, Clock, Circle } from "lucide-react";
import { AiButton } from "../ai-button";
import { AutoTextarea } from "../ui/auto-textarea";

type NFAApproval = { approver: string; status: "pending" | "approved" | "rejected"; decidedAt?: string; comment?: string };
type NFAPayload = {
 nfaNumber?: string;
 amountRequested?: number;
 noteDraft?: string;
 chain: NFAApproval[];
 savedAt?: string;
};

const DEFAULT_CHAIN: NFAApproval[] = [
 { approver: "Finance Head", status: "pending" },
 { approver: "PMO", status: "pending" },
 { approver: "Department Head", status: "pending" },
 { approver: "Chairman / MD", status: "pending" },
];

export function NFASection({ projectId }: { projectId: number }) {
 const { data: stages = [] } = useListProjectStages(projectId);
 const updateStage = useUpdateProjectStage();
 const { toast } = useToast();

 const stageRecord = (stages as Array<{ id: number; stage: string; notes?: string | null }>)
 .find((s) => s.stage === "investment_authorization");
 const parsed: Record<string, unknown> = (() => {
 try { return JSON.parse(stageRecord?.notes ?? "{}"); } catch { return {}; }
 })();
 const saved: NFAPayload = (parsed.__nfa as NFAPayload) ?? { chain: DEFAULT_CHAIN };

 const [nfaNo, setNfaNo] = useState(saved.nfaNumber ?? "");
 const [amount, setAmount] = useState<string>(saved.amountRequested?.toString() ?? "");
 const [noteDraft, setNoteDraft] = useState<string>(saved.noteDraft ?? "");
 const [chain, setChain] = useState<NFAApproval[]>(saved.chain ?? DEFAULT_CHAIN);

 useEffect(() => {
 setNfaNo(saved.nfaNumber ?? "");
 setAmount(saved.amountRequested?.toString() ?? "");
 setNoteDraft(saved.noteDraft ?? "");
 setChain(saved.chain && saved.chain.length > 0 ? saved.chain : DEFAULT_CHAIN);
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [stageRecord?.id]);

 function persist(next: Partial<NFAPayload>) {
 if (!stageRecord?.id) {
 toast({ title: "Initialise the NFA stage first", variant: "destructive" });
 return;
 }
 const payload: NFAPayload = {
 nfaNumber: nfaNo, amountRequested: Number(amount) || 0, noteDraft, chain,
 ...next, savedAt: new Date().toISOString(),
 };
 updateStage.mutate(
 { id: stageRecord.id, data: { notes: JSON.stringify({ ...parsed, __nfa: payload }) } },
 { onError: () => toast({ title: "Failed to save NFA", variant: "destructive" }) },
 );
 }

 function decide(idx: number, status: "approved" | "rejected") {
 const next = chain.map((c, i) => i === idx ? { ...c, status, decidedAt: new Date().toISOString() } : c);
 setChain(next);
 persist({ chain: next });
 }

 const allApproved = chain.every(c => c.status === "approved");
 const anyRejected = chain.some(c => c.status === "rejected");

 return (
 <div className="rounded-2xl p-4 space-y-3">
 <div className="flex items-center justify-between">
 <div>
 <p className="text-sm font-bold text-foreground">NFA — Note for Approval</p>
 <p className="text-[11px] text-warn">FR-11 · multi-level approval gate that unlocks PR + PO release</p>
 </div>
 {allApproved && <span className="text-[10px] font-mono font-semibold text-success bg-success/10 rounded-full px-2 py-0.5">✓ FULLY APPROVED</span>}
 {anyRejected && <span className="text-[10px] font-mono font-semibold text-destructive bg-destructive/10 rounded-full px-2 py-0.5">✗ REJECTED</span>}
 <AiButton
 label="AI Draft NFA Note"
 endpoint="/api/ai/nfa/draft"
 payload={{ projectId, amount: Number(amount) || 0 }}
 size="sm"
 variant="subtle"
 onResult={(d) => {
 const r = d as { executiveSummary: string; businessJustification: string; financialImpact: string; riskAndMitigation: string };
 const next = `EXECUTIVE SUMMARY\n${r.executiveSummary}\n\nBUSINESS JUSTIFICATION\n${r.businessJustification}\n\nFINANCIAL IMPACT\n${r.financialImpact}\n\nRISK & MITIGATION\n${r.riskAndMitigation}`;
 setNoteDraft(next);
 toast({ title: "AI NFA note drafted — review and click outside the box to save" });
 }}
 />
 </div>

 {/* Once the e-NFA is created (a saved NFA number), surface that the RFP is
     being auto-generated for the downstream vendor-selection stage. */}
 {saved.nfaNumber?.trim() && (
 <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-[11px] font-medium text-primary">
 <span className="relative inline-flex h-2 w-2 shrink-0">
 <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
 <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
 </span>
 <span><b>e-NFA created</b> — an RFP is being automatically generated for vendor selection.</span>
 </div>
 )}

 <div className="grid grid-cols-2 gap-2">
 <div>
 <label className="text-[11px] font-semibold text-foreground block mb-1">NFA Number</label>
 <input
 value={nfaNo} onChange={(e) => setNfaNo(e.target.value)} onBlur={() => persist({})}
 placeholder="NFA-2026-001"
 className="w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-card focus:outline-none focus:ring-1 focus:ring-warn font-mono"
 />
 </div>
 <div>
 <label className="text-[11px] font-semibold text-foreground block mb-1">Amount Requested (₹)</label>
 <input
 type="number" value={amount} onChange={(e) => setAmount(e.target.value)} onBlur={() => persist({})}
 placeholder="0"
 className="w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-card focus:outline-none focus:ring-1 focus:ring-warn font-mono"
 />
 </div>
 </div>

 <div>
 <label className="text-[11px] font-semibold text-foreground block mb-1">NFA Note (justification, financial impact, risks)</label>
 <AutoTextarea
 value={noteDraft}
 onChange={(e) => setNoteDraft(e.target.value)}
 onBlur={() => persist({})}
 minRows={6}
 placeholder="Use AI Draft NFA Note above to auto-fill, or write your own…"
 className="w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-card focus:outline-none focus:ring-1 focus:ring-warn font-mono whitespace-pre-wrap"
 />
 </div>

 <div className="space-y-2">
 <p className="text-[10px] font-mono uppercase tracking-wider font-semibold text-foreground">Approval Chain</p>
 {chain.map((c, i) => {
 const Icon = c.status === "approved" ? CheckCircle2 : c.status === "rejected" ? Clock : Circle;
 const iconCls = c.status === "approved" ? "text-success" : c.status === "rejected" ? "text-destructive" : "text-muted-foreground";
 return (
 <div key={i} className="flex items-center gap-3 bg-card rounded-lg px-3 py-2 border border-border">
 <Icon size={16} className={`flex-shrink-0 ${iconCls}`} />
 <div className="flex-1 min-w-0">
 <p className="text-xs font-semibold text-muted-foreground">{c.approver}</p>
 {c.decidedAt && (
 <p className="text-[10px] text-muted-foreground font-mono">
 {c.status === "approved" ? "Approved" : "Rejected"} {new Date(c.decidedAt).toLocaleDateString()}
 </p>
 )}
 </div>
 {c.status === "pending" && (
 <div className="flex gap-1">
 <button
 onClick={() => decide(i, "approved")}
 disabled={updateStage.isPending}
 className="text-[10px] font-semibold text-primary-foreground px-2 py-1 rounded bg-success hover:bg-success disabled:opacity-40"
 >Approve</button>
 <button
 onClick={() => decide(i, "rejected")}
 disabled={updateStage.isPending}
 className="text-[10px] font-semibold text-primary-foreground px-2 py-1 rounded bg-destructive hover:bg-destructive disabled:opacity-40"
 >Reject</button>
 </div>
 )}
 </div>
 );
 })}
 </div>
 </div>
 );
}
