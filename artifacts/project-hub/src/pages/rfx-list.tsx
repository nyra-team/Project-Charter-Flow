import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/extra-api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, ScrollText, Search, Trash2, Send, ChevronDown } from "lucide-react";

type RfxEvent = {
  id: number; type: string; title: string; summary: string | null;
  status: string; closesAt: string | null; currency: string;
  blindGrading: boolean; updatedAt: string;
};
type Vendor = { id: number; name: string; segment?: string | null };

const STATUS_TONE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  open: "bg-blue-500/15 text-blue-700",
  closed: "bg-amber-500/15 text-amber-700",
  evaluating: "bg-violet-500/15 text-violet-700",
  awarded: "bg-emerald-500/15 text-emerald-700",
  cancelled: "bg-rose-500/15 text-rose-700",
};

export default function RfxListPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const { data: rfx = [], isLoading } = useQuery({
    queryKey: ["rfx", status],
    queryFn: () => api.get<RfxEvent[]>(`/api/rfx${status ? `?status=${status}` : ""}`),
  });
  const filtered = rfx.filter(r => !q || r.title.toLowerCase().includes(q.toLowerCase()));

  const del = useMutation({
    mutationFn: (id: number) => api.del(`/api/rfx/${id}`),
    onSuccess: () => { toast({ title: "Sourcing event deleted" }); qc.invalidateQueries({ queryKey: ["rfx"] }); },
    onError: (e) => toast({ variant: "destructive", title: "Couldn't delete", description: (e as Error).message }),
  });
  const { data: vendors = [] } = useQuery({
    queryKey: ["vendors"],
    queryFn: () => api.get<Vendor[]>("/api/vendors"),
  });
  const float = useMutation({
    mutationFn: async ({ id, vendorIds, status: st }: { id: number; vendorIds: number[]; status: string }) => {
      if (st === "draft") await api.post(`/api/rfx/${id}/publish`, {});
      if (vendorIds.length) await api.post(`/api/rfx/${id}/invitations`, { vendorIds });
    },
    onSuccess: () => { toast({ title: "RFP floated to vendors", description: "Published and invitations sent." }); qc.invalidateQueries({ queryKey: ["rfx"] }); },
    onError: (e) => toast({ variant: "destructive", title: "Couldn't float", description: (e as Error).message }),
  });
  function onDelete(r: RfxEvent) {
    if (window.confirm(`Delete sourcing event “${r.title}”? This removes its invitations, envelopes, questions and scores. Awarded events can't be deleted.`)) {
      del.mutate(r.id);
    }
  }
  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">RFx</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Sourcing events — RFI / RFP / RFQ / e-auction. Two-envelope tech + commercial bidding, blind grading, dual-role unlock.
          </p>
        </div>
        <Link href="/rfx/new">
          <Button><Plus size={14} className="mr-1.5" /> New RFx</Button>
        </Link>
      </div>
      <div className="rounded-2xl border border-border bg-card/40 p-3 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by title" className="pl-8" />
        </div>
        <select value={status} onChange={e => setStatus(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
          <option value="">All statuses</option>
          {Object.keys(STATUS_TONE).map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      {isLoading ? <p className="text-sm text-muted-foreground p-6 text-center">Loading…</p> :
        filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center">
          <ScrollText size={28} className="mx-auto text-muted-foreground mb-3" />
          <p className="text-base font-semibold">No RFx events yet</p>
          <p className="text-sm text-muted-foreground mt-1">Start a sourcing event to invite vendors.</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-card/60 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr><th className="text-left p-3">Title</th><th className="text-left p-3">Type</th><th className="text-left p-3">Status</th><th className="text-left p-3"></th><th className="text-right p-3"></th></tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.id} className="border-t border-border hover:bg-card/40">
                  <td className="p-3"><Link href={`/rfx/${r.id}`}><span className="font-semibold hover:underline cursor-pointer">{r.title}</span></Link>{r.summary && <div className="text-xs text-muted-foreground line-clamp-1">{r.summary}</div>}</td>
                  <td className="p-3 uppercase font-mono text-xs">{r.type}</td>
                  <td className="p-3"><Badge className={STATUS_TONE[r.status] ?? ""}>{r.status}</Badge></td>
                  <td className="p-3 text-xs text-muted-foreground">{r.closesAt ? new Date(r.closesAt).toLocaleString() : "—"}</td>
                  <td className="p-3 text-right whitespace-nowrap">
                    {(r.status === "draft" || r.status === "open") && (
                      <FloatToVendors
                        rfx={r}
                        vendors={vendors}
                        busy={float.isPending}
                        onConfirm={(vendorIds) => float.mutate({ id: r.id, vendorIds, status: r.status })}
                      />
                    )}
                    <button
                      onClick={() => onDelete(r)}
                      disabled={del.isPending}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-40 align-middle"
                      title="Delete sourcing event"
                      aria-label={`Delete ${r.title}`}
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Per-row "Float to vendors" control — a dropdown of vendors to invite, then
// publishes (if draft) and sends the invitations.
function FloatToVendors({ rfx, vendors, onConfirm, busy }: {
  rfx: RfxEvent; vendors: Vendor[]; onConfirm: (vendorIds: number[]) => void; busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Set<number>>(new Set());
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Fixed-position coords for the portal panel — escapes the table's
  // overflow-x-auto wrapper that would otherwise clip an absolute dropdown.
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    if (!open) { setPos(null); return; }
    const place = () => {
      const r = ref.current?.getBoundingClientRect();
      if (r) setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    };
    place();
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  const list = vendors.filter(v => v.segment !== "blocked" && (!q || v.name.toLowerCase().includes(q.toLowerCase())));
  const toggle = (id: number) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const confirm = () => { if (sel.size === 0) return; onConfirm([...sel]); setOpen(false); setSel(new Set()); };

  return (
    <div className="relative inline-block text-left align-middle mr-2" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        disabled={busy}
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold text-primary border border-primary/30 hover:bg-primary/10 disabled:opacity-40"
        title="Float this RFP to vendors"
      >
        <Send size={13} /> Float to vendors <ChevronDown size={12} className={open ? "rotate-180 transition-transform" : "transition-transform"} />
      </button>
      {open && pos && createPortal(
        <div
          ref={panelRef}
          style={{ position: "fixed", top: pos.top, right: pos.right }}
          className="z-[100] w-64 rounded-lg border border-border bg-popover text-popover-foreground shadow-xl p-2"
        >
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search vendors…"
            className="w-full text-xs border border-border rounded px-2 py-1 mb-1 bg-background outline-none focus:ring-1 focus:ring-primary/40"
          />
          <div className="max-h-52 overflow-y-auto space-y-0.5">
            {list.length === 0 ? (
              <p className="text-xs text-muted-foreground px-2 py-3 text-center">No vendors found.</p>
            ) : list.map(v => (
              <label key={v.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-accent cursor-pointer text-xs">
                <input type="checkbox" checked={sel.has(v.id)} onChange={() => toggle(v.id)} className="accent-[hsl(var(--primary))]" />
                <span className="truncate">{v.name}</span>
              </label>
            ))}
          </div>
          <button
            onClick={confirm}
            disabled={sel.size === 0 || busy}
            className="mt-1.5 w-full inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-xs font-semibold text-primary-foreground bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send size={12} /> {rfx.status === "draft" ? "Float to" : "Invite"} {sel.size} vendor{sel.size === 1 ? "" : "s"}
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}
