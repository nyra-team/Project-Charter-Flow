import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { UploadCloud, Loader2 } from "lucide-react";

/**
 * "Import Projects" — upload a file in any format (Excel, CSV, JSON, PDF, Word,
 * text). The server extracts the projects + milestones and generates the
 * schedule. Sits next to "Import from Jira". POST /api/projects/import.
 */
const CATEGORIES = ["CAPEX", "OPEX", "NPL", "NPD", "CIP", "IT"];

export function ImportProjectsButton({ onDone }: { onDone?: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState("");

  async function run() {
    if (!file) return;
    setBusy(true);
    try {
      const b64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
        r.onerror = () => reject(new Error("Could not read the file"));
        r.readAsDataURL(file);
      });
      const res = await fetch("/api/projects/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileBase64: b64, fileName: file.name, category: category || undefined }),
      });
      const data = (await res.json().catch(() => ({}))) as { created?: number; error?: string };
      if (!res.ok) throw new Error(data.error || "Import failed");
      toast({ title: `Imported ${data.created ?? 0} project${data.created === 1 ? "" : "s"}`, description: "Milestones, tasks and subtasks were read straight from the file." });
      setOpen(false);
      setFile(null);
      setCategory("");
      onDone?.();
    } catch (e) {
      toast({ title: "Couldn't import", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Import projects from a file"
        className="h-6 px-1.5 rounded-md flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
      >
        <UploadCloud size={13} /> Import Projects
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Import projects</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Upload a file in any format — Excel, CSV, JSON, PDF, Word, or plain text. We read it and
              import every project, milestone, task and subtask exactly as written — nothing is generated or added.
            </p>
            <input
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-primary-foreground file:text-sm hover:file:bg-primary/90 cursor-pointer"
            />
            {file && <p className="text-xs text-muted-foreground">Selected: {file.name}</p>}
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="import-category">Category</label>
              <select
                id="import-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="form-input-sm w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              >
                <option value="">Uncategorised</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <p className="text-xs text-muted-foreground">Every project in the file is filed under this heading on the board.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={run} disabled={!file || busy}>
              {busy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null} Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
