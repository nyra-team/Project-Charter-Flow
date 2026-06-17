import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { copyToClipboard } from "../lib/clipboard";
import { Link2, ClipboardCheck, ExternalLink, Share2, Eye } from "lucide-react";

// Google-Drive-style share for a document. Shows the stable link in a selectable
// field (so it's always copyable even when the Clipboard API is blocked on
// plain-HTTP LAN). "Anyone with the link can view" (read) or "can edit" — the
// editor link carries a per-doc token so `curl -T file "<link>"` writes a new
// version. The link always serves the latest version.
export function ShareDialog({
  docId, docName, onClose,
}: {
  docId: number;
  docName: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const [access, setAccess] = useState<"view" | "edit">("view");
  const [editToken, setEditToken] = useState<string>("");

  const base = `${typeof window !== "undefined" ? window.location.origin : ""}/api/documents/${docId}/raw`;
  const url = access === "edit" && editToken ? `${base}?t=${editToken}` : base;

  // Mint the per-doc editor token (lazily) when the user picks "can edit".
  useEffect(() => {
    if (access !== "edit" || editToken) return;
    fetch(`/api/documents/${docId}/share`)
      .then(r => (r.ok ? r.json() : { editToken: "" }))
      .then((d: { editToken?: string }) => setEditToken(d.editToken || ""))
      .catch(() => setEditToken(""));
  }, [access, editToken, docId]);

  // Re-select the link whenever it changes so Ctrl/Cmd+C grabs the current one.
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, [url]);

  async function copy() {
    const ok = await copyToClipboard(url);
    if (ok) { setCopied(true); toast({ title: "Link copied" }); setTimeout(() => setCopied(false), 1500); }
    else { inputRef.current?.focus(); inputRef.current?.select(); toast({ title: "Press Ctrl/Cmd+C to copy the selected link", variant: "destructive" }); }
  }

  return (
    <Dialog open onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 tracking-tight">
            <Share2 size={16} className="text-primary" /> Share “{docName}”
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Eye size={12} className="text-muted-foreground" />
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Anyone with the link</span>
            <select
              value={access}
              onChange={e => { setAccess(e.target.value as "view" | "edit"); setCopied(false); }}
              className="text-xs border border-input bg-background rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-ring/40"
            >
              <option value="view">can view</option>
              <option value="edit">can edit</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <input
              ref={inputRef}
              readOnly
              value={url}
              onFocus={e => e.currentTarget.select()}
              className="flex-1 text-xs font-mono border border-input bg-muted/40 rounded-md px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-ring/40 select-all"
            />
            <button
              onClick={copy}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm flex-shrink-0"
            >
              {copied ? <ClipboardCheck size={13} /> : <Link2 size={13} />} {copied ? "Copied" : "Copy"}
            </button>
            <a href={url} target="_blank" rel="noreferrer" className="p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-primary transition-colors flex-shrink-0" title="Open link">
              <ExternalLink size={14} />
            </a>
          </div>

          <p className="text-[11px] text-muted-foreground">
            {access === "edit"
              ? <>Editors can replace the file via this link, e.g. <code className="font-mono">curl -T file "&lt;link&gt;"</code>. Rotating the server secret revokes all editor links.</>
              : <>Read-only. Always serves the latest version; works in any browser and with <code className="font-mono">wget</code>.</>}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
