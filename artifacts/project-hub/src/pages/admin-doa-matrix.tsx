import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ShieldCheck, Plus, Save, Trash2, Calculator } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { DashboardCard } from "../components/dashboard/primitives";

type Band = {
  id: number;
  entity: string;
  category: string;
  kind: string;
  minInr: string | number;
  maxInr: string | number | null;
  approverRoles: string[];
  active: boolean;
  label: string;
  notes: string;
};

const ROLE_PALETTE = ["hod", "cfo", "executive_director", "chairman", "finance", "pmo", "scm"];

function fmtCr(n: number | string | null | undefined): string {
  if (n == null || n === "") return "—";
  const num = typeof n === "string" ? Number(n) : n;
  if (!Number.isFinite(num)) return "—";
  if (num >= 1e7) return `₹${(num / 1e7).toFixed(2)} Cr`;
  if (num >= 1e5) return `₹${(num / 1e5).toFixed(2)} L`;
  return `₹${num.toLocaleString("en-IN")}`;
}

export default function AdminDoaMatrix() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["/api/doa-matrix"],
    queryFn: async () => {
      const r = await fetch("/api/doa-matrix");
      if (!r.ok) throw new Error("Failed to load DOA matrix");
      return r.json() as Promise<Band[]>;
    },
  });

  const [edits, setEdits] = useState<Record<number, Partial<Band>>>({});

  const create = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/doa-matrix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity: "*", category: "*", kind: "*",
          minInr: 0, maxInr: null,
          approverRoles: ["hod"],
          active: true,
          label: "New band",
          notes: "",
        }),
      });
      if (!r.ok) throw new Error((await r.json())?.error ?? "Create failed");
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Band added" });
      qc.invalidateQueries({ queryKey: ["/api/doa-matrix"] });
    },
    onError: (err: unknown) => toast({ title: "Add failed", description: err instanceof Error ? err.message : "Try again", variant: "destructive" }),
  });

  const save = useMutation({
    mutationFn: async ({ id, patch }: { id: number; patch: Partial<Band> }) => {
      const r = await fetch(`/api/doa-matrix/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!r.ok) throw new Error((await r.json())?.error ?? "Save failed");
      return r.json();
    },
    onSuccess: (_d, vars) => {
      toast({ title: "Band updated", description: `Band #${vars.id} saved.` });
      setEdits(e => { const n = { ...e }; delete n[vars.id]; return n; });
      qc.invalidateQueries({ queryKey: ["/api/doa-matrix"] });
    },
    onError: (err: unknown) => toast({ title: "Save failed", description: err instanceof Error ? err.message : "Try again", variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/doa-matrix/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error((await r.json())?.error ?? "Delete failed");
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Band removed" });
      qc.invalidateQueries({ queryKey: ["/api/doa-matrix"] });
    },
    onError: (err: unknown) => toast({ title: "Delete failed", description: err instanceof Error ? err.message : "Try again", variant: "destructive" }),
  });

  const merged = useMemo<Band[]>(() => {
    if (!data) return [];
    return data.map(b => ({ ...b, ...(edits[b.id] ?? {}) }));
  }, [data, edits]);

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-primary/10 border border-primary/20">
            <ShieldCheck size={18} className="text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-foreground">Delegation Of Authority (DOA) Matrix</h2>
            <p className="text-sm text-muted-foreground mt-0.5">Spend-band → approver-chain rules. Most-specific match wins on Charter+NFA submission.</p>
          </div>
        </div>
        <button
          onClick={() => create.mutate()}
          disabled={create.isPending}
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
        >
          <Plus size={14} /> Add band
        </button>
      </div>

      <DoaPreview />

      <DashboardCard title="Approval Bands" subtitle='Use "*" as a wildcard for entity / category / kind.'>
        {isLoading || !data ? (
          <Skeleton className="h-64 rounded-xl" />
        ) : merged.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No bands defined — click "Add band" to start.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="text-left font-medium py-2 pr-2">Label</th>
                  <th className="text-left font-medium py-2 pr-2">Entity</th>
                  <th className="text-left font-medium py-2 pr-2">Category</th>
                  <th className="text-left font-medium py-2 pr-2">Kind</th>
                  <th className="text-right font-medium py-2 pr-2">Min (INR)</th>
                  <th className="text-right font-medium py-2 pr-2">Max (INR)</th>
                  <th className="text-left font-medium py-2 pr-2">Approver chain</th>
                  <th className="text-center font-medium py-2 pr-2">Active</th>
                  <th className="text-right font-medium py-2"> </th>
                </tr>
              </thead>
              <tbody>
                {merged.map(b => {
                  const dirty = edits[b.id] != null;
                  const setField = (k: keyof Band, v: unknown) =>
                    setEdits(e => ({ ...e, [b.id]: { ...(e[b.id] ?? {}), [k]: v } }));
                  return (
                    <tr key={b.id} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="py-2 pr-2">
                        <input
                          value={b.label ?? ""}
                          onChange={e => setField("label", e.target.value)}
                          className="w-40 text-sm rounded-md px-2 py-1 bg-card border border-border focus:outline-none focus:ring-2 focus:ring-ring/40"
                        />
                      </td>
                      <td className="py-2 pr-2">
                        <input
                          value={b.entity}
                          onChange={e => setField("entity", e.target.value)}
                          className="w-20 text-sm rounded-md px-2 py-1 bg-card border border-border focus:outline-none focus:ring-2 focus:ring-ring/40"
                        />
                      </td>
                      <td className="py-2 pr-2">
                        <input
                          value={b.category}
                          onChange={e => setField("category", e.target.value)}
                          className="w-32 text-sm rounded-md px-2 py-1 bg-card border border-border focus:outline-none focus:ring-2 focus:ring-ring/40"
                        />
                      </td>
                      <td className="py-2 pr-2">
                        <select
                          value={b.kind}
                          onChange={e => setField("kind", e.target.value)}
                          className="text-sm rounded-md px-2 py-1 bg-card border border-border focus:outline-none focus:ring-2 focus:ring-ring/40"
                        >
                          <option value="*">*</option>
                          <option value="capex">capex</option>
                          <option value="opex">opex</option>
                          <option value="mixed">mixed</option>
                        </select>
                      </td>
                      <td className="py-2 pr-2 text-right">
                        <input
                          type="number"
                          min={0}
                          value={String(b.minInr ?? 0)}
                          onChange={e => setField("minInr", Number(e.target.value))}
                          className="w-32 text-sm rounded-md px-2 py-1 bg-card border border-border focus:outline-none focus:ring-2 focus:ring-ring/40 text-right"
                        />
                        <div className="text-[10px] text-muted-foreground">{fmtCr(b.minInr)}</div>
                      </td>
                      <td className="py-2 pr-2 text-right">
                        <input
                          type="number"
                          min={0}
                          value={b.maxInr == null ? "" : String(b.maxInr)}
                          placeholder="∞"
                          onChange={e => setField("maxInr", e.target.value === "" ? null : Number(e.target.value))}
                          className="w-32 text-sm rounded-md px-2 py-1 bg-card border border-border focus:outline-none focus:ring-2 focus:ring-ring/40 text-right"
                        />
                        <div className="text-[10px] text-muted-foreground">{b.maxInr == null ? "unbounded" : fmtCr(b.maxInr)}</div>
                      </td>
                      <td className="py-2 pr-2">
                        <RoleEditor
                          value={b.approverRoles ?? []}
                          onChange={v => setField("approverRoles", v)}
                        />
                      </td>
                      <td className="py-2 pr-2 text-center">
                        <input
                          type="checkbox"
                          checked={!!b.active}
                          onChange={e => setField("active", e.target.checked)}
                          className="h-4 w-4 accent-primary"
                        />
                      </td>
                      <td className="py-2 text-right space-x-1 whitespace-nowrap">
                        <button
                          onClick={() => save.mutate({ id: b.id, patch: edits[b.id] ?? {} })}
                          disabled={!dirty || save.isPending}
                          className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
                        >
                          <Save size={12} /> Save
                        </button>
                        <button
                          onClick={() => { if (confirm(`Delete band "${b.label || b.id}"?`)) remove.mutate(b.id); }}
                          disabled={remove.isPending}
                          className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-md bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors disabled:opacity-40"
                        >
                          <Trash2 size={12} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </DashboardCard>
    </div>
  );
}

function RoleEditor({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-1">
      {value.map((r, i) => (
        <span key={`${r}-${i}`} className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
          {r}
          <button
            onClick={() => onChange(value.filter((_, j) => j !== i))}
            className="hover:text-destructive"
            aria-label={`Remove ${r}`}
          >×</button>
        </span>
      ))}
      <input
        list="doa-role-options"
        value={draft}
        placeholder="+ role"
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter" && draft.trim()) {
            onChange([...value, draft.trim()]);
            setDraft("");
            e.preventDefault();
          }
        }}
        onBlur={() => {
          if (draft.trim()) {
            onChange([...value, draft.trim()]);
            setDraft("");
          }
        }}
        className="w-20 text-[11px] rounded-md px-1.5 py-0.5 bg-card border border-border focus:outline-none focus:ring-1 focus:ring-ring/40"
      />
      <datalist id="doa-role-options">
        {ROLE_PALETTE.map(r => <option key={r} value={r} />)}
      </datalist>
    </div>
  );
}

function DoaPreview() {
  const [entity, setEntity] = useState("");
  const [category, setCategory] = useState("");
  const [kind, setKind] = useState<"capex" | "opex" | "mixed">("capex");
  const [amount, setAmount] = useState<number>(10000000); // 1 Cr default
  const [result, setResult] = useState<null | { matched: boolean; approverRoles?: string[]; label?: string; reason?: string }>(null);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  const run = async () => {
    setBusy(true);
    try {
      const qs = new URLSearchParams({ kind, amount: String(amount) });
      if (entity) qs.set("entity", entity);
      if (category) qs.set("category", category);
      const r = await fetch(`/api/doa-matrix/preview?${qs.toString()}`);
      if (!r.ok) throw new Error((await r.json())?.error ?? "Preview failed");
      setResult(await r.json());
    } catch (err) {
      toast({ title: "Preview failed", description: err instanceof Error ? err.message : "Try again", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <DashboardCard title="Resolve preview" subtitle="Plug in a hypothetical charter and see which band fires.">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Entity</span>
          <input value={entity} placeholder="GIL / *" onChange={e => setEntity(e.target.value)} className="rounded-md px-2 py-1.5 bg-card border border-border focus:outline-none focus:ring-2 focus:ring-ring/40" />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Category</span>
          <input value={category} placeholder="Compliance + ROI / *" onChange={e => setCategory(e.target.value)} className="rounded-md px-2 py-1.5 bg-card border border-border focus:outline-none focus:ring-2 focus:ring-ring/40" />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Kind</span>
          <select value={kind} onChange={e => setKind(e.target.value as "capex" | "opex" | "mixed")} className="rounded-md px-2 py-1.5 bg-card border border-border focus:outline-none focus:ring-2 focus:ring-ring/40">
            <option value="capex">capex</option>
            <option value="opex">opex</option>
            <option value="mixed">mixed</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Amount (INR)</span>
          <input type="number" min={0} value={amount} onChange={e => setAmount(Number(e.target.value))} className="rounded-md px-2 py-1.5 bg-card border border-border focus:outline-none focus:ring-2 focus:ring-ring/40 text-right" />
          <span className="text-[10px] text-muted-foreground text-right">{fmtCr(amount)}</span>
        </label>
        <button
          onClick={run}
          disabled={busy}
          className="self-end inline-flex items-center justify-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
        >
          <Calculator size={14} /> {busy ? "Resolving…" : "Resolve"}
        </button>
      </div>
      {result && (
        <div className={`mt-3 p-3 rounded-md border text-sm ${result.matched ? "bg-emerald-50 border-emerald-200 text-emerald-900" : "bg-amber-50 border-amber-200 text-amber-900"}`}>
          {result.matched ? (
            <>
              <div className="font-medium">Match: {result.label}</div>
              <div className="mt-1 text-xs">Approver chain: <span className="font-mono">{(result.approverRoles ?? []).join(" → ") || "(none)"}</span></div>
            </>
          ) : (
            <div>{result.reason ?? "No band matched."}</div>
          )}
        </div>
      )}
    </DashboardCard>
  );
}
