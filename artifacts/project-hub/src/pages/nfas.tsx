import { useQuery } from "@tanstack/react-query";
import { Link, useSearch } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles, Inbox, CheckCircle2, XCircle, Clock, AlertCircle } from "lucide-react";
import { formatDate } from "../lib/format";

// ─── Types — mirror routes/nfas.ts ──────────────────────────────────────────
type NfaStatus = "draft" | "pending_approval" | "approved" | "rejected";
type Signatory = { role: string; name: string; status: "pending" | "approved" | "rejected" };

type Nfa = {
  id: number;
  noteNo: string;
  projectId: number | null;
  department: string;
  subject: string;
  totalInr: string;
  totalUsd: string;
  signatories: Signatory[];
  status: NfaStatus;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
};

const STATUS_BUCKETS: { key: NfaStatus; label: string; statuses: NfaStatus[] }[] = [
  { key: "draft", label: "Drafts", statuses: ["draft"] },
  { key: "pending_approval", label: "Awaiting Approval", statuses: ["pending_approval"] },
  { key: "approved", label: "Approved", statuses: ["approved"] },
  { key: "rejected", label: "Rejected", statuses: ["rejected"] },
];

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

export default function NfasList() {
  // Optional ?projectId= filter (deep-link from a project).
  const search = useSearch();
  const projectId = new URLSearchParams(search).get("projectId");
  const listUrl = projectId ? `/api/nfas?projectId=${projectId}` : "/api/nfas";

  const { data: nfas, isLoading } = useQuery({
    queryKey: ["nfas", projectId ?? "all"],
    queryFn: () => fetchJson<Nfa[]>(listUrl),
  });

  const byBucket = STATUS_BUCKETS.map((b) => ({
    ...b,
    items: (nfas ?? []).filter((n) => b.statuses.includes(n.status)),
  }));

  const newHref = projectId ? `/nfas/new?projectId=${projectId}` : "/nfas/new";

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="relative rounded-2xl overflow-hidden ph-rise glass-surface">
        <div className="absolute inset-0 ambient-mesh opacity-70 pointer-events-none" />
        <div className="relative flex items-start justify-between flex-wrap gap-4 p-6 lg:p-8">
          <div className="min-w-0">
            <p className="text-[10px] font-mono tracking-[0.22em] uppercase text-muted-foreground mb-2">
              Internal Approval Note · Finance Gate
            </p>
            <h2 className="text-3xl lg:text-4xl font-bold tracking-tight text-card-foreground">Notes for Approval</h2>
            <p className="text-sm text-muted-foreground mt-2 max-w-xl">
              Structured spend-approval notes routed through a signatory grid. Draft it (with AI if you like), collect
              sign-offs, and export the formatted .docx.
              {projectId && <span className="ml-1 text-primary font-medium">Filtered to one project.</span>}
            </p>
          </div>
          <Link href={newHref}>
            <button className="btn-glossy-cta flex items-center gap-2 px-4 h-9 rounded-md text-[13px] font-semibold" data-testid="btn-new-nfa">
              <Sparkles size={14} />
              New NFA
            </button>
          </Link>
        </div>
      </div>

      {/* ── Status tiles ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {byBucket.map((b) => (
          <div key={b.key} className="glass-surface rounded-2xl p-4">
            <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">{b.label}</p>
            <p className="text-2xl font-mono font-semibold text-card-foreground num-tabular mt-1">{b.items.length}</p>
          </div>
        ))}
      </div>

      {/* ── List ───────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-40 rounded-2xl" />
          ))}
        </div>
      ) : !nfas || nfas.length === 0 ? (
        <div className="glass-surface rounded-2xl p-12 text-center">
          <AlertCircle size={28} className="mx-auto text-muted-foreground mb-3" />
          <p className="text-base font-semibold text-card-foreground">No NFAs yet</p>
          <p className="text-sm text-muted-foreground mt-1 mb-4">
            Draft your first Note for Approval to route a spend request through the signatory grid.
          </p>
          <Link href={newHref}>
            <button className="btn-glossy-cta inline-flex items-center gap-2 px-4 h-9 rounded-md text-[13px] font-semibold">
              <Sparkles size={14} />
              New NFA
            </button>
          </Link>
        </div>
      ) : (
        <div className="space-y-8">
          {byBucket
            .filter((b) => b.items.length > 0)
            .map((b) => (
              <section key={b.key}>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground mb-3">
                  <StatusIcon status={b.statuses[0]} />
                  {b.label} · {b.items.length}
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {b.items.map((n) => (
                    <NfaCard key={n.id} nfa={n} />
                  ))}
                </div>
              </section>
            ))}
        </div>
      )}
    </div>
  );
}

function NfaCard({ nfa }: { nfa: Nfa }) {
  const approved = nfa.signatories?.filter((s) => s.status === "approved").length ?? 0;
  const total = nfa.signatories?.length ?? 0;
  return (
    <Link href={`/nfas/${nfa.id}`}>
      <div className="glass-surface lift-card ph-rise rounded-2xl p-5 group cursor-pointer" data-testid={`nfa-card-${nfa.id}`}>
        <div className="flex items-start justify-between gap-3 mb-2">
          <span className="px-2 py-0.5 rounded bg-accent text-accent-foreground text-[10px] font-mono uppercase tracking-wider shrink-0">
            No. {nfa.noteNo}
          </span>
          <span className="text-[10px] font-mono text-muted-foreground">{approved}/{total} signed</span>
        </div>
        <h3 className="text-base font-semibold tracking-tight text-card-foreground line-clamp-2 min-h-[2.5rem]">
          {nfa.subject || "(untitled note)"}
        </h3>
        <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between text-[11px] text-muted-foreground">
          <span className="font-mono">{nfa.totalInr || nfa.totalUsd || nfa.department || "—"}</span>
          <span>Updated {formatDate(nfa.updatedAt)}</span>
        </div>
      </div>
    </Link>
  );
}

function StatusIcon({ status }: { status: NfaStatus }) {
  switch (status) {
    case "draft":
      return <Inbox size={14} />;
    case "pending_approval":
      return <Clock size={14} />;
    case "approved":
      return <CheckCircle2 size={14} className="text-success" />;
    case "rejected":
      return <XCircle size={14} className="text-destructive" />;
  }
}
