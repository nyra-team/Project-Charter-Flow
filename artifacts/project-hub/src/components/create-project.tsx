import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, X, Loader2, FolderPlus } from "lucide-react";

type Milestone = { name: string; tasks: string[] };

/**
 * "Create Project" — manually build a project by typing its name, milestones,
 * and each milestone's tasks. No file, no AI. Sits next to the import buttons.
 * POST /api/projects/manual.
 */
export function CreateProjectButton({ onDone }: { onDone?: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [milestones, setMilestones] = useState<Milestone[]>([{ name: "", tasks: [""] }]);

  function reset() {
    setName("");
    setMilestones([{ name: "", tasks: [""] }]);
  }

  function patchMilestone(mi: number, next: Partial<Milestone>) {
    setMilestones((ms) => ms.map((m, i) => (i === mi ? { ...m, ...next } : m)));
  }
  function patchTask(mi: number, ti: number, value: string) {
    setMilestones((ms) => ms.map((m, i) =>
      i === mi ? { ...m, tasks: m.tasks.map((t, j) => (j === ti ? value : t)) } : m));
  }

  async function run() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const payload = {
        name: name.trim(),
        milestones: milestones
          .filter((m) => m.name.trim())
          .map((m) => ({ name: m.name.trim(), tasks: m.tasks.map((t) => t.trim()).filter(Boolean) })),
      };
      const res = await fetch("/api/projects/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as { milestones?: number; tasks?: number; error?: string };
      if (!res.ok) throw new Error(data.error || "Could not create the project");
      toast({ title: `Project created`, description: `${data.milestones ?? 0} milestone(s), ${data.tasks ?? 0} task(s).` });
      setOpen(false);
      reset();
      onDone?.();
    } catch (e) {
      toast({ title: "Couldn't create", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Create a project manually"
        className="h-6 px-1.5 rounded-md flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
      >
        <FolderPlus size={13} /> Create Project
      </button>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Create project</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Project name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Site B Cold Storage Upgrade"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Milestones &amp; tasks</label>
                <Button variant="ghost" size="sm" onClick={() => setMilestones((ms) => [...ms, { name: "", tasks: [""] }])}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Milestone
                </Button>
              </div>

              {milestones.map((m, mi) => (
                <div key={mi} className="rounded-lg border border-border p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      value={m.name}
                      onChange={(e) => patchMilestone(mi, { name: e.target.value })}
                      placeholder={`Milestone ${mi + 1} name`}
                      className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium"
                    />
                    {milestones.length > 1 && (
                      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0"
                        onClick={() => setMilestones((ms) => ms.filter((_, i) => i !== mi))}>
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>

                  <div className="space-y-1.5 pl-3">
                    {m.tasks.map((t, ti) => (
                      <div key={ti} className="flex items-center gap-2">
                        <input
                          value={t}
                          onChange={(e) => patchTask(mi, ti, e.target.value)}
                          placeholder={`Task ${ti + 1}`}
                          className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                        />
                        {m.tasks.length > 1 && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                            onClick={() => patchMilestone(mi, { tasks: m.tasks.filter((_, j) => j !== ti) })}>
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    ))}
                    <Button variant="ghost" size="sm" className="text-muted-foreground"
                      onClick={() => patchMilestone(mi, { tasks: [...m.tasks, ""] })}>
                      <Plus className="h-3.5 w-3.5 mr-1" /> Task
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={run} disabled={!name.trim() || busy}>
              {busy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null} Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
