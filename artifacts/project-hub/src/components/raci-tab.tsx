import { useMemo, useState } from "react";
import {
  useListRaci, useCreateRaciEntry, useDeleteRaciEntry,
  useListTasks, useListUsers,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { UserCheck, Download, AlertTriangle } from "lucide-react";

type Entry = { id: number; projectId: number; taskId?: number | null; workstreamId?: number | null; userId: number; raciType: string };

// RASCI: Responsible, Accountable, Support, Consulted, Informed. "Support" (S)
// is the assist role the org governance asked for; "Consulted" (C) is kept —
// they are distinct concepts (S does part of the work; C is asked for input).
const RACI_OPTS = ["R", "A", "S", "C", "I"] as const;
const RACI_META: Record<string, { color: string; bg: string; label: string }> = {
  R: { color: "hsl(var(--primary))", bg: "hsl(var(--primary) / 0.10)", label: "Responsible" },
  A: { color: "hsl(var(--success))", bg: "hsl(var(--success) / 0.10)", label: "Accountable" },
  S: { color: "#0d9488", bg: "rgba(13,148,136,0.10)", label: "Support" },
  C: { color: "hsl(var(--warn))", bg: "hsl(var(--warn) / 0.10)", label: "Consulted" },
  I: { color: "hsl(var(--muted-foreground))", bg: "hsl(var(--border))", label: "Informed" },
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
      <div className="glass-surface lift-card ph-rise rounded-2xl p-5 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="font-semibold text-foreground flex items-center gap-2">
            <UserCheck size={16} className="text-primary" /> RACI Matrix
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">{tasksArr.length} tasks × {cols.length} member{cols.length !== 1 ? "s" : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value=""
            onChange={e => {
              const id = parseInt(e.target.value);
              if (id && !selectedUserIds.includes(id)) setSelectedUserIds([...selectedUserIds, id]);
            }}
            className="text-sm border border-border rounded-lg px-3 py-2"
          >
            <option value="">+ Add member column…</option>
            {usersArr.filter(u => !userIds.includes(u.id)).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <button onClick={exportCsv} className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-lg border border-border hover:bg-muted/40">
            <Download size={13} /> CSV
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="glass-surface lift-card ph-rise rounded-2xl p-3 flex items-center gap-3 flex-wrap">
        <span className="text-xs font-semibold text-muted-foreground">LEGEND:</span>
        {RACI_OPTS.map(k => (
          <span key={k} className="text-xs flex items-center gap-1.5">
            <span className="w-5 h-5 rounded text-[10px] font-bold flex items-center justify-center" style={{ background: RACI_META[k].bg, color: RACI_META[k].color }}>{k}</span>
            {RACI_META[k].label}
          </span>
        ))}
      </div>

      {tasksArr.length === 0 || cols.length === 0 ? (
        <div className="glass-surface lift-card ph-rise rounded-2xl p-10 text-center text-sm text-muted-foreground">
          {tasksArr.length === 0 ? "No tasks in this project yet." : "Add member columns to start assigning RACI."}
        </div>
      ) : (
        <div className="glass-surface lift-card ph-rise rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead style={{ background: "hsl(var(--muted) / 0.40)" }}>
                <tr>
                  <th className="text-left px-4 py-2 text-xs font-bold text-muted-foreground uppercase sticky left-0 z-10" style={{ background: "hsl(var(--muted) / 0.40)" }}>Task</th>
                  {cols.map(u => {
                    const cnt = responsibilityCount[u.id] ?? { R: 0, A: 0 };
                    const over = cnt.R + cnt.A > overThreshold;
                    return (
                      <th key={u.id} className="text-center px-2 py-2 text-xs font-bold text-muted-foreground uppercase">
                        <div className="flex flex-col items-center">
                          <span>{u.name.split(" ").map(p => p[0]).join("")}</span>
                          <span className="text-[10px] font-normal normal-case text-muted-foreground truncate max-w-[80px]">{u.name}</span>
                          {over && <span title="Over-allocated (R+A > 5)"><AlertTriangle size={10} className="text-warn mt-0.5" /></span>}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {tasksArr.map(t => (
                  <tr key={t.id} className="border-t border-border/60">
                    <td className="px-4 py-2 text-sm text-foreground sticky left-0 bg-card max-w-xs truncate">{t.title}</td>
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
                              background: m?.bg ?? "hsl(var(--card))",
                              color: m?.color ?? "hsl(var(--muted-foreground))",
                              borderColor: m?.color ?? "hsl(var(--border))",
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
