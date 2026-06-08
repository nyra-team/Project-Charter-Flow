import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sparkles, Wand2, Plus, X, ChevronLeft } from "lucide-react";

// Shape returned by POST /api/ai/nfa/draft-from-brief
type AiDraft = {
  subject: string;
  background: string;
  requirementItems: { item: string; details: string }[];
  orderFormNote: string;
  recommendation: string;
};

type RequirementItem = { item: string; details: string };
type SignatoryRow = { role: string; name: string; empCode: string };

const DEFAULT_SIGNATORIES: SignatoryRow[] = [
  { role: "Initiator", name: "", empCode: "" },
  { role: "Department Head", name: "", empCode: "" },
  { role: "Finance Head", name: "", empCode: "" },
  { role: "Chairman / MD", name: "", empCode: "" },
];

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  if (!res.ok) throw new Error((await res.text()) || `${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

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

export default function NfaNew() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();

  // Optional ?projectId= to pre-link the note to a project.
  const search = useSearch();
  const presetProjectId = new URLSearchParams(search).get("projectId");

  const { data: projects } = useQuery({
    queryKey: ["projects-min"],
    queryFn: () => fetchJson<Array<{ id: number; name: string }>>("/api/projects"),
  });

  // ── State ──────────────────────────────────────────────────────────────
  const [brief, setBrief] = useState("");
  const [projectId, setProjectId] = useState<string>(presetProjectId ?? "none");
  const [department, setDepartment] = useState("");
  const [location, setLocation] = useState("");
  const [locationRequired, setLocationRequired] = useState("");
  const [noteDate, setNoteDate] = useState("");
  const [subject, setSubject] = useState("");
  const [background, setBackground] = useState("");
  const [requirementItems, setRequirementItems] = useState<RequirementItem[]>([{ item: "", details: "" }]);
  const [orderFormNote, setOrderFormNote] = useState("");
  const [totalUsd, setTotalUsd] = useState("");
  const [totalInr, setTotalInr] = useState("");
  const [recommendation, setRecommendation] = useState("");
  const [signatories, setSignatories] = useState<SignatoryRow[]>(DEFAULT_SIGNATORIES);

  // ── AI draft ───────────────────────────────────────────────────────────
  const aiDraft = useMutation({
    mutationFn: (text: string) =>
      fetchJson<AiDraft>("/api/ai/nfa/draft-from-brief", {
        method: "POST",
        body: JSON.stringify({ brief: text, projectId: projectId !== "none" ? Number(projectId) : undefined }),
      }),
    onSuccess: (d) => {
      setSubject(d.subject);
      setBackground(d.background);
      setRequirementItems(d.requirementItems.length ? d.requirementItems : [{ item: "", details: "" }]);
      setOrderFormNote(d.orderFormNote ?? "");
      setRecommendation(d.recommendation);
      toast({ title: "Draft generated", description: "Review and refine the note before saving." });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "AI draft failed", description: e.message }),
  });

  // ── Create ─────────────────────────────────────────────────────────────
  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetchJson<{ id: number; subject: string }>("/api/nfas", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (nfa) => {
      qc.invalidateQueries({ queryKey: ["nfas"] });
      toast({ title: "NFA created", description: `Saved as draft.` });
      navigate(`/nfas/${nfa.id}`);
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Couldn't create NFA", description: e.message }),
  });

  function handleSubmit() {
    const body = {
      projectId: projectId !== "none" ? Number(projectId) : undefined,
      department: department.trim(),
      location: location.trim(),
      locationRequired: locationRequired.trim(),
      noteDate: noteDate.trim() || undefined,
      subject: subject.trim(),
      background: background.trim(),
      requirementItems: requirementItems
        .map((r) => ({ item: r.item.trim(), details: r.details.trim() }))
        .filter((r) => r.item || r.details),
      orderFormNote: orderFormNote.trim(),
      totalUsd: totalUsd.trim(),
      totalInr: totalInr.trim(),
      recommendation: recommendation.trim(),
      signatories: signatories
        .filter((s) => s.role.trim())
        .map((s) => ({ role: s.role.trim(), name: s.name.trim(), empCode: s.empCode.trim() || undefined, status: "pending" as const })),
    };
    if (!body.subject) {
      toast({ variant: "destructive", title: "Subject is required", description: "Give the note a subject before saving." });
      return;
    }
    create.mutate(body);
  }

  const canSubmit = subject.trim().length > 0;

  return (
    <div className="space-y-6">
      <button
        onClick={() => navigate("/nfas")}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft size={14} />
        Back to NFAs
      </button>

      <h1 className="text-3xl font-bold tracking-tight text-foreground">New Note for Approval</h1>

      {/* AI helper */}
      <SectionCard
        title="Quick start with AI"
        subtitle="Describe what you need approved in a few lines and Nyra will draft the note. You can edit everything before saving."
      >
        <Textarea
          rows={4}
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="e.g. Need approval to procure 50 enterprise PMO licenses for FY26, ~₹17L incl. one-time onboarding. Replaces manual spreadsheet tracking across 35 projects."
        />
        <button
          type="button"
          onClick={() => aiDraft.mutate(brief.trim())}
          disabled={brief.trim().length < 10 || aiDraft.isPending}
          className="btn-glossy-cta inline-flex items-center gap-2 px-4 h-9 rounded-md text-[13px] font-semibold disabled:opacity-50"
        >
          <Wand2 size={14} />
          {aiDraft.isPending ? "Drafting…" : "Draft with AI"}
        </button>
      </SectionCard>

      {/* Header / meta */}
      <SectionCard title="Note details" subtitle="Header fields that appear at the top of the printed note.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="nfa-project">Linked project (optional)</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger id="nfa-project"><SelectValue placeholder="Standalone note" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Standalone (no project)</SelectItem>
                {(projects ?? []).map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="nfa-dept">Department</Label>
            <Input id="nfa-dept" value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="e.g. Information Technology" />
          </div>
          <div>
            <Label htmlFor="nfa-loc">Location</Label>
            <Input id="nfa-loc" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Corporate Office, Hyderabad" />
          </div>
          <div>
            <Label htmlFor="nfa-locreq">Location required</Label>
            <Input id="nfa-locreq" value={locationRequired} onChange={(e) => setLocationRequired(e.target.value)} placeholder="e.g. All Units" />
          </div>
          <div>
            <Label htmlFor="nfa-date">Note date</Label>
            <Input id="nfa-date" value={noteDate} onChange={(e) => setNoteDate(e.target.value)} placeholder="DD-MM-YYYY" />
          </div>
        </div>
      </SectionCard>

      {/* Body */}
      <SectionCard title="The note" subtitle="Subject, background and recommendation.">
        <div>
          <Label htmlFor="nfa-subject">Subject</Label>
          <Input id="nfa-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Procurement of PMO enterprise licenses for FY26" />
        </div>
        <div>
          <Label htmlFor="nfa-bg">Background</Label>
          <Textarea id="nfa-bg" rows={4} value={background} onChange={(e) => setBackground(e.target.value)} placeholder="Why is this needed? Context the approvers need." />
        </div>
        <div>
          <Label htmlFor="nfa-rec">Recommendation</Label>
          <Textarea id="nfa-rec" rows={3} value={recommendation} onChange={(e) => setRecommendation(e.target.value)} placeholder="What are you recommending the signatories approve?" />
        </div>
      </SectionCard>

      {/* Requirement line-items */}
      <SectionCard title="Requirement / details" subtitle="Line-items that make up the request.">
        <div className="space-y-3">
          {requirementItems.map((row, i) => (
            <div key={i} className="grid grid-cols-1 md:grid-cols-[1fr_2fr_auto] gap-2 items-start">
              <Input
                value={row.item}
                onChange={(e) => setRequirementItems((arr) => arr.map((x, idx) => (idx === i ? { ...x, item: e.target.value } : x)))}
                placeholder="Item (e.g. Platform Fee)"
              />
              <Input
                value={row.details}
                onChange={(e) => setRequirementItems((arr) => arr.map((x, idx) => (idx === i ? { ...x, details: e.target.value } : x)))}
                placeholder="Details"
              />
              {requirementItems.length > 1 && (
                <button
                  type="button"
                  onClick={() => setRequirementItems((arr) => arr.filter((_, idx) => idx !== i))}
                  className="text-muted-foreground hover:text-destructive p-2.5"
                  aria-label="Remove row"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => setRequirementItems((arr) => [...arr, { item: "", details: "" }])}
            className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
          >
            <Plus size={12} />
            Add line-item
          </button>
        </div>
        <div>
          <Label htmlFor="nfa-order">Order-form / attachment note</Label>
          <Textarea id="nfa-order" rows={2} value={orderFormNote} onChange={(e) => setOrderFormNote(e.target.value)} placeholder="e.g. As per attached vendor Order Form dated 01-06-2026." />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="nfa-usd">Total (USD)</Label>
            <Input id="nfa-usd" value={totalUsd} onChange={(e) => setTotalUsd(e.target.value)} placeholder="$20,000" />
          </div>
          <div>
            <Label htmlFor="nfa-inr">Total (INR)</Label>
            <Input id="nfa-inr" value={totalInr} onChange={(e) => setTotalInr(e.target.value)} placeholder="₹17,00,000" />
          </div>
        </div>
      </SectionCard>

      {/* Signatories */}
      <SectionCard title="Approval grid" subtitle="Who signs off. Each row becomes an approve/reject step after submission.">
        <div className="space-y-3">
          {signatories.map((row, i) => (
            <div key={i} className="grid grid-cols-1 md:grid-cols-[1.2fr_1.2fr_0.8fr_auto] gap-2 items-start">
              <Input
                value={row.role}
                onChange={(e) => setSignatories((arr) => arr.map((x, idx) => (idx === i ? { ...x, role: e.target.value } : x)))}
                placeholder="Role (e.g. Finance Head)"
              />
              <Input
                value={row.name}
                onChange={(e) => setSignatories((arr) => arr.map((x, idx) => (idx === i ? { ...x, name: e.target.value } : x)))}
                placeholder="Name"
              />
              <Input
                value={row.empCode}
                onChange={(e) => setSignatories((arr) => arr.map((x, idx) => (idx === i ? { ...x, empCode: e.target.value } : x)))}
                placeholder="Emp code"
              />
              {signatories.length > 1 && (
                <button
                  type="button"
                  onClick={() => setSignatories((arr) => arr.filter((_, idx) => idx !== i))}
                  className="text-muted-foreground hover:text-destructive p-2.5"
                  aria-label="Remove signatory"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => setSignatories((arr) => [...arr, { role: "", name: "", empCode: "" }])}
            className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
          >
            <Plus size={12} />
            Add signatory
          </button>
        </div>
      </SectionCard>

      {/* Footer */}
      <div className="flex justify-end gap-2 pb-8">
        <button
          type="button"
          onClick={() => navigate("/nfas")}
          className="px-4 h-10 rounded-md text-sm text-muted-foreground hover:bg-accent"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit || create.isPending}
          className="btn-glossy-cta inline-flex items-center gap-2 px-4 h-10 rounded-md text-sm font-semibold disabled:opacity-50"
          data-testid="btn-save-nfa-draft"
        >
          <Sparkles size={14} />
          {create.isPending ? "Saving…" : "Save as draft"}
        </button>
      </div>
    </div>
  );
}
