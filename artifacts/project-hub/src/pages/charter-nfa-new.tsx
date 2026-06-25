// Standalone e-NFA for NON-PROJECT spend — its own dedicated field set, distinct
// from the full Project Charter. Reached from the "e-NFA for non projects" option
// in the Charter+e-NFA chooser. Persists to pmo_nfas via POST /api/nfas (no
// projectId), then offers the .docx download. Lives under /charters now.
//
// Chrome mirrors charter-template-new.tsx (the Charter+e-NFA form) verbatim so
// the two surfaces look identical: the slate-200 card, the input/textarea style
// wrapper, the Section/Field/Grid primitives, the title row and footer buttons.
import { useState } from "react";
import { Link } from "wouter";
import { ChevronLeft, Download, Plus, Trash2, Loader2, CheckCircle2, RotateCcw } from "lucide-react";
import { api } from "@/lib/extra-api";
import { useToast } from "@/hooks/use-toast";
import { useGoBack } from "../lib/back";
import { useUserStore } from "../lib/store";
import { Input } from "@/components/ui/input";
import { AutoTextarea } from "@/components/ui/auto-textarea";
import { EmployeeCombobox } from "../components/employee-combobox";
import { WorkflowSwitch, CapexWorkflow } from "../components/CapexWorkflow";
import { ReferenceDocUpload } from "../components/ReferenceDocUpload";

// ── Shared primitives — copied from charter-template-new.tsx for identical chrome
function Section({ title, subtitle, required, dense, children }: {
  title: string; subtitle?: string; required?: boolean; dense?: boolean; children: React.ReactNode;
}) {
  return (
    <div className={dense ? "py-1" : "py-1.5"}>
      <div className={`flex items-start gap-2 ${dense ? "mb-1" : "mb-1 gap-2.5"}`}>
        <div>
          <h3 className="text-sm font-semibold text-foreground tracking-tight leading-tight">
            {title}{required && <span className="text-destructive ml-0.5">*</span>}
            {dense && subtitle && <span className="text-muted-foreground font-normal ml-2 text-[11px]">{subtitle}</span>}
          </h3>
          {!dense && subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
      </div>
      <div className={dense ? "space-y-0.5" : "space-y-1"}>{children}</div>
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
function Grid({ children }: { children: React.ReactNode; cols?: number }) {
  // Auto-fit: pack as many fields per row as the width allows (less vertical scroll).
  return <div className="grid gap-x-2 gap-y-1" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(175px, 1fr))" }}>{children}</div>;
}

type Sig = { role: string; name: string; empCode?: string; designation?: string };
const DEFAULT_SIGS: Sig[] = [
  { role: "Requestor", name: "" },
  { role: "Functional Head", name: "" },
  { role: "CFO", name: "" },
  { role: "Executive Director (ED)", name: "" },
];

export default function CharterNfaNew() {
  const { toast } = useToast();
  const goBack = useGoBack();
  const { userId } = useUserStore();

  const [subject, setSubject] = useState("");
  const [functionDept, setFunctionDept] = useState("");
  const [location, setLocation] = useState("");
  const [background, setBackground] = useState("");
  const [requirements, setRequirements] = useState("");
  const [justification, setJustification] = useState("");
  const [vendorDetails, setVendorDetails] = useState("");
  const [modeOfProcurement, setModeOfProcurement] = useState("");
  const [financialImplication, setFinancialImplication] = useState("");
  const [financialAmount, setFinancialAmount] = useState("");
  const [recommendation, setRecommendation] = useState("");
  const [sigs, setSigs] = useState<Sig[]>(DEFAULT_SIGS);

  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<{ id: number; noteNo: string } | null>(null);
  const [mode, setMode] = useState<"standard" | "capex">("standard");

  // textarea base — border/bg/rounded come from the wrapper's [&_textarea] rules.
  const ta = "w-full text-xs px-2.5 py-1.5 focus:outline-none";

  async function submit() {
    if (!subject.trim()) { toast({ title: "Subject is required", variant: "destructive" }); return; }
    if (!background.trim()) { toast({ title: "Background is required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const nfa = await api.post<{ id: number; noteNo: string }>("/api/nfas", {
        subject: subject.trim(),
        department: functionDept.trim(),
        functionDept: functionDept.trim(),
        location: location.trim(),
        background: background.trim(),
        requirements: requirements.trim(),
        justification: justification.trim(),
        vendorDetails: vendorDetails.trim(),
        modeOfProcurement: modeOfProcurement.trim(),
        financialImplication: financialImplication.trim(),
        financialAmount: financialAmount ? Number(financialAmount) : undefined,
        recommendation: recommendation.trim(),
        signatories: sigs.filter((s) => s.role.trim()).map((s) => ({ role: s.role.trim(), name: s.name.trim(), empCode: s.empCode, designation: s.designation?.trim() || undefined, status: "pending" })),
        createdById: userId ?? undefined,
      });
      setCreated({ id: nfa.id, noteNo: nfa.noteNo });
      toast({ title: "e-NFA created", description: `Note ${nfa.noteNo}` });
    } catch (e) {
      toast({ title: "Could not create e-NFA", description: (e as Error)?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  function resetFields() {
    if (!window.confirm("Clear all fields? This cannot be undone.")) return;
    setSubject(""); setFunctionDept(""); setLocation(""); setBackground("");
    setRequirements(""); setJustification(""); setVendorDetails(""); setModeOfProcurement("");
    setFinancialImplication(""); setFinancialAmount(""); setRecommendation(""); setSigs(DEFAULT_SIGS);
    toast({ title: "Fields reset" });
  }

  async function downloadDocx(id: number, name: string) {
    try {
      const res = await fetch(`/api/nfas/${id}/docx`);
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(name || "e-nfa").replace(/[^\w.-]+/g, "_")}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Download failed", variant: "destructive" });
    }
  }

  return (
    <div className="w-full pb-4 [&_input]:shadow-none [&_input]:rounded-md [&_input]:border [&_input]:border-slate-200 [&_input]:bg-white [&_textarea]:shadow-none [&_textarea]:rounded-md [&_textarea]:border [&_textarea]:border-slate-200 [&_textarea]:bg-white [&_input:focus]:border-blue-300 [&_input:focus-visible]:border-blue-300 [&_input:focus-visible]:ring-blue-200 [&_textarea:focus]:border-blue-300 [&_textarea:focus]:outline-none [&_textarea:focus]:ring-1 [&_textarea:focus]:ring-blue-200">
      <div className="mb-1">
        <button onClick={() => goBack("/")} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft size={15} /> Back
        </button>
      </div>

      <div className="flex items-start justify-between gap-4 mb-1.5">
        <div>
          {mode === "capex" ? (
            <>
              <h2 className="text-lg font-bold text-foreground tracking-tight">Capital Expenditure · e-NFA <span className="text-sm font-normal text-muted-foreground">— Note for Approval</span></h2>
              <p className="text-[11px] text-muted-foreground mt-0.5">Your progress autosaves on this device — you can safely leave and come back.</p>
            </>
          ) : (
            <>
              <h2 className="text-lg font-bold text-foreground tracking-tight">Note for Approval · e-NFA <span className="text-sm font-normal text-muted-foreground">— standalone note for non-project spend</span></h2>
              <p className="text-[11px] text-muted-foreground mt-0.5">Choose CapEx for capital expenditure, or the standard e-NFA workflow.</p>
            </>
          )}
        </div>
        <WorkflowSwitch mode={mode} onChange={setMode} />
      </div>

      {mode === "capex" ? <CapexWorkflow /> : (
      <div className="relative rounded-lg border border-slate-200 bg-slate-200 p-4 sm:p-5">
        {created ? (
          <div className="rounded-lg bg-white p-6 text-center">
            <CheckCircle2 size={40} className="mx-auto text-success" />
            <h3 className="mt-3 text-lg font-bold text-foreground">e-NFA created</h3>
            <p className="mt-1 text-sm text-muted-foreground">Note <span className="font-mono font-semibold text-foreground">{created.noteNo}</span> — {subject}</p>
            <div className="mt-5 flex items-center justify-center gap-2">
              <button onClick={() => downloadDocx(created.id, subject)} className="flex items-center gap-2 px-5 h-7 rounded-md text-sm font-semibold bg-primary text-primary-foreground shadow-sm hover:bg-primary/90">
                <Download size={15} /> Download .docx
              </button>
              <Link href="/"><button className="px-4 h-7 rounded-md text-sm font-semibold text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">Done</button></Link>
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2 mb-2">
              <button type="button" onClick={resetFields} title="Clear every field and start a fresh e-NFA" className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-destructive transition-colors">
                <RotateCcw size={14} /> Reset fields
              </button>
              <ReferenceDocUpload onText={(t) => { if (t && !background.trim()) { setBackground(t); toast({ title: "Captured from your file", description: "Added to Background — edit as needed." }); } }} />
            </div>
            <Section title="Note" required>
              <Field label="Subject" required>
                <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. AMC renewal — data-centre UPS" className="h-7" />
              </Field>
              <Grid>
                <Field label="Function / Department"><Input value={functionDept} onChange={(e) => setFunctionDept(e.target.value)} className="h-7" /></Field>
                <Field label="Location / Unit"><Input value={location} onChange={(e) => setLocation(e.target.value)} className="h-7" /></Field>
              </Grid>
              <Field label="Background" required>
                <AutoTextarea value={background} onChange={(e) => setBackground(e.target.value)} minRows={3} placeholder="Why is this spend needed?" className={ta} />
              </Field>
            </Section>

            <Section title="Procurement">
              <Field label="Requirement (procurement details)">
                <AutoTextarea value={requirements} onChange={(e) => setRequirements(e.target.value)} minRows={2} placeholder="What is being procured?" className={ta} />
              </Field>
              <Field label="Justification">
                <AutoTextarea value={justification} onChange={(e) => setJustification(e.target.value)} minRows={2} className={ta} />
              </Field>
              <Grid>
                <Field label="Mode of procurement"><Input value={modeOfProcurement} onChange={(e) => setModeOfProcurement(e.target.value)} placeholder="e.g. single-source / RFQ" className="h-7" /></Field>
                <Field label="Vendor details"><Input value={vendorDetails} onChange={(e) => setVendorDetails(e.target.value)} className="h-7" /></Field>
              </Grid>
            </Section>

            <Section title="Financials">
              <Grid>
                <Field label="Financial amount (₹)"><Input type="number" value={financialAmount} onChange={(e) => setFinancialAmount(e.target.value)} placeholder="0" className="h-7 font-mono" /></Field>
                <Field label="Financial implication"><Input value={financialImplication} onChange={(e) => setFinancialImplication(e.target.value)} placeholder="CapEx / OpEx, recurring…" className="h-7" /></Field>
              </Grid>
              <Field label="Recommendation">
                <AutoTextarea value={recommendation} onChange={(e) => setRecommendation(e.target.value)} minRows={2} className={ta} />
              </Field>
            </Section>

            <Section title="Approval signatory chain" subtitle="Sequential approval order for this note.">
              {sigs.map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input value={s.role} onChange={(e) => setSigs((a) => a.map((x, j) => j === i ? { ...x, role: e.target.value } : x))} placeholder="Role" className="h-7 w-48" />
                  <EmployeeCombobox
                    value={s.name}
                    placeholder="Select approver…"
                    onSelect={(hit) => setSigs((a) => a.map((x, j) => j === i ? { ...x, name: hit.name, empCode: hit.code ?? undefined, designation: hit.designation ?? undefined } : x))}
                  />
                  <Input value={s.designation ?? ""} onChange={(e) => setSigs((a) => a.map((x, j) => j === i ? { ...x, designation: e.target.value } : x))} placeholder="Designation" className="h-7 w-56" />
                  <button type="button" onClick={() => setSigs((a) => a.filter((_, j) => j !== i))} className="w-9 h-9 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"><Trash2 size={14} /></button>
                </div>
              ))}
              <button type="button" onClick={() => setSigs((a) => [...a, { role: "", name: "" }])} className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80"><Plus size={13} /> Add signatory</button>
            </Section>

            <div className="flex items-center justify-end gap-2 pt-1">
              <Link href="/"><button type="button" className="px-4 h-7 rounded-md text-sm font-semibold text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">Cancel</button></Link>
              <button type="button" disabled={saving} onClick={submit} className="flex items-center gap-2 px-5 h-7 rounded-md text-sm font-semibold bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed">
                {saving ? <><Loader2 size={15} className="animate-spin" /> Creating…</> : "Create e-NFA"}
              </button>
            </div>
          </div>
        )}
      </div>
      )}
    </div>
  );
}
