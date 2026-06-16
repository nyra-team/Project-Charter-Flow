import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useRoute } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChevronLeft, Download, Send, Trash2, CheckCircle2, XCircle, Circle,
  FileText, Building2, Calendar, ExternalLink,
} from "lucide-react";
import { formatDate } from "../lib/format";

// ─── Types — mirror routes/nfas.ts ──────────────────────────────────────────
type SigStatus = "pending" | "approved" | "rejected";
type Signatory = { role: string; name: string; empCode?: string; status: SigStatus; comment?: string; decidedAt?: string };
type RequirementItem = { item: string; details: string };
type NfaStatus = "draft" | "pending_approval" | "approved" | "rejected";

type Nfa = {
  id: number;
  noteNo: string;
  projectId: number | null;
  department: string;
  location: string;
  locationRequired: string;
  noteDate: string | null;
  subject: string;
  background: string;
  requirementItems: RequirementItem[];
  orderFormNote: string;
  totalUsd: string;
  totalInr: string;
  recommendation: string;
  signatories: Signatory[];
  status: NfaStatus;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
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

const STATUS_LABEL: Record<NfaStatus, { text: string; cls: string }> = {
  draft: { text: "Draft", cls: "bg-muted/60 text-muted-foreground" },
  pending_approval: { text: "Awaiting approval", cls: "bg-primary/10 text-primary" },
  approved: { text: "Approved", cls: "bg-success/10 text-success" },
  rejected: { text: "Rejected", cls: "bg-destructive/10 text-destructive" },
};

export default function NfaDetail() {
  const [, params] = useRoute("/nfas/:id");
  const nfaId = params?.id;
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();

  const { data: nfa, isLoading } = useQuery({
    queryKey: ["nfas", nfaId],
    queryFn: () => fetchJson<Nfa>(`/api/nfas/${nfaId}`),
    enabled: !!nfaId,
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["nfas"] });
    qc.invalidateQueries({ queryKey: ["nfas", nfaId] });
  }

  const submit = useMutation({
    mutationFn: () => fetchJson<Nfa>(`/api/nfas/${nfaId}/submit`, { method: "POST", body: "{}" }),
    onSuccess: () => { invalidate(); toast({ title: "Submitted for approval" }); },
    onError: (e: Error) => toast({ variant: "destructive", title: "Couldn't submit", description: e.message }),
  });

  const decide = useMutation({
    mutationFn: (body: { signatoryIndex: number; decision: "approve" | "reject"; comment?: string }) =>
      fetchJson<Nfa>(`/api/nfas/${nfaId}/decide`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => { invalidate(); toast({ title: "Decision recorded" }); },
    onError: (e: Error) => toast({ variant: "destructive", title: "Couldn't record decision", description: e.message }),
  });

  const remove = useMutation({
    mutationFn: () => fetchJson<{ success: boolean }>(`/api/nfas/${nfaId}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["nfas"] }); toast({ title: "NFA deleted" }); navigate("/nfas"); },
    onError: (e: Error) => toast({ variant: "destructive", title: "Couldn't delete", description: e.message }),
  });

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-12 w-64 rounded-xl" /><Skeleton className="h-96 rounded-2xl" /></div>;
  if (!nfa) return <div className="glass-surface rounded-2xl p-12 text-center text-muted-foreground">NFA not found.</div>;

  const badge = STATUS_LABEL[nfa.status];
  const approvedCount = nfa.signatories.filter((s) => s.status === "approved").length;

  return (
    <div className="space-y-6 pb-10">
      <button
        onClick={() => navigate("/nfas")}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft size={14} />
        Back to NFAs
      </button>

      {/* Header */}
      <div className="glass-surface rounded-2xl p-6 lg:p-8">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2 py-0.5 rounded bg-accent text-accent-foreground text-[10px] font-mono uppercase tracking-wider">No. {nfa.noteNo}</span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider ${badge.cls}`}>{badge.text}</span>
              <span className="text-[11px] font-mono text-muted-foreground">{approvedCount}/{nfa.signatories.length} signed</span>
            </div>
            <h1 className="text-2xl lg:text-3xl font-bold tracking-tight text-foreground">{nfa.subject || "(untitled note)"}</h1>
            <div className="flex items-center flex-wrap gap-x-5 gap-y-1 mt-3 text-xs text-muted-foreground">
              {nfa.department && <span className="inline-flex items-center gap-1"><Building2 size={12} />{nfa.department}</span>}
              {nfa.noteDate && <span className="inline-flex items-center gap-1"><Calendar size={12} />{nfa.noteDate}</span>}
              {nfa.projectId && (
                <Link href={`/projects/${nfa.projectId}`}>
                  <span className="inline-flex items-center gap-1 text-primary hover:underline cursor-pointer"><ExternalLink size={12} />Linked project</span>
                </Link>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a href={`/api/nfas/${nfa.id}/docx`}>
              <button className="inline-flex items-center gap-2 px-3 h-9 rounded-md text-[13px] font-semibold border border-border hover:bg-accent">
                <Download size={14} />
                Export .docx
              </button>
            </a>
            {nfa.status === "draft" && (
              <>
                <button
                  onClick={() => submit.mutate()}
                  disabled={submit.isPending}
                  className="btn-glossy-cta inline-flex items-center gap-2 px-3 h-9 rounded-md text-[13px] font-semibold disabled:opacity-50"
                  data-testid="btn-submit-nfa"
                >
                  <Send size={14} />
                  {submit.isPending ? "Submitting…" : "Submit for approval"}
                </button>
                <button
                  onClick={() => { if (confirm("Delete this draft NFA?")) remove.mutate(); }}
                  disabled={remove.isPending}
                  className="inline-flex items-center justify-center w-9 h-9 rounded-md border border-border text-muted-foreground hover:text-destructive hover:border-destructive/50"
                  aria-label="Delete draft"
                >
                  <Trash2 size={14} />
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left — the note body */}
        <div className="lg:col-span-2 space-y-6">
          {nfa.background && (
            <Section title="Background"><p className="text-sm text-foreground/90 whitespace-pre-wrap">{nfa.background}</p></Section>
          )}

          {nfa.requirementItems.length > 0 && (
            <Section title="Requirement / details">
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full min-w-[400px] text-sm">
                  <thead><tr className="bg-muted/50 text-left text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                    <th className="px-3 py-2 font-semibold">Item</th><th className="px-3 py-2 font-semibold">Details</th>
                  </tr></thead>
                  <tbody>
                    {nfa.requirementItems.map((r, i) => (
                      <tr key={i} className="border-t border-border/60">
                        <td className="px-3 py-2 font-medium text-foreground align-top w-1/3">{r.item}</td>
                        <td className="px-3 py-2 text-foreground/80">{r.details}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {nfa.orderFormNote && <p className="text-xs text-muted-foreground mt-3 whitespace-pre-wrap">{nfa.orderFormNote}</p>}
              {(nfa.totalInr || nfa.totalUsd) && (
                <p className="mt-4 text-sm font-semibold text-foreground">
                  Total costing = <span className="text-primary font-mono">{[nfa.totalUsd, nfa.totalInr].filter(Boolean).join("  /  ")}</span>
                </p>
              )}
            </Section>
          )}

          {nfa.recommendation && (
            <Section title="Recommendation"><p className="text-sm text-foreground/90 whitespace-pre-wrap">{nfa.recommendation}</p></Section>
          )}
          {((nfa as unknown as { customFields?: { id: string; label: string; value: string }[] }).customFields ?? [])
            .filter((f) => f && (f.label?.trim() || f.value?.trim()))
            .map((f) => (
              <Section key={f.id} title={f.label || "Additional Field"}>
                <p className="text-sm text-foreground/90 whitespace-pre-wrap">{f.value}</p>
              </Section>
            ))}
        </div>

        {/* Right — approval grid */}
        <div className="space-y-6">
          <Section title="Approval grid">
            {nfa.status === "draft" && (
              <p className="text-xs text-muted-foreground mb-3">Submit the note to open these steps for sign-off.</p>
            )}
            <div className="space-y-2">
              {nfa.signatories.map((s, i) => (
                <div key={i} className="bg-card rounded-xl px-3 py-2.5 border border-border">
                  <div className="flex items-center gap-2.5">
                    <SigIcon status={s.status} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">{s.role}</p>
                      <p className="text-sm font-semibold text-foreground truncate">{s.name || "—"}{s.empCode ? ` · ${s.empCode}` : ""}</p>
                      {s.decidedAt && <p className="text-[10px] text-muted-foreground font-mono">{s.status} · {formatDate(s.decidedAt)}</p>}
                    </div>
                  </div>
                  {nfa.status === "pending_approval" && s.status === "pending" && (
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={() => decide.mutate({ signatoryIndex: i, decision: "approve" })}
                        disabled={decide.isPending}
                        className="flex-1 text-[11px] font-semibold text-success-foreground px-2 py-1.5 rounded-md bg-success hover:opacity-90 disabled:opacity-40"
                      >Approve</button>
                      <button
                        onClick={() => { const c = prompt("Reason for rejection (optional):") ?? undefined; decide.mutate({ signatoryIndex: i, decision: "reject", comment: c }); }}
                        disabled={decide.isPending}
                        className="flex-1 text-[11px] font-semibold text-destructive-foreground px-2 py-1.5 rounded-md bg-destructive hover:opacity-90 disabled:opacity-40"
                      >Reject</button>
                    </div>
                  )}
                  {s.comment && <p className="text-[11px] text-muted-foreground mt-1.5 italic">“{s.comment}”</p>}
                </div>
              ))}
              {nfa.signatories.length === 0 && <p className="text-xs text-muted-foreground">No signatories on this note.</p>}
            </div>
          </Section>

          <div className="glass-surface rounded-2xl p-4 text-[11px] text-muted-foreground space-y-1">
            <p className="flex items-center gap-1.5"><FileText size={12} />Created by {nfa.createdByName || "—"}</p>
            <p>Created {formatDate(nfa.createdAt)} · Updated {formatDate(nfa.updatedAt)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="glass-surface rounded-2xl p-6">
      <h3 className="text-sm font-semibold text-foreground tracking-tight mb-4">{title}</h3>
      {children}
    </div>
  );
}

function SigIcon({ status }: { status: SigStatus }) {
  if (status === "approved") return <CheckCircle2 size={16} className="text-success shrink-0" />;
  if (status === "rejected") return <XCircle size={16} className="text-destructive shrink-0" />;
  return <Circle size={16} className="text-muted-foreground shrink-0" />;
}
