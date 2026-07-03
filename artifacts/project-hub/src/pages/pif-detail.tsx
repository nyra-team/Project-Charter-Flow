import { useState } from "react";
import { useRoute, useLocation, Link } from "wouter";
import { useGoBack } from "../lib/back";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChevronLeft, Send, CheckCircle2, XCircle, FileSearch, Wand2,
  AlertCircle, Sparkles, ListChecks, Target, ShieldAlert, Link2,
} from "lucide-react";
import { formatDate } from "../lib/format";

type PifStatus = "draft" | "submitted" | "under_review" | "approved" | "rejected" | "converted";
type Pif = {
  id: number;
  title: string;
  businessProblem: string;
  proposedSolution: string;
  sponsorId: number | null;
  hodId: number | null;
  targetOutcomes: string[];
  successMetrics: string[];
  dependencies: string[];
  topRisks: string[];
  estimatedCapex: string | null;
  estimatedOpex: string | null;
  estimatedDurationDays: number | null;
  classification: string;
  urgency: string;
  status: PifStatus;
  decidedAt: string | null;
  decidedById: number | null;
  decisionNote: string | null;
  convertedProjectId: number | null;
  convertedAt: string | null;
  createdById: number | null;
  createdAt: string;
  updatedAt: string;
};

type Template = { id: number; name: string; category: string };

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  if (!res.ok) throw new Error((await res.text()) || `${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export default function PifDetail() {
  const [, params] = useRoute<{ id: string }>("/pifs/:id");
  const pifId = params?.id ? parseInt(params.id) : NaN;
  const [, navigate] = useLocation();
  const goBack = useGoBack();
  const { toast } = useToast();
  const qc = useQueryClient();
  // PMO has no functional roles anymore — any PMO user can deliver the verdict.
  const canDecide = true;

  const [decideOpen, setDecideOpen] = useState<"approve" | "reject" | null>(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [convertOpen, setConvertOpen] = useState(false);

  const { data: pif, isLoading } = useQuery({
    queryKey: ["pifs", pifId],
    queryFn: () => fetchJson<Pif>(`/api/pifs/${pifId}`),
    enabled: !isNaN(pifId),
  });

  const submit = useMutation({
    mutationFn: () => fetchJson<Pif>(`/api/pifs/${pifId}/submit`, { method: "POST", body: "{}" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pifs"] });
      qc.invalidateQueries({ queryKey: ["pifs", pifId] });
      toast({ title: "Submitted for review", description: "HOD has been notified." });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Submit failed", description: e.message }),
  });

  const decide = useMutation({
    mutationFn: (body: { decision: "approve" | "reject"; note?: string }) =>
      fetchJson<Pif>(`/api/pifs/${pifId}/decide`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ["pifs"] });
      qc.invalidateQueries({ queryKey: ["pifs", pifId] });
      setDecideOpen(null);
      setDecisionNote("");
      toast({
        title: updated.status === "approved" ? "PIF approved" : "PIF rejected",
        description: "Originator and sponsor have been notified.",
      });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Decision failed", description: e.message }),
  });

  const critique = useMutation({
    mutationFn: () => fetchJson<{ overallScore: number; readyForHod: boolean; gaps: string[]; suggestedEdits: string[] }>(
      "/api/ai/pif/critique",
      { method: "POST", body: JSON.stringify({ pifId }) },
    ),
    onSuccess: (data) => {
      const summary = `Score ${data.overallScore}/5 — ${data.readyForHod ? "Ready for HOD" : "Tighten before submitting"}.\n\n${data.gaps.slice(0, 3).join("\n• ")}`;
      toast({ title: "AI critique", description: summary });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Critique failed", description: e.message }),
  });

  if (isNaN(pifId)) return <p className="text-destructive">Invalid PIF id</p>;

  if (isLoading || !pif) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <button
        onClick={() => goBack("/pifs")}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft size={14} />
        Back
      </button>

      {/* Header */}
      <div className="glass-surface lift-card ph-rise rounded-2xl p-6 relative overflow-hidden">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <StatusBadge status={pif.status} />
              <UrgencyBadge urgency={pif.urgency} />
              <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-accent text-accent-foreground">
                {pif.classification}
              </span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">{pif.title}</h1>
            <p className="text-xs text-muted-foreground mt-1">
              Created {formatDate(pif.createdAt)} · Updated {formatDate(pif.updatedAt)}
              {pif.convertedProjectId && (
                <>
                  {" · "}
                  <Link href={`/projects/${pif.convertedProjectId}`}>
                    <span className="text-primary hover:underline">→ Project #{pif.convertedProjectId}</span>
                  </Link>
                </>
              )}
            </p>
          </div>

          {/* Action bar */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => critique.mutate()}
              disabled={critique.isPending}
              className="inline-flex items-center gap-1.5 px-3 h-9 rounded-md text-sm border border-border bg-card hover:bg-accent disabled:opacity-50"
              title="AI critique — flags gaps before HOD review"
            >
              <Wand2 size={14} />
              {critique.isPending ? "Reviewing…" : "Critique"}
            </button>
            {pif.status === "draft" && (
              <button
                type="button"
                onClick={() => submit.mutate()}
                disabled={submit.isPending || !pif.hodId}
                title={!pif.hodId ? "Assign an HOD first (edit the PIF)" : "Submit to HOD"}
                className="btn-glossy-cta inline-flex items-center gap-1.5 px-3 h-9 rounded-md text-sm font-semibold disabled:opacity-50"
              >
                <Send size={14} />
                Submit for review
              </button>
            )}
            {canDecide && (pif.status === "submitted" || pif.status === "under_review") && (
              <>
                <button
                  type="button"
                  onClick={() => setDecideOpen("reject")}
                  className="inline-flex items-center gap-1.5 px-3 h-9 rounded-md text-sm border border-destructive/40 text-destructive bg-destructive/5 hover:bg-destructive/10"
                >
                  <XCircle size={14} />
                  Reject
                </button>
                <button
                  type="button"
                  onClick={() => setDecideOpen("approve")}
                  className="btn-glossy-cta inline-flex items-center gap-1.5 px-3 h-9 rounded-md text-sm font-semibold"
                >
                  <CheckCircle2 size={14} />
                  Approve
                </button>
              </>
            )}
            {pif.status === "approved" && (
              <button
                type="button"
                onClick={() => setConvertOpen(true)}
                className="btn-glossy-cta inline-flex items-center gap-1.5 px-3 h-9 rounded-md text-sm font-semibold"
                data-testid="btn-convert-to-project"
              >
                <FileSearch size={14} />
                Convert to Project
              </button>
            )}
          </div>
        </div>

        {/* Decision footer */}
        {pif.decidedAt && pif.decisionNote && (
          <div className="mt-4 pt-4 border-t border-border/60 flex items-start gap-2">
            <AlertCircle size={14} className="text-muted-foreground mt-0.5 shrink-0" />
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold">Decision note:</span> {pif.decisionNote}
            </p>
          </div>
        )}
      </div>

      {/* Main narrative */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Business problem" icon={<AlertCircle size={14} />}>
          <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{pif.businessProblem}</p>
        </Card>
        <Card title="Proposed solution" icon={<Sparkles size={14} />}>
          <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{pif.proposedSolution}</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Target outcomes" icon={<Target size={14} />}>
          <BulletList items={pif.targetOutcomes} />
        </Card>
        <Card title="Success metrics" icon={<ListChecks size={14} />}>
          <BulletList items={pif.successMetrics} />
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Dependencies" icon={<Link2 size={14} />}>
          <BulletList items={pif.dependencies} />
        </Card>
        <Card title="Top risks" icon={<ShieldAlert size={14} />}>
          <BulletList items={pif.topRisks} />
        </Card>
      </div>

      {/* Cost & timeline strip */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <Stat label="CapEx (₹)" value={pif.estimatedCapex ? Math.round(Number(pif.estimatedCapex)).toLocaleString("en-IN") : "—"} />
        <Stat label="OpEx (₹)" value={pif.estimatedOpex ? Math.round(Number(pif.estimatedOpex)).toLocaleString("en-IN") : "—"} />
        <Stat label="Duration" value={pif.estimatedDurationDays ? `${pif.estimatedDurationDays} days` : "—"} />
      </div>

      {/* Decide dialog */}
      <Dialog open={!!decideOpen} onOpenChange={(o) => !o && setDecideOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {decideOpen === "approve" ? "Approve PIF" : "Reject PIF"}
            </DialogTitle>
            <DialogDescription>
              {decideOpen === "approve"
                ? "After approval, the PIF can be converted to a project. You can attach a note that goes to the sponsor."
                : "Rejection freezes the PIF. Add a note so the sponsor knows what to change before drafting a fresh PIF."}
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Label htmlFor="decision-note">Note {decideOpen === "reject" ? "(strongly recommended)" : "(optional)"}</Label>
            <Textarea
              id="decision-note"
              rows={4}
              value={decisionNote}
              onChange={(e) => setDecisionNote(e.target.value)}
              placeholder={decideOpen === "approve" ? "Anything for the team to keep in mind…" : "What needs to change before resubmission?"}
            />
          </div>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setDecideOpen(null)}
              className="px-3 h-9 rounded-md text-[13px] text-muted-foreground hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => decideOpen && decide.mutate({ decision: decideOpen, note: decisionNote.trim() || undefined })}
              disabled={decide.isPending}
              className={`inline-flex items-center gap-1.5 px-4 h-9 rounded-md text-[13px] font-semibold ${
                decideOpen === "approve"
                  ? "btn-glossy-cta"
                  : "bg-destructive text-destructive-foreground hover:bg-destructive/90"
              } disabled:opacity-50`}
            >
              {decideOpen === "approve" ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
              {decide.isPending ? "Saving…" : decideOpen === "approve" ? "Approve" : "Reject"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Convert dialog */}
      <ConvertDialog
        open={convertOpen}
        onOpenChange={setConvertOpen}
        pifId={pifId}
        defaultName={pif.title}
        onSuccess={(projectId) => navigate(`/projects/${projectId}`)}
      />
    </div>
  );
}

// ─── Small atoms ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: PifStatus }) {
  const tone: Record<PifStatus, string> = {
    draft: "bg-muted/40 text-muted-foreground",
    submitted: "bg-primary/10 text-primary",
    under_review: "bg-primary/10 text-primary",
    approved: "bg-success/10 text-success",
    rejected: "bg-destructive/10 text-destructive",
    converted: "bg-accent text-accent-foreground",
  };
  return (
    <span className={`text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded ${tone[status]}`}>
      {status.replace("_", " ")}
    </span>
  );
}

function UrgencyBadge({ urgency }: { urgency: string }) {
  const tone =
    urgency === "critical" ? "bg-destructive/10 text-destructive" :
    urgency === "high" ? "bg-warn/10 text-warn" :
    urgency === "low" ? "bg-muted/40 text-muted-foreground" :
    "bg-primary/10 text-primary";
  return (
    <span className={`text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded ${tone}`}>{urgency}</span>
  );
}

function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="glass-surface lift-card ph-rise rounded-2xl p-5">
      <h3 className="flex items-center gap-2 text-sm font-semibold mb-3">
        {icon}
        {title}
      </h3>
      {children}
    </div>
  );
}

function BulletList({ items }: { items: string[] }) {
  if (!items?.length) return <p className="text-xs text-muted-foreground italic">None recorded.</p>;
  return (
    <ul className="space-y-1.5">
      {items.map((it, i) => (
        <li key={i} className="flex items-start gap-2 text-sm text-foreground">
          <span className="mt-1.5 inline-block w-1 h-1 rounded-full bg-primary/70 shrink-0" />
          <span className="leading-relaxed">{it}</span>
        </li>
      ))}
    </ul>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass-surface rounded-xl p-4">
      <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-xl font-mono font-semibold text-card-foreground num-tabular mt-1">{value}</p>
    </div>
  );
}

// ─── Convert-to-project dialog ───────────────────────────────────────────────

function ConvertDialog({
  open,
  onOpenChange,
  pifId,
  defaultName,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  pifId: number;
  defaultName: string;
  onSuccess: (projectId: number) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [projectName, setProjectName] = useState(defaultName);
  const [startDate, setStartDate] = useState(today);
  const [templateId, setTemplateId] = useState<string>("none");
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: templates } = useQuery({
    queryKey: ["templates"],
    queryFn: () => fetchJson<Template[]>("/api/templates"),
    enabled: open,
  });

  const convert = useMutation({
    mutationFn: () =>
      fetchJson<{ project: { id: number; name: string } }>(`/api/pifs/${pifId}/convert-to-project`, {
        method: "POST",
        body: JSON.stringify({
          projectName: projectName.trim(),
          startDate,
          templateId: templateId === "none" ? undefined : Number(templateId),
        }),
      }),
    onSuccess: (resp) => {
      qc.invalidateQueries({ queryKey: ["pifs"] });
      qc.invalidateQueries({ queryKey: ["pifs", pifId] });
      onOpenChange(false);
      toast({ title: "Project created", description: `“${resp.project.name}” spawned from PIF.` });
      onSuccess(resp.project.id);
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Couldn't convert", description: e.message }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convert PIF to project</DialogTitle>
          <DialogDescription>
            Creates a project + a charter shell pre-filled with the PIF narrative. Optionally pick a template to also
            populate tasks & milestones in one step.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label htmlFor="cv-name">Project name</Label>
            <Input id="cv-name" value={projectName} onChange={(e) => setProjectName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="cv-start">Start date</Label>
            <Input id="cv-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="cv-template">Template (optional)</Label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger id="cv-template"><SelectValue placeholder="No template — empty project" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— No template (empty project) —</SelectItem>
                {(templates ?? []).map((t) => (
                  <SelectItem key={t.id} value={String(t.id)}>
                    {t.name} <span className="text-muted-foreground">· {t.category}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="px-3 h-9 rounded-md text-[13px] text-muted-foreground hover:bg-accent"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => convert.mutate()}
            disabled={!projectName.trim() || convert.isPending}
            className="btn-glossy-cta inline-flex items-center gap-2 px-4 h-9 rounded-md text-[13px] font-semibold disabled:opacity-50"
          >
            <FileSearch size={14} />
            {convert.isPending ? "Creating project…" : "Create project"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
