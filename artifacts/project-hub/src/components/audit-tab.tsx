import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { History, Download } from "lucide-react";

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
      <div className="glass-surface lift-card ph-rise rounded-2xl p-5 flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-foreground flex items-center gap-2">
            <History size={16} className="text-primary" /> Audit Trail
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">{arr.length} events · auto-refresh every 60s</p>
        </div>
        <button onClick={exportCsv} className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-lg border border-border hover:bg-muted/40">
          <Download size={13} /> CSV
        </button>
      </div>

      {arr.length === 0 ? (
        <div className="glass-surface lift-card ph-rise rounded-2xl p-10 text-center text-sm text-muted-foreground">
          No audit events recorded for this project yet.
        </div>
      ) : (
        <div className="glass-surface lift-card ph-rise rounded-2xl overflow-hidden">
          <div className="max-h-[600px] overflow-y-auto">
            <table className="w-full text-sm">
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
