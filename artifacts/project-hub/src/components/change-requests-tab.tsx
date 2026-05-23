import { useEffect, useState } from "react";
import { GitBranch, Plus, Loader2, Lock, X, AlertTriangle, CheckCircle, XCircle, Clock } from "lucide-react";
import { useUserStore } from "../lib/store";
import { api } from "../lib/extra-api";

type CR = {
  id: number; projectId: number; crNumber: string; title: string; description: string; rationale: string;
  changeType: string; scheduleImpactDays: number; budgetImpact: string;
  scopeImpactSummary: string; riskImpactSummary: string;
  status: string; priority: string;
  raisedById: number; decidedById: number | null; decidedAt: string | null; decisionNotes: string;
  slaHours: number; dueAt: string | null; breachedAt: string | null;
  createdAt: string;
};

type Baseline = {
  id: number; projectId: number; baselineType: string; stage: string; version: number;
  snapshot: Record<string, unknown>; locked: boolean; capturedAt: string; notes: string;
};

const STATUS_PILL: Record<string, string> = {
  draft:        "bg-muted text-muted-foreground border-border",
  submitted:    "bg-primary/10 text-primary border-primary/20",
  under_review: "bg-warn/10 text-warn border-warn/20",
  approved:     "bg-success/10 text-success border-success/20",
  rejected:     "bg-destructive/10 text-destructive border-destructive/20",
  implemented:  "bg-primary/10 text-primary border-primary/20",
  withdrawn:    "bg-muted text-muted-foreground border-border",
};

const PRIORITY_TONE: Record<string, string> = {
  low: "text-success", medium: "text-primary", high: "text-warn", critical: "text-destructive",
};

export function ChangeRequestsTab({ projectId, currentStage }: { projectId: number; currentStage: string }) {
  const { userId, role } = useUserStore();
  const [crs, setCrs] = useState<CR[]>([]);
  const [baselines, setBaselines] = useState<Baseline[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [viewing, setViewing] = useState<CR | null>(null);
  const [form, setForm] = useState({
    title: "", description: "", rationale: "",
    changeType: "scope" as "scope" | "schedule" | "budget" | "resource" | "technical" | "mixed",
    scheduleImpactDays: 0, budgetImpact: "0",
    scopeImpactSummary: "", riskImpactSummary: "",
    priority: "medium" as "low" | "medium" | "high" | "critical",
  });

  async function load() {
    setLoading(true);
    try {
      const [c, b] = await Promise.all([
        api.get<CR[]>(`/api/projects/${projectId}/change-requests`),
        api.get<Baseline[]>(`/api/projects/${projectId}/baselines`),
      ]);
      setCrs(c); setBaselines(b);
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [projectId]);

  const canDecide = ["pmo", "hod", "executive_director", "chairman", "cfo"].includes(role);

  async function handleCapture() {
    const stage = currentStage || "charter";
    await api.post(`/api/projects/${projectId}/baselines`, {
      baselineType: "full", stage, snapshot: { capturedAt: new Date().toISOString() }, capturedById: userId, notes: `Captured at ${stage}`,
    });
    void load();
  }

  async function handleAdd() {
    if (!form.title || !form.description || !form.rationale) { alert("Title, description and rationale are required."); return; }
    await api.post(`/api/projects/${projectId}/change-requests`, { ...form, raisedById: userId });
    setShowAdd(false);
    setForm({ title: "", description: "", rationale: "", changeType: "scope", scheduleImpactDays: 0, budgetImpact: "0", scopeImpactSummary: "", riskImpactSummary: "", priority: "medium" });
    void load();
  }

  async function decide(cr: CR, status: "approved" | "rejected", notes: string) {
    await api.patch(`/api/change-requests/${cr.id}`, { status, decidedById: userId, decisionNotes: notes });
    setViewing(null); void load();
  }

  const lockedTypes = new Set(baselines.filter(b => b.locked).map(b => b.baselineType));

  return (
    <div className="space-y-4">
      <div className="glass-surface lift-card ph-rise rounded-2xl p-5 relative overflow-hidden">
        <span aria-hidden className="pointer-events-none absolute bottom-0 left-5 right-5 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-primary/10 border border-primary/20">
              <GitBranch size={18} className="text-primary" />
            </div>
            <div>
              <h3 className="text-[14px] font-semibold text-foreground tracking-tight">Change Requests & Baselines</h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">CR required to alter any baselined value once a gate is locked.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {baselines.length === 0 ? (
              <button onClick={() => void handleCapture()} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold bg-warn/10 text-warn border border-warn/20 hover:bg-warn/15 transition-colors">
                <Lock size={14} /> Capture & Lock Baseline
              </button>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-mono uppercase tracking-wider font-semibold bg-success/10 text-success border border-success/20">
                <Lock size={11} /> Baseline locked · v{baselines[0].version} ({baselines[0].stage})
              </span>
            )}
            <button onClick={() => setShowAdd(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm">
              <Plus size={14} /> Raise CR
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8 text-muted-foreground"><Loader2 className="animate-spin inline mr-2" size={14} /> Loading…</div>
      ) : crs.length === 0 ? (
        <div className="glass-surface lift-card ph-rise rounded-2xl p-10 text-center">
          <GitBranch size={28} className="text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No change requests raised yet.</p>
        </div>
      ) : (
        <div className="space-y-2 stagger-children">
          {crs.map(cr => {
            const pill = STATUS_PILL[cr.status] ?? STATUS_PILL.draft;
            const priTone = PRIORITY_TONE[cr.priority] ?? PRIORITY_TONE.medium;
            const overdue = cr.dueAt && !cr.decidedAt && new Date(cr.dueAt) < new Date();
            return (
              <div key={cr.id}
                   onClick={() => setViewing(cr)}
                   className="glass-surface lift-card ph-rise rounded-2xl p-4 cursor-pointer group">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                      <span className="text-[11px] font-mono font-semibold text-primary tracking-wider">{cr.crNumber}</span>
                      <span className={`inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-sm border ${pill}`}>
                        {cr.status.replace(/_/g, " ")}
                      </span>
                      <span className={`inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider font-semibold ${priTone}`}>● {cr.priority}</span>
                      <span className="text-[10px] uppercase font-mono tracking-wider text-muted-foreground">{cr.changeType}</span>
                      {overdue && <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider font-semibold text-destructive"><AlertTriangle size={10} /> SLA breached</span>}
                    </div>
                    <h4 className="font-semibold text-foreground tracking-tight group-hover:text-primary transition-colors">{cr.title}</h4>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{cr.description}</p>
                  </div>
                  <div className="text-right text-xs flex-shrink-0">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">Schedule</div>
                    <div className="font-mono font-semibold text-foreground">{cr.scheduleImpactDays > 0 ? `+${cr.scheduleImpactDays}d` : `${cr.scheduleImpactDays}d`}</div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono mt-1.5">Budget</div>
                    <div className="font-mono font-semibold text-foreground">{Number(cr.budgetImpact).toLocaleString()}</div>
                  </div>
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
              <h3 className="font-semibold text-[15px] text-foreground tracking-tight">Raise Change Request</h3>
              <button onClick={() => setShowAdd(false)} className="w-8 h-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"><X size={15} /></button>
            </div>
            <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Title" className="w-full px-2.5 py-1.5 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40" />
            <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Description of the change" rows={3} className="w-full px-2.5 py-1.5 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40" />
            <textarea value={form.rationale} onChange={e => setForm({ ...form, rationale: e.target.value })} placeholder="Rationale / business justification" rows={2} className="w-full px-2.5 py-1.5 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40" />
            <div className="grid grid-cols-3 gap-2">
              <select value={form.changeType} onChange={e => setForm({ ...form, changeType: e.target.value as typeof form.changeType })} className="px-2 py-1.5 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40">
                <option value="scope">Scope</option><option value="schedule">Schedule</option><option value="budget">Budget</option>
                <option value="resource">Resource</option><option value="technical">Technical</option><option value="mixed">Mixed</option>
              </select>
              <select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value as typeof form.priority })} className="px-2 py-1.5 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40">
                <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option>
              </select>
              <input type="number" value={form.scheduleImpactDays} onChange={e => setForm({ ...form, scheduleImpactDays: Number(e.target.value) })} placeholder="Schedule Δ days" className="px-2 py-1.5 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40" />
            </div>
            <input value={form.budgetImpact} onChange={e => setForm({ ...form, budgetImpact: e.target.value })} placeholder="Budget impact (signed amount)" className="w-full px-2.5 py-1.5 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40" />
            <textarea value={form.scopeImpactSummary} onChange={e => setForm({ ...form, scopeImpactSummary: e.target.value })} placeholder="Scope impact summary" rows={2} className="w-full px-2.5 py-1.5 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40" />
            <textarea value={form.riskImpactSummary} onChange={e => setForm({ ...form, riskImpactSummary: e.target.value })} placeholder="Risk impact summary" rows={2} className="w-full px-2.5 py-1.5 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40" />
            {lockedTypes.size > 0 && (
              <div className="text-xs p-2.5 rounded-md bg-warn/10 text-warn border border-warn/20 flex items-start gap-1.5">
                <Lock size={12} className="mt-px flex-shrink-0" />
                <span>Locked baselines exist for: <strong>{Array.from(lockedTypes).join(", ")}</strong>. CR approval is required to deviate.</span>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2 border-t border-border/60">
              <button onClick={() => setShowAdd(false)} className="px-3 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">Cancel</button>
              <button onClick={() => void handleAdd()} className="px-3 py-1.5 rounded-md text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm">Submit CR</button>
            </div>
          </div>
        </div>
      )}

      {viewing && (
        <CrDetail cr={viewing} onClose={() => setViewing(null)} canDecide={canDecide} onDecide={decide} />
      )}
    </div>
  );
}

function CrDetail({ cr, onClose, canDecide, onDecide }: { cr: CR; onClose: () => void; canDecide: boolean; onDecide: (cr: CR, status: "approved" | "rejected", notes: string) => Promise<void>; }) {
  const [notes, setNotes] = useState("");
  const isPending = cr.status === "submitted" || cr.status === "under_review";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200" onClick={onClose}>
      <div className="bg-popover text-popover-foreground border border-popover-border shadow-2xl rounded-2xl p-5 w-full max-w-xl space-y-3 max-h-[90vh] overflow-y-auto scrollbar-thin ph-rise" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <span className="text-[11px] font-mono font-semibold text-primary tracking-wider">{cr.crNumber}</span>
            <h3 className="font-semibold text-[15px] text-foreground tracking-tight">{cr.title}</h3>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"><X size={15} /></button>
        </div>
        <div className="text-sm text-foreground whitespace-pre-wrap">{cr.description}</div>
        <div className="text-xs rounded-md bg-muted/50 border border-border p-2.5"><span className="font-semibold text-foreground">Rationale:</span> <span className="text-muted-foreground">{cr.rationale}</span></div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-md bg-muted/50 border border-border p-2.5"><div className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">Schedule</div><div className="font-mono font-semibold text-foreground text-base mt-1">{cr.scheduleImpactDays}d</div></div>
          <div className="rounded-md bg-muted/50 border border-border p-2.5"><div className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">Budget</div><div className="font-mono font-semibold text-foreground text-base mt-1">{Number(cr.budgetImpact).toLocaleString()}</div></div>
        </div>
        {cr.scopeImpactSummary && <div className="text-xs"><span className="font-semibold text-foreground">Scope impact:</span> <span className="text-muted-foreground">{cr.scopeImpactSummary}</span></div>}
        {cr.riskImpactSummary && <div className="text-xs"><span className="font-semibold text-foreground">Risk impact:</span> <span className="text-muted-foreground">{cr.riskImpactSummary}</span></div>}
        <div className="text-[11px] flex items-center gap-1.5 font-mono text-muted-foreground"><Clock size={11} /> SLA: {cr.slaHours}h{cr.dueAt ? ` · due ${new Date(cr.dueAt).toLocaleString()}` : ""}</div>
        {cr.decidedAt && <div className="text-xs"><span className="font-semibold text-foreground">Decision:</span> {cr.status} on {new Date(cr.decidedAt).toLocaleString()}{cr.decisionNotes ? ` — ${cr.decisionNotes}` : ""}</div>}
        {canDecide && isPending && (
          <div className="border-t border-border/60 pt-3 space-y-2">
            <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Decision notes (optional)" rows={2} className="w-full px-2.5 py-1.5 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40" />
            <div className="flex justify-end gap-2">
              <button onClick={() => void onDecide(cr, "rejected", notes)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold bg-destructive/10 text-destructive border border-destructive/20 hover:bg-destructive/15 transition-colors"><XCircle size={14} /> Reject</button>
              <button onClick={() => void onDecide(cr, "approved", notes)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold bg-success text-primary-foreground hover:bg-success/90 transition-colors shadow-sm"><CheckCircle size={14} /> Approve</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
