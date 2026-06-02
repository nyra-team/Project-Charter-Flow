import { useState } from "react";
import { useListProjectStages, useUpdateProjectStage } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { AiButton } from "../ai-button";

type KickoffPlan = {
 agendaItems: Array<{ minutes: number; title: string; owner: string }>;
 suggestedAttendees: Array<{ name: string; dept: string; role: string }>;
 openingRemarks: string;
};

export function KickoffAttendeesSection({ projectId }: { projectId: number }) {
 const { data: stages = [] } = useListProjectStages(projectId);
 const updateStage = useUpdateProjectStage();
 const { toast } = useToast();
 const [newName, setNewName] = useState("");
 const [newDept, setNewDept] = useState("");

 const kickoffRecord = (
 stages as Array<{ id: number; stage: string; notes?: string | null }>
 ).find((s) => s.stage === "design");

 const parsedNotes: Record<string, unknown> = (() => {
 try { return JSON.parse(kickoffRecord?.notes ?? "{}"); }
 catch { return {}; }
 })();

 const attendees: Array<{ name: string; dept: string; addedAt: string }> = Array.isArray(
 parsedNotes.__kickoff_attendees,
 )
 ? (parsedNotes.__kickoff_attendees as Array<{ name: string; dept: string; addedAt: string }>)
 : [];
 const savedPlan = (parsedNotes.__kickoff_plan as KickoffPlan | undefined) ?? null;
 const [plan, setPlan] = useState<KickoffPlan | null>(savedPlan);

 function applyAiPlan(p: KickoffPlan) {
 if (!kickoffRecord?.id) { toast({ title: "Initialise the Kickoff stage first", variant: "destructive" }); return; }
 const now = new Date().toISOString();
 const existingNames = new Set(attendees.map((a) => a.name.toLowerCase()));
 const merged = [
 ...attendees,
 ...p.suggestedAttendees
 .filter((s) => !existingNames.has(s.name.toLowerCase()))
 .map((s) => ({ name: `${s.role} — ${s.name}`.slice(0, 80), dept: s.dept, addedAt: now })),
 ];
 updateStage.mutate(
 { id: kickoffRecord.id, data: { notes: JSON.stringify({ ...parsedNotes, __kickoff_attendees: merged, __kickoff_plan: p }) } },
 { onError: () => toast({ title: "Failed to apply AI plan", variant: "destructive" }) },
 );
 setPlan(p);
 toast({ title: "AI kickoff plan applied" });
 }

 function addAttendee() {
 if (!newName.trim()) return;
 if (!kickoffRecord?.id) {
 toast({ title: "Initialise the Kickoff stage first", variant: "destructive" });
 return;
 }
 const updated = [
 ...attendees,
 { name: newName.trim(), dept: newDept.trim() || "—", addedAt: new Date().toISOString() },
 ];
 updateStage.mutate(
 { id: kickoffRecord.id, data: { notes: JSON.stringify({ ...parsedNotes, __kickoff_attendees: updated }) } },
 {
 onSuccess: () => { setNewName(""); setNewDept(""); },
 onError: () => toast({ title: "Failed to save attendee", variant: "destructive" }),
 },
 );
 }

 function removeAttendee(idx: number) {
 if (!kickoffRecord?.id) return;
 const updated = attendees.filter((_, i) => i !== idx);
 updateStage.mutate(
 { id: kickoffRecord.id, data: { notes: JSON.stringify({ ...parsedNotes, __kickoff_attendees: updated }) } },
 { onError: () => toast({ title: "Failed to remove attendee", variant: "destructive" }) },
 );
 }

 return (
 <div
 className="rounded-2xl p-4 space-y-3"
 >
 <div className="flex items-center justify-between">
 <p className="text-sm font-bold text-foreground">Kickoff Attendees</p>
 <div className="flex items-center gap-2">
 <AiButton
 label="AI Suggest Agenda"
 endpoint="/api/ai/kickoff/agenda"
 payload={{ projectId }}
 size="sm"
 variant="subtle"
 onResult={(d) => applyAiPlan(d as KickoffPlan)}
 />
 <span className="text-xs font-semibold text-success bg-success/10 rounded-full px-2 py-0.5">
 {attendees.length} registered
 </span>
 </div>
 </div>
 <p className="text-xs text-success">
 Record all meeting attendees — this fulfils the attendees list checklist gate.
 </p>

 {plan && (
 <div className="rounded-lg p-3 bg-card border border-border space-y-1 text-xs">
 <p className="font-semibold text-foreground">AI Kickoff Agenda (60 min)</p>
 <ul className="space-y-0.5">
 {plan.agendaItems.map((a, i) => (
 <li key={i} className="text-muted-foreground">
 <span className="font-mono text-primary">{String(a.minutes).padStart(2, "0")}m</span> · <strong className="text-foreground">{a.title}</strong> — {a.owner}
 </li>
 ))}
 </ul>
 <p className="pt-1 text-foreground italic">{plan.openingRemarks}</p>
 </div>
 )}

 {attendees.length > 0 && (
 <div className="space-y-1 max-h-36 overflow-y-auto">
 {attendees.map((a, i) => (
 <div
 key={i}
 className="flex items-center justify-between bg-card rounded-lg px-3 py-1.5 text-xs"
 >
 <span className="font-semibold text-muted-foreground">{a.name}</span>
 <span className="text-muted-foreground">{a.dept}</span>
 <button
 onClick={() => removeAttendee(i)}
 className="text-destructive hover:text-destructive ml-2 font-bold"
 >
 ×
 </button>
 </div>
 ))}
 </div>
 )}

 <div className="flex gap-2">
 <input
 value={newName}
 onChange={(e) => setNewName(e.target.value)}
 placeholder="Full name"
 className="flex-1 text-xs border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-success"
 onKeyDown={(e) => { if (e.key === "Enter") addAttendee(); }}
 />
 <input
 value={newDept}
 onChange={(e) => setNewDept(e.target.value)}
 placeholder="Department"
 className="w-28 text-xs border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-success"
 onKeyDown={(e) => { if (e.key === "Enter") addAttendee(); }}
 />
 <button
 onClick={addAttendee}
 disabled={!newName.trim() || updateStage.isPending}
 className="bg-primary hover:bg-primary/90 text-xs font-semibold text-primary-foreground px-3 py-1.5 rounded-lg disabled:opacity-40 transition-all"
 >
 Add
 </button>
 </div>
 </div>
 );
}
