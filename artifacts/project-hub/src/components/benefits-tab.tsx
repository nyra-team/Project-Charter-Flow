import { useEffect, useState } from "react";
import { TrendingUp, Calendar, CheckCircle, Plus, Loader2, X } from "lucide-react";
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

const RAG_PILL: Record<string, string> = {
  green: "bg-success/10 text-success border-success/20",
  amber: "bg-warn/10 text-warn border-warn/20",
  red:   "bg-destructive/10 text-destructive border-destructive/20",
};
const RAG_LABEL: Record<string, string> = { green: "On Track", amber: "At Risk", red: "Off Track" };

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
      <div className="glass-surface lift-card ph-rise rounded-2xl p-5 relative overflow-hidden">
        <span aria-hidden className="pointer-events-none absolute bottom-0 left-5 right-5 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-primary/10 border border-primary/20">
              <TrendingUp size={18} className="text-primary" />
            </div>
            <div>
              <h3 className="text-[14px] font-semibold text-foreground tracking-tight">Benefits Realization</h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">Post-implementation reviews at +3, +6 and +12 months</p>
            </div>
          </div>
          {reviews.length === 0 && (
            <div className="flex gap-2 items-center">
              <input type="date" value={goLiveDate} onChange={e => setGoLiveDate(e.target.value)} className="px-2.5 py-1.5 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40" />
              <button onClick={() => void handleInit()} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm">
                <Plus size={14} /> Initialize Reviews
              </button>
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8 text-muted-foreground"><Loader2 className="animate-spin inline mr-2" size={14} /> Loading…</div>
      ) : reviews.length === 0 ? (
        <div className="glass-surface lift-card ph-rise rounded-2xl p-10 text-center">
          <Calendar size={28} className="text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No benefits reviews scheduled. Pick the Go-Live date above to initialise the 3/6/12-month review cycle.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 stagger-children">
          {reviews.map(r => {
            const overdue = new Date(r.scheduledDate) < new Date() && r.status !== "completed";
            const pill = RAG_PILL[r.rag] ?? RAG_PILL.amber;
            return (
              <div key={r.id} className="glass-surface lift-card ph-rise rounded-2xl p-4 group">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-2xl font-semibold font-mono num-tabular tracking-tight text-primary">+{r.reviewPeriod}</span>
                  <span className={`inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-sm border ${pill}`}>
                    <span className="w-1.5 h-1.5 rounded-full bg-current opacity-80" />
                    {RAG_LABEL[r.rag] ?? r.rag}
                  </span>
                </div>
                <div className="text-[11px] text-muted-foreground mb-3 font-mono">
                  Scheduled · {r.scheduledDate}
                  {overdue && <span className="ml-2 text-destructive font-semibold">Overdue</span>}
                </div>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between"><span className="text-muted-foreground">Topline</span><span className="font-mono font-semibold text-foreground">{r.toplineActual ?? "—"} <span className="text-muted-foreground">/ {r.toplineProjected ?? "—"}</span></span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Bottomline</span><span className="font-mono font-semibold text-foreground">{r.bottomlineActual ?? "—"} <span className="text-muted-foreground">/ {r.bottomlineProjected ?? "—"}</span></span></div>
                  <div className="flex justify-between items-baseline pt-1"><span className="text-muted-foreground">Realization</span><span className="text-xl font-mono font-semibold text-foreground">{r.overallRealizationPct ?? "—"}<span className="text-xs text-muted-foreground">%</span></span></div>
                </div>
                <div className="flex justify-between items-center mt-3 pt-3 border-t border-border/60">
                  <span className="text-[10px] uppercase font-mono tracking-wider text-muted-foreground">{r.status}</span>
                  <button onClick={() => setEditing(r)} className="text-xs font-semibold text-primary hover:text-primary/80 transition-colors">
                    {r.status === "completed" ? "View →" : "Conduct Review →"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200" onClick={() => setEditing(null)}>
          <div className="bg-popover text-popover-foreground border border-popover-border shadow-2xl rounded-2xl p-5 w-full max-w-2xl space-y-3 max-h-[90vh] overflow-y-auto scrollbar-thin ph-rise" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-[15px] text-foreground tracking-tight">Benefits Review — +{editing.reviewPeriod}</h3>
              <button onClick={() => setEditing(null)} className="w-8 h-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"><X size={15} /></button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Topline actual<input value={editing.toplineActual ?? ""} onChange={e => setEditing({ ...editing, toplineActual: e.target.value })} className="w-full px-2.5 py-1.5 rounded-md border border-input bg-background text-sm mt-1 focus:outline-none focus:ring-2 focus:ring-ring/40 normal-case tracking-normal text-foreground font-normal" /></label>
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Bottomline actual<input value={editing.bottomlineActual ?? ""} onChange={e => setEditing({ ...editing, bottomlineActual: e.target.value })} className="w-full px-2.5 py-1.5 rounded-md border border-input bg-background text-sm mt-1 focus:outline-none focus:ring-2 focus:ring-ring/40 normal-case tracking-normal text-foreground font-normal" /></label>
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Productivity actual<input value={editing.productivityActual} onChange={e => setEditing({ ...editing, productivityActual: e.target.value })} className="w-full px-2.5 py-1.5 rounded-md border border-input bg-background text-sm mt-1 focus:outline-none focus:ring-2 focus:ring-ring/40 normal-case tracking-normal text-foreground font-normal" /></label>
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Compliance actual<input value={editing.complianceActual} onChange={e => setEditing({ ...editing, complianceActual: e.target.value })} className="w-full px-2.5 py-1.5 rounded-md border border-input bg-background text-sm mt-1 focus:outline-none focus:ring-2 focus:ring-ring/40 normal-case tracking-normal text-foreground font-normal" /></label>
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Overall realization %<input value={editing.overallRealizationPct ?? ""} onChange={e => setEditing({ ...editing, overallRealizationPct: e.target.value })} className="w-full px-2.5 py-1.5 rounded-md border border-input bg-background text-sm mt-1 focus:outline-none focus:ring-2 focus:ring-ring/40 normal-case tracking-normal text-foreground font-normal" /></label>
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">RAG
                <select value={editing.rag} onChange={e => setEditing({ ...editing, rag: e.target.value })} className="w-full px-2.5 py-1.5 rounded-md border border-input bg-background text-sm mt-1 focus:outline-none focus:ring-2 focus:ring-ring/40 normal-case tracking-normal text-foreground font-normal">
                  <option value="green">Green</option><option value="amber">Amber</option><option value="red">Red</option>
                </select>
              </label>
            </div>
            <textarea value={editing.findings} onChange={e => setEditing({ ...editing, findings: e.target.value })} placeholder="Findings" rows={3} className="w-full px-2.5 py-1.5 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40" />
            <textarea value={editing.recommendations} onChange={e => setEditing({ ...editing, recommendations: e.target.value })} placeholder="Recommendations" rows={2} className="w-full px-2.5 py-1.5 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40" />
            <label className="text-xs flex items-center gap-2 text-foreground"><input type="checkbox" checked={editing.status === "completed"} onChange={e => setEditing({ ...editing, status: e.target.checked ? "completed" : "in_progress" })} className="accent-primary" /> Mark as Completed</label>
            <div className="flex justify-end gap-2 pt-2 border-t border-border/60">
              <button onClick={() => setEditing(null)} className="px-3 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">Cancel</button>
              <button onClick={() => void handleSave()} className="px-3 py-1.5 rounded-md text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors inline-flex items-center gap-1.5 shadow-sm"><CheckCircle size={14} /> Save Review</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
