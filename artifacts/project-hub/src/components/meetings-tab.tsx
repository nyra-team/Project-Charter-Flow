import { useEffect, useState } from "react";
import { Calendar, Plus, Loader2, X, Sparkles, CheckSquare } from "lucide-react";
import { useUserStore } from "../lib/store";
import { api } from "../lib/extra-api";
import { AiButton, AiResultPanel } from "./ai-button";

type Meeting = {
  id: number; title: string; type: string; projectId: number | null;
  scheduledDate: string; scheduledTime: string | null; status: string;
  location: string; agenda: string; notes: string; isFlashMode: boolean;
};

type Item = {
  id: number; meetingId: number; description: string;
  assignedToUserId: number | null; dueDate: string | null;
  percentComplete: number; status: string; notes: string; category: string;
};

export function MeetingsTab({ projectId }: { projectId: number }) {
  const { userId } = useUserStore();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [selected, setSelected] = useState<Meeting | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [aiResult, setAiResult] = useState<unknown>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const [form, setForm] = useState({
    title: "", type: "status", scheduledDate: new Date().toISOString().slice(0, 10),
    scheduledTime: "10:00", location: "", agenda: "", notes: "",
  });

  async function load() {
    setLoading(true);
    try { setMeetings(await api.get<Meeting[]>(`/api/projects/${projectId}/meetings`)); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [projectId]);

  async function loadItems(id: number) {
    setItems(await api.get<Item[]>(`/api/meetings/${id}/items`));
  }

  async function handleAdd() {
    if (!form.title) { alert("Title required"); return; }
    await api.post("/api/meetings", { ...form, projectId, createdById: userId });
    setShowAdd(false);
    setForm({ title: "", type: "status", scheduledDate: new Date().toISOString().slice(0, 10), scheduledTime: "10:00", location: "", agenda: "", notes: "" });
    void load();
  }

  async function handleSaveNotes() {
    if (!selected) return;
    await api.patch(`/api/meetings/${selected.id}`, { notes: selected.notes });
    void load();
  }

  async function handleExtract() {
    if (!selected) return;
    if (!selected.notes?.trim()) { alert("Add meeting notes / transcript first."); return; }
    setAiLoading(true); setAiError(null); setAiResult(null);
    try {
      const data = await api.post<{ items: Item[]; extracted?: number; created?: number }>(`/api/ai/meetings/${selected.id}/extract-action-items`, {});
      setAiResult(data);
      await loadItems(selected.id);
    } catch (e: unknown) {
      setAiError((e as Error & { body?: { error?: string } })?.body?.error ?? (e as Error)?.message ?? "AI extraction failed");
    } finally { setAiLoading(false); }
  }

  useEffect(() => { if (selected) void loadItems(selected.id); }, [selected?.id]);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl p-5 bg-white dark:bg-card border border-border flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-gray-900 dark:text-foreground flex items-center gap-2"><Calendar size={16} /> Meetings & Action Items</h3>
          <p className="text-xs text-muted-foreground mt-1">Capture meeting notes; AI extracts action items into the tracker.</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold bg-indigo-600 text-white">
          <Plus size={14} /> New Meeting
        </button>
      </div>

      {loading ? (
        <div className="text-center py-8 text-muted-foreground"><Loader2 className="animate-spin inline mr-2" size={14} /> Loading…</div>
      ) : meetings.length === 0 ? (
        <div className="rounded-2xl p-8 text-center bg-white dark:bg-card border border-border">
          <Calendar size={28} className="text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No meetings recorded.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {meetings.map(m => (
            <div key={m.id} onClick={() => setSelected(m)} className="rounded-xl p-4 bg-white dark:bg-card border border-border hover:shadow-sm cursor-pointer">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h4 className="font-semibold text-gray-900 dark:text-foreground">{m.title}</h4>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {m.scheduledDate}{m.scheduledTime ? ` · ${m.scheduledTime}` : ""} · {m.type} · {m.status}
                  </div>
                </div>
                {m.isFlashMode && <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">Flash</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowAdd(false)}>
          <div className="bg-white dark:bg-card rounded-2xl p-5 w-full max-w-lg space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between"><h3 className="font-bold text-lg">New Meeting</h3><button onClick={() => setShowAdd(false)}><X size={16} /></button></div>
            <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Title" className="w-full px-2.5 py-1.5 rounded-md border border-input bg-background text-sm" />
            <div className="grid grid-cols-3 gap-2">
              <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} className="px-2 py-1 rounded border border-input bg-background text-sm">
                <option value="status">Status</option><option value="kickoff">Kickoff</option><option value="review">Review</option>
                <option value="planning">Planning</option><option value="retro">Retro</option><option value="other">Other</option>
              </select>
              <input type="date" value={form.scheduledDate} onChange={e => setForm({ ...form, scheduledDate: e.target.value })} className="px-2 py-1 rounded border border-input bg-background text-sm" />
              <input type="time" value={form.scheduledTime} onChange={e => setForm({ ...form, scheduledTime: e.target.value })} className="px-2 py-1 rounded border border-input bg-background text-sm" />
            </div>
            <input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} placeholder="Location / link" className="w-full px-2.5 py-1.5 rounded-md border border-input bg-background text-sm" />
            <textarea value={form.agenda} onChange={e => setForm({ ...form, agenda: e.target.value })} placeholder="Agenda" rows={3} className="w-full px-2.5 py-1.5 rounded-md border border-input bg-background text-sm" />
            <div className="flex justify-end gap-2"><button onClick={() => setShowAdd(false)} className="px-3 py-1.5 rounded-md text-sm bg-muted">Cancel</button><button onClick={() => void handleAdd()} className="px-3 py-1.5 rounded-md text-sm font-semibold bg-indigo-600 text-white">Create</button></div>
          </div>
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setSelected(null)}>
          <div className="bg-white dark:bg-card rounded-2xl p-5 w-full max-w-2xl space-y-3 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-lg">{selected.title}</h3>
                <p className="text-xs text-muted-foreground">{selected.scheduledDate}{selected.scheduledTime ? ` · ${selected.scheduledTime}` : ""}</p>
              </div>
              <button onClick={() => setSelected(null)}><X size={16} /></button>
            </div>
            {selected.agenda && <div className="text-xs"><strong>Agenda:</strong> {selected.agenda}</div>}
            <textarea value={selected.notes} onChange={e => setSelected({ ...selected, notes: e.target.value })} placeholder="Meeting notes / transcript — paste here so AI can extract action items" rows={6} className="w-full px-2.5 py-1.5 rounded-md border border-input bg-background text-sm font-mono" />
            <div className="flex justify-between items-center">
              <button onClick={() => void handleSaveNotes()} className="px-3 py-1.5 rounded-md text-sm font-semibold bg-muted hover:bg-accent">Save Notes</button>
              <button onClick={() => void handleExtract()} disabled={aiLoading} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold bg-gradient-to-r from-indigo-500 to-purple-500 text-white disabled:opacity-50">
                {aiLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                Extract Action Items (AI)
              </button>
            </div>
            <AiResultPanel title="AI Extraction" loading={aiLoading} error={aiError} result={aiResult} render={(r) => {
              const x = r as { extracted?: number; created?: number };
              const count = x.extracted ?? x.created ?? 0;
              return <div className="text-xs text-emerald-700 dark:text-emerald-300">Extracted {count} action items.</div>;
            }} />
            <div className="border-t border-border pt-3">
              <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5"><CheckSquare size={14} /> Action Items ({items.length})</h4>
              {items.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No action items.</p>
              ) : (
                <ul className="space-y-1">
                  {items.map(it => (
                    <li key={it.id} className="text-xs flex items-start gap-2 p-2 rounded bg-muted/40">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${it.status === "completed" ? "bg-emerald-100 text-emerald-700" : it.status === "in_progress" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-700"}`}>{it.status}</span>
                      <div className="flex-1">
                        <div className="font-medium">{it.description}</div>
                        <div className="text-muted-foreground">{it.category}{it.dueDate ? ` · due ${it.dueDate}` : ""}{it.assignedToUserId ? ` · @user${it.assignedToUserId}` : ""}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
