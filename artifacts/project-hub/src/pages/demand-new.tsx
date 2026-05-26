import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useCreateProject, useCreateProjectStage } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ChevronLeft, Sparkles } from "lucide-react";
import { AiButton } from "../components/ai-button";

function SectionCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="glass-surface lift-card ph-rise rounded-2xl p-6">
      <div className="mb-5">
        <h3 className="text-base font-semibold text-foreground tracking-tight">{title}</h3>
        {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

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
    <div className="min-h-full px-6 lg:px-10 py-8 max-w-4xl mx-auto space-y-6">
      <div>
        <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3">
          <ChevronLeft size={14} /> Back to Dashboard
        </Link>
        <p className="text-[10px] font-mono tracking-[0.22em] uppercase text-muted-foreground">
          Stage 1 of 16 · FR-01 · Demand Initiation
        </p>
        <h1 className="text-3xl lg:text-4xl font-bold tracking-tight text-card-foreground mt-1">New Demand</h1>
        <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
          Start a new project at the very beginning of the governance lifecycle. You'll capture
          the full business justification, scope, outcomes and CapEx/OpEx split on the next screen.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <SectionCard title="Demand Basics" subtitle="Give the demand a name and a one-line description.">
          <div className="flex items-center justify-end -mt-2">
            <AiButton
              label="AI Draft"
              endpoint="/api/ai/demand/draft-idea"
              payload={{ name, description, sponsor }}
              size="sm"
              variant="subtle"
              disabled={!name.trim() && !description.trim() && !sponsor.trim()}
              disabledTitle="Type at least a rough name, description or sponsor first"
              onResult={(d) => {
                const r = d as { name?: string; description?: string; sponsor?: string };
                if (r.name) setName(r.name);
                if (r.description) setDescription(r.description);
                if (r.sponsor && !sponsor) setSponsor(r.sponsor);
                toast({ title: "AI draft applied — review before creating" });
              }}
            />
          </div>
          <div>
            <label className="text-sm font-medium text-foreground">
              Project / Demand Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="e.g. SAP MM Module Upgrade"
              className="mt-1.5 w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
              autoFocus data-testid="input-demand-name"
            />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-foreground">Short Description</label>
              <AiButton
                label="Rephrase"
                endpoint="/api/ai/improve-text"
                payload={{
                  text: description,
                  tone: "professional, concise, executive",
                  audience: "PMO executives",
                  maxWords: 35,
                  instruction: "Rewrite as a single crisp sentence describing what this demand is about. End with a period.",
                }}
                size="sm"
                variant="ghost"
                disabled={description.trim().length < 3}
                disabledTitle="Type a description first to rephrase it"
                onResult={(d) => {
                  const r = d as { rewritten?: string };
                  if (r.rewritten) {
                    setDescription(r.rewritten.trim());
                    toast({ title: "Description rephrased" });
                  }
                }}
              />
            </div>
            <textarea
              value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="One-line summary of what this demand is about."
              rows={2}
              className="mt-1.5 w-full px-3 py-2 rounded-md border border-input bg-background text-sm resize-none"
              data-testid="input-demand-description"
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Tip: type a rough idea, then click AI Draft to polish all three fields, or Rephrase to tighten just the description.
            </p>
          </div>
        </SectionCard>

        <SectionCard title="Initial Sponsor" subtitle="Optional — full sponsor details can be added on the Project Case form.">
          <input
            type="text" value={sponsor} onChange={(e) => setSponsor(e.target.value)}
            placeholder="Sponsor name or role"
            className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
            data-testid="input-demand-sponsor"
          />
        </SectionCard>

        <div className="flex items-center justify-end gap-3">
          <Link href="/" className="text-sm px-4 h-9 inline-flex items-center text-muted-foreground hover:text-foreground">
            Cancel
          </Link>
          <button
            type="submit" disabled={submitting || !name.trim()}
            className="btn-glossy-cta flex items-center gap-2 px-5 h-9 rounded-md text-[13px] font-semibold disabled:opacity-50"
            data-testid="button-create-demand"
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            <span>Create Demand & Open Project Case</span>
          </button>
        </div>
      </form>
    </div>
  );
}
