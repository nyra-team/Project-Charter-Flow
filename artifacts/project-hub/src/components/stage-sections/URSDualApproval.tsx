import { useListProjectStages, useUpdateProjectStage } from "@workspace/api-client-react";
import { useUserStore } from "../../lib/store";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "../../lib/format";

export function URSDualApprovalSection({ projectId }: { projectId: number }) {
  const { data: stages = [] } = useListProjectStages(projectId);
  const updateStage = useUpdateProjectStage();
  const { userId: _userId, role } = useUserStore();
  const { toast } = useToast();

  const ursRecord = (
    stages as Array<{ id: number; stage: string; notes?: string | null }>
  ).find((s) => s.stage === "urs");

  const parsedNotes: Record<string, unknown> = (() => {
    try { return JSON.parse(ursRecord?.notes ?? "{}"); }
    catch { return {}; }
  })();

  const bizApproved = !!(parsedNotes.__urs_biz_approved);
  const itApproved = !!(parsedNotes.__urs_it_approved);
  const bizApprovedAt = parsedNotes.__urs_biz_approved_at as string | undefined;
  const itApprovedAt = parsedNotes.__urs_it_approved_at as string | undefined;
  const bizApproverName = parsedNotes.__urs_biz_approver as string | undefined;
  const itApproverName = parsedNotes.__urs_it_approver as string | undefined;

  function approve(slot: "biz" | "it") {
    if (!ursRecord?.id) {
      toast({ title: "Initialise the URS stage first", variant: "destructive" });
      return;
    }
    const now = new Date().toISOString();
    const patch =
      slot === "biz"
        ? { __urs_biz_approved: true, __urs_biz_approved_at: now, __urs_biz_approver: role ?? "hod" }
        : { __urs_it_approved: true, __urs_it_approved_at: now, __urs_it_approver: role ?? "pmo" };
    updateStage.mutate(
      { id: ursRecord.id, data: { notes: JSON.stringify({ ...parsedNotes, ...patch }) } },
      {
        onSuccess: () =>
          toast({ title: `${slot === "biz" ? "Business Owner" : "IT Team"} approval recorded` }),
        onError: () => toast({ title: "Failed to record approval", variant: "destructive" }),
      },
    );
  }

  function revoke(slot: "biz" | "it") {
    if (!ursRecord?.id) return;
    const patch =
      slot === "biz"
        ? { __urs_biz_approved: false, __urs_biz_approved_at: null, __urs_biz_approver: null }
        : { __urs_it_approved: false, __urs_it_approved_at: null, __urs_it_approver: null };
    updateStage.mutate(
      { id: ursRecord.id, data: { notes: JSON.stringify({ ...parsedNotes, ...patch }) } },
      { onError: () => toast({ title: "Failed to revoke approval", variant: "destructive" }) },
    );
  }

  const canApproveBiz = role === "hod" || role === "executive_director";
  const canApproveIT = role === "pmo" || role === "hod";

  return (
    <div
      className="rounded-2xl p-4 space-y-3"
      style={{ background: "linear-gradient(135deg,#EEF2FF,#F5F3FF)" }}
    >
      <p className="text-sm font-bold text-indigo-900">URS Dual-Approval Required</p>
      <p className="text-xs text-indigo-700">
        Both Business Owner and IT Team must approve before advancing to RFP.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div
          className={`rounded-xl p-3 border-2 ${bizApproved ? "border-emerald-400 bg-emerald-50" : "border-amber-300 bg-amber-50"}`}
        >
          <p className="text-xs font-bold mb-1" style={{ color: bizApproved ? "#065F46" : "#92400E" }}>
            Business Owner
          </p>
          {bizApproved ? (
            <>
              <p className="text-xs text-emerald-700">✓ Approved by <strong>{bizApproverName}</strong></p>
              <p className="text-xs text-emerald-600">{bizApprovedAt ? formatDate(bizApprovedAt) : ""}</p>
              {canApproveBiz && (
                <button onClick={() => revoke("biz")} className="mt-2 text-xs text-red-600 underline">
                  Revoke
                </button>
              )}
            </>
          ) : (
            <>
              <p className="text-xs text-amber-700 mb-2">Pending approval</p>
              {canApproveBiz ? (
                <button
                  onClick={() => approve("biz")}
                  disabled={updateStage.isPending}
                  className="w-full text-xs font-semibold py-1.5 rounded-lg text-white transition-all disabled:opacity-50"
                  style={{ background: "#4F46E5" }}
                >
                  Approve as Business Owner
                </button>
              ) : (
                <p className="text-xs text-gray-500 italic">Requires HOD / Exec Director role</p>
              )}
            </>
          )}
        </div>

        <div
          className={`rounded-xl p-3 border-2 ${itApproved ? "border-emerald-400 bg-emerald-50" : "border-amber-300 bg-amber-50"}`}
        >
          <p className="text-xs font-bold mb-1" style={{ color: itApproved ? "#065F46" : "#92400E" }}>
            IT Team
          </p>
          {itApproved ? (
            <>
              <p className="text-xs text-emerald-700">✓ Approved by <strong>{itApproverName}</strong></p>
              <p className="text-xs text-emerald-600">{itApprovedAt ? formatDate(itApprovedAt) : ""}</p>
              {canApproveIT && (
                <button onClick={() => revoke("it")} className="mt-2 text-xs text-red-600 underline">
                  Revoke
                </button>
              )}
            </>
          ) : (
            <>
              <p className="text-xs text-amber-700 mb-2">Pending approval</p>
              {canApproveIT ? (
                <button
                  onClick={() => approve("it")}
                  disabled={updateStage.isPending}
                  className="w-full text-xs font-semibold py-1.5 rounded-lg text-white transition-all disabled:opacity-50"
                  style={{ background: "#4F46E5" }}
                >
                  Approve as IT Team
                </button>
              ) : (
                <p className="text-xs text-gray-500 italic">Requires PMO / HOD role</p>
              )}
            </>
          )}
        </div>
      </div>

      {bizApproved && itApproved && (
        <div className="rounded-xl p-3 text-center" style={{ background: "#ECFDF5" }}>
          <p className="text-sm font-bold text-emerald-700">
            ✓ Both approvals received — URS may be advanced to RFP
          </p>
        </div>
      )}
    </div>
  );
}
