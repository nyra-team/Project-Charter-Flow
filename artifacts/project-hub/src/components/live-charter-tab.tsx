import { useMemo, type ReactElement } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ScrollText, RefreshCw, FileText, Loader2, AlertTriangle, Sparkles,
} from "lucide-react";
import { api } from "../lib/extra-api";
import { useListDocuments } from "@workspace/api-client-react";
import { getStageConfig } from "../lib/lifecycle-config";

// ---------------------------------------------------------------------------
// Live Project Charter tab.
//
// A read-only, regenerable executive view of a single project: the consolidated
// AI summary of every document in the project's space. The snapshot is cached
// server-side (one row per project); the Refresh button re-reads every
// document, re-summarizes the changed ones, and regenerates the narrative.
// ---------------------------------------------------------------------------

type DigestEntry = {
  docId: number;
  name: string;
  stage: string | null;
  tags: unknown;
  approvalStatus: string;
  summary: string | null;
};

type Snapshot = {
  exists: boolean;
  narrative?: string | null;
  docDigest?: DigestEntry[];
  generatedAt?: string;
  stale?: boolean;
};

type LiveDoc = {
  id: number;
  name: string;
  stage?: string | null;
  approvalStatus: string;
  version?: number;
  summaryVersion?: number | null;
};

function fmtWhen(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function asTags(tags: unknown): string[] {
  return Array.isArray(tags) ? tags.filter((t): t is string => typeof t === "string") : [];
}

// ---------------------------------------------------------------------------
// Minimal markdown renderer (headings, bullets, bold, paragraphs) — the
// project-hub doesn't ship a markdown lib and we don't want to add one for one
// surface. Handles exactly what the narrative prompt emits.
// ---------------------------------------------------------------------------
function renderInline(text: string, keyBase: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**")
      ? <strong key={`${keyBase}-${i}`} className="font-semibold text-foreground">{p.slice(2, -2)}</strong>
      : <span key={`${keyBase}-${i}`}>{p}</span>,
  );
}

function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: ReactElement[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) {
      blocks.push(
        <ul key={`ul-${blocks.length}`} className="my-2 ml-5 list-disc space-y-1 text-sm text-muted-foreground">
          {bullets.map((b, i) => <li key={i}>{renderInline(b, `li-${blocks.length}-${i}`)}</li>)}
        </ul>,
      );
      bullets = [];
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^###\s+/.test(line)) { flush(); blocks.push(<h4 key={`h-${blocks.length}`} className="mt-4 mb-1 text-sm font-semibold text-foreground">{line.replace(/^###\s+/, "")}</h4>); }
    else if (/^##\s+/.test(line)) { flush(); blocks.push(<h3 key={`h-${blocks.length}`} className="mt-5 mb-2 text-base font-semibold text-foreground">{line.replace(/^##\s+/, "")}</h3>); }
    else if (/^#\s+/.test(line)) { flush(); blocks.push(<h2 key={`h-${blocks.length}`} className="mt-5 mb-2 text-lg font-bold text-foreground">{line.replace(/^#\s+/, "")}</h2>); }
    else if (/^[-*]\s+/.test(line)) { bullets.push(line.replace(/^[-*]\s+/, "")); }
    else if (line.trim() === "") { flush(); }
    else { flush(); blocks.push(<p key={`p-${blocks.length}`} className="my-2 text-sm leading-relaxed text-muted-foreground">{renderInline(line, `p-${blocks.length}`)}</p>); }
  }
  flush();
  return <div>{blocks}</div>;
}

export function LiveCharterTab({ projectId }: { projectId: number; projectType?: string }) {
  const queryClient = useQueryClient();

  const snapQ = useQuery({
    queryKey: ["live-charter", projectId],
    queryFn: () => api.get<Snapshot>(`/api/ai/projects/${projectId}/live-charter`),
  });
  const docsQ = useListDocuments(projectId);
  const liveDocs = (docsQ.data ?? []) as LiveDoc[];

  const refresh = useMutation({
    mutationFn: () => api.post<Snapshot>(`/api/ai/projects/${projectId}/live-charter/refresh`),
    onSuccess: (data) => {
      queryClient.setQueryData(["live-charter", projectId], data);
    },
  });

  const snap = snapQ.data;
  const digest = snap?.docDigest ?? [];

  // docId → "summary is stale" (file re-uploaded since its summary was generated).
  const staleSummary = useMemo(() => {
    const s = new Set<number>();
    for (const d of liveDocs) {
      if (d.version != null && d.summaryVersion != null && d.summaryVersion !== d.version) s.add(d.id);
    }
    return s;
  }, [liveDocs]);

  const digestByStage = useMemo(() => {
    const grouped: Record<string, DigestEntry[]> = {};
    for (const d of digest) (grouped[d.stage || "unassigned"] ??= []).push(d);
    return grouped;
  }, [digest]);

  const refreshBtn = (
    <button
      onClick={() => refresh.mutate()}
      disabled={refresh.isPending}
      className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
    >
      {refresh.isPending
        ? <><Loader2 size={15} className="animate-spin" /> Generating…</>
        : <><RefreshCw size={15} /> {snap?.exists ? "Refresh" : "Generate Live Charter"}</>}
    </button>
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <ScrollText size={18} />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground">Live Project Charter</h2>
            <p className="text-xs text-muted-foreground">
              {snap?.exists ? <>AI summary as of {fmtWhen(snap.generatedAt)}</> : "Not generated yet"}
            </p>
          </div>
        </div>
        {refreshBtn}
      </div>

      {refresh.isError && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <AlertTriangle size={14} /> {(refresh.error as Error)?.message || "Failed to generate the Live Charter."}
        </div>
      )}

      {snapQ.isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={15} className="animate-spin" /> Loading…</div>
      )}

      {!snapQ.isLoading && !snap?.exists && (
        <div className="rounded-2xl border border-dashed border-border bg-card/50 p-10 text-center">
          <ScrollText size={28} className="mx-auto mb-3 text-muted-foreground/60" />
          <p className="text-sm font-medium text-foreground">No Live Charter yet</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
            Generate a consolidated, AI-written summary of every document in this project's space.
          </p>
          <div className="mt-4 flex justify-center">{refreshBtn}</div>
        </div>
      )}

      {snap?.exists && (
        <>
          {/* Consolidated narrative */}
          <section className="rounded-2xl border border-border bg-card p-5">
            <div className="mb-2 flex items-center gap-2">
              <Sparkles size={16} className="text-primary" />
              <h3 className="text-sm font-semibold text-foreground">Consolidated Summary</h3>
            </div>
            {snap.narrative
              ? <Markdown text={snap.narrative} />
              : <p className="text-sm text-muted-foreground">AI summary unavailable. Check that <code className="rounded bg-muted px-1 py-0.5 text-[11px]">ANTHROPIC_API_KEY</code> is set in the api-server's process env, then Refresh.</p>}
          </section>

          {/* Documents digest */}
          <section className="rounded-2xl border border-border bg-card p-5">
            <div className="mb-3 flex items-center gap-2">
              <FileText size={16} className="text-primary" />
              <h3 className="text-sm font-semibold text-foreground">Documents Digest</h3>
              <span className="text-xs text-muted-foreground">({digest.length})</span>
            </div>
            {digest.length === 0 && <p className="text-sm text-muted-foreground">No documents uploaded to this project yet.</p>}
            <div className="space-y-4">
              {Object.entries(digestByStage).map(([stage, entries]) => (
                <div key={stage}>
                  <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {getStageConfig(stage)?.label ?? (stage === "unassigned" ? "Unassigned" : stage)}
                  </h4>
                  <ul className="space-y-2">
                    {entries.map((d) => (
                      <li key={d.docId} className="rounded-lg border border-border/60 p-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-medium text-foreground">{d.name}</span>
                          <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${d.approvalStatus === "approved" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{d.approvalStatus}</span>
                          {asTags(d.tags).map((t) => (
                            <span key={t} className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">{t}</span>
                          ))}
                          {staleSummary.has(d.docId) && (
                            <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">summary outdated</span>
                          )}
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          {d.summary || <span className="italic text-muted-foreground/70">No readable text extracted — not summarized.</span>}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
