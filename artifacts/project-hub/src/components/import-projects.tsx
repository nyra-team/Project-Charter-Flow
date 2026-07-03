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
export function ImportProjectsButton({ onDone }: { onDone?: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);

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
        body: JSON.stringify({ fileBase64: b64, fileName: file.name }),
      });
      const data = (await res.json().catch(() => ({}))) as { created?: number; error?: string };
      if (!res.ok) throw new Error(data.error || "Import failed");
      toast({ title: `Imported ${data.created ?? 0} project${data.created === 1 ? "" : "s"}`, description: "Milestones, tasks and subtasks were read straight from the file." });
      setOpen(false);
      setFile(null);
      onDone?.();
    } catch (e) {
      toast({ title: "Couldn't import", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <UploadCloud className="h-4 w-4 mr-1.5" /> Import Projects
      </Button>
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
