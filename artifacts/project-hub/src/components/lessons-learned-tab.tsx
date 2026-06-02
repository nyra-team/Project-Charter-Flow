// Per-project Lessons Learned — reads GET /api/projects/:id/lessons-learned.
// Read-only list with category chips; capture happens at closure / on the
// global Lessons Learned page.

import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Lightbulb, ArrowUpRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionHeader } from "@/components/ui-kit";

type Lesson = {
  id: number;
  title: string;
  description: string;
  category: string;
  whatWorked?: string | null;
  whatDidnt?: string | null;
  recommendation?: string | null;
  stage?: string | null;
  createdAt: string;
};

const CAT_TONE: Record<string, string> = {
  schedule: "bg-primary/10 text-primary border-primary/20",
  budget: "bg-warn/10 text-warn border-warn/20",
  vendor: "bg-chart-5/10 text-chart-5 border-chart-5/20",
  scope: "bg-warn/10 text-warn border-warn/20",
  stakeholder: "bg-primary/10 text-primary border-primary/20",
  technical: "bg-chart-5/10 text-chart-5 border-chart-5/20",
  quality: "bg-success/10 text-success border-success/20",
  general: "bg-muted text-muted-foreground border-border",
};

export function LessonsLearnedTab({ projectId }: { projectId: number }) {
  const { data, isLoading } = useQuery({
    queryKey: [`/api/projects/${projectId}/lessons-learned`],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/lessons-learned`);
      if (!r.ok) throw new Error("Failed");
      return r.json() as Promise<Lesson[]>;
    },
  });

  return (
    <div className="rounded-2xl bg-card border border-card-border glass-surface p-5">
      <SectionHeader
        title="Lessons Learned"
        subtitle="Captured insights from this project's lifecycle"
        actions={
          <Link href="/lessons-learned">
            <button className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80">
              Repository <ArrowUpRight size={13} />
            </button>
          </Link>
        }
      />
      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      ) : !data?.length ? (
        <div className="text-center py-10">
          <Lightbulb size={28} className="mx-auto text-muted-foreground/40 mb-2" />
          <p className="text-sm text-muted-foreground">No lessons captured yet.</p>
          <p className="text-xs text-muted-foreground/70 mt-1">Insights are recorded at stage gates and closure.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {data.map((l) => (
            <div key={l.id} className="rounded-xl border border-border/70 bg-muted/20 p-4">
              <div className="flex items-start justify-between gap-3">
                <h4 className="text-sm font-semibold text-foreground">{l.title}</h4>
                <span className={`text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-full border flex-shrink-0 ${CAT_TONE[l.category] ?? CAT_TONE.general}`}>
                  {l.category}
                </span>
              </div>
              <p className="text-sm text-muted-foreground mt-1.5">{l.description}</p>
              {l.recommendation && (
                <p className="text-xs mt-2"><span className="font-semibold text-primary">→ Recommendation: </span><span className="text-muted-foreground">{l.recommendation}</span></p>
              )}
              <p className="text-[10px] text-muted-foreground/70 mt-2">
                {l.stage ? `${l.stage.replace(/_/g, " ")} · ` : ""}{new Date(l.createdAt).toLocaleDateString()}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
