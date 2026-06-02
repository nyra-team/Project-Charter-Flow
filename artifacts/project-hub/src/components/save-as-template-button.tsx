import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Library, BookmarkPlus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useUserStore } from "../lib/store";

const ADMIN_ROLES = ["pmo", "executive_director", "chairman"];

/**
 * Header-anchored CTA on the Project Detail page: snapshots the current
 * project's task graph + milestones into a reusable template via
 * POST /api/templates/from-project/:projectId. Visible only to PMO /
 * Executive Director / Chairman roles; collapses to null otherwise.
 *
 * Self-contained on purpose so the project-detail.tsx diff stays surgical.
 */
export function SaveAsTemplateButton({ projectId, projectName }: { projectId: number; projectName: string }) {
  const { role } = useUserStore();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("general");
  const [description, setDescription] = useState("");

  // NOTE: mutation hook is declared unconditionally (Rules of Hooks); the
  // admin gate happens at render time below, not by short-circuiting before
  // the hook call.
  const save = useMutation({
    mutationFn: async (body: { name: string; category: string; description: string }) => {
      const res = await fetch(`/api/templates/from-project/${projectId}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.text()) || `${res.status} ${res.statusText}`);
      return res.json() as Promise<{ id: number; name: string }>;
    },
    onSuccess: (tpl) => {
      toast({
        title: "Saved as template",
        description: `“${tpl.name}” is now in the template library.`,
      });
      qc.invalidateQueries({ queryKey: ["templates"] });
      setOpen(false);
      setName("");
      setDescription("");
      setCategory("general");
    },
    onError: (e: Error) =>
      toast({ variant: "destructive", title: "Couldn't save template", description: e.message }),
  });

  // Pre-fill the name with a sensible default when the modal opens.
  function handleOpen(next: boolean) {
    setOpen(next);
    if (next && !name) {
      setName(`${projectName} template`);
    }
  }

  // Admin-only surface; render nothing for non-admin viewers.
  if (!ADMIN_ROLES.includes(role)) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => handleOpen(true)}
        title="Save this project's structure as a reusable template"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold border border-border bg-card hover:bg-accent transition-colors shadow-sm flex-shrink-0"
        data-testid="btn-save-as-template"
      >
        <Library size={14} />
        Save as Template
      </button>

      <Dialog open={open} onOpenChange={handleOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BookmarkPlus size={16} />
              Save “{projectName}” as a template
            </DialogTitle>
            <DialogDescription>
              Captures the task graph (parent/child + predecessors) and milestones, with dates converted to offsets from the
              project start. Actuals (status, RAG, assignees, hours) aren't carried over — templates hold structure only.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="sat-name">Template name</Label>
              <Input
                id="sat-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. ANDA — generic template"
              />
            </div>
            <div>
              <Label htmlFor="sat-cat">Category</Label>
              <Input
                id="sat-cat"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="regulatory · engineering · it · general"
              />
            </div>
            <div>
              <Label htmlFor="sat-desc">Description (optional)</Label>
              <Textarea
                id="sat-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="What kind of work does this template fit?"
              />
            </div>
          </div>

          <DialogFooter>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="px-3 h-9 rounded-md text-[13px] text-muted-foreground hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => save.mutate({ name: name.trim(), category: category.trim() || "general", description: description.trim() })}
              disabled={!name.trim() || save.isPending}
              className="btn-glossy-cta inline-flex items-center gap-2 px-4 h-9 rounded-md text-[13px] font-semibold disabled:opacity-50"
            >
              {save.isPending ? "Saving…" : "Save template"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
