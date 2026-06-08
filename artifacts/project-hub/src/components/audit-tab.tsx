import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { History, Download, Sparkles, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { api } from "../lib/extra-api";
import { useAiStatus } from "./ai-button";

type RcaResult = {
  summary: string;
  timeline_signals: string[];
  root_causes: Array<{ cause: string; evidence: string }>;
  contributing_factors: string[];
  corrective_actions: Array<{ action: string; owner_hint?: string; priority: "P0" | "P1" | "P2" | "P3" }>;
  risk_outlook: "green" | "amber" | "red";
  eventsAnalyzed: number;
};

const PRIORITY_PILL: Record<string, string> = {
  P0: "bg-destructive/15 text-destructive border-destructive/30",
  P1: "bg-warn/15 text-warn border-warn/30",
  P2: "bg-warn/10 text-warn border-warn/20",
  P3: "bg-success/10 text-success border-success/20",
};

const OUTLOOK_PILL: Record<string, string> = {
  green: "bg-success/15 text-success border-success/30",
  amber: "bg-warn/15 text-warn border-warn/30",
  red:   "bg-destructive/15 text-destructive border-destructive/30",
};

type AuditEntry = {
  id: number; type: string; message: string;
  entityId: number; entityType: string;
  userId?: number | null; userName?: string | null;
  createdAt: string;
};

const TYPE_META: Record<string, { color: string; bg: string }> = {
  project_created: { color: "hsl(var(--success))", bg: "hsl(var(--success) / 0.10)" },
  task_created: { color: "hsl(var(--primary))", bg: "hsl(var(--primary) / 0.10)" },
  task_updated: { color: "hsl(var(--primary))", bg: "hsl(var(--primary) / 0.10)" },
  task_overrun: { color: "hsl(var(--destructive))", bg: "hsl(var(--destructive) / 0.10)" },
  milestone_created: { color: "hsl(var(--primary))", bg: "hsl(var(--primary) / 0.10)" },
  timelog_added: { color: "hsl(var(--primary))", bg: "hsl(var(--primary) / 0.10)" },
  approval_decided: { color: "hsl(var(--warn))", bg: "hsl(var(--warn) / 0.10)" },
  default: { color: "hsl(var(--muted-foreground))", bg: "hsl(var(--border))" },
};

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function AuditTab({ projectId }: { projectId: number }) {
  const { data: entries = [] } = useQuery({
    queryKey: ["/api/projects", projectId, "audit"],
    queryFn: () => customFetch<AuditEntry[]>(`/api/projects/${projectId}/audit`),
    refetchInterval: 60000,
  });

  const arr = entries as AuditEntry[];

  const aiStatus = useAiStatus();
  const [rcaLoading, setRcaLoading] = useState(false);
  const [rcaError, setRcaError] = useState<string | null>(null);
  const [rca, setRca] = useState<RcaResult | null>(null);

  async function runRca() {
    setRcaLoading(true); setRcaError(null); setRca(null);
    try {
      const data = await api.post<RcaResult>(`/api/ai/projects/${projectId}/audit-rca`, {});
      setRca(data);
    } catch (e: unknown) {
      const msg = (e as Error & { body?: { error?: string } })?.body?.error ?? (e as Error)?.message ?? "RCA failed";
      setRcaError(msg);
    } finally { setRcaLoading(false); }
  }

  const aiDisabled = rcaLoading || arr.length === 0 || (aiStatus != null && !aiStatus.configured);
  const aiTitle = aiStatus && !aiStatus.configured
    ? "Add ANTHROPIC_API_KEY in Tools → Secrets to enable"
    : arr.length === 0 ? "No audit events to analyze yet" : undefined;

  function exportCsv() {
    const headers = ["Timestamp", "Type", "Entity", "Entity ID", "User", "Message"];
    const rows = arr.map(e => [fmtTime(e.createdAt), e.type, e.entityType, e.entityId, e.userName ?? "—", e.message]);
    const csv = [headers, ...rows]
      .map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `audit-project-${projectId}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="glass-surface lift-card ph-rise rounded-2xl p-5 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="font-semibold text-foreground flex items-center gap-2">
            <History size={16} className="text-primary" /> Audit Trail
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">{arr.length} events · auto-refresh every 60s</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void runRca()}
            disabled={aiDisabled}
            title={aiTitle}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {rcaLoading ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            Run RCA
          </button>
          <button onClick={exportCsv} className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-lg border border-border hover:bg-muted/40">
            <Download size={13} /> CSV
          </button>
        </div>
      </div>

      {(rcaLoading || rcaError || rca) && (
        <div className="glass-surface lift-card ph-rise rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-primary">
              <Sparkles size={12} /> AI Root Cause Analysis
              {rca && <span className="text-muted-foreground font-normal normal-case tracking-normal">· {rca.eventsAnalyzed} events analyzed</span>}
            </div>
            {rca && (
              <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider border ${OUTLOOK_PILL[rca.risk_outlook] ?? ""}`}>
                Outlook: {rca.risk_outlook}
              </span>
            )}
          </div>
          {rcaLoading && <div className="text-xs text-primary flex items-center gap-1.5"><Loader2 size={11} className="animate-spin" /> Analyzing audit trail…</div>}
          {rcaError && <div className="text-xs text-destructive flex items-start gap-1.5"><AlertTriangle size={12} className="mt-0.5 shrink-0" /> {rcaError}</div>}
          {rca && (
            <div className="space-y-3 text-sm">
              <p className="text-foreground leading-relaxed">{rca.summary}</p>

              {rca.root_causes.length > 0 && (
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Root Causes</div>
                  <ul className="space-y-1.5">
                    {rca.root_causes.map((rc, i) => (
                      <li key={i} className="rounded-md border border-border/60 bg-muted/40 p-2.5">
                        <div className="font-semibold text-foreground text-xs">{rc.cause}</div>
                        <div className="text-[11px] text-muted-foreground mt-1 font-mono">{rc.evidence}</div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {rca.contributing_factors.length > 0 && (
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Contributing Factors</div>
                  <ul className="text-xs text-foreground list-disc list-inside space-y-0.5">
                    {rca.contributing_factors.map((f, i) => <li key={i}>{f}</li>)}
                  </ul>
                </div>
              )}

              {rca.timeline_signals.length > 0 && (
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Timeline Signals</div>
                  <ul className="text-xs text-muted-foreground list-disc list-inside space-y-0.5 font-mono">
                    {rca.timeline_signals.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                </div>
              )}

              {rca.corrective_actions.length > 0 && (
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1"><CheckCircle2 size={11} /> Corrective Actions</div>
                  <ul className="space-y-1.5">
                    {rca.corrective_actions.map((a, i) => (
                      <li key={i} className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/40 p-2.5">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider border whitespace-nowrap ${PRIORITY_PILL[a.priority] ?? ""}`}>{a.priority}</span>
                        <div className="text-xs text-foreground flex-1 min-w-0">
                          <div>{a.action}</div>
                          {a.owner_hint && <div className="text-[11px] text-muted-foreground mt-0.5 font-mono">→ {a.owner_hint}</div>}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {arr.length === 0 ? (
        <div className="glass-surface lift-card ph-rise rounded-2xl p-10 text-center text-sm text-muted-foreground">
          No audit events recorded for this project yet.
        </div>
      ) : (
        <div className="glass-surface lift-card ph-rise rounded-2xl overflow-hidden">
          <div className="max-h-[600px] overflow-y-auto overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead style={{ background: "hsl(var(--muted) / 0.40)", position: "sticky", top: 0 }}>
                <tr>
                  <th className="text-left px-4 py-2 text-xs font-bold text-muted-foreground uppercase">When</th>
                  <th className="text-left px-3 py-2 text-xs font-bold text-muted-foreground uppercase">Type</th>
                  <th className="text-left px-3 py-2 text-xs font-bold text-muted-foreground uppercase">Entity</th>
                  <th className="text-left px-4 py-2 text-xs font-bold text-muted-foreground uppercase">User</th>
                  <th className="text-left px-4 py-2 text-xs font-bold text-muted-foreground uppercase">Event</th>
                </tr>
              </thead>
              <tbody>
                {arr.map(e => {
                  const meta = TYPE_META[e.type] ?? TYPE_META.default;
                  return (
                    <tr key={e.id} className="border-t border-border/60 hover:bg-primary/10/20">
                      <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">{fmtTime(e.createdAt)}</td>
                      <td className="px-3 py-2">
                        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded" style={{ background: meta.bg, color: meta.color }}>
                          {e.type.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-foreground">{e.entityType} #{e.entityId}</td>
                      <td className="px-4 py-2 text-xs text-foreground">{e.userName ?? "system"}</td>
                      <td className="px-4 py-2 text-xs text-foreground">{e.message}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
