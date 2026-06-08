import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { api } from "../lib/extra-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { AutoTextarea } from "@/components/ui/auto-textarea";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft } from "lucide-react";

type CreateBody = {
  type: "rfi" | "rfp" | "rfq" | "eauction";
  title: string;
  summary?: string;
  brief?: string;
  currency?: string;
  closesAt?: string;
  evaluationThresholdPct?: number;
  blindGrading?: boolean;
  surrogateBiddingAllowed?: boolean;
  alternativeBidsAllowed?: boolean;
};

export default function RfxNewPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [form, setForm] = useState<CreateBody>({
    type: "rfp", title: "", summary: "", brief: "", currency: "INR",
    evaluationThresholdPct: 60, blindGrading: true, surrogateBiddingAllowed: true, alternativeBidsAllowed: false,
  });
  function set<K extends keyof CreateBody>(k: K, v: CreateBody[K]) { setForm(f => ({ ...f, [k]: v })); }
  const create = useMutation({
    mutationFn: (body: CreateBody) => api.post<{ id: number }>("/api/rfx", body),
    onSuccess: (r) => { toast({ title: "RFx created" }); navigate(`/rfx/${r.id}`); },
    onError: (e: Error) => toast({ variant: "destructive", title: "Failed", description: e.message }),
  });
  const valid = form.title.trim().length >= 3 && form.closesAt;
  return (
    <div className="p-6 max-w-3xl mx-auto space-y-5">
      <Button variant="ghost" size="sm" onClick={() => navigate("/rfx")} className="text-muted-foreground">
        <ArrowLeft size={14} className="mr-1" /> Back to RFx
      </Button>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New RFx event</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          After creating, you'll add questions, scoring dimensions, and invited vendors before publishing.
        </p>
      </div>
      <div className="rounded-2xl border border-border bg-card/40 p-5 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Type</Label>
            <select value={form.type} onChange={e => set("type", e.target.value as CreateBody["type"])} className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm">
              <option value="rfi">RFI</option><option value="rfp">RFP</option><option value="rfq">RFQ</option><option value="eauction">E-Auction</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label>Currency</Label>
            <Input value={form.currency ?? ""} onChange={e => set("currency", e.target.value)} />
          </div>
          <div className="col-span-2 space-y-1">
            <Label>Title *</Label>
            <Input value={form.title} onChange={e => set("title", e.target.value)} placeholder="e.g. Active pharmaceutical ingredient sourcing — Q2 FY27" />
          </div>
          <div className="col-span-2 space-y-1">
            <Label>One-line summary</Label>
            <Input value={form.summary ?? ""} onChange={e => set("summary", e.target.value)} />
          </div>
          <div className="col-span-2 space-y-1">
            <Label>Brief</Label>
            <AutoTextarea value={form.brief ?? ""} onChange={e => set("brief", e.target.value)} minRows={5} placeholder="Scope, volumes, delivery, quality, regulatory…" />
          </div>
          <div className="space-y-1">
            <Label>Closes at *</Label>
            <Input type="datetime-local" value={form.closesAt ?? ""} onChange={e => set("closesAt", e.target.value ? new Date(e.target.value).toISOString() : undefined)} />
          </div>
          <div className="space-y-1">
            <Label>Commercial threshold (%)</Label>
            <Input type="number" min={0} max={100} value={form.evaluationThresholdPct ?? 60} onChange={e => set("evaluationThresholdPct", Number(e.target.value))} />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-border">
          <ToggleRow label="Blind grading" v={!!form.blindGrading} onChange={v => set("blindGrading", v)} />
          <ToggleRow label="Surrogate bidding" v={!!form.surrogateBiddingAllowed} onChange={v => set("surrogateBiddingAllowed", v)} />
          <ToggleRow label="Alternative bids" v={!!form.alternativeBidsAllowed} onChange={v => set("alternativeBidsAllowed", v)} />
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <Button variant="ghost" onClick={() => navigate("/rfx")}>Cancel</Button>
          <Button disabled={!valid || create.isPending} onClick={() => create.mutate(form)}>
            {create.isPending ? "Creating…" : "Create as draft"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ToggleRow({ label, v, onChange }: { label: string; v: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-2">
      <span className="text-sm">{label}</span>
      <Switch checked={v} onCheckedChange={onChange} />
    </div>
  );
}
