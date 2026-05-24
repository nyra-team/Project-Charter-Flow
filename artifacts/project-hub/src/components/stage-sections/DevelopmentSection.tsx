import { useEffect, useState } from "react";
import { useListProjectStages, useUpdateProjectStage } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, AlertCircle, Activity } from "lucide-react";

type Blocker = { id: string; text: string; severity: "low" | "medium" | "high"; resolved: boolean };
type DevPayload = {
  percentComplete?: number;
  statusNotes?: string;
  blockers?: Blocker[];
  savedAt?: string;
};

export function DevelopmentSection({ projectId }: { projectId: number }) {
  const { data: stages = [] } = useListProjectStages(projectId);
  const updateStage = useUpdateProjectStage();
  const { toast } = useToast();

  const stageRecord = (stages as Array<{ id: number; stage: string; notes?: string | null }>)
    .find((s) => s.stage === "development");
  const parsed: Record<string, unknown> = (() => {
    try { return JSON.parse(stageRecord?.notes ?? "{}"); } catch { return {}; }
  })();
  const saved: DevPayload = (parsed.__development as DevPayload) ?? {};

  const [pct, setPct] = useState<string>(saved.percentComplete?.toString() ?? "0");
  const [notes, setNotes] = useState(saved.statusNotes ?? "");
  const [blockers, setBlockers] = useState<Blocker[]>(saved.blockers ?? []);
  const [newBlocker, setNewBlocker] = useState("");
  const [newSev, setNewSev] = useState<Blocker["severity"]>("medium");

  useEffect(() => {
    setPct(saved.percentComplete?.toString() ?? "0");
    setNotes(saved.statusNotes ?? "");
    setBlockers(saved.blockers ?? []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageRecord?.id]);

  const pctNum = Math.min(100, Math.max(0, Number(pct) || 0));
  const statusOk = notes.length >= 20;
  const openBlockers = blockers.filter((b) => !b.resolved);
  const highBlockers = openBlockers.filter((b) => b.severity === "high").length;

  function persist(nextBlockers?: Blocker[]) {
    if (!stageRecord?.id) {
      toast({ title: "Initialise the Development stage first", variant: "destructive" });
      return;
    }
    const payload: DevPayload = {
      percentComplete: pctNum, statusNotes: notes,
      blockers: nextBlockers ?? blockers,
      savedAt: new Date().toISOString(),
    };
    updateStage.mutate(
      { id: stageRecord.id, data: { notes: JSON.stringify({ ...parsed, __development: payload }) } },
      {
        onSuccess: () => toast({ title: "Development status saved" }),
        onError: () => toast({ title: "Failed to save status", variant: "destructive" }),
      },
    );
  }

  function addBlocker() {
    if (!newBlocker.trim()) return;
    const next: Blocker[] = [
      ...blockers,
      { id: `b_${Date.now()}`, text: newBlocker.trim(), severity: newSev, resolved: false },
    ];
    setBlockers(next);
    setNewBlocker("");
    persist(next);
  }
  function toggleBlocker(id: string) {
    const next = blockers.map((b) => b.id === id ? { ...b, resolved: !b.resolved } : b);
    setBlockers(next);
    persist(next);
  }
  function removeBlocker(id: string) {
    const next = blockers.filter((b) => b.id !== id);
    setBlockers(next);
    persist(next);
  }

  const sevColor = (s: Blocker["severity"]) =>
    s === "high" ? "bg-red-100 text-red-700 border-red-300"
    : s === "medium" ? "bg-amber-100 text-amber-700 border-amber-300"
    : "bg-slate-100 text-slate-700 border-slate-300";

  return (
    <div className="rounded-2xl p-4 space-y-3" style={{ background: "linear-gradient(135deg,#EEF2FF,#E0E7FF)" }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity size={16} className="text-indigo-700" />
          <div>
            <p className="text-sm font-bold text-indigo-900">Development Status</p>
            <p className="text-[11px] text-indigo-700">FR-16 · build progress, status notes and blocker tracking</p>
          </div>
        </div>
        {saved.savedAt && (
          <span className="text-[10px] font-mono text-indigo-700 bg-indigo-100 rounded-full px-2 py-0.5">
            Updated {new Date(saved.savedAt).toLocaleDateString()}
          </span>
        )}
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-3 items-center">
        <div>
          <label className="text-[11px] font-semibold text-indigo-900 block mb-1">% Complete</label>
          <div className="flex items-center gap-2">
            <input type="range" min={0} max={100} value={pctNum} onChange={(e) => setPct(e.target.value)} className="flex-1 accent-indigo-600" />
            <input type="number" min={0} max={100} value={pct} onChange={(e) => setPct(e.target.value)}
              className="w-16 text-xs border border-indigo-200 rounded-lg px-2 py-1.5 bg-white font-mono text-right" />
            <span className="text-xs text-indigo-700">%</span>
          </div>
          <div className="mt-2 h-2 rounded-full bg-indigo-100 overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ width: `${pctNum}%`, background: "#6366F1" }} />
          </div>
        </div>
        <div className="text-center">
          <p className="text-[10px] uppercase tracking-wider text-indigo-600">Open blockers</p>
          <p className="text-2xl font-bold text-indigo-900 font-mono">{openBlockers.length}</p>
          {highBlockers > 0 && <p className="text-[10px] text-red-700 font-semibold">{highBlockers} high</p>}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-[11px] font-semibold text-indigo-900">Status Notes</label>
          <span className={`text-[10px] font-mono inline-flex items-center gap-1 ${statusOk ? "text-green-700" : "text-amber-700"}`}>
            {statusOk ? <CheckCircle2 size={10} /> : <AlertCircle size={10} />} {notes.length}/20
          </span>
        </div>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
          placeholder="What was built this week? What's planned next? Any risks?"
          className="w-full text-xs border border-indigo-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400" />
      </div>

      <div className="space-y-2">
        <p className="text-[11px] font-semibold text-indigo-900">Blockers</p>
        {blockers.length === 0 ? (
          <p className="text-[11px] text-indigo-600 italic">No blockers recorded.</p>
        ) : (
          <ul className="space-y-1">
            {blockers.map((b) => (
              <li key={b.id} className="flex items-center gap-2 text-[11px] bg-white border border-indigo-200 rounded-lg px-2 py-1.5">
                <input type="checkbox" checked={b.resolved} onChange={() => toggleBlocker(b.id)} className="accent-indigo-600" />
                <span className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border ${sevColor(b.severity)}`}>{b.severity}</span>
                <span className={`flex-1 ${b.resolved ? "line-through text-indigo-400" : "text-indigo-900"}`}>{b.text}</span>
                <button onClick={() => removeBlocker(b.id)} className="text-[10px] text-red-600 hover:underline">remove</button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center gap-2">
          <input value={newBlocker} onChange={(e) => setNewBlocker(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addBlocker())}
            placeholder="Add a blocker…"
            className="flex-1 text-xs border border-indigo-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400" />
          <select value={newSev} onChange={(e) => setNewSev(e.target.value as Blocker["severity"])}
            className="text-xs border border-indigo-200 rounded-lg px-2 py-1.5 bg-white">
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
          <button onClick={addBlocker} disabled={!newBlocker.trim()}
            className="text-xs font-semibold text-white px-3 py-1.5 rounded-lg disabled:opacity-40"
            style={{ background: "#6366F1" }}>Add</button>
        </div>
      </div>

      <div className="flex items-center justify-end pt-2 border-t border-indigo-200">
        <button onClick={() => persist()} disabled={updateStage.isPending}
          className="text-xs font-semibold text-white px-3 py-1.5 rounded-lg disabled:opacity-40"
          style={{ background: "#6366F1" }}>
          {updateStage.isPending ? "Saving…" : "Save Status"}
        </button>
      </div>
    </div>
  );
}
