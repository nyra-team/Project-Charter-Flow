import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useGoBack } from "../lib/back";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sparkles, Wand2, Plus, X, ChevronLeft } from "lucide-react";

// Shape returned by POST /api/ai/pif/draft-from-idea
type AiDraft = {
  title: string;
  businessProblem: string;
  proposedSolution: string;
  targetOutcomes: string[];
  successMetrics: string[];
  dependencies: string[];
  topRisks: string[];
  estimatedCapex?: number;
  estimatedOpex?: number;
  estimatedDurationDays?: number;
  urgency?: "low" | "normal" | "high" | "critical";
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  if (!res.ok) throw new Error((await res.text()) || `${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

// Reusable card wrapper to match charter-new.tsx visual rhythm.
function SectionCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="glass-surface lift-card ph-rise rounded-2xl p-6">
      <div className="mb-5">
        <h3 className="text-base font-semibold text-foreground tracking-tight">{title}</h3>
        {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

export default function PifNew() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const goBack = useGoBack();

  // ── State ──────────────────────────────────────────────────────────────
  const [ideaText, setIdeaText] = useState("");
  const [title, setTitle] = useState("");
  const [businessProblem, setBusinessProblem] = useState("");
  const [proposedSolution, setProposedSolution] = useState("");
  const [targetOutcomes, setTargetOutcomes] = useState<string[]>([""]);
  const [successMetrics, setSuccessMetrics] = useState<string[]>([""]);
  const [dependencies, setDependencies] = useState<string[]>([""]);
  const [topRisks, setTopRisks] = useState<string[]>([""]);
  const [estimatedCapex, setEstimatedCapex] = useState<string>("");
  const [estimatedOpex, setEstimatedOpex] = useState<string>("");
  const [estimatedDurationDays, setEstimatedDurationDays] = useState<string>("");
  const [urgency, setUrgency] = useState<"low" | "normal" | "high" | "critical">("normal");
  const [classification, setClassification] = useState("standard");

  // ── AI draft mutation ──────────────────────────────────────────────────
  const aiDraft = useMutation({
    mutationFn: (text: string) => fetchJson<AiDraft>("/api/ai/pif/draft-from-idea", { method: "POST", body: JSON.stringify({ ideaText: text }) }),
    onSuccess: (d) => {
      setTitle(d.title);
      setBusinessProblem(d.businessProblem);
      setProposedSolution(d.proposedSolution);
      setTargetOutcomes(d.targetOutcomes.length ? d.targetOutcomes : [""]);
      setSuccessMetrics(d.successMetrics.length ? d.successMetrics : [""]);
      setDependencies(d.dependencies.length ? d.dependencies : [""]);
      setTopRisks(d.topRisks.length ? d.topRisks : [""]);
      if (d.estimatedCapex != null) setEstimatedCapex(String(d.estimatedCapex));
      if (d.estimatedOpex != null) setEstimatedOpex(String(d.estimatedOpex));
      if (d.estimatedDurationDays != null) setEstimatedDurationDays(String(d.estimatedDurationDays));
      if (d.urgency) setUrgency(d.urgency);
      toast({ title: "Draft generated", description: "Review and refine the fields below before submitting." });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "AI draft failed", description: e.message }),
  });

  // ── Create mutation ────────────────────────────────────────────────────
  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => fetchJson<{ id: number; title: string }>("/api/pifs", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (pif) => {
      qc.invalidateQueries({ queryKey: ["pifs"] });
      toast({ title: "PIF created", description: `“${pif.title}” saved as draft.` });
      navigate(`/pifs/${pif.id}`);
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Couldn't create PIF", description: e.message }),
  });

  function handleSubmit() {
    const body = {
      title: title.trim(),
      businessProblem: businessProblem.trim(),
      proposedSolution: proposedSolution.trim(),
      targetOutcomes: targetOutcomes.map((s) => s.trim()).filter(Boolean),
      successMetrics: successMetrics.map((s) => s.trim()).filter(Boolean),
      dependencies: dependencies.map((s) => s.trim()).filter(Boolean),
      topRisks: topRisks.map((s) => s.trim()).filter(Boolean),
      estimatedCapex: estimatedCapex ? Number(estimatedCapex) : undefined,
      estimatedOpex: estimatedOpex ? Number(estimatedOpex) : undefined,
      estimatedDurationDays: estimatedDurationDays ? Number(estimatedDurationDays) : undefined,
      urgency,
      classification,
    };
    if (!body.title || !body.businessProblem || !body.proposedSolution) {
      toast({ variant: "destructive", title: "Missing required fields", description: "Title, problem, and solution are required." });
      return;
    }
    create.mutate(body);
  }

  const canSubmit = title.trim() && businessProblem.trim() && proposedSolution.trim();

  return (
    <div className="space-y-6">
      {/* Back button */}
      <button
        onClick={() => goBack("/pifs")}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft size={14} />
        Back
      </button>

      <h1 className="text-3xl font-bold tracking-tight text-foreground">New Project Initiation Form</h1>

      {/* AI draft helper */}
      <SectionCard
        title="Quick start with AI"
        subtitle="Paste a few lines about the idea and Nyra will fill in the form. You can still edit everything before saving."
      >
        <Textarea
          rows={4}
          value={ideaText}
          onChange={(e) => setIdeaText(e.target.value)}
          placeholder="e.g. We need to consolidate the three different ERPs across our API and FD plants. Procurement teams are duplicating work and we have no single inventory view."
        />
        <button
          type="button"
          onClick={() => aiDraft.mutate(ideaText.trim())}
          disabled={ideaText.trim().length < 10 || aiDraft.isPending}
          className="btn-glossy-cta inline-flex items-center gap-2 px-4 h-9 rounded-md text-[13px] font-semibold disabled:opacity-50"
        >
          <Wand2 size={14} />
          {aiDraft.isPending ? "Drafting…" : "Draft with AI"}
        </button>
      </SectionCard>

      {/* Basics */}
      <SectionCard title="Basics" subtitle="The non-negotiables. Required before submission.">
        <div>
          <Label htmlFor="pif-title">Title</Label>
          <Input id="pif-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. ERP Consolidation — API + FD plants" />
        </div>
        <div>
          <Label htmlFor="pif-problem">Business problem</Label>
          <Textarea
            id="pif-problem"
            rows={4}
            value={businessProblem}
            onChange={(e) => setBusinessProblem(e.target.value)}
            placeholder="What is broken / under-served today? Be specific."
          />
        </div>
        <div>
          <Label htmlFor="pif-solution">Proposed solution</Label>
          <Textarea
            id="pif-solution"
            rows={4}
            value={proposedSolution}
            onChange={(e) => setProposedSolution(e.target.value)}
            placeholder="What are you proposing? Keep it directional, not detailed design."
          />
        </div>
      </SectionCard>

      {/* Outcomes & metrics */}
      <SectionCard title="Outcomes & metrics" subtitle="What success looks like — make the metrics measurable.">
        <ListField label="Target outcomes" values={targetOutcomes} setValues={setTargetOutcomes} placeholder="e.g. Consolidated inventory view across plants" />
        <ListField label="Success metrics" values={successMetrics} setValues={setSuccessMetrics} placeholder="e.g. Reduce stockouts by 40% in 12 months" />
      </SectionCard>

      {/* Dependencies & risks */}
      <SectionCard title="Dependencies & risks" subtitle="What else needs to be true / what could go wrong.">
        <ListField label="Dependencies" values={dependencies} setValues={setDependencies} placeholder="e.g. SAP licences refreshed by Q2" />
        <ListField label="Top risks" values={topRisks} setValues={setTopRisks} placeholder="e.g. Data migration quality from legacy ERP" />
      </SectionCard>

      {/* Cost & duration */}
      <SectionCard title="Cost & timeline" subtitle="Ballpark — these will get refined in the charter.">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label htmlFor="pif-capex">Estimated CapEx (₹)</Label>
            <Input id="pif-capex" type="number" value={estimatedCapex} onChange={(e) => setEstimatedCapex(e.target.value)} placeholder="8000000" />
          </div>
          <div>
            <Label htmlFor="pif-opex">Estimated OpEx (₹)</Label>
            <Input id="pif-opex" type="number" value={estimatedOpex} onChange={(e) => setEstimatedOpex(e.target.value)} placeholder="1500000" />
          </div>
          <div>
            <Label htmlFor="pif-days">Duration (days)</Label>
            <Input id="pif-days" type="number" value={estimatedDurationDays} onChange={(e) => setEstimatedDurationDays(e.target.value)} placeholder="240" />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="pif-urgency">Urgency</Label>
            <Select value={urgency} onValueChange={(v) => setUrgency(v as typeof urgency)}>
              <SelectTrigger id="pif-urgency"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="pif-class">Classification</Label>
            <Input id="pif-class" value={classification} onChange={(e) => setClassification(e.target.value)} placeholder="standard · capex · regulatory · …" />
          </div>
        </div>
      </SectionCard>

      {/* Footer actions */}
      <div className="flex justify-end gap-2 pb-8">
        <button
          type="button"
          onClick={() => navigate("/pifs")}
          className="px-4 h-10 rounded-md text-sm text-muted-foreground hover:bg-accent"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit || create.isPending}
          className="btn-glossy-cta inline-flex items-center gap-2 px-4 h-10 rounded-md text-sm font-semibold disabled:opacity-50"
          data-testid="btn-save-pif-draft"
        >
          <Sparkles size={14} />
          {create.isPending ? "Saving…" : "Save as draft"}
        </button>
      </div>
    </div>
  );
}

// ─── Repeatable string-list editor ───────────────────────────────────────────

function ListField({
  label,
  values,
  setValues,
  placeholder,
}: {
  label: string;
  values: string[];
  setValues: React.Dispatch<React.SetStateAction<string[]>>;
  placeholder: string;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="space-y-2">
        {values.map((v, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              value={v}
              onChange={(e) => setValues((arr) => arr.map((x, idx) => (idx === i ? e.target.value : x)))}
              placeholder={placeholder}
            />
            {values.length > 1 && (
              <button
                type="button"
                onClick={() => setValues((arr) => arr.filter((_, idx) => idx !== i))}
                className="text-muted-foreground hover:text-destructive p-1.5"
                aria-label="Remove row"
              >
                <X size={14} />
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={() => setValues((arr) => [...arr, ""])}
          className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
        >
          <Plus size={12} />
          Add row
        </button>
      </div>
    </div>
  );
}
