// Automations — a Monday.com-style "When … then …" recipe gallery that drives
// the EXISTING escalation engine (pmo_escalation_rules + the hourly/5-min
// evaluator jobs). No parallel rules engine: every recipe here just creates /
// toggles a real escalation rule, so all governance plumbing (role-directory
// routing, notification + email delivery, dedup) is reused unchanged.
import { useMemo, useState } from "react";
import {
  useListEscalationRules, useCreateEscalationRule,
  useUpdateEscalationRule, useDeleteEscalationRule, useListUsers,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useUserStore } from "../lib/store";
import { PageHeader } from "@/components/ui-kit";
import { Input } from "@/components/ui/input";
import { Zap, Bell, Plus, Trash2, ArrowRight, ShieldCheck } from "lucide-react";

type Rule = {
  id: number; projectId?: number | null; triggerType: string;
  thresholdValue: number | string; notifyUserIds: number[]; isActive: boolean;
};

// Each recipe maps a friendly Monday-style sentence to one escalation trigger.
const RECIPES: {
  trigger: string; when: string; then: string; unit: string; defaultThreshold: number; accent: string;
}[] = [
  { trigger: "rag_change", when: "a project's health turns Red", then: "notify the watchers", unit: "", defaultThreshold: 0, accent: "#DC2626" },
  { trigger: "stage_blocked_days", when: "a lifecycle stage is overdue", then: "remind the approver", unit: "days", defaultThreshold: 3, accent: "#F59E0B" },
  { trigger: "schedule_slip_days", when: "a milestone slips", then: "escalate to the manager", unit: "days", defaultThreshold: 5, accent: "#6366F1" },
  { trigger: "budget_overrun_pct", when: "budget overrun exceeds", then: "alert finance + PMO", unit: "%", defaultThreshold: 10, accent: "#0EA5E9" },
  { trigger: "issue_open_days", when: "an issue stays open", then: "nudge the owner", unit: "days", defaultThreshold: 7, accent: "#8B5CF6" },
  { trigger: "risk_score", when: "a risk score reaches", then: "raise to the steering committee", unit: "pts", defaultThreshold: 15, accent: "#EF4444" },
];

const RECIPE_BY_TRIGGER = Object.fromEntries(RECIPES.map((r) => [r.trigger, r]));
const ADMIN_ROLES = ["pmo", "executive_director", "chairman"];

export default function AutomationsPage() {
  const { toast } = useToast();
  const { role } = useUserStore();
  const canEdit = ADMIN_ROLES.includes(role);
  const { data: rules = [], refetch } = useListEscalationRules();
  const { data: users = [] } = useListUsers();
  const createRule = useCreateEscalationRule();
  const updateRule = useUpdateEscalationRule();
  const deleteRule = useDeleteEscalationRule();

  const rulesArr = rules as Rule[];
  const usersArr = users as Array<{ id: number; name: string }>;
  const userName = (id: number) => usersArr.find((u) => u.id === id)?.name ?? `#${id}`;

  const [draft, setDraft] = useState<{ trigger: string; threshold: string; notify: number[] } | null>(null);

  const activeCount = useMemo(() => rulesArr.filter((r) => r.isActive).length, [rulesArr]);

  function openRecipe(trigger: string) {
    const r = RECIPE_BY_TRIGGER[trigger];
    setDraft({ trigger, threshold: String(r?.defaultThreshold ?? 0), notify: [] });
  }
  function saveDraft() {
    if (!draft) return;
    if (!draft.notify.length) { toast({ title: "Pick at least one recipient", variant: "destructive" }); return; }
    createRule.mutate(
      // projectId omitted → a global automation (null in the DB).
      { data: { triggerType: draft.trigger, thresholdValue: parseFloat(draft.threshold) || 0, notifyUserIds: draft.notify, isActive: true } },
      {
        onSuccess: () => { toast({ title: "Automation turned on" }); setDraft(null); refetch(); },
        onError: () => toast({ title: "Could not create automation", variant: "destructive" }),
      },
    );
  }
  function toggle(r: Rule) {
    updateRule.mutate({ id: r.id, data: { isActive: !r.isActive } }, { onSuccess: () => refetch() });
  }
  function remove(id: number) {
    if (!confirm("Delete this automation?")) return;
    deleteRule.mutate({ id }, { onSuccess: () => { refetch(); toast({ title: "Automation removed" }); } });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Automations"
        subtitle={`${activeCount} active · runs on the existing escalation engine`}
        icon={Zap}
      />

      {/* Governance reassurance banner */}
      <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/30 p-3">
        <ShieldCheck size={16} className="text-success mt-0.5 flex-shrink-0" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          Automations here configure the same escalation rules your governance engine already evaluates on schedule —
          including role-directory routing, in-app notifications and email. Nothing bypasses approvals or the audit trail.
        </p>
      </div>

      {/* Recipe gallery */}
      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Recipes</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {RECIPES.map((r) => (
            <div key={r.trigger} className="rounded-xl border border-card-border bg-card glass-surface p-4 flex flex-col" style={{ borderLeft: `3px solid ${r.accent}` }}>
              <p className="text-sm text-foreground leading-snug">
                <span className="text-muted-foreground">When </span>{r.when}{r.unit ? <span className="text-muted-foreground"> (≥ threshold {r.unit})</span> : ""}
                <span className="inline-flex items-center mx-1 align-middle text-muted-foreground"><ArrowRight size={12} /></span>
                <span className="font-medium">{r.then}</span>.
              </p>
              {canEdit && (
                <button
                  onClick={() => openRecipe(r.trigger)}
                  className="mt-3 self-start inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
                >
                  <Plus size={13} /> Add automation
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Active automations */}
      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Your automations</h3>
        {rulesArr.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
            No automations yet — add one from a recipe above.
          </div>
        ) : (
          <div className="space-y-2">
            {rulesArr.map((r) => {
              const recipe = RECIPE_BY_TRIGGER[r.triggerType];
              return (
                <div key={r.id} className="rounded-xl border border-card-border bg-card glass-surface p-3.5 flex items-center gap-3" style={{ opacity: r.isActive ? 1 : 0.55 }}>
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: r.isActive ? "hsl(var(--warn) / 0.15)" : "hsl(var(--border))" }}>
                    <Bell size={15} className={r.isActive ? "text-warn" : "text-muted-foreground"} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground">
                      <span className="text-muted-foreground">When </span>{recipe?.when ?? r.triggerType}
                      {Number(r.thresholdValue) > 0 && <b> ≥ {Number(r.thresholdValue)}{recipe?.unit}</b>}
                      <span className="inline-flex items-center mx-1 align-middle text-muted-foreground"><ArrowRight size={11} /></span>
                      {recipe?.then ?? "notify"}
                      {r.projectId == null && <span className="ml-2 text-[10px] uppercase tracking-wider text-muted-foreground/70">global</span>}
                    </p>
                    <div className="flex flex-wrap items-center gap-1 mt-1 text-[11px] text-muted-foreground">
                      {(r.notifyUserIds ?? []).map((uid) => (
                        <span key={uid} className="px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">{userName(uid)}</span>
                      ))}
                    </div>
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggle(r)}
                        className="text-xs font-semibold px-2.5 py-1 rounded"
                        style={{ background: r.isActive ? "hsl(var(--success) / 0.10)" : "hsl(var(--border))", color: r.isActive ? "hsl(var(--success))" : "hsl(var(--muted-foreground))" }}
                      >
                        {r.isActive ? "● On" : "○ Off"}
                      </button>
                      <button onClick={() => remove(r.id)} className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"><Trash2 size={13} /></button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Inline create panel */}
      {draft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDraft(null)}>
          <div className="w-full max-w-lg rounded-2xl bg-card border border-card-border shadow-xl p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Zap size={15} className="text-warn" /> New automation
            </h3>
            <p className="text-xs text-muted-foreground">
              When {RECIPE_BY_TRIGGER[draft.trigger]?.when}{RECIPE_BY_TRIGGER[draft.trigger]?.unit ? ` (≥ threshold)` : ""} → {RECIPE_BY_TRIGGER[draft.trigger]?.then}.
            </p>
            {RECIPE_BY_TRIGGER[draft.trigger]?.unit && (
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Threshold ({RECIPE_BY_TRIGGER[draft.trigger]?.unit})</label>
                <Input type="number" value={draft.threshold} onChange={(e) => setDraft({ ...draft, threshold: e.target.value })} className="mt-1" />
              </div>
            )}
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Notify</label>
              <div className="grid grid-cols-2 gap-1.5 mt-1 max-h-48 overflow-y-auto p-2 border border-border rounded-lg">
                {usersArr.map((u) => {
                  const on = draft.notify.includes(u.id);
                  return (
                    <button
                      key={u.id} type="button"
                      onClick={() => setDraft({ ...draft, notify: on ? draft.notify.filter((x) => x !== u.id) : [...draft.notify, u.id] })}
                      className="flex items-center gap-2 px-2 py-1.5 text-xs rounded text-left"
                      style={{ background: on ? "hsl(var(--primary) / 0.10)" : "transparent", color: on ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))" }}
                    >
                      <span className="w-3 h-3 rounded border flex-shrink-0" style={{ background: on ? "hsl(var(--primary))" : "hsl(var(--card))", borderColor: on ? "hsl(var(--primary))" : "hsl(var(--border))" }} />
                      <span className="truncate">{u.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setDraft(null)} className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted/40">Cancel</button>
              <button onClick={saveDraft} className="px-4 py-2 text-sm font-semibold text-primary-foreground rounded-lg bg-primary hover:bg-primary/90">Turn on</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
