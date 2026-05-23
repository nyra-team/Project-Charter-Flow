import { useEffect, useState } from "react";
import { Calendar, Plus, Loader2, X, Sparkles, CheckSquare } from "lucide-react";
import { useUserStore } from "../lib/store";
import { api } from "../lib/extra-api";
import { AiResultPanel } from "./ai-button";

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

const STATUS_PILL: Record<string, string> = {
  completed:   "bg-success/10 text-success border-success/20",
  in_progress: "bg-primary/10 text-primary border-primary/20",
  scheduled:   "bg-muted text-muted-foreground border-border",
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
      <div className="glass-surface lift-card ph-rise rounded-2xl p-5 relative overflow-hidden">
        <span aria-hidden className="pointer-events-none absolute bottom-0 left-5 right-5 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-primary/10 border border-primary/20">
              <Calendar size={18} className="text-primary" />
            </div>
            <div>
              <h3 className="text-[14px] font-semibold text-foreground tracking-tight">Meetings & Action Items</h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">Capture meeting notes; AI extracts action items into the tracker.</p>
            </div>
          </div>
          <button onClick={() => setShowAdd(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm">
            <Plus size={14} /> New Meeting
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8 text-muted-foreground"><Loader2 className="animate-spin inline mr-2" size={14} /> Loading…</div>
      ) : meetings.length === 0 ? (
        <div className="glass-surface lift-card ph-rise rounded-2xl p-10 text-center">
          <Calendar size={28} className="text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No meetings recorded yet.</p>
        </div>
      ) : (
        <div className="space-y-2 stagger-children">
          {meetings.map(m => (
            <div key={m.id} onClick={() => setSelected(m)}
                 className="glass-surface lift-card ph-rise rounded-2xl p-4 cursor-pointer group">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h4 className="font-semibold text-foreground tracking-tight group-hover:text-primary transition-colors">{m.title}</h4>
                  <div className="text-[11px] text-muted-foreground mt-0.5 font-mono">
                    {m.scheduledDate}{m.scheduledTime ? ` · ${m.scheduledTime}` : ""} · {m.type} · {m.status}
                  </div>
                </div>
                {m.isFlashMode && <span className="text-[10px] uppercase font-mono tracking-wider font-semibold px-2 py-0.5 rounded-sm border bg-warn/10 text-warn border-warn/20">Flash</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200" onClick={() => setShowAdd(false)}>
          <div className="bg-popover text-popover-foreground border border-popover-border shadow-2xl rounded-2xl p-5 w-full max-w-lg space-y-3 ph-rise" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-[15px] text-foreground tracking-tight">New Meeting</h3>
              <button onClick={() => setShowAdd(false)} className="w-8 h-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"><X size={15} /></button>
            </div>
            <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Title" className="w-full px-2.5 py-1.5 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40" />
            <div className="grid grid-cols-3 gap-2">
              <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} className="px-2 py-1.5 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40">
                <option value="status">Status</option><option value="kickoff">Kickoff</option><option value="review">Review</option>
                <option value="planning">Planning</option><option value="retro">Retro</option><option value="other">Other</option>
              </select>
              <input type="date" value={form.scheduledDate} onChange={e => setForm({ ...form, scheduledDate: e.target.value })} className="px-2 py-1.5 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40" />
              <input type="time" value={form.scheduledTime} onChange={e => setForm({ ...form, scheduledTime: e.target.value })} className="px-2 py-1.5 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40" />
            </div>
            <input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} placeholder="Location / link" className="w-full px-2.5 py-1.5 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40" />
            <textarea value={form.agenda} onChange={e => setForm({ ...form, agenda: e.target.value })} placeholder="Agenda" rows={3} className="w-full px-2.5 py-1.5 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40" />
            <div className="flex justify-end gap-2 pt-2 border-t border-border/60">
              <button onClick={() => setShowAdd(false)} className="px-3 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">Cancel</button>
              <button onClick={() => void handleAdd()} className="px-3 py-1.5 rounded-md text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm">Create</button>
            </div>
          </div>
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200" onClick={() => setSelected(null)}>
          <div className="bg-popover text-popover-foreground border border-popover-border shadow-2xl rounded-2xl p-5 w-full max-w-2xl space-y-3 max-h-[90vh] overflow-y-auto scrollbar-thin ph-rise" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-[15px] text-foreground tracking-tight">{selected.title}</h3>
                <p className="text-[11px] text-muted-foreground font-mono">{selected.scheduledDate}{selected.scheduledTime ? ` · ${selected.scheduledTime}` : ""}</p>
              </div>
              <button onClick={() => setSelected(null)} className="w-8 h-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"><X size={15} /></button>
            </div>
            {selected.agenda && <div className="text-xs rounded-md bg-muted/50 border border-border p-2.5"><span className="font-semibold text-foreground">Agenda:</span> <span className="text-muted-foreground">{selected.agenda}</span></div>}
            <textarea value={selected.notes ?? ""} onChange={e => setSelected({ ...selected, notes: e.target.value })} placeholder="Meeting notes / transcript — paste here so AI can extract action items" rows={6} className="w-full px-2.5 py-1.5 rounded-md border border-input bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring/40" />
            <div className="flex justify-between items-center">
              <button onClick={() => void handleSaveNotes()} className="px-3 py-1.5 rounded-md text-sm font-medium text-foreground bg-muted hover:bg-accent transition-colors">Save Notes</button>
              <button onClick={() => void handleExtract()} disabled={aiLoading} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 shadow-sm transition-all">
                {aiLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                Extract Action Items
              </button>
            </div>
            <AiResultPanel title="AI Extraction" loading={aiLoading} error={aiError} result={aiResult} render={(r) => {
              const x = r as { extracted?: number; created?: number };
              const count = x.extracted ?? x.created ?? 0;
              return <div className="text-xs text-success font-medium">Extracted {count} action items into the tracker below.</div>;
            }} />
            <div className="border-t border-border/60 pt-3">
              <h4 className="text-[13px] font-semibold mb-2 flex items-center gap-1.5 text-foreground tracking-tight"><CheckSquare size={14} className="text-primary" /> Action Items <span className="text-muted-foreground font-normal">({items.length})</span></h4>
              {items.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No action items yet.</p>
              ) : (
                <ul className="space-y-1.5">
                  {items.map(it => {
                    const pill = STATUS_PILL[it.status] ?? STATUS_PILL.scheduled;
                    return (
                      <li key={it.id} className="text-xs flex items-start gap-2 p-2.5 rounded-md bg-muted/50 border border-border/60 hover:border-border transition-colors">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-sm font-mono uppercase tracking-wider font-semibold border whitespace-nowrap ${pill}`}>{it.status}</span>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-foreground">{it.description}</div>
                          <div className="text-muted-foreground font-mono text-[10px] mt-0.5">{it.category}{it.dueDate ? ` · due ${it.dueDate}` : ""}{it.assignedToUserId ? ` · @user${it.assignedToUserId}` : ""}</div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
