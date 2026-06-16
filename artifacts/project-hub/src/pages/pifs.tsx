import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles, Inbox, CheckCircle2, XCircle, FileSearch, Clock, AlertCircle } from "lucide-react";
import { formatDate } from "../lib/format";
import { Drillable } from "../components/dashboard/primitives";

// ─── Types — mirror routes/pifs.ts ──────────────────────────────────────────
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
  convertedProjectId: number | null;
  convertedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type PifStatus = "draft" | "submitted" | "under_review" | "approved" | "rejected" | "converted";

const STATUS_BUCKETS: { key: PifStatus | "active"; label: string; statuses: PifStatus[]; tone: string }[] = [
  { key: "draft", label: "Drafts", statuses: ["draft"], tone: "muted" },
  { key: "active", label: "Awaiting HOD", statuses: ["submitted", "under_review"], tone: "primary" },
  { key: "approved", label: "Approved", statuses: ["approved"], tone: "success" },
  { key: "converted", label: "Converted", statuses: ["converted"], tone: "info" },
  { key: "rejected", label: "Rejected", statuses: ["rejected"], tone: "warn" },
];

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

export default function PifsList() {
  const { data: pifs, isLoading } = useQuery({
    queryKey: ["pifs"],
    queryFn: () => fetchJson<Pif[]>("/api/pifs"),
  });

  const byBucket = STATUS_BUCKETS.map((b) => ({
    ...b,
    items: (pifs ?? []).filter((p) => b.statuses.includes(p.status)),
  }));

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="relative rounded-2xl overflow-hidden ph-rise glass-surface">
        <div className="absolute inset-0 ambient-mesh opacity-70 pointer-events-none" />
        <div className="relative flex items-start justify-between flex-wrap gap-4 p-6 lg:p-8">
          <div className="min-w-0">
            <p className="text-[10px] font-mono tracking-[0.22em] uppercase text-muted-foreground mb-2">
              Pre-Charter Intake · Stage 0
            </p>
            <h2 className="text-3xl lg:text-4xl font-bold tracking-tight text-card-foreground">Project Initiation Forms</h2>
            <p className="text-sm text-muted-foreground mt-2 max-w-xl">
              The very first capture: problem, solution, sponsor, ballpark cost. One HOD signature and it converts to a real
              project — optionally pre-loaded from a template.
            </p>
          </div>
          <Link href="/pifs/new">
            <button className="btn-glossy-cta flex items-center gap-2 px-4 h-9 rounded-md text-[13px] font-semibold" data-testid="btn-new-pif">
              <Sparkles size={14} />
              New PIF
            </button>
          </Link>
        </div>
      </div>

      {/* ── Status tiles ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
        {byBucket.map((b) => (
          <Drillable
            key={b.key}
            className="glass-surface rounded-2xl p-4"
            drill={{
              title: b.label,
              subtitle: "Project Initiation Forms in this bucket",
              columns: [
                { key: "title", label: "PIF" },
                { key: "status", label: "Status", render: (v) => String(v ?? "—").replace(/_/g, " ") },
                { key: "classification", label: "Classification" },
                { key: "urgency", label: "Urgency" },
                { key: "created", label: "Created" },
              ],
              rows: b.items.map((p) => ({ title: p.title, status: p.status, classification: p.classification ?? "—", urgency: p.urgency ?? "—", created: p.createdAt ? formatDate(p.createdAt) : "—" })),
              linkHref: "/pifs",
              linkLabel: "View all PIFs",
              emptyText: "No PIFs in this bucket.",
            }}
          >
            <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">{b.label}</p>
            <p className="text-2xl font-mono font-semibold text-card-foreground num-tabular mt-1">{b.items.length}</p>
          </Drillable>
        ))}
      </div>

      {/* ── List ───────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-48 rounded-2xl" />
          ))}
        </div>
      ) : !pifs || pifs.length === 0 ? (
        <div className="glass-surface rounded-2xl p-12 text-center">
          <AlertCircle size={28} className="mx-auto text-muted-foreground mb-3" />
          <p className="text-base font-semibold text-card-foreground">No PIFs yet</p>
          <p className="text-sm text-muted-foreground mt-1 mb-4">
            Start the governance lifecycle by drafting your first Project Initiation Form.
          </p>
          <Link href="/pifs/new">
            <button className="btn-glossy-cta inline-flex items-center gap-2 px-4 h-9 rounded-md text-[13px] font-semibold">
              <Sparkles size={14} />
              New PIF
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
                  {b.items.map((p) => (
                    <PifCard key={p.id} pif={p} />
                  ))}
                </div>
              </section>
            ))}
        </div>
      )}
    </div>
  );
}

function PifCard({ pif }: { pif: Pif }) {
  return (
    <Link href={`/pifs/${pif.id}`}>
      <div className="glass-surface lift-card ph-rise rounded-2xl p-5 group cursor-pointer" data-testid={`pif-card-${pif.id}`}>
        <div className="flex items-start justify-between gap-3 mb-2">
          <span className="px-2 py-0.5 rounded bg-accent text-accent-foreground text-[10px] font-mono uppercase tracking-wider shrink-0">
            {pif.classification}
          </span>
          <UrgencyBadge urgency={pif.urgency} />
        </div>
        <h3 className="text-base font-semibold tracking-tight text-card-foreground line-clamp-1">{pif.title}</h3>
        <p className="text-xs text-muted-foreground mt-1 line-clamp-2 min-h-[2.25rem]">{pif.businessProblem}</p>
        <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between text-[11px] text-muted-foreground">
          <span className="font-mono">
            CapEx ₹{pif.estimatedCapex ? Math.round(Number(pif.estimatedCapex)).toLocaleString("en-IN") : "—"}
          </span>
          <span>Updated {formatDate(pif.updatedAt)}</span>
        </div>
      </div>
    </Link>
  );
}

function StatusIcon({ status }: { status: PifStatus }) {
  switch (status) {
    case "draft":
      return <Inbox size={14} />;
    case "submitted":
    case "under_review":
      return <Clock size={14} />;
    case "approved":
      return <CheckCircle2 size={14} className="text-success" />;
    case "converted":
      return <FileSearch size={14} className="text-primary" />;
    case "rejected":
      return <XCircle size={14} className="text-destructive" />;
  }
}

function UrgencyBadge({ urgency }: { urgency: string }) {
  const tone =
    urgency === "critical" ? "bg-destructive/10 text-destructive" :
    urgency === "high" ? "bg-warn/10 text-warn" :
    urgency === "low" ? "bg-muted/50 text-muted-foreground" :
    "bg-primary/10 text-primary";
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider shrink-0 ${tone}`}>
      {urgency}
    </span>
  );
}
