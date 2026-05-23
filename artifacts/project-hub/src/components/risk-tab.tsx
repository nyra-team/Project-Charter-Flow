import { useMemo, useState } from "react";
import { useListCharterRisks, useAddCharterRisk } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Shield, AlertTriangle, X } from "lucide-react";
import { AiButton, AiResultPanel } from "./ai-button";

type Risk = {
  id: number; charterId: number; title: string; description: string;
  impact: string; likelihood: string; mitigation?: string | null;
  priority: string; rag: string; status: string; owner?: string | null;
  scheduleImpact?: string | null;
};

const LEVEL_TO_NUM: Record<string, number> = {
  very_low: 1, vlow: 1, "1": 1,
  low: 2, "2": 2,
  medium: 3, med: 3, "3": 3,
  high: 4, "4": 4,
  very_high: 5, vhigh: 5, critical: 5, "5": 5,
};
const NUM_TO_LEVEL: Record<number, string> = { 1: "very_low", 2: "low", 3: "medium", 4: "high", 5: "very_high" };
const LEVEL_DISPLAY: Record<string, string> = { very_low: "very low", low: "low", medium: "medium", high: "high", very_high: "very high" };

function levelNum(v: string): number {
  return LEVEL_TO_NUM[(v ?? "medium").toLowerCase()] ?? 3;
}
function riskScore(r: Risk): number {
  return levelNum(r.likelihood) * levelNum(r.impact);
}
function zoneOf(score: number): "green" | "amber" | "red" {
  if (score >= 10) return "red";
  if (score >= 5) return "amber";
  return "green";
}
const ZONE_META: Record<string, { bg: string; color: string; label: string }> = {
  green: { bg: "hsl(var(--success) / 0.10)", color: "hsl(var(--success))", label: "Low" },
  amber: { bg: "hsl(var(--warn) / 0.10)", color: "hsl(var(--warn))", label: "Medium" },
  red:   { bg: "hsl(var(--destructive) / 0.10)", color: "hsl(var(--destructive))", label: "High" },
};

export function RiskTab({ projectId, charterId }: { projectId: number; charterId: number | null }) {
  const { toast } = useToast();
  const { data: risks = [], refetch } = useListCharterRisks(charterId ?? 0, { query: { enabled: !!charterId } });
  const addRisk = useAddCharterRisk();
  const [showAdd, setShowAdd] = useState(false);
  const [filterZone, setFilterZone] = useState<"all" | "green" | "amber" | "red">("all");
  const [sortKey, setSortKey] = useState<"score" | "status" | "owner">("score");
  const [form, setForm] = useState({
    title: "", description: "", impact: "medium", likelihood: "medium",
    mitigation: "", owner: "", status: "open", priority: "medium",
  });

  const risksArr = (risks as Risk[]) ?? [];

  const filtered = useMemo(() => {
    const out = filterZone === "all" ? risksArr : risksArr.filter(r => zoneOf(riskScore(r)) === filterZone);
    return [...out].sort((a, b) => {
      if (sortKey === "score") return riskScore(b) - riskScore(a);
      if (sortKey === "status") return (a.status ?? "").localeCompare(b.status ?? "");
      return (a.owner ?? "").localeCompare(b.owner ?? "");
    });
  }, [risksArr, filterZone, sortKey]);

  // Heat-map cells = 5×5 (likelihood 1-5 rows, impact 1-5 cols)
  const cellRisks = useMemo(() => {
    const grid: Record<string, Risk[]> = {};
    for (const r of risksArr) {
      const k = `${levelNum(r.likelihood)}-${levelNum(r.impact)}`;
      if (!grid[k]) grid[k] = [];
      grid[k].push(r);
    }
    return grid;
  }, [risksArr]);

  function handleAdd() {
    if (!charterId) { toast({ title: "Project has no linked charter", variant: "destructive" }); return; }
    if (!form.title || !form.description) { toast({ title: "Title & description required", variant: "destructive" }); return; }
    addRisk.mutate({
      id: charterId,
      data: {
        title: form.title, description: form.description,
        impact: form.impact, likelihood: form.likelihood,
        mitigation: form.mitigation || undefined,
        owner: form.owner || undefined,
        status: form.status, priority: form.priority,
      },
    }, {
      onSuccess: () => {
        toast({ title: "Risk added" });
        const sc = levelNum(form.impact) * levelNum(form.likelihood);
        if (sc >= 15) toast({ title: "⚠️ Severe risk", description: "PM, sponsor & functional head will be notified." });
        setShowAdd(false);
        setForm({ title: "", description: "", impact: "medium", likelihood: "medium", mitigation: "", owner: "", status: "open", priority: "medium" });
        refetch();
      },
      onError: () => toast({ title: "Failed to add risk", variant: "destructive" }),
    });
  }

  if (!charterId) {
    return <div className="glass-surface lift-card ph-rise rounded-2xl p-10 text-center text-sm text-muted-foreground">
      This project is not linked to a charter. Risks are managed at the charter level.
    </div>;
  }

  const severe = risksArr.filter(r => riskScore(r) >= 15).length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="glass-surface lift-card ph-rise rounded-2xl p-5 flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-foreground flex items-center gap-2">
            <Shield size={16} className="text-destructive" /> Risk Register & Heat Map
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">{risksArr.length} risk{risksArr.length !== 1 ? "s" : ""} · {severe} severe (score ≥ 15)</p>
        </div>
        <div className="flex items-center gap-2">
          <AiButton
            label="Suggest Risks"
            endpoint={`/api/ai/charters/${charterId}/risk-suggestions`}
            variant="primary"
            size="md"
          >
            {({ run, loading, result, error }) => (
              <div className="flex flex-col items-end gap-2">
                <button onClick={run} disabled={loading} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold text-primary bg-primary/10 border border-primary/20 hover:bg-primary/15 disabled:opacity-50">
                  ✨ Suggest Risks (AI)
                </button>
                {(loading || error || result) && (
                  <div className="w-[420px]"><AiResultPanel loading={loading} error={error} result={result} render={(r) => {
                    const suggestions = (r as { risks?: Array<{ title: string; description: string; impact: string; likelihood: string; mitigation?: string }>; suggestions?: Array<{ title: string; description: string; impact: string; likelihood: string; mitigation?: string }> }).risks ?? (r as { suggestions?: Array<{ title: string; description: string; impact: string; likelihood: string; mitigation?: string }> }).suggestions ?? [];
                    return (
                      <div className="space-y-2 text-xs max-h-[260px] overflow-y-auto">
                        {suggestions.map((s, i) => (
                          <div key={i} className="rounded border border-primary/20 bg-card p-2">
                            <div className="font-semibold text-foreground">{s.title}</div>
                            <div className="text-muted-foreground">{s.description}</div>
                            <div className="flex gap-2 mt-1 items-center">
                              <span className="text-[10px] uppercase px-1 py-0.5 rounded bg-destructive/10 text-destructive">{s.impact}/{s.likelihood}</span>
                              <button onClick={() => addRisk.mutate({ id: charterId, data: { title: s.title, description: s.description, impact: s.impact, likelihood: s.likelihood, mitigation: s.mitigation, status: "open", priority: "medium" } }, { onSuccess: () => { toast({ title: "Risk added from AI suggestion" }); refetch(); } })} className="text-[10px] font-semibold text-primary hover:underline ml-auto">+ Add to register</button>
                            </div>
                          </div>
                        ))}
                        {suggestions.length === 0 && <div className="text-muted-foreground italic">No new suggestions.</div>}
                      </div>
                    );
                  }} /></div>
                )}
              </div>
            )}
          </AiButton>
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-primary-foreground bg-primary hover:bg-primary/90">
            <Plus size={14} /> Add Risk
          </button>
        </div>
      </div>

      {/* Heat Map */}
      <div className="glass-surface lift-card ph-rise rounded-2xl p-5">
        <h4 className="text-sm font-bold text-foreground">5 × 5 Risk Heat Map</h4>
        <p className="text-xs text-muted-foreground mt-0.5 mb-3">Likelihood (rows) × Impact (cols). Click a cell to filter table below.</p>
        <div className="flex gap-3">
          {/* Y axis label */}
          <div className="flex items-center justify-center" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}>
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Likelihood →</span>
          </div>
          <div className="flex-1">
            <div className="grid grid-cols-6 gap-1.5">
              <div></div>
              {[1,2,3,4,5].map(c => (
                <div key={c} className="text-center text-[10px] font-bold text-muted-foreground">{c}</div>
              ))}
              {[5,4,3,2,1].map(row => (
                <>
                  <div key={`lbl-${row}`} className="text-right text-[10px] font-bold text-muted-foreground self-center">{row}</div>
                  {[1,2,3,4,5].map(col => {
                    const score = row * col;
                    const z = zoneOf(score);
                    const meta = ZONE_META[z];
                    const cellKey = `${row}-${col}`;
                    const items = cellRisks[cellKey] ?? [];
                    return (
                      <button
                        key={cellKey}
                        onClick={() => setFilterZone(z)}
                        className="aspect-square rounded-md text-xs font-bold flex flex-col items-center justify-center transition-all hover:scale-105 hover:shadow-md"
                        style={{ background: meta.bg, color: meta.color, border: `1px solid ${meta.color}33` }}
                        title={`Score ${score}: ${items.length} risk${items.length!==1?"s":""}`}
                      >
                        <span className="text-[10px] opacity-70">{score}</span>
                        {items.length > 0 && <span className="text-sm">{items.length}</span>}
                      </button>
                    );
                  })}
                </>
              ))}
            </div>
            <div className="text-center text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-2">Impact →</div>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-4 text-xs">
          <span className="text-muted-foreground">Legend:</span>
          {(["green","amber","red"] as const).map(z => (
            <button
              key={z}
              onClick={() => setFilterZone(filterZone === z ? "all" : z)}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md"
              style={{ background: ZONE_META[z].bg, color: ZONE_META[z].color, opacity: filterZone === "all" || filterZone === z ? 1 : 0.4 }}
            >
              <span className="w-2 h-2 rounded-full" style={{ background: ZONE_META[z].color }} />
              {ZONE_META[z].label} {z === "green" ? "(1-4)" : z === "amber" ? "(5-9)" : "(10-25)"}
            </button>
          ))}
          {filterZone !== "all" && (
            <button onClick={() => setFilterZone("all")} className="text-xs text-primary hover:underline flex items-center gap-1">
              <X size={10} /> clear filter
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="glass-surface lift-card ph-rise rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-border/60 flex items-center justify-between">
          <h4 className="text-sm font-bold text-foreground">
            Risk Register {filterZone !== "all" && <span className="text-xs font-normal text-muted-foreground ml-2">(filtered: {ZONE_META[filterZone].label})</span>}
          </h4>
          <select value={sortKey} onChange={e => setSortKey(e.target.value as "score" | "status" | "owner")} className="text-xs border border-border rounded px-2 py-1">
            <option value="score">Sort: Score</option>
            <option value="status">Sort: Status</option>
            <option value="owner">Sort: Owner</option>
          </select>
        </div>
        {filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">{risksArr.length === 0 ? "No risks yet. Click 'Add Risk'." : "No risks match this filter."}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead style={{ background: "hsl(var(--muted) / 0.40)" }}>
                <tr>
                  <th className="text-left px-4 py-2 text-xs font-bold text-muted-foreground uppercase">#</th>
                  <th className="text-left px-4 py-2 text-xs font-bold text-muted-foreground uppercase">Risk</th>
                  <th className="text-center px-3 py-2 text-xs font-bold text-muted-foreground uppercase">Likelihood</th>
                  <th className="text-center px-3 py-2 text-xs font-bold text-muted-foreground uppercase">Impact</th>
                  <th className="text-center px-3 py-2 text-xs font-bold text-muted-foreground uppercase">Score</th>
                  <th className="text-left px-4 py-2 text-xs font-bold text-muted-foreground uppercase">Owner</th>
                  <th className="text-left px-4 py-2 text-xs font-bold text-muted-foreground uppercase">Mitigation</th>
                  <th className="text-center px-3 py-2 text-xs font-bold text-muted-foreground uppercase">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => {
                  const sc = riskScore(r);
                  const z = zoneOf(sc);
                  const meta = ZONE_META[z];
                  return (
                    <tr key={r.id} className="border-t border-border/60 hover:bg-destructive/5">
                      <td className="px-4 py-2.5 text-xs text-muted-foreground font-mono">R-{r.id}</td>
                      <td className="px-4 py-2.5">
                        <p className="text-sm font-semibold text-foreground">{r.title}</p>
                        <p className="text-xs text-muted-foreground line-clamp-1">{r.description}</p>
                      </td>
                      <td className="px-3 py-2.5 text-center text-xs text-foreground">{levelNum(r.likelihood)}</td>
                      <td className="px-3 py-2.5 text-center text-xs text-foreground">{levelNum(r.impact)}</td>
                      <td className="px-3 py-2.5 text-center">
                        <span className="inline-block text-xs font-bold px-2 py-0.5 rounded" style={{ background: meta.bg, color: meta.color }}>
                          {sc}
                          {sc >= 15 && <AlertTriangle size={9} className="inline ml-1 -mt-0.5" />}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-foreground">{r.owner || "—"}</td>
                      <td className="px-4 py-2.5 text-xs text-foreground max-w-xs truncate">{r.mitigation || "—"}</td>
                      <td className="px-3 py-2.5 text-center">
                        <span className="text-xs font-semibold px-2 py-0.5 rounded" style={{ background: r.status === "closed" ? "hsl(var(--success) / 0.10)" : "hsl(var(--primary) / 0.10)", color: r.status === "closed" ? "hsl(var(--success))" : "hsl(var(--primary))" }}>
                          {r.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Risk modal */}
      <Dialog open={showAdd} onOpenChange={v => { if (!v) setShowAdd(false); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Shield size={16} className="text-destructive" /> Add Risk</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Title</label>
              <Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="e.g. Vendor dependency on key resource" />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Description</label>
              <Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Likelihood (1-5)</label>
                <select value={form.likelihood} onChange={e => setForm({ ...form, likelihood: e.target.value })} className="w-full text-sm border border-border rounded-lg px-3 py-2 mt-1">
                  {[1,2,3,4,5].map(n => <option key={n} value={NUM_TO_LEVEL[n]}>{n} — {LEVEL_DISPLAY[NUM_TO_LEVEL[n]]}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Impact (1-5)</label>
                <select value={form.impact} onChange={e => setForm({ ...form, impact: e.target.value })} className="w-full text-sm border border-border rounded-lg px-3 py-2 mt-1">
                  {[1,2,3,4,5].map(n => <option key={n} value={NUM_TO_LEVEL[n]}>{n} — {LEVEL_DISPLAY[NUM_TO_LEVEL[n]]}</option>)}
                </select>
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              Current score: <b style={{ color: ZONE_META[zoneOf(levelNum(form.impact) * levelNum(form.likelihood))].color }}>
                {levelNum(form.impact) * levelNum(form.likelihood)}
              </b>
              {levelNum(form.impact) * levelNum(form.likelihood) >= 15 && <span className="ml-2 text-destructive font-semibold">⚠ Severe — escalation will notify PM + sponsor</span>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Owner</label>
                <Input value={form.owner} onChange={e => setForm({ ...form, owner: e.target.value })} placeholder="Person responsible" />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Status</label>
                <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} className="w-full text-sm border border-border rounded-lg px-3 py-2 mt-1">
                  <option value="open">Open</option>
                  <option value="mitigating">Mitigating</option>
                  <option value="closed">Closed</option>
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Mitigation Plan</label>
              <Textarea value={form.mitigation} onChange={e => setForm({ ...form, mitigation: e.target.value })} rows={2} placeholder="How will this risk be reduced?" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted/40">Cancel</button>
              <button onClick={handleAdd} className="px-4 py-2 text-sm font-semibold text-primary-foreground rounded-lg bg-primary hover:bg-primary/90">Add Risk</button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
