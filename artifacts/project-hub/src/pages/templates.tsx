import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Layers, Flag, Sparkles, Library, ChevronRight, Trash2 } from "lucide-react";
import { formatDate } from "../lib/format";

// ─── Types (mirror the inline Zod shapes from routes/templates.ts) ──────────
type ProjectTemplate = {
  id: number;
  name: string;
  description: string | null;
  category: string;
  sourceProjectId: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type TemplateTask = {
  id: number;
  templateId: number;
  parentTaskId: number | null;
  name: string;
  description: string | null;
  defaultDurationDays: number;
  defaultDayOffset: number;
  defaultPriority: string;
  defaultOwnerRole: string | null;
  defaultEffortHours: string | null;
  predecessorOffsets: Array<{ templateTaskId: number; lagDays: number }>;
  sortOrder: number;
};

type TemplateMilestone = {
  id: number;
  templateId: number;
  name: string;
  description: string | null;
  defaultDayOffset: number;
  gateDecision: string | null;
  readinessChecklist: unknown[];
  sortOrder: number;
};

type TemplateDetail = ProjectTemplate & { tasks: TemplateTask[]; milestones: TemplateMilestone[] };

// ─── API helpers — raw fetch, since Orval hasn't regenerated yet for this slice ─

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function TemplatesPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [useOpen, setUseOpen] = useState<{ tpl: ProjectTemplate } | null>(null);

  const { data: templates, isLoading } = useQuery({
    queryKey: ["templates"],
    queryFn: () => fetchJson<ProjectTemplate[]>("/api/templates"),
  });

  const { data: detail } = useQuery({
    queryKey: ["templates", selectedId],
    queryFn: () => fetchJson<TemplateDetail>(`/api/templates/${selectedId}`),
    enabled: selectedId != null,
  });

  const createBlank = useMutation({
    mutationFn: (body: { name: string; description: string; category: string }) =>
      fetchJson<ProjectTemplate>("/api/templates", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (created) => {
      toast({ title: "Template created", description: `“${created.name}” is ready for tasks.` });
      qc.invalidateQueries({ queryKey: ["templates"] });
      setNewOpen(false);
      setSelectedId(created.id);
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Couldn't create template", description: e.message }),
  });

  const softDelete = useMutation({
    mutationFn: (id: number) => fetchJson<{ success: boolean }>(`/api/templates/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "Template archived", description: "It's hidden from the active list but its children rows are preserved." });
      qc.invalidateQueries({ queryKey: ["templates"] });
      setSelectedId(null);
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Archive failed", description: e.message }),
  });

  const useTemplate = useMutation({
    mutationFn: (body: { templateId: number; projectName: string; startDate: string }) =>
      fetchJson<{ id: number; name: string }>("/api/projects/from-template", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: (project) => {
      toast({ title: "Project created", description: `“${project.name}” spawned from template.` });
      qc.invalidateQueries({ queryKey: ["templates"] });
      setUseOpen(null);
      navigate(`/projects/${project.id}`);
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Couldn't create project", description: e.message }),
  });

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="relative rounded-2xl overflow-hidden ph-rise glass-surface">
        <div className="absolute inset-0 ambient-mesh opacity-70 pointer-events-none" />
        <div className="relative flex items-start justify-between flex-wrap gap-4 p-6 lg:p-8">
          <div className="min-w-0">
            <p className="text-[10px] font-mono tracking-[0.22em] uppercase text-muted-foreground mb-2">
              Reusable Blueprints
            </p>
            <h2 className="text-3xl lg:text-4xl font-bold tracking-tight text-card-foreground">Project Templates</h2>
            <p className="text-sm text-muted-foreground mt-2 max-w-xl">
              Pre-wired task graphs + milestones. Spin up a new project from one in seconds, or save any live project as a
              new template to standardise repeating work.
            </p>
          </div>
          <button
            onClick={() => setNewOpen(true)}
            className="btn-glossy-cta flex items-center gap-2 px-4 h-9 rounded-md text-[13px] font-semibold"
            data-testid="btn-new-template"
          >
            <Plus size={14} />
            <span>New blank template</span>
          </button>
        </div>
      </div>

      {/* ── Grid ───────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-44 rounded-2xl" />
          ))}
        </div>
      ) : !templates || templates.length === 0 ? (
        <div className="glass-surface rounded-2xl p-12 text-center">
          <Library size={28} className="mx-auto text-muted-foreground mb-3" />
          <p className="text-base font-semibold text-card-foreground">No templates yet</p>
          <p className="text-sm text-muted-foreground mt-1 mb-4">
            Seed the starter library or save an existing project as a template from its detail page.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {templates.map((tpl) => (
            <TemplateCard
              key={tpl.id}
              tpl={tpl}
              onOpen={() => setSelectedId(tpl.id)}
              onUse={() => setUseOpen({ tpl })}
            />
          ))}
        </div>
      )}

      {/* ── Detail Sheet ───────────────────────────────────────────── */}
      <Sheet open={selectedId != null} onOpenChange={(open) => !open && setSelectedId(null)}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          {detail ? (
            <>
              <SheetHeader>
                <SheetTitle>{detail.name}</SheetTitle>
                <SheetDescription>{detail.description || "No description provided."}</SheetDescription>
              </SheetHeader>

              <div className="mt-6 flex items-center gap-2 text-xs">
                <span className="px-2 py-0.5 rounded bg-accent text-accent-foreground font-mono uppercase tracking-wider">
                  {detail.category}
                </span>
                {detail.sourceProjectId != null && (
                  <span className="text-muted-foreground">
                    Cloned from project #{detail.sourceProjectId}
                  </span>
                )}
                <span className="text-muted-foreground ml-auto">Created {formatDate(detail.createdAt)}</span>
              </div>

              <div className="mt-6 flex items-center gap-3">
                <button
                  onClick={() => setUseOpen({ tpl: detail })}
                  className="btn-glossy-cta flex items-center gap-2 px-4 h-9 rounded-md text-[13px] font-semibold"
                  data-testid="btn-use-template"
                >
                  <Sparkles size={14} />
                  Use this template
                </button>
                <button
                  onClick={() => softDelete.mutate(detail.id)}
                  disabled={softDelete.isPending}
                  className="flex items-center gap-2 px-3 h-9 rounded-md text-[13px] text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                >
                  <Trash2 size={14} />
                  Archive
                </button>
              </div>

              {/* Milestones */}
              <section className="mt-8">
                <h3 className="flex items-center gap-2 text-sm font-semibold mb-3">
                  <Flag size={14} className="text-muted-foreground" />
                  Milestones · {detail.milestones.length}
                </h3>
                <div className="space-y-2">
                  {detail.milestones.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">No milestones in this template.</p>
                  ) : (
                    detail.milestones.map((m) => (
                      <div key={m.id} className="flex items-center justify-between px-3 py-2 rounded-md border border-border bg-card">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{m.name}</p>
                          {m.gateDecision && (
                            <p className="text-[11px] text-muted-foreground">Gate: {m.gateDecision}</p>
                          )}
                        </div>
                        <span className="text-xs font-mono text-muted-foreground shrink-0">
                          Day +{m.defaultDayOffset}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </section>

              {/* Tasks */}
              <section className="mt-8">
                <h3 className="flex items-center gap-2 text-sm font-semibold mb-3">
                  <Layers size={14} className="text-muted-foreground" />
                  Tasks · {detail.tasks.length}
                </h3>
                <div className="space-y-1.5">
                  {detail.tasks.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">No tasks in this template.</p>
                  ) : (
                    detail.tasks.map((t) => (
                      <div key={t.id} className="flex items-start gap-3 px-3 py-2 rounded-md border border-border bg-card">
                        <span className="mt-0.5 inline-block w-1 h-6 rounded-full bg-primary/60 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{t.name}</p>
                          <p className="text-[11px] text-muted-foreground">
                            Day +{t.defaultDayOffset} · {t.defaultDurationDays}d · {t.defaultPriority}
                            {t.defaultOwnerRole ? ` · ${t.defaultOwnerRole}` : ""}
                            {t.predecessorOffsets.length > 0 ? ` · depends on ${t.predecessorOffsets.length}` : ""}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>
            </>
          ) : (
            <div className="space-y-3 mt-6">
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* ── "New blank template" dialog ────────────────────────────── */}
      <NewTemplateDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        onSubmit={(v) => createBlank.mutate(v)}
        submitting={createBlank.isPending}
      />

      {/* ── "Use this template" dialog ─────────────────────────────── */}
      <UseTemplateDialog
        open={!!useOpen}
        onOpenChange={(open) => !open && setUseOpen(null)}
        tpl={useOpen?.tpl ?? null}
        onSubmit={(v) =>
          useOpen && useTemplate.mutate({ templateId: useOpen.tpl.id, projectName: v.projectName, startDate: v.startDate })
        }
        submitting={useTemplate.isPending}
      />
    </div>
  );
}

// ─── Card ───────────────────────────────────────────────────────────────────

function TemplateCard({ tpl, onOpen, onUse }: { tpl: ProjectTemplate; onOpen: () => void; onUse: () => void }) {
  return (
    <div
      className="glass-surface lift-card ph-rise rounded-2xl p-5 group cursor-pointer relative"
      onClick={onOpen}
      data-testid={`template-card-${tpl.id}`}
    >
      <div className="flex items-start justify-between mb-3">
        <span className="px-2 py-0.5 rounded bg-accent text-accent-foreground text-[10px] font-mono uppercase tracking-wider">
          {tpl.category}
        </span>
        <ChevronRight size={16} className="text-muted-foreground group-hover:text-foreground transition-colors" />
      </div>
      <h3 className="text-base font-semibold tracking-tight text-card-foreground line-clamp-1">{tpl.name}</h3>
      <p className="text-xs text-muted-foreground mt-1 line-clamp-2 min-h-[2.25rem]">
        {tpl.description || "No description provided."}
      </p>
      <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">Updated {formatDate(tpl.updatedAt)}</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onUse();
          }}
          className="flex items-center gap-1.5 px-2.5 h-7 rounded-md text-[12px] font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Sparkles size={12} />
          Use
        </button>
      </div>
    </div>
  );
}

// ─── New blank template dialog ──────────────────────────────────────────────

function NewTemplateDialog({
  open,
  onOpenChange,
  onSubmit,
  submitting,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (v: { name: string; description: string; category: string }) => void;
  submitting: boolean;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("general");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New blank template</DialogTitle>
          <DialogDescription>
            Creates an empty template. Add tasks &amp; milestones by saving a live project as a template, or extend it later
            from the detail panel.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label htmlFor="tpl-name">Name</Label>
            <Input
              id="tpl-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. CMC Variation Filing"
            />
          </div>
          <div>
            <Label htmlFor="tpl-category">Category</Label>
            <Input
              id="tpl-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="regulatory · engineering · it · general"
            />
          </div>
          <div>
            <Label htmlFor="tpl-desc">Description</Label>
            <Textarea
              id="tpl-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="What kind of project is this template for?"
            />
          </div>
        </div>
        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="px-3 h-9 rounded-md text-[13px] text-muted-foreground hover:bg-accent"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSubmit({ name: name.trim(), description: description.trim(), category: category.trim() || "general" })}
            disabled={!name.trim() || submitting}
            className="btn-glossy-cta flex items-center gap-2 px-4 h-9 rounded-md text-[13px] font-semibold disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Create template"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Use template dialog ────────────────────────────────────────────────────

function UseTemplateDialog({
  open,
  onOpenChange,
  tpl,
  onSubmit,
  submitting,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tpl: ProjectTemplate | null;
  onSubmit: (v: { projectName: string; startDate: string }) => void;
  submitting: boolean;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [projectName, setProjectName] = useState("");
  const [startDate, setStartDate] = useState(today);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Use “{tpl?.name}” for a new project</DialogTitle>
          <DialogDescription>
            All tasks &amp; milestones will be cloned with their offsets resolved against the start date you pick. You can
            wire a charter / PM / portfolio later from the project page.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label htmlFor="np-name">Project name</Label>
            <Input
              id="np-name"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="e.g. ANDA-FY27-Q1 — Pirfenidone"
            />
          </div>
          <div>
            <Label htmlFor="np-start">Start date</Label>
            <Input id="np-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="px-3 h-9 rounded-md text-[13px] text-muted-foreground hover:bg-accent"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSubmit({ projectName: projectName.trim(), startDate })}
            disabled={!projectName.trim() || submitting}
            className="btn-glossy-cta flex items-center gap-2 px-4 h-9 rounded-md text-[13px] font-semibold disabled:opacity-50"
          >
            <Sparkles size={14} />
            {submitting ? "Creating project…" : "Create project"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
