import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Plus, RefreshCw, ShoppingCart, Truck, Ban, ChevronRight, ExternalLink, Trash2,
} from "lucide-react";
import { formatDate } from "../lib/format";

// ─── Types (mirror server-side shapes) ──────────────────────────────────────

type LineItem = {
  description: string;
  qty: number;
  uom: string;
  unitPrice: number;
  materialCode?: string;
};

type PurchaseRequisition = {
  id: number;
  projectId: number | null;
  charterId: number | null;
  vendorId: number | null;
  requestedById: string | null;
  sapPrNumber: string | null;
  lineItems: LineItem[];
  totalAmount: string;
  currency: string;
  status: string;
  sapStatus: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type PurchaseOrder = {
  id: number;
  prId: number | null;
  vendorId: number | null;
  sapPoNumber: string | null;
  lineItems: LineItem[];
  totalAmount: string;
  currency: string;
  status: string;
  sapStatus: string | null;
  deliveryDate: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
};

type PrWithPos = PurchaseRequisition & { purchaseOrders?: PurchaseOrder[] };

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  if (!res.ok) throw new Error((await res.text()) || `${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

// ─── Procurement tab ────────────────────────────────────────────────────────

export function ProcurementTab({ projectId }: { projectId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [newOpen, setNewOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const listKey = ["prs", projectId] as const;
  const { data: prs, isLoading } = useQuery({
    queryKey: listKey,
    queryFn: () => fetchJson<PurchaseRequisition[]>(`/api/prs?projectId=${projectId}`),
    refetchInterval: 60_000,
  });

  const { data: detail } = useQuery({
    queryKey: ["prs", projectId, selectedId],
    queryFn: () => fetchJson<PrWithPos>(`/api/prs/${selectedId}`),
    enabled: selectedId != null,
  });

  const refresh = useMutation({
    mutationFn: (id: number) => fetchJson<PrWithPos>(`/api/prs/${id}/refresh`, { method: "POST", body: "{}" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: listKey });
      qc.invalidateQueries({ queryKey: ["prs", projectId, selectedId] });
      toast({ title: "Synced from SAP", description: "Status pulled from the adapter." });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Sync failed", description: e.message }),
  });

  const convert = useMutation({
    mutationFn: (id: number) => fetchJson<PurchaseOrder>(`/api/prs/${id}/convert-to-po`, { method: "POST", body: "{}" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: listKey });
      qc.invalidateQueries({ queryKey: ["prs", projectId, selectedId] });
      toast({ title: "PO issued", description: "SAP returned a PO number — visible on the PR row." });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Convert failed", description: e.message }),
  });

  const cancel = useMutation({
    mutationFn: (id: number) => fetchJson<PurchaseRequisition>(`/api/prs/${id}/cancel`, { method: "POST", body: "{}" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: listKey });
      qc.invalidateQueries({ queryKey: ["prs", projectId, selectedId] });
      toast({ title: "PR cancelled" });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Cancel failed", description: e.message }),
  });

  const del = useMutation({
    mutationFn: (id: number) => fetchJson<void>(`/api/prs/${id}`, { method: "DELETE" }),
    onSuccess: (_void, id) => {
      qc.invalidateQueries({ queryKey: listKey });
      if (selectedId === id) setSelectedId(null);
      toast({ title: "PR deleted" });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Couldn't delete PR", description: e.message }),
  });
  function onDeletePr(pr: PurchaseRequisition) {
    if (window.confirm(`Delete purchase requisition #${pr.id}? Blocked if it has been converted to a PO.`)) {
      del.mutate(pr.id);
    }
  }

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => fetchJson<PurchaseRequisition>("/api/prs", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: listKey });
      setNewOpen(false);
      toast({ title: "PR submitted to SAP", description: `Reference: ${row.sapPrNumber}` });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Submit failed", description: e.message }),
  });

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-base font-semibold tracking-tight text-foreground">Procurement</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Purchase Requisitions submitted via SAP adapter ({getSapMode()}). Statuses auto-refresh every 2 minutes.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setNewOpen(true)}
          className="btn-glossy-cta inline-flex items-center gap-1.5 px-3 h-9 rounded-md text-sm font-semibold"
          data-testid="btn-new-pr"
        >
          <Plus size={14} />
          New PR
        </button>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      ) : !prs || prs.length === 0 ? (
        <div className="glass-surface rounded-2xl p-12 text-center">
          <ShoppingCart size={28} className="mx-auto text-muted-foreground mb-3" />
          <p className="text-base font-semibold text-card-foreground">No PRs yet for this project</p>
          <p className="text-sm text-muted-foreground mt-1">
            Submit a PR to SAP from here — the mock adapter cycles through pending → approved → po_issued → received.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {prs.map(pr => (
            <PrRow
              key={pr.id}
              pr={pr}
              onOpen={() => setSelectedId(pr.id)}
              onRefresh={() => refresh.mutate(pr.id)}
              onConvert={() => convert.mutate(pr.id)}
              onCancel={() => cancel.mutate(pr.id)}
              onDelete={() => onDeletePr(pr)}
              busy={refresh.isPending || convert.isPending || cancel.isPending || del.isPending}
            />
          ))}
        </div>
      )}

      {/* Detail dialog */}
      <Dialog open={selectedId != null} onOpenChange={(open) => !open && setSelectedId(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{detail?.sapPrNumber ?? "PR detail"}</DialogTitle>
            <DialogDescription>
              {detail
                ? `${detail.lineItems.length} line${detail.lineItems.length === 1 ? "" : "s"} · ${detail.currency} ${Number(detail.totalAmount).toLocaleString("en-IN")}`
                : "Loading…"}
            </DialogDescription>
          </DialogHeader>
          {detail ? (
            <div className="space-y-4">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground border-b border-border">
                    <tr>
                      <th className="pb-2 text-left">Material</th>
                      <th className="pb-2 text-left">Description</th>
                      <th className="pb-2 text-right">Qty</th>
                      <th className="pb-2 text-left">UoM</th>
                      <th className="pb-2 text-right">Unit ₹</th>
                      <th className="pb-2 text-right">Total ₹</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.lineItems.map((l, i) => (
                      <tr key={i} className="border-b border-border/40">
                        <td className="py-2 font-mono text-[11px]">{l.materialCode ?? "—"}</td>
                        <td className="py-2">{l.description}</td>
                        <td className="py-2 text-right tabular-nums">{l.qty}</td>
                        <td className="py-2">{l.uom}</td>
                        <td className="py-2 text-right tabular-nums">{l.unitPrice.toLocaleString("en-IN")}</td>
                        <td className="py-2 text-right tabular-nums">{(l.qty * l.unitPrice).toLocaleString("en-IN")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {detail.purchaseOrders && detail.purchaseOrders.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                    <Truck size={14} />
                    Purchase Orders
                  </h4>
                  <div className="space-y-2">
                    {detail.purchaseOrders.map(po => (
                      <div key={po.id} className="rounded-lg border border-border p-3 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-mono text-sm">{po.sapPoNumber}</p>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            {po.currency} {Number(po.totalAmount).toLocaleString("en-IN")}
                            {po.deliveryDate ? ` · Delivery: ${formatDate(po.deliveryDate)}` : ""}
                            {po.lastSyncedAt ? ` · Synced ${timeAgo(po.lastSyncedAt)}` : ""}
                          </p>
                        </div>
                        <StatusBadge status={po.sapStatus ?? po.status} kind="po" />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <Skeleton className="h-32" />
          )}
        </DialogContent>
      </Dialog>

      {/* New PR dialog */}
      <NewPrDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        projectId={projectId}
        onSubmit={(body) => create.mutate(body)}
        submitting={create.isPending}
      />
    </div>
  );
}

// ─── PR row card ────────────────────────────────────────────────────────────

function PrRow({ pr, onOpen, onRefresh, onConvert, onCancel, onDelete, busy }: {
  pr: PurchaseRequisition;
  onOpen: () => void;
  onRefresh: () => void;
  onConvert: () => void;
  onCancel: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const isApproved = pr.sapStatus === "approved";
  const isTerminal = ["rejected", "cancelled", "po_issued"].includes(pr.sapStatus ?? "");
  return (
    <div className="glass-surface lift-card rounded-2xl p-4 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-mono text-sm font-semibold text-foreground">{pr.sapPrNumber ?? "(unsubmitted)"}</p>
          <StatusBadge status={pr.sapStatus ?? pr.status} kind="pr" />
        </div>
        <p className="text-xs text-muted-foreground mt-1 truncate">
          {pr.lineItems.length} line{pr.lineItems.length === 1 ? "" : "s"} · {pr.currency}{" "}
          {Number(pr.totalAmount).toLocaleString("en-IN")}
          {pr.lastSyncedAt ? ` · Synced ${timeAgo(pr.lastSyncedAt)}` : " · Never synced"}
        </p>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          type="button"
          onClick={onRefresh}
          disabled={busy}
          title="Refresh from SAP"
          className="inline-flex items-center justify-center w-8 h-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50"
        >
          <RefreshCw size={14} />
        </button>
        {isApproved && (
          <button
            type="button"
            onClick={onConvert}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-md text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <Truck size={12} />
            Issue PO
          </button>
        )}
        {!isTerminal && pr.sapStatus !== "po_issued" && (
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            title="Cancel PR"
            className="inline-flex items-center justify-center w-8 h-8 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            <Ban size={14} />
          </button>
        )}
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          title="Delete PR"
          className="inline-flex items-center justify-center w-8 h-8 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-50"
        >
          <Trash2 size={14} />
        </button>
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex items-center gap-0.5 px-2 h-8 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent"
        >
          Details
          <ChevronRight size={12} />
        </button>
      </div>
    </div>
  );
}

// ─── Status badge ───────────────────────────────────────────────────────────

function StatusBadge({ status, kind }: { status: string; kind: "pr" | "po" }) {
  const tone =
    status === "approved" || status === "received" ? "bg-success/10 text-success" :
    status === "po_issued" || status === "in_transit" ? "bg-primary/10 text-primary" :
    status === "rejected" || status === "cancelled" ? "bg-destructive/10 text-destructive" :
    status === "pending" || status === "open" ? "bg-warn/10 text-warn" :
    "bg-muted/40 text-muted-foreground";
  return (
    <span className={`text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded ${tone}`}>
      {kind === "pr" ? "PR" : "PO"} · {status.replace(/_/g, " ")}
    </span>
  );
}

// ─── New PR dialog ──────────────────────────────────────────────────────────

function NewPrDialog({
  open, onOpenChange, projectId, onSubmit, submitting,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  onSubmit: (body: Record<string, unknown>) => void;
  submitting: boolean;
}) {
  const [lines, setLines] = useState<LineItem[]>([
    { description: "", qty: 1, uom: "EA", unitPrice: 0 },
  ]);
  const [vendorCode, setVendorCode] = useState("");
  const [currency, setCurrency] = useState("INR");

  const total = lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  const valid = lines.every(l => l.description.trim() && l.qty > 0 && l.unitPrice >= 0);

  function handleSubmit() {
    onSubmit({
      projectId,
      sapVendorCode: vendorCode.trim() || undefined,
      currency,
      lineItems: lines,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New Purchase Requisition</DialogTitle>
          <DialogDescription>
            Submits to SAP via the active adapter. Mock adapter returns a deterministic PR number and starts the status
            machine; real adapter requires SAP credentials and is wired in a follow-up.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="pr-vendor">SAP vendor code (optional)</Label>
              <Input id="pr-vendor" value={vendorCode} onChange={e => setVendorCode(e.target.value)} placeholder="e.g. V100245" />
            </div>
            <div>
              <Label htmlFor="pr-curr">Currency</Label>
              <Input id="pr-curr" value={currency} onChange={e => setCurrency(e.target.value.toUpperCase().slice(0, 3))} placeholder="INR" />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Line items</Label>
              <span className="text-xs text-muted-foreground font-mono tabular-nums">
                Total {currency} {total.toLocaleString("en-IN")}
              </span>
            </div>
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="grid grid-cols-1 md:grid-cols-12 gap-2">
                  <Input className="md:col-span-5" placeholder="Description" value={l.description}
                    onChange={e => setLines(ls => ls.map((x, idx) => idx === i ? { ...x, description: e.target.value } : x))} />
                  <Input className="md:col-span-2" type="number" min={0} step="0.01" placeholder="Qty" value={l.qty}
                    onChange={e => setLines(ls => ls.map((x, idx) => idx === i ? { ...x, qty: Number(e.target.value) } : x))} />
                  <Input className="md:col-span-1" placeholder="UoM" value={l.uom}
                    onChange={e => setLines(ls => ls.map((x, idx) => idx === i ? { ...x, uom: e.target.value } : x))} />
                  <Input className="md:col-span-3" type="number" min={0} step="0.01" placeholder="Unit ₹" value={l.unitPrice}
                    onChange={e => setLines(ls => ls.map((x, idx) => idx === i ? { ...x, unitPrice: Number(e.target.value) } : x))} />
                  <button
                    type="button"
                    onClick={() => setLines(ls => ls.filter((_, idx) => idx !== i))}
                    disabled={lines.length === 1}
                    className="md:col-span-1 inline-flex items-center justify-center text-muted-foreground hover:text-destructive disabled:opacity-30"
                    aria-label="Remove line"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setLines(ls => [...ls, { description: "", qty: 1, uom: "EA", unitPrice: 0 }])}
                className="text-xs text-primary hover:underline inline-flex items-center gap-1"
              >
                <Plus size={12} />
                Add line
              </button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <button type="button" onClick={() => onOpenChange(false)} className="px-3 h-9 rounded-md text-[13px] text-muted-foreground hover:bg-accent">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!valid || submitting}
            className="btn-glossy-cta inline-flex items-center gap-2 px-4 h-9 rounded-md text-[13px] font-semibold disabled:opacity-50"
          >
            <ExternalLink size={14} />
            {submitting ? "Submitting to SAP…" : "Submit to SAP"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Tiny helpers ───────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// Display-only: the adapter mode is server-side, but for the UI hint we
// surface what Vite has in env (defaults to "mock" — matches the server's
// SAP_MODE default).
function getSapMode(): string {
  return (import.meta.env?.VITE_SAP_MODE as string) || "mock";
}
