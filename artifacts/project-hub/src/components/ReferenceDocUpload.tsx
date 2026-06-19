import { useState, useRef } from "react";
import { Paperclip, Sparkles, Loader2, FileText, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// Paperclip upload for the Charter / e-NFA wizards. The user attaches any
// project-related document / email; it's uploaded via the presigned flow, its
// text pulled out server-side (POST /api/ai/extract-doc-text), and handed back
// via onText so the page passes it as `sourceText` to the AI draft — grounding
// the description and other fields. Empty/unsupported files degrade silently.
const ACCEPT = ".pdf,.docx,.doc,.xlsx,.xls,.txt,.csv,.eml,.msg";
const MAX_MB = 15;

export function ReferenceDocUpload({ onText }: { onText: (text: string) => void }) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [status, setStatus] = useState<"" | "ok" | "empty">("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  async function extract(meta: { fileUrl: string; fileName: string; fileType: string; fileSize: number }) {
    setExtracting(true);
    setStatus("");
    try {
      const res = await fetch("/api/ai/extract-doc-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(meta),
      });
      const d = (await res.json().catch(() => ({}))) as { extracted?: boolean; text?: string };
      if (d?.extracted && d.text) { onText(d.text); setStatus("ok"); }
      else { onText(""); setStatus("empty"); }
    } catch {
      onText(""); setStatus("empty");
    } finally {
      setExtracting(false);
    }
  }

  async function handleFile(file: File) {
    if (file.size > MAX_MB * 1024 * 1024) {
      toast({ title: `File too large. Max ${MAX_MB}MB`, variant: "destructive" });
      return;
    }
    setFileName(file.name);
    setUploading(true);
    setStatus("");
    try {
      const r = await fetch("/api/storage/uploads/request-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type || "application/octet-stream" }),
      });
      if (!r.ok) throw new Error("Failed to get upload URL");
      const { uploadURL, objectPath } = (await r.json()) as { uploadURL: string; objectPath: string };
      const put = await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!put.ok) throw new Error(`Storage PUT failed: ${put.status}`);
      setUploading(false);
      await extract({
        fileUrl: `/api/storage${objectPath}`,
        fileName: file.name,
        fileType: file.type || "application/octet-stream",
        fileSize: file.size,
      });
    } catch (e) {
      setUploading(false);
      setFileName(null);
      toast({ title: e instanceof Error ? e.message : "Upload failed", variant: "destructive" });
    }
  }

  const busy = uploading || extracting;

  return (
    <div>
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        title="Upload any project related documents, emails etc for the AI to get the context and draft the description & other fields"
        className="group inline-flex items-center gap-2 pl-1.5 pr-3 h-8 rounded-full bg-white border border-slate-200 text-xs font-semibold text-primary shadow-sm hover:border-primary/40 hover:shadow-md transition-all disabled:opacity-60 disabled:cursor-default"
      >
        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-gradient-to-br from-primary to-indigo-500 text-white shadow-sm group-hover:scale-105 transition-transform">
          {busy
            ? <Loader2 size={13} className="animate-spin" />
            : <Paperclip size={13} className="-rotate-45" />}
        </span>
        {uploading ? "Uploading…" : extracting ? "Reading…" : "Attach Related Docs and Emails for AI Context"}
      </button>

      {status === "ok" && fileName && (
        <div className="flex items-center justify-between gap-2 mt-1.5 px-3 py-1.5 rounded-md bg-success/10 border border-success/30">
          <span className="flex items-center gap-1.5 min-w-0 text-xs text-success">
            <Sparkles size={12} className="flex-shrink-0" />
            <FileText size={12} className="flex-shrink-0" />
            <span className="truncate text-foreground font-medium">{fileName}</span>
            <span className="flex-shrink-0">— captured for the AI draft</span>
          </span>
          <button
            type="button"
            onClick={() => { setFileName(null); setStatus(""); onText(""); }}
            className="p-0.5 rounded text-muted-foreground hover:text-destructive flex-shrink-0"
            title="Remove"
          >
            <X size={13} />
          </button>
        </div>
      )}
      {status === "empty" && fileName && (
        <p className="text-xs text-warn mt-1">Couldn't read text from this file — the draft will rely on your typed fields.</p>
      )}

      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={ACCEPT}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
      />
    </div>
  );
}
