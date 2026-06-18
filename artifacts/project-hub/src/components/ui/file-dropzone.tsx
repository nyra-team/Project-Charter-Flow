import { useState, useRef, useCallback } from "react";
import { Upload, FileText, Loader2, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export interface UploadedFileMeta {
  fileUrl: string;
  fileType: string;
  fileSize: number;
  fileName: string;
}

interface FileDropzoneProps {
  onUploaded: (meta: UploadedFileMeta) => void;
  onCleared?: () => void;
  /** HTML accept attribute, e.g. ".pdf,.docx,.xlsx". Only filters the picker dialog; server still enforces real MIME validation. */
  accept?: string;
  /** Client-side max size in MB. Defaults to 25 to mirror the server's standard cap. */
  maxSizeMB?: number;
  /** When set, shows the attached-file pill in place of the dropzone. */
  currentFileName?: string | null;
  /** Slim single-line variant — smaller padding/icon, for tight layouts. */
  compact?: boolean;
}

export function FileDropzone({
  onUploaded,
  onCleared,
  accept,
  maxSizeMB = 25,
  currentFileName,
  compact = false,
}: FileDropzoneProps) {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleFile = useCallback(
    (file: File) => {
      const maxBytes = maxSizeMB * 1024 * 1024;
      if (file.size > maxBytes) {
        toast({ title: `File too large. Max ${maxSizeMB}MB`, variant: "destructive" });
        return;
      }
      setUploading(true);
      setProgress(0);

      fetch("/api/storage/uploads/request-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: file.name,
          size: file.size,
          contentType: file.type || "application/octet-stream",
        }),
      })
        .then(async (r) => {
          if (!r.ok) throw new Error("Failed to get upload URL");
          return r.json() as Promise<{ uploadURL: string; objectPath: string }>;
        })
        .then(
          ({ uploadURL, objectPath }) =>
            new Promise<string>((resolve, reject) => {
              const xhr = new XMLHttpRequest();
              xhr.open("PUT", uploadURL);
              xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
              xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 95));
              };
              xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                  setProgress(100);
                  resolve(objectPath);
                } else {
                  reject(new Error(`Storage PUT failed: ${xhr.status}`));
                }
              };
              xhr.onerror = () => reject(new Error("Network error during upload"));
              xhr.send(file);
            }),
        )
        .then((objectPath) => {
          setUploading(false);
          onUploaded({
            fileUrl: `/api/storage${objectPath}`,
            fileType: file.type || "application/octet-stream",
            fileSize: file.size,
            fileName: file.name,
          });
        })
        .catch((e) => {
          setUploading(false);
          setProgress(0);
          toast({
            title: e instanceof Error ? e.message : "Upload failed",
            variant: "destructive",
          });
        });
    },
    [maxSizeMB, onUploaded, toast],
  );

  if (currentFileName) {
    return (
      <div className="flex items-center justify-between gap-2 p-3 rounded-md bg-success/10 border border-success/30">
        <div className="flex items-center gap-2 min-w-0">
          <FileText size={14} className="text-success flex-shrink-0" />
          <span className="text-sm font-medium text-foreground truncate">{currentFileName}</span>
        </div>
        <button
          type="button"
          onClick={() => onCleared?.()}
          className="p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors flex-shrink-0"
          title="Remove and upload a different file"
        >
          <X size={13} />
        </button>
      </div>
    );
  }

  return (
    <>
      <div
        onClick={() => !uploading && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          if (!uploading) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (uploading) return;
          const file = e.dataTransfer.files[0];
          if (file) handleFile(file);
        }}
        className={`rounded-md border-2 border-dashed text-center transition-colors ${compact ? "p-2" : "p-5"} ${
          uploading
            ? "border-muted bg-muted/40 cursor-default"
            : dragOver
              ? "border-primary bg-primary/10 cursor-copy"
              : "border-border bg-muted/30 hover:border-primary/50 hover:bg-primary/5 cursor-pointer"
        }`}
      >
        {uploading ? (
          <div className="flex flex-col items-center gap-2">
            <Loader2 size={20} className="text-primary animate-spin" />
            <p className="text-xs font-medium text-primary">Uploading… {progress}%</p>
            <div className="w-full h-1 bg-primary/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        ) : compact ? (
          <div className="flex items-center justify-center gap-1.5">
            <Upload size={14} className={dragOver ? "text-primary" : "text-muted-foreground"} />
            <p className="text-[11px] font-medium text-foreground">
              <span className="text-primary">Click to choose</span> or drag &amp; drop · up to {maxSizeMB}MB
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1.5">
            <Upload
              size={20}
              className={dragOver ? "text-primary" : "text-muted-foreground"}
            />
            <p className="text-xs font-medium text-foreground">
              <span className="text-primary">Click to choose</span> or drag &amp; drop a file
            </p>
            <p className="text-[10px] text-muted-foreground">Up to {maxSizeMB}MB</p>
          </div>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={accept}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />
    </>
  );
}
