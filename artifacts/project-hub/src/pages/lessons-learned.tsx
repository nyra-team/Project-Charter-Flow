import { useEffect, useMemo, useState } from "react";
import { Search, BookOpen, Sparkles, Plus, Tag, X, Loader2 } from "lucide-react";
import { api } from "../lib/extra-api";
import { AiResultPanel } from "../components/ai-button";

type Lesson = {
  id: number; projectId: number; title: string; description: string;
  category: string; whatWorked: string; whatDidnt: string; recommendation: string;
  tags: string[]; stage: string; createdAt: string;
};

const CATEGORIES = ["all", "general", "schedule", "budget", "vendor", "scope", "stakeholder", "technical", "quality"];

const CAT_PILL: Record<string, string> = {
  general:     "bg-muted text-muted-foreground border-border",
  schedule:    "bg-primary/10 text-primary border-primary/20",
  budget:      "bg-success/10 text-success border-success/20",
  vendor:      "bg-warn/10 text-warn border-warn/20",
  scope:       "bg-primary/10 text-primary border-primary/20",
  stakeholder: "bg-warn/10 text-warn border-warn/20",
  technical:   "bg-primary/10 text-primary border-primary/20",
  quality:     "bg-destructive/10 text-destructive border-destructive/20",
};

export default function LessonsLearnedPage() {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [projects, setProjects] = useState<Array<{ id: number; name: string }>>([]);
  const [aiResult, setAiResult] = useState<unknown>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const [form, setForm] = useState({
    projectId: 0, title: "", description: "", category: "general",
    whatWorked: "", whatDidnt: "", recommendation: "", tags: "", stage: "",
  });

  async function load() {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (q) p.set("q", q);
      if (category !== "all") p.set("category", category);
      const rows = await api.get<Lesson[]>(`/api/lessons-learned${p.toString() ? "?" + p.toString() : ""}`);
      setLessons(rows);
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [category]);
  useEffect(() => { void api.get<Array<{ id: number; name: string }>>("/api/projects").then(setProjects).catch(() => {}); }, []);

  async function handleAiSearch() {
    if (!q.trim()) return;
    setAiLoading(true); setAiError(null); setAiResult(null);
    try {
      const data = await api.post<{ ranked?: Array<{ id: number; score: number; why: string }> }>(
        "/api/ai/lessons-learned/search",
        {
          query: q,
          lessons: lessons.map(l => ({ id: l.id, title: l.title, description: l.description, tags: l.tags ?? [] })),
        }
      );
      const matches = (data?.ranked ?? []).map(r => ({ id: r.id, reason: r.why, relevance: r.score }));
      setAiResult({ matches });
    } catch (e: unknown) {
      setAiError((e as Error & { body?: { error?: string } })?.body?.error ?? (e as Error)?.message ?? "AI search failed");
    } finally { setAiLoading(false); }
  }

  async function handleAdd() {
    if (!form.projectId || !form.title || !form.description) {
      alert("Project, title and description are required."); return;
    }
    await api.post(`/api/projects/${form.projectId}/lessons-learned`, {
      ...form,
      tags: form.tags.split(",").map(t => t.trim()).filter(Boolean),
    });
    setShowAdd(false);
    setForm({ projectId: 0, title: "", description: "", category: "general", whatWorked: "", whatDidnt: "", recommendation: "", tags: "", stage: "" });
    void load();
  }

  const filtered = useMemo(() => {
    if (!q) return lessons;
    const ql = q.toLowerCase();
    return lessons.filter(l =>
      l.title.toLowerCase().includes(ql) ||
      l.description.toLowerCase().includes(ql) ||
      (l.tags ?? []).some(t => t.toLowerCase().includes(ql))
    );
  }, [lessons, q]);

  return (
    <div className="space-y-5">
      {/* Header card */}
      <div className="glass-surface lift-card rounded-2xl p-6 ph-rise relative overflow-hidden">
        <span aria-hidden className="pointer-events-none absolute bottom-0 left-6 right-6 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
        <div className="flex items-start justify-between gap-4 mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-primary/10 border border-primary/20">
              <BookOpen size={18} className="text-primary" />
            </div>
            <div>
              <h1 data-tour="les-title" className="text-xl font-bold text-foreground tracking-tight">Lessons Learned Repository</h1>
              <p className="text-[11px] text-muted-foreground mt-0.5">Cross-project knowledge — search by keyword, tag, or use AI semantic search.</p>
            </div>
          </div>
          <button data-tour="les-capture" onClick={() => setShowAdd(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm">
            <Plus size={14} /> Capture Lesson
          </button>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <div className="flex-1 min-w-[240px] relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") void load(); }}
              placeholder="Search lessons by title, description, tag…"
              className="w-full pl-8 pr-3 py-1.5 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
            />
          </div>
          <button onClick={() => void load()} className="px-3 py-1.5 rounded-md text-sm font-medium text-foreground bg-muted hover:bg-accent transition-colors">Search</button>
          <button onClick={() => void handleAiSearch()} disabled={aiLoading || !q.trim()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold bg-gradient-to-r from-indigo-500 to-purple-500 text-white hover:from-indigo-600 hover:to-purple-600 disabled:opacity-50 shadow-sm transition-all">
            {aiLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            AI Search
          </button>
          <select value={category} onChange={e => setCategory(e.target.value)}
                  className="px-2.5 py-1.5 rounded-md border border-input bg-background text-sm capitalize focus:outline-none focus:ring-2 focus:ring-ring/40">
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <AiResultPanel
          title="AI Semantic Match"
          loading={aiLoading}
          error={aiError}
          result={aiResult}
          render={(r) => {
            const matches = (r as { matches?: Array<{ id: number; reason: string; relevance: number }> }).matches ?? [];
            return (
              <div className="space-y-2 text-xs">
                {matches.map(m => {
                  const lesson = lessons.find(l => l.id === m.id);
                  if (!lesson) return null;
                  return (
                    <div key={m.id} className="rounded-md border border-border bg-background/60 backdrop-blur-sm p-3">
                      <div className="font-semibold text-foreground">{lesson.title}</div>
                      <div className="text-muted-foreground mt-0.5">{m.reason}</div>
                      <div className="text-primary mt-1 font-mono text-[10px] uppercase tracking-wider">Relevance · {(m.relevance * 100).toFixed(0)}%</div>
                    </div>
                  );
                })}
                {matches.length === 0 && <p className="text-muted-foreground italic">No semantic matches.</p>}
              </div>
            );
          }}
        />
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground"><Loader2 className="animate-spin inline mr-2" size={16} /> Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="glass-surface rounded-2xl p-12 text-center ph-rise ph-rise-2">
          <BookOpen size={32} className="text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No lessons recorded yet. Capture insights at project closure.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 stagger-children">
          {filtered.map(l => {
            const pill = CAT_PILL[l.category] ?? CAT_PILL.general;
            return (
              <div key={l.id} className="glass-surface lift-card rounded-xl p-4 group">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h3 className="font-semibold text-foreground tracking-tight group-hover:text-primary transition-colors">{l.title}</h3>
                  <span className={`inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-sm border whitespace-nowrap ${pill}`}>
                    {l.category}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground mb-2">{l.description}</p>
                {l.whatWorked && <div className="text-xs mt-2"><span className="font-semibold text-success">✓ Worked: </span><span className="text-muted-foreground">{l.whatWorked}</span></div>}
                {l.whatDidnt && <div className="text-xs mt-1"><span className="font-semibold text-destructive">✗ Didn't: </span><span className="text-muted-foreground">{l.whatDidnt}</span></div>}
                {l.recommendation && <div className="text-xs mt-1"><span className="font-semibold text-primary">→ Rec: </span><span className="text-muted-foreground">{l.recommendation}</span></div>}
                {(l.tags ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {l.tags.map(t => (
                      <span key={t} className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-sm bg-muted text-muted-foreground border border-border"><Tag size={9} />{t}</span>
                    ))}
                  </div>
                )}
                <div className="text-[10px] text-muted-foreground/80 mt-3 pt-2 border-t border-border/60 font-mono uppercase tracking-wider">
                  Project #{l.projectId}{l.stage ? ` · ${l.stage}` : ""} · {new Date(l.createdAt).toLocaleDateString()}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200" onClick={() => setShowAdd(false)}>
          <div className="bg-popover text-popover-foreground border border-popover-border shadow-2xl rounded-2xl p-5 w-full max-w-xl space-y-3 max-h-[90vh] overflow-y-auto scrollbar-thin ph-rise" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-[15px] text-foreground tracking-tight">Capture Lesson Learned</h3>
              <button onClick={() => setShowAdd(false)} className="w-8 h-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"><X size={15} /></button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select value={form.projectId} onChange={e => setForm({ ...form, projectId: Number(e.target.value) })} className="px-2.5 py-1.5 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40">
                <option value={0}>— Select project —</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="px-2.5 py-1.5 rounded-md border border-input bg-background text-sm capitalize focus:outline-none focus:ring-2 focus:ring-ring/40">
                {CATEGORIES.filter(c => c !== "all").map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Title" className="w-full px-2.5 py-1.5 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40" />
            <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Description" rows={3} className="w-full px-2.5 py-1.5 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40" />
            <textarea value={form.whatWorked} onChange={e => setForm({ ...form, whatWorked: e.target.value })} placeholder="What worked well" rows={2} className="w-full px-2.5 py-1.5 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40" />
            <textarea value={form.whatDidnt} onChange={e => setForm({ ...form, whatDidnt: e.target.value })} placeholder="What didn't work" rows={2} className="w-full px-2.5 py-1.5 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40" />
            <textarea value={form.recommendation} onChange={e => setForm({ ...form, recommendation: e.target.value })} placeholder="Recommendation for future projects" rows={2} className="w-full px-2.5 py-1.5 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40" />
            <input value={form.tags} onChange={e => setForm({ ...form, tags: e.target.value })} placeholder="Tags (comma separated)" className="w-full px-2.5 py-1.5 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40" />
            <div className="flex justify-end gap-2 pt-2 border-t border-border/60">
              <button onClick={() => setShowAdd(false)} className="px-3 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">Cancel</button>
              <button onClick={() => void handleAdd()} className="px-3 py-1.5 rounded-md text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm">Save Lesson</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
