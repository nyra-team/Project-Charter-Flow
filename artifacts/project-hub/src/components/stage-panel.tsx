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
import { DemandInitiationSection } from "./stage-sections/DemandInitiationSection";
import { NFASection } from "./stage-sections/NFASection";
import { PRPOSection } from "./stage-sections/PRPOSection";
import { TechnicalDesignSection } from "./stage-sections/TechnicalDesignSection";
import { ImplementationPlanSection } from "./stage-sections/ImplementationPlanSection";
import { LegalSection } from "./stage-sections/LegalSection";
import { CharterSection } from "./stage-sections/CharterSection";
import { DevelopmentSection } from "./stage-sections/DevelopmentSection";

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

// Inline initiator-only block shown in the per-stage Approvals tab. Mirrors the
// "Stage Approvals" rows on the /approvals page so the user can advance the
// current stage as any allowed approver without leaving the project page.
function InlineStageAdvance({
  projectId, stageKey, stageLabel, advanceRoles,
}: { projectId: number; stageKey: string; stageLabel: string; advanceRoles: readonly string[] }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);

  const advance = async (approverRole: string) => {
    setPending(approverRole);
    try {
      const res = await fetch(`/api/projects/${projectId}/stages/${stageKey}/test-advance`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ simulatedApprover: approverRole }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as { error?: string }));
        toast({ title: body.error ?? "Failed to advance stage", variant: "destructive" });
        return;
      }
      toast({ title: `Approved as ${approverRole.toUpperCase()} — moved to next stage` });
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/stages`] });
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}`] });
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="p-3 rounded-xl border border-primary/30 bg-primary/5 mb-3">
      <p className="text-xs font-semibold text-foreground mb-0.5">
        Testing mode — approve <span className="text-primary">{stageLabel}</span> as any allowed role
      </p>
      <p className="text-[11px] text-muted-foreground mb-2">
        Bypasses all gates (docs, checklist, dual-approval) and advances the project to the next stage.
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        {advanceRoles.length === 0 ? (
          <span className="text-[11px] text-muted-foreground italic">No approver roles configured for this stage.</span>
        ) : advanceRoles.map(roleKey => {
          const label = roleKey.replace(/_/g, " ");
          const isPending = pending === roleKey;
          return (
            <button
              key={roleKey}
              onClick={() => advance(roleKey)}
              disabled={pending !== null}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-success hover:bg-success/90 transition-colors disabled:opacity-50 capitalize"
            >
              <CheckCircle2 size={13} />
              {isPending ? "Advancing..." : `Approve as ${label}`}
            </button>
          );
        })}
      </div>
    </div>
  );
}

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
  const { data: approvals = [] } = useListApprovals(
    charterId ? { charterId } : {},
    { query: { enabled: !!charterId } },
  );

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
      <div className="glass-surface rounded-2xl p-8 text-center ph-rise">
        <p className="text-muted-foreground text-sm">Stage information not available.</p>
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

  // Stages whose checklist items are derived from form data (not manually toggled).
  // Items present in this map are auto-computed and lock the manual toggle;
  // items absent from this map remain manually toggleable.
  const derivedChecklist: Record<string, boolean> = (() => {
    const parseNotes = (rec: { notes?: string | null } | undefined): Record<string, unknown> => {
      try { return rec?.notes ? JSON.parse(rec.notes) as Record<string, unknown> : {}; }
      catch { return {}; }
    };
    const notes = parseNotes(stageRecordEarly);
    const allStageRecords = stageRecords as Array<{ stage: string; status: string; notes?: string | null }>;
    const isComplete = (key: string) => allStageRecords.some(r => r.stage === key && r.status === "complete");
    const docByName = (name: string) => stageDocs.some(d => d.name === name);

    switch (displayStageKey) {
      case "project_case": {
        const demand = (notes.__demand_initiation as Record<string, unknown> | undefined) ?? {};
        const str = (k: string) => (typeof demand[k] === "string" ? (demand[k] as string) : "");
        const num = (k: string) => (typeof demand[k] === "number" ? (demand[k] as number) : Number(demand[k]) || 0);
        return {
          biz_just: str("businessJustification").length >= 100,
          scope_done: str("scopeSummary").length >= 50,
          outcomes: str("expectedOutcomes").length > 0,
          sponsor: str("sponsor").trim().length > 0,
          budget_est: num("capexEstimate") + num("opexEstimate") > 0,
        };
      }
      case "urs": {
        const scope = (notes.__urs_scope as string | undefined) ?? "";
        const reqs = (notes.__urs_requirements as string | undefined) ?? "";
        return {
          biz_req: scope.length >= 30 && reqs.length >= 30,
          it_review: reqs.length >= 50,
          biz_owner_approved: !!notes.__urs_biz_approved,
          it_approved: !!notes.__urs_it_approved,
          version_ctrl: docByName("URS Document"),
        };
      }
      case "rfp": {
        const generated = !!notes.__rfp_template_generated;
        return {
          urs_approved_gate: isComplete("urs"),
          rfp_created: generated || docByName("RFP Document"),
          urs_populated: generated,
        };
      }
      case "vendor_evaluation": {
        // New shape: dimensions[] + scores keyed by vendor id; old shape kept as fallback.
        type Dim = { id: string; kind: "technical" | "commercial" };
        const dims = (notes.__eval_dimensions as Dim[] | undefined) ?? [];
        const scoresById = (notes.__vendor_scores_by_id as Record<string, Record<string, number>> | undefined) ?? {};
        const selectedId = (notes.__selected_vendor_id as string | undefined) ?? "";
        const legacyScores = (notes.__vendor_scores as Record<string, number> | undefined) ?? {};
        const legacyVendor = (notes.__vendor_name as string | undefined) ?? "";

        const techDims = dims.filter(d => d.kind === "technical");
        const commDims = dims.filter(d => d.kind === "commercial");
        const anyVendorScores = Object.values(scoresById);

        // A category is considered "done" when at least one vendor has been
        // fully scored across every dimension in that category (not merely
        // touched on one). This avoids marking the checklist complete just
        // because the slider was nudged once.
        const anyTechFullyScored =
          techDims.length > 0 &&
          anyVendorScores.some(s => techDims.every(d => s[d.id] !== undefined));
        const anyCommFullyScored =
          commDims.length > 0 &&
          anyVendorScores.some(s => commDims.every(d => s[d.id] !== undefined));
        const anyFullyScored = dims.length > 0 && anyVendorScores.some(s => dims.every(d => s[d.id] !== undefined));
        const selectedFullyScored =
          !!selectedId && dims.length > 0 && dims.every(d => scoresById[selectedId]?.[d.id] !== undefined);

        // Fallback to legacy single-vendor shape only when ALL 4 legacy keys
        // are present AND the vendor name is set — matches old behaviour.
        const legacyAllScored = ["functional", "technical", "commercial", "track_record"].every(
          k => legacyScores[k] !== undefined,
        );

        return {
          func_eval_done: anyTechFullyScored || legacyScores.functional !== undefined,
          tech_eval_done: anyTechFullyScored || legacyScores.technical !== undefined,
          proposals_analysed: anyCommFullyScored || legacyScores.commercial !== undefined,
          eval_summary: anyFullyScored || legacyAllScored,
          vendor_selected: selectedFullyScored || (legacyVendor.trim().length > 0 && legacyAllScored),
        };
      }
      case "charter": {
        return {
          charter_drafted: docByName("Project Charter") || docByName("Charter Template"),
        };
      }
      case "nfa": {
        const nfa = (notes.__nfa as { nfaNumber?: string; chain?: Array<{ status?: string }> } | undefined) ?? {};
        const chain = nfa.chain ?? [];
        return {
          charter_approved_gate: isComplete("charter"),
          nfa_form_submitted: !!(nfa.nfaNumber && nfa.nfaNumber.length > 0),
          finance_head_approved: chain[0]?.status === "approved",
          pmo_nfa_approved: chain[1]?.status === "approved",
          dept_head_nfa: chain[2]?.status === "approved",
          mgmt_approved: chain[3]?.status === "approved",
        };
      }
      case "legal": {
        const lg = (notes.__legal as { contractNumber?: string; complianceNotes?: string; ndaSigned?: boolean; legalApproved?: boolean } | undefined) ?? {};
        const reviewLen = (lg.complianceNotes ?? "").length;
        return {
          contract_uploaded: !!(lg.contractNumber && lg.contractNumber.length > 0),
          legal_reviewed: reviewLen >= 30,
          compliance_confirmed: reviewLen >= 30,
          nda_signed: !!lg.ndaSigned,
          legal_signoff: !!lg.legalApproved,
        };
      }
      case "pr_po": {
        const pp = (notes.__pr_po as { prNumber?: string; poNumber?: string } | undefined) ?? {};
        const legalRec = allStageRecords.find(r => r.stage === "legal");
        const legalNotes = parseNotes(legalRec);
        const lg = (legalNotes.__legal as { legalApproved?: boolean } | undefined) ?? {};
        return {
          legal_approved_gate: isComplete("legal") || !!lg.legalApproved,
          pr_submitted: !!(pp.prNumber && pp.prNumber.length > 0),
          po_released: !!(pp.poNumber && pp.poNumber.length > 0),
        };
      }
      case "kickoff": {
        const attendees = (notes.__kickoff_attendees as Array<unknown> | undefined) ?? [];
        return {
          attendees_defined: attendees.length > 0,
          minutes_uploaded: docByName("Meeting Minutes"),
        };
      }
      case "technical_design": {
        const td = (notes.__technical_design as { architectureSummary?: string; integrations?: string; securityReview?: string; techLeadApproved?: boolean } | undefined) ?? {};
        const archLen = (td.architectureSummary ?? "").length;
        const secLen = (td.securityReview ?? "").length;
        return {
          td_drafted: archLen >= 30 || docByName("Technical Design Document"),
          arch_uploaded: archLen > 0 || docByName("Architecture Diagram"),
          integrations_listed: (td.integrations ?? "").length > 0,
          nfrs_captured: secLen > 0,
          security_signed: secLen >= 30 || docByName("Security Review"),
          td_lead_approved: !!td.techLeadApproved,
        };
      }
      case "development": {
        const dv = (notes.__development as { percentComplete?: number; statusNotes?: string; blockers?: Array<{ resolved?: boolean }> } | undefined) ?? {};
        const blockers = dv.blockers ?? [];
        const openBlockers = blockers.filter(b => !b.resolved).length;
        const pct = dv.percentComplete ?? 0;
        return {
          dev_env_ready: pct > 0,
          dev_progress_50: pct >= 50,
          status_updated: (dv.statusNotes ?? "").length >= 20,
          blockers_resolved: openBlockers === 0,
        };
      }
      case "go_live": {
        return {
          uat_approved_gate: isComplete("uat"),
          go_live_date_frozen: !!notes.__goLiveFrozen,
        };
      }
      case "closure_readiness": {
        const handover = (notes.__handover_items as Record<string, boolean> | undefined) ?? {};
        const handoverDone = ["training_complete", "runbooks_handed", "support_transitioned", "data_migrated", "vendor_warranties"].every(k => handover[k]);
        return {
          csat_complete: !!notes.__csat_survey_complete,
          doc_handover_done: handoverDone || docByName("Documentation Handover Package"),
          support_transitioned: !!handover.support_transitioned,
        };
      }
      case "project_closure": {
        return {
          lessons_learned_done: !!(notes.__lessonsWentWell && notes.__lessonsImprove && notes.__lessonsRecs),
          closure_report_generated: !!notes.__closureReportGeneratedAt,
          all_artifacts_approved: isComplete("closure_readiness"),
        };
      }
      default:
        return {};
    }
  })();

  const derivedKeys = new Set(Object.keys(derivedChecklist));
  const checklistHasDerived = derivedKeys.size > 0;
  const effectiveChecklist: Record<string, boolean> = (() => {
    const merged: Record<string, boolean> = { ...checklist };
    for (const k of derivedKeys) merged[k] = derivedChecklist[k];
    return merged;
  })();
  const checklistIsDerived = checklistHasDerived; // back-compat alias for the info banner

  const allBlockingComplete = stageConfig.checklistItems
    .filter((i) => i.blocking)
    .every((i) => effectiveChecklist[i.id]);

  // Business Case documents are optional — uploads are encouraged but not gated.
  const docsAreOptional = displayStageKey === "project_case";
  const requiredDocsUploaded = docsAreOptional || stageConfig.requiredDocs.every((rd) =>
    stageDocs.some((d) => d.name === rd.name),
  );

  const canAdvanceNow = canAdvance && allBlockingComplete && requiredDocsUploaded;

  function toggleChecklist(itemId: string) {
    if (isCompletedStage) return;
    if (derivedKeys.has(itemId)) return; // this item is derived from the form; not manually toggleable
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
    { id: "documents" as const, label: docsAreOptional
        ? `Documents (${stageDocs.length} · optional)`
        : `Documents (${stageDocs.length}/${stageConfig.requiredDocs.length})` },
    { id: "checklist" as const, label: `Checklist (${stageConfig.checklistItems.filter((i) => effectiveChecklist[i.id]).length}/${stageConfig.checklistItems.length})` },
    { id: "approvals" as const, label: `Approvals (${approvals.length})` },
  ];

  return (
    <div className="glass-surface lift-card rounded-2xl overflow-hidden ph-rise">
      {/* Stage Header */}
      <div className="px-5 py-4 bg-primary/5 border-b border-primary/20">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="text-[10px] font-mono uppercase tracking-wider font-semibold px-2 py-0.5 rounded-sm border bg-primary/10 text-primary border-primary/20">
                Stage {displayStageIdx + 1} of {LIFECYCLE_STAGES.length}
              </span>
              {isCompletedStage && (
                <span className="text-[10px] font-mono uppercase tracking-wider font-semibold px-2 py-0.5 rounded-sm border bg-success/10 text-success border-success/20">
                  ✓ Completed
                </span>
              )}
              {isLockedStage && (
                <span className="inline-flex items-center text-[10px] font-mono uppercase tracking-wider font-semibold px-2 py-0.5 rounded-sm border bg-muted text-muted-foreground border-border">
                  <Lock size={10} className="inline mr-1" />Locked
                </span>
              )}
              {isCurrentStage && !isCompletedStage && (
                <span className="text-[10px] font-mono uppercase tracking-wider font-semibold px-2 py-0.5 rounded-sm border bg-primary/10 text-primary border-primary/20">
                  Active
                </span>
              )}
            </div>
            <h3 className="text-lg font-semibold text-foreground tracking-tight">{stageConfig.label}</h3>
            <p className="text-sm text-muted-foreground mt-0.5">{stageConfig.description}</p>
            {stageRecord?.enteredAt && (
              <p className="text-[11px] text-muted-foreground mt-1 font-mono">
                Started {formatDate(stageRecord.enteredAt)}
                {stageRecord.completedAt && ` · Completed ${formatDate(stageRecord.completedAt)}`}
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-2 flex-shrink-0">
            {stageConfig.prerequisites.length > 0 && (
              <div className="text-[11px] text-muted-foreground text-right">
                <p className="text-[10px] font-mono uppercase tracking-wider font-semibold mb-1">Prerequisites</p>
                {stageConfig.prerequisites.map((p) => {
                  const prereqComplete = isStageComplete(p, stageRecords as Array<{ stage: string; status: string }>);
                  const prereqConfig = getStageConfig(p);
                  return (
                    <span
                      key={p}
                      className={`flex items-center gap-1 text-[11px] ${prereqComplete ? "text-success" : "text-destructive"}`}
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
      <div className="flex gap-0 border-b border-border/60 bg-muted/40 overflow-x-auto scrollbar-thin">
        {TABS.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2.5 text-xs font-semibold transition-all border-b-2 whitespace-nowrap ${
                active
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="p-5">
        {activeTab === "overview" && (
          <div className="space-y-4">
            {isLockedStage && (
              <div className="rounded-xl p-4 flex items-center gap-3 bg-muted/40 border border-border">
                <Lock size={18} className="text-muted-foreground flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-foreground">Stage Locked</p>
                  <p className="text-xs text-muted-foreground">Complete the current active stage to unlock {stageConfig.label}.</p>
                </div>
              </div>
            )}

            {!stageRecord && isCurrentStage && (
              <div className="rounded-xl p-4 bg-primary/5 border border-primary/20">
                <p className="text-sm font-semibold text-foreground mb-2">Stage not yet started</p>
                <p className="text-xs text-muted-foreground mb-3">Initialize this stage to begin tracking progress.</p>
                <button
                  onClick={handleInitializeStage}
                  disabled={createStageMutation.isPending}
                  className="inline-flex items-center px-3 py-1.5 rounded-md text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm disabled:opacity-50"
                >
                  Initialize Stage
                </button>
              </div>
            )}

            {/* Stage-specific workflow sections */}
            {stageHas(stageConfig, "hasDemandInitiation") && <DemandInitiationSection projectId={projectId} />}
            {stageHas(stageConfig, "hasURSDualApproval") && <URSDualApprovalSection projectId={projectId} />}
            {stageHas(stageConfig, "hasRFPTemplate") && <RFPTemplateSection projectId={projectId} />}
            {stageHas(stageConfig, "hasVendorEvalScorecard") && <VendorEvalScorecard projectId={projectId} />}
            {stageHas(stageConfig, "hasCharter") && <CharterSection projectId={projectId} />}
            {stageHas(stageConfig, "hasNFA") && <NFASection projectId={projectId} />}
            {stageHas(stageConfig, "hasLegal") && <LegalSection projectId={projectId} />}
            {stageHas(stageConfig, "hasPRPO") && <PRPOSection projectId={projectId} />}
            {stageHas(stageConfig, "hasKickoffAttendees") && <KickoffAttendeesSection projectId={projectId} />}
            {stageHas(stageConfig, "hasTechnicalDesign") && <TechnicalDesignSection projectId={projectId} />}
            {stageHas(stageConfig, "hasDevelopment") && <DevelopmentSection projectId={projectId} />}
            {stageHas(stageConfig, "hasImplementationPlan") && <ImplementationPlanSection projectId={projectId} />}
            {stageHas(stageConfig, "hasUATDefects") && <UATDefectSection projectId={projectId} />}
            {stageHas(stageConfig, "hasGoLiveCountdown") && <GoLiveCountdown projectId={projectId} />}
            {stageHas(stageConfig, "hasClosureReadinessSection") && <ClosureReadinessSection projectId={projectId} />}
            {stageHas(stageConfig, "isClosureStage") && <ClosureReport projectId={projectId} />}

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl p-3 bg-success/10 border border-success/20">
                <p className="text-[10px] font-mono uppercase tracking-wider text-success font-semibold mb-1">Documents</p>
                <p className="text-xl font-semibold font-mono num-tabular text-success">
                  {stageDocs.length}<span className="text-xs text-success/70 font-normal">/{stageConfig.requiredDocs.length}</span>
                </p>
                <p className="text-[11px] text-success/80">uploaded</p>
              </div>
              <div className="rounded-xl p-3 bg-primary/10 border border-primary/20">
                <p className="text-[10px] font-mono uppercase tracking-wider text-primary font-semibold mb-1">Checklist</p>
                <p className="text-xl font-semibold font-mono num-tabular text-primary">
                  {stageConfig.checklistItems.filter((i) => effectiveChecklist[i.id]).length}
                  <span className="text-xs text-primary/70 font-normal">/{stageConfig.checklistItems.length}</span>
                </p>
                <p className="text-[11px] text-primary/80">complete</p>
              </div>
            </div>

            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Users size={12} />
              <span>Can advance: <span className="font-mono text-foreground">{stageConfig.advanceRoles.join(", ")}</span></span>
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
                <p className="text-[10px] font-mono uppercase tracking-wider font-semibold text-muted-foreground mb-2">Additional Documents</p>
                {stageDocs
                  .filter((d) => !stageConfig.requiredDocs.some((rd) => rd.name === d.name))
                  .map((d) => (
                    <div key={d.id} className="flex items-center gap-2 py-1.5 text-sm text-foreground">
                      <FileText size={13} className="text-muted-foreground" />
                      <span className="flex-1">{d.name}</span>
                      <DocStatusBadge status={d.approvalStatus} />
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "checklist" && (
          <div className="space-y-2 stagger-children">
            {checklistIsDerived && (
              <div className="mb-2 flex items-start gap-2 text-xs text-primary p-2 rounded-lg bg-primary/5 border border-primary/20">
                <CheckCircle2 size={12} className="mt-0.5 flex-shrink-0" />
                <span>Items marked “auto” fill themselves from the forms on the Overview tab as you complete each field. Other items stay manually toggleable.</span>
              </div>
            )}
            {stageConfig.checklistItems.map((item) => {
              const done = !!effectiveChecklist[item.id];
              const isDerivedItem = derivedKeys.has(item.id);
              return (
                <button
                  key={item.id}
                  onClick={() => toggleChecklist(item.id)}
                  disabled={isCompletedStage || isLockedStage || isDerivedItem}
                  className={`w-full flex items-start gap-3 p-3 rounded-xl text-left transition-all disabled:cursor-default border ${
                    done
                      ? "bg-success/10 border-success/30"
                      : "bg-muted/40 border-border hover:bg-accent/40"
                  }`}
                >
                  {done ? (
                    <CheckSquare size={16} className="text-success flex-shrink-0 mt-0.5" />
                  ) : (
                    <Square size={16} className="text-muted-foreground/60 flex-shrink-0 mt-0.5" />
                  )}
                  <span className={`text-sm flex-1 ${done ? "text-foreground line-through opacity-70" : "text-foreground"}`}>
                    {item.label}
                  </span>
                  {isDerivedItem && (
                    <span className="text-[10px] font-mono uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded-sm border bg-primary/10 text-primary border-primary/20 flex-shrink-0">
                      Auto
                    </span>
                  )}
                  {item.blocking && !done && (
                    <span className="text-[10px] font-mono uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded-sm border bg-destructive/10 text-destructive border-destructive/20 flex-shrink-0">
                      Required
                    </span>
                  )}
                </button>
              );
            })}
            {!allBlockingComplete && (
              <div className="mt-2 flex items-center gap-2 text-xs text-warn p-2 rounded-lg bg-warn/10 border border-warn/20">
                <AlertTriangle size={12} />
                <span>Complete all required checklist items to enable stage advancement.</span>
              </div>
            )}
          </div>
        )}

        {activeTab === "approvals" && (
          <div className="space-y-2 stagger-children">
            {role === "initiator" && isCurrentStage && !isCompletedStage && (
              <InlineStageAdvance
                projectId={projectId}
                stageKey={displayStageKey}
                stageLabel={stageConfig.label}
                advanceRoles={(stageConfig.advanceRoles as readonly string[]) ?? []}
              />
            )}
            {(approvals as Array<{ id: number; approverRole?: string; approverName?: string; status: string; decidedAt?: string | null; comments?: string | null }>).length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No prior approval records for this project.</p>
            ) : (
              (approvals as Array<{ id: number; approverRole?: string; approverName?: string; status: string; decidedAt?: string | null; comments?: string | null }>).map((a) => (
                <div key={a.id} className="flex items-start gap-3 p-3 rounded-xl bg-muted/40 border border-border">
                  <ApprovalStatusIcon status={a.status} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-foreground">{a.approverName ?? "—"}</span>
                      <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground bg-muted px-1.5 py-0.5 rounded-sm border border-border">{a.approverRole}</span>
                      <span className={`text-[10px] font-mono uppercase tracking-wider font-semibold capitalize px-1.5 py-0.5 rounded-sm border ${
                        a.status === "approved"
                          ? "text-success bg-success/10 border-success/20"
                          : a.status === "rejected"
                          ? "text-destructive bg-destructive/10 border-destructive/20"
                          : "text-warn bg-warn/10 border-warn/20"
                      }`}>
                        {a.status}
                      </span>
                    </div>
                    {a.comments && <p className="text-xs text-muted-foreground mt-1">{a.comments}</p>}
                    {a.decidedAt && <p className="text-[11px] text-muted-foreground mt-0.5 font-mono">{formatDate(a.decidedAt)}</p>}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Action Footer */}
      {(canAdvance || isLockedStage || isCompletedStage) && (
        <div className="px-5 py-4 border-t border-border/60 flex items-center justify-between gap-3 bg-muted/40">
          <div className="text-[11px] text-muted-foreground">
            {isCompletedStage && (
              <span className="flex items-center gap-1 text-success font-semibold">
                <CheckCircle2 size={12} />
                Stage completed
              </span>
            )}
            {isLockedStage && (
              <span className="flex items-center gap-1 text-muted-foreground">
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
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold transition-colors disabled:cursor-not-allowed shadow-sm ${
                canAdvanceNow
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-muted text-muted-foreground opacity-60"
              }`}
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
