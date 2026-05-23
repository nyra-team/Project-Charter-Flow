import { useMemo, useState } from "react";
import {
  useListResourceAllocations, useCreateResourceAllocation,
  useDeleteResourceAllocation, useListUsers,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, Users, AlertTriangle } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

type Allocation = {
  id: number; userId: number; role?: string | null; skill?: string | null;
  allocationPct: number; startDate?: string | null; endDate?: string | null;
};

type User = { id: number; name: string; role?: string; department?: string };

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(d: Date) {
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}
function buildMonthAxis(startDate?: string | null, endDate?: string | null, count = 6) {
  const start = startDate ? new Date(startDate) : new Date();
  const end = endDate ? new Date(endDate) : new Date(start.getTime() + count * 30 * 86400000);
  const months: Date[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);
  while (cursor <= last) {
    months.push(new Date(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
    if (months.length > 18) break;
  }
  if (months.length < 3) {
    while (months.length < 6) {
      const next = new Date(months[months.length - 1] ?? new Date());
      next.setMonth(next.getMonth() + 1);
      months.push(next);
    }
  }
  return months;
}

function allocationCoversMonth(a: Allocation, m: Date): boolean {
  const monthStart = new Date(m.getFullYear(), m.getMonth(), 1);
  const monthEnd = new Date(m.getFullYear(), m.getMonth() + 1, 0);
  const aStart = a.startDate ? new Date(a.startDate) : new Date(0);
  const aEnd = a.endDate ? new Date(a.endDate) : new Date(8640000000000000);
  return aStart <= monthEnd && aEnd >= monthStart;
}

export function ResourceTab({
  projectId, projectStartDate, projectEndDate,
}: {
  projectId: number; projectStartDate?: string | null; projectEndDate?: string | null;
}) {
  const { toast } = useToast();
  const { data: allocs = [], refetch } = useListResourceAllocations(projectId);
  const { data: users = [] } = useListUsers();
  const createAlloc = useCreateResourceAllocation();
  const deleteAlloc = useDeleteResourceAllocation();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({
    userId: "", role: "", skill: "", allocationPct: "100",
    startDate: projectStartDate ?? "", endDate: projectEndDate ?? "",
  });

  const allocations = allocs as Allocation[];
  const usersArr = users as User[];
  const months = useMemo(() => buildMonthAxis(projectStartDate, projectEndDate), [projectStartDate, projectEndDate]);

  // Per user totals per month
  const matrix = useMemo(() => {
    const m: Record<number, Record<string, number>> = {};
    for (const a of allocations) {
      if (!m[a.userId]) m[a.userId] = {};
      for (const mo of months) {
        if (allocationCoversMonth(a, mo)) {
          const k = monthKey(mo);
          m[a.userId][k] = (m[a.userId][k] ?? 0) + Number(a.allocationPct ?? 0);
        }
      }
    }
    return m;
  }, [allocations, months]);

  const allocUserIds = useMemo(() => Array.from(new Set(allocations.map(a => a.userId))), [allocations]);
  const allocUsers = allocUserIds.map(uid => usersArr.find(u => u.id === uid)).filter(Boolean) as User[];

  // Stacked chart data
  const chartData = months.map(mo => {
    const k = monthKey(mo);
    const row: Record<string, string | number> = { month: monthLabel(mo) };
    for (const u of allocUsers) {
      row[u.name] = matrix[u.id]?.[k] ?? 0;
    }
    return row;
  });

  const STACK_COLORS = [
    "hsl(var(--primary))",
    "hsl(var(--success))",
    "hsl(var(--warn))",
    "hsl(var(--destructive))",
    "hsl(var(--primary) / 0.7)",
    "hsl(var(--success) / 0.7)",
    "hsl(var(--warn) / 0.7)",
    "hsl(var(--destructive) / 0.7)",
    "hsl(var(--primary) / 0.4)",
    "hsl(var(--muted-foreground))",
  ];

  function handleSubmit() {
    if (!form.userId) { toast({ title: "Select a user", variant: "destructive" }); return; }
    const pct = parseFloat(form.allocationPct);
    if (isNaN(pct) || pct <= 0 || pct > 200) { toast({ title: "Allocation must be 1–200%", variant: "destructive" }); return; }
    createAlloc.mutate(
      {
        id: projectId,
        data: {
          userId: parseInt(form.userId),
          role: form.role || undefined,
          skill: form.skill || undefined,
          allocationPct: pct,
          startDate: form.startDate || undefined,
          endDate: form.endDate || undefined,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Resource allocated" });
          setShowAdd(false);
          setForm({ userId: "", role: "", skill: "", allocationPct: "100", startDate: projectStartDate ?? "", endDate: projectEndDate ?? "" });
          refetch();
        },
        onError: () => toast({ title: "Failed to allocate", variant: "destructive" }),
      }
    );
  }

  function handleDelete(id: number) {
    if (!confirm("Remove this allocation?")) return;
    deleteAlloc.mutate({ id }, { onSuccess: () => { refetch(); toast({ title: "Allocation removed" }); } });
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="glass-surface lift-card ph-rise rounded-2xl p-5 flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-foreground flex items-center gap-2">
            <Users size={16} className="text-primary" /> Resource Allocation
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {allocations.length} allocation{allocations.length !== 1 ? "s" : ""} across {allocUsers.length} member{allocUsers.length !== 1 ? "s" : ""}
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-primary-foreground bg-primary hover:bg-primary/90"
        >
          <Plus size={14} /> Add Resource
        </button>
      </div>

      {/* Allocation grid */}
      <div className="glass-surface lift-card ph-rise rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-border/60">
          <h4 className="text-sm font-bold text-foreground">Monthly Allocation Grid</h4>
          <p className="text-xs text-muted-foreground mt-0.5">Cells show total allocation % per member per month. Amber = over 100%.</p>
        </div>
        {allocUsers.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">No resources allocated yet. Click "Add Resource" to start.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead style={{ background: "hsl(var(--muted) / 0.40)" }}>
                <tr>
                  <th className="text-left px-4 py-2 text-xs font-bold text-muted-foreground uppercase tracking-wide">Member</th>
                  <th className="text-left px-4 py-2 text-xs font-bold text-muted-foreground uppercase tracking-wide">Role / Skill</th>
                  {months.map(mo => (
                    <th key={monthKey(mo)} className="text-center px-3 py-2 text-xs font-bold text-muted-foreground uppercase tracking-wide">
                      {monthLabel(mo)}
                    </th>
                  ))}
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {allocUsers.map(u => {
                  const userAllocs = allocations.filter(a => a.userId === u.id);
                  return (
                    <tr key={u.id} className="border-t border-border/60 hover:bg-primary/10/30">
                      <td className="px-4 py-2.5">
                        <p className="text-sm font-semibold text-foreground">{u.name}</p>
                        {u.department && <p className="text-xs text-muted-foreground">{u.department}</p>}
                      </td>
                      <td className="px-4 py-2.5">
                        {userAllocs.map(a => (
                          <div key={a.id} className="text-xs text-foreground">
                            {a.role || "—"}{a.skill ? ` · ${a.skill}` : ""}
                          </div>
                        ))}
                      </td>
                      {months.map(mo => {
                        const pct = matrix[u.id]?.[monthKey(mo)] ?? 0;
                        const over = pct > 100;
                        const has = pct > 0;
                        return (
                          <td key={monthKey(mo)} className="text-center px-3 py-2.5">
                            {has ? (
                              <span
                                className="inline-block text-xs font-bold px-2 py-1 rounded-md"
                                style={{
                                  background: over ? "hsl(var(--warn) / 0.15)" : "hsl(var(--primary) / 0.10)",
                                  color: over ? "hsl(var(--warn))" : "hsl(var(--primary))",
                                }}
                              >
                                {pct}%
                              </span>
                            ) : <span className="text-xs text-muted-foreground/60">—</span>}
                          </td>
                        );
                      })}
                      <td className="px-3 py-2.5 text-right">
                        {userAllocs.map(a => (
                          <button
                            key={a.id}
                            onClick={() => handleDelete(a.id)}
                            className="text-muted-foreground/60 hover:text-destructive transition-colors"
                            title="Remove allocation"
                          >
                            <Trash2 size={14} />
                          </button>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Overallocation warnings */}
      {(() => {
        const conflicts: Array<{ user: string; month: string; pct: number }> = [];
        for (const u of allocUsers) {
          for (const mo of months) {
            const pct = matrix[u.id]?.[monthKey(mo)] ?? 0;
            if (pct > 100) conflicts.push({ user: u.name, month: monthLabel(mo), pct });
          }
        }
        if (conflicts.length === 0) return null;
        return (
          <div className="glass-surface lift-card ph-rise rounded-2xl p-4 flex items-start gap-3" style={{ background: "hsl(var(--warn) / 0.10)", border: "1px solid hsl(var(--warn) / 0.30)" }}>
            <AlertTriangle size={16} className="text-warn mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-bold text-warn">Capacity over-allocation detected</p>
              <ul className="text-xs text-warn mt-1 space-y-0.5">
                {conflicts.slice(0, 6).map((c, i) => (
                  <li key={i}>• <b>{c.user}</b> is at <b>{c.pct}%</b> in {c.month}</li>
                ))}
                {conflicts.length > 6 && <li>… and {conflicts.length - 6} more</li>}
              </ul>
            </div>
          </div>
        );
      })()}

      {/* Capacity Forecast chart */}
      <div className="glass-surface lift-card ph-rise rounded-2xl p-5">
        <h4 className="text-sm font-bold text-foreground">Capacity Forecast</h4>
        <p className="text-xs text-muted-foreground mt-0.5 mb-4">Total allocation % per month, stacked by member.</p>
        <div style={{ height: 280 }}>
          {allocUsers.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">No data to chart yet.</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} unit="%" />
                <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--popover-border))", borderRadius: 8, color: "hsl(var(--popover-foreground))", fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {allocUsers.map((u, idx) => (
                  <Bar key={u.id} dataKey={u.name} stackId="cap" fill={STACK_COLORS[idx % STACK_COLORS.length]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Add Resource modal */}
      <Dialog open={showAdd} onOpenChange={v => { if (!v) setShowAdd(false); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Users size={16} className="text-primary" /> Add Resource</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Member</label>
              <select
                value={form.userId}
                onChange={e => setForm({ ...form, userId: e.target.value })}
                className="w-full text-sm border border-border rounded-lg px-3 py-2 mt-1"
              >
                <option value="">Select member…</option>
                {usersArr.map(u => <option key={u.id} value={u.id}>{u.name}{u.role ? ` (${u.role})` : ""}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Role</label>
                <Input value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} placeholder="e.g. Tech Lead" />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Skill</label>
                <Input value={form.skill} onChange={e => setForm({ ...form, skill: e.target.value })} placeholder="e.g. React" />
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Allocation %</label>
              <Input type="number" min={1} max={200} value={form.allocationPct} onChange={e => setForm({ ...form, allocationPct: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Start</label>
                <Input type="date" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground">End</label>
                <Input type="date" value={form.endDate} onChange={e => setForm({ ...form, endDate: e.target.value })} />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted/40">Cancel</button>
              <button onClick={handleSubmit} className="px-4 py-2 text-sm font-semibold text-primary-foreground rounded-lg bg-primary hover:bg-primary/90">
                Allocate
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
