import { useState } from "react";
import { useListIssues, useCreateIssue, useUpdateIssue } from "@workspace/api-client-react";
import { useUserStore } from "../../lib/store";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, CheckCircle2, Lock } from "lucide-react";

export function UATDefectSection({ projectId }: { projectId: number }) {
 const { data: allIssues = [], refetch } = useListIssues(projectId);
 const createIssue = useCreateIssue();
 const updateIssue = useUpdateIssue();
 const { userId } = useUserStore();
 const { toast } = useToast();
 const [newTitle, setNewTitle] = useState("");
 const [adding, setAdding] = useState(false);

 const defects = (
 allIssues as Array<{ id: number; title: string; status: string; dependencyType?: string | null }>
 ).filter((i) => i.dependencyType === "uat_defect");

 const openCount = defects.filter((d) => d.status !== "resolved").length;
 const closedCount = defects.filter((d) => d.status === "resolved").length;
 const total = defects.length;
 const closurePct = total > 0 ? Math.round((closedCount / total) * 100) : 100;
 const canGoLive = openCount === 0;

 function addDefect() {
 if (!newTitle.trim()) return;
 createIssue.mutate(
 { id: projectId, data: { title: newTitle.trim(), dependencyType: "uat_defect", raisedBy: userId ?? undefined } },
 {
 onSuccess: () => { setNewTitle(""); setAdding(false); void refetch(); },
 onError: () => toast({ title: "Failed to add defect", variant: "destructive" }),
 },
 );
 }

 function toggleDefect(defectId: number, currentStatus: string) {
 updateIssue.mutate(
 { id: defectId, data: { status: currentStatus === "resolved" ? "open" : "resolved" } },
 {
 onSuccess: () => void refetch(),
 onError: () => toast({ title: "Failed to update defect", variant: "destructive" }),
 },
 );
 }

 return (
 <div className="rounded-xl p-4 mt-4" style={{ background: "hsl(var(--warn) / 0.12)", border: "1px solid hsl(var(--warn) / 0.3)" }}>
 <div className="flex items-center justify-between mb-3">
 <div className="flex items-center gap-2">
 <AlertTriangle size={15} className="text-warn" />
 <span className="text-sm font-bold text-foreground">UAT Defect Tracker</span>
 <span className="text-xs text-warn">({openCount} open / {total} total)</span>
 </div>
 <button
 onClick={() => setAdding((a) => !a)}
 className="text-xs font-semibold px-2 py-1 rounded-lg bg-warn/10 text-warn border border-warn/30 hover:bg-warn/20"
 >
 + Add Defect
 </button>
 </div>

 {adding && (
 <div className="flex gap-2 mb-3">
 <input
 type="text"
 value={newTitle}
 onChange={(e) => setNewTitle(e.target.value)}
 placeholder="Defect description..."
 onKeyDown={(e) => e.key === "Enter" && addDefect()}
 className="flex-1 rounded-lg px-3 py-1.5 text-sm border border-border bg-card outline-none"
 autoFocus
 />
 <button
 onClick={addDefect}
 className="bg-primary hover:bg-primary/90 px-3 py-1.5 rounded-lg text-sm font-semibold text-primary-foreground"
 >
 Add
 </button>
 </div>
 )}

 <div className="mb-3">
 <div className="flex justify-between text-xs font-medium text-foreground mb-1">
 <span>Defect Closure</span>
 <span className={canGoLive ? "text-success font-bold" : "text-destructive font-bold"}>{closurePct}%</span>
 </div>
 <div className="h-2 bg-warn/10 rounded-full overflow-hidden">
 <div
 className="h-full rounded-full transition-all"
 style={{
 width: `${closurePct}%`,
 background: canGoLive ? "hsl(var(--success) / 0.12)" : closurePct >= 80 ? "hsl(var(--warn) / 0.12)" : "hsl(var(--destructive) / 0.12)",
 }}
 />
 </div>
 </div>

 {defects.length > 0 && (
 <div className="space-y-1.5 mb-2 max-h-48 overflow-y-auto">
 {defects.map((d) => (
 <div
 key={d.id}
 className="flex items-center gap-2 px-2 py-1.5 rounded-lg"
 style={{ background: d.status === "resolved" ? "hsl(var(--success) / 0.12)" : "hsl(var(--warn) / 0.12)" }}
 >
 <button
 onClick={() => toggleDefect(d.id, d.status)}
 title={d.status === "resolved" ? "Reopen" : "Mark resolved"}
 className="flex-shrink-0"
 >
 {d.status === "resolved" ? (
 <CheckCircle2 size={14} className="text-success" />
 ) : (
 <AlertTriangle size={14} className="text-warn" />
 )}
 </button>
 <span className={`flex-1 text-xs ${d.status === "resolved" ? "line-through text-muted-foreground" : "text-muted-foreground"}`}>
 {d.title}
 </span>
 <span className="text-xs font-semibold" style={{ color: d.status === "resolved" ? "hsl(var(--success))" : "hsl(var(--warn) / 1)" }}>
 {d.status === "resolved" ? "Closed" : "Open"}
 </span>
 </div>
 ))}
 </div>
 )}

 {total === 0 && !adding && (
 <p className="text-xs text-warn text-center py-2">No defects logged. Add defects to track UAT progress.</p>
 )}
 {!canGoLive && total > 0 && (
 <p className="text-xs text-destructive font-semibold mt-2 flex items-center gap-1">
 <Lock size={11} />
 Go Live is blocked: {openCount} open defect(s) must be resolved first.
 </p>
 )}
 {canGoLive && total > 0 && (
 <p className="text-xs text-success font-semibold mt-2 flex items-center gap-1">
 <CheckCircle2 size={11} />
 All defects closed — ready to advance to Go Live.
 </p>
 )}
 </div>
 );
}
