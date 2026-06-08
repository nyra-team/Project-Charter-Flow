import { useEffect, useState } from "react";
import { useFieldArray, type UseFormReturn } from "react-hook-form";
import { Plus, Trash2, Calculator, Sparkles, Loader2, RefreshCw, CheckCircle2 } from "lucide-react";

// Lean step components for the Charter+NFA wizard.
// Bound to react-hook-form via `form.register()` / useFieldArray.
//
// Why plain inputs (vs the heavy shadcn FormField stack used by the older
// 5 steps): the merged Charter+NFA adds ~30 fields across 3 steps; FormField
// scales to ~12 LOC/field which would blow up charter-new.tsx by 1.5k lines.
// These three subforms cover the new surface in ~600 LOC total.

type LooseForm = UseFormReturn<Record<string, unknown>>;

function FieldGrid({ children, cols = 2 }: { children: React.ReactNode; cols?: number }) {
  return <div className={`grid gap-3 ${cols === 2 ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1"}`}>{children}</div>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-foreground tracking-tight">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

const inputCls = "rounded-md px-2.5 py-1.5 text-sm bg-card text-card-foreground border border-border focus:outline-none focus:ring-2 focus:ring-ring/40";
const taCls = inputCls + " min-h-[80px] resize-y";

function SectionCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="glass-surface lift-card ph-rise rounded-2xl p-6">
      <div className="mb-4">
        <h3 className="text-base font-semibold text-foreground tracking-tight">{title}</h3>
        {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// STEP A — NFA Narrative (Executive Summary, Background, Current State,
// Business Drivers, Out of Scope, Constraints, Assumptions + NFA header
// fields: noteNo, department, location, subject, requirementItems, category,
// entity, kind)
// ───────────────────────────────────────────────────────────────────────────
export function NarrativeStep({ form }: { form: LooseForm }) {
  const requirementItems = useFieldArray({ control: form.control as unknown as never, name: "requirementItems" });

  return (
    <div className="space-y-4">
      <SectionCard title="NFA header" subtitle="Identifies the note for downstream PR/PO + signatories.">
        <FieldGrid>
          <Field label="Note number"><input className={inputCls} {...form.register("noteNo")} /></Field>
          <Field label="Note date"><input type="date" className={inputCls} {...form.register("noteDate")} /></Field>
          <Field label="Entity" hint="GIL / GLS / CZRO / *"><input className={inputCls} {...form.register("entity")} placeholder="GIL" /></Field>
          <Field label="Category" hint="Compliance / ROI / Compliance + ROI"><input className={inputCls} {...form.register("category")} placeholder="Compliance + ROI" /></Field>
          <Field label="Department"><input className={inputCls} {...form.register("department")} /></Field>
          <Field label="Location"><input className={inputCls} {...form.register("location")} /></Field>
          <Field label="Location required"><input className={inputCls} {...form.register("locationRequired")} /></Field>
          <Field label="Kind" hint="Drives DOA band lookup">
            <select className={inputCls} {...form.register("kind")}>
              <option value="capex">capex</option>
              <option value="opex">opex</option>
              <option value="mixed">mixed</option>
            </select>
          </Field>
        </FieldGrid>
        <Field label="Subject"><input className={inputCls} {...form.register("subject")} /></Field>
      </SectionCard>

      <SectionCard title="Charter narrative" subtitle="The 7 MES-template sections that appear in the consolidated DOCX.">
        <Field label="Executive summary" hint="Top-of-document narrative for the approval committee.">
          <textarea className={taCls} rows={4} {...form.register("executiveSummary")} />
        </Field>
        <Field label="Background" hint="Why this project exists, written for the committee.">
          <textarea className={taCls} rows={3} {...form.register("background")} />
        </Field>
        <FieldGrid>
          <Field label="Current state assessment">
            <textarea className={taCls} rows={4} {...form.register("currentState")} />
          </Field>
          <Field label="Business drivers">
            <textarea className={taCls} rows={4} {...form.register("businessDrivers")} />
          </Field>
        </FieldGrid>
        <FieldGrid>
          <Field label="Out of scope" hint="Explicit exclusions — equipment, modules, integrations.">
            <textarea className={taCls} rows={3} {...form.register("outOfScope")} />
          </Field>
          <Field label="Constraints" hint="Time, budget, scope, quality bands.">
            <textarea className={taCls} rows={3} {...form.register("constraints")} />
          </Field>
        </FieldGrid>
        <Field label="Assumptions" hint="What the budget and timeline assume to be true.">
          <textarea className={taCls} rows={3} {...form.register("assumptions")} />
        </Field>
      </SectionCard>

      <SectionCard title="Requirement items" subtitle="NFA line items — what is being approved.">
        <div className="space-y-2">
          {requirementItems.fields.length === 0 && (
            <p className="text-sm text-muted-foreground py-2">No items yet — click "Add item" below.</p>
          )}
          {requirementItems.fields.map((f, i) => (
            <div key={f.id} className="flex items-start gap-2">
              <input className={inputCls + " w-48"} placeholder="Item" {...form.register(`requirementItems.${i}.item` as const)} />
              <input className={inputCls + " flex-1"} placeholder="Details / quantity / specification" {...form.register(`requirementItems.${i}.details` as const)} />
              <button type="button" onClick={() => requirementItems.remove(i)} className="text-destructive hover:text-destructive/80 p-1.5">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <button type="button" onClick={() => requirementItems.append({ item: "", details: "" })}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
            <Plus size={14} /> Add item
          </button>
        </div>
      </SectionCard>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// STEP B — Investment detail (FY-wise recurring, ROI, Previous-NFA vs LE,
// Total USD/INR, Recommendation, Potential additional budget) + DOA preview
// ───────────────────────────────────────────────────────────────────────────
export function InvestmentStep({ form }: { form: LooseForm }) {
  const fyRecurring = useFieldArray({ control: form.control as unknown as never, name: "fyRecurring" });
  return (
    <div className="space-y-4">
      <SectionCard title="Earlier vs Revised NFA" subtitle="The investment-summary delta the approval committee compares.">
        <FieldGrid>
          <Field label="Previous NFA amount (₹)" hint="What was approved last time. Leave blank for first NFA.">
            <input type="number" min={0} className={inputCls} {...form.register("previousNfaAmount", { valueAsNumber: true })} />
          </Field>
          <Field label="Latest Estimate / LE amount (₹)" hint="Current internal forecast.">
            <input type="number" min={0} className={inputCls} {...form.register("leAmount", { valueAsNumber: true })} />
          </Field>
        </FieldGrid>
      </SectionCard>

      <SectionCard title="FY-wise recurring spend" subtitle="Per-year operational cost across the TCO horizon.">
        <div className="space-y-2">
          {fyRecurring.fields.length === 0 && (
            <p className="text-sm text-muted-foreground py-2">No FY rows yet — click "Add FY" below.</p>
          )}
          {fyRecurring.fields.map((f, i) => (
            <div key={f.id} className="flex items-center gap-2">
              <input className={inputCls + " w-24"} placeholder="FY'25" {...form.register(`fyRecurring.${i}.fyLabel` as const)} />
              <input type="number" min={0} className={inputCls + " w-44"} placeholder="Amount (INR)" {...form.register(`fyRecurring.${i}.amountInr` as const, { valueAsNumber: true })} />
              <button type="button" onClick={() => fyRecurring.remove(i)} className="text-destructive hover:text-destructive/80 p-1.5">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <button type="button" onClick={() => fyRecurring.append({ fyLabel: "", amountInr: 0 })}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
            <Plus size={14} /> Add FY
          </button>
        </div>
      </SectionCard>

      <SectionCard title="Business case (quantified)" subtitle="ROI, payback, total commitment.">
        <FieldGrid>
          <Field label="ROI / Annum (₹)" hint="Quantified annual benefit.">
            <input type="number" min={0} className={inputCls} {...form.register("roiPerAnnum", { valueAsNumber: true })} />
          </Field>
          <Field label="Payback (months)">
            <input type="number" min={0} className={inputCls} {...form.register("paybackMonths", { valueAsNumber: true })} />
          </Field>
          <Field label="Total commitment (USD)" hint="String — preserves '$1.2M / TBD' phrasing.">
            <input className={inputCls} {...form.register("totalUsd")} />
          </Field>
          <Field label="Total commitment (INR)" hint="String — preserves '₹43.81 Cr' phrasing.">
            <input className={inputCls} {...form.register("totalInr")} />
          </Field>
        </FieldGrid>
        <Field label="Recommendation" hint="Procurement recommendation written for sign-off.">
          <textarea className={taCls} rows={3} {...form.register("recommendation")} />
        </Field>
        <Field label="Order form note" hint="Internal SAP / PR / PO instruction.">
          <textarea className={taCls} rows={2} {...form.register("orderFormNote")} />
        </Field>
        <Field label="Potential additional budget areas" hint="Phase III IIoT, temp SAP/CSV experts, etc.">
          <textarea className={taCls} rows={3} {...form.register("potentialAdditionalBudget")} />
        </Field>
      </SectionCard>

      <DoaPreviewPanel form={form} />
    </div>
  );
}

function DoaPreviewPanel({ form }: { form: LooseForm }) {
  const [result, setResult] = useState<null | { matched: boolean; approverRoles?: string[]; label?: string; reason?: string }>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const values = form.getValues() as Record<string, unknown>;
      const amount = Number(values.tentativeBudget ?? 0);
      const qs = new URLSearchParams({
        kind: String(values.kind ?? "capex"),
        amount: String(amount),
      });
      if (values.entity) qs.set("entity", String(values.entity));
      if (values.category) qs.set("category", String(values.category));
      const r = await fetch(`/api/doa-matrix/preview?${qs.toString()}`);
      if (!r.ok) throw new Error((await r.json())?.error ?? "Preview failed");
      setResult(await r.json());
    } catch {
      setResult({ matched: false, reason: "Could not resolve — DOA matrix may be empty or unreachable." });
    } finally {
      setBusy(false);
    }
  };

  // Auto-run once on mount so the user sees the chain immediately.
  useEffect(() => { void run(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  return (
    <SectionCard title="Resolved approver chain" subtitle="Picked from the DOA matrix using entity / category / kind / amount above.">
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={run} disabled={busy}
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40">
          <Calculator size={13} /> {busy ? "Resolving…" : "Resolve"}
        </button>
        <span className="text-[11px] text-muted-foreground">Runs against /api/doa-matrix/preview</span>
      </div>
      {result && (
        <div className={`p-3 rounded-md border text-sm ${result.matched ? "bg-emerald-50 border-emerald-200 text-emerald-900" : "bg-amber-50 border-amber-200 text-amber-900"}`}>
          {result.matched ? (
            <>
              <div className="font-medium">Match: {result.label}</div>
              <div className="mt-1 text-xs">Chain: <span className="font-mono">{(result.approverRoles ?? []).join(" → ") || "(none)"}</span></div>
            </>
          ) : (
            <div>{result.reason ?? "No band matched."}</div>
          )}
        </div>
      )}
    </SectionCard>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// STEP C — Governance (milestones, KPIs, steering committee, key members,
// attachments)
// ───────────────────────────────────────────────────────────────────────────
export function GovernanceStep({ form }: { form: LooseForm }) {
  const milestones = useFieldArray({ control: form.control as unknown as never, name: "milestones" });
  const kpis = useFieldArray({ control: form.control as unknown as never, name: "kpis" });
  const steering = useFieldArray({ control: form.control as unknown as never, name: "steeringCommittee" });
  const members = useFieldArray({ control: form.control as unknown as never, name: "keyProjectMembers" });
  const attachments = useFieldArray({ control: form.control as unknown as never, name: "attachments" });

  return (
    <div className="space-y-4">
      <SectionCard title="Implementation milestones" subtitle="The MES-template milestone table — each row appears in the DOCX roadmap.">
        <div className="space-y-2">
          {milestones.fields.length === 0 && (
            <p className="text-sm text-muted-foreground py-2">No milestones yet.</p>
          )}
          {milestones.fields.map((f, i) => (
            <div key={f.id} className="grid grid-cols-12 gap-2">
              <input className={inputCls + " col-span-6"} placeholder="Milestone" {...form.register(`milestones.${i}.milestone` as const)} />
              <input className={inputCls + " col-span-3"} placeholder="Responsible" {...form.register(`milestones.${i}.responsible` as const)} />
              <input className={inputCls + " col-span-2"} placeholder="Target date" {...form.register(`milestones.${i}.targetDate` as const)} />
              <button type="button" onClick={() => milestones.remove(i)} className="col-span-1 text-destructive hover:text-destructive/80 flex items-center justify-center">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <button type="button" onClick={() => milestones.append({ milestone: "", responsible: "", targetDate: "" })}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
            <Plus size={14} /> Add milestone
          </button>
        </div>
      </SectionCard>

      <SectionCard title="Benefits & KPIs" subtitle="Baseline → goal targets the project commits to.">
        <div className="space-y-2">
          {kpis.fields.length === 0 && <p className="text-sm text-muted-foreground py-2">No KPIs yet.</p>}
          {kpis.fields.map((f, i) => (
            <div key={f.id} className="grid grid-cols-12 gap-2">
              <input className={inputCls + " col-span-6"} placeholder="KPI" {...form.register(`kpis.${i}.kpi` as const)} />
              <input className={inputCls + " col-span-2"} placeholder="Baseline" {...form.register(`kpis.${i}.baseline` as const)} />
              <input className={inputCls + " col-span-3"} placeholder="Goal" {...form.register(`kpis.${i}.goal` as const)} />
              <button type="button" onClick={() => kpis.remove(i)} className="col-span-1 text-destructive hover:text-destructive/80 flex items-center justify-center">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <button type="button" onClick={() => kpis.append({ kpi: "", baseline: "", goal: "" })}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
            <Plus size={14} /> Add KPI
          </button>
        </div>
      </SectionCard>

      <SectionCard title="Steering Committee" subtitle="Executive sponsors / decision-makers.">
        <PeopleRepeater fields={steering.fields as { id: string }[]} append={() => steering.append({ role: "", name: "", empCode: "" })} remove={steering.remove} pathPrefix="steeringCommittee" form={form} />
      </SectionCard>

      <SectionCard title="Key Project Members" subtitle="Day-to-day SPOCs across IT / Business / QA / Production.">
        <PeopleRepeater fields={members.fields as { id: string }[]} append={() => members.append({ role: "", name: "", empCode: "" })} remove={members.remove} pathPrefix="keyProjectMembers" form={form} />
      </SectionCard>

      <SectionCard title="Attachments" subtitle="Link to cost sheets, equipment lists, vendor quotes (URL only — uploader comes in a later iteration).">
        <div className="space-y-2">
          {attachments.fields.length === 0 && <p className="text-sm text-muted-foreground py-2">No attachments yet.</p>}
          {attachments.fields.map((f, i) => (
            <div key={f.id} className="grid grid-cols-12 gap-2">
              <input className={inputCls + " col-span-4"} placeholder="Document name" {...form.register(`attachments.${i}.name` as const)} />
              <input className={inputCls + " col-span-7"} placeholder="URL" {...form.register(`attachments.${i}.url` as const)} />
              <button type="button" onClick={() => attachments.remove(i)} className="col-span-1 text-destructive hover:text-destructive/80 flex items-center justify-center">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <button type="button" onClick={() => attachments.append({ name: "", url: "" })}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
            <Plus size={14} /> Add attachment
          </button>
        </div>
      </SectionCard>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// STEP D — Generate & Review (HITL)
//
// Final wizard step. Calls POST /api/ai/charters/draft-narrative with the
// collected wizard values; renders each AI-drafted section inline-editable
// with per-section regenerate. User reviews / edits / regenerates as needed,
// then submits the form (the form's onSubmit handler — outside this step —
// fires the create + extended PATCH + DOA routing).
// ───────────────────────────────────────────────────────────────────────────

const NARRATIVE_SECTIONS: Array<{ key: string; label: string; hint: string }> = [
  { key: "executiveSummary", label: "Executive Summary", hint: "Top-of-document narrative for the approval committee." },
  { key: "background", label: "Background", hint: "Why this project exists, written for the committee." },
  { key: "currentState", label: "Current State Assessment", hint: "How things work today and what's broken." },
  { key: "businessDrivers", label: "Business Drivers", hint: "Compliance, integrity, quality, cost." },
  { key: "outOfScope", label: "Out of Scope", hint: "Explicit exclusions to manage expectations." },
  { key: "constraints", label: "Constraints", hint: "Time, budget, scope, quality bands." },
  { key: "assumptions", label: "Assumptions", hint: "What the plan presumes to be true." },
  { key: "recommendation", label: "Recommendation", hint: "What the committee is being asked to approve." },
];

export function GenerateReviewStep({ form }: { form: LooseForm }) {
  const [loading, setLoading] = useState(false);
  const [regenKey, setRegenKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/ai/status")
      .then(r => r.json())
      .then(d => setAiConfigured(!!d.configured))
      .catch(() => setAiConfigured(false));
  }, []);

  async function callDraft(regenerateOnly?: string[]) {
    if (regenerateOnly && regenerateOnly.length === 1) setRegenKey(regenerateOnly[0]);
    else setLoading(true);
    setError(null);
    try {
      const v = form.getValues() as Record<string, unknown>;
      const r = await fetch("/api/ai/charters/draft-narrative", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: v.title,
          function: v.function,
          strategicThemes: v.strategicThemes,
          businessJustification: v.businessJustification,
          scopeSummary: v.scopeSummary,
          expectedOutcomes: v.expectedOutcomes,
          scope: v.scope,
          outOfScope: v.outOfScope,
          deliverables: v.deliverables,
          category: v.category,
          entity: v.entity,
          department: v.department,
          kind: v.kind,
          tentativeBudget: v.tentativeBudget,
          capexAmount: v.capexAmount,
          opexAmount: v.opexAmount,
          fyRecurring: v.fyRecurring,
          roiPerAnnum: v.roiPerAnnum,
          paybackMonths: v.paybackMonths,
          milestones: v.milestones,
          kpis: v.kpis,
          regenerateOnly,
        }),
      });
      if (!r.ok) throw new Error((await r.json())?.error ?? "AI draft failed");
      const data = await r.json() as Record<string, string>;
      const fields = regenerateOnly && regenerateOnly.length > 0 ? regenerateOnly : NARRATIVE_SECTIONS.map(s => s.key);
      for (const k of fields) {
        if (typeof data[k] === "string" && data[k].length > 0) {
          form.setValue(k, data[k], { shouldDirty: true });
          setAccepted(s => ({ ...s, [k]: false })); // freshly generated — pending review
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI draft failed");
    } finally {
      setLoading(false);
      setRegenKey(null);
    }
  }

  if (aiConfigured === false) {
    return (
      <SectionCard title="Generate & Review" subtitle="AI generation is not configured for this environment.">
        <p className="text-sm text-muted-foreground">
          Set <code className="text-xs bg-muted px-1.5 py-0.5 rounded">ANTHROPIC_API_KEY</code> on the api-server and restart to enable
          AI-drafted narrative. You can still submit the Charter+NFA with your manually-entered text.
        </p>
      </SectionCard>
    );
  }

  return (
    <div className="space-y-4">
      <SectionCard
        title="Generate Charter+NFA narrative with AI"
        subtitle="Uses everything you've filled across the previous 8 steps as ground truth. You review and edit each section before submission — nothing is final until you click 'Submit Charter+NFA for approval' at the bottom."
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-primary" />
            <span className="text-sm font-medium">Draft all 8 narrative sections from your inputs</span>
          </div>
          <button
            type="button"
            onClick={() => callDraft()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
          >
            {loading ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            {loading ? "Drafting…" : "Generate full draft"}
          </button>
        </div>
        {error && (
          <div className="mt-3 p-3 rounded-md border border-destructive/30 bg-destructive/5 text-sm text-destructive">
            {error}
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Each section below is editable. Use "Regenerate" for a fresh take on one section. Mark sections as "Accepted" once you're happy — visible-only marker; not enforced by the backend.
        </p>
      </SectionCard>

      {NARRATIVE_SECTIONS.map(section => {
        const value = (form.watch(section.key) as string) ?? "";
        const isAccepted = !!accepted[section.key];
        const isRegen = regenKey === section.key;
        return (
          <SectionCard key={section.key} title={section.label} subtitle={section.hint}>
            <div className="space-y-2">
              <textarea
                className={taCls + " min-h-[140px]"}
                rows={6}
                value={value}
                onChange={e => {
                  form.setValue(section.key, e.target.value, { shouldDirty: true });
                  if (isAccepted) setAccepted(s => ({ ...s, [section.key]: false }));
                }}
                placeholder={`No content yet — click "Generate full draft" above or type your own.`}
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted-foreground">{value.trim().length} chars</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => callDraft([section.key])}
                    disabled={loading || isRegen}
                    className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-40"
                  >
                    {isRegen ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                    {isRegen ? "Regenerating…" : "Regenerate"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setAccepted(s => ({ ...s, [section.key]: !isAccepted }))}
                    className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors ${
                      isAccepted
                        ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                  >
                    <CheckCircle2 size={12} /> {isAccepted ? "Accepted" : "Accept"}
                  </button>
                </div>
              </div>
            </div>
          </SectionCard>
        );
      })}

      <SectionCard title="Ready to submit?" subtitle="Click the Submit button below the navigation bar. Submission triggers the DOA-resolved approver chain.">
        <p className="text-sm text-muted-foreground">
          {Object.values(accepted).filter(Boolean).length} of {NARRATIVE_SECTIONS.length} sections marked Accepted.
          The Submit button at the bottom of the page commits the Charter+NFA and routes it through the resolved DOA chain.
        </p>
      </SectionCard>
    </div>
  );
}

function PeopleRepeater({
  fields, append, remove, pathPrefix, form,
}: {
  fields: { id: string }[];
  append: () => void;
  remove: (i: number) => void;
  pathPrefix: string;
  form: LooseForm;
}) {
  return (
    <div className="space-y-2">
      {fields.length === 0 && <p className="text-sm text-muted-foreground py-2">No one added yet.</p>}
      {fields.map((f, i) => (
        <div key={f.id} className="grid grid-cols-12 gap-2">
          <input className={inputCls + " col-span-4"} placeholder="Role / designation" {...form.register(`${pathPrefix}.${i}.role` as const)} />
          <input className={inputCls + " col-span-5"} placeholder="Name" {...form.register(`${pathPrefix}.${i}.name` as const)} />
          <input className={inputCls + " col-span-2"} placeholder="Emp code" {...form.register(`${pathPrefix}.${i}.empCode` as const)} />
          <button type="button" onClick={() => remove(i)} className="col-span-1 text-destructive hover:text-destructive/80 flex items-center justify-center">
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button type="button" onClick={append}
        className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
        <Plus size={14} /> Add person
      </button>
    </div>
  );
}
