import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import { useUserStore } from "../lib/store";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FUNCTIONS_LIST } from "../lib/lifecycle-config";
import { useAiStatus } from "../components/ai-button";
import { RephraseField } from "@/components/ui-kit";
import { CustomFieldsEditor, type CustomField } from "../components/CustomFieldsEditor";
import {
  ChevronLeft, Loader2, FileText, Sparkles, ShieldCheck, Search, X, Check, AlertTriangle, ListPlus,
} from "lucide-react";

// ── Single-page corporate e-NFA form ───────────────────────────────────────
// The "second button" target of the Charter/e-NFA chooser. Captures the e-NFA
// template (function, subject, background, requirements, justification, vendor
// details, mode of procurement, financial implication, recommendation) plus a
// 5-step approval workflow built on master-DB employee pickers. A DOA filter
// auto-decides whether the CMD signature is required for the entered amount.
// Persists to pmo_nfas via POST /api/nfas (signatories = the chosen approvers).

const MODES = ["Limited Tender", "Open Tender", "Single Source", "Repeat Order", "Rate Contract", "Direct Purchase"] as const;

type EmpPick = { name: string; empCode: string };
type EmpCard = { id: number; fullName: string; designation: string | null; employeeCode: string | null };

// ── Employee typeahead against the master-DB directory ──────────────────────
function EmployeeSelect({ value, onChange, placeholder }: {
  value: EmpPick; onChange: (v: EmpPick) => void; placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<EmpCard[]>([]);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/employees/search?q=${encodeURIComponent(q.trim())}&limit=8`);
        const data = r.ok ? await r.json() : [];
        if (!cancelled) { setResults(Array.isArray(data) ? data : []); setOpen(true); }
      } catch { if (!cancelled) setResults([]); }
      finally { if (!cancelled) setLoading(false); }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);

  return (
    <div className="relative" ref={boxRef}>
      {value.name ? (
        <div className="flex items-center gap-2 h-8 px-3 rounded-md border border-border bg-background">
          <Check size={14} className="text-success flex-shrink-0" />
          <span className="text-sm font-medium text-foreground truncate flex-1">{value.name}</span>
          {value.empCode && <span className="text-[11px] text-muted-foreground font-mono">{value.empCode}</span>}
          <button type="button" onClick={() => { onChange({ name: "", empCode: "" }); setQ(""); }} className="text-muted-foreground hover:text-destructive flex-shrink-0"><X size={14} /></button>
        </div>
      ) : (
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            value={q}
            onChange={e => setQ(e.target.value)}
            onFocus={() => results.length && setOpen(true)}
            placeholder={placeholder ?? "Search employee by name…"}
            className="h-8 pl-9"
          />
          {loading && <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground animate-spin" />}
        </div>
      )}
      {open && !value.name && results.length > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-popover-border bg-popover shadow-lg max-h-64 overflow-y-auto scrollbar-thin py-1">
          {results.map(emp => (
            <button
              key={emp.id}
              type="button"
              onClick={() => { onChange({ name: emp.fullName, empCode: emp.employeeCode ?? "" }); setOpen(false); setQ(""); }}
              className="w-full text-left px-3 py-2 hover:bg-accent transition-colors"
            >
              <div className="text-sm font-medium text-foreground">{emp.fullName}</div>
              <div className="text-[11px] text-muted-foreground flex items-center gap-2">
                {emp.employeeCode && <span className="font-mono">{emp.employeeCode}</span>}
                {emp.designation && <span className="truncate">{emp.designation}</span>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Section({ title, subtitle, icon, children }: {
  title: string; subtitle?: string; icon?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="glass-surface lift-card ph-rise rounded-xl p-3">
      <div className="mb-2 flex items-start gap-2.5">
        {icon && <div className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">{icon}</div>}
        <div>
          <h3 className="text-sm font-semibold text-foreground tracking-tight">{title}</h3>
          {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Field({ label, required, hint, children }: {
  label: string; required?: boolean; hint?: string; children: React.ReactNode;
}) {
  return (
    <div className="space-y-0.5">
      <label className="text-xs font-medium text-foreground">
        {label}{required && <span className="text-destructive ml-0.5">*</span>}
        {hint && <span className="text-muted-foreground font-normal ml-2 text-[11px]">{hint}</span>}
      </label>
      {children}
    </div>
  );
}

type ApproversState = { requestor: EmpPick; functionalHead: EmpPick; cfo: EmpPick; ed: EmpPick; cmd: EmpPick };
const EMPTY: EmpPick = { name: "", empCode: "" };

// Workflow steps — labels + the role string stored in signatories.
const WORKFLOW: { key: keyof ApproversState; role: string; label: string; wf: number }[] = [
  { key: "requestor", role: "Requestor", label: "Requestor", wf: 1 },
  { key: "functionalHead", role: "Functional Head", label: "Functional Head", wf: 2 },
  { key: "cfo", role: "CFO", label: "CFO", wf: 3 },
  { key: "ed", role: "ED", label: "Executive Director (ED)", wf: 4 },
];

export default function NfaNew() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { userId } = useUserStore();
  const aiStatus = useAiStatus();
  const aiEnabled = !aiStatus || aiStatus.configured;
  const [saving, setSaving] = useState(false);
  const [drafting, setDrafting] = useState(false);
  // True once the AI draft has been generated — going back to step 1 and
  // continuing again must NOT re-draft; the existing draft is preserved.
  const [drafted, setDrafted] = useState(false);
  const [descDrafting, setDescDrafting] = useState(false);
  // Two-step flow: 1 = mandatory basics + approvers, 2 = AI-drafted narrative.
  const [step, setStep] = useState<1 | 2>(1);

  // Note fields
  const [functionDept, setFunctionDept] = useState("");
  const [subject, setSubject] = useState("");
  const [background, setBackground] = useState("");
  const [requirements, setRequirements] = useState("");
  const [justification, setJustification] = useState("");
  const [vendorDetails, setVendorDetails] = useState("");
  const [modeOfProcurement, setModeOfProcurement] = useState("");
  const [financialImplication, setFinancialImplication] = useState("");
  const [financialAmount, setFinancialAmount] = useState("");
  const [recommendation, setRecommendation] = useState("");

  // User-defined extra fields (step 2) — add anywhere, drag to reorder.
  const [customFields, setCustomFields] = useState<CustomField[]>([]);

  // Approval workflow
  const [approvers, setApprovers] = useState<ApproversState>({
    requestor: { ...EMPTY }, functionalHead: { ...EMPTY }, cfo: { ...EMPTY }, ed: { ...EMPTY }, cmd: { ...EMPTY },
  });
  const setApprover = (k: keyof ApproversState, v: EmpPick) => setApprovers(a => ({ ...a, [k]: v }));

  // DOA filter — auto-decide CMD-signature requirement from the amount band.
  const [cmdRequired, setCmdRequired] = useState(false);
  const [doaChecked, setDoaChecked] = useState(false);
  const [doaLoading, setDoaLoading] = useState(false);

  useEffect(() => {
    const amt = Number(financialAmount);
    if (!amt || amt <= 0) { setDoaChecked(false); setCmdRequired(false); return; }
    let cancelled = false;
    setDoaLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/doa-matrix/preview?amount=${amt}`);
        const d = r.ok ? await r.json() : null;
        if (cancelled) return;
        const roles: string[] = Array.isArray(d?.approverRoles) ? d.approverRoles : [];
        const needsCmd = roles.includes("chairman");
        setCmdRequired(needsCmd);
        setDoaChecked(true);
        if (!needsCmd) setApprovers(a => ({ ...a, cmd: { ...EMPTY } }));
      } catch { if (!cancelled) { setDoaChecked(false); } }
      finally { if (!cancelled) setDoaLoading(false); }
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [financialAmount]);

  // ── Draft just the Description with AI (Basics step) ─────────────────────
  async function draftDescription() {
    if (!subject.trim()) { toast({ title: "Enter a Subject first", description: "AI uses the subject (plus function / mode / amount if set) to draft the description.", variant: "destructive" }); return; }
    setDescDrafting(true);
    try {
      const res = await fetch("/api/ai/nfa/draft-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: subject.trim(),
          functionDept: functionDept || undefined,
          modeOfProcurement: modeOfProcurement || undefined,
          financialAmount: Number(financialAmount) || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.message || err?.error || `AI draft failed (${res.status})`);
      }
      const d = await res.json() as Record<string, unknown>;
      const text = [d.background, d.requirements].filter((s) => typeof s === "string" && (s as string).trim()).join("\n\n").trim();
      if (!text) throw new Error("AI returned no description");
      setBackground(text);
      toast({ title: "AI drafted the description", description: "Review and edit before continuing." });
    } catch (e) {
      toast({ title: (e as Error)?.message || "AI draft failed", variant: "destructive" });
    } finally {
      setDescDrafting(false);
    }
  }

  async function draftWithAi() {
    if (!subject.trim()) { toast({ title: "Enter a Subject first", description: "AI uses the subject (plus function / mode / amount if set) to draft the note.", variant: "destructive" }); return; }
    setDrafting(true);
    try {
      const res = await fetch("/api/ai/nfa/draft-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: subject.trim(),
          functionDept: functionDept || undefined,
          modeOfProcurement: modeOfProcurement || undefined,
          financialAmount: Number(financialAmount) || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.message || err?.error || `AI draft failed (${res.status})`);
      }
      const d = await res.json() as Record<string, unknown>;
      const setIfEmpty = (cur: string, set: (v: string) => void, v?: unknown) => {
        if (!cur.trim() && typeof v === "string" && v.trim()) set(v);
      };
      setIfEmpty(background, setBackground, d.background);
      setIfEmpty(requirements, setRequirements, d.requirements);
      setIfEmpty(justification, setJustification, d.justification);
      setIfEmpty(vendorDetails, setVendorDetails, d.vendorDetails);
      setIfEmpty(modeOfProcurement, setModeOfProcurement, d.modeOfProcurement);
      setIfEmpty(financialImplication, setFinancialImplication, d.financialImplication);
      setIfEmpty(recommendation, setRecommendation, d.recommendation);
      setDrafted(true);
      toast({ title: "AI drafted the e-NFA", description: "Empty fields were filled. Review before submitting." });
    } catch (e) {
      toast({ title: (e as Error)?.message || "AI draft failed", variant: "destructive" });
    } finally {
      setDrafting(false);
    }
  }

  // Validate step-1 mandatory fields, then (if AI is configured) auto-draft the
  // narrative sections before advancing to step 2.
  async function continueToDraft() {
    if (!subject.trim()) { toast({ title: "Subject is required", variant: "destructive" }); return; }
    if (!background.trim()) { toast({ title: "Description is required", description: "Write it, or use “Draft with AI”.", variant: "destructive" }); return; }
    if (!approvers.requestor.name) { toast({ title: "Requestor is required for the approval workflow", variant: "destructive" }); return; }
    if (aiEnabled && !drafted) { await draftWithAi(); }
    setStep(2);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function backToBasics() {
    setStep(1);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleSubmit() {
    if (!subject.trim()) { toast({ title: "Subject is required", variant: "destructive" }); return; }
    if (!background.trim()) { toast({ title: "Description is required", description: "Write it, or use “Draft with AI”.", variant: "destructive" }); return; }
    if (!approvers.requestor.name) { toast({ title: "Requestor is required for the approval workflow", variant: "destructive" }); return; }

    setSaving(true);
    try {
      // Build the ordered approval workflow from the chosen employees.
      const signatories = [
        ...WORKFLOW.map(w => ({ role: w.role, name: approvers[w.key].name, empCode: approvers[w.key].empCode, status: "pending" as const })),
        ...(cmdRequired ? [{ role: "CMD", name: approvers.cmd.name, empCode: approvers.cmd.empCode, status: "pending" as const }] : []),
      ].filter(s => s.name.trim());

      const res = await fetch("/api/nfas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: subject.trim(),
          department: functionDept,
          functionDept,
          background,
          requirements,
          justification,
          vendorDetails,
          modeOfProcurement,
          financialImplication,
          financialAmount: Number(financialAmount) || undefined,
          recommendation,
          cmdRequired,
          signatories,
          customFields: customFields.filter(f => f.label.trim() || f.value.trim()),
          createdById: userId,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || `Create failed (${res.status})`);
      }
      const nfa = await res.json();
      toast({ title: `e-NFA created — ${nfa.noteNo ?? nfa.id}` });
      setLocation(`/nfas/${nfa.id}`);
    } catch (e) {
      toast({ title: (e as Error)?.message || "Failed to create e-NFA", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="w-full pb-6">
      <div className="mb-2">
        <Link href="/">
          <button className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ChevronLeft size={15} /> Back to Dashboard
          </button>
        </Link>
      </div>

      {/* Title — plain headings (no box) to save vertical space */}
      <div className="mb-2">
        <p className="text-[10px] font-mono tracking-[0.22em] uppercase text-muted-foreground">e-NFA · Note for Approval</p>
        <h2 className="text-lg font-bold text-foreground tracking-tight">New e-NFA <span className="text-sm font-normal text-muted-foreground">— for non-project spend / procurement approvals</span></h2>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-2 text-xs font-semibold">
        <span className={`inline-flex items-center gap-1.5 px-3 h-7 rounded-full ${step === 1 ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary"}`}>
          <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-white/25 text-[10px]">1</span> Basics &amp; approvers
        </span>
        <span className="h-px w-6 bg-border" />
        <span className={`inline-flex items-center gap-1.5 px-3 h-7 rounded-full ${step === 2 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
          <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-white/25 text-[10px]">2</span> Note narrative
        </span>
      </div>

      {step === 1 ? (
        <div className="space-y-2.5">
          {/* ── Note details (structured) ────────────────────────────────── */}
          <Section title="Note Details" icon={<FileText size={18} />}>
            <div className="grid gap-2 grid-cols-1 md:grid-cols-3">
              <Field label="Function / Department">
                <Select value={functionDept} onValueChange={setFunctionDept}>
                  <SelectTrigger className="h-8"><SelectValue placeholder="Select function" /></SelectTrigger>
                  <SelectContent>{FUNCTIONS_LIST.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Mode of Procurement">
                <Select value={modeOfProcurement} onValueChange={setModeOfProcurement}>
                  <SelectTrigger className="h-8"><SelectValue placeholder="Select mode" /></SelectTrigger>
                  <SelectContent>{MODES.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Financial Amount" hint="₹ · drives DOA routing">
                <Input type="number" value={financialAmount} onChange={e => setFinancialAmount(e.target.value)} placeholder="0" className="h-8" />
              </Field>
            </div>
            <Field label="Subject" required>
              <Input value={subject} onChange={e => setSubject(e.target.value)} placeholder="One-line subject of this approval note" className="h-8" />
            </Field>
            <RephraseField
              label="Description"
              required
              value={background}
              onChange={setBackground}
              rows={1}
              aiEnabled={aiEnabled}
              onDraft={draftDescription}
              drafting={descDrafting}
              context="the 'Background / Description' of an internal approval note (e-NFA)"
              placeholder="What is being approved, the context, and why it's needed… or use “Draft with AI”."
            />
          </Section>

          {/* ── Approval workflow ────────────────────────────────────────── */}
          <Section title="Steering Committee — Approval Workflow" subtitle="Select the employee for each approval step" icon={<ShieldCheck size={18} />}>
            <div className="grid gap-2 grid-cols-1 md:grid-cols-2">
              {WORKFLOW.map(w => (
                <Field key={w.key} label={w.label} hint={`Approval workflow ${w.wf}`} required={w.key === "requestor"}>
                  <EmployeeSelect value={approvers[w.key]} onChange={v => setApprover(w.key, v)} placeholder={`Search ${w.label} by name…`} />
                </Field>
              ))}
              {cmdRequired && (
                <Field label="CMD" hint="Approval workflow 5" required>
                  <EmployeeSelect value={approvers.cmd} onChange={v => setApprover("cmd", v)} placeholder="Search CMD by name…" />
                </Field>
              )}
            </div>

            {/* DOA filter result → CMD requirement */}
            <div className={`rounded-xl border p-3 flex items-start gap-3 ${cmdRequired ? "border-warn/40 bg-warn/5" : "border-border bg-muted/40"}`}>
              <ShieldCheck size={16} className={`flex-shrink-0 mt-0.5 ${cmdRequired ? "text-warn" : "text-muted-foreground"}`} />
              <div className="flex-1 min-w-0 text-xs">
                <p className="font-semibold text-foreground">DOA filter — CMD signature</p>
                {doaLoading ? (
                  <p className="text-muted-foreground mt-0.5 flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Checking DOA band…</p>
                ) : !financialAmount || Number(financialAmount) <= 0 ? (
                  <p className="text-muted-foreground mt-0.5">Enter a financial amount to auto-determine whether the CMD signature is required.</p>
                ) : doaChecked && cmdRequired ? (
                  <p className="text-warn mt-0.5 flex items-center gap-1"><AlertTriangle size={11} /> CMD signature is <strong>required</strong> for this amount band — select the CMD above.</p>
                ) : doaChecked ? (
                  <p className="text-success mt-0.5 flex items-center gap-1"><Check size={11} /> CMD signature is <strong>not required</strong> for this amount band.</p>
                ) : (
                  <p className="text-muted-foreground mt-0.5">No active DOA band matched — CMD treated as not required.</p>
                )}
              </div>
            </div>
          </Section>

          {/* ── Step 1 footer ─────────────────────────────────────────────── */}
          <div className="flex items-center justify-between gap-3 pt-2">
            <Link href="/"><button type="button" className="px-4 h-8 rounded-md text-sm font-semibold text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">Cancel</button></Link>
            <button type="button" disabled={drafting} onClick={continueToDraft} className="flex items-center gap-2 px-5 h-8 rounded-md text-sm font-semibold bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed">
              {drafting ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
              {drafting ? "Generating AI draft…" : (aiEnabled && !drafted) ? "Continue — Generate AI Draft" : "Continue"}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {aiEnabled && (
            <div className="rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3 flex items-start gap-2.5">
              <Sparkles size={16} className="text-primary flex-shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">
                AI has drafted the note from your basics. Edit any field, then use
                <span className="font-semibold text-primary"> Rephrase with AI</span> to polish it. The amount, mode and approvers you chose are preserved.
              </p>
            </div>
          )}

          {/* ── Note narrative ───────────────────────────────────────────── */}
          <Section title="Note Details" subtitle="Requirements, justification & vendors (Description is on the Basics step)" icon={<FileText size={18} />}>
            <RephraseField label="Requirements" value={requirements} onChange={setRequirements} rows={3} aiEnabled={aiEnabled} context="the 'Requirements' section of an e-NFA (procurement details)" placeholder="What is being procured — items, quantities, specs…" />
            <RephraseField label="Justification" value={justification} onChange={setJustification} rows={3} aiEnabled={aiEnabled} context="the 'Justification' section of an e-NFA" placeholder="Why this spend is necessary and justified…" />
            <RephraseField label="Vendor Details" value={vendorDetails} onChange={setVendorDetails} rows={3} aiEnabled={aiEnabled} context="the 'Vendor Details' section of an e-NFA" placeholder="Shortlisted vendors / selection approach…" />
          </Section>

          {/* ── Financial narrative + recommendation ─────────────────────── */}
          <Section title="Financial Implication &amp; Recommendation" icon={<ShieldCheck size={18} />}>
            <RephraseField label="Financial Implication (narrative)" value={financialImplication} onChange={setFinancialImplication} rows={2} aiEnabled={aiEnabled} context="the 'Financial Implication' narrative of an e-NFA" placeholder="Cost framing, recurring vs one-time, budget line…" />
            <RephraseField label="Recommended for Approval" value={recommendation} onChange={setRecommendation} rows={2} aiEnabled={aiEnabled} context="the 'Recommendation' put forward for approval in an e-NFA" placeholder="The recommendation put forward for approval…" />
          </Section>

          {/* ── Additional (user-defined) fields ──────────────────────────── */}
          <Section title="Additional Fields" subtitle="Add your own sections anywhere — drag the handle to reorder" icon={<ListPlus size={18} />}>
            <CustomFieldsEditor fields={customFields} onChange={setCustomFields} />
          </Section>

          {/* ── Step 2 footer ─────────────────────────────────────────────── */}
          <div className="flex items-center justify-between gap-3 pt-2">
            <button type="button" onClick={backToBasics} className="flex items-center gap-1.5 px-4 h-8 rounded-md text-sm font-semibold text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
              <ChevronLeft size={15} /> Back to basics
            </button>
            <button type="button" disabled={saving} onClick={handleSubmit} className="flex items-center gap-2 px-5 h-8 rounded-md text-sm font-semibold bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed">
              {saving ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />}
              {saving ? "Creating…" : "Create e-NFA"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
