import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useCreateProject, useCreateProjectStage } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ChevronLeft, Sparkles, Lightbulb } from "lucide-react";

export default function NewDemand() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sponsor, setSponsor] = useState("");
  const createProject = useCreateProject();
  const createStage = useCreateProjectStage();
  const submitting = createProject.isPending || createStage.isPending;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast({ title: "Project name is required", variant: "destructive" });
      return;
    }
    try {
      const project = await createProject.mutateAsync({
        data: {
          name: name.trim(),
          description: description.trim() || undefined,
          stage: "project_case",
          priority: "p2_medium",
          ragStatus: "green",
        },
      });
      await createStage.mutateAsync({
        id: project.id,
        data: {
          stage: "project_case",
          status: "in_progress",
          notes: sponsor ? JSON.stringify({ __projectCase: { sponsor } }) : undefined,
        },
      });
      toast({ title: "Demand created", description: `${project.name} is now in Project Case stage.` });
      navigate(`/projects/${project.id}?stage=project_case`);
    } catch (err) {
      toast({ title: "Failed to create demand", description: String(err), variant: "destructive" });
    }
  }

  return (
    <div className="min-h-full px-6 lg:px-10 py-8 max-w-3xl mx-auto">
      <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ChevronLeft size={14} /> Back to Dashboard
      </Link>

      <div className="glass-surface rounded-2xl p-8 bg-gradient-to-br from-indigo-50/60 to-blue-50/40 dark:from-indigo-950/30 dark:to-blue-950/20 border border-indigo-200/40 dark:border-indigo-800/30">
        <div className="flex items-center gap-2 mb-1">
          <Sparkles size={16} className="text-indigo-500" />
          <span className="text-[10px] font-mono tracking-[0.22em] uppercase text-indigo-600 dark:text-indigo-400">
            Stage 1 of 15 · FR-01
          </span>
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-card-foreground">New Demand</h1>
        <p className="text-sm text-muted-foreground mt-2">
          Start a new project at the very beginning of the governance lifecycle. You'll capture
          the business case, scope, and budget on the next screen.
        </p>

        <div className="mt-5 flex items-start gap-2 rounded-md bg-indigo-100/50 dark:bg-indigo-900/30 px-3 py-2 text-[12px] text-indigo-900 dark:text-indigo-200">
          <Lightbulb size={14} className="mt-0.5 shrink-0" />
          <p>
            <span className="font-semibold">Demand Initiation</span> is the first of 12 governance
            stages. After this, the project flows through URS → RFP → Vendor Evaluation → Charter
            → NFA → PR/PO → Kickoff → Design → Implementation → UAT → Go-Live → Closure.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          <div>
            <label className="text-sm font-medium text-card-foreground">
              Project / Demand Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. SAP MM Module Upgrade"
              className="mt-1.5 w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
              autoFocus
              data-testid="input-demand-name"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-card-foreground">Short Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="One-line summary of what this demand is about (you'll add the full business justification on the next screen)."
              rows={3}
              className="mt-1.5 w-full px-3 py-2 rounded-md border border-input bg-background text-sm resize-none"
              data-testid="input-demand-description"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-card-foreground">Initial Sponsor</label>
            <input
              type="text"
              value={sponsor}
              onChange={(e) => setSponsor(e.target.value)}
              placeholder="Sponsor name or role (optional)"
              className="mt-1.5 w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
              data-testid="input-demand-sponsor"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <Link href="/" className="text-sm px-4 h-9 inline-flex items-center text-muted-foreground hover:text-foreground">
              Cancel
            </Link>
            <button
              type="submit"
              disabled={submitting || !name.trim()}
              className="btn-glossy-cta flex items-center gap-2 px-5 h-9 rounded-md text-[13px] font-semibold disabled:opacity-50"
              data-testid="button-create-demand"
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              <span>Create Demand & Open Project Case</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
