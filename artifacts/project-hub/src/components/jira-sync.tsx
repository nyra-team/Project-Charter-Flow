import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { api } from "../lib/extra-api";
import { DownloadCloud, UploadCloud, Loader2 } from "lucide-react";

type JiraProject = { id: string; key: string; name: string };

/**
 * "Import from Jira" — pick a Jira project; its issues are imported as PMO
 * tasks under a matching PMO project (idempotent, keyed by jira_key).
 * Calls POST /api/integrations/jira/import.
 */
const ALL_COMPONENTS = "__all__";

export function JiraImportButton({ onDone }: { onDone?: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<JiraProject[] | null>(null);
  const [selected, setSelected] = useState("");
  const [components, setComponents] = useState<string[]>([]);
  const [component, setComponent] = useState(ALL_COMPONENTS);
  const [loadingComps, setLoadingComps] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  async function openDialog() {
    setOpen(true);
    setProjects(null);
    setSelected("");
    setComponents([]);
    setComponent(ALL_COMPONENTS);
    setLoading(true);
    try {
      const list = await api.get<JiraProject[]>("/api/integrations/jira/projects");
      setProjects(list);
      if (list[0]) setSelected(list[0].key);
    } catch (e) {
      toast({ title: "Couldn't load Jira projects", description: (e as Error).message, variant: "destructive" });
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }

  // Load components whenever the selected Jira project changes.
  useEffect(() => {
    if (!open || !selected) return;
    let cancelled = false;
    setComponents([]);
    setComponent(ALL_COMPONENTS);
    setLoadingComps(true);
    api.get<string[]>(`/api/integrations/jira/projects/${encodeURIComponent(selected)}/components`)
      .then((list) => { if (!cancelled) setComponents(list); })
      .catch(() => { if (!cancelled) setComponents([]); })
      .finally(() => { if (!cancelled) setLoadingComps(false); });
    return () => { cancelled = true; };
  }, [open, selected]);

  async function runImport() {
    if (!selected) return;
    setBusy(true);
    try {
      const r = await api.post<{ created: number; updated: number; total: number }>(
        "/api/integrations/jira/import",
        { jiraProjectKey: selected, component: component === ALL_COMPONENTS ? undefined : component },
      );
      const scope = component === ALL_COMPONENTS ? "" : ` (${component})`;
      toast({ title: "Imported from Jira", description: `${r.total} issues${scope} — ${r.created} created, ${r.updated} updated.` });
      setOpen(false);
      onDone?.();
    } catch (e) {
      toast({ title: "Import failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={openDialog}>
        <DownloadCloud className="h-4 w-4 mr-1.5" /> Import from Jira
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Import from Jira</DialogTitle></DialogHeader>
          {loading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading Jira projects…
            </div>
          ) : projects && projects.length ? (
            <div className="space-y-3 py-2">
              <p className="text-sm text-muted-foreground">
                Pick a Jira project. Its issues import as tasks under a matching PMO project
                (re-running updates in place — no duplicates).
              </p>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Jira project</label>
                <Select value={selected} onValueChange={setSelected}>
                  <SelectTrigger><SelectValue placeholder="Select a Jira project" /></SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => (
                      <SelectItem key={p.key} value={p.key}>{p.key} — {p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Component {loadingComps ? "(loading…)" : "(optional)"}
                </label>
                <Select value={component} onValueChange={setComponent} disabled={loadingComps}>
                  <SelectTrigger><SelectValue placeholder="All components" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_COMPONENTS}>All components</SelectItem>
                    {components.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-4">No Jira projects available.</p>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={runImport} disabled={!selected || busy}>
              {busy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null} Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * "Export to Jira" — push this PMO project's tasks to Jira as issues
 * (create where unlinked, update where already linked). Calls
 * POST /api/integrations/jira/export.
 */
export function JiraExportButton({ projectId, onDone }: { projectId: number; onDone?: () => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  async function runExport() {
    setBusy(true);
    try {
      // Safe by default: creates Jira issues for unlinked tasks only; tasks
      // already linked to Jira are skipped (not overwritten).
      const r = await api.post<{ created: number; updated: number; skipped: number; errors: unknown[] }>(
        "/api/integrations/jira/export", { pmoProjectId: projectId },
      );
      const errN = Array.isArray(r.errors) ? r.errors.length : 0;
      const skip = r.skipped ? `, ${r.skipped} already linked (skipped)` : "";
      toast({
        title: "Exported to Jira",
        description: `${r.created} new issue${r.created === 1 ? "" : "s"} created${skip}${errN ? `, ${errN} failed` : ""}.`,
        variant: errN ? "destructive" : undefined,
      });
      onDone?.();
    } catch (e) {
      toast({ title: "Export failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={runExport} disabled={busy}>
      {busy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <UploadCloud className="h-4 w-4 mr-1.5" />}
      Export to Jira
    </Button>
  );
}
