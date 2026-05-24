import { useEffect, useState } from "react";
import { useListProjectStages, useUpdateProjectStage } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, Clock, Circle } from "lucide-react";

type NFAApproval = { approver: string; status: "pending" | "approved" | "rejected"; decidedAt?: string; comment?: string };
type NFAPayload = {
  nfaNumber?: string;
  amountRequested?: number;
  chain: NFAApproval[];
  savedAt?: string;
};

const DEFAULT_CHAIN: NFAApproval[] = [
  { approver: "Finance Head", status: "pending" },
  { approver: "PMO", status: "pending" },
  { approver: "Department Head", status: "pending" },
  { approver: "Chairman / MD", status: "pending" },
];

export function NFASection({ projectId }: { projectId: number }) {
  const { data: stages = [] } = useListProjectStages(projectId);
  const updateStage = useUpdateProjectStage();
  const { toast } = useToast();

  const stageRecord = (stages as Array<{ id: number; stage: string; notes?: string | null }>)
    .find((s) => s.stage === "nfa");
  const parsed: Record<string, unknown> = (() => {
    try { return JSON.parse(stageRecord?.notes ?? "{}"); } catch { return {}; }
  })();
  const saved: NFAPayload = (parsed.__nfa as NFAPayload) ?? { chain: DEFAULT_CHAIN };

  const [nfaNo, setNfaNo] = useState(saved.nfaNumber ?? "");
  const [amount, setAmount] = useState<string>(saved.amountRequested?.toString() ?? "");
  const [chain, setChain] = useState<NFAApproval[]>(saved.chain ?? DEFAULT_CHAIN);

  useEffect(() => {
    setNfaNo(saved.nfaNumber ?? "");
    setAmount(saved.amountRequested?.toString() ?? "");
    setChain(saved.chain && saved.chain.length > 0 ? saved.chain : DEFAULT_CHAIN);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageRecord?.id]);

  function persist(next: Partial<NFAPayload>) {
    if (!stageRecord?.id) {
      toast({ title: "Initialise the NFA stage first", variant: "destructive" });
      return;
    }
    const payload: NFAPayload = {
      nfaNumber: nfaNo, amountRequested: Number(amount) || 0, chain,
      ...next, savedAt: new Date().toISOString(),
    };
    updateStage.mutate(
      { id: stageRecord.id, data: { notes: JSON.stringify({ ...parsed, __nfa: payload }) } },
      { onError: () => toast({ title: "Failed to save NFA", variant: "destructive" }) },
    );
  }

  function decide(idx: number, status: "approved" | "rejected") {
    const next = chain.map((c, i) => i === idx ? { ...c, status, decidedAt: new Date().toISOString() } : c);
    setChain(next);
    persist({ chain: next });
  }

  const allApproved = chain.every(c => c.status === "approved");
  const anyRejected = chain.some(c => c.status === "rejected");

  return (
    <div className="rounded-2xl p-4 space-y-3" style={{ background: "linear-gradient(135deg,#FFFBEB,#FEF3C7)" }}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-bold text-amber-900">NFA — Note for Approval</p>
          <p className="text-[11px] text-amber-700">FR-11 · multi-level approval gate that unlocks PR + PO release</p>
        </div>
        {allApproved && <span className="text-[10px] font-mono font-semibold text-green-700 bg-green-100 rounded-full px-2 py-0.5">✓ FULLY APPROVED</span>}
        {anyRejected && <span className="text-[10px] font-mono font-semibold text-red-700 bg-red-100 rounded-full px-2 py-0.5">✗ REJECTED</span>}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[11px] font-semibold text-amber-900 block mb-1">NFA Number</label>
          <input
            value={nfaNo} onChange={(e) => setNfaNo(e.target.value)} onBlur={() => persist({})}
            placeholder="NFA-2026-001"
            className="w-full text-xs border border-amber-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-amber-400 font-mono"
          />
        </div>
        <div>
          <label className="text-[11px] font-semibold text-amber-900 block mb-1">Amount Requested (₹)</label>
          <input
            type="number" value={amount} onChange={(e) => setAmount(e.target.value)} onBlur={() => persist({})}
            placeholder="0"
            className="w-full text-xs border border-amber-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-amber-400 font-mono"
          />
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-[10px] font-mono uppercase tracking-wider font-semibold text-amber-900">Approval Chain</p>
        {chain.map((c, i) => {
          const Icon = c.status === "approved" ? CheckCircle2 : c.status === "rejected" ? Clock : Circle;
          const iconCls = c.status === "approved" ? "text-green-600" : c.status === "rejected" ? "text-red-600" : "text-gray-400";
          return (
            <div key={i} className="flex items-center gap-3 bg-white rounded-lg px-3 py-2 border border-amber-100">
              <Icon size={16} className={`flex-shrink-0 ${iconCls}`} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-gray-900">{c.approver}</p>
                {c.decidedAt && (
                  <p className="text-[10px] text-gray-500 font-mono">
                    {c.status === "approved" ? "Approved" : "Rejected"} {new Date(c.decidedAt).toLocaleDateString()}
                  </p>
                )}
              </div>
              {c.status === "pending" && (
                <div className="flex gap-1">
                  <button
                    onClick={() => decide(i, "approved")}
                    disabled={updateStage.isPending}
                    className="text-[10px] font-semibold text-white px-2 py-1 rounded bg-green-600 hover:bg-green-700 disabled:opacity-40"
                  >Approve</button>
                  <button
                    onClick={() => decide(i, "rejected")}
                    disabled={updateStage.isPending}
                    className="text-[10px] font-semibold text-white px-2 py-1 rounded bg-red-500 hover:bg-red-600 disabled:opacity-40"
                  >Reject</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
