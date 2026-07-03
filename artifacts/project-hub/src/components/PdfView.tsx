// PdfView — inline PDF preview. Fetches through the app's authed fetch (same
// pattern as openApiFile) and renders the blob in an <iframe> via the browser's
// native PDF viewer. Used for signed Documenso artifacts, where the regenerated
// DocxView would show an unsigned draft.
import { useEffect, useState } from "react";
import { FileText, Loader2 } from "lucide-react";

export function PdfView({ url, height = "70vh", className }: {
  url: string;
  height?: string;
  className?: string;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    let created: string | null = null;
    setBlobUrl(null); setErr("");
    (async () => {
      try {
        // no-store: stored objects can be rewritten in place (e.g. cert strip);
        // a stale HTTP-cached copy must never win.
        const res = await fetch(url, { credentials: "include", cache: "no-store" });
        if (!res.ok) throw new Error(`Failed to load PDF (HTTP ${res.status})`);
        const blob = await res.blob();
        if (cancelled) return;
        created = URL.createObjectURL(blob.type === "application/pdf" ? blob : new Blob([blob], { type: "application/pdf" }));
        setBlobUrl(created);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Failed to load PDF");
      }
    })();
    return () => { cancelled = true; if (created) URL.revokeObjectURL(created); };
  }, [url]);

  return (
    <div className={`flex flex-col rounded-lg border border-border bg-muted/40 overflow-hidden resize-y min-h-[260px] ${className ?? ""}`} style={{ height }}>
      {!blobUrl && !err && (
        <div className="flex-1 flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 size={18} className="animate-spin" /> <span className="text-sm">Loading signed document…</span>
        </div>
      )}
      {err && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
          <FileText size={32} className="text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground max-w-md">{err}</p>
        </div>
      )}
      {blobUrl && <iframe src={blobUrl} title="Signed document" className="flex-1 min-h-0 w-full border-0" />}
    </div>
  );
}
