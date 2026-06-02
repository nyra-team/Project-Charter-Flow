import { useState } from "react";
import { useListProjectStages } from "@workspace/api-client-react";
import { CheckCircle2, Circle, FileText, ClipboardCheck } from "lucide-react";
import { DemandInitiationSection } from "./DemandInitiationSection";
import { URSDualApprovalSection } from "./URSDualApproval";

// Option D: Business Case and URS are two independently-governed sub-gates that
// live inside the single "Initiation" stage. They render as tabs (no stage
// navigation between them) with a progress header. BC approval gates URS sign-off
// (enforced inside URSDualApprovalSection + server).
export function InitiationSubGates({ projectId }: { projectId: number }) {
  const [tab, setTab] = useState<"business_case" | "urs">("business_case");
  const { data: stages = [] } = useListProjectStages(projectId);

  const rec = (stages as Array<{ stage: string; notes?: string | null }>).find((s) => s.stage === "initiation");
  const notes: Record<string, unknown> = (() => { try { return JSON.parse(rec?.notes ?? "{}"); } catch { return {}; } })();
  const bcApproved = notes.__bc_approved === true;
  const ursApproved = notes.__urs_biz_approved === true && notes.__urs_it_approved === true;

  const tabs: Array<{ key: "business_case" | "urs"; label: string; icon: typeof FileText; done: boolean }> = [
    { key: "business_case", label: "Business Case", icon: FileText, done: bcApproved },
    { key: "urs", label: "URS", icon: ClipboardCheck, done: ursApproved },
  ];

  return (
    <div className="rounded-2xl border border-card-border bg-card glass-surface">
      {/* Sub-gate progress header */}
      <div className="flex items-center gap-2 px-4 pt-3 pb-2 border-b border-border/60">
        <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground mr-1">Initiation gates:</span>
        {tabs.map((t) => (
          <span key={t.key} className={`inline-flex items-center gap-1 text-[11px] font-medium ${t.done ? "text-success" : "text-muted-foreground"}`}>
            {t.done ? <CheckCircle2 size={13} /> : <Circle size={13} />} {t.label}
          </span>
        ))}
        {!bcApproved && <span className="ml-auto text-[10px] text-warn font-mono">URS sign-off locked until BC approved</span>}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-3 pt-2">
        {tabs.map((t) => {
          const active = tab === t.key;
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-t-lg border-b-2 transition-colors ${
                active ? "border-primary text-primary bg-primary/5" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon size={14} /> {t.label}
              {t.done && <CheckCircle2 size={12} className="text-success" />}
            </button>
          );
        })}
      </div>

      {/* Tab body — both stay mounted to preserve unsaved edits; only the active one shows. */}
      <div className={tab === "business_case" ? "block" : "hidden"}>
        <DemandInitiationSection projectId={projectId} />
      </div>
      <div className={tab === "urs" ? "block" : "hidden"}>
        <URSDualApprovalSection projectId={projectId} />
      </div>
    </div>
  );
}
