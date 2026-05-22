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

const STATUS_COLOR: Record<string, { bg: string; color: string }> = {
  draft: { bg: "#F1F5F9", color: "#64748B" },
  submitted: { bg: "#EFF6FF", color: "#2563EB" },
  under_review: { bg: "#FFFBEB", color: "#B45309" },
  approved: { bg: "#ECFDF5", color: "#15803D" },
  rejected: { bg: "#FEE2E2", color: "#991B1B" },
  implemented: { bg: "#F5F3FF", color: "#6D28D9" },
  withdrawn: { bg: "#F1F5F9", color: "#475569" },
};

const PRIORITY_ICON: Record<string, { color: string; label: string }> = {
  low: { color: "#10B981", label: "Low" }, medium: { color: "#3B82F6", label: "Med" },
  high: { color: "#F59E0B", label: "High" }, critical: { color: "#EF4444", label: "Critical" },
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
      <div className="rounded-2xl p-5 bg-white dark:bg-card border border-border flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-gray-900 dark:text-foreground flex items-center gap-2"><GitBranch size={16} /> Change Requests & Baselines</h3>
          <p className="text-xs text-muted-foreground mt-1">CR required to alter any baselined value once a gate is locked.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {baselines.length === 0 ? (
            <button onClick={() => void handleCapture()} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold bg-amber-100 text-amber-900 hover:bg-amber-200">
              <Lock size={14} /> Capture & Lock Baseline
            </button>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
              <Lock size={12} /> Baseline locked · v{baselines[0].version} ({baselines[0].stage})
            </span>
          )}
          <button onClick={() => setShowAdd(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold bg-indigo-600 text-white">
            <Plus size={14} /> Raise CR
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8 text-muted-foreground"><Loader2 className="animate-spin inline mr-2" size={14} /> Loading…</div>
      ) : crs.length === 0 ? (
        <div className="rounded-2xl p-8 text-center bg-white dark:bg-card border border-border">
          <GitBranch size={28} className="text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No change requests raised.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {crs.map(cr => {
            const col = STATUS_COLOR[cr.status] ?? STATUS_COLOR.draft;
            const pri = PRIORITY_ICON[cr.priority] ?? PRIORITY_ICON.medium;
            const overdue = cr.dueAt && !cr.decidedAt && new Date(cr.dueAt) < new Date();
            return (
              <div key={cr.id} className="rounded-xl p-4 bg-white dark:bg-card border border-border hover:shadow-sm cursor-pointer" onClick={() => setViewing(cr)}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-mono font-bold text-indigo-600">{cr.crNumber}</span>
                      <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full" style={{ background: col.bg, color: col.color }}>{cr.status.replace(/_/g, " ")}</span>
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase" style={{ color: pri.color }}>● {pri.label}</span>
                      <span className="text-[10px] uppercase text-muted-foreground">{cr.changeType}</span>
                      {overdue && <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-red-600"><AlertTriangle size={10} /> SLA breached</span>}
                    </div>
                    <h4 className="font-semibold text-gray-900 dark:text-foreground">{cr.title}</h4>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{cr.description}</p>
                  </div>
                  <div className="text-right text-xs">
                    <div className="text-muted-foreground">Schedule</div>
                    <div className="font-bold">{cr.scheduleImpactDays > 0 ? `+${cr.scheduleImpactDays}d` : `${cr.scheduleImpactDays}d`}</div>
                    <div className="text-muted-foreground mt-1">Budget</div>
                    <div className="font-bold">{Number(cr.budgetImpact).toLocaleString()}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowAdd(false)}>
          <div className="bg-white dark:bg-card rounded-2xl p-5 w-full max-w-xl space-y-3 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between"><h3 className="font-bold text-lg">Raise Change Request</h3><button onClick={() => setShowAdd(false)}><X size={16} /></button></div>
            <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Title" className="w-full px-2.5 py-1.5 rounded-md border border-input bg-background text-sm" />
            <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Description of the change" rows={3} className="w-full px-2.5 py-1.5 rounded-md border border-input bg-background text-sm" />
            <textarea value={form.rationale} onChange={e => setForm({ ...form, rationale: e.target.value })} placeholder="Rationale / business justification" rows={2} className="w-full px-2.5 py-1.5 rounded-md border border-input bg-background text-sm" />
            <div className="grid grid-cols-3 gap-2">
              <select value={form.changeType} onChange={e => setForm({ ...form, changeType: e.target.value as typeof form.changeType })} className="px-2 py-1 rounded border border-input bg-background text-sm">
                <option value="scope">Scope</option><option value="schedule">Schedule</option><option value="budget">Budget</option>
                <option value="resource">Resource</option><option value="technical">Technical</option><option value="mixed">Mixed</option>
              </select>
              <select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value as typeof form.priority })} className="px-2 py-1 rounded border border-input bg-background text-sm">
                <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option>
              </select>
              <input type="number" value={form.scheduleImpactDays} onChange={e => setForm({ ...form, scheduleImpactDays: Number(e.target.value) })} placeholder="Schedule Δ days" className="px-2 py-1 rounded border border-input bg-background text-sm" />
            </div>
            <input value={form.budgetImpact} onChange={e => setForm({ ...form, budgetImpact: e.target.value })} placeholder="Budget impact (signed amount)" className="w-full px-2.5 py-1.5 rounded-md border border-input bg-background text-sm" />
            <textarea value={form.scopeImpactSummary} onChange={e => setForm({ ...form, scopeImpactSummary: e.target.value })} placeholder="Scope impact summary" rows={2} className="w-full px-2.5 py-1.5 rounded-md border border-input bg-background text-sm" />
            <textarea value={form.riskImpactSummary} onChange={e => setForm({ ...form, riskImpactSummary: e.target.value })} placeholder="Risk impact summary" rows={2} className="w-full px-2.5 py-1.5 rounded-md border border-input bg-background text-sm" />
            {lockedTypes.size > 0 && (
              <div className="text-xs p-2 rounded bg-amber-50 text-amber-800 border border-amber-200">
                <Lock size={11} className="inline mr-1" />
                Locked baselines exist for: {Array.from(lockedTypes).join(", ")}. CR approval is required.
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowAdd(false)} className="px-3 py-1.5 rounded-md text-sm bg-muted">Cancel</button>
              <button onClick={() => void handleAdd()} className="px-3 py-1.5 rounded-md text-sm font-semibold bg-indigo-600 text-white">Submit CR</button>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-card rounded-2xl p-5 w-full max-w-xl space-y-3 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs font-mono font-bold text-indigo-600">{cr.crNumber}</span>
            <h3 className="font-bold text-lg">{cr.title}</h3>
          </div>
          <button onClick={onClose}><X size={16} /></button>
        </div>
        <div className="text-sm text-gray-700 dark:text-gray-200 whitespace-pre-wrap">{cr.description}</div>
        <div className="text-xs"><strong>Rationale:</strong> {cr.rationale}</div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded bg-muted p-2"><div className="text-muted-foreground">Schedule</div><div className="font-bold">{cr.scheduleImpactDays}d</div></div>
          <div className="rounded bg-muted p-2"><div className="text-muted-foreground">Budget</div><div className="font-bold">{Number(cr.budgetImpact).toLocaleString()}</div></div>
        </div>
        {cr.scopeImpactSummary && <div className="text-xs"><strong>Scope impact:</strong> {cr.scopeImpactSummary}</div>}
        {cr.riskImpactSummary && <div className="text-xs"><strong>Risk impact:</strong> {cr.riskImpactSummary}</div>}
        <div className="text-xs flex items-center gap-2"><Clock size={11} /> SLA: {cr.slaHours}h{cr.dueAt ? ` · due ${new Date(cr.dueAt).toLocaleString()}` : ""}</div>
        {cr.decidedAt && <div className="text-xs"><strong>Decision:</strong> {cr.status} on {new Date(cr.decidedAt).toLocaleString()}{cr.decisionNotes ? ` — ${cr.decisionNotes}` : ""}</div>}
        {canDecide && isPending && (
          <div className="border-t border-border pt-3 space-y-2">
            <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Decision notes (optional)" rows={2} className="w-full px-2.5 py-1.5 rounded-md border border-input bg-background text-sm" />
            <div className="flex justify-end gap-2">
              <button onClick={() => void onDecide(cr, "rejected", notes)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold bg-red-100 text-red-700 hover:bg-red-200"><XCircle size={14} /> Reject</button>
              <button onClick={() => void onDecide(cr, "approved", notes)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700"><CheckCircle size={14} /> Approve</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
