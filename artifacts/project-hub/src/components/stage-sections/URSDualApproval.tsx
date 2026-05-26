import { useEffect, useState } from "react";
import { useListProjectStages, useUpdateProjectStage } from "@workspace/api-client-react";
import { useUserStore } from "../../lib/store";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "../../lib/format";
import { AiButton } from "../ai-button";
import { AutoTextarea } from "../ui/auto-textarea";
import { CheckCircle2, AlertCircle } from "lucide-react";

type URSPayload = {
  background?: string;
  inScope?: string;
  outOfScope?: string;
  userRoles?: string;
  functionalReqs?: string;
  performanceReqs?: string;
  securityReqs?: string;
  usabilityReqs?: string;
  availabilityReqs?: string;
  scalabilityReqs?: string;
  dataReqs?: string;
  integrationReqs?: string;
  regulatoryReqs?: string;
  reportingReqs?: string;
  acceptanceCriteria?: string;
  glossary?: string;
  savedAt?: string;
};

const ta = "w-full text-xs border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary bg-card";

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[11px] font-semibold text-foreground block mb-1">
        {label}{required && <span className="text-destructive"> *</span>}
        {hint && <span className="ml-2 font-normal text-muted-foreground">{hint}</span>}
      </label>
      {children}
    </div>
  );
}

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

  // Legacy fields (kept for back-compat)
  const legacyScope = (parsedNotes.__urs_scope as string | undefined) ?? "";
  const legacyReqs = (parsedNotes.__urs_requirements as string | undefined) ?? "";
  const saved: URSPayload = (parsedNotes.__urs_form as URSPayload) ?? {};

  const [background, setBackground] = useState(saved.background ?? "");
  const [inScope, setInScope] = useState(saved.inScope ?? legacyScope);
  const [outScope, setOutScope] = useState(saved.outOfScope ?? "");
  const [userRoles, setUserRoles] = useState(saved.userRoles ?? "");
  const [funcReqs, setFuncReqs] = useState(saved.functionalReqs ?? legacyReqs);
  const [perfReqs, setPerfReqs] = useState(saved.performanceReqs ?? "");
  const [secReqs, setSecReqs] = useState(saved.securityReqs ?? "");
  const [usabReqs, setUsabReqs] = useState(saved.usabilityReqs ?? "");
  const [availReqs, setAvailReqs] = useState(saved.availabilityReqs ?? "");
  const [scaleReqs, setScaleReqs] = useState(saved.scalabilityReqs ?? "");
  const [dataReqs, setDataReqs] = useState(saved.dataReqs ?? "");
  const [integReqs, setIntegReqs] = useState(saved.integrationReqs ?? "");
  const [regReqs, setRegReqs] = useState(saved.regulatoryReqs ?? "");
  const [reportReqs, setReportReqs] = useState(saved.reportingReqs ?? "");
  const [acceptance, setAcceptance] = useState(saved.acceptanceCriteria ?? "");
  const [glossary, setGlossary] = useState(saved.glossary ?? "");

  useEffect(() => {
    setBackground(saved.background ?? "");
    setInScope(saved.inScope ?? legacyScope);
    setOutScope(saved.outOfScope ?? "");
    setUserRoles(saved.userRoles ?? "");
    setFuncReqs(saved.functionalReqs ?? legacyReqs);
    setPerfReqs(saved.performanceReqs ?? "");
    setSecReqs(saved.securityReqs ?? "");
    setUsabReqs(saved.usabilityReqs ?? "");
    setAvailReqs(saved.availabilityReqs ?? "");
    setScaleReqs(saved.scalabilityReqs ?? "");
    setDataReqs(saved.dataReqs ?? "");
    setIntegReqs(saved.integrationReqs ?? "");
    setRegReqs(saved.regulatoryReqs ?? "");
    setReportReqs(saved.reportingReqs ?? "");
    setAcceptance(saved.acceptanceCriteria ?? "");
    setGlossary(saved.glossary ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ursRecord?.id]);

  function saveContent() {
    if (!ursRecord?.id) { toast({ title: "Initialise the URS stage first", variant: "destructive" }); return; }
    const payload: URSPayload = {
      background, inScope, outOfScope: outScope, userRoles,
      functionalReqs: funcReqs, performanceReqs: perfReqs, securityReqs: secReqs,
      usabilityReqs: usabReqs, availabilityReqs: availReqs, scalabilityReqs: scaleReqs,
      dataReqs, integrationReqs: integReqs, regulatoryReqs: regReqs, reportingReqs: reportReqs,
      acceptanceCriteria: acceptance, glossary,
      savedAt: new Date().toISOString(),
    };
    updateStage.mutate(
      { id: ursRecord.id, data: { notes: JSON.stringify({
        ...parsedNotes,
        __urs_form: payload,
        // Keep legacy mirrors for any other consumers
        __urs_scope: inScope,
        __urs_requirements: funcReqs,
      }) } },
      { onSuccess: () => toast({ title: "URS saved" }), onError: () => toast({ title: "Failed to save URS", variant: "destructive" }) },
    );
  }

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

  const reqCount = funcReqs.split("\n").filter(l => l.trim().length > 0).length;
  const funcOk = reqCount >= 3;
  const scopeOk = inScope.length >= 50;
  const acceptOk = acceptance.length >= 30;

  function Counter({ ok, label }: { ok: boolean; label: string }) {
    return (
      <span className={`text-[10px] font-mono inline-flex items-center gap-1 ${ok ? "text-success" : "text-warn"}`}>
        {ok ? <CheckCircle2 size={10} /> : <AlertCircle size={10} />} {label}
      </span>
    );
  }

  return (
    <div className="rounded-2xl p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-bold text-foreground">User Requirements Specification (URS)</p>
          <p className="text-[11px] text-primary">GAMP-5 style template — scope, functional, non-functional, data, integration, compliance, acceptance</p>
        </div>
        <div className="flex items-center gap-2">
          <AiButton
            label="AI Draft URS"
            endpoint="/api/ai/urs/draft"
            payload={{ projectId, hint: inScope || funcReqs || background || undefined }}
            size="sm"
            variant="subtle"
            onResult={(d) => {
              const r = d as { scope?: string; requirements?: string; background?: string; nonFunctional?: string; integration?: string; data?: string; regulatory?: string };
              if (r.background) setBackground(r.background);
              if (r.scope) setInScope(r.scope);
              if (r.requirements) setFuncReqs(r.requirements);
              if (r.nonFunctional && !perfReqs) setPerfReqs(r.nonFunctional);
              if (r.integration && !integReqs) setIntegReqs(r.integration);
              if (r.data && !dataReqs) setDataReqs(r.data);
              if (r.regulatory && !regReqs) setRegReqs(r.regulatory);
              toast({ title: "AI draft applied — review and save" });
            }}
          />
          <button
            onClick={saveContent}
            disabled={updateStage.isPending}
            className="bg-primary hover:bg-primary/90 text-xs font-semibold text-primary-foreground px-3 py-1.5 rounded-lg disabled:opacity-40"
          >{updateStage.isPending ? "Saving…" : "Save URS"}</button>
        </div>
      </div>

      <Field label="Background & Context" hint="Why this URS exists, current system, user community">
        <AutoTextarea value={background} onChange={(e) => setBackground(e.target.value)} minRows={3}
          placeholder="Brief background, business context, user community, current pain points" className={ta} />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="In Scope" required>
          <AutoTextarea value={inScope} onChange={(e) => setInScope(e.target.value)} minRows={4}
            placeholder="End-to-end scope — what users need the solution to do" className={ta} />
        </Field>
        <Field label="Out of Scope" hint="Be explicit">
          <AutoTextarea value={outScope} onChange={(e) => setOutScope(e.target.value)} minRows={4}
            placeholder="What the solution will NOT do" className={ta} />
        </Field>
      </div>

      <Field label="User Roles & Access" hint="Role · Responsibility · Access level (one per line)">
        <AutoTextarea value={userRoles} onChange={(e) => setUserRoles(e.target.value)} minRows={3}
          placeholder="QA Reviewer · approve batch records · read/write&#10;Operator · enter data · read/write own&#10;Auditor · view audit trail · read-only" className={ta} />
      </Field>

      <Field label="Functional Requirements" required hint="Numbered list — one per line (FR-01, FR-02 …)">
        <AutoTextarea value={funcReqs} onChange={(e) => setFuncReqs(e.target.value)} minRows={8}
          placeholder="FR-01 System shall …&#10;FR-02 System shall …&#10;FR-03 System shall …" className={`${ta} font-mono`} />
      </Field>

      <p className="text-xs font-bold text-foreground pt-3 border-t border-border">Non-Functional Requirements</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Performance" hint="Response time, throughput, concurrency">
          <AutoTextarea value={perfReqs} onChange={(e) => setPerfReqs(e.target.value)} minRows={3}
            placeholder="e.g. Page load < 2s, 500 concurrent users, batch report < 5 min" className={ta} />
        </Field>
        <Field label="Security" hint="Auth, authorization, encryption, audit">
          <AutoTextarea value={secReqs} onChange={(e) => setSecReqs(e.target.value)} minRows={3}
            placeholder="e.g. SSO via AD, role-based access, AES-256 at rest, full audit trail" className={ta} />
        </Field>
        <Field label="Usability" hint="UX standards, accessibility, language">
          <AutoTextarea value={usabReqs} onChange={(e) => setUsabReqs(e.target.value)} minRows={2}
            placeholder="e.g. WCAG 2.1 AA, English + Hindi, mobile responsive" className={ta} />
        </Field>
        <Field label="Availability" hint="Uptime SLA, RTO, RPO">
          <AutoTextarea value={availReqs} onChange={(e) => setAvailReqs(e.target.value)} minRows={2}
            placeholder="e.g. 99.5% uptime, RTO 4h, RPO 1h" className={ta} />
        </Field>
        <Field label="Scalability" hint="Growth assumptions">
          <AutoTextarea value={scaleReqs} onChange={(e) => setScaleReqs(e.target.value)} minRows={2}
            placeholder="e.g. 3x data volume in 5 years, additional sites" className={ta} />
        </Field>
        <Field label="Reporting" hint="Standard reports, dashboards">
          <AutoTextarea value={reportReqs} onChange={(e) => setReportReqs(e.target.value)} minRows={2}
            placeholder="e.g. Daily production report, monthly QA dashboard, regulatory exports" className={ta} />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3 pt-3 border-t border-border">
        <Field label="Data Requirements" hint="Sources, formats, retention, master data">
          <AutoTextarea value={dataReqs} onChange={(e) => setDataReqs(e.target.value)} minRows={3}
            placeholder="Inputs, outputs, retention period, data governance, master data dependencies" className={ta} />
        </Field>
        <Field label="Integration Requirements" hint="Systems to interface with">
          <AutoTextarea value={integReqs} onChange={(e) => setIntegReqs(e.target.value)} minRows={3}
            placeholder="e.g. SAP S/4HANA (BAPI), LIMS, MES — direction, frequency, format" className={ta} />
        </Field>
      </div>

      <Field label="Regulatory & Compliance" hint="21 CFR Part 11, EU Annex 11, GxP, data privacy">
        <AutoTextarea value={regReqs} onChange={(e) => setRegReqs(e.target.value)} minRows={3}
          placeholder="e.g. 21 CFR Part 11 e-signatures, audit trail (ALCOA+), data integrity, GxP validation" className={ta} />
      </Field>

      <Field label="Acceptance Criteria" required hint="How will URS be deemed satisfied?">
        <AutoTextarea value={acceptance} onChange={(e) => setAcceptance(e.target.value)} minRows={3}
          placeholder="Each FR-xx must be demonstrated during UAT with traceable test scripts" className={ta} />
      </Field>

      <Field label="Glossary / Abbreviations">
        <AutoTextarea value={glossary} onChange={(e) => setGlossary(e.target.value)} minRows={2}
          placeholder="GMP — Good Manufacturing Practice&#10;ALCOA+ — Attributable, Legible, Contemporaneous, Original, Accurate (plus)" className={ta} />
      </Field>

      <div className="flex items-center gap-3 text-[11px] pt-2 border-t border-border">
        <Counter ok={scopeOk} label="Scope" />
        <Counter ok={funcOk} label={`${reqCount} functional req${reqCount === 1 ? "" : "s"}`} />
        <Counter ok={acceptOk} label="Acceptance" />
        {saved.savedAt && (
          <span className="text-[10px] font-mono text-primary bg-primary/10 rounded-full px-2 py-0.5 ml-auto">
            Saved {new Date(saved.savedAt).toLocaleDateString()}
          </span>
        )}
      </div>

      {/* Dual approval */}
      <p className="text-sm font-bold text-foreground pt-3 border-t border-border">URS Dual-Approval</p>
      <p className="text-xs text-primary">Both Business Owner and IT Team must approve before advancing to RFP.</p>
      <div className="grid grid-cols-2 gap-3">
        <div className={`rounded-xl p-3 border-2 ${bizApproved ? "border-success/40 bg-card" : "border-border bg-card"}`}>
          <p className="text-xs font-bold mb-1" style={{ color: bizApproved ? "hsl(var(--success) / 1)" : "hsl(var(--warn) / 1)" }}>
            Business Owner
          </p>
          {bizApproved ? (
            <>
              <p className="text-xs text-success">✓ Approved by <strong>{bizApproverName}</strong></p>
              <p className="text-xs text-success">{bizApprovedAt ? formatDate(bizApprovedAt) : ""}</p>
              {canApproveBiz && (
                <button onClick={() => revoke("biz")} className="mt-2 text-xs text-destructive underline">Revoke</button>
              )}
            </>
          ) : (
            <>
              <p className="text-xs text-warn mb-2">Pending approval</p>
              {canApproveBiz ? (
                <button onClick={() => approve("biz")} disabled={updateStage.isPending}
                  className="bg-primary hover:bg-primary/90 w-full text-xs font-semibold py-1.5 rounded-lg text-primary-foreground transition-all disabled:opacity-50">
                  Approve as Business Owner
                </button>
              ) : (
                <p className="text-xs text-muted-foreground italic">Requires HOD / Exec Director role</p>
              )}
            </>
          )}
        </div>

        <div className={`rounded-xl p-3 border-2 ${itApproved ? "border-success/40 bg-card" : "border-border bg-card"}`}>
          <p className="text-xs font-bold mb-1" style={{ color: itApproved ? "hsl(var(--success) / 1)" : "hsl(var(--warn) / 1)" }}>
            IT Team
          </p>
          {itApproved ? (
            <>
              <p className="text-xs text-success">✓ Approved by <strong>{itApproverName}</strong></p>
              <p className="text-xs text-success">{itApprovedAt ? formatDate(itApprovedAt) : ""}</p>
              {canApproveIT && (
                <button onClick={() => revoke("it")} className="mt-2 text-xs text-destructive underline">Revoke</button>
              )}
            </>
          ) : (
            <>
              <p className="text-xs text-warn mb-2">Pending approval</p>
              {canApproveIT ? (
                <button onClick={() => approve("it")} disabled={updateStage.isPending}
                  className="bg-primary hover:bg-primary/90 w-full text-xs font-semibold py-1.5 rounded-lg text-primary-foreground transition-all disabled:opacity-50">
                  Approve as IT Team
                </button>
              ) : (
                <p className="text-xs text-muted-foreground italic">Requires PMO / HOD role</p>
              )}
            </>
          )}
        </div>
      </div>

      {bizApproved && itApproved && (
        <div className="rounded-xl p-3 text-center">
          <p className="text-sm font-bold text-success">
            ✓ Both approvals received — URS may be advanced to RFP
          </p>
        </div>
      )}
    </div>
  );
}
