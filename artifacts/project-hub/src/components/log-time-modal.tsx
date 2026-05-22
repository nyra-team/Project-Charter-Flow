import { useState } from "react";
import { useListTimelogs, useCreateTimelog, useListUsers } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Clock, Plus, X } from "lucide-react";
import { formatDate } from "../lib/format";

interface LogTimeModalProps {
  open: boolean;
  onClose: () => void;
  taskId: number;
  taskName?: string;
  plannedEffortHours?: number | null;
}

interface TimelogEntry {
  id: number;
  taskId: number;
  userId?: number | null;
  userName?: string | null;
  date: string;
  hours: number;
  note?: string | null;
  createdAt: string;
}

const today = () => new Date().toISOString().split("T")[0];

export function LogTimeModal({ open, onClose, taskId, taskName, plannedEffortHours }: LogTimeModalProps) {
  const { toast } = useToast();
  const { data: users = [] } = useListUsers();
  const { data: timelogs = [], refetch } = useListTimelogs(taskId);
  const createTimelog = useCreateTimelog();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ date: today(), hours: "", note: "", userId: "" });

  const usersArr = users as Array<{ id: number; name: string }>;
  const entries = timelogs as TimelogEntry[];

  const totalLogged = entries.reduce((sum, e) => sum + e.hours, 0);
  const planned = plannedEffortHours ?? 0;
  const pct = planned > 0 ? Math.min(100, Math.round((totalLogged / planned) * 100)) : null;

  function resetForm() {
    setForm({ date: today(), hours: "", note: "", userId: "" });
    setShowForm(false);
  }

  function handleSubmit() {
    const hrs = parseFloat(form.hours);
    if (!form.date) { toast({ title: "Date is required", variant: "destructive" }); return; }
    if (!form.hours || isNaN(hrs) || hrs < 0.25) { toast({ title: "Hours must be ≥ 0.25", variant: "destructive" }); return; }

    createTimelog.mutate(
      {
        id: taskId,
        data: {
          date: form.date,
          hours: hrs,
          note: form.note || undefined,
          userId: form.userId ? parseInt(form.userId) : undefined,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Time logged" });
          resetForm();
          refetch();
        },
        onError: () => toast({ title: "Failed to log time", variant: "destructive" }),
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock size={18} className="text-indigo-500" />
            Time Log{taskName ? ` — ${taskName}` : ""}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Effort summary bar */}
          {planned > 0 && (
            <div className="rounded-xl p-3 space-y-1.5" style={{ background: "#F0F4FF", border: "1px solid #C7D2FE" }}>
              <div className="flex justify-between text-xs font-medium text-indigo-700">
                <span>Effort progress</span>
                <span>{totalLogged.toFixed(1)}h / {planned}h planned {pct != null ? `(${pct}%)` : ""}</span>
              </div>
              <div className="w-full rounded-full overflow-hidden" style={{ background: "#C7D2FE", height: 6 }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${pct ?? 0}%`,
                    background: (pct ?? 0) > 100 ? "#DC3545" : "#6366F1",
                  }}
                />
              </div>
            </div>
          )}

          {planned === 0 && totalLogged > 0 && (
            <p className="text-xs text-gray-500">
              Total logged: <span className="font-semibold text-indigo-600">{totalLogged.toFixed(1)}h</span> (no planned effort set)
            </p>
          )}

          {/* Existing log entries */}
          {entries.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                {entries.length} Entr{entries.length !== 1 ? "ies" : "y"}
              </p>
              {entries.map(entry => (
                <div key={entry.id} className="flex items-start gap-3 rounded-xl px-3 py-2.5"
                  style={{ background: "#F8FAFC", border: "1px solid #E2E8F0" }}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold"
                        style={{ background: "#EEF2FF", color: "#4338CA" }}>
                        <Clock size={9} /> {entry.hours.toFixed(1)}h
                      </span>
                      <span className="text-xs text-gray-500">{formatDate(entry.date)}</span>
                      {entry.userName && (
                        <span className="text-xs text-gray-400">by <b className="text-gray-600">{entry.userName}</b></span>
                      )}
                    </div>
                    {entry.note && (
                      <p className="text-xs text-gray-500 mt-1 truncate" title={entry.note}>{entry.note}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {entries.length === 0 && !showForm && (
            <div className="text-center py-6 text-gray-400 text-sm">No time logged yet.</div>
          )}

          {/* Log time form */}
          {showForm ? (
            <div className="rounded-xl p-4 space-y-3" style={{ background: "#F0F9FF", border: "1px solid #7DD3FC" }}>
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-700">Log Time</p>
                <button onClick={resetForm} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Date *</label>
                  <Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} className="text-sm h-9" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Hours *</label>
                  <Input
                    type="number" min={0.25} step={0.25} placeholder="e.g. 2.5"
                    value={form.hours}
                    onChange={e => setForm(f => ({ ...f, hours: e.target.value }))}
                    className="text-sm h-9"
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Who logged</label>
                  <Select value={form.userId} onValueChange={v => setForm(f => ({ ...f, userId: v }))}>
                    <SelectTrigger className="text-sm h-9"><SelectValue placeholder="Select person (optional)" /></SelectTrigger>
                    <SelectContent>
                      {usersArr.map(u => <SelectItem key={u.id} value={u.id.toString()}>{u.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Note</label>
                  <Textarea
                    value={form.note}
                    onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                    rows={2} placeholder="What did you work on?" className="text-sm"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-1">
                <Button size="sm" onClick={handleSubmit} disabled={createTimelog.isPending} className="text-xs">
                  {createTimelog.isPending ? "Saving..." : "Log Time"}
                </Button>
                <Button size="sm" variant="ghost" onClick={resetForm} className="text-xs">Cancel</Button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowForm(true)}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium text-indigo-600 border border-dashed border-indigo-300 hover:bg-indigo-50 transition-colors"
            >
              <Plus size={14} />
              Log Time
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
