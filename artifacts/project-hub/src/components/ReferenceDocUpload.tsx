import { useState } from "react";
import { FileDropzone, type UploadedFileMeta } from "@/components/ui/file-dropzone";
import { Sparkles, Loader2 } from "lucide-react";

// Optional reference-document upload for the Charter / e-NFA wizards. The file
// is uploaded via the normal presigned flow, its text pulled out server-side
// (POST /api/ai/extract-doc-text), and handed back via onText so the page can
// pass it as `sourceText` to the AI draft. Empty/unsupported files degrade
// silently — the draft just falls back to the typed fields.
export function ReferenceDocUpload({ onText }: { onText: (text: string) => void }) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [status, setStatus] = useState<"" | "ok" | "empty">("");

  async function extract(meta: UploadedFileMeta) {
    setFileName(meta.fileName);
    setExtracting(true);
    setStatus("");
    try {
      const res = await fetch("/api/ai/extract-doc-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileUrl: meta.fileUrl, fileName: meta.fileName,
          fileType: meta.fileType, fileSize: meta.fileSize,
        }),
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

  return (
    <div>
      <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
        Reference document
        <span className="font-normal normal-case tracking-normal text-muted-foreground/70">— optional, helps the AI</span>
      </label>
      <p className="text-[11px] text-muted-foreground mt-0.5 mb-1">
        RFP, quotation or prior NFA — the AI reads it to draft the fields below.
      </p>
      <FileDropzone
        compact
        accept=".pdf,.docx,.doc,.xlsx,.xls,.txt,.csv"
        maxSizeMB={15}
        currentFileName={fileName}
        onUploaded={extract}
        onCleared={() => { setFileName(null); setStatus(""); onText(""); }}
      />
      {extracting && (
        <p className="text-xs text-primary mt-1 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Reading document…</p>
      )}
      {status === "ok" && (
        <p className="text-xs text-success mt-1 flex items-center gap-1.5"><Sparkles size={12} /> Captured — the AI draft will incorporate this document.</p>
      )}
      {status === "empty" && fileName && (
        <p className="text-xs text-warn mt-1">Couldn't read text from this file — the draft will rely on your typed fields.</p>
      )}
    </div>
  );
}
