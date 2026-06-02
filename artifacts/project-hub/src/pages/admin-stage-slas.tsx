import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Timer, Save } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { DashboardCard } from "../components/dashboard/primitives";

type StageSla = { id: number; stage: string; label: string; targetDays: number; isActive: boolean };

export default function AdminStageSlas() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["/api/stage-slas"],
    queryFn: async () => {
      const r = await fetch("/api/stage-slas");
      if (!r.ok) throw new Error("Failed");
      return r.json() as Promise<StageSla[]>;
    },
  });

  const [edits, setEdits] = useState<Record<string, number>>({});
  useEffect(() => { setEdits({}); }, [data]);

  const save = useMutation({
    mutationFn: async ({ stage, targetDays }: { stage: string; targetDays: number }) => {
      const r = await fetch(`/api/stage-slas/${stage}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetDays }),
      });
      if (!r.ok) throw new Error((await r.json())?.error ?? "Failed");
      return r.json();
    },
    onSuccess: (_d, vars) => {
      toast({ title: "SLA updated", description: `${vars.stage} target set to ${vars.targetDays} days.` });
      setEdits(e => { const n = { ...e }; delete n[vars.stage]; return n; });
      qc.invalidateQueries({ queryKey: ["/api/stage-slas"] });
    },
    onError: (err: unknown) => toast({ title: "Update failed", description: err instanceof Error ? err.message : "Try again", variant: "destructive" }),
  });

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-primary/10 border border-primary/20">
          <Timer size={18} className="text-primary" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-foreground">Stage SLA Configuration</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Target duration (calendar days) per lifecycle stage — drives "days overdue" on the critical path.</p>
        </div>
      </div>

      <DashboardCard title="Per-Stage Targets" subtitle="A stage is flagged overdue once it has been active longer than its target.">
        {isLoading || !data ? (
          <Skeleton className="h-64 rounded-xl" />
        ) : (
          <div className="space-y-2">
            {data.map(s => {
              const val = edits[s.stage] ?? s.targetDays;
              const dirty = edits[s.stage] != null && edits[s.stage] !== s.targetDays;
              return (
                <div key={s.stage} className="flex items-center gap-3 p-3 rounded-lg bg-muted/40">
                  <span className="flex-1 text-sm font-medium text-foreground">{s.label}</span>
                  <input
                    type="number"
                    min={0}
                    value={val}
                    onChange={e => setEdits(ed => ({ ...ed, [s.stage]: Number(e.target.value) }))}
                    className="w-20 text-sm rounded-md px-2 py-1.5 bg-card text-card-foreground border border-border focus:outline-none focus:ring-2 focus:ring-ring/40 text-right"
                  />
                  <span className="text-xs text-muted-foreground w-10">days</span>
                  <button
                    onClick={() => save.mutate({ stage: s.stage, targetDays: val })}
                    disabled={!dirty || save.isPending}
                    className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
                  >
                    <Save size={13} /> Save
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </DashboardCard>
    </div>
  );
}
