import { useMemo, useState } from "react";
import {
  useListBudgetLines, useCreateBudgetLine,
  useUpdateBudgetLine, useDeleteBudgetLine,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, DollarSign, AlertTriangle, Pencil, Check, X } from "lucide-react";
import { AiButton, AiResultPanel } from "./ai-button";
import { formatCurrency } from "../lib/format";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell,
} from "recharts";

type BudgetLine = {
  id: number; category: string; description?: string | null;
  baselineAmount: number; forecastAmount: number; actualAmount: number;
  varianceAmount: number; variancePct: number; period?: string | null;
};

export function BudgetTab({
  projectId, budgetThresholdPct = 10,
}: {
  projectId: number; budgetThresholdPct?: number;
}) {
  const { toast } = useToast();
  const { data: lines = [], refetch } = useListBudgetLines(projectId);
  const createLine = useCreateBudgetLine();
  const updateLine = useUpdateBudgetLine();
  const deleteLine = useDeleteBudgetLine();
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [editVals, setEditVals] = useState<{ baseline: string; forecast: string; actual: string }>({ baseline: "", forecast: "", actual: "" });
  const [form, setForm] = useState({ category: "OpEx", description: "", baselineAmount: "", forecastAmount: "", actualAmount: "", period: "" });

  const budgetLines = lines as BudgetLine[];

  const totals = useMemo(() => {
    const t = { baseline: 0, forecast: 0, actual: 0, variance: 0 };
    for (const l of budgetLines) {
      t.baseline += Number(l.baselineAmount ?? 0);
      t.forecast += Number(l.forecastAmount ?? 0);
      t.actual += Number(l.actualAmount ?? 0);
      t.variance += Number(l.varianceAmount ?? 0);
    }
    return t;
  }, [budgetLines]);

  const totalVarPct = totals.baseline > 0 ? ((totals.actual - totals.baseline) / totals.baseline) * 100 : 0;
  const isOverThreshold = totalVarPct > budgetThresholdPct;

  const chartData = budgetLines.map(l => ({
    name: l.description || l.category,
    Baseline: Number(l.baselineAmount ?? 0),
    Forecast: Number(l.forecastAmount ?? 0),
    Actual: Number(l.actualAmount ?? 0),
    over: Number(l.actualAmount ?? 0) > Number(l.baselineAmount ?? 0) * (1 + budgetThresholdPct / 100),
  }));

  function handleAdd() {
    const baseline = parseFloat(form.baselineAmount) || 0;
    const forecast = parseFloat(form.forecastAmount) || 0;
    const actual = parseFloat(form.actualAmount) || 0;
    if (!form.description) { toast({ title: "Description required", variant: "destructive" }); return; }
    createLine.mutate({
      id: projectId,
      data: { category: form.category, description: form.description, baselineAmount: baseline, forecastAmount: forecast, actualAmount: actual, period: form.period || undefined },
    }, {
      onSuccess: () => {
        toast({ title: "Budget line added" });
        setShowAdd(false);
        setForm({ category: "OpEx", description: "", baselineAmount: "", forecastAmount: "", actualAmount: "", period: "" });
        refetch();
      },
      onError: () => toast({ title: "Failed to add budget line", variant: "destructive" }),
    });
  }

  function startEdit(l: BudgetLine) {
    setEditId(l.id);
    setEditVals({ baseline: String(l.baselineAmount), forecast: String(l.forecastAmount), actual: String(l.actualAmount) });
  }
  function saveEdit() {
    if (editId == null) return;
    updateLine.mutate({
      id: editId,
      data: {
        baselineAmount: parseFloat(editVals.baseline) || 0,
        forecastAmount: parseFloat(editVals.forecast) || 0,
        actualAmount: parseFloat(editVals.actual) || 0,
      },
    }, {
      onSuccess: () => { setEditId(null); refetch(); toast({ title: "Budget line updated" }); },
      onError: () => toast({ title: "Update failed", variant: "destructive" }),
    });
  }
  function handleDelete(id: number) {
    if (!confirm("Delete this budget line?")) return;
    deleteLine.mutate({ id }, { onSuccess: () => { refetch(); toast({ title: "Budget line deleted" }); } });
  }

  function varBadge(pct: number) {
    const positive = pct > 0;
    const color = pct > budgetThresholdPct ? "hsl(var(--destructive))" : pct > 0 ? "hsl(var(--warn))" : "hsl(var(--success))";
    const bg = pct > budgetThresholdPct ? "hsl(var(--destructive) / 0.10)" : pct > 0 ? "hsl(var(--warn) / 0.10)" : "hsl(var(--success) / 0.10)";
    return (
      <span className="inline-block text-xs font-bold px-2 py-0.5 rounded-md" style={{ background: bg, color }}>
        {positive ? "+" : ""}{pct.toFixed(1)}%
      </span>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header & summary */}
      <div className="glass-surface lift-card ph-rise rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <DollarSign size={16} className="text-success" /> Budget Management
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">CapEx & OpEx baseline vs forecast vs actual.</p>
          </div>
          <div className="flex items-center gap-2">
            <AiButton
              endpoint={`/api/ai/projects/${projectId}/budget-insights`}
              label="Budget Insights"
              variant="subtle"
              size="md"
            >
              {({ run, loading, result, error }) => (
                <div className="flex flex-col items-end gap-2">
                  <button onClick={run} disabled={loading} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold text-primary bg-primary/10 border border-primary/20 hover:bg-primary/15 disabled:opacity-50">
                    ✨ Budget Insights (AI)
                  </button>
                  {(loading || error || result != null) && (
                    <div className="w-[420px]"><AiResultPanel loading={loading} error={error} result={result} render={(r) => {
                      const raw = r as {
                        headline?: string; overall_health?: string;
                        over_utilized_categories?: Array<{ category: string; variancePct?: number; note?: string }>;
                        under_utilized_categories?: Array<{ category: string; variancePct?: number; note?: string }>;
                        recommendations?: string[];
                      };
                      const d = {
                        overall_status: raw.overall_health,
                        summary: raw.headline,
                        over_utilized: raw.over_utilized_categories?.map(c => c.category) ?? [],
                        under_utilized: raw.under_utilized_categories?.map(c => c.category) ?? [],
                        recommendations: raw.recommendations ?? [],
                      };
                      return (
                        <div className="space-y-2 text-xs">
                          {d.overall_status && <div className="font-bold uppercase text-[10px] tracking-wider text-primary">{d.overall_status}</div>}
                          {d.summary && <p>{d.summary}</p>}
                          {d.over_utilized?.length ? <div><strong>Over-utilized:</strong> {d.over_utilized.join(", ")}</div> : null}
                          {d.under_utilized?.length ? <div><strong>Under-utilized:</strong> {d.under_utilized.join(", ")}</div> : null}
                          {d.recommendations?.length ? <ul className="list-disc pl-4">{d.recommendations.map((x, i) => <li key={i}>{x}</li>)}</ul> : null}
                        </div>
                      );
                    }} /></div>
                  )}
                </div>
              )}
            </AiButton>
            <button
              onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-primary-foreground bg-primary hover:bg-primary/90"
          >
            <Plus size={14} /> Add Budget Line
          </button>
          </div>
        </div>

        {/* Summary tiles */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Total Baseline", value: totals.baseline, color: "hsl(var(--primary))", bg: "hsl(var(--primary) / 0.10)" },
            { label: "Total Forecast", value: totals.forecast, color: "hsl(var(--primary))", bg: "hsl(var(--primary) / 0.10)" },
            { label: "Total Actual", value: totals.actual, color: "hsl(var(--success))", bg: "hsl(var(--success) / 0.10)" },
            { label: "Variance", value: totals.variance, color: totals.variance > 0 ? "hsl(var(--destructive))" : "hsl(var(--success))", bg: totals.variance > 0 ? "hsl(var(--destructive) / 0.10)" : "hsl(var(--success) / 0.10)", pct: totalVarPct },
          ].map(s => (
            <div key={s.label} className="rounded-xl p-3" style={{ background: s.bg }}>
              <p className="text-xs font-semibold" style={{ color: s.color, opacity: 0.8 }}>{s.label}</p>
              <p className="text-xl font-bold mt-1" style={{ color: s.color }}>{formatCurrency(s.value)}</p>
              {"pct" in s && (
                <p className="text-xs mt-0.5" style={{ color: s.color }}>{s.pct! > 0 ? "+" : ""}{s.pct!.toFixed(1)}%</p>
              )}
            </div>
          ))}
        </div>

        {isOverThreshold && (
          <div className="mt-4 rounded-xl p-3 flex items-start gap-2" style={{ background: "hsl(var(--destructive) / 0.10)", border: "1px solid hsl(var(--destructive) / 0.30)" }}>
            <AlertTriangle size={14} className="text-destructive mt-0.5 flex-shrink-0" />
            <p className="text-xs text-destructive">
              Total actual exceeds baseline by <b>{totalVarPct.toFixed(1)}%</b> (threshold {budgetThresholdPct}%). NFA approval workflow is auto-triggered.
            </p>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="glass-surface lift-card ph-rise rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-border/60">
          <h4 className="text-sm font-bold text-foreground">Budget Lines</h4>
        </div>
        {budgetLines.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">No budget lines yet. Click "Add Budget Line" to start.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead style={{ background: "hsl(var(--muted) / 0.40)" }}>
                <tr>
                  <th className="text-left px-4 py-2 text-xs font-bold text-muted-foreground uppercase tracking-wide">Category</th>
                  <th className="text-left px-4 py-2 text-xs font-bold text-muted-foreground uppercase tracking-wide">Description</th>
                  <th className="text-right px-4 py-2 text-xs font-bold text-muted-foreground uppercase tracking-wide">Baseline</th>
                  <th className="text-right px-4 py-2 text-xs font-bold text-muted-foreground uppercase tracking-wide">Forecast</th>
                  <th className="text-right px-4 py-2 text-xs font-bold text-muted-foreground uppercase tracking-wide">Actual</th>
                  <th className="text-right px-4 py-2 text-xs font-bold text-muted-foreground uppercase tracking-wide">Variance</th>
                  <th className="text-center px-4 py-2 text-xs font-bold text-muted-foreground uppercase tracking-wide">Var %</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {budgetLines.map(l => {
                  const editing = editId === l.id;
                  return (
                    <tr key={l.id} className="border-t border-border/60 hover:bg-primary/10/30">
                      <td className="px-4 py-2.5">
                        <span className="text-xs font-bold px-2 py-0.5 rounded-md" style={{
                          background: l.category === "CapEx" ? "hsl(var(--primary) / 0.10)" : "hsl(var(--success) / 0.10)",
                          color: l.category === "CapEx" ? "hsl(var(--primary))" : "hsl(var(--success))",
                        }}>{l.category}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <p className="text-sm text-foreground">{l.description || "—"}</p>
                        {l.period && <p className="text-xs text-muted-foreground">{l.period}</p>}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {editing
                          ? <Input type="number" value={editVals.baseline} onChange={e => setEditVals({ ...editVals, baseline: e.target.value })} className="text-right h-8 w-28 ml-auto" />
                          : <span className="text-sm text-foreground">{formatCurrency(l.baselineAmount)}</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {editing
                          ? <Input type="number" value={editVals.forecast} onChange={e => setEditVals({ ...editVals, forecast: e.target.value })} className="text-right h-8 w-28 ml-auto" />
                          : <span className="text-sm text-foreground">{formatCurrency(l.forecastAmount)}</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {editing
                          ? <Input type="number" value={editVals.actual} onChange={e => setEditVals({ ...editVals, actual: e.target.value })} className="text-right h-8 w-28 ml-auto" />
                          : <span className="text-sm font-semibold text-foreground">{formatCurrency(l.actualAmount)}</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <span className="text-sm" style={{ color: l.varianceAmount > 0 ? "hsl(var(--destructive))" : "hsl(var(--success))" }}>
                          {l.varianceAmount > 0 ? "+" : ""}{formatCurrency(l.varianceAmount)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-center">{varBadge(Number(l.variancePct ?? 0))}</td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {editing ? (
                            <>
                              <button onClick={saveEdit} className="text-success hover:text-success/80"><Check size={14} /></button>
                              <button onClick={() => setEditId(null)} className="text-muted-foreground hover:text-foreground"><X size={14} /></button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => startEdit(l)} className="text-muted-foreground/60 hover:text-primary" title="Edit"><Pencil size={13} /></button>
                              <button onClick={() => handleDelete(l.id)} className="text-muted-foreground/60 hover:text-destructive" title="Delete"><Trash2 size={14} /></button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {/* Totals row */}
                <tr style={{ background: "hsl(var(--muted) / 0.40)" }} className="border-t-2 border-border">
                  <td className="px-4 py-3 text-xs font-bold text-foreground uppercase">Total</td>
                  <td className="px-4 py-3"></td>
                  <td className="px-4 py-3 text-right text-sm font-bold text-foreground">{formatCurrency(totals.baseline)}</td>
                  <td className="px-4 py-3 text-right text-sm font-bold text-foreground">{formatCurrency(totals.forecast)}</td>
                  <td className="px-4 py-3 text-right text-sm font-bold text-foreground">{formatCurrency(totals.actual)}</td>
                  <td className="px-4 py-3 text-right text-sm font-bold" style={{ color: totals.variance > 0 ? "hsl(var(--destructive))" : "hsl(var(--success))" }}>
                    {totals.variance > 0 ? "+" : ""}{formatCurrency(totals.variance)}
                  </td>
                  <td className="px-4 py-3 text-center">{varBadge(totalVarPct)}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Chart */}
      <div className="glass-surface lift-card ph-rise rounded-2xl p-5">
        <h4 className="text-sm font-bold text-foreground">Budget Lines — Baseline vs Forecast vs Actual</h4>
        <p className="text-xs text-muted-foreground mt-0.5 mb-4">Red bars indicate Actual exceeds Baseline by more than {budgetThresholdPct}% (NFA threshold).</p>
        <div style={{ height: 320 }}>
          {chartData.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">No data to chart.</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 50 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} angle={-25} textAnchor="end" height={60} />
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickFormatter={v => formatCurrency(v as number)} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--popover-border))", borderRadius: 8, color: "hsl(var(--popover-foreground))", fontSize: 12 }}
                  formatter={v => formatCurrency(v as number)}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Baseline" fill="hsl(var(--primary))" />
                <Bar dataKey="Forecast" fill="hsl(var(--primary))" />
                <Bar dataKey="Actual">
                  {chartData.map((d, i) => <Cell key={i} fill={d.over ? "hsl(var(--destructive))" : "hsl(var(--success))"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Add modal */}
      <Dialog open={showAdd} onOpenChange={v => { if (!v) setShowAdd(false); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><DollarSign size={16} className="text-success" /> Add Budget Line</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Category</label>
                <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="w-full text-sm border border-border rounded-lg px-3 py-2 mt-1">
                  <option value="OpEx">OpEx</option>
                  <option value="CapEx">CapEx</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Period</label>
                <Input value={form.period} onChange={e => setForm({ ...form, period: e.target.value })} placeholder="e.g. FY26 Q2" />
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Description</label>
              <Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Line item description" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Baseline</label>
                <Input type="number" value={form.baselineAmount} onChange={e => setForm({ ...form, baselineAmount: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Forecast</label>
                <Input type="number" value={form.forecastAmount} onChange={e => setForm({ ...form, forecastAmount: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Actual</label>
                <Input type="number" value={form.actualAmount} onChange={e => setForm({ ...form, actualAmount: e.target.value })} />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted/40">Cancel</button>
              <button onClick={handleAdd} className="px-4 py-2 text-sm font-semibold text-primary-foreground rounded-lg bg-primary hover:bg-primary/90">
                Add Line
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
