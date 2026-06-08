import { Link } from "wouter";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { STAGE_ICONS } from "./lifecycle-stepper";
import { getStageConfig } from "../lib/lifecycle-config";
import { CANONICAL_STAGE_KEYS, getCanonicalStageNumber } from "../lib/lifecycle-phases";
import { ArrowUpRight, CheckSquare, FileText, Users, AlertCircle } from "lucide-react";

interface ProjectAtStage {
  id: number;
  name: string;
  ragStatus?: string | null;
  priority?: string | null;
}

interface StageDetailDialogProps {
  stageKey: string | null;
  onClose: () => void;
  projects?: ProjectAtStage[];
}

export function StageDetailDialog({ stageKey, onClose, projects = [] }: StageDetailDialogProps) {
  const open = !!stageKey;
  const cfg = stageKey ? getStageConfig(stageKey) : null;
  const stageNum = stageKey ? getCanonicalStageNumber(stageKey) : null;
  const Icon = stageKey ? STAGE_ICONS[stageKey] ?? FileText : FileText;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl glass-surface border border-border max-h-[85vh] overflow-y-auto">
        {cfg && (
          <>
            <DialogHeader>
              <div className="flex items-start gap-3">
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center text-primary-foreground flex-shrink-0 shadow-md"
                  style={{ background: cfg.color }}
                >
                  <Icon size={22} strokeWidth={2.2} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                      {stageNum != null
                        ? `Stage ${stageNum} of ${CANONICAL_STAGE_KEYS.length}`
                        : "Legacy stage"}
                    </span>
                    {cfg.advanceRoles && (
                      <Badge variant="outline" className="text-[10px] font-mono uppercase">
                        <Users size={9} className="mr-1" />
                        {cfg.advanceRoles.join(" · ")}
                      </Badge>
                    )}
                  </div>
                  <DialogTitle className="text-xl text-card-foreground">{cfg.label}</DialogTitle>
                  <DialogDescription className="text-sm text-muted-foreground mt-1">
                    {cfg.description}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
              {/* Required Docs */}
              <section className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="flex items-center gap-1.5 mb-2 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                  <FileText size={11} /> Required Documents
                </div>
                {cfg.requiredDocs && cfg.requiredDocs.length > 0 ? (
                  <ul className="space-y-1.5">
                    {cfg.requiredDocs.map((d) => (
                      <li key={d.id} className="text-[12px] text-card-foreground flex items-start gap-1.5">
                        <span className="text-primary mt-1">•</span>
                        <span><span className="font-medium">{d.name}</span> <span className="text-muted-foreground">— {d.description}</span></span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[12px] text-muted-foreground italic">None required</p>
                )}
              </section>

              {/* Checklist */}
              <section className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="flex items-center gap-1.5 mb-2 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                  <CheckSquare size={11} /> Gate Checklist
                </div>
                {cfg.checklistItems && cfg.checklistItems.length > 0 ? (
                  <ul className="space-y-1.5">
                    {cfg.checklistItems.map((c) => (
                      <li key={c.id} className="text-[12px] text-card-foreground flex items-start gap-1.5">
                        <span className={c.blocking ? "text-destructive mt-1" : "text-muted-foreground mt-1"}>{c.blocking ? "■" : "□"}</span>
                        <span>{c.label}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[12px] text-muted-foreground italic">None</p>
                )}
              </section>
            </div>

            {/* Prerequisites */}
            {cfg.prerequisites && cfg.prerequisites.length > 0 && (
              <div className="flex items-center gap-2 text-[12px] text-muted-foreground border-t border-border pt-3 mt-2">
                <AlertCircle size={12} className="text-amber-accent" />
                <span className="font-mono uppercase text-[10px] tracking-wider">Prerequisites:</span>
                <div className="flex gap-1.5 flex-wrap">
                  {cfg.prerequisites.map((p) => {
                    const pc = getStageConfig(p);
                    return <Badge key={p} variant="outline" className="text-[10px]">{pc?.label ?? p}</Badge>;
                  })}
                </div>
              </div>
            )}

            {/* Projects currently at this stage */}
            <section className="border-t border-border pt-3 mt-1">
              <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
                Projects at this stage ({projects.length})
              </div>
              {projects.length > 0 ? (
                <div className="space-y-1.5">
                  {projects.map((p) => (
                    <Link key={p.id} href={`/projects/${p.id}?stage=${stageKey}`} onClick={onClose}>
                      <div className="flex items-center justify-between p-2.5 rounded-md border border-border bg-card hover:border-primary/40 hover:bg-primary/5 transition-colors cursor-pointer group">
                        <div className="flex items-center gap-2 min-w-0">
                          {p.ragStatus && (
                            <span
                              className="w-2 h-2 rounded-full flex-shrink-0"
                              style={{ background: p.ragStatus === "red" ? "#DC2626" : p.ragStatus === "amber" ? "#F59E0B" : "#16A34A" }}
                            />
                          )}
                          <span className="text-sm font-medium text-card-foreground truncate">{p.name}</span>
                          {p.priority && (
                            <Badge variant="outline" className="text-[10px] font-mono">{p.priority}</Badge>
                          )}
                        </div>
                        <ArrowUpRight size={13} className="text-muted-foreground group-hover:text-primary flex-shrink-0" />
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="text-[12px] text-muted-foreground italic">No projects currently at this stage</p>
              )}
            </section>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
