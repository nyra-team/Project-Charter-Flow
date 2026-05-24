import { Link } from "wouter";
import { useGetProject, useGetCharter } from "@workspace/api-client-react";
import { FileText, ExternalLink, CheckCircle2, AlertCircle } from "lucide-react";

export function CharterSection({ projectId }: { projectId: number }) {
 const { data: project } = useGetProject(projectId);
 const { data: charter } = useGetCharter(project?.charterId ?? 0, {
 query: { enabled: !!project?.charterId },
 }) as { data?: { id: number; title?: string; status?: string; tentativeBudget?: number; function?: string } };

 const hasCharter = !!project?.charterId && !!charter;

 return (
 <div className="rounded-2xl p-4 space-y-3">
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-2">
 <FileText size={16} className="text-destructive" />
 <div>
 <p className="text-sm font-bold text-foreground">Project Charter</p>
 <p className="text-[11px] text-destructive">FR-08 · formal charter for PMO + Dept Head sign-off</p>
 </div>
 </div>
 <span className={`text-[10px] font-mono inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${hasCharter ? "bg-success/10 text-success" : "bg-warn/10 text-warn"}`}>
 {hasCharter ? <CheckCircle2 size={10} /> : <AlertCircle size={10} />}
 {hasCharter ? "Linked" : "Not linked"}
 </span>
 </div>

 {hasCharter ? (
 <div className="rounded-xl p-3 border-2 border-border bg-card space-y-2">
 <div className="flex items-start justify-between">
 <div>
 <p className="text-sm font-bold text-foreground">{charter.title ?? `Charter #${charter.id}`}</p>
 <p className="text-[11px] text-destructive">Function: {charter.function ?? "—"}</p>
 </div>
 <Link href={`/charters/${charter.id}`} className="text-[11px] inline-flex items-center gap-1 text-destructive font-semibold hover:underline">
 Open Charter <ExternalLink size={11} />
 </Link>
 </div>
 <div className="grid grid-cols-2 gap-2 text-[11px]">
 <div className="rounded-lg bg-card px-2 py-1.5">
 <p className="text-[10px] uppercase tracking-wider text-destructive">Status</p>
 <p className="font-semibold text-foreground capitalize">{charter.status ?? "draft"}</p>
 </div>
 <div className="rounded-lg bg-card px-2 py-1.5">
 <p className="text-[10px] uppercase tracking-wider text-destructive">Budget (USD)</p>
 <p className="font-mono font-semibold text-foreground">
 {charter.tentativeBudget != null ? Number(charter.tentativeBudget).toLocaleString() : "—"}
 </p>
 </div>
 </div>
 </div>
 ) : (
 <div className="rounded-xl p-3 border-2 border-dashed border-border bg-card text-center space-y-2">
 <p className="text-xs text-foreground">
 No charter is linked to this project yet. Create the full Charter (with strategic scoring, benefits and team) to advance past this stage.
 </p>
 <Link href="/charters/new" className="bg-primary hover:bg-primary/90 inline-flex items-center gap-1 text-xs font-semibold text-primary-foreground px-3 py-1.5 rounded-lg">
 Create Charter <ExternalLink size={11} />
 </Link>
 </div>
 )}
 </div>
 );
}
