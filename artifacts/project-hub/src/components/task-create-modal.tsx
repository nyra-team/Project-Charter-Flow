// Create-task modal — opened from the project-detail toolbar "New task" button.
// Plain controlled state (no react-hook-form): name is the only required field;
// everything else has a sensible default and maps straight onto CreateTaskBody.
import { useState } from "react";
import { Loader2 } from "lucide-react";
import type { useCreateTask } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TASK_PRIORITIES, TASK_STATUSES } from "@/lib/task-constants";

type Opt = { id: number; name: string };

export function TaskCreateModal({
  open, onClose, projectId, milestones, users, createTask, onCreated, milestonePreset,
}: {
  open: boolean;
  onClose: () => void;
  projectId: number;
  milestones: Opt[];
  users: Opt[];
  createTask: ReturnType<typeof useCreateTask>;
  onCreated?: (taskId: number) => void;
  // When opened from a milestone group header: number = that milestone, null =
  // "No Milestone". undefined = generic add (toolbar) → milestone is pickable.
  milestonePreset?: number | null;
}) {
  const presetActive = milestonePreset !== undefined;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [milestoneId, setMilestoneId] = useState(milestonePreset != null ? String(milestonePreset) : "");
  const [priority, setPriority] = useState("P2");
  const [status, setStatus] = useState("not_started");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [estimatedHours, setEstimatedHours] = useState("");

  const submit = () => {
    const n = name.trim();
    if (!n) return;
    createTask.mutate(
      { id: projectId, data: {
        name: n,
        description: description.trim() || undefined,
        assigneeId: assigneeId ? Number(assigneeId) : undefined,
        milestoneId: milestoneId ? Number(milestoneId) : undefined,
        priority,
        status,
        rag: "green",
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        estimatedHours: estimatedHours ? Number(estimatedHours) : undefined,
      } } as never,
      { onSuccess: (t: unknown) => {
        const id = (t as { id?: number })?.id;
        onClose();
        if (id) onCreated?.(id);
      } },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="w-[92vw] max-w-xl">
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div>
            <label className="text-[12px] font-semibold text-[#172b4d]">Task name <span className="text-red-500">*</span></label>
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="What needs doing?" className="mt-1" />
          </div>

          <div>
            <label className="text-[12px] font-semibold text-[#172b4d]">Description</label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="mt-1" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-[12px] font-semibold text-[#172b4d]">Assignee</label>
              <Select value={assigneeId} onValueChange={setAssigneeId}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  {users.map((u) => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-[12px] font-semibold text-[#172b4d]">Milestone</label>
              {presetActive ? (
                <div className="mt-1 h-9 px-3 flex items-center rounded-md border border-input bg-muted/40 text-sm text-foreground">
                  {milestonePreset == null ? "No Milestone" : (milestones.find((m) => m.id === milestonePreset)?.name ?? "—")}
                </div>
              ) : (
                <Select value={milestoneId} onValueChange={setMilestoneId}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Unscheduled" /></SelectTrigger>
                  <SelectContent>
                    {milestones.map((m) => <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div>
              <label className="text-[12px] font-semibold text-[#172b4d]">Priority</label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TASK_PRIORITIES.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-[12px] font-semibold text-[#172b4d]">Status</label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TASK_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-[12px] font-semibold text-[#172b4d]">Start date</label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="mt-1" />
            </div>

            <div>
              <label className="text-[12px] font-semibold text-[#172b4d]">End date</label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="mt-1" />
            </div>

            <div>
              <label className="text-[12px] font-semibold text-[#172b4d]">Estimated hours</label>
              <Input type="number" min={0} value={estimatedHours} onChange={(e) => setEstimatedHours(e.target.value)} className="mt-1" />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={!name.trim() || createTask.isPending}>
            {createTask.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
