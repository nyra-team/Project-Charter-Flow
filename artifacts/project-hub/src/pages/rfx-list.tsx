import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/extra-api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, ScrollText, Search, Trash2 } from "lucide-react";

type RfxEvent = {
  id: number; type: string; title: string; summary: string | null;
  status: string; closesAt: string | null; currency: string;
  blindGrading: boolean; updatedAt: string;
};

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
              <tr><th className="text-left p-3">Title</th><th className="text-left p-3">Type</th><th className="text-left p-3">Status</th><th className="text-left p-3">Closes</th><th className="text-left p-3">Blind</th><th className="text-right p-3 w-12"></th></tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.id} className="border-t border-border hover:bg-card/40">
                  <td className="p-3"><Link href={`/rfx/${r.id}`}><span className="font-semibold hover:underline cursor-pointer">{r.title}</span></Link>{r.summary && <div className="text-xs text-muted-foreground line-clamp-1">{r.summary}</div>}</td>
                  <td className="p-3 uppercase font-mono text-xs">{r.type}</td>
                  <td className="p-3"><Badge className={STATUS_TONE[r.status] ?? ""}>{r.status}</Badge></td>
                  <td className="p-3 text-xs text-muted-foreground">{r.closesAt ? new Date(r.closesAt).toLocaleString() : "—"}</td>
                  <td className="p-3">{r.blindGrading ? <Badge variant="outline">blind</Badge> : <span className="text-muted-foreground text-xs">named</span>}</td>
                  <td className="p-3 text-right">
                    <button
                      onClick={() => onDelete(r)}
                      disabled={del.isPending}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-40"
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
