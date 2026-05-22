import { useEffect, useMemo, useState } from "react";
import { Search, BookOpen, Sparkles, Plus, Tag, X, Loader2 } from "lucide-react";
import { api } from "../lib/extra-api";
import { AiButton, AiResultPanel } from "../components/ai-button";

type Lesson = {
  id: number; projectId: number; title: string; description: string;
  category: string; whatWorked: string; whatDidnt: string; recommendation: string;
  tags: string[]; stage: string; createdAt: string;
};

const CATEGORIES = ["all", "general", "schedule", "budget", "vendor", "scope", "stakeholder", "technical", "quality"];

const CAT_COLORS: Record<string, string> = {
  general: "#64748B", schedule: "#3B82F6", budget: "#10B981", vendor: "#F59E0B",
  scope: "#8B5CF6", stakeholder: "#EC4899", technical: "#6366F1", quality: "#EF4444",
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
      <div className="rounded-2xl p-5 bg-white dark:bg-card border border-border">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-foreground flex items-center gap-2">
              <BookOpen size={20} /> Lessons Learned Repository
            </h2>
            <p className="text-xs text-muted-foreground mt-1">Cross-project knowledge — search by keyword, tag, or use AI semantic search</p>
          </div>
          <button onClick={() => setShowAdd(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700">
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
              className="w-full pl-8 pr-3 py-1.5 rounded-md border border-input bg-background text-sm"
            />
          </div>
          <button onClick={() => void load()} className="px-3 py-1.5 rounded-md text-sm font-medium bg-muted hover:bg-accent">Search</button>
          <button onClick={() => void handleAiSearch()} disabled={aiLoading || !q.trim()} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold bg-gradient-to-r from-indigo-500 to-purple-500 text-white hover:from-indigo-600 hover:to-purple-600 disabled:opacity-50">
            {aiLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            AI Search
          </button>
          <select value={category} onChange={e => setCategory(e.target.value)} className="px-2.5 py-1.5 rounded-md border border-input bg-background text-sm capitalize">
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
            const summary = (r as { summary?: string }).summary ?? "";
            return (
              <div className="space-y-2 text-xs">
                {summary && <p className="text-gray-700 dark:text-gray-200">{summary}</p>}
                {matches.map(m => {
                  const lesson = lessons.find(l => l.id === m.id);
                  if (!lesson) return null;
                  return (
                    <div key={m.id} className="rounded-md border border-indigo-100 dark:border-indigo-900 bg-white dark:bg-card p-2.5">
                      <div className="font-semibold text-gray-900 dark:text-foreground">{lesson.title}</div>
                      <div className="text-muted-foreground mt-0.5">{m.reason}</div>
                      <div className="text-indigo-600 mt-1">Relevance: {(m.relevance * 100).toFixed(0)}%</div>
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
        <div className="rounded-2xl p-10 text-center bg-white dark:bg-card border border-border">
          <BookOpen size={32} className="text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No lessons recorded yet. Capture insights at project closure.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map(l => (
            <div key={l.id} className="rounded-xl p-4 bg-white dark:bg-card border border-border hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between gap-2 mb-2">
                <h3 className="font-semibold text-gray-900 dark:text-foreground">{l.title}</h3>
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full" style={{ background: `${CAT_COLORS[l.category] ?? "#64748B"}20`, color: CAT_COLORS[l.category] ?? "#64748B" }}>
                  {l.category}
                </span>
              </div>
              <p className="text-sm text-muted-foreground mb-2">{l.description}</p>
              {l.whatWorked && <div className="text-xs mt-2"><span className="font-semibold text-emerald-700">✓ Worked: </span><span className="text-muted-foreground">{l.whatWorked}</span></div>}
              {l.whatDidnt && <div className="text-xs mt-1"><span className="font-semibold text-red-700">✗ Didn't: </span><span className="text-muted-foreground">{l.whatDidnt}</span></div>}
              {l.recommendation && <div className="text-xs mt-1"><span className="font-semibold text-indigo-700">→ Rec: </span><span className="text-muted-foreground">{l.recommendation}</span></div>}
              {(l.tags ?? []).length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {l.tags.map(t => (
                    <span key={t} className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground"><Tag size={9} />{t}</span>
                  ))}
                </div>
              )}
              <div className="text-[10px] text-muted-foreground mt-2">
                Project #{l.projectId}{l.stage ? ` · ${l.stage}` : ""} · {new Date(l.createdAt).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowAdd(false)}>
          <div className="bg-white dark:bg-card rounded-2xl p-5 w-full max-w-xl space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg">Capture Lesson Learned</h3>
              <button onClick={() => setShowAdd(false)}><X size={16} /></button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select value={form.projectId} onChange={e => setForm({ ...form, projectId: Number(e.target.value) })} className="px-2.5 py-1.5 rounded-md border border-input bg-background text-sm">
                <option value={0}>— Select project —</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="px-2.5 py-1.5 rounded-md border border-input bg-background text-sm capitalize">
                {CATEGORIES.filter(c => c !== "all").map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Title" className="w-full px-2.5 py-1.5 rounded-md border border-input bg-background text-sm" />
            <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Description" rows={3} className="w-full px-2.5 py-1.5 rounded-md border border-input bg-background text-sm" />
            <textarea value={form.whatWorked} onChange={e => setForm({ ...form, whatWorked: e.target.value })} placeholder="What worked well" rows={2} className="w-full px-2.5 py-1.5 rounded-md border border-input bg-background text-sm" />
            <textarea value={form.whatDidnt} onChange={e => setForm({ ...form, whatDidnt: e.target.value })} placeholder="What didn't work" rows={2} className="w-full px-2.5 py-1.5 rounded-md border border-input bg-background text-sm" />
            <textarea value={form.recommendation} onChange={e => setForm({ ...form, recommendation: e.target.value })} placeholder="Recommendation for future projects" rows={2} className="w-full px-2.5 py-1.5 rounded-md border border-input bg-background text-sm" />
            <input value={form.tags} onChange={e => setForm({ ...form, tags: e.target.value })} placeholder="Tags (comma separated)" className="w-full px-2.5 py-1.5 rounded-md border border-input bg-background text-sm" />
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowAdd(false)} className="px-3 py-1.5 rounded-md text-sm bg-muted">Cancel</button>
              <button onClick={() => void handleAdd()} className="px-3 py-1.5 rounded-md text-sm font-semibold bg-indigo-600 text-white">Save Lesson</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
