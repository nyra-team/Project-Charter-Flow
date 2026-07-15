import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/extra-api";
import { Loader2, FolderPlus, Info, Type, User, Building2, Factory, FileText, Flag } from "lucide-react";
import { EmployeeCombobox } from "@/components/employee-combobox";
import { HoverHint } from "@/components/ui-kit/HoverHint";

type CharterLite = { id: number; title?: string; status?: string; projectId?: number | null };
type PlantLite = { code: string; label: string };
type MeLite = { plantCode?: string | null; name?: string | null; email?: string | null };

const NO_CHARTER = "none";
const NONE = "none";

/**
 * "Create Project" — a lightweight form: name the project, set its owner, pick
 * its department and plant, and optionally link an existing (unlinked)
 * Charter+NFA so the project Overview is fed from day one. Milestones, tasks,
 * subtasks and dates are added inside the project afterwards. No file, no AI.
 * Sits next to the import buttons. POST /api/projects/manual.
 *
 * The Owner defaults to the signed-in creator, and the Plant defaults to their
 * own plant (both resolved from the master employee DB via /api/users/me — the
 * owner's name/email, the plant's org-unit code). Both stay editable so the
 * project can be handed to a colleague or filed against a different site.
 */
export function CreateProjectButton({ onDone }: { onDone?: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [charterId, setCharterId] = useState<string>(NO_CHARTER);
  const [department, setDepartment] = useState<string>(NONE);
  const [plant, setPlant] = useState<string>(NONE);
  // Once the user touches the Plant picker we stop auto-filling it, so the
  // creator's own-plant default never clobbers a deliberate choice.
  const [plantTouched, setPlantTouched] = useState(false);
  // Owner defaults to the signed-in creator, but stays editable so they can
  // hand the project to a colleague. `ownerTouched` freezes the default once
  // the user picks someone, mirroring the Plant behaviour above.
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState<string | null>(null);
  const [ownerTouched, setOwnerTouched] = useState(false);
  const [goLiveDate, setGoLiveDate] = useState("");

  const chartersQ = useQuery({
    queryKey: ["/api/charters"],
    queryFn: () => api.get<CharterLite[]>("/api/charters"),
    enabled: open,
  });
  const freeCharters = (chartersQ.data ?? []).filter((c) => !c.projectId);

  // Master-DB lookups for the Department / Plant dropdowns (same sources as
  // the projects-page filters: employees.function and org_units).
  const departmentsQ = useQuery({
    queryKey: ["/api/departments"],
    queryFn: () => api.get<string[]>("/api/departments"),
    enabled: open,
    staleTime: 10 * 60_000,
  });
  const plantsQ = useQuery({
    queryKey: ["/api/plants"],
    queryFn: () => api.get<PlantLite[]>("/api/plants"),
    enabled: open,
    staleTime: 10 * 60_000,
  });
  // The signed-in creator's identity — used to default the Plant picker to
  // their own plant (org-unit code → matching plant label).
  const meQ = useQuery({
    queryKey: ["/api/users/me"],
    queryFn: () => api.get<MeLite>("/api/users/me"),
    enabled: open,
    staleTime: 10 * 60_000,
  });
  const departments = departmentsQ.data ?? [];
  const plants = plantsQ.data ?? [];

  // Default the Plant to the creator's own plant once both the plant list and
  // the identity have loaded — unless the user has already picked one.
  useEffect(() => {
    if (!open || plantTouched) return;
    const code = meQ.data?.plantCode;
    if (!code || !plants.length) return;
    const mine = plants.find((p) => p.code === code);
    if (mine) setPlant(mine.label);
  }, [open, plantTouched, meQ.data?.plantCode, plants]);

  // Default the Owner to the signed-in creator once their identity has loaded —
  // unless they've already picked someone else.
  useEffect(() => {
    if (!open || ownerTouched) return;
    const me = meQ.data;
    if (me?.name && me?.email) { setOwnerName(me.name); setOwnerEmail(me.email); }
  }, [open, ownerTouched, meQ.data?.name, meQ.data?.email]);

  function reset() {
    setName("");
    setCharterId(NO_CHARTER);
    setDepartment(NONE);
    setPlant(NONE);
    setPlantTouched(false);
    setOwnerName("");
    setOwnerEmail(null);
    setOwnerTouched(false);
    setGoLiveDate("");
  }

  async function run() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const payload = {
        name: name.trim(),
        charterId: charterId !== NO_CHARTER ? Number(charterId) : null,
        department: department !== NONE ? department : null,
        plant: plant !== NONE ? plant : null,
        goLiveDate: goLiveDate || null,
        owner: ownerEmail ? { name: ownerName, email: ownerEmail } : null,
      };
      const res = await fetch("/api/projects/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Could not create the project");
      toast({ title: "Project created", description: "Add milestones, tasks and owners inside the project." });
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
        <DialogContent className="p-0 gap-0 overflow-hidden max-w-lg">
          {/* Soft, light header. */}
          <div className="border-b border-blue-100 bg-gradient-to-br from-blue-50 to-indigo-50 px-6 py-5">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-blue-500 ring-1 ring-blue-100 shadow-sm">
                <FolderPlus size={22} />
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-lg font-bold text-slate-800">Create Project</DialogTitle>
                <DialogDescription className="sr-only">Create a new project</DialogDescription>
              </div>
            </div>
          </div>

          {/* Body */}
          <div className="max-h-[58vh] overflow-y-auto px-6 py-5 space-y-4">
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-50 text-blue-500"><Type size={13} /></span>
                Project name <span className="text-rose-400">*</span>
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Site B Cold Storage Upgrade"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              />
            </div>

            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-50 text-blue-500"><User size={13} /></span>
                Owner
                <HoverHint label="Defaults to you — the project creator. Pick a colleague to hand the project to them instead.">
                  <button type="button" aria-label="About the Owner field" className="text-muted-foreground hover:text-foreground">
                    <Info size={13} />
                  </button>
                </HoverHint>
              </label>
              <EmployeeCombobox
                value={ownerName || undefined}
                placeholder="Select owner"
                onSelect={(hit) => { setOwnerTouched(true); setOwnerName(hit.name); setOwnerEmail(hit.email); }}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-50 text-blue-500"><Building2 size={13} /></span>
                  Department <span className="text-muted-foreground font-normal text-[11px]">(optional)</span>
                </label>
                <Select value={department} onValueChange={setDepartment}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select department" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value={NONE}>None</SelectItem>
                    {departments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-50 text-blue-500"><Factory size={13} /></span>
                  Plant <span className="text-muted-foreground font-normal text-[11px]">(optional)</span>
                  <HoverHint label="Defaults to your plant — change it if this project belongs to another site.">
                    <button type="button" aria-label="About the Plant field" className="text-muted-foreground hover:text-foreground">
                      <Info size={13} />
                    </button>
                  </HoverHint>
                </label>
                <Select value={plant} onValueChange={(v) => { setPlantTouched(true); setPlant(v); }}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select plant" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value={NONE}>None</SelectItem>
                    {plants.map((p) => <SelectItem key={p.code} value={p.label}>{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-50 text-blue-500"><Flag size={13} /></span>
                Go-live date <span className="text-muted-foreground font-normal text-[11px]">(optional)</span>
                <HoverHint label="The date this project is meant to launch. Shown as a flag marker in the Gantt.">
                  <button type="button" aria-label="About the Go-live date field" className="text-muted-foreground hover:text-foreground">
                    <Info size={13} />
                  </button>
                </HoverHint>
              </label>
              <input
                type="date"
                value={goLiveDate}
                onChange={(e) => setGoLiveDate(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
              />
            </div>

            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-50 text-blue-500"><FileText size={13} /></span>
                Charter + NFA <span className="text-muted-foreground font-normal text-[11px]">(optional)</span>
              </label>
              <Select value={charterId} onValueChange={setCharterId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Link an existing charter" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CHARTER}>No charter — link later from the project</SelectItem>
                  {freeCharters.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.title || `Charter #${c.id}`}{c.status ? ` · ${c.status}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="flex items-start gap-1.5 rounded-lg bg-slate-50 px-2.5 py-2 text-[11px] leading-relaxed text-slate-600 ring-1 ring-slate-100">
                <Info size={13} className="mt-px shrink-0 text-blue-400" />
                <span>Linking a charter fills the project Overview (business case, scope, budget &amp; ROI). Starting from an approved PIF? Use "Convert to project" on the PIF instead.</span>
              </p>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 border-t border-border bg-slate-50/60 px-6 py-3">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              onClick={run}
              disabled={!name.trim() || busy}
              className="bg-blue-600 text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <FolderPlus className="h-4 w-4 mr-1.5" />} Create Project
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
