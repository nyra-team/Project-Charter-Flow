import { useMemo, useState } from "react";
import {
  useListRaci, useCreateRaciEntry, useDeleteRaciEntry,
  useListTasks, useListUsers,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { UserCheck, Download, AlertTriangle } from "lucide-react";

type Entry = { id: number; projectId: number; taskId?: number | null; workstreamId?: number | null; userId: number; raciType: string };

const RACI_OPTS = ["R", "A", "C", "I"] as const;
const RACI_META: Record<string, { color: string; bg: string; label: string }> = {
  R: { color: "#4338CA", bg: "#EEF2FF", label: "Responsible" },
  A: { color: "#15803D", bg: "#ECFDF5", label: "Accountable" },
  C: { color: "#B45309", bg: "#FFFBEB", label: "Consulted" },
  I: { color: "#64748B", bg: "#F1F5F9", label: "Informed" },
};

export function RaciTab({ projectId }: { projectId: number }) {
  const { toast } = useToast();
  const { data: raci = [], refetch } = useListRaci(projectId);
  const { data: tasks = [] } = useListTasks(projectId);
  const { data: users = [] } = useListUsers();
  const createEntry = useCreateRaciEntry();
  const deleteEntry = useDeleteRaciEntry();

  const entries = raci as Entry[];
  const tasksArr = tasks as Array<{ id: number; title: string }>;
  const usersArr = users as Array<{ id: number; name: string; department?: string }>;

  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);

  // Build cell map: tasks × users
  const cell = useMemo(() => {
    const m: Record<string, Entry | undefined> = {};
    for (const e of entries) {
      if (e.taskId) m[`${e.taskId}-${e.userId}`] = e;
    }
    return m;
  }, [entries]);

  // Default user columns: pull from users in raci + selected
  const userIds = useMemo(() => {
    const ids = new Set<number>(selectedUserIds);
    for (const e of entries) ids.add(e.userId);
    return Array.from(ids);
  }, [entries, selectedUserIds]);

  const cols = userIds.map(uid => usersArr.find(u => u.id === uid)).filter(Boolean) as Array<{ id: number; name: string; department?: string }>;

  // Over-allocation = user has > N "R" or "A" across tasks
  const responsibilityCount = useMemo(() => {
    const c: Record<number, { R: number; A: number }> = {};
    for (const e of entries) {
      if (!c[e.userId]) c[e.userId] = { R: 0, A: 0 };
      if (e.raciType === "R") c[e.userId].R++;
      if (e.raciType === "A") c[e.userId].A++;
    }
    return c;
  }, [entries]);
  const overThreshold = 5;

  function setCell(taskId: number, userId: number, type: string | "") {
    const existing = cell[`${taskId}-${userId}`];
    if (type === "") {
      if (existing) deleteEntry.mutate({ id: existing.id }, { onSuccess: () => refetch() });
      return;
    }
    if (existing) {
      // No PATCH endpoint; delete + recreate
      deleteEntry.mutate({ id: existing.id }, {
        onSuccess: () => createEntry.mutate({ id: projectId, data: { taskId, userId, raciType: type } }, { onSuccess: () => refetch() }),
      });
    } else {
      createEntry.mutate({ id: projectId, data: { taskId, userId, raciType: type } }, { onSuccess: () => refetch() });
    }
  }

  function exportCsv() {
    const headers = ["Task", ...cols.map(u => u.name)];
    const rows = tasksArr.map(t => {
      const cells = cols.map(u => cell[`${t.id}-${u.id}`]?.raciType ?? "");
      return [t.title, ...cells];
    });
    const csv = [headers, ...rows]
      .map(row => row.map(c => `"${(c ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `raci-project-${projectId}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast({ title: "RACI matrix exported (CSV)" });
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl p-5 flex items-center justify-between flex-wrap gap-3" style={{ background: "white", border: "1px solid #E2E8F0" }}>
        <div>
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <UserCheck size={16} className="text-indigo-500" /> RACI Matrix
          </h3>
          <p className="text-xs text-gray-400 mt-0.5">{tasksArr.length} tasks × {cols.length} member{cols.length !== 1 ? "s" : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value=""
            onChange={e => {
              const id = parseInt(e.target.value);
              if (id && !selectedUserIds.includes(id)) setSelectedUserIds([...selectedUserIds, id]);
            }}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2"
          >
            <option value="">+ Add member column…</option>
            {usersArr.filter(u => !userIds.includes(u.id)).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <button onClick={exportCsv} className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-lg border border-gray-200 hover:bg-gray-50">
            <Download size={13} /> CSV
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="rounded-2xl p-3 flex items-center gap-3 flex-wrap" style={{ background: "white", border: "1px solid #E2E8F0" }}>
        <span className="text-xs font-semibold text-gray-500">LEGEND:</span>
        {RACI_OPTS.map(k => (
          <span key={k} className="text-xs flex items-center gap-1.5">
            <span className="w-5 h-5 rounded text-[10px] font-bold flex items-center justify-center" style={{ background: RACI_META[k].bg, color: RACI_META[k].color }}>{k}</span>
            {RACI_META[k].label}
          </span>
        ))}
      </div>

      {tasksArr.length === 0 || cols.length === 0 ? (
        <div className="rounded-2xl p-10 text-center text-sm text-gray-400" style={{ background: "white", border: "1px solid #E2E8F0" }}>
          {tasksArr.length === 0 ? "No tasks in this project yet." : "Add member columns to start assigning RACI."}
        </div>
      ) : (
        <div className="rounded-2xl overflow-hidden" style={{ background: "white", border: "1px solid #E2E8F0" }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead style={{ background: "#F8FAFC" }}>
                <tr>
                  <th className="text-left px-4 py-2 text-xs font-bold text-gray-500 uppercase sticky left-0 z-10" style={{ background: "#F8FAFC" }}>Task</th>
                  {cols.map(u => {
                    const cnt = responsibilityCount[u.id] ?? { R: 0, A: 0 };
                    const over = cnt.R + cnt.A > overThreshold;
                    return (
                      <th key={u.id} className="text-center px-2 py-2 text-xs font-bold text-gray-500 uppercase">
                        <div className="flex flex-col items-center">
                          <span>{u.name.split(" ").map(p => p[0]).join("")}</span>
                          <span className="text-[10px] font-normal normal-case text-gray-400 truncate max-w-[80px]">{u.name}</span>
                          {over && <span title="Over-allocated (R+A > 5)"><AlertTriangle size={10} className="text-orange-500 mt-0.5" /></span>}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {tasksArr.map(t => (
                  <tr key={t.id} className="border-t border-gray-100">
                    <td className="px-4 py-2 text-sm text-gray-700 sticky left-0 bg-white max-w-xs truncate" style={{ background: "white" }}>{t.title}</td>
                    {cols.map(u => {
                      const v = cell[`${t.id}-${u.id}`]?.raciType ?? "";
                      const m = v ? RACI_META[v] : null;
                      return (
                        <td key={u.id} className="px-1 py-1 text-center">
                          <select
                            value={v}
                            onChange={e => setCell(t.id, u.id, e.target.value)}
                            className="w-12 h-7 text-xs font-bold rounded text-center border"
                            style={{
                              background: m?.bg ?? "white",
                              color: m?.color ?? "#94A3B8",
                              borderColor: m?.color ? `${m.color}33` : "#E2E8F0",
                            }}
                          >
                            <option value="">—</option>
                            {RACI_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
                          </select>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
