import { useState } from "react";
import { useListProjectStages, useUpdateProjectStage } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

export function KickoffAttendeesSection({ projectId }: { projectId: number }) {
  const { data: stages = [] } = useListProjectStages(projectId);
  const updateStage = useUpdateProjectStage();
  const { toast } = useToast();
  const [newName, setNewName] = useState("");
  const [newDept, setNewDept] = useState("");

  const kickoffRecord = (
    stages as Array<{ id: number; stage: string; notes?: string | null }>
  ).find((s) => s.stage === "kickoff");

  const parsedNotes: Record<string, unknown> = (() => {
    try { return JSON.parse(kickoffRecord?.notes ?? "{}"); }
    catch { return {}; }
  })();

  const attendees: Array<{ name: string; dept: string; addedAt: string }> = Array.isArray(
    parsedNotes.__kickoff_attendees,
  )
    ? (parsedNotes.__kickoff_attendees as Array<{ name: string; dept: string; addedAt: string }>)
    : [];

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
      style={{ background: "linear-gradient(135deg,#F0FDFA,#CCFBF1)" }}
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-teal-900">Kickoff Attendees</p>
        <span className="text-xs font-semibold text-teal-700 bg-teal-100 rounded-full px-2 py-0.5">
          {attendees.length} registered
        </span>
      </div>
      <p className="text-xs text-teal-700">
        Record all meeting attendees — this fulfils the attendees list checklist gate.
      </p>

      {attendees.length > 0 && (
        <div className="space-y-1 max-h-36 overflow-y-auto">
          {attendees.map((a, i) => (
            <div
              key={i}
              className="flex items-center justify-between bg-white rounded-lg px-3 py-1.5 text-xs"
            >
              <span className="font-semibold text-gray-800">{a.name}</span>
              <span className="text-gray-500">{a.dept}</span>
              <button
                onClick={() => removeAttendee(i)}
                className="text-red-400 hover:text-red-600 ml-2 font-bold"
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
          className="flex-1 text-xs border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-400"
          onKeyDown={(e) => { if (e.key === "Enter") addAttendee(); }}
        />
        <input
          value={newDept}
          onChange={(e) => setNewDept(e.target.value)}
          placeholder="Department"
          className="w-28 text-xs border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-400"
          onKeyDown={(e) => { if (e.key === "Enter") addAttendee(); }}
        />
        <button
          onClick={addAttendee}
          disabled={!newName.trim() || updateStage.isPending}
          className="text-xs font-semibold text-white px-3 py-1.5 rounded-lg disabled:opacity-40 transition-all"
          style={{ background: "#14B8A6" }}
        >
          Add
        </button>
      </div>
    </div>
  );
}
