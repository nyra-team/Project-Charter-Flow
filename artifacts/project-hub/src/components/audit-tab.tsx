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
  project_created: { color: "#15803D", bg: "#ECFDF5" },
  task_created: { color: "#4338CA", bg: "#EEF2FF" },
  task_updated: { color: "#1E40AF", bg: "#EFF6FF" },
  task_overrun: { color: "#B91C1C", bg: "#FEE2E2" },
  milestone_created: { color: "#6D28D9", bg: "#F5F3FF" },
  timelog_added: { color: "#0E7490", bg: "#ECFEFF" },
  approval_decided: { color: "#B45309", bg: "#FFFBEB" },
  default: { color: "#64748B", bg: "#F1F5F9" },
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
      <div className="rounded-2xl p-5 flex items-center justify-between" style={{ background: "white", border: "1px solid #E2E8F0" }}>
        <div>
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <History size={16} className="text-indigo-500" /> Audit Trail
          </h3>
          <p className="text-xs text-gray-400 mt-0.5">{arr.length} events · auto-refresh every 60s</p>
        </div>
        <button onClick={exportCsv} className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-lg border border-gray-200 hover:bg-gray-50">
          <Download size={13} /> CSV
        </button>
      </div>

      {arr.length === 0 ? (
        <div className="rounded-2xl p-10 text-center text-sm text-gray-400" style={{ background: "white", border: "1px solid #E2E8F0" }}>
          No audit events recorded for this project yet.
        </div>
      ) : (
        <div className="rounded-2xl overflow-hidden" style={{ background: "white", border: "1px solid #E2E8F0" }}>
          <div className="max-h-[600px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead style={{ background: "#F8FAFC", position: "sticky", top: 0 }}>
                <tr>
                  <th className="text-left px-4 py-2 text-xs font-bold text-gray-500 uppercase">When</th>
                  <th className="text-left px-3 py-2 text-xs font-bold text-gray-500 uppercase">Type</th>
                  <th className="text-left px-3 py-2 text-xs font-bold text-gray-500 uppercase">Entity</th>
                  <th className="text-left px-4 py-2 text-xs font-bold text-gray-500 uppercase">User</th>
                  <th className="text-left px-4 py-2 text-xs font-bold text-gray-500 uppercase">Event</th>
                </tr>
              </thead>
              <tbody>
                {arr.map(e => {
                  const meta = TYPE_META[e.type] ?? TYPE_META.default;
                  return (
                    <tr key={e.id} className="border-t border-gray-100 hover:bg-indigo-50/20">
                      <td className="px-4 py-2 text-xs text-gray-500 whitespace-nowrap">{fmtTime(e.createdAt)}</td>
                      <td className="px-3 py-2">
                        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded" style={{ background: meta.bg, color: meta.color }}>
                          {e.type.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-600">{e.entityType} #{e.entityId}</td>
                      <td className="px-4 py-2 text-xs text-gray-700">{e.userName ?? "system"}</td>
                      <td className="px-4 py-2 text-xs text-gray-800">{e.message}</td>
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
