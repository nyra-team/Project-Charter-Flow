import { useEffect, useState } from "react";
import { TrendingUp, Calendar, CheckCircle, Plus, Loader2 } from "lucide-react";
import { api } from "../lib/extra-api";

type Review = {
  id: number; projectId: number; reviewPeriod: string;
  scheduledDate: string; conductedDate: string | null; status: string;
  toplineProjected: string | null; toplineActual: string | null;
  bottomlineProjected: string | null; bottomlineActual: string | null;
  productivityProjected: string; productivityActual: string;
  complianceProjected: string; complianceActual: string;
  overallRealizationPct: string | null; rag: string;
  findings: string; recommendations: string;
};

const RAG_COLOR: Record<string, { bg: string; color: string; label: string }> = {
  green: { bg: "#ECFDF5", color: "#15803D", label: "On Track" },
  amber: { bg: "#FFFBEB", color: "#B45309", label: "At Risk" },
  red: { bg: "#FEE2E2", color: "#991B1B", label: "Off Track" },
};

export function BenefitsTab({ projectId }: { projectId: number }) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(false);
  const [goLiveDate, setGoLiveDate] = useState("");
  const [editing, setEditing] = useState<Review | null>(null);

  async function load() {
    setLoading(true);
    try { setReviews(await api.get<Review[]>(`/api/projects/${projectId}/benefits-reviews`)); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [projectId]);

  async function handleInit() {
    if (!goLiveDate) { alert("Pick a Go Live date first."); return; }
    await api.post(`/api/projects/${projectId}/benefits-reviews/init`, { goLiveDate });
    void load();
  }

  async function handleSave() {
    if (!editing) return;
    const body: Partial<Review> = {
      toplineActual: editing.toplineActual, bottomlineActual: editing.bottomlineActual,
      productivityActual: editing.productivityActual, complianceActual: editing.complianceActual,
      overallRealizationPct: editing.overallRealizationPct, rag: editing.rag,
      findings: editing.findings, recommendations: editing.recommendations,
      status: editing.status,
    };
    await api.patch(`/api/benefits-reviews/${editing.id}`, body);
    setEditing(null);
    void load();
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl p-5 bg-white dark:bg-card border border-border flex items-center justify-between gap-4">
        <div>
          <h3 className="font-semibold text-gray-900 dark:text-foreground flex items-center gap-2"><TrendingUp size={16} /> Benefits Realization</h3>
          <p className="text-xs text-muted-foreground mt-1">Post-implementation reviews at +3, +6 and +12 months</p>
        </div>
        {reviews.length === 0 && (
          <div className="flex gap-2 items-center">
            <input type="date" value={goLiveDate} onChange={e => setGoLiveDate(e.target.value)} className="px-2.5 py-1.5 rounded-md border border-input bg-background text-sm" />
            <button onClick={() => void handleInit()} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold bg-indigo-600 text-white">
              <Plus size={14} /> Initialize Reviews
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="text-center py-8 text-muted-foreground"><Loader2 className="animate-spin inline mr-2" size={14} /> Loading…</div>
      ) : reviews.length === 0 ? (
        <div className="rounded-2xl p-8 text-center bg-white dark:bg-card border border-border">
          <Calendar size={28} className="text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No benefits reviews scheduled. Pick the Go-Live date above to initialise the 3/6/12-month review cycle.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {reviews.map(r => {
            const rag = RAG_COLOR[r.rag] ?? RAG_COLOR.amber;
            const overdue = new Date(r.scheduledDate) < new Date() && r.status !== "completed";
            return (
              <div key={r.id} className="rounded-xl p-4 bg-white dark:bg-card border border-border">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-lg font-bold text-indigo-600">+{r.reviewPeriod}</span>
                  <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full" style={{ background: rag.bg, color: rag.color }}>{rag.label}</span>
                </div>
                <div className="text-xs text-muted-foreground mb-3">
                  Scheduled: {r.scheduledDate}
                  {overdue && <span className="ml-2 text-red-600 font-semibold">Overdue</span>}
                </div>
                <div className="space-y-1 text-xs">
                  <div><span className="text-muted-foreground">Topline:</span> {r.toplineActual ?? "—"} / <span className="text-muted-foreground">target {r.toplineProjected ?? "—"}</span></div>
                  <div><span className="text-muted-foreground">Bottom:</span> {r.bottomlineActual ?? "—"} / <span className="text-muted-foreground">target {r.bottomlineProjected ?? "—"}</span></div>
                  <div><span className="text-muted-foreground">Realization:</span> <span className="font-bold">{r.overallRealizationPct ?? "—"}%</span></div>
                </div>
                <div className="flex justify-between items-center mt-3 pt-3 border-t border-border">
                  <span className="text-[10px] uppercase font-semibold text-muted-foreground">{r.status}</span>
                  <button onClick={() => setEditing(r)} className="text-xs font-semibold text-indigo-600 hover:underline">
                    {r.status === "completed" ? "View" : "Conduct Review →"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setEditing(null)}>
          <div className="bg-white dark:bg-card rounded-2xl p-5 w-full max-w-2xl space-y-3 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-lg">Benefits Review — +{editing.reviewPeriod}</h3>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs">Topline actual<input value={editing.toplineActual ?? ""} onChange={e => setEditing({ ...editing, toplineActual: e.target.value })} className="w-full px-2 py-1 rounded border border-input bg-background text-sm mt-1" /></label>
              <label className="text-xs">Bottomline actual<input value={editing.bottomlineActual ?? ""} onChange={e => setEditing({ ...editing, bottomlineActual: e.target.value })} className="w-full px-2 py-1 rounded border border-input bg-background text-sm mt-1" /></label>
              <label className="text-xs">Productivity actual<input value={editing.productivityActual} onChange={e => setEditing({ ...editing, productivityActual: e.target.value })} className="w-full px-2 py-1 rounded border border-input bg-background text-sm mt-1" /></label>
              <label className="text-xs">Compliance actual<input value={editing.complianceActual} onChange={e => setEditing({ ...editing, complianceActual: e.target.value })} className="w-full px-2 py-1 rounded border border-input bg-background text-sm mt-1" /></label>
              <label className="text-xs">Overall realization %<input value={editing.overallRealizationPct ?? ""} onChange={e => setEditing({ ...editing, overallRealizationPct: e.target.value })} className="w-full px-2 py-1 rounded border border-input bg-background text-sm mt-1" /></label>
              <label className="text-xs">RAG
                <select value={editing.rag} onChange={e => setEditing({ ...editing, rag: e.target.value })} className="w-full px-2 py-1 rounded border border-input bg-background text-sm mt-1">
                  <option value="green">Green</option><option value="amber">Amber</option><option value="red">Red</option>
                </select>
              </label>
            </div>
            <textarea value={editing.findings} onChange={e => setEditing({ ...editing, findings: e.target.value })} placeholder="Findings" rows={3} className="w-full px-2.5 py-1.5 rounded-md border border-input bg-background text-sm" />
            <textarea value={editing.recommendations} onChange={e => setEditing({ ...editing, recommendations: e.target.value })} placeholder="Recommendations" rows={2} className="w-full px-2.5 py-1.5 rounded-md border border-input bg-background text-sm" />
            <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={editing.status === "completed"} onChange={e => setEditing({ ...editing, status: e.target.checked ? "completed" : "in_progress" })} /> Mark as Completed</label>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setEditing(null)} className="px-3 py-1.5 rounded-md text-sm bg-muted">Cancel</button>
              <button onClick={() => void handleSave()} className="px-3 py-1.5 rounded-md text-sm font-semibold bg-indigo-600 text-white inline-flex items-center gap-1.5"><CheckCircle size={14} /> Save Review</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
