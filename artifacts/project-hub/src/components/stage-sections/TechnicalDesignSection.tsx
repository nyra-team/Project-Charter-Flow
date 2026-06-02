import { useEffect, useState } from "react";
import { useListProjectStages, useUpdateProjectStage } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, AlertCircle } from "lucide-react";
import { AutoTextarea } from "../ui/auto-textarea";

type TDPayload = {
 architectureSummary?: string;
 integrations?: string;
 securityReview?: string;
 techLeadApproved?: boolean;
 techLeadName?: string;
 businessApproved?: boolean;
 businessName?: string;
 savedAt?: string;
};

export function TechnicalDesignSection({ projectId }: { projectId: number }) {
 const { data: stages = [] } = useListProjectStages(projectId);
 const updateStage = useUpdateProjectStage();
 const { toast } = useToast();

 const stageRecord = (stages as Array<{ id: number; stage: string; notes?: string | null }>)
 .find((s) => s.stage === "design");
 const parsed: Record<string, unknown> = (() => {
 try { return JSON.parse(stageRecord?.notes ?? "{}"); } catch { return {}; }
 })();
 const saved: TDPayload = (parsed.__technical_design as TDPayload) ?? {};

 const [arch, setArch] = useState(saved.architectureSummary ?? "");
 const [integ, setInteg] = useState(saved.integrations ?? "");
 const [sec, setSec] = useState(saved.securityReview ?? "");
 const [techApproved, setTechApproved] = useState(saved.techLeadApproved ?? false);
 const [techName, setTechName] = useState(saved.techLeadName ?? "");
 const [bizApproved, setBizApproved] = useState(saved.businessApproved ?? false);
 const [bizName, setBizName] = useState(saved.businessName ?? "");

 useEffect(() => {
 setArch(saved.architectureSummary ?? ""); setInteg(saved.integrations ?? "");
 setSec(saved.securityReview ?? "");
 setTechApproved(saved.techLeadApproved ?? false); setTechName(saved.techLeadName ?? "");
 setBizApproved(saved.businessApproved ?? false); setBizName(saved.businessName ?? "");
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [stageRecord?.id]);

 function persist(next: Partial<TDPayload>) {
 if (!stageRecord?.id) {
 toast({ title: "Initialise the Technical Design stage first", variant: "destructive" });
 return;
 }
 const payload: TDPayload = {
 architectureSummary: arch, integrations: integ, securityReview: sec,
 techLeadApproved: techApproved, techLeadName: techName,
 businessApproved: bizApproved, businessName: bizName,
 ...next, savedAt: new Date().toISOString(),
 };
 updateStage.mutate(
 { id: stageRecord.id, data: { notes: JSON.stringify({ ...parsed, __technical_design: payload }) } },
 { onError: () => toast({ title: "Failed to save", variant: "destructive" }) },
 );
 }

 const fullyApproved = techApproved && bizApproved;

 return (
 <div className="rounded-2xl p-4 space-y-3">
 <div className="flex items-center justify-between">
 <div>
 <p className="text-sm font-bold text-foreground">Technical Design Sign-off</p>
 <p className="text-[11px] text-primary">FR-15 · architecture, integrations and security review with dual sign-off</p>
 </div>
 {fullyApproved && <span className="text-[10px] font-mono font-semibold text-success bg-success/10 rounded-full px-2 py-0.5">✓ DUAL SIGN-OFF</span>}
 </div>

 <div>
 <label className="text-[11px] font-semibold text-foreground block mb-1">Architecture Summary</label>
 <AutoTextarea value={arch} onChange={(e) => setArch(e.target.value)} onBlur={() => persist({})}
 minRows={2} placeholder="High-level architecture, key components, deployment model"
 className="w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-card focus:outline-none focus:ring-1 focus:ring-primary" />
 </div>

 <div className="grid grid-cols-2 gap-2">
 <div>
 <label className="text-[11px] font-semibold text-foreground block mb-1">Integrations</label>
 <AutoTextarea value={integ} onChange={(e) => setInteg(e.target.value)} onBlur={() => persist({})}
 minRows={2} placeholder="ERP, HRMS, SSO, payment gateway…"
 className="w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-card focus:outline-none focus:ring-1 focus:ring-primary" />
 </div>
 <div>
 <label className="text-[11px] font-semibold text-foreground block mb-1">Security Review</label>
 <AutoTextarea value={sec} onChange={(e) => setSec(e.target.value)} onBlur={() => persist({})}
 minRows={2} placeholder="Auth model, data residency, encryption, audit"
 className="w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-card focus:outline-none focus:ring-1 focus:ring-primary" />
 </div>
 </div>

 <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border">
 <div className={`rounded-lg p-2 border ${techApproved ? "bg-card border-border" : "bg-card border-border"}`}>
 <div className="flex items-center justify-between mb-1">
 <span className="text-[11px] font-semibold text-foreground">Tech Lead</span>
 {techApproved ? <CheckCircle2 size={12} className="text-success" /> : <AlertCircle size={12} className="text-warn" />}
 </div>
 <input value={techName} onChange={(e) => setTechName(e.target.value)} onBlur={() => persist({})}
 placeholder="Name" className="w-full text-xs border border-border rounded px-1.5 py-1 mb-1 bg-card" />
 <button onClick={() => { const next = !techApproved; setTechApproved(next); persist({ techLeadApproved: next }); }}
 className={`w-full text-[10px] font-semibold rounded py-1 ${techApproved ? "bg-success text-primary-foreground" : "bg-primary/10 text-foreground hover:bg-primary/10"}`}>
 {techApproved ? "✓ Approved · click to undo" : "Mark approved"}
 </button>
 </div>
 <div className={`rounded-lg p-2 border ${bizApproved ? "bg-card border-border" : "bg-card border-border"}`}>
 <div className="flex items-center justify-between mb-1">
 <span className="text-[11px] font-semibold text-foreground">Business Owner</span>
 {bizApproved ? <CheckCircle2 size={12} className="text-success" /> : <AlertCircle size={12} className="text-warn" />}
 </div>
 <input value={bizName} onChange={(e) => setBizName(e.target.value)} onBlur={() => persist({})}
 placeholder="Name" className="w-full text-xs border border-border rounded px-1.5 py-1 mb-1 bg-card" />
 <button onClick={() => { const next = !bizApproved; setBizApproved(next); persist({ businessApproved: next }); }}
 className={`w-full text-[10px] font-semibold rounded py-1 ${bizApproved ? "bg-success text-primary-foreground" : "bg-primary/10 text-foreground hover:bg-primary/10"}`}>
 {bizApproved ? "✓ Approved · click to undo" : "Mark approved"}
 </button>
 </div>
 </div>
 </div>
 );
}
