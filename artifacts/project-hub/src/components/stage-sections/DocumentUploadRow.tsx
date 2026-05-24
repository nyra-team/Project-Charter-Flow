import { useState, useRef, useCallback } from "react";
import { useCreateDocument } from "@workspace/api-client-react";
import { useUserStore } from "../../lib/store";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "../../lib/format";
import { CheckCircle2, FileText, FileUp, RefreshCw } from "lucide-react";
import { DocStatusBadge } from "./stage-helpers";

interface RequiredDoc {
 id: string;
 name: string;
 description: string;
 acceptedTypes: readonly string[];
 maxSizeMB: number;
}

interface UploadedDoc {
 id: number;
 name: string;
 approvalStatus: string;
 uploadedAt: string;
 fileType?: string | null;
 fileSize?: number | null;
}

interface DocumentUploadRowProps {
 doc: RequiredDoc;
 projectId: number;
 stageKey: string;
 existingDoc?: UploadedDoc;
 onUploaded: () => void;
}

export function DocumentUploadRow({
 doc,
 projectId,
 stageKey,
 existingDoc,
 onUploaded,
}: DocumentUploadRowProps) {
 const [dragOver, setDragOver] = useState(false);
 const [uploading, setUploading] = useState(false);
 const [uploadProgress, setUploadProgress] = useState(0);
 const fileInputRef = useRef<HTMLInputElement>(null);
 const createDocument = useCreateDocument();
 const { userId } = useUserStore();
 const { toast } = useToast();

 const handleFile = useCallback(
 (file: File) => {
 const maxBytes = doc.maxSizeMB * 1024 * 1024;
 if (file.size > maxBytes) {
 toast({ title: `File too large. Max ${doc.maxSizeMB}MB`, variant: "destructive" });
 return;
 }
 const ext = file.name.split(".").pop()?.toUpperCase() ?? "";
 if (!doc.acceptedTypes.includes(ext as never)) {
 toast({
 title: `Invalid file type. Allowed: ${doc.acceptedTypes.join(", ")}`,
 variant: "destructive",
 });
 return;
 }
 setUploading(true);
 setUploadProgress(0);

 fetch("/api/storage/uploads/request-url", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type || "application/octet-stream" }),
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
 if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 90));
 };
 xhr.onload = () => {
 if (xhr.status >= 200 && xhr.status < 300) {
 setUploadProgress(95);
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
 createDocument.mutate(
 {
 id: projectId,
 data: {
 name: doc.name,
 stage: stageKey,
 fileUrl: `/api/storage${objectPath}`,
 fileType: file.type,
 fileSize: file.size,
 uploadedBy: userId,
 description: `${doc.description} — ${file.name}`,
 },
 },
 {
 onSuccess: () => {
 setUploading(false);
 setUploadProgress(100);
 toast({ title: `${doc.name} uploaded successfully` });
 onUploaded();
 },
 onError: () => {
 setUploading(false);
 setUploadProgress(0);
 toast({ title: "Document record creation failed", variant: "destructive" });
 },
 },
 );
 })
 .catch(() => {
 setUploading(false);
 setUploadProgress(0);
 toast({ title: "Upload failed — storage unavailable", variant: "destructive" });
 });
 },
 [doc, projectId, stageKey, userId, createDocument, toast, onUploaded],
 );

 const handleDrop = (e: React.DragEvent) => {
 e.preventDefault();
 setDragOver(false);
 const file = e.dataTransfer.files[0];
 if (file) handleFile(file);
 };

 return (
 <div
 className="rounded-xl p-3 transition-all"
 style={{
 background: existingDoc ? "hsl(var(--success) / 0.12)" : dragOver ? "hsl(var(--primary) / 0.12)" : "hsl(var(--muted) / 0.4)",
 border: `1px solid ${existingDoc ? "hsl(var(--success) / 0.12)" : dragOver ? "hsl(var(--primary) / 0.12)" : "hsl(var(--muted) / 0.4)"}`,
 }}
 onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
 onDragLeave={() => setDragOver(false)}
 onDrop={handleDrop}
 >
 <div className="flex items-start gap-3">
 <div
 className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
 style={{ background: existingDoc ? "hsl(var(--success) / 0.12)" : "hsl(var(--primary) / 0.12)" }}
 >
 {existingDoc ? (
 <CheckCircle2 size={16} className="text-success" />
 ) : (
 <FileText size={16} className="text-primary" />
 )}
 </div>
 <div className="flex-1 min-w-0">
 <div className="flex items-center justify-between gap-2">
 <p className="text-sm font-semibold text-muted-foreground">{doc.name}</p>
 {existingDoc && <DocStatusBadge status={existingDoc.approvalStatus} />}
 </div>
 <p className="text-xs text-muted-foreground mt-0.5">{doc.description}</p>
 <p className="text-xs text-muted-foreground mt-0.5">
 Accepted: {doc.acceptedTypes.join(", ")} · Max {doc.maxSizeMB}MB
 </p>
 {existingDoc && (
 <p className="text-xs text-success mt-1">
 Uploaded {formatDate(existingDoc.uploadedAt)}
 {existingDoc.fileSize && ` · ${(existingDoc.fileSize / 1024).toFixed(0)}KB`}
 </p>
 )}
 </div>
 <div className="flex-shrink-0">
 {existingDoc ? (
 <button
 onClick={() => fileInputRef.current?.click()}
 className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all bg-success/10 text-success border border-success/30 hover:bg-success/20"
 >
 <RefreshCw size={11} />
 Replace
 </button>
 ) : (
 <button
 onClick={() => fileInputRef.current?.click()}
 disabled={uploading}
 className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-60 bg-primary hover:bg-primary/90 text-primary-foreground"
 >
 <FileUp size={11} />
 {uploading ? `${uploadProgress}%` : "Upload"}
 </button>
 )}
 </div>
 </div>

 {uploading && (
 <div className="mt-2">
 <div className="flex justify-between text-xs text-primary font-medium mb-1">
 <span>Uploading...</span>
 <span>{uploadProgress}%</span>
 </div>
 <div className="h-1.5 bg-primary/10 rounded-full overflow-hidden">
 <div
 className="h-full rounded-full transition-all duration-300 bg-primary"
 style={{ width: `${uploadProgress}%` }}
 />
 </div>
 </div>
 )}

 <input
 ref={fileInputRef}
 type="file"
 className="hidden"
 accept={doc.acceptedTypes.map((t) => `.${t.toLowerCase()}`).join(",")}
 onChange={(e) => {
 const file = e.target.files?.[0];
 if (file) handleFile(file);
 e.target.value = "";
 }}
 />
 </div>
 );
}
