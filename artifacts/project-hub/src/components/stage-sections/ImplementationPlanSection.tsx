import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { CheckCircle2, AlertCircle, ArrowRight, Calendar } from "lucide-react";

const linkBtnCls = "flex-1 text-xs font-semibold text-foreground bg-card border border-border rounded-lg py-1.5 px-3 hover:bg-card inline-flex items-center justify-center gap-1 cursor-pointer";

type Milestone = { id: number; name: string; dueDate?: string | null; status: string };
type RaciRow = { id: number; taskId: number; userId: number; raciType: string };

export function ImplementationPlanSection({ projectId }: { projectId: number }) {
 const { data: milestones = [] } = useQuery({
 queryKey: ["/api/projects", projectId, "milestones"],
 queryFn: async () => {
 const r = await fetch(`/api/projects/${projectId}/milestones`);
 return r.ok ? (await r.json() as Milestone[]) : [];
 },
 });

 const { data: raci = [] } = useQuery({
 queryKey: ["/api/projects", projectId, "raci"],
 queryFn: async () => {
 const r = await fetch(`/api/projects/${projectId}/raci`);
 return r.ok ? (await r.json() as RaciRow[]) : [];
 },
 });

 const totalMs = milestones.length;
 const completedMs = milestones.filter(m => m.status === "completed").length;
 const planUploaded = totalMs > 0;
 const raciCount = raci.length;

 const upcoming = [...milestones]
 .filter(m => m.dueDate && m.status !== "completed")
 .sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime())
 .slice(0, 5);

 return (
 <div className="rounded-2xl p-4 space-y-3">
 <div className="flex items-center justify-between">
 <div>
 <p className="text-sm font-bold text-foreground">Implementation Plan</p>
 <p className="text-[11px] text-warn">FR-17 · milestones, cutover plan and RACI assignments</p>
 </div>
 <span className={`text-[10px] font-mono font-semibold rounded-full px-2 py-0.5 ${planUploaded ? "text-success bg-success/10" : "text-warn bg-warn/10"}`}>
 {planUploaded ? `${completedMs}/${totalMs} milestones complete` : "No milestones yet"}
 </span>
 </div>

 <div className="grid grid-cols-3 gap-2">
 <div className="bg-card rounded-lg p-2 border border-border">
 <div className="flex items-center gap-1 mb-0.5">
 {planUploaded ? <CheckCircle2 size={11} className="text-success" /> : <AlertCircle size={11} className="text-warn" />}
 <p className="text-[10px] font-mono uppercase tracking-wider text-foreground font-semibold">Milestones</p>
 </div>
 <p className="text-lg font-bold text-foreground font-mono">{totalMs}</p>
 </div>
 <div className="bg-card rounded-lg p-2 border border-border">
 <div className="flex items-center gap-1 mb-0.5">
 {completedMs > 0 ? <CheckCircle2 size={11} className="text-success" /> : <AlertCircle size={11} className="text-muted-foreground" />}
 <p className="text-[10px] font-mono uppercase tracking-wider text-foreground font-semibold">Completed</p>
 </div>
 <p className="text-lg font-bold text-success font-mono">{completedMs}</p>
 </div>
 <div className="bg-card rounded-lg p-2 border border-border">
 <div className="flex items-center gap-1 mb-0.5">
 {raciCount > 0 ? <CheckCircle2 size={11} className="text-success" /> : <AlertCircle size={11} className="text-warn" />}
 <p className="text-[10px] font-mono uppercase tracking-wider text-foreground font-semibold">RACI Rows</p>
 </div>
 <p className="text-lg font-bold text-foreground font-mono">{raciCount}</p>
 </div>
 </div>

 {upcoming.length > 0 && (
 <div className="space-y-1">
 <p className="text-[10px] font-mono uppercase tracking-wider font-semibold text-foreground">Upcoming Milestones</p>
 {upcoming.map(m => (
 <div key={m.id} className="flex items-center gap-2 bg-card rounded-lg px-3 py-1.5 border border-border text-xs">
 <Calendar size={11} className="text-warn flex-shrink-0" />
 <span className="font-semibold text-muted-foreground flex-1 truncate">{m.name}</span>
 {m.dueDate && (
 <span className="text-[10px] font-mono text-warn">
 {new Date(m.dueDate).toLocaleDateString()}
 </span>
 )}
 </div>
 ))}
 </div>
 )}

 <div className="flex gap-2 pt-2 border-t border-border">
 <Link href={`/projects/${projectId}?tab=milestones`} className={linkBtnCls}>
 Manage Milestones <ArrowRight size={12} />
 </Link>
 <Link href={`/projects/${projectId}?tab=raci`} className={linkBtnCls}>
 Manage RACI <ArrowRight size={12} />
 </Link>
 </div>
 </div>
 );
}
