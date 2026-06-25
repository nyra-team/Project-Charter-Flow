// CapEx e-NFA workflow — Capital Expenditure NFA, rendered NATIVELY (no iframe) so
// its font, spacing and chrome are identical to the other e-NFA forms. Uses the
// same Section/Field/Grid primitives, slate panel and inputs as
// charter-template-new / charter-nfa-new. Blank tables (user fills everything).
// Submit + Generate match the other e-NFAs: POST /api/nfas → .docx download.
//
// NOTE: the parent page supplies the `[&_input]/[&_textarea]` style wrapper, so
// inputs here inherit the same white-field / blue-focus styling automatically.
import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Download, Loader2, CheckCircle2, Plus, Trash2, RotateCcw } from "lucide-react";
import { api } from "@/lib/extra-api";
import { useToast } from "@/hooks/use-toast";
import { useUserStore } from "../lib/store";
import { Input } from "@/components/ui/input";
import { AutoTextarea } from "@/components/ui/auto-textarea";
import { ReferenceDocUpload } from "./ReferenceDocUpload";

// ── Shared chrome — copied verbatim from charter-template-new.tsx ────────────
function Section({ title, subtitle, required, children }: {
  title: string; subtitle?: string; required?: boolean; children: React.ReactNode;
}) {
  return (
    <div className="py-1.5">
      <div className="flex items-start gap-2.5 mb-1">
        <div>
          <h3 className="text-sm font-semibold text-foreground tracking-tight leading-tight">
            {title}{required && <span className="text-destructive ml-0.5">*</span>}
          </h3>
          {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}
function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <label className="text-xs font-medium text-foreground">{label}{required && <span className="text-destructive ml-0.5">*</span>}</label>
      {children}
    </div>
  );
}
function Grid({ children }: { children: React.ReactNode; cols?: number }) {
  // Auto-fit: pack as many fields per row as the width allows (less vertical scroll).
  return <div className="grid gap-x-2 gap-y-1" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(175px, 1fr))" }}>{children}</div>;
}

export function WorkflowSwitch({ mode, onChange }: {
  mode: "standard" | "capex"; onChange: (m: "standard" | "capex") => void;
}) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-card p-0.5">
      {([["standard", "Standard e-NFA"], ["capex", "CapEx"]] as const).map(([m, label]) => (
        <button key={m} type="button" onClick={() => onChange(m)}
          className={`h-7 px-3 rounded-md text-xs font-semibold transition-colors ${mode === m ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-accent"}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

// ── Static option lists (checkbox / approval labels — the only fixed text) ───
const PROJECT_TYPES: Array<[string, string]> = [
  ["pt_increased_production", "Increased Production"], ["pt_cost_reduction", "Cost reduction / OE"],
  ["pt_quality_safety", "Quality / Safety Improvement"], ["pt_project_revision", "Project revision"],
  ["pt_compliance", "Compliance / Regulatory / customer requirement"], ["pt_environmental", "Environmental matters"],
  ["pt_replacement", "Replacement of equipment"], ["pt_others", "Others"],
];
const SUPPORT: Array<[string, string]> = [
  ["sa_market_evaluation", "Market evaluation"], ["sa_layouts", "Layouts"],
  ["sa_catalogues", "Catalogues / Technical details"], ["sa_technical_comparison", "Technical comparison"],
  ["sa_quotations", "Quotations from vendors"], ["sa_regulatory", "Regulatory / Audit Observation"],
  ["sa_finance_evaluation", "Finance evaluation comparison"], ["sa_detail_justification", "Detail Justification"],
  ["sa_key_contract", "Key contract terms comparison"], ["sa_executive_summary", "Executive Summary"],
  ["sa_comments", "Comments"], ["sa_others", "Others"],
];
const APPROVALS: Array<[string, string]> = [
  ["ap_pm", "Project Manager / User dept. HOD"], ["ap_president", "President - operations"],
  ["ap_plant_head", "Plant Head"], ["ap_cfo", "Chief Financial Officer"],
  ["ap_scm_head", "CAPEX SCM Head"], ["ap_ceo", "CEO & JMD"], ["ap_cmd", "Chairman & Managing Director"],
];

type Row = string[];
const blankRows = (n: number, cols: number): Row[] => Array.from({ length: n }, () => Array(cols).fill(""));

export function CapexWorkflow() {
  const { toast } = useToast();
  const { userId } = useUserStore();
  const [f, setF] = useState<Record<string, string | boolean>>({});
  const [budget, setBudget] = useState<Row[]>(blankRows(5, 5));   // desc, qty, uom, rate, amt
  const [charter, setCharter] = useState<Row[]>(blankRows(5, 4)); // sno, task, fpr, tcd
  const [roi, setRoi] = useState<Row[]>(blankRows(8, 4));         // sno, desc, value, uom
  const [roi2, setRoi2] = useState<Row[]>(blankRows(5, 5));       // sno, desc, uom, bridge, mwts
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<{ id: number; noteNo: string; subject: string } | null>(null);

  // Autosave on this device (so the "autosaves" header is true and work survives nav).
  const LS = "capex_nfa_native";
  useEffect(() => {
    const raw = localStorage.getItem(LS);
    if (!raw) return;
    try {
      const o = JSON.parse(raw);
      if (o.f) setF(o.f);
      if (o.budget) setBudget(o.budget); if (o.charter) setCharter(o.charter);
      if (o.roi) setRoi(o.roi); if (o.roi2) setRoi2(o.roi2);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    localStorage.setItem(LS, JSON.stringify({ f, budget, charter, roi, roi2 }));
  }, [f, budget, charter, roi, roi2]);

  const v = (k: string) => String(f[k] ?? "");
  const txt = (k: string) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const chk = (k: string) => (e: { target: { checked: boolean } }) => setF((p) => ({ ...p, [k]: e.target.checked }));
  const cell = (rows: Row[], set: (r: Row[]) => void) => (i: number, j: number) => (e: { target: { value: string } }) =>
    set(rows.map((r, ri) => ri === i ? r.map((c, ci) => ci === j ? e.target.value : c) : r));

  async function submit() {
    const subject = v("name_of_project").trim() || v("charter_project_name").trim() || v("jn_project_name").trim();
    if (!subject) { toast({ title: "Enter the project name first", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const signatories = APPROVALS.filter(([k]) => v(k).trim()).map(([k, role]) => ({ role, name: v(k).trim(), status: "pending" as const }));
      const amount = Number((v("amount_requested") || v("ee_capex_amount")).replace(/[^\d.]/g, "")) || undefined;
      const customFields = [
        ...Object.entries(f).filter(([, val]) => val !== "" && val !== false).map(([k, val]) => ({ id: k, label: k, value: String(val) })),
        { id: "budget", label: "Budget rows", value: JSON.stringify(budget) },
        { id: "charter", label: "Charter rows", value: JSON.stringify(charter) },
        { id: "roi", label: "ROI rows", value: JSON.stringify(roi) },
        { id: "roi2", label: "ROI (capex) rows", value: JSON.stringify(roi2) },
      ];
      const nfa = await api.post<{ id: number; noteNo: string }>("/api/nfas", {
        subject,
        department: v("department").trim(),
        functionDept: v("department").trim(),
        location: v("location").trim(),
        background: v("purpose").trim() || v("jn_background").trim(),
        requirements: v("project_description").trim(),
        justification: v("justification").trim() || v("jn_problem").trim(),
        modeOfProcurement: "CapEx",
        financialImplication: v("jn_financial").trim(),
        financialAmount: amount,
        recommendation: v("jn_benefits").trim() || v("jn_solution").trim(),
        signatories,
        customFields,
        createdById: userId ?? undefined,
      });
      setCreated({ id: nfa.id, noteNo: nfa.noteNo, subject });
      localStorage.removeItem(LS);
      toast({ title: "CapEx e-NFA created", description: `Note ${nfa.noteNo}` });
    } catch (e) {
      toast({ title: "Could not create e-NFA", description: (e as Error)?.message, variant: "destructive" });
    } finally { setSaving(false); }
  }

  function resetFields() {
    if (!window.confirm("Clear all CapEx fields? This cannot be undone.")) return;
    setF({});
    setBudget(blankRows(5, 5));
    setCharter(blankRows(5, 4));
    setRoi(blankRows(8, 4));
    setRoi2(blankRows(5, 5));
    localStorage.removeItem(LS);
    toast({ title: "Fields reset" });
  }

  async function downloadDocx(id: number, name: string) {
    try {
      const res = await fetch(`/api/nfas/${id}/docx`);
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${(name || "capex-nfa").replace(/[^\w.-]+/g, "_")}.docx`; a.click();
      URL.revokeObjectURL(url);
    } catch { toast({ title: "Download failed", variant: "destructive" }); }
  }

  if (created) {
    return (
      <div className="py-10 text-center">
        <CheckCircle2 size={40} className="mx-auto text-success" />
        <h3 className="mt-3 text-lg font-bold text-foreground">CapEx e-NFA created</h3>
        <p className="mt-1 text-sm text-muted-foreground">Note <span className="font-mono font-semibold text-foreground">{created.noteNo}</span> — {created.subject}</p>
        <div className="mt-5 flex items-center justify-center gap-2">
          <button onClick={() => downloadDocx(created.id, created.subject)} className="flex items-center gap-2 px-5 h-7 rounded-md text-sm font-semibold bg-primary text-primary-foreground shadow-sm hover:bg-primary/90"><Download size={15} /> Download .docx</button>
          <Link href="/"><button className="px-4 h-7 rounded-md text-sm font-semibold text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">Done</button></Link>
        </div>
      </div>
    );
  }

  const checks = (list: Array<[string, string]>) => (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-1.5">
      {list.map(([k, label]) => (
        <label key={k} className="flex items-center gap-2 text-xs font-medium text-foreground">
          <input type="checkbox" checked={!!f[k]} onChange={chk(k)} className="!w-3.5 !h-3.5 !rounded accent-primary" />
          {label}
        </label>
      ))}
    </div>
  );
  const th = "bg-slate-50 text-muted-foreground text-[10px] font-semibold uppercase tracking-wide text-left px-2 py-1.5 border border-slate-200";
  const td = "border border-slate-200 p-0";
  const tdInput = "h-7 border-0 rounded-none bg-transparent";

  return (
    <div>
      <div className="relative rounded-lg border border-slate-200 bg-slate-200 p-4 sm:p-5">
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2 mb-2">
            <button type="button" onClick={resetFields} title="Clear every CapEx field and start fresh" className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-destructive transition-colors">
              <RotateCcw size={14} /> Reset fields
            </button>
            <ReferenceDocUpload onText={(t) => { if (t && !v("purpose")) { setF((p) => ({ ...p, purpose: t })); toast({ title: "Captured from your file", description: "Added to Purpose of Capex — edit as needed." }); } }} />
          </div>
          <Section title="Granules India Ltd — Capital Expenditure" required>
            <Grid cols={3}>
              <Field label="Location"><Input value={v("location")} onChange={txt("location")} placeholder="e.g. Hyderabad — Unit II" className="h-7" /></Field>
              <Field label="CO / Div. Control No"><Input value={v("control_no")} onChange={txt("control_no")} placeholder="e.g. CO-2026-014" className="h-7" /></Field>
              <Field label="Requested By"><Input value={v("requested_by")} onChange={txt("requested_by")} placeholder="Name" className="h-7" /></Field>
              <Field label="Amount Requested ₹"><Input value={v("amount_requested")} onChange={txt("amount_requested")} placeholder="0" className="h-7 font-mono" /></Field>
              <Field label="Department"><Input value={v("department")} onChange={txt("department")} placeholder="e.g. Engineering" className="h-7" /></Field>
              <Field label="Date of Proposal"><Input type="date" value={v("date_of_proposal")} onChange={txt("date_of_proposal")} className="h-7" /></Field>
              <Field label="Financial Year"><Input value={v("financial_year")} onChange={txt("financial_year")} placeholder="e.g. FY 2026-27" className="h-7" /></Field>
            </Grid>
            <Field label="Name of Project" required><Input value={v("name_of_project")} onChange={txt("name_of_project")} placeholder="e.g. Cooling tower water recovery system" className="h-7" /></Field>
            <Field label="Purpose of Capex"><AutoTextarea value={v("purpose")} onChange={txt("purpose")} minRows={3} placeholder="What this capital expenditure is for…" className="w-full text-xs px-2.5 py-1.5 focus:outline-none" /></Field>
          </Section>

          <Section title="Project Type">{checks(PROJECT_TYPES)}</Section>

          <Section title="Project Details">
            <Field label="Project Description"><AutoTextarea value={v("project_description")} onChange={txt("project_description")} minRows={2} placeholder="Describe the project scope and deliverables…" className="w-full text-xs px-2.5 py-1.5 focus:outline-none" /></Field>
            <Grid>
              <Field label="Detail proposal can be annexed"><Input value={v("detail_proposal")} onChange={txt("detail_proposal")} placeholder="Reference / annexure name" className="h-7" /></Field>
              <Field label="Current Process"><Input value={v("current_process")} onChange={txt("current_process")} placeholder="Describe the current process" className="h-7" /></Field>
            </Grid>
            <Field label="Justification for the Capex proposed"><Input value={v("justification")} onChange={txt("justification")} placeholder="Why is this capex needed?" className="h-7" /></Field>
            <Field label="Similar activity if already executed — the working experience"><Input value={v("similar_activity")} onChange={txt("similar_activity")} placeholder="Prior experience, if any" className="h-7" /></Field>
          </Section>

          <Section title="Support Attached">
            {checks(SUPPORT)}
            <Grid>
              <Field label="Project Duration, Expected Time Lines"><Input value={v("project_duration")} onChange={txt("project_duration")} placeholder="e.g. 4 months" className="h-7" /></Field>
              <Field label="Required By Date"><Input type="date" value={v("required_by_date")} onChange={txt("required_by_date")} className="h-7" /></Field>
            </Grid>
          </Section>

          <Section title="Economic Evaluation" subtitle="Working in excel of the expected cash flows is to be vetted from F&A.">
            <Grid>
              <Field label="Capex Amount"><Input value={v("ee_capex_amount")} onChange={txt("ee_capex_amount")} placeholder="₹" className="h-7" /></Field>
              <Field label="Timelines"><Input value={v("ee_timelines")} onChange={txt("ee_timelines")} placeholder="e.g. Q2 FY27" className="h-7" /></Field>
              <Field label="Payback Period"><Input value={v("ee_payback_period")} onChange={txt("ee_payback_period")} placeholder="e.g. 18 months" className="h-7" /></Field>
              <Field label="Machinery cost"><Input value={v("ee_machinery_cost")} onChange={txt("ee_machinery_cost")} placeholder="₹" className="h-7" /></Field>
              <Field label="Detailed working of payback"><Input value={v("ee_detailed_payback")} onChange={txt("ee_detailed_payback")} placeholder="Reference / notes" className="h-7" /></Field>
              <Field label="Installation"><Input value={v("ee_installation")} onChange={txt("ee_installation")} placeholder="₹" className="h-7" /></Field>
              <Field label="NPV of payback"><Input value={v("ee_npv")} onChange={txt("ee_npv")} placeholder="₹" className="h-7" /></Field>
              <Field label="Other Break down"><Input value={v("ee_other_breakdown")} onChange={txt("ee_other_breakdown")} placeholder="₹" className="h-7" /></Field>
            </Grid>
          </Section>

          <Section title="Required Approvals" subtitle="Per Authorization matrix — name, designation, dept. & date.">
            <Grid>
              {APPROVALS.map(([k, role]) => (
                <Field key={k} label={role}><Input value={v(k)} onChange={txt(k)} placeholder="Name · date" className="h-7" /></Field>
              ))}
            </Grid>
            <Grid cols={3}>
              <Field label="SAP-Internal Order No"><Input value={v("sap_io_no")} onChange={txt("sap_io_no")} placeholder="e.g. 4500012345" className="h-7" /></Field>
              <Field label="Created On"><Input type="date" value={v("created_on")} onChange={txt("created_on")} className="h-7" /></Field>
              <Field label="Due Date of Completion"><Input type="date" value={v("due_date_completion")} onChange={txt("due_date_completion")} className="h-7" /></Field>
            </Grid>
          </Section>

          <Section title="Budget">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead><tr><th className={th}>Description of Material</th><th className={th} style={{ width: 70 }}>Qty</th><th className={th} style={{ width: 100 }}>UOM</th><th className={th} style={{ width: 120 }}>Rate ₹</th><th className={th} style={{ width: 130 }}>Amount ₹</th></tr></thead>
                <tbody>
                  {budget.map((r, i) => (
                    <tr key={i}>{r.map((c, j) => <td key={j} className={td}><Input value={c} onChange={cell(budget, setBudget)(i, j)} className={tdInput} /></td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button type="button" onClick={() => setBudget((b) => [...b, Array(5).fill("")])} className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80"><Plus size={13} /> Add row</button>
          </Section>

          <Section title="Project Charter">
            <Field label="Project Name"><Input value={v("charter_project_name")} onChange={txt("charter_project_name")} placeholder="Project name" className="h-7" /></Field>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead><tr><th className={th} style={{ width: 54 }}>S.No</th><th className={th}>Project Task</th><th className={th} style={{ width: 150 }}>FPR</th><th className={th} style={{ width: 150 }}>TCD</th></tr></thead>
                <tbody>
                  {charter.map((r, i) => (
                    <tr key={i}>{r.map((c, j) => <td key={j} className={td}><Input value={c} onChange={cell(charter, setCharter)(i, j)} className={tdInput} /></td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button type="button" onClick={() => setCharter((b) => [...b, Array(4).fill("")])} className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80"><Plus size={13} /> Add row</button>
            <Field label="Responsibility"><AutoTextarea value={v("charter_responsibility")} onChange={txt("charter_responsibility")} minRows={2} placeholder="Who is responsible for delivery…" className="w-full text-xs px-2.5 py-1.5 focus:outline-none" /></Field>
            <Field label="Accountability"><Input value={v("charter_accountability")} onChange={txt("charter_accountability")} placeholder="Accountable owner" className="h-7" /></Field>
          </Section>

          <Section title="Justification Note for Approvals">
            <Field label="Name of the Project"><AutoTextarea value={v("jn_project_name")} onChange={txt("jn_project_name")} minRows={2} placeholder="Project name" className="w-full text-xs px-2.5 py-1.5 focus:outline-none" /></Field>
            <Field label="Background"><AutoTextarea value={v("jn_background")} onChange={txt("jn_background")} minRows={2} placeholder="Context and background…" className="w-full text-xs px-2.5 py-1.5 focus:outline-none" /></Field>
            <Field label="Problem Statement"><AutoTextarea value={v("jn_problem")} onChange={txt("jn_problem")} minRows={2} placeholder="What problem does this solve?" className="w-full text-xs px-2.5 py-1.5 focus:outline-none" /></Field>
            <Field label="Proposed Solution"><AutoTextarea value={v("jn_solution")} onChange={txt("jn_solution")} minRows={2} placeholder="The proposed approach…" className="w-full text-xs px-2.5 py-1.5 focus:outline-none" /></Field>
            <Field label="Benefits of the Proposed Upgrade"><AutoTextarea value={v("jn_benefits")} onChange={txt("jn_benefits")} minRows={4} placeholder="Quantify the expected benefits…" className="w-full text-xs px-2.5 py-1.5 focus:outline-none" /></Field>
            <Field label="Financial Implications"><AutoTextarea value={v("jn_financial")} onChange={txt("jn_financial")} minRows={2} placeholder="Cost, savings, ROI…" className="w-full text-xs px-2.5 py-1.5 focus:outline-none" /></Field>
            <Grid>
              <Field label="Prepared By"><Input value={v("jn_prepared_by")} onChange={txt("jn_prepared_by")} placeholder="Name" className="h-7" /></Field>
              <Field label="Reviewed By"><Input value={v("jn_reviewed_by")} onChange={txt("jn_reviewed_by")} placeholder="Name" className="h-7" /></Field>
            </Grid>
          </Section>

          <Section title="Detailed Economic Evaluation">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead><tr><th className={th} style={{ width: 54 }}>S.No</th><th className={th}>Description</th><th className={th} style={{ width: 160 }}>Value</th><th className={th} style={{ width: 200 }}>UOM</th></tr></thead>
                <tbody>
                  {roi.map((r, i) => (
                    <tr key={i}>{r.map((c, j) => <td key={j} className={td}><Input value={c} onChange={cell(roi, setRoi)(i, j)} className={tdInput} /></td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button type="button" onClick={() => setRoi((b) => [...b, Array(4).fill("")])} className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80"><Plus size={13} /> Add row</button>
            <p className="text-xs font-semibold text-foreground pt-1">ROI</p>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead><tr><th className={th} style={{ width: 54 }}>S.No</th><th className={th}>Description</th><th className={th} style={{ width: 70 }}>UOM</th><th className={th} style={{ width: 150 }}>Bridge Things</th><th className={th} style={{ width: 150 }}>MWTS</th></tr></thead>
                <tbody>
                  {roi2.map((r, i) => (
                    <tr key={i}>{r.map((c, j) => <td key={j} className={td}><Input value={c} onChange={cell(roi2, setRoi2)(i, j)} className={tdInput} /></td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button type="button" onClick={() => setRoi2((b) => [...b, Array(5).fill("")])} className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80"><Plus size={13} /> Add row</button>
          </Section>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 pt-2">
        <Link href="/"><button type="button" className="px-4 h-7 rounded-md text-sm font-semibold text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">Cancel</button></Link>
        <button type="button" disabled={saving} onClick={submit} className="flex items-center gap-2 px-5 h-7 rounded-md text-sm font-semibold bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed">
          {saving ? <><Loader2 size={15} className="animate-spin" /> Creating…</> : "Create e-NFA"}
        </button>
      </div>
    </div>
  );
}
