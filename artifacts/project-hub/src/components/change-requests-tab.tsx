import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  GitBranch, Plus, Loader2, Lock, X, AlertTriangle, CheckCircle, XCircle, Clock,
  Calendar, IndianRupee, Layers, ListFilter, FileStack,
} from "lucide-react";
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

type Tone = "primary" | "success" | "warn" | "destructive" | "muted";

const TONE: Record<Tone, string> = {
  primary: "bg-primary/10 text-primary border-primary/20",
  success: "bg-success/10 text-success border-success/20",
  warn: "bg-warn/10 text-warn border-warn/20",
  destructive: "bg-destructive/10 text-destructive border-destructive/20",
  muted: "bg-muted text-muted-foreground border-border",
};

const STATUS_TONE: Record<string, Tone> = {
  draft: "muted", submitted: "primary", under_review: "warn",
  approved: "success", rejected: "destructive", implemented: "primary", withdrawn: "muted",
};

const PRIORITY_TONE: Record<string, Tone> = {
  low: "success", medium: "primary", high: "warn", critical: "destructive",
};

const INPUT =
  "w-full px-2.5 py-1.5 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40";

type FilterKey = "all" | "pending" | "approved" | "rejected" | "breached";

const isPendingStatus = (s: string) => s === "submitted" || s === "under_review";
function isBreached(cr: CR) {
  return !cr.decidedAt && isPendingStatus(cr.status) && Boolean(cr.breachedAt || (cr.dueAt && new Date(cr.dueAt) < new Date()));
}

function signedDays(n: number) {
  return n > 0 ? `+${n}d` : `${n}d`;
}
function signedMoney(n: number) {
  const abs = Math.abs(n).toLocaleString("en-IN");
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}₹${abs}`;
}
function impactTone(n: number): Tone {
  return n > 0 ? "warn" : n < 0 ? "success" : "muted";
}

export function ChangeRequestsTab({ projectId, currentStage }: { projectId: number; currentStage: string }) {
  const { userId, role } = useUserStore();
  const [crs, setCrs] = useState<CR[]>([]);
  const [baselines, setBaselines] = useState<Baseline[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [viewing, setViewing] = useState<CR | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
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
    const stage = currentStage || "investment_authorization";
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

  // ── Derived summary + filtering ──────────────────────────────────────────
  const stats = useMemo(() => {
    const pending = crs.filter(c => isPendingStatus(c.status));
    const approved = crs.filter(c => c.status === "approved");
    return {
      total: crs.length,
      pending: pending.length,
      approved: approved.length,
      rejected: crs.filter(c => c.status === "rejected").length,
      breached: crs.filter(isBreached).length,
      netSchedule: approved.reduce((s, c) => s + (Number(c.scheduleImpactDays) || 0), 0),
      netBudget: approved.reduce((s, c) => s + (Number(c.budgetImpact) || 0), 0),
    };
  }, [crs]);

  const filtered = useMemo(() => {
    switch (filter) {
      case "pending": return crs.filter(c => isPendingStatus(c.status));
      case "approved": return crs.filter(c => c.status === "approved");
      case "rejected": return crs.filter(c => c.status === "rejected");
      case "breached": return crs.filter(isBreached);
      default: return crs;
    }
  }, [crs, filter]);

  const FILTERS: { key: FilterKey; label: string; count: number }[] = [
    { key: "all", label: "All", count: stats.total },
    { key: "pending", label: "Pending", count: stats.pending },
    { key: "approved", label: "Approved", count: stats.approved },
    { key: "rejected", label: "Rejected", count: stats.rejected },
    { key: "breached", label: "SLA breached", count: stats.breached },
  ];

  return (
    <div className="space-y-4">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="glass-surface lift-card ph-rise rounded-2xl p-5 relative overflow-hidden">
        <span aria-hidden className="pointer-events-none absolute bottom-0 left-5 right-5 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-primary/10 border border-primary/20">
              <GitBranch size={18} className="text-primary" />
            </div>
            <div>
              <h3 className="text-[14px] font-semibold text-foreground tracking-tight">Change Requests &amp; Baselines</h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">CR required to alter any baselined value once a gate is locked.</p>
            </div>
          </div>
          <button onClick={() => setShowAdd(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm">
            <Plus size={14} /> Raise CR
          </button>
        </div>

        {/* Summary tiles */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 mt-4">
          <StatTile label="Total" value={stats.total} icon={FileStack} />
          <StatTile label="Pending" value={stats.pending} tone={stats.pending ? "warn" : "muted"} icon={Clock} />
          <StatTile label="Approved" value={stats.approved} tone={stats.approved ? "success" : "muted"} icon={CheckCircle} />
          <StatTile label="SLA breached" value={stats.breached} tone={stats.breached ? "destructive" : "muted"} icon={AlertTriangle} />
          <StatTile label="Net schedule" value={signedDays(stats.netSchedule)} tone={impactTone(stats.netSchedule)} icon={Calendar} sub="approved" />
          <StatTile label="Net budget" value={signedMoney(stats.netBudget)} tone={impactTone(stats.netBudget)} icon={IndianRupee} sub="approved" />
        </div>
      </div>

      {/* ── Baselines strip ─────────────────────────────────────────────── */}
      <div className="glass-surface lift-card ph-rise rounded-2xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <Layers size={13} className="text-primary" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground">Baselines</span>
            <span className="text-[11px] text-muted-foreground">· {baselines.length} captured</span>
          </div>
          <button onClick={() => void handleCapture()} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-warn/10 text-warn border border-warn/20 hover:bg-warn/15 transition-colors">
            <Lock size={11} /> {baselines.length === 0 ? "Capture & Lock Baseline" : "Capture new baseline"}
          </button>
        </div>
        {baselines.length === 0 ? (
          <p className="text-[11px] text-muted-foreground italic">No baseline locked yet — capture one at the current gate to start tracking deviations.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {baselines.map(b => (
              <span key={b.id} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-mono bg-muted/50 border border-border text-foreground" title={`Captured ${new Date(b.capturedAt).toLocaleString()}${b.notes ? ` — ${b.notes}` : ""}`}>
                {b.locked && <Lock size={10} className="text-success" />}
                <span className="font-semibold">v{b.version}</span>
                <span className="text-muted-foreground">· {b.baselineType} · {b.stage}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── Filter chips ────────────────────────────────────────────────── */}
      {crs.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <ListFilter size={13} className="text-muted-foreground mr-0.5" />
          {FILTERS.map(f => {
            const active = filter === f.key;
            return (
              <button key={f.key} onClick={() => setFilter(f.key)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
                  active ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border hover:border-foreground/30 hover:text-foreground"
                }`}>
                {f.label}
                <span className={`num-tabular ${active ? "opacity-90" : "opacity-70"}`}>{f.count}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* ── CR list ─────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="text-center py-8 text-muted-foreground"><Loader2 className="animate-spin inline mr-2" size={14} /> Loading…</div>
      ) : crs.length === 0 ? (
        <div className="glass-surface lift-card ph-rise rounded-2xl p-10 text-center">
          <GitBranch size={28} className="text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No change requests raised yet.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass-surface rounded-2xl p-8 text-center text-sm text-muted-foreground">No CRs match this filter.</div>
      ) : (
        <div className="space-y-2 stagger-children">
          {filtered.map(cr => <CrCard key={cr.id} cr={cr} onClick={() => setViewing(cr)} />)}
        </div>
      )}

      {showAdd && (
        <Overlay title="Raise Change Request" onClose={() => setShowAdd(false)}
          footer={
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowAdd(false)} className="px-3 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">Cancel</button>
              <button onClick={() => void handleAdd()} className="px-3 py-1.5 rounded-md text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm">Submit CR</button>
            </div>
          }>
          <Field label="Title">
            <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Short summary of the change" className={INPUT} />
          </Field>
          <Field label="Description">
            <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="What is changing and why now" rows={3} className={INPUT} />
          </Field>
          <Field label="Rationale" hint="Business justification — shown to approvers.">
            <textarea value={form.rationale} onChange={e => setForm({ ...form, rationale: e.target.value })} placeholder="Why this change is necessary" rows={2} className={INPUT} />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Field label="Type">
              <select value={form.changeType} onChange={e => setForm({ ...form, changeType: e.target.value as typeof form.changeType })} className={INPUT}>
                <option value="scope">Scope</option><option value="schedule">Schedule</option><option value="budget">Budget</option>
                <option value="resource">Resource</option><option value="technical">Technical</option><option value="mixed">Mixed</option>
              </select>
            </Field>
            <Field label="Priority">
              <select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value as typeof form.priority })} className={INPUT}>
                <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option>
              </select>
            </Field>
            <Field label="Schedule Δ (days)">
              <input type="number" value={form.scheduleImpactDays} onChange={e => setForm({ ...form, scheduleImpactDays: Number(e.target.value) })} className={INPUT} />
            </Field>
          </div>
          <Field label="Budget impact" hint="Signed amount — positive adds cost, negative saves.">
            <input value={form.budgetImpact} onChange={e => setForm({ ...form, budgetImpact: e.target.value })} placeholder="e.g. 250000 or -50000" className={INPUT} />
          </Field>
          {/* Live impact preview */}
          <div className="flex items-center gap-2">
            <ImpactBadge icon={Calendar} label={signedDays(Number(form.scheduleImpactDays) || 0)} tone={impactTone(Number(form.scheduleImpactDays) || 0)} />
            <ImpactBadge icon={IndianRupee} label={signedMoney(Number(form.budgetImpact) || 0)} tone={impactTone(Number(form.budgetImpact) || 0)} />
          </div>
          <Field label="Scope impact">
            <textarea value={form.scopeImpactSummary} onChange={e => setForm({ ...form, scopeImpactSummary: e.target.value })} placeholder="How scope is affected" rows={2} className={INPUT} />
          </Field>
          <Field label="Risk impact">
            <textarea value={form.riskImpactSummary} onChange={e => setForm({ ...form, riskImpactSummary: e.target.value })} placeholder="New or changed risks" rows={2} className={INPUT} />
          </Field>
          {lockedTypes.size > 0 && (
            <div className="text-xs p-2.5 rounded-md bg-warn/10 text-warn border border-warn/20 flex items-start gap-1.5">
              <Lock size={12} className="mt-px flex-shrink-0" />
              <span>Locked baselines exist for: <strong>{Array.from(lockedTypes).join(", ")}</strong>. CR approval is required to deviate.</span>
            </div>
          )}
        </Overlay>
      )}

      {viewing && (
        <CrDetail cr={viewing} onClose={() => setViewing(null)} canDecide={canDecide} onDecide={decide} />
      )}
    </div>
  );
}

// ── Small building blocks ────────────────────────────────────────────────
function StatTile({ label, value, tone = "muted", icon: Icon, sub }: {
  label: string; value: number | string; tone?: Tone; icon: typeof Clock; sub?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-muted/30 p-2.5">
      <div className="flex items-center gap-1.5 mb-1">
        <span className={`w-5 h-5 rounded-md flex items-center justify-center border ${TONE[tone]}`}><Icon size={11} /></span>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">{label}</span>
      </div>
      <div className="text-lg font-semibold num-tabular text-foreground leading-none">{value}</div>
      {sub && <div className="text-[9px] uppercase tracking-wider text-muted-foreground/70 mt-1">{sub}</div>}
    </div>
  );
}

function ImpactBadge({ icon: Icon, label, tone }: { icon: typeof Clock; label: string; tone: Tone }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-mono font-semibold border ${TONE[tone]}`}>
      <Icon size={11} /> {label}
    </span>
  );
}

function slaBadge(cr: CR): { tone: Tone; label: string; icon: typeof Clock } | null {
  if (cr.decidedAt) return null;
  if (isBreached(cr)) return { tone: "destructive", label: "SLA breached", icon: AlertTriangle };
  if (cr.dueAt) {
    const hrs = Math.max(0, Math.round((new Date(cr.dueAt).getTime() - Date.now()) / 3.6e6));
    return { tone: hrs <= 24 ? "warn" : "muted", label: `Due in ${hrs}h`, icon: Clock };
  }
  return null;
}

function CrCard({ cr, onClick }: { cr: CR; onClick: () => void }) {
  const statusTone = STATUS_TONE[cr.status] ?? "muted";
  const priTone = PRIORITY_TONE[cr.priority] ?? "primary";
  const sla = slaBadge(cr);
  const sched = Number(cr.scheduleImpactDays) || 0;
  const budget = Number(cr.budgetImpact) || 0;
  return (
    <div onClick={onClick} className="glass-surface lift-card ph-rise rounded-2xl p-4 cursor-pointer group">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <span className="text-[11px] font-mono font-semibold text-primary tracking-wider">{cr.crNumber}</span>
            <span className={`inline-flex items-center text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-sm border ${TONE[statusTone]}`}>{cr.status.replace(/_/g, " ")}</span>
            <span className={`inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-sm border ${TONE[priTone]}`}>● {cr.priority}</span>
            <span className="text-[10px] uppercase font-mono tracking-wider text-muted-foreground">{cr.changeType}</span>
            {sla && (
              <span className={`inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-sm border ${TONE[sla.tone]}`}>
                <sla.icon size={10} /> {sla.label}
              </span>
            )}
          </div>
          <h4 className="font-semibold text-foreground tracking-tight group-hover:text-primary transition-colors">{cr.title}</h4>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{cr.description}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          <ImpactBadge icon={Calendar} label={signedDays(sched)} tone={impactTone(sched)} />
          <ImpactBadge icon={IndianRupee} label={signedMoney(budget)} tone={impactTone(budget)} />
        </div>
      </div>
    </div>
  );
}

function Overlay({ title, eyebrow, onClose, children, footer }: {
  title: string; eyebrow?: string; onClose: () => void; children: ReactNode; footer?: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200" onClick={onClose}>
      <div className="bg-popover text-popover-foreground border border-popover-border shadow-2xl rounded-2xl p-5 w-full max-w-xl flex flex-col max-h-[90vh] ph-rise" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            {eyebrow && <span className="text-[11px] font-mono font-semibold text-primary tracking-wider">{eyebrow}</span>}
            <h3 className="font-semibold text-[15px] text-foreground tracking-tight">{title}</h3>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex-shrink-0"><X size={15} /></button>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin space-y-3 pr-0.5">{children}</div>
        {footer && <div className="pt-3 mt-3 border-t border-border/60">{footer}</div>}
      </div>
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <p className="text-[10px] text-muted-foreground mt-1">{hint}</p>}
    </label>
  );
}

function CrDetail({ cr, onClose, canDecide, onDecide }: { cr: CR; onClose: () => void; canDecide: boolean; onDecide: (cr: CR, status: "approved" | "rejected", notes: string) => Promise<void>; }) {
  const [notes, setNotes] = useState("");
  const isPending = isPendingStatus(cr.status);
  const statusTone = STATUS_TONE[cr.status] ?? "muted";
  const priTone = PRIORITY_TONE[cr.priority] ?? "primary";
  const sched = Number(cr.scheduleImpactDays) || 0;
  const budget = Number(cr.budgetImpact) || 0;
  return (
    <Overlay eyebrow={cr.crNumber} title={cr.title} onClose={onClose}
      footer={canDecide && isPending ? (
        <div className="space-y-2">
          <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Decision notes (optional)" rows={2} className={INPUT} />
          <div className="flex justify-end gap-2">
            <button onClick={() => void onDecide(cr, "rejected", notes)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold bg-destructive/10 text-destructive border border-destructive/20 hover:bg-destructive/15 transition-colors"><XCircle size={14} /> Reject</button>
            <button onClick={() => void onDecide(cr, "approved", notes)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold bg-success text-primary-foreground hover:bg-success/90 transition-colors shadow-sm"><CheckCircle size={14} /> Approve</button>
          </div>
        </div>
      ) : undefined}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`inline-flex items-center text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-sm border ${TONE[statusTone]}`}>{cr.status.replace(/_/g, " ")}</span>
        <span className={`inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-sm border ${TONE[priTone]}`}>● {cr.priority}</span>
        <span className="text-[10px] uppercase font-mono tracking-wider text-muted-foreground">{cr.changeType}</span>
      </div>
      <div className="text-sm text-foreground whitespace-pre-wrap">{cr.description}</div>
      <div className="text-xs rounded-md bg-muted/50 border border-border p-2.5"><span className="font-semibold text-foreground">Rationale:</span> <span className="text-muted-foreground">{cr.rationale}</span></div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-md bg-muted/50 border border-border p-2.5">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-mono"><Calendar size={11} /> Schedule</div>
          <div className={`font-mono font-semibold text-base mt-1 ${TONE[impactTone(sched)].split(" ")[1]}`}>{signedDays(sched)}</div>
        </div>
        <div className="rounded-md bg-muted/50 border border-border p-2.5">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-mono"><IndianRupee size={11} /> Budget</div>
          <div className={`font-mono font-semibold text-base mt-1 ${TONE[impactTone(budget)].split(" ")[1]}`}>{signedMoney(budget)}</div>
        </div>
      </div>
      {cr.scopeImpactSummary && <div className="text-xs"><span className="font-semibold text-foreground">Scope impact:</span> <span className="text-muted-foreground">{cr.scopeImpactSummary}</span></div>}
      {cr.riskImpactSummary && <div className="text-xs"><span className="font-semibold text-foreground">Risk impact:</span> <span className="text-muted-foreground">{cr.riskImpactSummary}</span></div>}
      <div className="text-[11px] flex items-center gap-1.5 font-mono text-muted-foreground"><Clock size={11} /> SLA: {cr.slaHours}h{cr.dueAt ? ` · due ${new Date(cr.dueAt).toLocaleString()}` : ""}</div>
      {cr.decidedAt && <div className="text-xs"><span className="font-semibold text-foreground">Decision:</span> {cr.status} on {new Date(cr.decidedAt).toLocaleString()}{cr.decisionNotes ? ` — ${cr.decisionNotes}` : ""}</div>}
    </Overlay>
  );
}
