import { useState, useEffect } from "react";
import { getStageConfig, isStageComplete, LIFECYCLE_STAGES, getStageIndex } from "../lib/lifecycle-config";
import {
  useListProjectStages, useCreateProjectStage,
  useUpdateProjectStage, useListDocuments, useListApprovals,
} from "@workspace/api-client-react";
import { useUserStore } from "../lib/store";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "../lib/format";
import {
  CheckSquare, Square, FileText, Lock, ArrowRight, Users,
  AlertTriangle, CheckCircle2, XCircle,
} from "lucide-react";
import { ApprovalStatusIcon, DocStatusBadge } from "./stage-sections/stage-helpers";
import { UATDefectSection } from "./stage-sections/UATDefects";
import { GoLiveCountdown } from "./stage-sections/GoLiveCountdown";
import { ClosureReport } from "./stage-sections/ClosureReport";
import { URSDualApprovalSection } from "./stage-sections/URSDualApproval";
import { RFPTemplateSection } from "./stage-sections/RFPTemplate";
import { KickoffAttendeesSection } from "./stage-sections/KickoffAttendees";
import { VendorEvalScorecard } from "./stage-sections/VendorEvalScorecard";
import { ClosureReadinessSection } from "./stage-sections/ClosureReadinessSection";
import { DocumentUploadRow } from "./stage-sections/DocumentUploadRow";

interface StagePanelProps {
  projectId: number;
  charterId?: number;
  currentStageKey: string;
  selectedStageKey?: string;
}

const CHECKLIST_KEY = (projectId: number, stage: string) =>
  `stage_checklist_${projectId}_${stage}`;

function loadChecklist(projectId: number, stage: string): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(CHECKLIST_KEY(projectId, stage));
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch { return {}; }
}

function saveChecklist(projectId: number, stage: string, state: Record<string, boolean>) {
  try { localStorage.setItem(CHECKLIST_KEY(projectId, stage), JSON.stringify(state)); } catch {}
}

type StageSpecific = Record<string, unknown>;

function stageHas(cfg: ReturnType<typeof getStageConfig>, flag: string): boolean {
  return !!(cfg && "stageSpecific" in cfg && (cfg as { stageSpecific?: StageSpecific }).stageSpecific?.[flag]);
}

export function StagePanel({ projectId, charterId, currentStageKey, selectedStageKey }: StagePanelProps) {
  const displayStageKey = selectedStageKey ?? currentStageKey;
  const stageConfig = getStageConfig(displayStageKey);
  const queryClient = useQueryClient();
  const { role } = useUserStore();
  const { toast } = useToast();

  const { data: stageRecords = [] } = useListProjectStages(projectId);
  const { data: documents = [], refetch: refetchDocs } = useListDocuments(projectId);
  const { data: approvals = [] } = useListApprovals(charterId ? { charterId } : {});

  const createStageMutation = useCreateProjectStage();
  const updateStageMutation = useUpdateProjectStage();

  const stageRecordEarly = (stageRecords as Array<{
    id: number; stage: string; status: string;
    enteredAt?: string | null; completedAt?: string | null; notes?: string | null;
  }>).find((r) => r.stage === displayStageKey);

  const [checklist, setChecklist] = useState<Record<string, boolean>>(() =>
    loadChecklist(projectId, displayStageKey),
  );
  const [activeTab, setActiveTab] = useState<"overview" | "documents" | "checklist" | "approvals">("overview");
  const [advancing, setAdvancing] = useState(false);

  // Reset checklist and tab when the selected stage changes to avoid cross-stage UI leakage
  useEffect(() => {
    setChecklist(loadChecklist(projectId, displayStageKey));
    setActiveTab("overview");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, displayStageKey]);

  useEffect(() => {
    if (stageRecordEarly?.notes) {
      try {
        const parsed = JSON.parse(stageRecordEarly.notes) as Record<string, unknown>;
        if (parsed.__checklist && typeof parsed.__checklist === "object") {
          const serverState = parsed.__checklist as Record<string, boolean>;
          setChecklist(serverState);
          saveChecklist(projectId, displayStageKey, serverState);
        }
      } catch {}
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageRecordEarly?.notes]);

  if (!stageConfig) {
    return (
      <div className="rounded-2xl p-8 text-center" style={{ background: "white", border: "1px solid #E2E8F0" }}>
        <p className="text-gray-400 text-sm">Stage information not available.</p>
      </div>
    );
  }

  const currentStageIdx = getStageIndex(currentStageKey);
  const displayStageIdx = getStageIndex(displayStageKey);
  const isCurrentStage = displayStageKey === currentStageKey;
  const isCompletedStage =
    displayStageIdx < currentStageIdx ||
    stageRecords.some((r: { stage: string; status: string }) => r.stage === displayStageKey && r.status === "complete");
  const isLockedStage =
    displayStageIdx > currentStageIdx &&
    !stageRecords.some(
      (r: { stage: string; status: string }) =>
        r.stage === displayStageKey && (r.status === "in_progress" || r.status === "complete"),
    );

  const stageDocs = (documents as Array<{ id: number; stage?: string | null; name: string; approvalStatus: string; uploadedAt: string; fileType?: string | null; fileSize?: number | null }>).filter(
    (d) => d.stage === displayStageKey,
  );

  const stageRecord = stageRecords.find(
    (r: { stage: string }) => r.stage === displayStageKey,
  ) as { id: number; stage: string; status: string; enteredAt?: string | null; completedAt?: string | null; notes?: string | null } | undefined;

  const canAdvance =
    isCurrentStage &&
    !isCompletedStage &&
    (stageConfig.advanceRoles as readonly string[]).includes(role);

  const allBlockingComplete = stageConfig.checklistItems
    .filter((i) => i.blocking)
    .every((i) => checklist[i.id]);

  const requiredDocsUploaded = stageConfig.requiredDocs.every((rd) =>
    stageDocs.some((d) => d.name === rd.name),
  );

  const canAdvanceNow = canAdvance && allBlockingComplete && requiredDocsUploaded;

  function toggleChecklist(itemId: string) {
    if (isCompletedStage) return;
    const next = { ...checklist, [itemId]: !checklist[itemId] };
    setChecklist(next);
    saveChecklist(projectId, displayStageKey, next);
    if (stageRecord?.id) {
      const existingNotes = (() => {
        try { return stageRecord.notes ? (JSON.parse(stageRecord.notes) as Record<string, unknown>) : {}; }
        catch { return {}; }
      })();
      updateStageMutation.mutate({
        id: stageRecord.id,
        data: { notes: JSON.stringify({ ...existingNotes, __checklist: next }) },
      });
    }
  }

  function handleAdvance() {
    setAdvancing(true);
    fetch(`/api/projects/${projectId}/stages/${displayStageKey}/advance`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({ error: "Server error" })) as { error?: string };
          toast({ title: body.error ?? "Failed to advance stage", variant: "destructive" });
          return;
        }
        toast({ title: `Advanced past "${stageConfig!.label}" successfully!` });
        queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
        queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "stages"] });
      })
      .catch(() => toast({ title: "Network error advancing stage", variant: "destructive" }))
      .finally(() => setAdvancing(false));
  }

  function handleInitializeStage() {
    createStageMutation.mutate(
      { id: projectId, data: { stage: displayStageKey, status: "in_progress" } },
      {
        onSuccess: () => {
          toast({ title: `Stage "${stageConfig!.label}" initialized` });
          queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "stages"] });
        },
        onError: () => toast({ title: "Failed to initialize stage", variant: "destructive" }),
      },
    );
  }

  const TABS = [
    { id: "overview" as const, label: "Overview" },
    { id: "documents" as const, label: `Documents (${stageDocs.length}/${stageConfig.requiredDocs.length})` },
    { id: "checklist" as const, label: `Checklist (${stageConfig.checklistItems.filter((i) => checklist[i.id]).length}/${stageConfig.checklistItems.length})` },
    { id: "approvals" as const, label: `Approvals (${approvals.length})` },
  ];

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: "white", border: "1px solid #E2E8F0" }}>
      {/* Stage Header */}
      <div
        className="px-5 py-4"
        style={{
          background: `linear-gradient(135deg, ${stageConfig.color}18, ${stageConfig.color}08)`,
          borderBottom: `1px solid ${stageConfig.color}30`,
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span
                className="text-xs font-bold px-2 py-0.5 rounded-full"
                style={{ background: `${stageConfig.color}20`, color: stageConfig.color }}
              >
                Stage {displayStageIdx + 1} of {LIFECYCLE_STAGES.length}
              </span>
              {isCompletedStage && (
                <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: "#ECFDF5", color: "#065F46" }}>
                  ✓ Completed
                </span>
              )}
              {isLockedStage && (
                <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: "#F1F5F9", color: "#64748B" }}>
                  <Lock size={10} className="inline mr-1" />Locked
                </span>
              )}
              {isCurrentStage && !isCompletedStage && (
                <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: "#EEF2FF", color: "#4F46E5" }}>
                  Active
                </span>
              )}
            </div>
            <h3 className="text-lg font-bold text-gray-900">{stageConfig.label}</h3>
            <p className="text-sm text-gray-500 mt-0.5">{stageConfig.description}</p>
            {stageRecord?.enteredAt && (
              <p className="text-xs text-gray-400 mt-1">
                Started {formatDate(stageRecord.enteredAt)}
                {stageRecord.completedAt && ` · Completed ${formatDate(stageRecord.completedAt)}`}
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-2 flex-shrink-0">
            {stageConfig.prerequisites.length > 0 && (
              <div className="text-xs text-gray-400 text-right">
                <p className="font-semibold mb-0.5">Prerequisites</p>
                {stageConfig.prerequisites.map((p) => {
                  const prereqComplete = isStageComplete(p, stageRecords as Array<{ stage: string; status: string }>);
                  const prereqConfig = getStageConfig(p);
                  return (
                    <span
                      key={p}
                      className="flex items-center gap-1 text-xs"
                      style={{ color: prereqComplete ? "#10B981" : "#EF4444" }}
                    >
                      {prereqComplete ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
                      {prereqConfig?.label ?? p}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="flex gap-0 border-b border-gray-100" style={{ background: "#F8FAFC" }}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="px-4 py-2.5 text-xs font-semibold transition-all border-b-2"
            style={{
              borderColor: activeTab === tab.id ? stageConfig.color : "transparent",
              color: activeTab === tab.id ? stageConfig.color : "#64748B",
              background: "transparent",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="p-5">
        {activeTab === "overview" && (
          <div className="space-y-4">
            {isLockedStage && (
              <div className="rounded-xl p-4 flex items-center gap-3" style={{ background: "#F8FAFC", border: "1px solid #E2E8F0" }}>
                <Lock size={18} className="text-gray-400 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-gray-600">Stage Locked</p>
                  <p className="text-xs text-gray-400">Complete the current active stage to unlock {stageConfig.label}.</p>
                </div>
              </div>
            )}

            {!stageRecord && isCurrentStage && (
              <div className="rounded-xl p-4" style={{ background: "#EEF2FF", border: "1px solid #C7D2FE" }}>
                <p className="text-sm font-semibold text-indigo-800 mb-2">Stage not yet started</p>
                <p className="text-xs text-indigo-600 mb-3">Initialize this stage to begin tracking progress.</p>
                <button
                  onClick={handleInitializeStage}
                  disabled={createStageMutation.isPending}
                  className="px-4 py-2 rounded-lg text-sm font-semibold text-white"
                  style={{ background: "linear-gradient(135deg,#6366F1,#8B5CF6)" }}
                >
                  Initialize Stage
                </button>
              </div>
            )}

            {/* Stage-specific workflow sections */}
            {stageHas(stageConfig, "hasURSDualApproval") && <URSDualApprovalSection projectId={projectId} />}
            {stageHas(stageConfig, "hasRFPTemplate") && <RFPTemplateSection projectId={projectId} />}
            {stageHas(stageConfig, "hasVendorEvalScorecard") && <VendorEvalScorecard projectId={projectId} />}
            {stageHas(stageConfig, "hasKickoffAttendees") && <KickoffAttendeesSection projectId={projectId} />}
            {stageHas(stageConfig, "hasUATDefects") && <UATDefectSection projectId={projectId} />}
            {stageHas(stageConfig, "hasGoLiveCountdown") && <GoLiveCountdown projectId={projectId} />}
            {stageHas(stageConfig, "hasClosureReadinessSection") && <ClosureReadinessSection projectId={projectId} />}
            {stageHas(stageConfig, "isClosureStage") && <ClosureReport projectId={projectId} />}

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl p-3" style={{ background: "#F0FDF4" }}>
                <p className="text-xs text-emerald-700 font-semibold mb-1">Documents</p>
                <p className="text-xl font-bold text-emerald-800">
                  {stageDocs.length}<span className="text-xs text-emerald-600 font-normal">/{stageConfig.requiredDocs.length}</span>
                </p>
                <p className="text-xs text-emerald-600">uploaded</p>
              </div>
              <div className="rounded-xl p-3" style={{ background: "#EEF2FF" }}>
                <p className="text-xs text-indigo-700 font-semibold mb-1">Checklist</p>
                <p className="text-xl font-bold text-indigo-800">
                  {stageConfig.checklistItems.filter((i) => checklist[i.id]).length}
                  <span className="text-xs text-indigo-600 font-normal">/{stageConfig.checklistItems.length}</span>
                </p>
                <p className="text-xs text-indigo-600">complete</p>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs text-gray-500">
              <Users size={12} />
              <span>Can advance: {stageConfig.advanceRoles.join(", ")}</span>
            </div>
          </div>
        )}

        {activeTab === "documents" && (
          <div className="space-y-3">
            {stageConfig.requiredDocs.map((reqDoc) => {
              const uploaded = stageDocs.find((d) => d.name === reqDoc.name);
              return (
                <DocumentUploadRow
                  key={reqDoc.id}
                  doc={reqDoc}
                  projectId={projectId}
                  stageKey={displayStageKey}
                  existingDoc={uploaded}
                  onUploaded={() => refetchDocs()}
                />
              );
            })}
            {stageDocs.length > stageConfig.requiredDocs.length && (
              <div className="mt-3">
                <p className="text-xs font-semibold text-gray-500 mb-2">Additional Documents</p>
                {stageDocs
                  .filter((d) => !stageConfig.requiredDocs.some((rd) => rd.name === d.name))
                  .map((d) => (
                    <div key={d.id} className="flex items-center gap-2 py-1.5 text-sm text-gray-600">
                      <FileText size={13} className="text-gray-400" />
                      <span className="flex-1">{d.name}</span>
                      <DocStatusBadge status={d.approvalStatus} />
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "checklist" && (
          <div className="space-y-2">
            {stageConfig.checklistItems.map((item) => {
              const done = !!checklist[item.id];
              return (
                <button
                  key={item.id}
                  onClick={() => toggleChecklist(item.id)}
                  disabled={isCompletedStage || isLockedStage}
                  className="w-full flex items-start gap-3 p-3 rounded-xl text-left transition-all hover:opacity-90 disabled:cursor-default"
                  style={{ background: done ? "#F0FDF4" : "#F8FAFC", border: `1px solid ${done ? "#86EFAC" : "#E2E8F0"}` }}
                >
                  {done ? (
                    <CheckSquare size={16} className="text-emerald-500 flex-shrink-0 mt-0.5" />
                  ) : (
                    <Square size={16} className="text-gray-300 flex-shrink-0 mt-0.5" />
                  )}
                  <span className={`text-sm flex-1 ${done ? "text-emerald-800 line-through" : "text-gray-700"}`}>
                    {item.label}
                  </span>
                  {item.blocking && !done && (
                    <span className="text-xs px-1.5 py-0.5 rounded font-bold flex-shrink-0" style={{ background: "#FEE2E2", color: "#991B1B" }}>
                      Required
                    </span>
                  )}
                </button>
              );
            })}
            {!allBlockingComplete && (
              <div className="mt-2 flex items-center gap-2 text-xs text-amber-700 p-2 rounded-lg" style={{ background: "#FFFBEB" }}>
                <AlertTriangle size={12} />
                <span>Complete all required checklist items to enable stage advancement.</span>
              </div>
            )}
          </div>
        )}

        {activeTab === "approvals" && (
          <div className="space-y-2">
            {(approvals as Array<{ id: number; approverRole?: string; approverName?: string; status: string; decidedAt?: string | null; comments?: string | null }>).length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">No approval records yet for this project.</p>
            ) : (
              (approvals as Array<{ id: number; approverRole?: string; approverName?: string; status: string; decidedAt?: string | null; comments?: string | null }>).map((a) => (
                <div key={a.id} className="flex items-start gap-3 p-3 rounded-xl" style={{ background: "#F8FAFC", border: "1px solid #E2E8F0" }}>
                  <ApprovalStatusIcon status={a.status} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-gray-800">{a.approverName ?? "—"}</span>
                      <span className="text-xs capitalize text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{a.approverRole}</span>
                      <span className={`text-xs font-bold capitalize px-1.5 py-0.5 rounded ${a.status === "approved" ? "text-emerald-700 bg-emerald-50" : a.status === "rejected" ? "text-red-700 bg-red-50" : "text-amber-700 bg-amber-50"}`}>
                        {a.status}
                      </span>
                    </div>
                    {a.comments && <p className="text-xs text-gray-500 mt-1">{a.comments}</p>}
                    {a.decidedAt && <p className="text-xs text-gray-400 mt-0.5">{formatDate(a.decidedAt)}</p>}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Action Footer */}
      {(canAdvance || isLockedStage || isCompletedStage) && (
        <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-between gap-3" style={{ background: "#F8FAFC" }}>
          <div className="text-xs text-gray-400">
            {isCompletedStage && (
              <span className="flex items-center gap-1 text-emerald-600 font-semibold">
                <CheckCircle2 size={12} />
                Stage completed
              </span>
            )}
            {isLockedStage && (
              <span className="flex items-center gap-1 text-gray-500">
                <Lock size={12} />
                Complete current stage to unlock
              </span>
            )}
            {canAdvance && !isCompletedStage && (
              <span>
                {!allBlockingComplete
                  ? "Complete all required checklist items to advance"
                  : !requiredDocsUploaded
                    ? "Upload required documents to advance"
                    : "Ready to advance"}
              </span>
            )}
          </div>
          {canAdvance && !isCompletedStage && (
            <button
              onClick={handleAdvance}
              disabled={!canAdvanceNow || advancing}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: canAdvanceNow ? `linear-gradient(135deg, ${stageConfig.color}, ${stageConfig.color}CC)` : "#CBD5E1" }}
            >
              {stageConfig.advanceLabel}
              <ArrowRight size={14} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
