import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { BellRing, Plus, Trash2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { DashboardCard } from "../components/dashboard/primitives";

type PolicyRow = {
  id: number; stage: string; stageLabel: string; subGateKey: string | null;
  tier: number; afterDays: number; action: "remind" | "escalate"; targetRole: string; isActive: boolean;
};

// 13-stage canonical lifecycle (2026-06-02 redesign). The four legacy
// keys (investment_authorization, contract_po, design, build) are kept
// at the end so admins can still tweak escalation rules for any
// historical project sitting on those stages.
const STAGES: Array<{ key: string; label: string }> = [
  { key: "initiation", label: "Business Requirements" },
  { key: "rfp", label: "Request for Proposal" },
  { key: "vendor_selection", label: "Vendor Evaluation and Finalization" },
  { key: "solution_design", label: "Solution Design" },
  { key: "project_plan", label: "Project Plan" },
  { key: "dev_config", label: "Development & Configuration (DEV)" },
  { key: "uat", label: "System Testing & Validation (UAT / Qualification)" },
  { key: "deployment_readiness", label: "Deployment Readiness" },
  { key: "go_live", label: "Production Deployment & Go-Live" },
  { key: "business_closure", label: "Business closure" },
  { key: "operational_handover", label: "Operational handover" },
  { key: "financial_closure", label: "Financial closure" },
  { key: "closure", label: "PMO Closure" },
  // Legacy keys — kept so historical projects on these stages can still be configured.
  { key: "investment_authorization", label: "Investment Authorization (legacy)" },
  { key: "contract_po", label: "Contract & PO (legacy)" },
  { key: "design", label: "Design (legacy)" },
  { key: "build", label: "Build & Implementation (legacy)" },
];

// Roles available as escalation targets (match the role directory + charter keys).
const ROLE_OPTIONS = [
  "cfo", "sponsor", "project_manager", "owner", "procurement_head", "qa_lead",
  "steering_committee", "finance_head", "legal_head", "hod", "pmo_head", "chairman",
];

function roleLabel(role: string): string {
  return role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function AdminStageEscalation() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: rows, isLoading } = useQuery({
    queryKey: ["/api/stage-escalation-policy"],
    queryFn: async () => { const r = await fetch("/api/stage-escalation-policy"); if (!r.ok) throw new Error("Failed"); return r.json() as Promise<PolicyRow[]>; },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["/api/stage-escalation-policy"] });

  const patch = useMutation({
    mutationFn: async ({ id, ...body }: { id: number } & Partial<PolicyRow>) => {
      const r = await fetch(`/api/stage-escalation-policy/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error((await r.json())?.error ?? "Failed");
      return r.json();
    },
    onSuccess: () => { toast({ title: "Tier updated" }); invalidate(); },
    onError: (err: unknown) => toast({ title: "Update failed", description: err instanceof Error ? err.message : "Try again", variant: "destructive" }),
  });

  const create = useMutation({
    mutationFn: async (body: { stage: string; tier: number; afterDays: number; action: string; targetRole: string }) => {
      const r = await fetch(`/api/stage-escalation-policy`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error((await r.json())?.error ?? "Failed");
      return r.json();
    },
    onSuccess: () => { toast({ title: "Tier added" }); invalidate(); },
    onError: (err: unknown) => toast({ title: "Add failed", description: err instanceof Error ? err.message : "Try again", variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async (id: number) => { const r = await fetch(`/api/stage-escalation-policy/${id}`, { method: "DELETE" }); if (!r.ok) throw new Error("Failed"); },
    onSuccess: () => { toast({ title: "Tier removed" }); invalidate(); },
  });

  const byStage = new Map<string, PolicyRow[]>();
  for (const row of rows ?? []) { const l = byStage.get(row.stage) ?? []; l.push(row); byStage.set(row.stage, l); }

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-primary/10 border border-primary/20">
          <BellRing size={18} className="text-primary" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-foreground">Escalation Ladders</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Per-stage reminder/escalation tiers. Each tier fires once the stage has been pending ≥ its threshold (days), to the resolved person for that role.</p>
        </div>
      </div>

      {isLoading || !rows ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : (
        STAGES.map((st) => {
          const tiers = (byStage.get(st.key) ?? []).sort((a, b) => a.tier - b.tier || a.afterDays - b.afterDays);
          return (
            <DashboardCard key={st.key} title={st.label} subtitle={tiers.length ? undefined : "No ladder configured — adds nothing for this stage."}>
              <div className="space-y-2">
                {tiers.map((t) => (
                  <div key={t.id} className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/40 flex-wrap text-xs">
                    <span className="px-1.5 py-0.5 rounded bg-card border border-border font-mono">T{t.tier}</span>
                    <span className="text-muted-foreground">after</span>
                    <input
                      type="number" min={0} defaultValue={t.afterDays}
                      onBlur={(e) => { const v = Number(e.target.value); if (v !== t.afterDays) patch.mutate({ id: t.id, afterDays: v }); }}
                      className="w-14 rounded-md px-2 py-1 bg-card text-card-foreground border border-border text-right focus:outline-none focus:ring-2 focus:ring-ring/40"
                    />
                    <span className="text-muted-foreground">days →</span>
                    <select
                      defaultValue={t.action}
                      onChange={(e) => patch.mutate({ id: t.id, action: e.target.value as "remind" | "escalate" })}
                      className="rounded-md px-2 py-1 bg-card text-card-foreground border border-border focus:outline-none focus:ring-2 focus:ring-ring/40"
                    >
                      <option value="remind">remind</option>
                      <option value="escalate">escalate</option>
                    </select>
                    <select
                      defaultValue={t.targetRole}
                      onChange={(e) => patch.mutate({ id: t.id, targetRole: e.target.value })}
                      className="rounded-md px-2 py-1 bg-card text-card-foreground border border-border focus:outline-none focus:ring-2 focus:ring-ring/40"
                    >
                      {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
                      {!ROLE_OPTIONS.includes(t.targetRole) && <option value={t.targetRole}>{roleLabel(t.targetRole)}</option>}
                    </select>
                    <label className="inline-flex items-center gap-1 text-muted-foreground ml-1">
                      <input type="checkbox" defaultChecked={t.isActive} onChange={(e) => patch.mutate({ id: t.id, isActive: e.target.checked })} />
                      active
                    </label>
                    <button onClick={() => remove.mutate(t.id)} className="ml-auto text-muted-foreground/60 hover:text-destructive" title="Remove tier"><Trash2 size={14} /></button>
                  </div>
                ))}
                <button
                  onClick={() => create.mutate({ stage: st.key, tier: (tiers.at(-1)?.tier ?? 0) + 1, afterDays: 0, action: "remind", targetRole: "project_manager" })}
                  disabled={create.isPending}
                  className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md border border-border bg-card text-card-foreground hover:bg-accent transition-colors disabled:opacity-50"
                >
                  <Plus size={13} /> Add tier
                </button>
              </div>
            </DashboardCard>
          );
        })
      )}
    </div>
  );
}
