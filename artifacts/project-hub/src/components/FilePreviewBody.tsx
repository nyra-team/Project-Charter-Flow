import { useEffect, useRef, useState } from "react";
import { FileText, Loader2, ExternalLink, Download } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// In-browser file preview — the shared rendering core behind the documents
// quick-view and the attachment paperclip quick-view. Handles pdf / image /
// text inline, docx via docx-preview, xlsx via sheet_to_html; files stored
// with no extension/MIME are byte-sniffed to recover docx/xlsx.

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

type PreviewKind = "docx" | "xlsx" | "pdf" | "image" | "text" | "other";

function kindOf(fileUrl?: string | null, fileType?: string | null): PreviewKind {
  const url = (fileUrl ?? "").toLowerCase().split("?")[0];
  const type = (fileType ?? "").toLowerCase();
  if (type === DOCX_MIME || url.endsWith(".docx")) return "docx";
  if (type === XLSX_MIME || url.endsWith(".xlsx")) return "xlsx";
  if (type === "application/pdf" || url.endsWith(".pdf")) return "pdf";
  if (type.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg|bmp)$/.test(url)) return "image";
  if (type.startsWith("text/") || /\.(txt|md|csv|json|log)$/.test(url)) return "text";
  return "other";
}

// Detect OOXML kind from raw bytes when fileType/extension are missing
// (e.g. files stored as /api/storage/objects/local-<uuid> with no extension
// and a null fileType). docx/xlsx/pptx are all ZIP containers — distinguish
// by the OOXML part names present in the archive.
async function sniffKind(blob: Blob): Promise<PreviewKind> {
  try {
    const buf = new Uint8Array(await blob.arrayBuffer());
    if (buf[0] !== 0x50 || buf[1] !== 0x4b) return "other"; // not a ZIP ("PK")
    let s = "";
    for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
    if (s.includes("word/document.xml") || s.includes("word/")) return "docx";
    if (s.includes("xl/workbook.xml") || s.includes("xl/")) return "xlsx";
  } catch { /* fall through */ }
  return "other";
}

export function FilePreviewBody({ url, name, fileType, downloadHref, downloadName }: {
  /** URL to fetch and render. */
  url?: string | null;
  /** Display name (iframe title / img alt). */
  name: string;
  fileType?: string | null;
  /** Fallback links shown when inline preview isn't possible. Defaults to `url`. */
  downloadHref?: string;
  downloadName?: string;
}) {
  const kind = kindOf(url, fileType);
  const docxRef = useRef<HTMLDivElement>(null);
  const [resolvedKind, setResolvedKind] = useState<PreviewKind>(kind);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errMsg, setErrMsg] = useState<string>("");
  const [blobUrl, setBlobUrl] = useState<string>("");
  const [textContent, setTextContent] = useState<string>("");
  const [sheetHtml, setSheetHtml] = useState<string>("");
  const fallbackHref = downloadHref ?? url ?? "#";

  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";

    async function load() {
      if (!url) { setStatus("error"); setErrMsg("This item has no file attached."); return; }
      setStatus("loading");
      setResolvedKind(kind);
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (cancelled) return;

        // Resolve the real kind: when fileType/extension are absent the
        // initial kind is "other" — sniff the bytes to recover docx/xlsx.
        let k: PreviewKind = kind;
        if (k === "other") {
          k = await sniffKind(blob);
          if (cancelled) return;
        }
        setResolvedKind(k);

        if (k === "docx") {
          // Wait a tick so the modal's container ref is mounted.
          const container = docxRef.current;
          if (!container) throw new Error("Preview container unavailable");
          container.innerHTML = "";
          const { renderAsync } = await import("docx-preview");
          if (cancelled) return;
          await renderAsync(blob, container, undefined, {
            className: "docx-preview",
            inWrapper: true,
            ignoreWidth: false,
            ignoreHeight: false,
            breakPages: true,
            useBase64URL: true,
          });
        } else if (k === "xlsx") {
          const XLSX = await import("xlsx");
          const wb = XLSX.read(await blob.arrayBuffer(), { type: "array" });
          if (cancelled) return;
          let html = "";
          for (const name of wb.SheetNames) {
            const ws = wb.Sheets[name];
            if (!ws) continue;
            html += `<div class="xlsx-sheet-title">${name}</div>` +
              XLSX.utils.sheet_to_html(ws, { editable: false });
          }
          setSheetHtml(html || "<p>This workbook has no sheets.</p>");
        } else if (k === "text") {
          const txt = await blob.text();
          if (cancelled) return;
          setTextContent(txt);
        } else if (k === "pdf" || k === "image") {
          objectUrl = URL.createObjectURL(blob);
          if (cancelled) { URL.revokeObjectURL(objectUrl); return; }
          setBlobUrl(objectUrl);
        } else {
          setStatus("error");
          setErrMsg("In-browser preview isn't supported for this file type.");
          return;
        }
        if (!cancelled) setStatus("ready");
      } catch (e) {
        if (cancelled) return;
        setStatus("error");
        setErrMsg(e instanceof Error ? e.message : "Failed to load preview");
      }
    }

    // Defer one frame so the docx container is in the DOM before render.
    const t = setTimeout(load, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  return (
    <div className="flex-1 min-h-0 overflow-auto scrollbar-thin bg-muted/40">
      {status === "loading" && (
        <div className="h-full flex items-center justify-center text-muted-foreground gap-2">
          <Loader2 size={18} className="animate-spin" /> <span className="text-sm">Loading preview…</span>
        </div>
      )}

      {status === "error" && (
        <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-6">
          <FileText size={32} className="text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground max-w-md">{errMsg}</p>
          {url && (
            <div className="flex items-center gap-2">
              <a href={fallbackHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold bg-muted text-foreground hover:bg-accent transition-colors">
                <ExternalLink size={13} /> Open in new tab
              </a>
              <a href={fallbackHref} download={downloadName ?? name} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
                <Download size={13} /> Download
              </a>
            </div>
          )}
        </div>
      )}

      {/* DOCX always-mounted target (rendered into even while "loading") */}
      <div className={resolvedKind === "docx" && status !== "error" ? "flex justify-center py-4" : "hidden"}>
        <div ref={docxRef} className="docx-preview-host" />
      </div>

      {resolvedKind === "xlsx" && status === "ready" && (
        <div className="p-4 overflow-auto">
          <style>{`
            .xlsx-preview table { border-collapse: collapse; margin-bottom: 1.5rem; font-size: 12px; background: #fff; }
            .xlsx-preview td, .xlsx-preview th { border: 1px solid #d0d7de; padding: 3px 8px; white-space: nowrap; color: #1f2328; }
            .xlsx-preview .xlsx-sheet-title { font-weight: 700; color: #1E40AF; margin: 0.25rem 0 0.5rem; font-size: 13px; }
          `}</style>
          <div className="xlsx-preview" dangerouslySetInnerHTML={{ __html: sheetHtml }} />
        </div>
      )}

      {resolvedKind === "pdf" && status === "ready" && blobUrl && (
        <iframe src={blobUrl} title={name} className="w-full h-full border-0" />
      )}

      {resolvedKind === "image" && status === "ready" && blobUrl && (
        <div className="h-full flex items-center justify-center p-4">
          <img src={blobUrl} alt={name} className="max-w-full max-h-full object-contain rounded-md shadow-sm" />
        </div>
      )}

      {resolvedKind === "text" && status === "ready" && (
        <pre className="text-xs font-mono whitespace-pre-wrap p-5 text-foreground">{textContent}</pre>
      )}
    </div>
  );
}

/** Self-contained quick-view dialog for a single file (attachments, chat files
 *  — anything with just a url + name). The documents repository has its own
 *  richer wrapper with a version switcher; both render FilePreviewBody. */
export function FilePreviewModal({ name, url, fileType, onClose }: {
  name: string;
  url?: string | null;
  fileType?: string | null;
  onClose: () => void;
}) {
  return (
    <FilePreviewModalShell name={name} url={url} onClose={onClose}>
      <FilePreviewBody url={url} name={name} fileType={fileType} />
    </FilePreviewModalShell>
  );
}

function FilePreviewModalShell({ name, url, onClose, children }: {
  name: string; url?: string | null; onClose: () => void; children: React.ReactNode;
}) {
  return (
    <Dialog open={true} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-5xl w-[90vw] h-[88vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 py-3 border-b border-border/60 flex-shrink-0">
          <DialogTitle className="flex items-center gap-2 tracking-tight text-base pr-10">
            <FileText size={16} className="text-primary" />
            <span className="truncate">{name}</span>
            {url && (
              <a
                href={url}
                download={name}
                className="ml-auto mr-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold text-muted-foreground hover:text-primary hover:bg-accent transition-colors"
                title="Download"
              >
                <Download size={13} /> Download
              </a>
            )}
          </DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
