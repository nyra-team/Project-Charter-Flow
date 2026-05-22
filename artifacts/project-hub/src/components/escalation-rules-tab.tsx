import { useState } from "react";
import {
  useListEscalationRules, useCreateEscalationRule,
  useUpdateEscalationRule, useDeleteEscalationRule, useListUsers,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useUserStore } from "../lib/store";
import { Bell, Plus, Trash2, Zap } from "lucide-react";

type Rule = {
  id: number; projectId?: number | null; triggerType: string;
  thresholdValue: number | string; notifyUserIds: number[]; isActive: boolean;
};

const TRIGGERS = [
  { value: "rag_change", label: "RAG status changes to red" },
  { value: "budget_overrun_pct", label: "Budget overrun exceeds threshold %" },
  { value: "schedule_slip_days", label: "Milestone slips by N days" },
  { value: "risk_score", label: "Risk score reaches threshold" },
  { value: "issue_open_days", label: "Issue open for N days" },
];

const ADMIN_ROLES = ["pmo", "executive_director", "chairman"];

export function EscalationRulesTab({ projectId }: { projectId: number }) {
  const { toast } = useToast();
  const { role } = useUserStore();
  const { data: rules = [], refetch } = useListEscalationRules({ projectId });
  const { data: users = [] } = useListUsers();
  const createRule = useCreateEscalationRule();
  const updateRule = useUpdateEscalationRule();
  const deleteRule = useDeleteEscalationRule();

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ triggerType: "rag_change", thresholdValue: "0", notifyUserIds: [] as number[] });

  const rulesArr = rules as Rule[];
  const usersArr = users as Array<{ id: number; name: string; role?: string }>;
  const userName = (id: number) => usersArr.find(u => u.id === id)?.name ?? `#${id}`;

  const canEdit = ADMIN_ROLES.includes(role);

  function handleAdd() {
    if (!form.notifyUserIds.length) { toast({ title: "Select at least one notify recipient", variant: "destructive" }); return; }
    createRule.mutate({
      data: {
        projectId,
        triggerType: form.triggerType,
        thresholdValue: parseFloat(form.thresholdValue) || 0,
        notifyUserIds: form.notifyUserIds,
        isActive: true,
      },
    }, {
      onSuccess: () => {
        toast({ title: "Escalation rule created" });
        setShowAdd(false);
        setForm({ triggerType: "rag_change", thresholdValue: "0", notifyUserIds: [] });
        refetch();
      },
      onError: () => toast({ title: "Failed to create rule", variant: "destructive" }),
    });
  }
  function toggle(r: Rule) {
    updateRule.mutate({ id: r.id, data: { isActive: !r.isActive } }, { onSuccess: () => refetch() });
  }
  function handleDelete(id: number) {
    if (!confirm("Delete this escalation rule?")) return;
    deleteRule.mutate({ id }, { onSuccess: () => { refetch(); toast({ title: "Rule deleted" }); } });
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl p-5 flex items-center justify-between" style={{ background: "white", border: "1px solid #E2E8F0" }}>
        <div>
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <Zap size={16} className="text-amber-500" /> Escalation Rules
          </h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {canEdit ? "Configure automatic notifications when project metrics breach thresholds." : "Read-only — only PMO/ED/Chairman roles can edit."}
          </p>
        </div>
        {canEdit && (
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white" style={{ background: "linear-gradient(135deg, #F59E0B, #DC2626)" }}>
            <Plus size={14} /> New Rule
          </button>
        )}
      </div>

      {rulesArr.length === 0 ? (
        <div className="rounded-2xl p-10 text-center text-sm text-gray-400" style={{ background: "white", border: "1px solid #E2E8F0" }}>
          No escalation rules configured for this project.
        </div>
      ) : (
        <div className="space-y-2">
          {rulesArr.map(r => {
            const trigger = TRIGGERS.find(t => t.value === r.triggerType);
            return (
              <div key={r.id} className="rounded-2xl p-4 flex items-center gap-4" style={{ background: "white", border: "1px solid #E2E8F0", opacity: r.isActive ? 1 : 0.55 }}>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: r.isActive ? "#FEF3C7" : "#F1F5F9" }}>
                  <Bell size={15} className={r.isActive ? "text-amber-600" : "text-gray-400"} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900">{trigger?.label ?? r.triggerType}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-gray-500">
                    {Number(r.thresholdValue) > 0 && <span>Threshold: <b>{Number(r.thresholdValue)}</b></span>}
                    <span>Notify:</span>
                    {(r.notifyUserIds ?? []).map(uid => (
                      <span key={uid} className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 font-semibold">{userName(uid)}</span>
                    ))}
                  </div>
                </div>
                {canEdit && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggle(r)}
                      className="text-xs font-semibold px-2.5 py-1 rounded"
                      style={{
                        background: r.isActive ? "#ECFDF5" : "#F1F5F9",
                        color: r.isActive ? "#15803D" : "#64748B",
                      }}
                    >
                      {r.isActive ? "● Active" : "○ Inactive"}
                    </button>
                    <button onClick={() => handleDelete(r.id)} className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-500">
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={showAdd} onOpenChange={v => { if (!v) setShowAdd(false); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Zap size={16} className="text-amber-500" /> New Escalation Rule</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-gray-500">Trigger</label>
              <select value={form.triggerType} onChange={e => setForm({ ...form, triggerType: e.target.value })} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 mt-1">
                {TRIGGERS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500">Threshold value</label>
              <Input type="number" value={form.thresholdValue} onChange={e => setForm({ ...form, thresholdValue: e.target.value })} placeholder="e.g. 10 (= 10% or 10 days)" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500">Notify these users</label>
              <div className="grid grid-cols-2 gap-1.5 mt-1 max-h-48 overflow-y-auto p-2 border border-gray-200 rounded-lg">
                {usersArr.map(u => {
                  const on = form.notifyUserIds.includes(u.id);
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => setForm({ ...form, notifyUserIds: on ? form.notifyUserIds.filter(x => x !== u.id) : [...form.notifyUserIds, u.id] })}
                      className="flex items-center gap-2 px-2 py-1.5 text-xs rounded text-left"
                      style={{ background: on ? "#EEF2FF" : "transparent", color: on ? "#4338CA" : "#475569" }}
                    >
                      <span className="w-3 h-3 rounded border flex-shrink-0" style={{ background: on ? "#4338CA" : "white", borderColor: on ? "#4338CA" : "#CBD5E1" }} />
                      <span className="truncate">{u.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50">Cancel</button>
              <button onClick={handleAdd} className="px-4 py-2 text-sm font-semibold text-white rounded-lg" style={{ background: "linear-gradient(135deg, #F59E0B, #DC2626)" }}>Create Rule</button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
