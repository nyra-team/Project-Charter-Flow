import { useListProjectStages } from "@workspace/api-client-react";
import { CheckCircle2, Circle } from "lucide-react";
import { DemandInitiationSection } from "./DemandInitiationSection";
import { URSDualApprovalSection } from "./URSDualApproval";

// The Initiation stage holds two independently-governed sub-gates: the
// Business Case + BRD (justification + business requirements) and the URS
// (technical requirements specification, dual-approved by Business Owner +
// IT). Previously these rendered as two tabs ("Business Case" | "URS"); the
// tab pattern was confusing because duplicate fields (scope, out-of-scope,
// data, reporting, business/functional requirements) lived in both surfaces.
//
// Now both sections render vertically on a SINGLE page so the user reads
// the document in document order (Why → What → How), and the duplicate
// fields have been removed from the Business Case half (URS owns them).
// Dual-approval gating is unchanged: BC approval still gates URS sign-off
// (enforced inside URSDualApprovalSection + server).
export function InitiationSubGates({ projectId }: { projectId: number }) {
  const { data: stages = [] } = useListProjectStages(projectId);

  const rec = (stages as Array<{ stage: string; notes?: string | null }>).find((s) => s.stage === "initiation");
  const notes: Record<string, unknown> = (() => { try { return JSON.parse(rec?.notes ?? "{}"); } catch { return {}; } })();
  const bcApproved = notes.__bc_approved === true;
  const ursApproved = notes.__urs_biz_approved === true && notes.__urs_it_approved === true;

  return (
    <div className="rounded-2xl border border-card-border bg-card glass-surface">
      {/* Sub-gate progress header — collapses the previous two-chip layout
          (BC + URS) into one chip per the user-facing rename. The combined
          chip is green only when BOTH halves are signed off, so the user
          still sees overall progress at a glance. Internal sequencing (BC
          must approve before URS sign-off) is unchanged and is surfaced via
          the side warning. */}
      <div className="flex items-center gap-2 px-4 pt-3 pb-2 border-b border-border/60">
        <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground mr-1">Stage:</span>
        <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${bcApproved && ursApproved ? "text-success" : "text-muted-foreground"}`}>
          {bcApproved && ursApproved ? <CheckCircle2 size={13} /> : <Circle size={13} />} Business Case &amp; Requirements
        </span>
        {!bcApproved && <span className="ml-auto text-[10px] text-warn font-mono">Requirements sign-off locked until Business Case approved</span>}
      </div>

      {/* Combined page — Business Case + BRD section, then URS section.
          Both stay mounted and editable simultaneously; user scrolls between
          them rather than switching tabs. */}
      <DemandInitiationSection projectId={projectId} />
      <div className="border-t border-border/60" />
      <URSDualApprovalSection projectId={projectId} />
    </div>
  );
}
